const axios = require('axios');
const personality = require('./bot-personality');
require('dotenv').config();

const WA_TOKEN = process.env.WHATSAPP_TOKEN || '';
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_ID || '';
const WA_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'okf_md_master_2026';

async function sendMessage(to, text) {
  if (!WA_TOKEN || !WA_PHONE_ID) return;
  await axios.post(`https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`, {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text.substring(0, 4096) }
  }, { headers: { Authorization: 'Bearer ' + WA_TOKEN, 'Content-Type': 'application/json' } });
}

async function handleWebhook(body, skillAgent) {
  const entries = (body && body.entry) || [];
  const results = [];

  for (const entry of entries) {
    for (const change of (entry.changes || [])) {
      if (change.field !== 'messages') continue;
      const messages = (change.value && change.value.messages) || [];
      const contacts = (change.value && change.value.contacts) || [];

      for (const msg of messages) {
        if (msg.type !== 'text') continue;
        const from = msg.from;
        const userText = msg.text.body.trim();
        const contact = contacts.find(c => c.wa_id === from);
        const userName = contact ? contact.profile.name : from;

        console.log(`WhatsApp: "${userText}" from ${userName}`);

        try {
          let answer;
          if (userText === '/start' || userText.toLowerCase().includes('hi') || userText.toLowerCase().includes('hello') || userText.toLowerCase().includes('hey')) {
            answer = personality.responses.start(userName);
          } else if (userText === '/dashboard') {
            answer = personality.responses.dashboard();
          } else if (userText === '/skills') {
            answer = personality.responses.skills();
          } else if (skillAgent) {
            const result = await skillAgent.ask(userText, []);
            answer = personality.formatAnswer(result.answer);
          } else {
            answer = `Got your message! Brain's taking a break 😴 Try the dashboard: https://thai-jenspacito-okf-md.eu.run.app`;
          }

          await sendMessage(from, answer);
          results.push({ from, userName, text: userText });
        } catch (e) {
          console.error('WhatsApp error:', e.message);
        }
      }
    }
  }

  return results;
}

function verifyWebhook(mode, challenge, token) {
  if (mode === 'subscribe' && token === WA_VERIFY_TOKEN) return challenge;
  return null;
}

module.exports = { handleWebhook, sendMessage, verifyWebhook, WA_TOKEN, WA_PHONE_ID };
