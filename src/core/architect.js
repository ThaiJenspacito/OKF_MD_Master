const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const OpenAI = require('openai');
require('dotenv').config();

const config = require('../state/config');
const tracker = require('../state/tracker');

const DATA_DIR = path.join(__dirname, '../../data');
const SCOUTED_DIR = path.join(DATA_DIR, 'scouted');
const OKF_READY_DIR = path.join(DATA_DIR, 'okf_ready');
const FAILED_DIR = path.join(DATA_DIR, 'failed');
const LESSONS_LEARNED_DIR = path.join(DATA_DIR, 'lessons-learned');
const PROCESSED_DIR = path.join(DATA_DIR, 'processed');
const INDEX_FILE = path.join(DATA_DIR, 'index.md');
const LOG_FILE = path.join(__dirname, '../../logs/architect.log');

fs.mkdirSync(OKF_READY_DIR, { recursive: true });
fs.mkdirSync(FAILED_DIR, { recursive: true });
fs.mkdirSync(LESSONS_LEARNED_DIR, { recursive: true });
fs.mkdirSync(PROCESSED_DIR, { recursive: true });
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

let tokenEstimateTotal = 0;

function log(level, message) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const line = `[${ts}] [${level}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line);
  console.log(`🤖 ${message}`);
}

function getClient(model) {
  if ((model === 'deepseek-chat' || model.startsWith('deepseek')) && process.env.DEEPSEEK_API_KEY) {
    return {
      client: new OpenAI({ baseURL: 'https://api.deepseek.com', apiKey: process.env.DEEPSEEK_API_KEY }),
      model: 'deepseek-chat',
      provider: 'deepseek',
      costPer1K: 0.014
    };
  }
  if (model.includes('/') && process.env.OPENROUTER_API_KEY) {
    return {
      client: new OpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: process.env.OPENROUTER_API_KEY }),
      model,
      provider: 'openrouter',
      costPer1K: model.includes(':free') ? 0 : 0.05
    };
  }
  if (process.env.OPENROUTER_API_KEY) {
    return {
      client: new OpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: process.env.OPENROUTER_API_KEY }),
      model: model || 'google/gemma-3-27b-it:free',
      provider: 'openrouter',
      costPer1K: 0
    };
  }
  throw new Error('Kein LLM-Provider konfiguriert.');
}

async function callLLM(prompt) {
  const cfg = config.get();
  const primaryModel = cfg.model || 'deepseek-chat';
  const fallbackModel = cfg.fallbackModel || 'google/gemma-3-27b-it:free';

  for (const model of [primaryModel, fallbackModel]) {
    if (model === primaryModel && model === fallbackModel) continue;
    try {
      const { client, model: actualModel, provider, costPer1K } = getClient(model);
      const res = await client.chat.completions.create({
        model: actualModel,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: cfg.maxTokens || 4096,
        temperature: 0.3
      });

      const text = res.choices[0].message.content.trim();
      const usage = res.usage || {};
      const inputTokens = usage.prompt_tokens || Math.ceil(prompt.length / 4);
      const outputTokens = usage.completion_tokens || Math.ceil(text.length / 4);
      const totalTokens = inputTokens + outputTokens;
      const cost = (totalTokens / 1000) * costPer1K;

      tokenEstimateTotal += totalTokens;

      return {
        text,
        model: actualModel,
        provider,
        inputTokens,
        outputTokens,
        totalTokens,
        cost
      };
    } catch (err) {
      log('WARN', `Model ${model} failed: ${err.message}. Trying fallback...`);
    }
  }

  throw new Error('All LLM providers failed.');
}

async function generateOKFStructure(rawContent) {
  const cfg = config.get();
  const modelName = cfg.model || 'deepseek-chat';

  const okfPrompt = `You are the OKF Architect. Transform the following text into the Google Open Knowledge Format (OKF).
Create clean YAML frontmatter with these fields:
- name: Short, concise skill name
- description: Core content in 1-2 sentences
- type: skill
- version: 1.0.0
- tags: Array with 3-5 relevant keywords

Here is the text:

${rawContent}

Return ONLY the finished markdown, without enclosing code blocks.`;

  const contentLength = rawContent.length;

  if (cfg.maxFileSize && contentLength > cfg.maxFileSize) {
    throw new Error(`File too large (${contentLength} > ${cfg.maxFileSize} Zeichen Limit)`);
  }

  log('INFO', `LLM-Call: ${modelName} (${contentLength} Zeichen Input)`);
  const result = await callLLM(okfPrompt);
  log('INFO', `Tokens: ${result.totalTokens} (in:${result.inputTokens} out:${result.outputTokens}) via ${result.provider}`);
  return result;
}

function updateMasterIndex(skillName, filename) {
  const timestamp = new Date().toLocaleDateString('de-DE');
  const indexLine = `* [${skillName}](okf_ready/${filename}) - ${timestamp}\n`;

  if (!fs.existsSync(INDEX_FILE)) {
    fs.writeFileSync(INDEX_FILE, `# OKF Master Index\n\n## Available Skills\n\n`);
  }

  const content = fs.readFileSync(INDEX_FILE, 'utf8');
  if (!content.includes(`okf_ready/${filename}`)) {
    fs.writeFileSync(INDEX_FILE, indexLine, { flag: 'a' });
  }
}

