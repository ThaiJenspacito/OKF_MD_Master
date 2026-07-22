const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const multer = require('multer');
const os = require('os');
const dns = require('dns');
const axios = require('axios');
const Turndown = require('turndown');
require('dotenv').config();

const tracker = require('./state/tracker');
const scheduler = require('./core/scheduler');
const config = require('./state/config');
const { isIdle, getCpuLoad } = require('./core/idle-detector');
const architect = require('./core/architect');
const skillAgent = require('./core/skill-agent');
const social = require('./core/social');
const monitor = require('./core/monitor');
const sync = require('./core/sync');
const auth = require('./core/auth');

const app = express();
const PORT = process.env.PORT || 5000;
const ADMIN_PIN = process.env.ADMIN_PIN || '180473';

app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

const DATA_DIR = path.join(__dirname, '../data');
const INDEX_FILE = path.join(DATA_DIR, 'index.md');
const SYSTEM_LOG = path.join(__dirname, '../logs/system.log');
const OKF_READY_DIR = path.join(DATA_DIR, 'okf_ready');

const JOURNAL_FILE = path.join(DATA_DIR, 'journal.json');
const UPLOADS_DIR = path.join(__dirname, '../mock_documents');

function loadJournal() {
  if (!fs.existsSync(JOURNAL_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(JOURNAL_FILE, 'utf8')); } catch { return []; }
}

function addJournalEntry(source, filename, action, detail) {
  const entries = loadJournal();
  entries.push({
    at: new Date().toISOString().replace('T', ' ').substring(0, 19),
    source,
    filename,
    action,
    detail
  });
  if (entries.length > 200) entries.splice(0, entries.length - 200);
  fs.writeFileSync(JOURNAL_FILE, JSON.stringify(entries, null, 2));
}

function checkHealth() {
  const status = scheduler.getStatus();
  cfg = config.get();
  const results = {
    uptime: process.uptime(),
    scheduler: status.running && !status.paused,
    watcher: true,
    llm: false,
    disk: null,
    memory: null
  };
  try {
    const free = fs.statSync(path.join(__dirname, '..')).size;
    const total = os.totalmem();
    const rss = process.memoryUsage().rss;
    results.disk = { ok: true };
    results.memory = { total: Math.round(total / 1e9) + 'GB', used: Math.round(rss / 1e6) + 'MB', ok: rss < total * 0.8 };
  } catch {}
  return new Promise(resolve => {
    dns.lookup('openrouter.ai', (err) => {
      results.llm = !err;
      results.allOk = results.scheduler && results.llm && (!results.memory || results.memory.ok);
      resolve(results);
    });
  });
}

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.md')) cb(null, true);
    else cb(new Error('Nur .md-Dateien erlaubt'));
  }
});

const sessions = {};

function readLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    return fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim());
  } catch { return []; }
}

function isLoggedIn(req) {
  const sid = req.cookies.okf_session;
  if (!sid || !sessions[sid]) return false;
  if (Date.now() - sessions[sid].created > 8 * 3600000) {
    delete sessions[sid];
    return false;
  }
  return true;
}

function getUser(req) {
  const sid = req.cookies.okf_session;
  if (!sid || !sessions[sid]) return null;
  return sessions[sid].user || null;
}

function agentCard(name, icon, color, status, detail, model) {
  const dot = status ? '🟢' : '🔴';
  return `<div class="bg-gray-700/50 rounded-lg border border-gray-600/50 p-4 flex items-start space-x-3">
  <span class="text-2xl">${icon}</span>
  <div class="flex-1 min-w-0">
    <div class="flex justify-between items-center">
      <span class="font-bold text-${color}-300 text-sm">${name}</span>
      <span class="text-xs bg-${status ? 'green' : 'red'}-900/40 text-${status ? 'green' : 'red'}-300 px-2 py-0.5 rounded">${dot} ${status ? 'Aktiv' : 'Inaktiv'}</span>
    </div>
    <p class="text-xs text-gray-400 mt-1">${detail}</p>
    ${model ? `<p class="text-xs font-mono text-gray-500 mt-1">🤖 ${model}</p>` : ''}
  </div>
</div>`;
}

function okfCard(name, description, tags, date) {
  return `<div class="bg-gray-700/50 rounded-lg border border-gray-600/50 p-3">
  <span class="font-medium text-teal-300 text-sm block">${name}</span>
  <span class="text-xs text-gray-500">${description || ''}</span>
  <div class="flex flex-wrap gap-1 mt-2">${(tags || []).map(t => `<span class="text-xs bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded">${t}</span>`).join('')}</div>
  <span class="text-xs text-gray-600 block mt-1">${date || ''}</span>
</div>`;
}

app.get('/login', (req, res) => {
  if (isLoggedIn(req)) return res.redirect('/');
  const gClientId = auth.GOOGLE_CLIENT_ID || '';
  const gButton = gClientId ? `
<div id="g_id_onload" data-client_id="${gClientId}" data-callback="handleGoogleLogin" data-auto_prompt="false"></div>
<div class="g_id_signin mt-4" data-type="standard" data-size="large" data-theme="filled_black" data-text="sign_in_with" data-shape="rectangular" data-logo_alignment="left"></div>
<script src="https://accounts.google.com/gsi/client" async defer></script>
<script>function handleGoogleLogin(r){fetch('/auth/google',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credential:r.credential})}).then(x=>x.json()).then(d=>{if(d.ok)location.href='/';else alert(d.error)})}</script>
<div class="text-center my-3"><span class="text-gray-600 text-xs">oder</span></div>
` : '';

  res.send(`<!DOCTYPE html><html lang="de" class="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>OKF Login</title><script src="https://cdn.tailwindcss.com"></script><script>tailwind.config={darkMode:'class'}</script></head><body class="bg-gray-950 min-h-screen flex items-center justify-center"><div class="bg-gray-900 p-8 rounded-2xl border border-gray-800 w-full max-w-sm shadow-2xl"><div class="text-center mb-6"><h1 class="text-2xl font-bold bg-gradient-to-r from-teal-400 to-blue-500 bg-clip-text text-transparent">OKF MD Master</h1><p class="text-gray-500 text-sm mt-1">Admin-Login</p></div>${gButton}<form method="POST" action="/login"><input type="password" name="pin" placeholder="PIN" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-gray-100 text-center text-lg tracking-widest focus:outline-none focus:border-teal-500 mb-4" maxlength="8" autofocus><button class="w-full bg-teal-600 hover:bg-teal-500 text-white font-semibold py-3 rounded-lg transition">Anmelden</button></form></div></body></html>`);
});

app.post('/auth/google', express.json(), async (req, res) => {
  try {
    const payload = await auth.verifyGoogleToken(req.body.credential);
    const user = auth.getOrCreateUser(payload.email, payload.name, payload.picture);
    const sid = crypto.randomBytes(16).toString('hex');
    sessions[sid] = { created: Date.now(), ip: req.ip || 'local', user };
    res.cookie('okf_session', sid, { httpOnly: true, maxAge: 8 * 3600000 });
    res.json({ ok: true });
  } catch (e) {
    res.status(401).json({ error: e.message });
  }
});

app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  if (req.body.pin !== ADMIN_PIN) {
    return res.send(`<!DOCTYPE html><html lang="de" class="dark"><head><meta charset="UTF-8"><title>OKF Login</title><script src="https://cdn.tailwindcss.com"></script></head><body class="bg-gray-950 min-h-screen flex items-center justify-center"><div class="text-center"><p class="text-red-400 text-lg mb-4">Falsche PIN</p><a href="/login" class="text-teal-400 hover:underline">Erneut versuchen</a></div></body></html>`);
  }
  const sid = crypto.randomBytes(16).toString('hex');
  sessions[sid] = { created: Date.now(), ip: req.ip || req.socket.remoteAddress || 'local' };
  res.cookie('okf_session', sid, { httpOnly: true, maxAge: 8 * 3600000 });
  res.redirect('/');
});

