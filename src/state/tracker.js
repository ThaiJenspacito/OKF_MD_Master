const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STATE_DIR = path.join(__dirname, '../../data/state');

const VALID_STATUSES = [
  'discovered',
  'scouted',
  'architected',
  'indexed',
  'okf_ready',
  'skipped',
  'failed',
  'lessons_learned'
];

function statePath(filename) {
  const base = path.basename(filename, '.md');
  return path.join(STATE_DIR, `${base}.json`);
}

function fileHash(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function getState(filename) {
  const sp = statePath(filename);
  if (!fs.existsSync(sp)) return null;
  try {
    return JSON.parse(fs.readFileSync(sp, 'utf8'));
  } catch {
    return null;
  }
}

function create(filename, originalPath) {
  const sp = statePath(filename);
  const entry = {
    id: path.basename(filename),
    originalPath,
    hash: fileHash(originalPath),
    status: 'discovered',
    stages: {
      discovered: { at: new Date().toISOString(), ok: true }
    },
    retries: 0,
    maxRetries: 3,
    error: null,
    paths: {}
  };
  fs.mkdirSync(path.dirname(sp), { recursive: true });
  fs.writeFileSync(sp, JSON.stringify(entry, null, 2));
  return entry;
}

function transition(filename, newStatus, metadata = {}) {
  const sp = statePath(filename);
  let entry = getState(filename);
  if (!entry) return null;

  entry.status = newStatus;
  entry.stages[newStatus] = {
    at: new Date().toISOString(),
    ok: !['failed', 'lessons_learned', 'skipped'].includes(newStatus),
    ...metadata
  };

  if (metadata.copyPath) entry.paths.copy = metadata.copyPath;
  if (metadata.okfPath) entry.paths.okf = metadata.okfPath;
  if (metadata.processedPath) entry.paths.processed = metadata.processedPath;

  if (newStatus === 'failed' && metadata.retries !== undefined) {
    entry.retries = metadata.retries;
    entry.error = metadata.error || null;
  }


  fs.writeFileSync(sp, JSON.stringify(entry, null, 2));
  return entry;
}

function getAll() {
  if (!fs.existsSync(STATE_DIR)) return [];
  return fs.readdirSync(STATE_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(STATE_DIR, f), 'utf8')); }
      catch { return null; }
    })
    .filter(Boolean);
}

function getByStatus(status) {
  return getAll().filter(e => e.status === status);
}

module.exports = { create, getState, transition, getAll, getByStatus, fileHash, STATE_DIR };
