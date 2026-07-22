const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const OpenAI = require('openai');
require('dotenv').config();

const DATA_DIR = path.join(__dirname, '../../data');
const OKF_DIR = path.join(DATA_DIR, 'okf_ready');

function loadKnowledge() {
  const skills = [];
  if (!fs.existsSync(OKF_DIR)) return skills;

  fs.readdirSync(OKF_DIR).filter(f => f.endsWith('.md')).forEach(f => {
    try {
      const raw = fs.readFileSync(path.join(OKF_DIR, f), 'utf8');
      const parsed = matter(raw);
      skills.push({
        name: parsed.data.name || f,
        description: parsed.data.description || '',
        tags: parsed.data.tags || [],
        type: parsed.data.type || 'skill',
        content: raw
      });
    } catch {}
  });

  return skills;
}

function buildSystemPrompt() {
  const skills = loadKnowledge();
  if (skills.length === 0) return 'Keine OKF-Skills geladen.';

  return `Du bist der OKF Skill Agent. Du hast Zugriff auf folgende Wissensbasis aus dem Open Knowledge Format:

${skills.map((s, i) =>
`### Skill ${i + 1}: ${s.name}
**Tags:** ${s.tags.join(', ')}
**Beschreibung:** ${s.description}
`
).join('\n')}

Beantworte alle Fragen NUR auf Basis dieser Wissensbasis. Wenn die Antwort nicht in den Skills steht, sage: "Dazu habe ich kein Wissen in meiner OKF-Datenbank."

Formatiere Antworten klar und praezise. Zitiere den relevanten Skill-Namen wenn moeglich.`;
}

function getClient() {
  const cfg = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'runtime-config.json'), 'utf8').catch(() => '{}'));
  const model = process.env.OKF_MODEL || 'deepseek-chat';

  if (model === 'deepseek-chat' && process.env.DEEPSEEK_API_KEY) {
    return {
      client: new OpenAI({ baseURL: 'https://api.deepseek.com', apiKey: process.env.DEEPSEEK_API_KEY }),
      model: 'deepseek-chat',
      provider: 'deepseek'
    };
  }

  if (process.env.OPENROUTER_API_KEY) {
    return {
      client: new OpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: process.env.OPENROUTER_API_KEY }),
      model: model.includes('/') ? model : 'cohere/north-mini-code:free',
      provider: 'openrouter'
    };
  }

  throw new Error('Kein LLM-Provider.');
}

async function ask(question, history = []) {
  const systemPrompt = buildSystemPrompt();
  const { client, model, provider } = getClient();

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-6),
    { role: 'user', content: question }
  ];

  const start = Date.now();
  const res = await client.chat.completions.create({
    model,
    messages,
    max_tokens: 2048,
    temperature: 0.3
  });

  const answer = res.choices[0].message.content;
  const tokens = res.usage?.total_tokens || Math.ceil((systemPrompt.length + question.length + answer.length) / 4);

  return {
    question,
    answer,
    model,
    provider,
    tokens,
    runtime: Date.now() - start,
    skillCount: loadKnowledge().length
  };
}

function getKnowledgeSummary() {
  return loadKnowledge().map(s => ({ name: s.name, tags: s.tags, description: s.description }));
}

module.exports = { ask, getKnowledgeSummary, loadKnowledge, buildSystemPrompt };