app.get('/logout', (req, res) => {
  const sid = req.cookies.okf_session;
  if (sid) delete sessions[sid];
  res.clearCookie('okf_session');
  res.redirect('/login');
});

app.get('/', (req, res) => {
  if (!isLoggedIn(req)) return res.redirect('/login');

  const status = scheduler.getStatus();
  const idleStatus = isIdle();
  const cfg = config.get();
  const allEntries = tracker.getAll();
  const activeSessions = Object.entries(sessions)
    .filter(([,s]) => Date.now() - s.created < 8 * 3600000)
    .map(([sid, s]) => ({
      sid: sid.substring(0, 8) + '...',
      ip: s.ip || 'local',
      since: Math.round((Date.now() - s.created) / 60000)
    }));
  const skillCount = allEntries.filter(e => e.status === 'okf_ready').length;
  const cpuLoad = getCpuLoad();

  const indexLines = readLines(INDEX_FILE).filter(l => l.startsWith('*'));
  const skills = indexLines.map(line => {
    const match = line.match(/\* \[(.*?)\]\((.*?)\) - (.*)/);
    if (match) return { name: match[1], path: match[2], date: match[3] };
    return null;
  }).filter(Boolean);

  const recentActivity = allEntries
    .sort((a, b) => {
      const aTime = a.stages?.okf_ready?.at || a.stages?.discovered?.at || '';
      const bTime = b.stages?.okf_ready?.at || b.stages?.discovered?.at || '';
      return bTime.localeCompare(aTime);
    })
    .slice(0, 10);

  const statusBadge = (s) => {
    const map = {
      okf_ready: 'bg-green-900/40 text-green-300 border-green-700',
      scouted: 'bg-blue-900/40 text-blue-300 border-blue-700',
      architected: 'bg-teal-900/40 text-teal-300 border-teal-700',
      failed: 'bg-yellow-900/40 text-yellow-300 border-yellow-700',
      lessons_learned: 'bg-amber-900/40 text-amber-300 border-amber-700',
      discovered: 'bg-gray-700 text-gray-300 border-gray-600',
      skipped: 'bg-gray-800 text-gray-500 border-gray-700'
    };
    return map[s] || 'bg-gray-700 text-gray-400 border-gray-600';
  };

  const treeFolders = [
    { name: 'data', icon: '📁' },
    { name: 'originals', icon: '📄', parent: 'data' },
    { name: 'scouted', icon: '📋', parent: 'data' },
    { name: 'okf_ready', icon: '✅', parent: 'data' },
    { name: 'processed', icon: '📦', parent: 'data' },
    { name: 'failed', icon: '⚠️', parent: 'data' },
    { name: 'lessons-learned', icon: '📚', parent: 'data' },
    { name: 'state', icon: '🔧', parent: 'data' }
  ];

  const treeData = treeFolders.map(f => {
    const fp = path.join(DATA_DIR, f.name);
    let count = 0;
    if (fs.existsSync(fp)) {
      count = fs.readdirSync(fp).filter(x => x.endsWith('.md') || x.endsWith('.json')).length;
    }
    return { ...f, count };
  });

  const categoryMap = {};
  if (fs.existsSync(OKF_READY_DIR)) {
    fs.readdirSync(OKF_READY_DIR).filter(f => f.endsWith('.md')).forEach(f => {
      try {
        const parsed = matter(fs.readFileSync(path.join(OKF_READY_DIR, f), 'utf8'));
        const tags = parsed.data.tags || ['Unkategorisiert'];
        const cat = tags[0];
        if (!categoryMap[cat]) categoryMap[cat] = [];
        categoryMap[cat].push({ file: f, name: parsed.data.name || f, description: parsed.data.description || '', tags, date: '' });
      } catch {}
    });
  }

  const categoryTree = Object.entries(categoryMap).map(([cat, files]) => ({
    category: cat,
    count: files.length,
    files
  }));

  const hasTelegram = !!(process.env.TELEGRAM_BOT_TOKEN && !process.env.TELEGRAM_BOT_TOKEN.includes('DEIN_BOT_TOKEN'));
  const tokens = architect.getTokenEstimate();
  const journalEntries = loadJournal().slice(-10).reverse();
  const activity = status.activity || {};
  const user = getUser(req);
  const userDisplay = user ? `<span class="text-xs text-gray-400">👤 ${user.name || user.email}</span>` : '';

  res.send(`<!DOCTYPE html><html lang="de" class="dark"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>OKF MD Master</title>
<script src="https://cdn.tailwindcss.com"></script><script>tailwind.config={darkMode:'class'}</script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#0d9488">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="OKF Master">
<link rel="apple-touch-icon" href="/icon.svg">
<meta http-equiv="refresh" content="30">
<script>
if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
let deferredPrompt;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; });
function installPWA(){ if(deferredPrompt){ deferredPrompt.prompt(); deferredPrompt.userChoice.then(()=>{deferredPrompt=null}) } }
</script>
</head><body class="bg-gray-950 text-gray-100 font-sans min-h-screen">
<div class="container mx-auto px-4 py-6 max-w-7xl">

<header class="flex justify-between items-center border-b border-gray-800 pb-5 mb-6">
<div>
<h1 class="text-2xl font-bold tracking-tight bg-gradient-to-r from-teal-400 to-blue-500 bg-clip-text text-transparent">OKF MD Master</h1>
<p class="text-xs text-gray-500 mt-1">Autonomer Knowledge Architect · Open Knowledge Format</p>
</div>
<div class="flex items-center space-x-4">
<div class="text-right">
<div class="flex items-center space-x-2">
<span class="flex h-2.5 w-2.5 relative">
<span class="animate-ping absolute inline-flex h-full w-full rounded-full ${!status.paused ? 'bg-green-400' : 'bg-yellow-400'} opacity-75"></span>
<span class="relative inline-flex rounded-full h-2.5 w-2.5 ${!status.paused ? 'bg-green-500' : 'bg-yellow-500'}"></span>
</span>
<span class="text-xs font-medium text-gray-400">${status.paused ? 'Pausiert' : 'Aktiv'}</span>
</div>
<p class="text-xs text-gray-500">IDLE ${idleStatus.idleSeconds}s · CPU ${cpuLoad}%</p>
${activeSessions.length > 0 ? `<p class="text-xs text-gray-600 mt-1">👤 ${activeSessions.map(s => s.ip + ' (' + s.since + 'min)').join(' · ')}</p>` : ''}
</div>
<a href="/connect" class="text-xs text-green-400 hover:text-green-300 transition mr-3">🌐 Network</a><a href="/social" class="text-xs text-pink-400 hover:text-pink-300 transition mr-3">📱 Social</a><a href="/chat" class="text-xs text-purple-400 hover:text-purple-300 transition mr-3">💬 Chat</a><a href="/library" class="text-xs text-teal-400 hover:text-teal-300 transition mr-3">🗂 Library</a><button onclick="installPWA()" id="installBtn" class="text-xs bg-teal-900/50 text-teal-300 px-2 py-1 rounded border border-teal-800 hover:bg-teal-800/50 mr-3 hidden">📲 Installieren</button>${userDisplay}<a href="/logout" class="text-xs text-gray-600 hover:text-red-400 transition ml-3">Logout</a>
<script>setTimeout(()=>{if(deferredPrompt)document.getElementById('installBtn').classList.remove('hidden')},2000);</script>
</div>
<div class="flex space-x-2 mt-3">
${status.paused
  ? '<button onclick="fetch(\'/api/scheduler/resume\',{method:\'POST\'}).then(()=>location.reload())" class="text-xs bg-green-900/50 text-green-300 px-3 py-1 rounded border border-green-800 hover:bg-green-800/50">▶ Fortsetzen</button>'
  : '<button onclick="fetch(\'/api/scheduler/pause\',{method:\'POST\'}).then(()=>location.reload())" class="text-xs bg-yellow-900/50 text-yellow-300 px-3 py-1 rounded border border-yellow-800 hover:bg-yellow-800/50">⏸ Pause</button>'
}
<button onclick="fetch('/api/scout/scan',{method:'POST'}).then(r=>r.json()).then(d=>{alert('Scout: '+d.discovered+' Dateien gefunden')})" class="text-xs bg-blue-900/50 text-blue-300 px-3 py-1 rounded border border-blue-800 hover:bg-blue-800/50">🔍 Scout</button>
<button onclick="fetch('/api/architect/process',{method:'POST'}).then(r=>r.json()).then(d=>{alert('Architect: '+d.processed+' Skills erstellt')})" class="text-xs bg-teal-900/50 text-teal-300 px-3 py-1 rounded border border-teal-800 hover:bg-teal-800/50">🤖 Verarbeiten</button>
<a href="/api/knowledge" class="text-xs bg-purple-900/50 text-purple-300 px-3 py-1 rounded border border-purple-800 hover:bg-purple-800/50 no-underline">🧠 Knowledge Bundle</a>
</div>
</header>

<div class="bg-gradient-to-r from-amber-900/30 via-purple-900/30 to-teal-900/30 border border-amber-800/50 rounded-xl p-4 mb-6">
<div class="flex items-center justify-between">
<div>
<span class="text-amber-400 font-bold text-sm">🚀 WikiLLM</span>
<span class="text-gray-400 text-xs ml-2">— Das neue schnelle Open-Source Modell für OKF</span>
<p class="text-gray-500 text-xs mt-1">🔗 <a href="https://wikillm.org" target="_blank" class="text-teal-400 hover:text-teal-300">wikillm.org</a> · Weitere Modelle folgen in Kürze</p>
</div>
<span class="text-xs bg-amber-900/50 text-amber-300 px-3 py-1 rounded-full border border-amber-700">NEU</span>
</div>
</div>

<div class="bg-gray-900 p-5 rounded-xl border border-gray-800 mb-6">
<div class="flex justify-between items-center mb-4">
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider">📊 Server-Report · SOLL / IST / MAX</h2>
<button onclick="loadReport()" class="text-xs text-gray-600 hover:text-teal-400">↻ Aktualisieren</button>
</div>
<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
<div class="relative"><canvas id="chartCpu" height="160"></canvas><span class="absolute inset-0 flex items-center justify-center text-xs text-gray-500 pointer-events-none" id="cpuLabel">CPU</span></div>
<div class="relative"><canvas id="chartRam" height="160"></canvas><span class="absolute inset-0 flex items-center justify-center text-xs text-gray-500 pointer-events-none" id="ramLabel">RAM</span></div>
<div class="relative"><canvas id="chartDisk" height="160"></canvas><span class="absolute inset-0 flex items-center justify-center text-xs text-gray-500 pointer-events-none" id="diskLabel">Disk</span></div>
</div>
<div id="reportSummary" class="text-xs text-gray-500 mt-3 text-right"></div>
</div>

<div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
<div class="bg-gray-900 p-3 rounded-xl border border-gray-800"><p class="text-gray-500 text-xs uppercase">OKF Skills</p><p class="text-2xl font-bold text-teal-400">${skillCount}</p></div>
<div class="bg-gray-900 p-3 rounded-xl border border-gray-800"><p class="text-gray-500 text-xs uppercase">Gesamt</p><p class="text-2xl font-bold text-blue-400">${status.stats.total}</p></div>
<div class="bg-gray-900 p-3 rounded-xl border border-gray-800"><p class="text-gray-500 text-xs uppercase">Queue</p><p class="text-2xl font-bold text-purple-400">${status.discoveryQueueSize}</p></div>
<div class="bg-gray-900 p-3 rounded-xl border border-gray-800"><p class="text-gray-500 text-xs uppercase">Tokens</p><p class="text-2xl font-bold text-amber-400">${(tokens / 1000).toFixed(1)}K</p></div>
<div class="bg-gray-900 p-3 rounded-xl border border-gray-800"><p class="text-gray-500 text-xs uppercase">Lernmaterial</p><p class="text-2xl font-bold text-amber-400">${status.stats.lessons_learned || 0}</p></div>
</div>

<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
<div class="bg-gray-900 p-5 rounded-xl border border-gray-800">
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Aktive Agenten</h2>
<div class="space-y-3">
${agentCard('Watcher', '👁️', 'blue', true, 'Überwacht: ' + (cfg.watchDirs || ['-']).map(d => path.basename(d)).join(', '), null)}
${agentCard('Auto-Scanner', '🔎', 'indigo', status.running, (activity['auto-scanner'] ? activity['auto-scanner'].action + ': ' + (activity['auto-scanner'].detail || '') : 'Sucht alle 5min automatisch'), null)}
${agentCard('Scout', '🕵️', 'teal', true, (activity['scout'] ? activity['scout'].action + ': ' + (activity['scout'].detail || '') : 'Kopiert .md-Dateien'), cfg.model)}
${agentCard('Architect', '🤖', 'green', true, (activity['architect'] ? activity['architect'].action + ': ' + (activity['architect'].detail || '') : 'Transformiert via LLM'), cfg.model + (cfg.fallbackModel ? ' → ' + cfg.fallbackModel : ''))}
${agentCard('Scheduler', '⏱️', 'purple', status.running, (activity['scheduler'] ? activity['scheduler'].action : 'Poll: 10s') + ' · Idle: ≥' + cfg.idleThresholdSec + 's · CPU < ' + cfg.cpuThresholdPct + '%', null)}
${agentCard('Telegram Bot', '📱', 'blue', hasTelegram, hasTelegram ? 'Chat-ID: ' + (process.env.ALLOWED_CHAT_ID || '-') : 'Deaktiviert', null)}
${agentCard('Tray App', '🖥️', 'gray', true, 'Windows Taskleiste', null)}
</div>
</div>

<div class="bg-gray-900 p-5 rounded-xl border border-gray-800">
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">System</h2>
<table class="w-full text-xs">
<tbody class="divide-y divide-gray-800">
<tr><td class="py-1.5 text-gray-500">LLM Primary</td><td class="py-1.5 font-mono text-green-400">${cfg.model || '-'}</td></tr>
<tr><td class="py-1.5 text-gray-500">LLM Fallback</td><td class="py-1.5 font-mono text-green-400/70">${cfg.fallbackModel || '-'}</td></tr>
<tr><td class="py-1.5 text-gray-500">Max Tokens</td><td class="py-1.5 text-gray-300">${cfg.maxTokens}</td></tr>
<tr><td class="py-1.5 text-gray-500">Max Dateigröße</td><td class="py-1.5 text-gray-300">${Math.round((cfg.maxFileSize || 50000) / 1024)} KB</td></tr>
<tr><td class="py-1.5 text-gray-500">Watch Dirs</td><td class="py-1.5 font-mono text-blue-300 text-xs">${(cfg.watchDirs || []).join(', ')}</td></tr>
<tr><td class="py-1.5 text-gray-500">DeepSeek</td><td class="py-1.5 font-mono ${process.env.DEEPSEEK_API_KEY ? 'text-green-400' : 'text-red-400'} text-xs">${process.env.DEEPSEEK_API_KEY ? 'sk-...' + process.env.DEEPSEEK_API_KEY.slice(-4) : '—'}</td></tr>
<tr><td class="py-1.5 text-gray-500">OpenRouter</td><td class="py-1.5 font-mono ${process.env.OPENROUTER_API_KEY ? 'text-green-400' : 'text-red-400'} text-xs">${process.env.OPENROUTER_API_KEY ? 'sk-or-...' + process.env.OPENROUTER_API_KEY.slice(-4) : '—'}</td></tr>
<tr><td class="py-1.5 text-gray-500">Port</td><td class="py-1.5 text-gray-300">${PORT}</td></tr>
<tr><td class="py-1.5 text-gray-500">Session</td><td class="py-1.5 text-gray-500">8h gültig</td></tr>
</tbody></table>
</div>
</div>

<div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
<div class="bg-gray-900 p-5 rounded-xl border border-gray-800">
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">📥 Upload .md-Datei</h2>
<form id="uploadForm" class="space-y-2">
<div id="dropZone" class="border-2 border-dashed border-gray-700 rounded-lg p-6 text-center hover:border-teal-600 transition cursor-pointer"
  ondragover="this.classList.add('border-teal-500');event.preventDefault()"
  ondragleave="this.classList.remove('border-teal-500')"
  ondrop="this.classList.remove('border-teal-500');event.preventDefault();uploadFile(event.dataTransfer.files[0])"
  onclick="document.getElementById('fileInput').click()">
<p class="text-gray-500 text-sm">📄 .md-Datei ablegen</p>
<p class="text-gray-600 text-xs mt-1">oder klicken</p>
</div>
<input type="file" id="fileInput" accept=".md" onchange="uploadFile(this.files[0])" class="hidden">
</form>
<p id="uploadMsg" class="text-xs mt-2 text-gray-600"></p>
<div class="mt-3 pt-3 border-t border-gray-800">
<p class="text-xs text-gray-500 mb-2">🌐 URL oder GitHub-Repo</p>
<div class="flex space-x-2">
<input id="urlInput" type="text" placeholder="https://..." class="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-xs focus:outline-none focus:border-teal-500">
<button onclick="fetchUrl()" class="text-xs bg-teal-900/50 text-teal-300 px-3 py-1 rounded border border-teal-800 hover:bg-teal-800/50">Holen</button>
</div>
<p id="fetchMsg" class="text-xs mt-1 text-gray-600"></p>
</div>
</div>

<div class="bg-gray-900 p-5 rounded-xl border border-gray-800">
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">🔍 Laptop durchsuchen</h2>
<p class="text-xs text-gray-600 mb-3">Findet .md-Dateien in Documents, Desktop, Downloads. Zur Freigabe.</p>
<button onclick="scanLaptop()" id="scanBtn" class="text-xs bg-indigo-900/50 text-indigo-300 px-3 py-2 rounded border border-indigo-800 hover:bg-indigo-800/50 w-full">💻 Suchen</button>
<div id="scanResults" class="mt-3 text-xs text-gray-500 max-h-36 overflow-y-auto space-y-1"></div>
</div>

<div class="bg-gray-900 p-5 rounded-xl border border-gray-800">
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">💚 System Health</h2>
<div id="healthDisplay" class="text-xs space-y-1 text-gray-400"><p>Lade...</p></div>
<button onclick="checkHealth()" class="text-xs text-gray-600 hover:text-teal-400 mt-2">↻ Aktualisieren</button>
</div>
</div>

<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
<div class="bg-gray-900 p-5 rounded-xl border border-gray-800">
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">📁 Verzeichnisbaum / data</h2>
<div class="font-mono text-sm space-y-1">
${treeData.filter(t => !t.parent).map(root => `
<div class="text-teal-300 mb-2">${root.icon} <span class="font-bold">${root.name}/</span></div>
${treeData.filter(t => t.parent === root.name).map(child => {
  const color = child.name === 'okf_ready' ? 'text-green-400' : child.name === 'failed' ? 'text-yellow-400' : child.name === 'lessons-learned' ? 'text-amber-400' : 'text-gray-400';
  return `<div class="ml-5 flex justify-between"><span class="${color}">├─ ${child.icon} ${child.name}/</span><span class="text-gray-600">${child.count} Dateien</span></div>`;
}).join('')}
`).join('')}
<div class="ml-5 text-gray-600">└─ 📋 index.md</div>
</div>
</div>

<div class="bg-gray-900 p-5 rounded-xl border border-gray-800">
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">🏷️ Kategorien</h2>
${categoryTree.length === 0 ? '<p class="text-gray-600 italic text-sm">—</p>' : ''}
<div class="space-y-2 max-h-64 overflow-y-auto">
${categoryTree.map(cat => `
<div class="bg-gray-800/50 rounded-lg border border-gray-700/50 p-3">
<div class="flex justify-between items-center mb-2">
<span class="font-semibold text-teal-300 text-sm">🏷️ ${cat.category}</span>
<span class="text-xs bg-gray-800 px-2 py-0.5 rounded text-gray-500">${cat.count}</span>
</div>
<div class="space-y-1.5">
${cat.files.slice(0, 5).map(f => okfCard(f.name, f.description, f.tags, f.date)).join('')}
${cat.count > 5 ? `<p class="text-xs text-gray-600 italic pl-1">+ ${cat.count - 5} weitere</p>` : ''}
</div>
</div>
`).join('')}
</div>
</div>
</div>

<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
<div class="lg:col-span-1 bg-gray-900 p-5 rounded-xl border border-gray-800">
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">📋 Eingangsjournal</h2>
${journalEntries.length === 0 ? '<p class="text-gray-600 italic text-xs">Noch keine Eintraege.</p>' : ''}
<div class="text-xs space-y-1.5 max-h-48 overflow-y-auto">
${journalEntries.map(e => `<div class="border-b border-gray-800/50 pb-1"><span class="text-gray-500">${(e.at || '').substring(11)}</span> <span class="text-teal-300">${e.filename}</span><br><span class="text-gray-600">${e.source} → ${e.action}</span></div>`).join('')}
</div>
</div>

<div class="lg:col-span-2 bg-gray-900 p-5 rounded-xl border border-gray-800">
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Letzte Aktivitaeten</h2>
<table class="w-full text-xs">
<thead><tr class="text-gray-500 uppercase border-b border-gray-800"><th class="py-2 px-2 text-left">Datei</th><th class="py-2 px-2 text-left">Status</th><th class="py-2 px-2 text-left">Zuletzt</th></tr></thead>
<tbody class="divide-y divide-gray-800/50">
${recentActivity.length === 0 ? '<tr><td colspan="3" class="py-4 text-center text-gray-600 italic">Keine Aktivitäten</td></tr>' : ''}
${recentActivity.map(e => {
const lastStage = Object.keys(e.stages || {}).pop();
const lastTime = e.stages?.[lastStage]?.at?.substring(0, 16) || '';
return `<tr class="hover:bg-gray-800/30"><td class="py-2 px-2 font-medium text-gray-300">${e.id}</td><td class="py-2 px-2"><span class="px-1.5 py-0.5 text-xs rounded border ${statusBadge(e.status)}">${e.status}</span></td><td class="py-2 px-2 text-gray-600">${lastTime}</td></tr>`;
}).join('')}
</tbody></table>
</div>
</div>

</div>
<script>
function uploadFile(file){if(!file)return;document.getElementById('uploadMsg').innerHTML='⏳...';const fd=new FormData();fd.append('file',file);fetch('/api/upload',{method:'POST',body:fd}).then(r=>r.json()).then(d=>{document.getElementById('uploadMsg').innerHTML=d.ok?'✅ <b>'+d.filename+'</b> ('+d.size+' Bytes)':'❌ '+d.error}).catch(()=>document.getElementById('uploadMsg').innerHTML='❌ Fehler')}
function scanLaptop(){const btn=document.getElementById('scanBtn');btn.disabled=true;btn.innerHTML='⏳...';fetch('/api/scan/laptop').then(r=>r.json()).then(d=>{btn.disabled=false;btn.innerHTML='💻 Suchen';const div=document.getElementById('scanResults');if(!d.files||!d.files.length){div.innerHTML='<p class=text-gray-600>Keine .md-Dateien gefunden.</p>';return}div.innerHTML=d.files.map(f=>'<div class=flex.justify-between.items-center.py-1.border-b.border-gray-800><span class=truncate.mr-2>'+f.dir+'/'+f.name+'</span><span class=text-gray-600.mr-2>'+(f.size/1024).toFixed(1)+'KB</span><button onclick=approvePath(\''+f.path+'\') class=text-teal-400>+</button></div>').join('')}).catch(()=>{btn.disabled=false;btn.innerHTML='💻 Suchen'})}
function approvePath(dir){fetch('/api/scan/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:dir})}).then(r=>r.json()).then(d=>{if(d.ok)alert('✅ Pfad hinzugefuegt: '+d.watchDirs.join(', '));else alert('❌ Fehler')})}
function checkHealth(){fetch('/api/health').then(r=>r.json()).then(h=>{document.getElementById('healthDisplay').innerHTML='<p>Scheduler: '+(h.scheduler?'🟢':'🔴')+'</p><p>LLM: '+(h.llm?'🟢':'🔴')+'</p><p>Memory: '+(h.memory?h.memory.used:'?')+'</p><p>Uptime: '+Math.round(h.uptime/60)+'min</p><p class='+(h.allOk?'text-green-400':'text-yellow-400')+'>'+(h.allOk?'✅ Alles OK':'⚠️ Probleme')+'</p>'})}
function fetchUrl(){const u=document.getElementById('urlInput').value.trim();if(!u)return;document.getElementById('fetchMsg').innerHTML='⏳...';fetch('/api/fetch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:u})}).then(r=>r.json()).then(d=>{document.getElementById('fetchMsg').innerHTML=d.ok?'✅ '+(d.type||'')+' '+d.filename+' ('+d.size+' Bytes)':'❌ '+d.error})}
let gauges={};
function loadReport(){fetch('/api/report').then(r=>r.json()).then(r=>{const m=r.metrics;['cpu','ram','disk'].forEach(k=>{const d=m[k];const color=d.status==='under'?'#10b981':d.status==='ok'?'#06b6d4':d.status==='warn'?'#f59e0b':'#ef4444';const rem=100-d.bar;const id='chart'+k.charAt(0).toUpperCase()+k.slice(1);if(gauges[k]){gauges[k].data.datasets[0].data=[d.bar,rem];gauges[k].data.datasets[0].backgroundColor=[color,'#1f2937'];gauges[k].update()}else{const ctx=document.getElementById(id);if(!ctx)return;gauges[k]=new Chart(ctx,{type:'doughnut',data:{datasets:[{data:[d.bar,rem],backgroundColor:[color,'#1f2937'],borderWidth:0,borderRadius:[4,0]}]},options:{cutout:'75%',responsive:true,maintainAspectRatio:true,plugins:{legend:{display:false},tooltip:{enabled:false}}}})}document.getElementById(k+'Label').innerHTML='<span class=text-lg.font-bold style=color:'+color+'>'+d.ist+(d.unit||'%')+'</span><br><span class=text-gray-500>SOLL '+d.soll+(d.unit||'%')+' | MAX '+d.max+(d.unit||'%')+'</span>'});document.getElementById('reportSummary').innerHTML='<span class=font-mono>Uptime '+m.uptime.formatted+' · RSS '+m.process.rss+' · '+('disk'===m.disk?'Disk '+m.disk.free+' frei':'')+'</span>'})}
checkHealth();
loadReport();
</script></body></html>`);
});

