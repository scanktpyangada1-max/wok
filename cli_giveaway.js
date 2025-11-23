const WebSocket = require('ws');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration
const GATEWAY_URL = 'wss://gateway.discord.gg/?v=9&encoding=json';
const API_BASE = 'https://discord.com/api/v9';

// Colors for console
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m'
};

class GiveawayBot {
    constructor(token, index) {
        this.token = token;
        this.index = index;
        this.ws = null;
        this.sessionId = null;
        this.heartbeatInterval = null;
        this.user = null;
        this.reconnectAttempts = 0;
        this.botName = `Bot ${index}`;
    }

    log(type, message) {
        const timestamp = new Date().toLocaleTimeString();
        let color = colors.reset;

        switch (type) {
            case 'INFO': color = colors.cyan; break;
            case 'SUCCESS': color = colors.green; break;
            case 'WARN': color = colors.yellow; break;
            case 'ERROR': color = colors.red; break;
            case 'JOIN': color = colors.blue; break;
            case 'WIN': color = colors.magenta; break;
        }

        console.log(`${colors.bright}[${timestamp}] [${this.botName}] [${type}]${colors.reset} ${color}${message}${colors.reset}`);
    }

    start() {
        this.connect();
    }

    connect() {
        this.log('INFO', 'Connecting to Gateway...');
        this.ws = new WebSocket(GATEWAY_URL);

        this.ws.on('open', () => {
            this.log('SUCCESS', 'Gateway Connection Opened');
            this.reconnectAttempts = 0;
        });

        this.ws.on('message', (data) => {
            try {
                const payload = JSON.parse(data);
                this.handlePayload(payload);
            } catch (e) {
                this.log('ERROR', 'Failed to parse payload: ' + e.message);
            }
        });

        this.ws.on('close', (code, reason) => {
            this.log('WARN', `Connection Closed: ${code} - ${reason}`);
            this.cleanup();
            this.reconnect();
        });

        this.ws.on('error', (err) => {
            this.log('ERROR', 'WebSocket Error: ' + err.message);
        });
    }

    reconnect() {
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        this.log('INFO', `Reconnecting in ${delay / 1000}s...`);
        this.reconnectAttempts++;
        setTimeout(() => this.connect(), delay);
    }

