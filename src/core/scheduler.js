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
const AUTO_SCAN_INTERVAL = 300000;
const ACTIVITY_FILE = path.join(__dirname, '../../logs/agent-activity.json');

let running = false;
let paused = false;
let intervalHandle = null;
let autoScanHandle = null;
let discoveryQueue = [];
let processing = false;
let agentActivity = {};

fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

function log(level, message) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const line = `[${ts}] [${level}] ${message}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
  console.log(`\u23f1\ufe0f ${message}`);
}

function updateActivity(agent, action, detail) {
  agentActivity[agent] = { at: new Date().toISOString(), action, detail };
  try { fs.writeFileSync(ACTIVITY_FILE, JSON.stringify(agentActivity, null, 2)); } catch {}
}

function checkOnline() {
  return new Promise(resolve => {
    dns.lookup('openrouter.ai', (err) => resolve(!err));
    setTimeout(() => resolve(false), 3000);
  });
}

function tick() {
  if (paused || !running || processing) return;

  if (discoveryQueue.length > 0) {
    processDiscoveryQueue();
    return;
  }

  const pending = tracker.getByStatus('scouted');
  const retry = tracker.getByStatus('failed');

  if (pending.length > 0 || retry.length > 0) {
    const idleStatus = isIdle();
    if (idleStatus.idle) {
      processTransformQueue(idleStatus);
    }
  }
}

function autoScanLaptop() {
  if (paused || !running) return;
  const discovered = tracker.getByStatus('discovered');
  const scouted = tracker.getByStatus('scouted');
  if (discovered.length > 0 || scouted.length > 0) return;

  log('INFO', 'Auto-Scan: Suche nach neuen .md-Dateien auf dem Laptop...');
  updateActivity('auto-scanner', 'auto-scan', 'Durchsuche Laptop');

  const cfg = config.get();
  const dirs = cfg.watchDirs || [];
  let totalFound = 0;

  dirs.forEach(d => {
    if (!fs.existsSync(d)) return;
    try {
      const files = scout.scanForKnowledge(d);
      totalFound += files.length;
    } catch (e) {
      log('ERROR', 'Auto-Scan Fehler in ' + d + ': ' + e.message);
    }
  });

  if (totalFound === 0) {
    updateActivity('auto-scanner', 'nothing-found', 'Keine neuen Dateien');
    log('INFO', 'Auto-Scan: Keine neuen Dateien gefunden.');
  } else {
    updateActivity('auto-scanner', 'found', totalFound + ' neue Dateien');
    log('INFO', 'Auto-Scan: ' + totalFound + ' neue Dateien entdeckt!');
  }
}

function processDiscoveryQueue() {
  if (paused || discoveryQueue.length === 0) return;
  const batch = discoveryQueue.splice(0, BATCH_MAX);
  updateActivity('scout', 'scouting', batch.length + ' Dateien');
  log('INFO', 'Scouting ' + batch.length + ' Datei(en)...');
  for (const filePath of batch) {
    try {
      const result = scout.scanFile(filePath);
      if (result) updateActivity('scout', 'found', result.filename);
    } catch (err) {
      log('ERROR', 'Scout-Fehler: ' + err.message);
    }
  }
  updateActivity('scout', 'idle', batch.length + ' verarbeitet');
}

async function processTransformQueue(idleStatus) {
  if (processing) return;
  processing = true;

  try {
    const online = await checkOnline();
    if (!online) {
      updateActivity('architect', 'offline', 'Wartet auf Netzwerk');
      log('INFO', 'Offline-Modus. Verarbeitung zurueckgestellt.');
      processing = false;
      return;
    }

    const pending = tracker.getByStatus('scouted');
    const retry = tracker.getByStatus('failed');
    if (pending.length === 0 && retry.length === 0) { processing = false; return; }

    const count = Math.min(pending.length + retry.length, BATCH_MAX);
    updateActivity('architect', 'transforming', count + ' Dateien');
    log('INFO', 'Transformiere ~' + count + ' Dateien (idle=' + idleStatus.idleSeconds + 's, CPU=' + idleStatus.cpuLoad + '%)');

    const results = await architect.processAll();
    if (results.length > 0) {
      updateActivity('architect', 'done', results.length + ' Skills erstellt');
      log('INFO', 'Batch: ' + results.length + ' Skills erstellt.');
    } else {
      updateActivity('architect', 'idle', 'Keine erfolgreich');
    }
  } catch (err) {
    updateActivity('architect', 'error', err.message);
    log('ERROR', 'Transform-Fehler: ' + err.message);
  } finally {
    processing = false;
  }
}

function start() {
  if (running) return;
  const cfg = config.get();
  if (cfg.paused) paused = true;
  running = true;
  updateActivity('scheduler', 'started', 'Poll: ' + POLL_INTERVAL_MS + 'ms');
  updateActivity('watcher', 'watching', (cfg.watchDirs || []).map(d => path.basename(d)).join(', '));
  updateActivity('architect', 'idle', 'Modell: ' + (cfg.model || '-'));

  intervalHandle = setInterval(tick, POLL_INTERVAL_MS);
  autoScanHandle = setInterval(autoScanLaptop, AUTO_SCAN_INTERVAL);

  log('INFO', 'Scheduler + Auto-Scan aktiv. Poll: ' + POLL_INTERVAL_MS + 'ms, Auto-Scan: ' + (AUTO_SCAN_INTERVAL / 60000) + 'min');
}

function stop() {
  running = false;
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
  if (autoScanHandle) { clearInterval(autoScanHandle); autoScanHandle = null; }
  updateActivity('scheduler', 'stopped', '');
  log('INFO', 'Scheduler gestoppt.');
}

function pause() { paused = true; updateActivity('scheduler', 'paused', ''); }
function resume() { paused = false; updateActivity('scheduler', 'resumed', ''); }
function enqueue(filePath) { if (!discoveryQueue.includes(filePath)) discoveryQueue.push(filePath); }

function getStatus() {
  return {
    running, paused, processing,
    discoveryQueueSize: discoveryQueue.length,
    activity: agentActivity,
    stats: {
      total: tracker.getAll().length,
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