app.get('/api/status', (req, res) => {
  res.json({
    scheduler: scheduler.getStatus(),
    idle: isIdle(),
    cpu: getCpuLoad(),
    tokens: architect.getTokenEstimate(),
    config: config.get()
  });
});

function startServer() {
  app.listen(PORT, () => {
    console.log('🚀 Dashboard: http://localhost:' + PORT);
  });
}

app.post('/api/scheduler/pause', (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Nicht eingeloggt' });
  scheduler.pause();
  res.json({ ok: true, paused: true });
});

app.post('/api/scheduler/resume', (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Nicht eingeloggt' });
  scheduler.resume();
  res.json({ ok: true, paused: false });
});

app.post('/api/scout/scan', (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Nicht eingeloggt' });
  const scout = require('./core/scout');
  const results = scout.scanForKnowledge(config.get().watchDirs[0] || path.join(__dirname, '../mock_documents'));
  results.forEach(r => addJournalEntry('scan', r.filename, 'scouted', r.originalPath));
  res.json({ ok: true, discovered: results.length, files: results.map(r => r.filename) });
});

app.post('/api/architect/process', (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Nicht eingeloggt' });
  architect.processAll().then(results => {
    results.forEach(r => addJournalEntry('architect', r.filename, 'okf_created', r.model + ' ' + (r.tokens || '') + ' tokens'));
    res.json({ ok: true, processed: results.length, skills: results.map(r => r.skillName) });
  }).catch(err => {
    res.status(500).json({ error: err.message });
  });
});