    cleanup() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.ws = null;
    }

    handlePayload(payload) {
        const { op, d, t } = payload;

        switch (op) {
            case 10: // Hello
                const { heartbeat_interval } = d;
                this.startHeartbeat(heartbeat_interval);
                this.identify();
                break;

            case 11: // Heartbeat ACK
                break;

            case 0: // Dispatch
                this.handleDispatch(t, d);
                break;
        }
    }

    startHeartbeat(interval) {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ op: 1, d: null }));
            }
        }, interval);
    }

    identify() {
        const identifyPayload = {
            op: 2,
            d: {
                token: this.token,
                properties: {
                    $os: 'windows',
                    $browser: 'chrome',
                    $device: 'pc'
                },
                intents: 33280
            }
        };
        this.ws.send(JSON.stringify(identifyPayload));
    }

    handleDispatch(type, data) {
        switch (type) {
            case 'READY':
                this.user = data.user;
                this.sessionId = data.session_id;
                this.botName = `${this.user.username}`; // Update name to username
                this.log('SUCCESS', `Logged in!`);
                break;

            case 'MESSAGE_CREATE':
                this.checkWinner(data);
                this.checkMessage(data);
                break;
        }
    }

    checkWinner(message) {
        if (!this.user) return;

        const content = (message.content || '').toLowerCase();

        // Check if message mentions the user
        const mentionsUser = message.mentions && message.mentions.some(user => user.id === this.user.id);

        // Check for winning keywords
        const isWinningMessage = content.includes('congratulations') ||
            content.includes('you won') ||
            content.includes('winner');

        if (mentionsUser && isWinningMessage) {
            this.log('WIN', `🏆 YOU WON A GIVEAWAY! Channel: ${message.channel_id} 🏆`);
            this.log('WIN', `Message: ${message.content}`);
        }
    }

    async checkMessage(message) {
        if (!message.components || message.components.length === 0) return;

        const content = (message.content || '').toLowerCase();
        const embeds = JSON.stringify(message.embeds || []).toLowerCase();

        const isGiveaway = content.includes('giveaway') ||
            embeds.includes('giveaway') ||
            embeds.includes('winner') ||
            embeds.includes('hosted by');

        if (!isGiveaway) return;

        this.log('INFO', `Giveaway detected in #${message.channel_id}`);

        for (const row of message.components) {
            for (const component of row.components) {
                if (component.type === 2) {
                    const label = (component.label || '').toLowerCase();
                    const emoji = component.emoji ? component.emoji.name : '';

                    if (label.includes('enter') ||
                        label.includes('join') ||
                        label.includes('serta') ||
                        emoji.includes('🎉') ||
                        component.custom_id.includes('giveaway')) {

                        this.log('JOIN', `Found Button: [${component.label || emoji}]`);

                        // Random delay per bot so they don't all join at the exact same millisecond
                        const delay = Math.floor(Math.random() * 8000) + 2000;
                        this.log('INFO', `Waiting ${delay}ms...`);

                        setTimeout(() => {
                            this.clickButton(message, component);
                        }, delay);

                        return;
                    }
                }
            }
        }
    }

    async clickButton(message, component) {
        try {
            const applicationId = message.application_id || message.author.id;

            const payload = {
                type: 3,
                guild_id: message.guild_id,
                channel_id: message.channel_id,
                message_id: message.id,
                application_id: applicationId,
                session_id: this.sessionId,
                data: {
                    component_type: 2,
                    custom_id: component.custom_id
                }
            };

            const headers = {
                'Authorization': this.token,
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            };

            this.log('JOIN', `Clicking button...`);

            await axios.post(`${API_BASE}/interactions`, payload, { headers });

            this.log('SUCCESS', `Joined giveaway! 🎉`);

        } catch (error) {
            if (error.response) {
                this.log('ERROR', `Failed: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            } else {
                this.log('ERROR', `Failed: ${error.message}`);
            }
        }
    }
}

// Main Execution
console.clear();
console.log(colors.bright + colors.green + "=== DISCORD MULTI-ACCOUNT GIVEAWAY CLI ===" + colors.reset);

const TOKEN_FILE = 'token.txt';
let tokens = [];

try {
    // 1. Try loading from Environment Variable (Best for Railway/Render/Heroku)
    if (process.env.TOKENS) {
        console.log(colors.cyan + "Loading tokens from Environment Variable..." + colors.reset);
        tokens = process.env.TOKENS.split(/[\n,]+/) // Split by newline or comma
            .map(t => t.trim())
            .filter(t => t.length > 10);
    }
    // 2. Fallback to token.txt (Local usage)
    else if (fs.existsSync(TOKEN_FILE)) {
        const fileContent = fs.readFileSync(TOKEN_FILE, 'utf-8');
        tokens = fileContent
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 10);
    } else {
        console.log(colors.yellow + `File '${TOKEN_FILE}' not found and no TOKENS env var!` + colors.reset);
        console.log("Creating empty token.txt...");
        fs.writeFileSync(TOKEN_FILE, '');
        console.log("Please paste your tokens in token.txt (one per line) OR set TOKENS env var.");
        process.exit(0);
    }

    if (tokens.length === 0) {
        console.log(colors.red + "No tokens found!" + colors.reset);
        process.exit(1);
    }

    console.log(colors.green + `Found ${tokens.length} tokens in ${TOKEN_FILE}` + colors.reset);
    console.log("Starting bots in 3 seconds...");

    setTimeout(() => {
        tokens.forEach((token, index) => {
            setTimeout(() => {
                // Clean token just in case
                const cleanToken = token.replace(/"/g, '').replace(/\r/g, '').trim();
                const bot = new GiveawayBot(cleanToken, index + 1);
                bot.start();
            }, index * 2000); // Stagger start
        });
    }, 3000);

    // --- RENDER / RAILWAY KEEPALIVE ---
    // Render expects a web service to bind to a port.
    const express = require('express');
    const app = express();
    const PORT = process.env.PORT || 3000;

    app.get('/', (req, res) => {
        res.send('Discord Giveaway Bot is Active! 🤖');
    });

    app.listen(PORT, () => {
        console.log(colors.cyan + `Web server listening on port ${PORT} (Required for Render)` + colors.reset);
    });

} catch (error) {
    console.error("Error reading token file:", error);
}
