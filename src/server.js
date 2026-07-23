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
const credits = require('./core/credits');

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
    else cb(new Error('Only .md files allowed'));
  }
});

const DOWNLOADS_FILE = path.join(DATA_DIR, 'downloads.json');

function trackDownload(skillFile) {
  const dl = fs.existsSync(DOWNLOADS_FILE) ? JSON.parse(fs.readFileSync(DOWNLOADS_FILE, 'utf8')) : {};
  dl[skillFile] = (dl[skillFile] || 0) + 1;
  fs.writeFileSync(DOWNLOADS_FILE, JSON.stringify(dl, null, 2));
  return dl[skillFile];
}

function getDownloads() {
  if (!fs.existsSync(DOWNLOADS_FILE)) return {};
  return JSON.parse(fs.readFileSync(DOWNLOADS_FILE, 'utf8'));
}

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
  const dot = status ? 'ðŸŸ¢' : 'ðŸ”´';
  return `<div class="bg-gray-700/50 rounded-lg border border-gray-600/50 p-4 flex items-start space-x-3">
  <span class="text-2xl">${icon}</span>
  <div class="flex-1 min-w-0">
    <div class="flex justify-between items-center">
      <span class="font-bold text-${color}-300 text-sm">${name}</span>
      <span class="text-xs bg-${status ? 'green' : 'red'}-900/40 text-${status ? 'green' : 'red'}-300 px-2 py-0.5 rounded">${dot} ${status ? 'Active' : 'Inactive'}</span>
    </div>
    <p class="text-xs text-gray-400 mt-1">${detail}</p>
    ${model ? `<p class="text-xs font-mono text-gray-500 mt-1">ðŸ¤– ${model}</p>` : ''}
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
  const ghClientId = auth.GH_CLIENT_ID || '';

  res.send(`<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>OKF MD Master</title>