function getAllSkills() {
  const skills = [];
  const dirs = ['okf_ready', 'lessons-learned', 'failed', 'processed'];
  dirs.forEach(sub => {
    const dirPath = path.join(DATA_DIR, sub);
    if (!fs.existsSync(dirPath)) return;
    fs.readdirSync(dirPath).filter(f => f.endsWith('.md')).forEach(f => {
      try {
        const raw = fs.readFileSync(path.join(dirPath, f), 'utf8');
        const parsed = matter(raw);
        const stat = fs.statSync(path.join(dirPath, f));
        skills.push({
          file: f,
          dir: sub,
          name: parsed.data.name || f.replace('.md', ''),
          type: parsed.data.type || 'skill',
          description: parsed.data.description || '',
          tags: parsed.data.tags || [],
          version: parsed.data.version || '1.0.0',
          model: parsed.data.model || '-',
          size: stat.size,
          modified: stat.mtime.toISOString().substring(0, 16).replace('T', ' ')
        });
      } catch {}
    });
  });
  return skills;
}

app.get('/api/library', (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Nicht eingeloggt' });
  res.json(getAllSkills());
});

app.get('/library', (req, res) => {
  if (!isLoggedIn(req)) return res.redirect('/login');
  const skills = getAllSkills();
  const allTags = [...new Set(skills.flatMap(s => s.tags))].sort();

  res.send(`<!DOCTYPE html><html lang="de" class="dark"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>OKF Library</title>
<script src="https://cdn.tailwindcss.com"></script><script>tailwind.config={darkMode:'class'}</script>
</head><body class="bg-gray-950 text-gray-100 font-sans min-h-screen">
<div class="container mx-auto px-4 py-6 max-w-7xl">

<header class="flex justify-between items-center border-b border-gray-800 pb-5 mb-6">
<div>
<h1 class="text-2xl font-bold tracking-tight bg-gradient-to-r from-teal-400 to-blue-500 bg-clip-text text-transparent">OKF Library</h1>
<p class="text-xs text-gray-500 mt-1">${skills.length} Skills · ${allTags.length} Kategorien</p>
</div>
<div class="flex items-center space-x-3">
<a href="/" class="text-xs text-teal-400 hover:text-teal-300 transition">← Dashboard</a>
<a href="/logout" class="text-xs text-gray-600 hover:text-red-400 transition">Logout</a>
</div>
</header>

<div class="bg-gray-900 p-4 rounded-xl border border-gray-800 mb-6 flex flex-wrap gap-3 items-center">
<input id="search" type="text" placeholder="Suche nach Name, Tag, Beschreibung..." class="flex-1 min-w-[200px] bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-100 focus:outline-none focus:border-teal-500" oninput="filter()">
<select id="tagFilter" class="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none" onchange="filter()">
<option value="">Alle Kategorien</option>
${allTags.map(t => `<option value="${t}">${t}</option>`).join('')}
</select>
<select id="sortBy" class="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none" onchange="filter()">
<option value="name">Name A-Z</option>
<option value="date">Neueste</option>
<option value="tags">Kategorie</option>
<option value="size">Groesse</option>
</select>
<select id="dirFilter" class="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none" onchange="filter()">
<option value="">Alle Ordner</option>
<option value="okf_ready">✅ OKF Ready</option>
<option value="lessons-learned">📚 Lessons</option>
<option value="failed">⚠️ Failed</option>
<option value="processed">📦 Processed</option>
</select>
</div>

<div id="grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"></div>

</div>
<script>
const skills = ${JSON.stringify(skills)};
const dirIcons = {okf_ready:'✅', 'lessons-learned':'📚', failed:'⚠️', processed:'📦'};

function render(items) {
  const grid = document.getElementById('grid');
  grid.innerHTML = items.map(s => \`
<div class="bg-gray-900 rounded-xl border border-gray-800 p-4 hover:border-gray-700 transition group">
  <div class="flex justify-between items-start mb-2">
    <span class="font-bold text-teal-300 text-sm truncate flex-1">\${s.name}</span>
    <span class="text-xs text-gray-600 ml-2 whitespace-nowrap">\${dirIcons[s.dir] || ''}</span>
  </div>
  <p class="text-xs text-gray-500 line-clamp-2 mb-3">\${s.description || 'Keine Beschreibung'}</p>
  <div class="flex flex-wrap gap-1 mb-3">
    \${s.tags.map(t => \`<span class="text-xs bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded cursor-pointer hover:bg-teal-900/50 hover:text-teal-300" onclick="document.getElementById('tagFilter').value='\${t}';filter()">\${t}</span>\`).join('')}
  </div>
  <div class="flex justify-between items-center text-xs text-gray-600 border-t border-gray-800 pt-2">
    <span>\${s.dir}</span>
    <span>\${s.modified}</span>
    <span>\${(s.size/1024).toFixed(1)} KB</span>
    \${s.model !== '-' ? '<span class="font-mono text-gray-500">🤖 '+s.model.split('/').pop().substring(0,20)+'</span>' : ''}
  </div>
</div>\`).join('');
}

function filter() {
  const q = document.getElementById('search').value.toLowerCase();
  const tag = document.getElementById('tagFilter').value;
  const dir = document.getElementById('dirFilter').value;
  const sort = document.getElementById('sortBy').value;

  let filtered = skills.filter(s => {
    if (q && !s.name.toLowerCase().includes(q) && !s.description.toLowerCase().includes(q) && !s.tags.some(t=>t.toLowerCase().includes(q))) return false;
    if (tag && !s.tags.includes(tag)) return false;
    if (dir && s.dir !== dir) return false;
    return true;
  });

  if (sort === 'name') filtered.sort((a,b) => a.name.localeCompare(b.name));
  else if (sort === 'date') filtered.sort((a,b) => b.modified.localeCompare(a.modified));
  else if (sort === 'tags') filtered.sort((a,b) => (a.tags[0]||'').localeCompare(b.tags[0]||''));
  else if (sort === 'size') filtered.sort((a,b) => b.size - a.size);

  render(filtered);
}

render(skills);
</script>
</body></html>`);
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Nicht eingeloggt' });
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' });
  addJournalEntry('upload', req.file.originalname, 'uploaded', req.file.size + ' Bytes');
  res.json({ ok: true, filename: req.file.originalname, size: req.file.size });
});