function addLessonsLearned(filename, skillName, content, model, error) {
  const dir = LESSONS_LEARNED_DIR;
  fs.mkdirSync(dir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/:/g, '-').substring(0, 19);
  const llFilename = `ll-${timestamp}-${filename}`;
  const llPath = path.join(dir, llFilename);

  const llContent = `---
name: ${skillName || filename}
type: lessons-learned
version: 1.0.0
description: Failed transformation. Modell: ${model}. Fehler: ${error || 'Unbekannt'}
model: ${model}
---

# Lessons Learned: ${filename}

## Fehler
${error || 'Unbekannter Fehler'}

## Rohdaten (Auszug)
${(content || '').substring(0, 500)}
`;

  fs.writeFileSync(llPath, llContent);
  log('INFO', `Lessons-Learned gespeichert: ${llFilename}`);
  return llPath;
}

async function transformOne(filename) {
  const state = tracker.getState(filename);
  if (!state) {
    log('ERROR', `Kein Status-Eintrag fuer: ${filename}`);
    return null;
  }

  let scoutedPath = state.paths.copy || path.join(SCOUTED_DIR, filename);
  if (!fs.existsSync(scoutedPath)) {
    const alternatives = [
      path.join(FAILED_DIR, filename),
      path.join(LESSONS_LEARNED_DIR, filename),
      path.join(DATA_DIR, 'originals', filename)
    ];
    scoutedPath = alternatives.find(p => fs.existsSync(p));
    if (!scoutedPath) {
      log('ERROR', `Scout-Kopie nicht gefunden: ${filename}`);
      return null;
    }
  }

  const startTime = Date.now();
  const rawContent = fs.readFileSync(scoutedPath, 'utf8');

  try {
    log('INFO', `Transformiere: ${filename}`);

    const result = await generateOKFStructure(rawContent);
    const okfContent = result.text;
    const runtime = Date.now() - startTime;

    const parsed = matter(okfContent);
    const skillName = parsed.data.name || filename;

    const okfPath = path.join(OKF_READY_DIR, filename);
    fs.writeFileSync(okfPath, okfContent);

    updateMasterIndex(skillName, filename);

    const processedPath = path.join(PROCESSED_DIR, filename);
    fs.copyFileSync(scoutedPath, processedPath);

    tracker.transition(filename, 'architected', {
      okfPath, skillName,
      model: result.model,
      provider: result.provider,
      runtime,
      contentLength: rawContent.length,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens: result.totalTokens,
      cost: result.cost
    });
    tracker.transition(filename, 'indexed', { skillName });
    tracker.transition(filename, 'okf_ready', {
      okfPath, skillName,
      model: result.model,
      hash: tracker.fileHash(okfPath)
    });

    log('INFO', `Skill erstellt: ${skillName} (${result.provider}, ${result.totalTokens} Tokens, ${runtime}ms)`);
    return { filename, skillName, okfPath, model: result.model, provider: result.provider, runtime, tokens: result.totalTokens };
  } catch (error) {
    const runtime = Date.now() - startTime;
    log('ERROR', `Fehler bei ${filename}: ${error.message}`);

    const retries = (state.retries || 0) + 1;
    const cfg = config.get();
    const model = cfg.model || 'deepseek-chat';

    if (retries >= (state.maxRetries || 3)) {
      addLessonsLearned(filename, state.name || filename, rawContent, model, error.message);
      tracker.transition(filename, 'lessons_learned', {
        error: error.message, retries, model, runtime
      });
      log('WARN', `3 Retries ueberschritten -> Lessons-Learned: ${filename}`);
    } else {
      const failedPath = path.join(FAILED_DIR, filename);
      try { fs.copyFileSync(scoutedPath, failedPath); } catch {}
      tracker.transition(filename, 'failed', { error: error.message, failedPath, retries });
    }

    return null;
  }
}

async function processAll(notifyFn = null) {
  const pending = tracker.getByStatus('scouted');
  const retryQueue = tracker.getByStatus('failed');
  const queue = [...pending, ...retryQueue];

  if (queue.length === 0) return [];

  log('INFO', `Verarbeite ${queue.length} Datei(en)... (${pending.length} neu, ${retryQueue.length} retry)`);

  const results = [];
  for (const entry of queue) {
    const result = await transformOne(entry.id);
    if (result) {
      results.push(result);
      if (notifyFn) { try { await notifyFn(result); } catch {} }
    }
  }

  log('INFO', `${results.length}/${queue.length} erfolgreich. Token gesamt: ~${tokenEstimateTotal}.`);
  return results;
}

function getTokenEstimate() {
  return tokenEstimateTotal;
}

module.exports = { transformOne, processAll, generateOKFStructure, getTokenEstimate, log };
