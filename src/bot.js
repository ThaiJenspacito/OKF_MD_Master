const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

let userStates = {};

function initBot() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const allowedChatId = parseInt(process.env.ALLOWED_CHAT_ID);

    if (!token || !allowedChatId) {
        console.log("⚠️ Telegram Bot nicht gestartet: Token oder Chat-ID fehlt in der .env");
        return;
    }

    const bot = new TelegramBot(token, { polling: true });
    console.log("🤖 Telegram-Bot erfolgreich eingekoppelt und empfangsbereit.");

    // Keyboard-Layout für das Smartphone
    const mainMenuKeyboard = {
        reply_markup: {
            keyboard: [
                [{ text: '📥 Git / Web Quelle' }, { text: '🔍 Status' }],
                [{ text: '🔄 OKF Scan' }, { text: '📝 Logbuch' }],
                [{ text: '🚀 Push to Google Cache' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    };

    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        if (chatId !== allowedChatId) return; // Sicherheits-Riegel

        const text = msg.text;

        // Wartet der Bot auf einen Link? (Smart Link Detector)
        if (userStates[chatId] === 'AWAITING_URL') {
            userStates[chatId] = null;
            const url = text.trim();

            if (!url.startsWith('http')) {
                return bot.sendMessage(chatId, "⚠️ Ungültiger Link. Vorgang abgebrochen.", mainMenuKeyboard);
            }

            if (url.endsWith('.git')) {
                bot.sendMessage(chatId, "📦 Git-Repository erkannt! Füge es der Sandbox hinzu...", mainMenuKeyboard);
                // TODO: Git-Import Trigger
            } else {
                bot.sendMessage(chatId, "🌐 Website erkannt! Starte Web-Clipper (HTML zu OKF-MD)...", mainMenuKeyboard);
                // TODO: Web-Clipper Trigger
            }
            return;
        }

        // Button Logik
        switch (text) {
            case '/start':
                bot.sendMessage(chatId, "👋 Willkommen beim **OKF MD Master**! Nutze das Menü unten zur Steuerung.", mainMenuKeyboard);
                break;
            case '📥 Git / Web Quelle':
                userStates[chatId] = 'AWAITING_URL';
                bot.sendMessage(chatId, "🚀 Schicke mir als nächste Nachricht einfach den GitHub-Link oder eine Artikel-URL.");
                break;
            case '🔍 Status':
                bot.sendMessage(chatId, "🟢 Server & Dashboard: Online\n🤖 Scout: Aktiv\n🤖 Architect: Bereit", mainMenuKeyboard);
                break;
            case '📝 Logbuch':
                bot.sendMessage(chatId, "📋 Öffne das Dashboard unter http://localhost:3000 für das vollständige Audit-Log.", mainMenuKeyboard);
                break;
            default:
                bot.sendMessage(chatId, "💡 Bitte nutze die Tasten des Menüs.", mainMenuKeyboard);
        }
    });
}

module.exports = { initBot };