app.get('/api/scan/laptop', (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Nicht eingeloggt' });
  const searchRoots = [
    os.homedir() + '/Documents', os.homedir() + '/Desktop',
    os.homedir() + '/Downloads', os.homedir() + '/OneDrive',
    'C:/Users'
  ];
  const found = [];
  searchRoots.forEach(root => {
    try {
      if (!fs.existsSync(root)) return;
      walk(root, 2);
    } catch {}
  });
  function walk(dir, depth) {
    if (depth < 0) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      entries.forEach(e => {
        if (e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('node_modules')) walk(path.join(dir, e.name), depth - 1);
        else if (e.isFile() && e.name.endsWith('.md')) found.push(path.join(dir, e.name));
      });
    } catch {}
  }
  const results = found.slice(0, 30).map(f => ({
    path: f,
    dir: path.dirname(f).split(path.sep).slice(-2).join('/'),
    name: path.basename(f),
    size: fs.statSync(f).size
  }));
  res.json({ ok: true, found: results.length, files: results });
});

app.post('/api/scan/approve', express.json(), (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Nicht eingeloggt' });
  const dirPath = req.body.path;
  if (!dirPath || !fs.existsSync(dirPath)) return res.status(400).json({ error: 'Pfad existiert nicht' });
  const cfg = config.get();
  const dirs = [...(cfg.watchDirs || [])];
  if (!dirs.includes(dirPath)) {
    dirs.push(dirPath);
    config.update({ watchDirs: dirs });
    addJournalEntry('scan-approve', path.basename(dirPath), 'watch-added', dirPath);
  }
  res.json({ ok: true, watchDirs: dirs });
});

