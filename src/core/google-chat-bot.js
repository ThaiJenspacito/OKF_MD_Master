const axios = require('axios');
const personality = require('./bot-personality');
require('dotenv').config();

const GC_TOKEN = process.env.GOOGLE_CHAT_TOKEN || '';

async function sendMessage(space, text) {
  if (!GC_TOKEN) return;
  await axios.post(
    `https://chat.googleapis.com/v1/${space}/messages`,
    { text: text.substring(0, 4096) },
    { headers: { Authorization: 'Bearer ' + GC_TOKEN, 'Content-Type': 'application/json' } }
  );
}

async function handleEvent(body, skillAgent) {
  if (!body || body.type === 'REMOVED_FROM_SPACE') return null;
  if (body.type === 'ADDED_TO_SPACE') {
    return { text: personality.responses.start(body.user?.displayName || 'there') };
  }
  if (body.type !== 'MESSAGE' || !body.message) return null;

  const userText = (body.message.argumentText || body.message.text || '').trim();
  const userName = body.user?.displayName || 'User';
  const space = body.space?.name || '';

  console.log('Google Chat:', userText, 'from', userName);

  try {
    let answer;
    if (!userText || userText.toLowerCase().includes('hi') || userText.toLowerCase().includes('hello') || userText.toLowerCase().includes('hey')) {
      answer = personality.responses.start(userName);
    } else if (userText === '/dashboard') {
      answer = personality.responses.dashboard();
    } else if (userText === '/skills') {
      answer = personality.responses.skills();
    } else if (skillAgent) {
      const result = await skillAgent.ask(userText, []);
      answer = personality.formatAnswer(result.answer);
    } else {
      answer = `Got your message! Brain's taking a break 😴 Try: https://thai-jenspacito-okf-md-299034318175.europe-west1.run.app`;
    }

    await sendMessage(space, answer);
    return { userName, text: userText };
  } catch (e) {
    console.error('Google Chat error:', e.message);
    return { userName, text: userText, error: e.message };
  }
}

module.exports = { handleEvent, sendMessage, GC_TOKEN };
