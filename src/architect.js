const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const AGENTS_DIR = path.join(__dirname, '../.agents');
const INCOMING_DIR = path.join(AGENTS_DIR, 'skills/incoming');
const ACTIVE_LOCAL_DIR = path.join(AGENTS_DIR, 'skills/active/local');
const INDEX_FILE = path.join(AGENTS_DIR, 'skills/index.md');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Telegram optional initialisieren
let bot = null;
const chatId = parseInt(process.env.ALLOWED_CHAT_ID);
if (process.env.TELEGRAM_BOT_TOKEN && !process.env.TELEGRAM_BOT_TOKEN.includes('hier_das_teil')) {
    try {
        bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
    } catch (e) {
        console.log("ℹ️ Telegram Bot konnte nicht gestartet werden. Überspringe Push-Funktion.");
    }
}

async function generateOKFStructure(rawContent, filename) {
    const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });
    
    const prompt = `
    Du bist der OKF-Architect. Transformiere den folgenden Text in das Google Open Knowledge Format (OKF).
    Erstelle ein sauberes YAML-Frontmatter (type: skill, name, description, tags, version: 1.0.0).
    Hier ist der Text:
    ${rawContent}
    Gib NUR das fertige Markdown zurück, ohne umschließende Code-Blocks.
    `;

    const result = await model.generateContent(prompt);
    return result.response.text().trim();
}

function updateMasterIndex(skillName, filename) {
    const timestamp = new Date().toLocaleDateString('de-DE');
    const indexLine = `* [${skillName}](active/local/${filename}) - Hinzugefügt am ${timestamp}\n`;
    if (!fs.existsSync(INDEX_FILE)) {
        fs.writeFileSync(INDEX_FILE, `# 🗂️ OKF Master Index\n\n## Verfügbare Skills\n`);
    }
    fs.appendFileSync(INDEX_FILE, indexLine);
}

async function transformIncomingSkills() {
    if (!fs.existsSync(INCOMING_DIR)) return;
    const files = fs.readdirSync(INCOMING_DIR).filter(f => f.endsWith('.md'));

    if (files.length === 0) {
        console.log("📌 Keine wartenden Dateien im Incoming-Ordner.");
        return;
    }

    console.log(`🤖 OKF-Architect verarbeitet ${files.length} Datei(en)...`);

    for (const file of files) {
        const incomingPath = path.join(INCOMING_DIR, file);
        const activePath = path.join(ACTIVE_LOCAL_DIR, file);
        
        try {
            const rawContent = fs.readFileSync(incomingPath, 'utf8');
            const okfContent = await generateOKFStructure(rawContent, file);
            
            fs.writeFileSync(activePath, okfContent);
            const parsed = matter(okfContent);
            const skillName = parsed.data.name || file;
            
            updateMasterIndex(skillName, file);
            fs.unlinkSync(incomingPath);

            console.log(`✅ Skill erfolgreich transformiert: ${skillName}`);

            // TELEGRAM-BOX: Wenn es schiefgeht, wird es einfach ignoriert!
            if (bot && chatId) {
                try {
                    const message = `✨ **Neuer OKF-Skill!** ✨\n\n📦 **Name:** ${skillName}`;
                    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                } catch (tgError) {
                    // Stiller Fehler: Fängt falsche IDs ab, ohne das Skript zu killen
                    console.log(`ℹ️ Telegram-Push übersprungen (ID oder Bot-Berechtigung passt noch nicht).`);
                }
            }

        } catch (error) {
            console.error(`🚨 Fehler bei der KI-Transformation von ${file}:`, error.message);
        }
    }
}

transformIncomingSkills();