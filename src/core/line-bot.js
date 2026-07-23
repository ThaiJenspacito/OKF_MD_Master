const axios = require('axios');
require('dotenv').config();

const LINE_TOKEN = process.env.LINE_CHANNEL_TOKEN || '';
const LINE_SECRET = process.env.LINE_CHANNEL_SECRET || '';

function getHeaders() {
  return { Authorization: 'Bearer ' + LINE_TOKEN, 'Content-Type': 'application/json' };
}

async function replyMessage(replyToken, text) {
  if (!LINE_TOKEN) return;
  await axios.post('https://api.line.me/v2/bot/message/reply', {
    replyToken,
    messages: [{ type: 'text', text: text.substring(0, 5000) }]
  }, { headers: getHeaders() });
}

async function pushMessage(userId, text) {
  if (!LINE_TOKEN) return;
  await axios.post('https://api.line.me/v2/bot/message/push', {
    to: userId,
    messages: [{ type: 'text', text: text.substring(0, 5000) }]
  }, { headers: getHeaders() });
}

async function getProfile(userId) {
  if (!LINE_TOKEN) return null;
  const res = await axios.get(`https://api.line.me/v2/bot/profile/${userId}`, { headers: getHeaders() });
  return res.data;
}

async function handleWebhook(body, skillAgent) {
  const events = (body && body.events) || [];
  const results = [];

  for (const event of events) {
    if (event.type !== 'message' || event.message.type !== 'text') continue;

    const userText = event.message.text.trim();
    const userId = event.source.userId;
    const replyToken = event.replyToken;

    let profile = null;
    try { profile = await getProfile(userId); } catch {}

    const displayName = profile ? profile.displayName : 'LINE User';
    console.log('Line message: ' + userText + ' from ' + displayName);

    try {
      let answer;
      if (userText === '/start' || userText.toLowerCase().includes('hi') || userText.toLowerCase().includes('hello')) {
        answer = '👋 Hello ' + displayName + '! I am the OKF MD Master AI.\n\n📊 /dashboard — Live status\n📚 /skills — Browse OKF skills\n💬 Ask me anything — I answer from the OKF knowledge base.\n\n🌐 ' + (process.env.CLOUD_RUN_URL || 'http://localhost:5000');
      } else if (userText === '/dashboard' || userText === '/status') {
        answer = '📊 Dashboard: https://thai-jenspacito-okf-md.eu.run.app\nCloud Run 24/7 · 9 agents · 15+ OKF skills';
      } else if (userText === '/skills' || userText === '/library') {
        answer = '📚 OKF Library: https://thai-jenspacito-okf-md.eu.run.app/library\nBrowse all skills with search and filters.';
      } else if (skillAgent) {
        const result = await skillAgent.ask(userText, []);
        answer = result.answer;
        if (answer.length > 4500) answer = answer.substring(0, 4500) + '\n\n... [truncated]';
      } else {
        answer = 'I received: "' + userText + '"\n\nThe Skill Agent is not available right now. Try the web dashboard.';
      }

      await replyMessage(replyToken, answer);
      results.push({ userId, displayName, text: userText, answered: true });
    } catch (e) {
      console.error('LINE reply error:', e.message);
      results.push({ userId, displayName, text: userText, answered: false, error: e.message });
    }
  }

  return results;
}

function verifySignature(body, signature) {
  if (!LINE_SECRET) return true;
  try {
    const crypto = require('crypto');
    const hash = crypto.createHmac('sha256', LINE_SECRET).update(JSON.stringify(body)).digest('base64');
    return hash === signature;
  } catch { return true; }
}

module.exports = { handleWebhook, replyMessage, pushMessage, verifySignature, LINE_TOKEN, LINE_SECRET };