app.get('/api/health', (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Nicht eingeloggt' });
  checkHealth().then(h => res.json(h));
});

app.get('/api/journal', (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Nicht eingeloggt' });
  const entries = loadJournal();
  res.json(entries.slice(-20));
});

app.get('/api/knowledge', (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Nicht eingeloggt' });
  const skills = getAllSkills().filter(s => s.dir === 'okf_ready' && s.description);
  const bundle = skills.map(s => {
    const raw = fs.readFileSync(path.join(DATA_DIR, s.dir, s.file), 'utf8');
    return raw;
  }).join('\n\n---\n\n');
  res.set('Content-Type', 'text/markdown; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="okf-knowledge-bundle.md"');
  res.send(`# OKF Knowledge Bundle\n> ${skills.length} Skills · Generiert ${new Date().toLocaleDateString('de-DE')}\n\n---\n\n${bundle}`);
});

app.get('/api/knowledge/context', (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Nicht eingeloggt' });
  const skills = getAllSkills().filter(s => s.dir === 'okf_ready');
  const context = skills.map(s =>
    `## ${s.name}\n**Tags:** ${s.tags.join(', ')}\n**Typ:** ${s.type}\n\n${s.description}\n`
  ).join('\n');
  res.json({ ok: true, count: skills.length, context, usage: 'Diesen context-Teil als System-Prompt oder RAG-Kontext verwenden.' });
});

