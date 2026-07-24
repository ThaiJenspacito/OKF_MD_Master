const axios = require('axios');
const personality = require('./bot-personality');
require('dotenv').config();

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT_ID = process.env.ALLOWED_CHAT_ID || '';

function getUrl(method) {
  return `https://api.telegram.org/bot${TG_TOKEN}/${method}`;
}

async function sendMessage(chatId, text, parseMode = 'Markdown') {
  if (!TG_TOKEN) return;
  const target = chatId || TG_CHAT_ID;
  if (!target || target === '0') return;
  try {
    await axios.post(getUrl('sendMessage'), {
      chat_id: target,
      text: text.substring(0, 4096),
      parse_mode: parseMode
    }, { timeout: 8000 });
  } catch (e) {
    console.log('Telegram send error:', e.response?.data?.description || e.message);
  }
}

async function setWebhook(url) {
  if (!TG_TOKEN) return;
  const r = await axios.get(getUrl('setWebhook'), { params: { url }, timeout: 8000 });
  return r.data;
}

async function handleUpdate(body, skillAgent) {
  if (!body || !body.message) return null;
  const msg = body.message;
  const chatId = msg.chat.id;
  const userText = msg.text || '';
  const userName = msg.from?.first_name || 'User';

  const usersFile = require('fs').existsSync(require('path').join(__dirname, '../../../data/telegram-users.json'))
    ? JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../../../data/telegram-users.json'), 'utf8'))
    : {};
  const found = Object.entries(usersFile).find(([, v]) => v.chatId === chatId);
  const existingEmail = found ? found[0] : null;

  if (!TG_CHAT_ID || TG_CHAT_ID === '0') {
    console.log('TELEGRAM CHAT ID:', chatId, '- add this to .env as ALLOWED_CHAT_ID');
  }

  if (userText.toLowerCase().includes('/register')) {
    const parts = userText.split(' ').filter(Boolean);
    let email = parts[1] || '';
    if (email) {
      email = email.replace('@', '@').trim();
      const existing = Object.entries(usersFile).find(([, v]) => v.chatId === chatId);
      let key = existing ? existing[0] : (email + '_' + chatId);
      usersFile[key] = { email, chatId, name: userName, registered: new Date().toISOString(), active: true };
      require('fs').mkdirSync(require('path').dirname(require('path').join(__dirname, '../../../data/telegram-users.json')), { recursive: true });
      require('fs').writeFileSync(require('path').join(__dirname, '../../../data/telegram-users.json'), JSON.stringify(usersFile, null, 2));
      await sendMessage(chatId, `✅ Registered! Will notify at ${email}`);
    } else {
      await sendMessage(chatId, 'Usage: /register your@email.com');
    }
    return { chatId, userName, text: userText, answered: true };
  }

  if (userText.toLowerCase().includes('/status')) {
    if (existingEmail) {
      try {
        const auth = require('./auth');
        const user = auth.getUserByEmail(existingEmail);
        const role = user ? user.role : 'unknown';
        const status = user ? user.status : 'unknown';
        await sendMessage(chatId, `👤 ${existingEmail}\nRole: ${role}\nStatus: ${status}`);
      } catch { await sendMessage(chatId, '⚠️ Could not check status.'); }
    } else {
      await sendMessage(chatId, '⚠️ Not linked to any account. Use /register your@email.com');
    }
    return { chatId, userName, text: userText, answered: true };
  }

  console.log(`Telegram: "${userText}" from ${userName} (${chatId})`);

  try {
    let answer;
    if (userText === '/start' || userText.toLowerCase().includes('hi') || userText.toLowerCase().includes('hello') || userText.toLowerCase().includes('hey')) {
      answer = personality.responses.start(userName);
    } else if (userText === '/dashboard' || userText === '/status') {
      answer = personality.responses.dashboard();
    } else if (userText === '/skills' || userText === '/library') {
      answer = personality.responses.skills();
    } else if (skillAgent) {
      const result = await skillAgent.ask(userText, []);
      answer = personality.formatAnswer(result.answer);
    } else {
      answer = personality.responses.start(userName);
    }

    await sendMessage(chatId, answer);
    return { chatId, userName, text: userText, answered: true };
  } catch (e) {
    console.error('Telegram reply error:', e.message);
    return { chatId, userName, text: userText, answered: false };
  }
}

async function broadcastToRegistered(text) {
  if (!TG_TOKEN) return { sent: 0 };
  try {
    const usersFile = require('path').join(__dirname, '../../../data/telegram-users.json');
    const users = require('fs').existsSync(usersFile) ? JSON.parse(require('fs').readFileSync(usersFile, 'utf8')) : {};
    const active = Object.entries(users).filter(([, v]) => v.active !== false);
    let sent = 0;
    for (const [, u] of active) {
      try { await sendMessage(u.chatId, text); sent++; } catch {}
    }
    return { sent, total: active.length };
  } catch { return { sent: 0 }; }
}

module.exports = { handleUpdate, sendMessage, setWebhook, broadcastToRegistered, TG_TOKEN };
