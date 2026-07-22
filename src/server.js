const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
require('dotenv').config();

const tracker = require('./state/tracker');
const scheduler = require('./core/scheduler');
const config = require('./state/config');
const { isIdle, getCpuLoad } = require('./core/idle-detector');
const architect = require('./core/architect');

const app = express();
const PORT = process.env.PORT || 5000;
const ADMIN_PIN = process.env.ADMIN_PIN || '180473';

app.use(cookieParser());

const DATA_DIR = path.join(__dirname, '../data');
const INDEX_FILE = path.join(DATA_DIR, 'index.md');
const SYSTEM_LOG = path.join(__dirname, '../logs/system.log');
const OKF_READY_DIR = path.join(DATA_DIR, 'okf_ready');

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
  res.send(`<!DOCTYPE html><html lang="de" class="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>OKF Login</title><script src="https://cdn.tailwindcss.com"></script><script>tailwind.config={darkMode:'class'}</script></head><body class="bg-gray-950 min-h-screen flex items-center justify-center"><div class="bg-gray-900 p-8 rounded-2xl border border-gray-800 w-full max-w-sm shadow-2xl"><div class="text-center mb-6"><h1 class="text-2xl font-bold bg-gradient-to-r from-teal-400 to-blue-500 bg-clip-text text-transparent">OKF MD Master</h1><p class="text-gray-500 text-sm mt-1">Admin-Login</p></div><form method="POST" action="/login"><input type="password" name="pin" placeholder="PIN" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-gray-100 text-center text-lg tracking-widest focus:outline-none focus:border-teal-500 mb-4" maxlength="8" autofocus><button class="w-full bg-teal-600 hover:bg-teal-500 text-white font-semibold py-3 rounded-lg transition">Anmelden</button></form></div></body></html>`);
});

app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  if (req.body.pin !== ADMIN_PIN) {
    return res.send(`<!DOCTYPE html><html lang="de" class="dark"><head><meta charset="UTF-8"><title>OKF Login</title><script src="https://cdn.tailwindcss.com"></script></head><body class="bg-gray-950 min-h-screen flex items-center justify-center"><div class="text-center"><p class="text-red-400 text-lg mb-4">Falsche PIN</p><a href="/login" class="text-teal-400 hover:underline">Erneut versuchen</a></div></body></html>`);
  }
  const sid = crypto.randomBytes(16).toString('hex');
  sessions[sid] = { created: Date.now() };
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

  res.send(`<!DOCTYPE html><html lang="de" class="dark"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>OKF MD Master</title>
<script src="https://cdn.tailwindcss.com"></script><script>tailwind.config={darkMode:'class'}</script>
<meta http-equiv="refresh" content="30">
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
</div>
<a href="/library" class="text-xs text-teal-400 hover:text-teal-300 transition mr-3">🗂 Library</a><a href="/logout" class="text-xs text-gray-600 hover:text-red-400 transition">Logout</a>
</div>
<div class="flex space-x-2 mt-3">
${status.paused
  ? '<button onclick="fetch(\'/api/scheduler/resume\',{method:\'POST\'}).then(()=>location.reload())" class="text-xs bg-green-900/50 text-green-300 px-3 py-1 rounded border border-green-800 hover:bg-green-800/50">▶ Fortsetzen</button>'
  : '<button onclick="fetch(\'/api/scheduler/pause\',{method:\'POST\'}).then(()=>location.reload())" class="text-xs bg-yellow-900/50 text-yellow-300 px-3 py-1 rounded border border-yellow-800 hover:bg-yellow-800/50">⏸ Pause</button>'
}
<button onclick="fetch('/api/scout/scan',{method:'POST'}).then(r=>r.json()).then(d=>{alert('Scout: '+d.discovered+' Dateien gefunden')})" class="text-xs bg-blue-900/50 text-blue-300 px-3 py-1 rounded border border-blue-800 hover:bg-blue-800/50">🔍 Scout</button>
<button onclick="fetch('/api/architect/process',{method:'POST'}).then(r=>r.json()).then(d=>{alert('Architect: '+d.processed+' Skills erstellt')})" class="text-xs bg-teal-900/50 text-teal-300 px-3 py-1 rounded border border-teal-800 hover:bg-teal-800/50">🤖 Verarbeiten</button>
</div>
</header>

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
${agentCard('Scout', '🕵️', 'indigo', true, 'Kopiert .md-Dateien, filtert nach Größe', cfg.model)}
${agentCard('Architect', '🤖', 'teal', true, 'Transformiert via LLM ins OKF-Format', cfg.model + (cfg.fallbackModel ? ' → ' + cfg.fallbackModel : ''))}
${agentCard('Scheduler', '⏱️', 'purple', status.running, 'Poll: 10s · Idle: ≥${cfg.idleThresholdSec}s · CPU < ${cfg.cpuThresholdPct}% · Batch: 5', null)}
${agentCard('Telegram Bot', '📱', 'blue', hasTelegram, hasTelegram ? 'Chat-ID: ' + (process.env.ALLOWED_CHAT_ID || '-') : 'Token nicht konfiguriert', null)}
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
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Alle Skills</h2>
${skills.length === 0 ? '<p class="text-gray-600 italic text-sm">—</p>' : ''}
<ul class="space-y-1.5">
${skills.map(s => `<li class="text-sm"><span class="font-medium text-teal-300">${s.name}</span><span class="text-xs text-gray-600 block">${s.date}</span></li>`).join('')}
</ul>
</div>

<div class="lg:col-span-2 bg-gray-900 p-5 rounded-xl border border-gray-800">
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Letzte Aktivitäten</h2>
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

</div></body></html>`);
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
  res.json({ ok: true, discovered: results.length, files: results.map(r => r.filename) });
});

app.post('/api/architect/process', (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Nicht eingeloggt' });
  architect.processAll().then(results => {
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

if (require.main === module) startServer();

module.exports = { app, startServer };