app.post('/api/fetch', express.json(), async (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Nicht eingeloggt' });
  const url = req.body.url;
  if (!url || !url.startsWith('http')) return res.status(400).json({ error: 'Ungueltige URL' });

  if (url.includes('github.com')) {
    try {
      const parts = url.replace('https://github.com/', '').split('/');
      const owner = parts[0]; const repo = parts[1].replace('.git', '');
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`;
      const { data } = await axios.get(rawUrl, { timeout: 15000, headers: { 'User-Agent': 'OKF-MD-Master' } });
      const filename = `${owner}-${repo}-README.md`;
      const filePath = path.join(UPLOADS_DIR, filename);
      fs.writeFileSync(filePath, `# Quelle: ${url}\n# GitHub: ${owner}/${repo}\n\n${data}`);
      addJournalEntry('github', filename, 'repo-to-md', url);
      res.json({ ok: true, filename, size: fs.statSync(filePath).size, path: filePath, type: 'github' });
    } catch (e) {
      try {
        const parts = url.replace('https://github.com/', '').split('/');
        const owner = parts[0]; const repo = parts[1].replace('.git', '');
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/master/README.md`;
        const { data } = await axios.get(rawUrl, { timeout: 15000, headers: { 'User-Agent': 'OKF-MD-Master' } });
        const filename = `${owner}-${repo}-README.md`;
        const filePath = path.join(UPLOADS_DIR, filename);
        fs.writeFileSync(filePath, `# Quelle: ${url}\n# GitHub: ${owner}/${repo}\n\n${data}`);
        addJournalEntry('github', filename, 'repo-to-md', url);
        res.json({ ok: true, filename, size: fs.statSync(filePath).size, path: filePath, type: 'github' });
      } catch (e2) {
        res.status(500).json({ error: 'GitHub repo nicht lesbar: ' + e2.message });
      }
    }
    return;
  }

  try {
    const { data } = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': 'OKF-MD-Master/2.0' } });
    const td = new Turndown();
    const md = td.turndown(data);
    const filename = (url.replace(/https?:\/\//, '').replace(/[\/:?&=]/g, '_').substring(0, 60)) + '.md';
    const filePath = path.join(UPLOADS_DIR, filename);
    fs.writeFileSync(filePath, `# Quelle: ${url}\n\n${md}`);
    addJournalEntry('url-fetch', filename, 'web-to-md', url);
    res.json({ ok: true, filename, size: fs.statSync(filePath).size, path: filePath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/chat', express.json(), async (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Nicht eingeloggt' });
  const { question, history } = req.body;
  if (!question) return res.status(400).json({ error: 'Keine Frage' });
  try {
    const result = await skillAgent.ask(question, history || []);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/chat', (req, res) => {
  if (!isLoggedIn(req)) return res.redirect('/login');
  const skills = skillAgent.getKnowledgeSummary();
  res.send(`<!DOCTYPE html><html lang="de" class="dark"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>OKF Skill Agent</title>
<script src="https://cdn.tailwindcss.com"></script><script>tailwind.config={darkMode:'class'}</script>
</head><body class="bg-gray-950 text-gray-100 font-sans min-h-screen">
<div class="container mx-auto px-4 py-6 max-w-4xl">
<header class="flex justify-between items-center border-b border-gray-800 pb-5 mb-6">
<div>
<h1 class="text-xl font-bold bg-gradient-to-r from-teal-400 to-blue-500 bg-clip-text text-transparent">OKF Skill Agent</h1>
<p class="text-xs text-gray-500 mt-1">${skills.length} Skills geladen · Wissensbasierter Chat</p>
</div>
<div class="flex space-x-3">
<a href="/" class="text-xs text-teal-400 hover:text-teal-300">← Dashboard</a>
<a href="/logout" class="text-xs text-gray-600 hover:text-red-400">Logout</a>
</div>
</header>

<div class="bg-gray-900 rounded-xl border border-gray-800 p-4 mb-4 max-h-96 overflow-y-auto" id="chatHistory">
<p class="text-gray-600 text-sm text-center">Stelle eine Frage zu deinem OKF-Wissen.</p>
</div>

<div class="flex space-x-2">
<input id="question" type="text" placeholder="Frage stellen..." class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-teal-500" onkeydown="if(event.key==='Enter')ask()">
<button onclick="ask()" class="bg-teal-600 hover:bg-teal-500 text-white font-semibold px-6 py-3 rounded-lg transition text-sm">Senden</button>
</div>

<div id="skillsInfo" class="mt-4 text-xs text-gray-600">
${skills.length > 0 ? '<details class=cursor-pointer><summary class=text-teal-400>Verfuegbare Skills ('+skills.length+')</summary><div class=mt-2 space-y-1>' + skills.map(s => '<div class=bg-gray-900.p-2.rounded.border.border-gray-800><span class=text-teal-300>'+s.name+'</span><span class=text-gray-500.ml-2>'+s.tags.join(' ')+'</span></div>').join('') + '</div></details>' : ''}
</div>
</div>
<script>
let history=[];
function ask(){
  const q=document.getElementById('question').value.trim();
  if(!q)return;
  const div=document.getElementById('chatHistory');
  div.innerHTML+='<div class=mb-3><span class=text-blue-400.font-bold>Du:</span><p class=text-gray-300.ml-4>'+q+'</p></div>';
  document.getElementById('question').value='';
  div.innerHTML+='<div class=mb-3><span class=text-teal-400.font-bold>Agent:</span><p class=text-gray-300.ml-4>⏳ Denke nach...</p></div>';
  div.scrollTop=div.scrollHeight;
  fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q,history})})
    .then(r=>r.json()).then(d=>{
      div.lastChild.remove();
      const answer=d.answer||d.error;
      div.innerHTML+='<div class=mb-3><span class=text-teal-400.font-bold>Agent:</span><p class=text-gray-300.ml-4>'+answer.replace(/\\n/g,'<br>')+'</p><p class=text-xs.text-gray-600.ml-4>'+d.model+' · '+(d.tokens||0)+' tokens · '+d.skillCount+' skills</p></div>';
      history.push({role:'user',content:q},{role:'assistant',content:answer});
      if(history.length>10)history=history.slice(-10);
      div.scrollTop=div.scrollHeight;
    }).catch(e=>{div.lastChild.remove();div.innerHTML+='<div class=mb-3><span class=text-red-400>Fehler:</span><p class=text-gray-300.ml-4>'+e.message+'</p></div>'});
}
</script></body></html>`);
});

app.get('/api/social/skills', (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Nicht eingeloggt' });
  res.json(social.loadSkills());
});

app.post('/api/social/generate', express.json(), async (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Nicht eingeloggt' });
  try {
    const result = await social.generateAll(req.body.skillFile);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/social/log', express.json(), (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Nicht eingeloggt' });
  const entry = social.logPost(req.body);
  res.json({ ok: true, total: entry.length });
});

app.get('/social', (req, res) => {
  if (!isLoggedIn(req)) return res.redirect('/login');
  const skills = social.loadSkills();
  const history = social.getPostedHistory().slice(-10).reverse();
  const platforms = social.PLATFORMS;

  res.send(`<!DOCTYPE html><html lang="de" class="dark"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Social Media Manager</title>
<script src="https://cdn.tailwindcss.com"></script><script>tailwind.config={darkMode:'class'}</script>
</head><body class="bg-gray-950 text-gray-100 font-sans min-h-screen">
<div class="container mx-auto px-4 py-6 max-w-6xl">
<header class="flex justify-between items-center border-b border-gray-800 pb-5 mb-6">
<div>
<h1 class="text-xl font-bold bg-gradient-to-r from-pink-400 to-purple-500 bg-clip-text text-transparent">Social Media Manager</h1>
<p class="text-xs text-gray-500 mt-1">OKF Skills → Posts fuer ${Object.keys(platforms).length} Plattformen</p>
</div>
<div class="flex space-x-3">
<a href="/" class="text-xs text-teal-400 hover:text-teal-300">← Dashboard</a>
<a href="/logout" class="text-xs text-gray-600 hover:text-red-400">Logout</a>
</div>
</header>

<div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
<div class="lg:col-span-1 bg-gray-900 p-4 rounded-xl border border-gray-800">
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Skills</h2>
<div class="space-y-1 max-h-96 overflow-y-auto">
${skills.length === 0 ? '<p class="text-gray-600 text-xs">Keine Skills</p>' : ''}
${skills.map(s => `<div class="bg-gray-800/50 rounded border border-gray-700/50 p-2 cursor-pointer hover:border-teal-700" onclick="document.getElementById('skill-select').value='${s.file}';document.getElementById('skill-label').innerHTML='<b>${s.name}</b><br><span class=text-gray-500>${s.tags.join(' ')}</span>'"><span class="text-teal-300 text-xs">${s.name}</span></div>`).join('')}
</div>
</div>

<div class="lg:col-span-3 space-y-4">
<div class="bg-gray-900 p-4 rounded-xl border border-gray-800">
<input type="hidden" id="skill-select" value="${skills[0]?.file || ''}">
<div id="skill-label" class="text-sm mb-3">${skills[0] ? '<b>'+skills[0].name+'</b><br><span class=text-gray-500>'+skills[0].tags.join(' ')+'</span>' : 'Keine Skills'}</div>
<button onclick="generatePosts()" id="genBtn" class="text-sm bg-gradient-to-r from-pink-600 to-purple-600 text-white px-6 py-2 rounded-lg hover:from-pink-500 hover:to-purple-500 transition">🚀 Posts generieren</button>
<span id="genStatus" class="text-xs text-gray-500 ml-3"></span>
</div>

<div id="postsArea" class="grid grid-cols-1 md:grid-cols-2 gap-4">
${Object.entries(platforms).map(([key, p]) => `
<div class="bg-gray-900 rounded-xl border border-gray-800 p-4">
<div class="flex justify-between items-center mb-2">
<span class="font-bold text-sm">${p.name}</span>
<span class="text-xs text-gray-600">${p.maxChars} Zeichen max</span>
</div>
<textarea id="post-${key}" class="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-xs text-gray-300 h-32 resize-none focus:outline-none focus:border-pink-600" placeholder="Post erscheint hier..."></textarea>
<div class="flex justify-between mt-2">
<span class="text-xs text-gray-600" id="count-${key}">0 Zeichen</span>
<button onclick="copyPost('${key}')" class="text-xs bg-gray-800 text-gray-400 px-3 py-1 rounded border border-gray-700 hover:bg-gray-700">📋 Kopieren</button>
</div>
</div>
`).join('')}
</div>

${history.length > 0 ? `
<div class="bg-gray-900 p-4 rounded-xl border border-gray-800 mt-4">
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Verlauf</h2>
${history.map(h => `<div class="text-xs border-b border-gray-800 py-1"><span class=text-gray-500>${h.posted?.substring(0,16)||''}</span> <span class=text-pink-400>${h.platformName}</span> → ${h.skillName?.substring(0,30)}</div>`).join('')}
</div>` : ''}

</div></div>

<script>
const platforms=${JSON.stringify(platforms)};
async function generatePosts(){
  const file=document.getElementById('skill-select').value;
  if(!file)return;
  document.getElementById('genBtn').disabled=true;
  document.getElementById('genStatus').innerHTML='⏳ Generiere...';
  try{
    const r=await fetch('/api/social/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({skillFile:file})});
    const d=await r.json();
    if(d.posts)d.posts.forEach(p=>{
      const ta=document.getElementById('post-'+p.platform);
      if(ta){ta.value=p.text;document.getElementById('count-'+p.platform).innerHTML=p.text.length+' Zeichen'}
    });
    document.getElementById('genStatus').innerHTML='✅ Fertig';
  }catch(e){document.getElementById('genStatus').innerHTML='❌ '+e.message}
  document.getElementById('genBtn').disabled=false;
}
function copyPost(platform){
  const ta=document.getElementById('post-'+platform);
  ta.select();navigator.clipboard.writeText(ta.value);
  fetch('/api/social/log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({platform,platformName:platforms[platform]?.name,skillName:document.getElementById('skill-select').value,text:ta.value})});
}
</script></body></html>`);
});

app.get('/api/report', (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Nicht eingeloggt' });
  res.json(monitor.getReport());
});

app.post('/api/sync', express.json(), async (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Nicht eingeloggt' });
  const { owner, repo } = req.body;
  if (!owner || !repo) return res.status(400).json({ error: 'owner und repo erforderlich' });
  try {
    const state = await sync.fullSync(owner, repo);
    res.json({ ok: true, ...state });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/sync/state', (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Nicht eingeloggt' });
  res.json(sync.getSyncState() || { connected: false });
});

app.get('/connect', (req, res) => {
  if (!isLoggedIn(req)) return res.redirect('/login');
  const state = sync.getSyncState();
  const log = sync.getSyncLog().slice(-5).reverse();

  res.send(`<!DOCTYPE html><html lang="de" class="dark"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>OKF Network</title>
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config={darkMode:'class'}</script>
</head><body class="bg-gray-950 text-gray-100 font-sans min-h-screen">
<div class="container mx-auto px-4 py-6 max-w-4xl">
<header class="flex justify-between items-center border-b border-gray-800 pb-5 mb-6">
<div>
<h1 class="text-xl font-bold bg-gradient-to-r from-green-400 to-teal-500 bg-clip-text text-transparent">OKF Network · P2P Sync</h1>
<p class="text-xs text-gray-500 mt-1">Verteiltes Rechnen über GitHub — Skills teilen & Nodes verbinden</p>
</div>
<a href="/" class="text-xs text-teal-400 hover:text-teal-300">← Dashboard</a>
</header>

<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
<div class="bg-gray-900 p-5 rounded-xl border border-gray-800">
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">🔗 GitHub Repo verbinden</h2>
<p class="text-xs text-gray-600 mb-3">Skills werden automatisch zwischen Nodes synchronisiert.</p>
<input id="syncOwner" placeholder="Owner (z.B. ThaiJenspacito)" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm mb-2">
<input id="syncRepo" placeholder="Repo (z.B. OKF_MD_Master)" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm mb-3">
<button onclick="doSync()" class="text-sm bg-gradient-to-r from-green-600 to-teal-600 text-white px-6 py-2 rounded-lg hover:from-green-500 hover:to-teal-500 transition">🔄 Sync starten</button>
<span id="syncStatus" class="text-xs text-gray-500 ml-3"></span>
</div>

<div class="bg-gray-900 p-5 rounded-xl border border-gray-800">
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">🌐 Verbundene Nodes</h2>
<div id="contributors"></div>
</div>
</div>

<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
<div class="bg-gray-900 p-5 rounded-xl border border-gray-800">
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">📊 Sync-Status</h2>
<div id="syncState"><p class="text-gray-600 text-xs">Keine Verbindung. Repo oben eintragen.</p></div>
</div>

<div class="bg-gray-900 p-5 rounded-xl border border-gray-800">
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">📋 Letzte Syncs</h2>
<div id="syncLog" class="text-xs text-gray-500 space-y-1">
${log.length === 0 ? '<p>Keine Syncs.</p>' : ''}
${log.map(l => '<div class=border-b.border-gray-800.py-1><span class=text-gray-600>'+l.at.substring(0,16)+'</span> '+l.action+' <span class=text-teal-400>'+l.changed+'</span> Skills</div>').join('')}
</div>
</div>
</div>

</div>
<script>
async function doSync(){
  const o=document.getElementById('syncOwner').value.trim();
  const r=document.getElementById('syncRepo').value.trim();
  if(!o||!r)return;
  document.getElementById('syncStatus').innerHTML='⏳ Syncing...';
  try{
    const res=await fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:o,repo:r})});
    const d=await res.json();
    document.getElementById('syncStatus').innerHTML='✅ Pull: '+d.pull.pulled+' ('+d.pull.new+' neu) · Push: '+d.push.pushed+' Skills';
    showState(d);
  }catch(e){document.getElementById('syncStatus').innerHTML='❌ '+e.message}
}
function showState(d){
  document.getElementById('syncState').innerHTML='<div class=text-sm><span class=text-teal-300>'+d.repo+'</span><br><span class=text-gray-500>Sync: '+d.lastSync+'</span><br><span class=text-gray-400>Pull: '+d.pull.pulled+' | Push: '+d.push.pushed+'</span><br>'+('⭐ '+d.repoInfo?.stars||'')+' 🍴 '+d.repoInfo?.forks||''+'</div>';
  if(d.contributors?.length){
    document.getElementById('contributors').innerHTML=d.contributors.map(c=>'<div class=flex.items-center.space-x-2.py-1><span class=text-teal-300>'+c.login+'</span><span class=text-gray-600>'+c.contributions+' contributions</span></div>').join('')
  }
}
</script></body></html>`);
});

if (require.main === module) startServer();

module.exports = { app, startServer };
