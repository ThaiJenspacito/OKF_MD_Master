const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
require('dotenv').config();

const DATA_DIR = path.join(__dirname, '../../data');
const OKF_DIR = path.join(DATA_DIR, 'okf_ready');
const SOCIAL_LOG = path.join(DATA_DIR, 'social-posts.json');

const PLATFORMS = {
  github: { name: 'GitHub', type: 'markdown', maxChars: 5000, tone: 'technisch, developer-freundlich' },
  discord: { name: 'Discord', type: 'markdown', maxChars: 2000, tone: 'community, casual, einladend' },
  instagram: { name: 'Instagram', type: 'text', maxChars: 2200, tone: 'visuell, kurz, mit Emojis und Hashtags', hashtags: 10 },
  tiktok: { name: 'TikTok', type: 'text', maxChars: 400, tone: 'sehr kurz, catchy, junge Zielgruppe', hashtags: 5 },
  youtube: { name: 'YouTube', type: 'text', maxChars: 5000, tone: 'ausfuehrlich, tutorial-style, SEO-optimiert', hashtags: 8 },
  facebook: { name: 'Facebook', type: 'text', maxChars: 63206, tone: 'community, Mehrwert, Frage ans Publikum', hashtags: 5 },
  google: { name: 'Google Business', type: 'text', maxChars: 1500, tone: 'professionell, Update-style, Business-freundlich' }
};

function loadSkills() {
  if (!fs.existsSync(OKF_DIR)) return [];
  return fs.readdirSync(OKF_DIR).filter(f => f.endsWith('.md')).map(f => {
    try {
      const raw = fs.readFileSync(path.join(OKF_DIR, f), 'utf8');
      const parsed = matter(raw);
      return { file: f, name: parsed.data.name || f, description: parsed.data.description || '', tags: parsed.data.tags || [] };
    } catch { return null; }
  }).filter(Boolean);
}

function getClient(model) {
  if (model === 'deepseek-chat' && process.env.DEEPSEEK_API_KEY) {
    return { client: new OpenAI({ baseURL: 'https://api.deepseek.com', apiKey: process.env.DEEPSEEK_API_KEY }), model: 'deepseek-chat', provider: 'deepseek' };
  }
  if (process.env.OPENROUTER_API_KEY) {
    return { client: new OpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: process.env.OPENROUTER_API_KEY }), model: model || 'cohere/north-mini-code:free', provider: 'openrouter' };
  }
  throw new Error('Kein Provider.');
}

async function generatePost(skill, platform) {
  const cfg = PLATFORMS[platform];
  if (!cfg) throw new Error('Unbekannte Plattform: ' + platform);

  const { client, model } = getClient('cohere/north-mini-code:free');

  const prompt = `Erstelle einen Social-Media-Post fuer ${cfg.name}.
Plattform: ${cfg.name} (${cfg.type})
Max Zeichen: ${cfg.maxChars}
Ton: ${cfg.tone}
${cfg.hashtags ? 'Fuege ' + cfg.hashtags + ' relevante Hashtags hinzu.' : ''}

Das OKF-Skill worueber gepostet wird:
Name: ${skill.name}
Beschreibung: ${skill.description}
Tags: ${skill.tags.join(', ')}

Gib NUR den fertigen Post-Text zurueck. Keine Erklaerung.`;

  const res = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 1000,
    temperature: 0.7
  });

  return {
    platform,
    platformName: cfg.name,
    skillName: skill.name,
    text: res.choices[0].message.content.trim(),
    generated: new Date().toISOString()
  };
}

async function generateAll(skillFile) {
  const skills = loadSkills();
  const skill = skills.find(s => s.file === skillFile);
  if (!skill) throw new Error('Skill nicht gefunden: ' + skillFile);

  const posts = [];
  for (const platform of Object.keys(PLATFORMS)) {
    try {
      const post = await generatePost(skill, platform);
      posts.push(post);
    } catch (e) {
      posts.push({ platform, platformName: PLATFORMS[platform].name, skillName: skill.name, text: '[Fehler: ' + e.message + ']', generated: new Date().toISOString() });
    }
  }

  return { skill: skill.name, posts };
}

function logPost(post) {
  const entries = fs.existsSync(SOCIAL_LOG) ? JSON.parse(fs.readFileSync(SOCIAL_LOG, 'utf8')) : [];
  entries.push({ ...post, posted: new Date().toISOString() });
  fs.writeFileSync(SOCIAL_LOG, JSON.stringify(entries, null, 2));
  return entries;
}

function getPostedHistory() {
  if (!fs.existsSync(SOCIAL_LOG)) return [];
  return JSON.parse(fs.readFileSync(SOCIAL_LOG, 'utf8'));
}

module.exports = { PLATFORMS, loadSkills, generatePost, generateAll, logPost, getPostedHistory };
