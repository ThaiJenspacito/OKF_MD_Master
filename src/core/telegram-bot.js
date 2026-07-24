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

  // Register the chat ID
  if (!TG_CHAT_ID || TG_CHAT_ID === '0') {
    console.log('TELEGRAM CHAT ID:', chatId, '- add this to .env as ALLOWED_CHAT_ID');
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
      answer = `I got your message! But my brain is taking a quick nap 😴 Try the web dashboard meanwhile: https://thai-jenspacito-okf-md-299034318175.europe-west1.run.app`;
    }

    await sendMessage(chatId, answer);
    return { chatId, userName, text: userText, answered: true };
  } catch (e) {
    console.error('Telegram reply error:', e.message);
    return { chatId, userName, text: userText, answered: false };
  }
}

async function broadcastToRegistered(text) {
  if (TG_CHAT_ID && TG_CHAT_ID !== '0') {
    await sendMessage(TG_CHAT_ID, text);
  }
}

module.exports = { handleUpdate, sendMessage, setWebhook, broadcastToRegistered, TG_TOKEN };
