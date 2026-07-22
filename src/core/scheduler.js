const { isIdle } = require('./idle-detector');
const scout = require('./scout');
const architect = require('./architect');
const tracker = require('../state/tracker');
const config = require('../state/config');
const fs = require('fs');
const path = require('path');
const dns = require('dns');

const LOG_FILE = path.join(__dirname, '../../logs/system.log');
const POLL_INTERVAL_MS = 10000;
const BATCH_MAX = 5;

let running = false;
let paused = false;
let intervalHandle = null;
let discoveryQueue = [];
let processing = false;

fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

function log(level, message) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const line = `[${ts}] [${level}] ${message}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
  console.log(`\u23f1\ufe0f ${message}`);
}

function checkOnline() {
  return new Promise(resolve => {
    const req = dns.lookup('api.deepseek.com', (err) => resolve(!err));
    setTimeout(() => resolve(false), 3000);
  });
}

function tick() {
  if (paused || !running || processing) return;

  const cfg = config.get();
  const idleStatus = isIdle(cfg.idleThresholdSec, cfg.cpuThresholdPct);
  if (!idleStatus.idle) return;

  if (discoveryQueue.length > 0) {
    processDiscoveryQueue();
    return;
  }

  const pending = tracker.getByStatus('scouted');
  const retry = tracker.getByStatus('failed');

  if (pending.length > 0 || retry.length > 0) {
    processTransformQueue(idleStatus);
  }
}

function processDiscoveryQueue() {
  if (paused || discoveryQueue.length === 0) return;
  const batch = discoveryQueue.splice(0, BATCH_MAX);
  log('INFO', `Scouting ${batch.length} Datei(en)...`);
  for (const filePath of batch) {
    try { scout.scanFile(filePath); } catch (err) {
      log('ERROR', `Scout-Fehler: ${err.message}`);
    }
  }
}

async function processTransformQueue(idleStatus) {
  if (processing) return;
  processing = true;

  try {
    const online = await checkOnline();
    if (!online) {
      log('INFO', 'Offline-Modus: Verarbeitung zurueckgestellt.');
      processing = false;
      return;
    }

    const pending = tracker.getByStatus('scouted');
    const retry = tracker.getByStatus('failed');
    if (pending.length === 0 && retry.length === 0) { processing = false; return; }

    const count = Math.min(pending.length + retry.length, BATCH_MAX);
    log('INFO', `Transformiere ~${count} Dateien (idle=${idleStatus.idleSeconds}s, CPU=${idleStatus.cpuLoad}%)`);

    const results = await architect.processAll();
    if (results.length > 0) {
      log('INFO', `Batch: ${results.length} Skills erstellt.`);
    }
  } catch (err) {
    log('ERROR', `Transform-Fehler: ${err.message}`);
  } finally {
    processing = false;
  }
}

function start() {
  if (running) return;
  const cfg = config.get();
  if (cfg.paused) paused = true;
  running = true;
  log('INFO', `Scheduler gestartet. Poll: ${POLL_INTERVAL_MS}ms, Idle: ${cfg.idleThresholdSec}s, CPU: ${cfg.cpuThresholdPct}%`);
  intervalHandle = setInterval(tick, POLL_INTERVAL_MS);
}

function stop() {
  running = false;
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
  log('INFO', 'Scheduler gestoppt.');
}

function pause() { paused = true; log('INFO', 'Scheduler pausiert.'); }
function resume() { paused = false; log('INFO', 'Scheduler fortgesetzt.'); }

function enqueue(filePath) {
  if (!discoveryQueue.includes(filePath)) { discoveryQueue.push(filePath); }
}

function getStatus() {
  return {
    running, paused, processing,
    discoveryQueueSize: discoveryQueue.length,
    stats: {
      total: tracker.getAll().length,
      discovered: tracker.getByStatus('discovered').length,
      scouted: tracker.getByStatus('scouted').length,
      architected: tracker.getByStatus('architected').length,
      okf_ready: tracker.getByStatus('okf_ready').length,
      failed: tracker.getByStatus('failed').length,
      lessons_learned: tracker.getByStatus('lessons_learned').length,
      skipped: tracker.getByStatus('skipped').length
    }
  };
}

module.exports = { start, stop, pause, resume, enqueue, getStatus };
