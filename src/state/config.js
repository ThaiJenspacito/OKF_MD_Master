const fs = require('fs');
const path = require('path');
require('dotenv').config();

const CONFIG_FILE = path.join(__dirname, '../../data/runtime-config.json');

const DEFAULTS = {
  model: process.env.OKF_MODEL || 'deepseek-chat',
  fallbackModel: process.env.OKF_FALLBACK_MODEL || 'google/gemma-3-27b-it:free',
  watchDirs: parseWatchDirs(),
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE_KB) * 1024 || 50000,
  maxTokens: parseInt(process.env.OKF_MAX_TOKENS) || 4096,
  paused: false,
  idleThresholdSec: parseInt(process.env.IDLE_THRESHOLD_SEC) || 120,
  cpuThresholdPct: parseInt(process.env.CPU_THRESHOLD_PCT) || 30
};

function parseWatchDirs() {
  const raw = process.env.WATCH_DIRS;
  if (!raw) return [path.join(__dirname, '../../mock_documents')];
  return raw.split(',').map(d => {
    const trimmed = d.trim();
    return path.isAbsolute(trimmed) ? trimmed : path.resolve(trimmed);
  });
}

function load() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    } catch {}
  }
  return { ...DEFAULTS };
}

function save(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function get() {
  return load();
}

function update(patch) {
  const current = load();
  const updated = { ...current, ...patch };
  save(updated);
  return updated;
}

module.exports = { get, update, DEFAULTS };