<link rel="icon" href="/icon.svg">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#0a0e17;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;overflow-x:hidden}
.bg-grid{position:fixed;inset:0;background-image:radial-gradient(circle at 1px 1px,#1e293b 1px,transparent 0);background-size:40px 40px;pointer-events:none}
.bg-glow{position:fixed;width:600px;height:600px;border-radius:50%;filter:blur(120px);opacity:.15;pointer-events:none}
.glow-1{top:-200px;left:-100px;background:#14b8a6}.glow-2{bottom:-200px;right:-100px;background:#3b82f6}.glow-3{top:50%;left:50%;transform:translate(-50%,-50%);background:#8b5cf6;width:400px;height:400px}
.container{max-width:480px;width:100%;padding:24px;position:relative;z-index:1}
.logo{text-align:center;margin-bottom:32px}
.logo h1{font-size:32px;background:linear-gradient(135deg,#14b8a6,#3b82f6,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-weight:800;letter-spacing:-.5px}
.logo p{color:#64748b;font-size:13px;margin-top:6px}
.features{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:28px}
.feat{background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:14px;text-align:center}.feat-icon{font-size:22px;margin-bottom:6px}.feat-title{font-size:12px;font-weight:600;color:#e2e8f0}.feat-desc{font-size:10px;color:#64748b;margin-top:4px;line-height:1.4}
.login-card{background:#0f172a;border:1px solid #1e293b;border-radius:14px;padding:24px}
.auth-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:12px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;transition:all .2s;text-decoration:none;border:none}
.auth-google{background:#fff;color:#1e293b}.auth-google:hover{background:#f1f5f9}
.auth-github{background:#24292f;color:#fff;margin-top:10px}.auth-github:hover{background:#2d363f}
.auth-github svg{width:18px;height:18px}
.divider{display:flex;align-items:center;margin:16px 0;gap:10px}.divider-line{flex:1;height:1px;background:#1e293b}.divider-text{color:#475569;font-size:11px}
.dev-btn{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;padding:12px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;background:#0f766e15;color:#14b8a6;border:1px solid #0f766e40;transition:all .2s}.dev-btn:hover{background:#0f766e25}
.pin-section{margin-top:10px;display:flex;gap:8px}.pin-section input{flex:1;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:10px 14px;color:#e2e8f0;font-size:13px;text-align:center;letter-spacing:4px}.pin-section input:focus{outline:none;border-color:#14b8a6}.pin-section button{background:#14b8a6;color:#fff;border:none;border-radius:8px;padding:10px 16px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}.pin-section button:hover{background:#0d9488}
.vision-quote{text-align:center;margin-top:32px;padding:20px;background:linear-gradient(135deg,#0f172a,#0c4a6e10);border-radius:14px;border:1px solid #1e293b}
.vision-quote p{color:#94a3b8;font-size:12px;line-height:1.6;font-style:italic}.vision-quote .author{color:#64748b;font-size:10px;margin-top:8px;font-style:normal}
.free-badge{display:inline-block;background:linear-gradient(135deg,#f59e0b,#ef4444);color:#fff;font-size:10px;padding:3px 8px;border-radius:20px;margin-bottom:12px;font-weight:700;letter-spacing:.5px}
</style>
</head><body>
<div class="bg-grid"></div>
<div class="bg-glow glow-1"></div>
<div class="bg-glow glow-2"></div>
<div class="bg-glow glow-3"></div>

<div class="container">
<div class="logo">
<div class="free-badge">FREE · FIRST 100 USERS</div>
<h1>OKF MD Master</h1>
<p>Autonomous Knowledge Pipeline · Open Knowledge Format</p>
</div>

<div class="features">
<div class="feat"><div class="feat-icon">🔄</div><div class="feat-title">Auto-Transform</div><div class="feat-desc">.md files to structured OKF skills automatically</div></div>
<div class="feat"><div class="feat-icon">🤖</div><div class="feat-title">AI-Powered</div><div class="feat-desc">DeepSeek, Gemini & Cohere via smart routing</div></div>
<div class="feat"><div class="feat-icon">🔗</div><div class="feat-title">P2P Network</div><div class="feat-desc">Share computing power, earn download credits</div></div>
<div class="feat"><div class="feat-icon">📱</div><div class="feat-title">Everywhere</div><div class="feat-desc">PWA on Android, iOS, Windows & macOS</div></div>
</div>

<div class="login-card">
${gClientId ? `
<div id="g_id_onload" data-client_id="${gClientId}" data-callback="onGoogleSignin" data-auto_prompt="false"></div>
<button class="auth-btn auth-google" onclick="document.querySelector('.g_id_signin div[role=button]').click()">
<svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
Continue with Google
</button>
<div class="g_id_signin" style="display:none" data-type="standard" data-theme="filled_black"></div>
<script src="https://accounts.google.com/gsi/client" async defer></script>
<script>function onGoogleSignin(r){fetch('/auth/google',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credential:r.credential})}).then(x=>x.json()).then(d=>{if(d.ok)location.href='/';else alert(d.error)})}</script>
` : ''}
${ghClientId ? `
<a href="/auth/github" class="auth-btn auth-github"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.605-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12z"/></svg>Continue with GitHub</a>
` : ''}
${(gClientId || ghClientId) ? '<div class="divider"><div class="divider-line"></div><span class="divider-text">or</span><div class="divider-line"></div></div>' : ''}

<a href="/auth/dev" class="dev-btn">⚡ Continue without password</a>
</div>

<div class="vision-quote">
<p>"Transform any text into structured, AI-ready knowledge — automatically, losslessly, and without a single line of code. Your knowledge base becomes the power source for every AI agent."</p>
<p class="author">— OKF MD Master · Open Knowledge Format</p>
</div>
</div>
</body></html>`);
});

app.get('/auth/dev', (req, res) => {
  const sid = crypto.randomBytes(16).toString('hex');
  sessions[sid] = { created: Date.now(), ip: req.ip || 'local', user: { email: 'dev@localhost', name: 'Developer', picture: null } };
  res.cookie('okf_session', sid, { httpOnly: true, maxAge: 8 * 3600000 });
  res.redirect('/');
});

app.post('/auth/google', express.json(), async (req, res) => {
  try {
    const payload = await auth.verifyGoogleToken(req.body.credential);
    const user = auth.getOrCreateUser(payload.email, payload.name, payload.picture);
    const sid = crypto.randomBytes(16).toString('hex');
    sessions[sid] = { created: Date.now(), ip: req.ip || 'local', user };
    res.cookie('okf_session', sid, { httpOnly: true, maxAge: 8 * 3600000 });
    res.json({ ok: true });
  } catch (e) { res.status(401).json({ error: e.message }); }
});

app.get('/auth/github', (req, res) => {
  const ghId = auth.GH_CLIENT_ID;
  if (!ghId) return res.redirect('/login');
  const redirect = `http://${req.get('host')}/auth/github/callback`;
  res.redirect(`https://github.com/login/oauth/authorize?client_id=${ghId}&redirect_uri=${redirect}&scope=user:email`);
});

app.get('/auth/github/callback', async (req, res) => {
  try {
    const token = await auth.getGitHubToken(req.query.code);
    const ghUser = await auth.getGitHubUser(token);
    const user = auth.getOrCreateUser(ghUser.email, ghUser.name, ghUser.picture, ghUser.login);
    const sid = crypto.randomBytes(16).toString('hex');
    sessions[sid] = { created: Date.now(), ip: req.ip || 'local', user };
    res.cookie('okf_session', sid, { httpOnly: true, maxAge: 8 * 3600000 });
    res.redirect('/');
  } catch (e) { res.redirect('/login?error=' + encodeURIComponent(e.message)); }
});

app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  if (req.body.pin !== ADMIN_PIN) {
    return res.send(`<!DOCTYPE html><html lang="en" class="dark"><head><meta charset="UTF-8"><title>OKF Login</title><script src="https://cdn.tailwindcss.com"></script></head><body class="bg-gray-950 min-h-screen flex items-center justify-center"><div class="text-center"><p class="text-red-400 text-lg mb-4">Wrong PIN</p><a href="/login" class="text-teal-400 hover:underline">Try again</a></div></body></html>`);
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
  res.sendFile(path.join(__dirname, '../public/index.html'));
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
    console.log('ðŸš€ Dashboard: http://localhost:' + PORT);
  });
}

app.post('/api/scheduler/pause', (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Not logged in' });
  scheduler.pause();
  res.json({ ok: true, paused: true });
});

app.post('/api/scheduler/resume', (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Not logged in' });
  scheduler.resume();
  res.json({ ok: true, paused: false });
});

app.post('/api/scout/scan', (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Not logged in' });
  const scout = require('./core/scout');
  const results = scout.scanForKnowledge(config.get().watchDirs[0] || path.join(__dirname, '../mock_documents'));
  results.forEach(r => addJournalEntry('scan', r.filename, 'scouted', r.originalPath));
  res.json({ ok: true, discovered: results.length, files: results.map(r => r.filename) });
});

app.post('/api/architect/process', (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Not logged in' });
  architect.processAll().then(results => {
    results.forEach(r => {
      addJournalEntry('architect', r.filename, 'okf_created', r.model + ' ' + (r.tokens || '') + ' tokens');
      const user = getUser(req);
      if (user && user.email) {
        credits.addProcessed(user.email, user.name, r.tokens || 1000, 1);
      }
    });
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
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Not logged in' });
  res.json(getAllSkills());
});

app.get('/library', (req, res) => {
  if (!isLoggedIn(req)) return res.redirect('/login');
  const skills = getAllSkills();
  const downloads = getDownloads();
  skills.forEach(s => { s.downloads = downloads[s.file] || 0; });
  const allTags = [...new Set(skills.flatMap(s => s.tags))].sort();

  res.send(`<!DOCTYPE html><html lang="en" class="dark"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>OKF Library</title>
<script src="https://cdn.tailwindcss.com"></script><script>tailwind.config={darkMode:'class'}</script>
</head><body class="bg-gray-950 text-gray-100 font-sans min-h-screen">
<div class="container mx-auto px-4 py-6 max-w-7xl">

<header class="flex justify-between items-center border-b border-gray-800 pb-5 mb-6">
<div>
<h1 class="text-2xl font-bold tracking-tight bg-gradient-to-r from-teal-400 to-blue-500 bg-clip-text text-transparent">OKF Library</h1>
<p class="text-xs text-gray-500 mt-1">${skills.length} Skills Â· ${allTags.length} Categories</p>
</div>
<div class="flex items-center space-x-3">
<a href="/" class="text-xs text-teal-400 hover:text-teal-300 transition">â† Dashboard</a>
<a href="/logout" class="text-xs text-gray-600 hover:text-red-400 transition">Logout</a>
</div>
</header>

<div class="bg-gray-900 p-4 rounded-xl border border-gray-800 mb-6 flex flex-wrap gap-3 items-center">
<input id="search" type="text" placeholder="Search by name, tag, description..." class="flex-1 min-w-[200px] bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-100 focus:outline-none focus:border-teal-500" oninput="filter()">
<select id="tagFilter" class="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none" onchange="filter()">
<option value="">All Categories</option>
${allTags.map(t => `<option value="${t}">${t}</option>`).join('')}
</select>
<select id="sortBy" class="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none" onchange="filter()">
<option value="name">Name A-Z</option>
<option value="date">Newest</option>
<option value="tags">Category</option>
<option value="size">Size</option>
</select>
<select id="dirFilter" class="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none" onchange="filter()">
<option value="">All Folders</option>
<option value="okf_ready">âœ… OKF Ready</option>
<option value="lessons-learned">ðŸ“š Lessons</option>
<option value="failed">âš ï¸ Failed</option>
<option value="processed">ðŸ“¦ Processed</option>
</select>
</div>

<div id="grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"></div>

</div>
<script>
const skills = ${JSON.stringify(skills)};
const dirIcons = {okf_ready:'âœ…', 'lessons-learned':'ðŸ“š', failed:'âš ï¸', processed:'ðŸ“¦'};

function render(items) {
  const grid = document.getElementById('grid');
  grid.innerHTML = items.map(s => \`
<div class="bg-gray-900 rounded-xl border border-gray-800 p-4 hover:border-gray-700 transition group">
  <div class="flex justify-between items-start mb-2">
    <span class="font-bold text-teal-300 text-sm truncate flex-1">\${s.name}</span>
    <span class="text-xs text-gray-600 ml-2 whitespace-nowrap">\${dirIcons[s.dir] || ''}</span>
  </div>
  <p class="text-xs text-gray-500 line-clamp-2 mb-3">\${s.description || 'No description'}</p>
  <div class="flex flex-wrap gap-1 mb-3">
    \${s.tags.map(t => \`<span class="text-xs bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded cursor-pointer hover:bg-teal-900/50 hover:text-teal-300" onclick="document.getElementById('tagFilter').value='\${t}';filter()">\${t}</span>\`).join('')}
  </div>
  <div class="flex justify-between items-center text-xs text-gray-600 border-t border-gray-800 pt-2">
    <span>\${s.dir}</span>
    <a href="/api/download/\${s.file}" class="text-teal-400 hover:text-teal-300" title="Download">â¬‡ \${s.downloads||0}</a>
    <span>\${(s.size/1024).toFixed(1)} KB</span>
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
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Not logged in' });
  if (!req.file) return res.status(400).json({ error: 'No file' });
  addJournalEntry('upload', req.file.originalname, 'uploaded', req.file.size + ' Bytes');
  res.json({ ok: true, filename: req.file.originalname, size: req.file.size });
});

app.get('/api/scan/laptop', (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Not logged in' });
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
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Not logged in' });
  const dirPath = req.body.path;
  if (!dirPath || !fs.existsSync(dirPath)) return res.status(400).json({ error: 'Path does not exist' });
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
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Not logged in' });
  checkHealth().then(h => res.json(h));
});

app.get('/api/journal', (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Not logged in' });
  const entries = loadJournal();
  res.json(entries.slice(-20));
});

app.get('/api/download/:file', (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Not logged in' });
  const file = req.params.file;
  const okfPath = path.join(OKF_READY_DIR, file);
  if (!fs.existsSync(okfPath)) return res.status(404).json({ error: 'Not found' });

  const user = getUser(req);
  if (user && user.email) {
    const check = credits.canDownload(user.email);
    if (!check.allowed) {
      return res.status(429).json({ error: 'Download limit reached. Process more files to earn credits.', credits: check.credits, limit: check.limit });
    }
    credits.trackDownload(user.email);
    credits.addCpuContribution(user.email, 1);
  }

  const count = trackDownload(file);
  res.set('Content-Type', 'text/markdown; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="' + file + '"');
  res.set('X-Download-Count', String(count));
  res.sendFile(okfPath);
});

app.get('/api/credits', (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Not logged in' });
  const user = getUser(req);
  const email = user ? user.email : 'anonymous';
  res.json(credits.getStats(email));
});

app.get('/api/credits/leaderboard', (req, res) => {
  res.json(credits.getLeaderboard());
});

app.post('/api/credits/earn', express.json(), (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Not logged in' });
  const user = getUser(req);
  const email = user ? user.email : 'anonymous';
  const name = user ? user.name : email;
  const result = credits.addProcessed(email, name, req.body.tokens || 0, req.body.files || 1);
  res.json(result);
});

app.post('/api/credits/settings', express.json(), (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Not logged in' });
  const user = getUser(req);
  if (!user || !user.email) return res.status(400).json({ error: 'Google login required' });
  const updated = credits.updateSettings(user.email, req.body);
  res.json({ ok: true, settings: updated.settings });
});

app.get('/settings', (req, res) => {
  if (!isLoggedIn(req)) return res.redirect('/login');
  const user = getUser(req);
  const email = user ? user.email : 'anonymous';
  const stats = credits.getStats(email);
  const leaderboard = credits.getLeaderboard();

  res.send(`<!DOCTYPE html><html lang="en" class="dark"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Settings Â· OKF MD Master</title>
<script src="https://cdn.tailwindcss.com"></script><script>tailwind.config={darkMode:'class'}</script>
</head><body class="bg-gray-950 text-gray-100 font-sans min-h-screen">
<div class="container mx-auto px-4 py-6 max-w-4xl">
<header class="flex justify-between items-center border-b border-gray-800 pb-5 mb-6">
<div>
<h1 class="text-xl font-bold bg-gradient-to-r from-teal-400 to-blue-500 bg-clip-text text-transparent">Settings</h1>
<p class="text-xs text-gray-500 mt-1">${user ? user.name || user.email : 'Guest'} Â· Power = Downloads</p>
</div>
<a href="/" class="text-xs text-teal-400 hover:text-teal-300">â† Dashboard</a>
</header>

<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
<div class="bg-gray-900 p-5 rounded-xl border border-gray-800">
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Your Contribution</h2>
<div class="grid grid-cols-2 gap-3 text-sm">
<div class="bg-gray-800 rounded-lg p-3"><p class="text-gray-500 text-xs">Files Processed</p><p class="text-teal-400 text-xl font-bold">${stats.user.filesProcessed || 0}</p></div>
<div class="bg-gray-800 rounded-lg p-3"><p class="text-gray-500 text-xs">Tokens Processed</p><p class="text-blue-400 text-xl font-bold">${(stats.user.tokensProcessed || 0).toLocaleString()}</p></div>
<div class="bg-gray-800 rounded-lg p-3"><p class="text-gray-500 text-xs">Credits Earned</p><p class="text-green-400 text-xl font-bold">${stats.user.credits || 0}</p></div>
<div class="bg-gray-800 rounded-lg p-3"><p class="text-gray-500 text-xs">CPU Time</p><p class="text-purple-400 text-xl font-bold">${(stats.user.cpuContribution || 0).toFixed(1)}h</p></div>
</div>
<div class="mt-4 bg-gray-800 rounded-lg p-3">
<p class="text-xs text-gray-500 mb-2">Download Limit</p>
<div class="bg-gray-700 rounded-full h-3"><div class="bg-gradient-to-r from-teal-500 to-blue-500 h-3 rounded-full transition-all" style="width:${Math.min(100, ((stats.canDownload.limit - stats.canDownload.remaining) / stats.canDownload.limit) * 100)}%"></div></div>
<p class="text-xs text-gray-400 mt-1">${stats.canDownload.remaining} of ${stats.canDownload.limit} downloads remaining</p>
</div>
</div>

<div class="bg-gray-900 p-5 rounded-xl border border-gray-800">
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Contribution Settings</h2>
<form onsubmit="saveSettings(event)" class="space-y-3 text-sm">
<label class="flex items-center justify-between"><span class="text-gray-400">Share CPU Power</span><input type="checkbox" id="sharePower" ${stats.user.settings.sharePower ? 'checked' : ''} class="accent-teal-500"></label>
<label class="flex items-center justify-between"><span class="text-gray-400">Auto-Process Files</span><input type="checkbox" id="autoProcess" ${stats.user.settings.autoProcess ? 'checked' : ''} class="accent-teal-500"></label>
<div class="flex items-center justify-between"><span class="text-gray-400">Max Downloads</span><input type="number" id="maxDownloads" value="${stats.user.settings.maxDownloads || 50}" min="10" max="500" class="bg-gray-800 border border-gray-700 rounded px-3 py-1 w-20 text-center text-gray-100"></div>
<button class="bg-teal-600 hover:bg-teal-500 text-white text-sm px-4 py-2 rounded-lg transition">Save Settings</button>
<p id="settingsMsg" class="text-xs text-gray-500"></p>
</form>
</div>
</div>

<div class="bg-gray-900 p-5 rounded-xl border border-gray-800 mb-6">
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Leaderboard</h2>
<table class="w-full text-xs">
<thead><tr class="text-gray-500 uppercase border-b border-gray-800"><th class="py-2 px-2 text-left">#</th><th class="py-2 px-2 text-left">User</th><th class="py-2 px-2 text-right">Credits</th><th class="py-2 px-2 text-right">Files</th><th class="py-2 px-2 text-right">Tokens</th><th class="py-2 px-2 text-right">CPU</th></tr></thead>
<tbody class="divide-y divide-gray-800/50">
${leaderboard.map((e, i) => `<tr class="hover:bg-gray-800/30"><td class="py-1.5 px-2 text-gray-500">${i + 1}</td><td class="py-1.5 px-2 text-teal-300">${e.name || e.email}</td><td class="py-1.5 px-2 text-right text-green-400">${e.credits}</td><td class="py-1.5 px-2 text-right text-gray-400">${e.files}</td><td class="py-1.5 px-2 text-right text-gray-500">${e.tokens.toLocaleString()}</td><td class="py-1.5 px-2 text-right text-gray-600">${e.cpu}</td></tr>`).join('')}
</tbody></table>
</div>

</div>
<script>
async function saveSettings(e){e.preventDefault();const s={sharePower:document.getElementById('sharePower').checked,autoProcess:document.getElementById('autoProcess').checked,maxDownloads:parseInt(document.getElementById('maxDownloads').value)};const r=await fetch('/api/credits/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)});const d=await r.json();document.getElementById('settingsMsg').innerHTML=d.ok?'âœ… Settings saved':'âŒ Error'}</script>
</body></html>`);
});

app.get('/api/knowledge', (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Not logged in' });
  const skills = getAllSkills().filter(s => s.dir === 'okf_ready' && s.description);
  const bundle = skills.map(s => {
    const raw = fs.readFileSync(path.join(DATA_DIR, s.dir, s.file), 'utf8');
    return raw;
  }).join('\n\n---\n\n');
  res.set('Content-Type', 'text/markdown; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="okf-knowledge-bundle.md"');
  res.send(`# OKF Knowledge Bundle\n> ${skills.length} Skills Â· Generated ${new Date().toLocaleDateString('en-US')}\n\n---\n\n${bundle}`);
});

app.get('/api/knowledge/context', (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Not logged in' });
  const skills = getAllSkills().filter(s => s.dir === 'okf_ready');
  const context = skills.map(s =>
    `## ${s.name}\n**Tags:** ${s.tags.join(', ')}\n**Typ:** ${s.type}\n\n${s.description}\n`
  ).join('\n');
  res.json({ ok: true, count: skills.length, context, usage: 'Use this context as system prompt or RAG context.' });
});

app.post('/api/fetch', express.json(), async (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Not logged in' });
  const url = req.body.url;
  if (!url || !url.startsWith('http')) return res.status(400).json({ error: 'Invalid URL' });

  if (url.includes('github.com')) {
    try {
      const parts = url.replace('https://github.com/', '').split('/');
      const owner = parts[0]; const repo = parts[1].replace('.git', '');
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`;
      const { data } = await axios.get(rawUrl, { timeout: 15000, headers: { 'User-Agent': 'OKF-MD-Master' } });
      const filename = `${owner}-${repo}-README.md`;
      const filePath = path.join(UPLOADS_DIR, filename);
      fs.writeFileSync(filePath, `# Source: ${url}\n# GitHub: ${owner}/${repo}\n\n${data}`);
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
        fs.writeFileSync(filePath, `# Source: ${url}\n# GitHub: ${owner}/${repo}\n\n${data}`);
        addJournalEntry('github', filename, 'repo-to-md', url);
        res.json({ ok: true, filename, size: fs.statSync(filePath).size, path: filePath, type: 'github' });
      } catch (e2) {
        res.status(500).json({ error: 'GitHub repo not readable: ' + e2.message });
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
    fs.writeFileSync(filePath, `# Source: ${url}\n\n${md}`);
    addJournalEntry('url-fetch', filename, 'web-to-md', url);
    res.json({ ok: true, filename, size: fs.statSync(filePath).size, path: filePath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/chat', express.json(), async (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Not logged in' });
  const { question, history } = req.body;
  if (!question) return res.status(400).json({ error: 'No question' });
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
  res.send(`<!DOCTYPE html><html lang="en" class="dark"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>OKF Skill Agent</title>
<script src="https://cdn.tailwindcss.com"></script><script>tailwind.config={darkMode:'class'}</script>
</head><body class="bg-gray-950 text-gray-100 font-sans min-h-screen">
<div class="container mx-auto px-4 py-6 max-w-4xl">
<header class="flex justify-between items-center border-b border-gray-800 pb-5 mb-6">
<div>
<h1 class="text-xl font-bold bg-gradient-to-r from-teal-400 to-blue-500 bg-clip-text text-transparent">OKF Skill Agent</h1>
<p class="text-xs text-gray-500 mt-1">${skills.length} Skills loaded Â· Knowledge-based Chat</p>
</div>
<div class="flex space-x-3">
<a href="/" class="text-xs text-teal-400 hover:text-teal-300">â† Dashboard</a>
<a href="/logout" class="text-xs text-gray-600 hover:text-red-400">Logout</a>
</div>
</header>

<div class="bg-gray-900 rounded-xl border border-gray-800 p-4 mb-4 max-h-96 overflow-y-auto" id="chatHistory">
<p class="text-gray-600 text-sm text-center">Ask a question about your OKF knowledge.</p>
</div>

<div class="flex space-x-2">
<input id="question" type="text" placeholder="Ask a question..." class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-teal-500" onkeydown="if(event.key==='Enter')ask()">
<button onclick="ask()" class="bg-teal-600 hover:bg-teal-500 text-white font-semibold px-6 py-3 rounded-lg transition text-sm">Send</button>
</div>

<div id="skillsInfo" class="mt-4 text-xs text-gray-600">
${skills.length > 0 ? '<details class=cursor-pointer><summary class=text-teal-400>Available Skills ('+skills.length+')</summary><div class=mt-2 space-y-1>' + skills.map(s => '<div class=bg-gray-900.p-2.rounded.border.border-gray-800><span class=text-teal-300>'+s.name+'</span><span class=text-gray-500.ml-2>'+s.tags.join(' ')+'</span></div>').join('') + '</div></details>' : ''}
</div>
</div>
<script>
let history=[];
function ask(){
  const q=document.getElementById('question').value.trim();
  if(!q)return;
  const div=document.getElementById('chatHistory');
  div.innerHTML+='<div class=mb-3><span class=text-blue-400.font-bold>You:</span><p class=text-gray-300.ml-4>'+q+'</p></div>';
  document.getElementById('question').value='';
  div.innerHTML+='<div class=mb-3><span class=text-teal-400.font-bold>Agent:</span><p class=text-gray-300.ml-4>â³ Thinking...</p></div>';
  div.scrollTop=div.scrollHeight;
  fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q,history})})
    .then(r=>r.json()).then(d=>{
      div.lastChild.remove();
      const answer=d.answer||d.error;
      div.innerHTML+='<div class=mb-3><span class=text-teal-400.font-bold>Agent:</span><p class=text-gray-300.ml-4>'+answer.replace(/\\n/g,'<br>')+'</p><p class=text-xs.text-gray-600.ml-4>'+d.model+' Â· '+(d.tokens||0)+' tokens Â· '+d.skillCount+' skills</p></div>';
      history.push({role:'user',content:q},{role:'assistant',content:answer});
      if(history.length>10)history=history.slice(-10);
      div.scrollTop=div.scrollHeight;
    }).catch(e=>{div.lastChild.remove();div.innerHTML+='<div class=mb-3><span class=text-red-400>Error:</span><p class=text-gray-300.ml-4>'+e.message+'</p></div>'});
}
</script></body></html>`);
});

app.get('/api/social/skills', (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Not logged in' });
  res.json(social.loadSkills());
});

app.post('/api/social/generate', express.json(), async (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Not logged in' });
  try {
    const result = await social.generateAll(req.body.skillFile);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/social/log', express.json(), (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Not logged in' });
  const entry = social.logPost(req.body);
  res.json({ ok: true, total: entry.length });
});

app.get('/social', (req, res) => {
  if (!isLoggedIn(req)) return res.redirect('/login');
  const skills = social.loadSkills();
  const history = social.getPostedHistory().slice(-10).reverse();
  const platforms = social.PLATFORMS;

  res.send(`<!DOCTYPE html><html lang="en" class="dark"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Social Media Manager</title>
<script src="https://cdn.tailwindcss.com"></script><script>tailwind.config={darkMode:'class'}</script>
</head><body class="bg-gray-950 text-gray-100 font-sans min-h-screen">
<div class="container mx-auto px-4 py-6 max-w-6xl">
<header class="flex justify-between items-center border-b border-gray-800 pb-5 mb-6">
<div>
<h1 class="text-xl font-bold bg-gradient-to-r from-pink-400 to-purple-500 bg-clip-text text-transparent">Social Media Manager</h1>
<p class="text-xs text-gray-500 mt-1">OKF Skills â†’ Posts for ${Object.keys(platforms).length} platforms</p>
</div>
<div class="flex space-x-3">
<a href="/" class="text-xs text-teal-400 hover:text-teal-300">â† Dashboard</a>
<a href="/logout" class="text-xs text-gray-600 hover:text-red-400">Logout</a>
</div>
</header>

<div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
<div class="lg:col-span-1 bg-gray-900 p-4 rounded-xl border border-gray-800">
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Skills</h2>
<div class="space-y-1 max-h-96 overflow-y-auto">
${skills.length === 0 ? '<p class="text-gray-600 text-xs">No Skills</p>' : ''}
${skills.map(s => `<div class="bg-gray-800/50 rounded border border-gray-700/50 p-2 cursor-pointer hover:border-teal-700" onclick="document.getElementById('skill-select').value='${s.file}';document.getElementById('skill-label').innerHTML='<b>${s.name}</b><br><span class=text-gray-500>${s.tags.join(' ')}</span>'"><span class="text-teal-300 text-xs">${s.name}</span></div>`).join('')}
</div>
</div>

<div class="lg:col-span-3 space-y-4">
<div class="bg-gray-900 p-4 rounded-xl border border-gray-800">
<input type="hidden" id="skill-select" value="${skills[0]?.file || ''}">
<div id="skill-label" class="text-sm mb-3">${skills[0] ? '<b>'+skills[0].name+'</b><br><span class=text-gray-500>'+skills[0].tags.join(' ')+'</span>' : 'No Skills'}</div>
<button onclick="generatePosts()" id="genBtn" class="text-sm bg-gradient-to-r from-pink-600 to-purple-600 text-white px-6 py-2 rounded-lg hover:from-pink-500 hover:to-purple-500 transition">ðŸš€ Generate Posts</button>
<span id="genStatus" class="text-xs text-gray-500 ml-3"></span>
</div>

<div id="postsArea" class="grid grid-cols-1 md:grid-cols-2 gap-4">
${Object.entries(platforms).map(([key, p]) => `
<div class="bg-gray-900 rounded-xl border border-gray-800 p-4">
<div class="flex justify-between items-center mb-2">
<span class="font-bold text-sm">${p.name}</span>
<span class="text-xs text-gray-600">${p.maxChars} chars max</span>
</div>
<textarea id="post-${key}" class="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-xs text-gray-300 h-32 resize-none focus:outline-none focus:border-pink-600" placeholder="Post appears here..."></textarea>
<div class="flex justify-between mt-2">
<span class="text-xs text-gray-600" id="count-${key}">0 chars</span>
<button onclick="copyPost('${key}')" class="text-xs bg-gray-800 text-gray-400 px-3 py-1 rounded border border-gray-700 hover:bg-gray-700">ðŸ“‹ Copy</button>
</div>
</div>
`).join('')}
</div>

${history.length > 0 ? `
<div class="bg-gray-900 p-4 rounded-xl border border-gray-800 mt-4">
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">History</h2>
${history.map(h => `<div class="text-xs border-b border-gray-800 py-1"><span class=text-gray-500>${h.posted?.substring(0,16)||''}</span> <span class=text-pink-400>${h.platformName}</span> â†’ ${h.skillName?.substring(0,30)}</div>`).join('')}
</div>` : ''}

</div></div>

<script>
const platforms=${JSON.stringify(platforms)};
async function generatePosts(){
  const file=document.getElementById('skill-select').value;
  if(!file)return;
  document.getElementById('genBtn').disabled=true;
  document.getElementById('genStatus').innerHTML='â³ Generating...';
  try{
    const r=await fetch('/api/social/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({skillFile:file})});
    const d=await r.json();
    if(d.posts)d.posts.forEach(p=>{
      const ta=document.getElementById('post-'+p.platform);
      if(ta){ta.value=p.text;document.getElementById('count-'+p.platform).innerHTML=p.text.length+' chars'}
    });
    document.getElementById('genStatus').innerHTML='âœ… Done';
  }catch(e){document.getElementById('genStatus').innerHTML='âŒ '+e.message}
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
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Not logged in' });
  res.json(monitor.getReport());
});

app.post('/api/sync', express.json(), async (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Not logged in' });
  const { owner, repo } = req.body;
  if (!owner || !repo) return res.status(400).json({ error: 'owner and repo required' });
  try {
    const state = await sync.fullSync(owner, repo);
    res.json({ ok: true, ...state });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/sync/state', (req, res) => {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Not logged in' });
  res.json(sync.getSyncState() || { connected: false });
});

app.get('/connect', (req, res) => {
  if (!isLoggedIn(req)) return res.redirect('/login');
  const state = sync.getSyncState();
  const log = sync.getSyncLog().slice(-5).reverse();

  res.send(`<!DOCTYPE html><html lang="en" class="dark"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>OKF Network</title>
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config={darkMode:'class'}</script>
</head><body class="bg-gray-950 text-gray-100 font-sans min-h-screen">
<div class="container mx-auto px-4 py-6 max-w-4xl">
<header class="flex justify-between items-center border-b border-gray-800 pb-5 mb-6">
<div>
<h1 class="text-xl font-bold bg-gradient-to-r from-green-400 to-teal-500 bg-clip-text text-transparent">OKF Network Â· P2P Sync</h1>
<p class="text-xs text-gray-500 mt-1">Distributed computing via GitHub â€” Share skills & connect nodes</p>
</div>
<a href="/" class="text-xs text-teal-400 hover:text-teal-300">â† Dashboard</a>
</header>

<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
<div class="bg-gray-900 p-5 rounded-xl border border-gray-800">
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">ðŸ”— Connect GitHub Repo</h2>
<p class="text-xs text-gray-600 mb-3">Skills auto-sync between nodes.</p>
<input id="syncOwner" placeholder="Owner (e.g. ThaiJenspacito)" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm mb-2">
<input id="syncRepo" placeholder="Repo (e.g. OKF_MD_Master)" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm mb-3">
<button onclick="doSync()" class="text-sm bg-gradient-to-r from-green-600 to-teal-600 text-white px-6 py-2 rounded-lg hover:from-green-500 hover:to-teal-500 transition">ðŸ”„ Start Sync</button>
<span id="syncStatus" class="text-xs text-gray-500 ml-3"></span>
</div>

<div class="bg-gray-900 p-5 rounded-xl border border-gray-800">
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">ðŸŒ Connected Nodes</h2>
<div id="contributors"></div>
</div>
</div>

<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
<div class="bg-gray-900 p-5 rounded-xl border border-gray-800">
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">ðŸ“Š Sync Status</h2>
<div id="syncState"><p class="text-gray-600 text-xs">No connection. Enter repo above.</p></div>
</div>

<div class="bg-gray-900 p-5 rounded-xl border border-gray-800">
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">ðŸ“‹ Recent Syncs</h2>
<div id="syncLog" class="text-xs text-gray-500 space-y-1">
${log.length === 0 ? '<p>No syncs.</p>' : ''}
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
  document.getElementById('syncStatus').innerHTML='â³ Syncing...';
  try{
    const res=await fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:o,repo:r})});
    const d=await res.json();
    document.getElementById('syncStatus').innerHTML='âœ… Pull: '+d.pull.pulled+' ('+d.pull.new+' neu) Â· Push: '+d.push.pushed+' Skills';
    showState(d);
  }catch(e){document.getElementById('syncStatus').innerHTML='âŒ '+e.message}
}
function showState(d){
  document.getElementById('syncState').innerHTML='<div class=text-sm><span class=text-teal-300>'+d.repo+'</span><br><span class=text-gray-500>Sync: '+d.lastSync+'</span><br><span class=text-gray-400>Pull: '+d.pull.pulled+' | Push: '+d.push.pushed+'</span><br>'+('â­ '+d.repoInfo?.stars||'')+' ðŸ´ '+d.repoInfo?.forks||''+'</div>';
  if(d.contributors?.length){
    document.getElementById('contributors').innerHTML=d.contributors.map(c=>'<div class=flex.items-center.space-x-2.py-1><span class=text-teal-300>'+c.login+'</span><span class=text-gray-600>'+c.contributions+' contributions</span></div>').join('')
  }
}
</script></body></html>`);
});

app.get('/enterprise', (req, res) => {
  if (!isLoggedIn(req)) return res.redirect('/login');
  const allSkills = getAllSkills().filter(s => s.dir === 'okf_ready');
  const totalSize = allSkills.reduce((s, sk) => s + sk.size, 0);

  res.send(`<!DOCTYPE html><html lang="en" class="dark"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Enterprise Â· OKF MD Master</title>
<script src="https://cdn.tailwindcss.com"></script><script>tailwind.config={darkMode:'class'}</script>
</head><body class="bg-gray-950 text-gray-100 font-sans min-h-screen">
<div class="container mx-auto px-4 py-6 max-w-5xl">
<header class="flex justify-between items-center border-b border-gray-800 pb-5 mb-6">
<div>
<h1 class="text-xl font-bold bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">Enterprise</h1>
<p class="text-xs text-gray-500 mt-1">Data Migration Â· Bulk Processing Â· Custom LLMs</p>
</div>
<a href="/" class="text-xs text-teal-400 hover:text-teal-300">â† Dashboard</a>
</header>

<div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
<div class="bg-gray-900 p-5 rounded-xl border border-gray-800 lg:col-span-2">
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Data Migration Services</h2>
<div class="space-y-4 text-sm">
<div class="bg-gray-800/50 rounded-lg border border-gray-700/50 p-4">
<h3 class="text-teal-300 font-bold mb-2">Bulk Import</h3>
<p class="text-gray-400 text-xs">Migrate existing knowledge bases (Confluence, Notion, SharePoint, Word docs) to OKF format. Supports 50+ file formats.</p>
<div class="mt-2 flex space-x-2"><button onclick="alert('Enterprise feature: contact support for API key')" class="text-xs bg-teal-900/50 text-teal-300 px-3 py-1 rounded border border-teal-800">Request Demo</button></div>
</div>
<div class="bg-gray-800/50 rounded-lg border border-gray-700/50 p-4">
<h3 class="text-teal-300 font-bold mb-2">Bulk Export</h3>
<p class="text-gray-400 text-xs">Export entire OKF knowledge base to JSON, CSV, XML, or custom formats. Scheduled exports available.</p>
<div class="mt-2"><a href="/api/knowledge" class="text-xs bg-teal-900/50 text-teal-300 px-3 py-1 rounded border border-teal-800">Download Bundle (${totalSize > 0 ? (totalSize/1024).toFixed(1) + ' KB' : '0 KB'})</a></div>
</div>
<div class="bg-gray-800/50 rounded-lg border border-gray-700/50 p-4">
<h3 class="text-teal-300 font-bold mb-2">Custom LLM Integration</h3>
<p class="text-gray-400 text-xs">Run the OKF pipeline with your own LLM models (OpenAI, Anthropic, Azure, local). High-throughput processing for enterprise data volumes.</p>
<div class="mt-2 flex space-x-2"><a href="/settings" class="text-xs bg-teal-900/50 text-teal-300 px-3 py-1 rounded border border-teal-800">Configure Models</a></div>
</div>
</div>
</div>

<div class="bg-gray-900 p-5 rounded-xl border border-gray-800">
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Your Knowledge</h2>
<div class="space-y-2 text-sm">
<div class="bg-gray-800 rounded-lg p-3"><p class="text-gray-500 text-xs">Total Skills</p><p class="text-teal-400 text-xl font-bold">${allSkills.length}</p></div>
<div class="bg-gray-800 rounded-lg p-3"><p class="text-gray-500 text-xs">Data Volume</p><p class="text-blue-400 text-xl font-bold">${(totalSize/1024).toFixed(1)} KB</p></div>
<div class="bg-gray-800 rounded-lg p-3"><p class="text-gray-500 text-xs">Formats</p><p class="text-purple-400 text-xl font-bold">MDÂ·OKFÂ·JSON</p></div>
</div>
<div class="mt-4 pt-4 border-t border-gray-800">
<p class="text-xs text-gray-500">Enterprise API: <span class="font-mono text-teal-400">/api/knowledge/context</span></p>
<p class="text-xs text-gray-600 mt-1">Ready for RAG, LLM fine-tuning, and custom integration.</p>
</div>
</div>
</div>

<div class="bg-gray-900 p-5 rounded-xl border border-gray-800 mb-6">
<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Pricing & Plans</h2>
<div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
<div class="bg-gray-800 rounded-lg p-4 border border-amber-800/50 bg-amber-900/10">
<h3 class="font-bold text-amber-300 mb-2">Free</h3>
<p class="text-xs text-gray-400">Up to 100 users<br>Unlimited skills<br>Local processing<br>GitHub sync<br>All features included</p>
<p class="text-amber-400 font-bold mt-2">Free up to 100 users</p>
</div>
<div class="bg-gray-800 rounded-lg p-4 border border-amber-800/50 bg-amber-900/10">
<h3 class="font-bold text-amber-300 mb-2">Pro</h3>
<p class="text-xs text-gray-400">Bulk import/export<br>Priority queue<br>Custom models<br>API access</p>
<p class="text-amber-400 font-bold mt-2">Coming soon</p>
</div>
<div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
<h3 class="font-bold text-gray-300 mb-2">Enterprise</h3>
<p class="text-xs text-gray-400">On-premise deployment<br>SLA guarantee<br>Dedicated instance<br>Custom integrations</p>
<p class="text-gray-400 font-bold mt-2">Contact us</p>
</div>
</div>
</div>

</div></body></html>`);
});

if (require.main === module) startServer();

module.exports = { app, startServer };
