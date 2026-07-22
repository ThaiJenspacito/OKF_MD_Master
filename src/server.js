const express = require('express');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const tracker = require('./state/tracker');
const scheduler = require('./core/scheduler');
const { isIdle } = require('./core/idle-detector');

const app = express();
const PORT = process.env.PORT || 5000;

const DATA_DIR = path.join(__dirname, '../data');
const INDEX_FILE = path.join(DATA_DIR, 'index.md');
const SCOUT_LOG = path.join(__dirname, '../logs/scout.log');
const ARCHITECT_LOG = path.join(__dirname, '../logs/architect.log');
const SYSTEM_LOG = path.join(__dirname, '../logs/system.log');
const OKF_READY_DIR = path.join(DATA_DIR, 'okf_ready');

function readLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    return fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim());
  } catch {
    return [];
  }
}

function getRecentLogs(logFile, count = 15) {
  const lines = readLines(logFile);
  return lines.slice(-count).reverse();
}

app.get('/', (req, res) => {
  const status = scheduler.getStatus();
  const idleStatus = isIdle();
  const allEntries = tracker.getAll();
  const skillCount = allEntries.filter(e => e.status === 'okf_ready').length;

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

  const eventLogs = getRecentLogs(SYSTEM_LOG, 10)
    .map(l => l.replace(/^\[/, '').replace(/\] \[/g, '] ['));

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

  res.send(`
<!DOCTYPE html>
<html lang="de" class="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OKF MD Master</title>
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config={darkMode:'class'}</script>
<meta http-equiv="refresh" content="30">
</head>
<body class="bg-gray-900 text-gray-100 font-sans min-h-screen">
<div class="container mx-auto px-4 py-8">
<header class="flex justify-between items-center border-b border-gray-800 pb-6 mb-8">
<div>
<h1 class="text-3xl font-bold tracking-tight bg-gradient-to-r from-teal-400 to-blue-500 bg-clip-text text-transparent">OKF MD Master</h1>
<p class="text-sm text-gray-400 mt-1">Autonomer Markdown &amp; Knowledge Architect</p>
</div>
<div class="flex items-center space-x-4">
<span class="flex h-3 w-3 relative">
<span class="animate-ping absolute inline-flex h-full w-full rounded-full ${status.running && !status.paused ? 'bg-green-400' : 'bg-yellow-400'} opacity-75"></span>
<span class="relative inline-flex rounded-full h-3 w-3 ${status.running && !status.paused ? 'bg-green-500' : 'bg-yellow-500'}"></span>
</span>
<span class="text-sm font-medium text-gray-300">
${status.paused ? 'Pausiert' : status.running ? 'Aktiv' : 'Gestoppt'}
(IDLE: ${idleStatus.idleSeconds}s / CPU: ${idleStatus.cpuLoad}%)
</span>
</div>
</header>

<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
<div class="bg-gray-800 p-4 rounded-xl border border-gray-700"><p class="text-gray-400 text-xs uppercase">OKF Skills</p><p class="text-3xl font-bold text-teal-400">${skillCount}</p></div>
<div class="bg-gray-800 p-4 rounded-xl border border-gray-700"><p class="text-gray-400 text-xs uppercase">Gesamt</p><p class="text-3xl font-bold text-blue-400">${status.stats.total}</p></div>
<div class="bg-gray-800 p-4 rounded-xl border border-gray-700"><p class="text-gray-400 text-xs uppercase">Queue</p><p class="text-3xl font-bold text-purple-400">${status.discoveryQueueSize}</p></div>
<div class="bg-gray-800 p-4 rounded-xl border border-gray-700"><p class="text-gray-400 text-xs uppercase">Lernmaterial</p><p class="text-3xl font-bold text-amber-400">${status.stats.lessons_learned || 0}</p></div>
</div>

<div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
<div class="lg:col-span-1 bg-gray-800 p-6 rounded-xl border border-gray-700">
<h2 class="text-lg font-bold border-b border-gray-700 pb-3 mb-4">Skills</h2>
${skills.length === 0 ? '<p class="text-gray-500 italic text-sm">Noch keine Skills.</p>' : ''}
<ul class="space-y-2">
${skills.map(s => `<li class="p-2 bg-gray-700/50 rounded border border-gray-600/50"><span class="font-medium text-teal-300 text-sm">${s.name}</span><span class="text-xs text-gray-500 block">${s.date}</span></li>`).join('')}
</ul>
</div>

<div class="lg:col-span-2 bg-gray-800 p-6 rounded-xl border border-gray-700">
<h2 class="text-lg font-bold border-b border-gray-700 pb-3 mb-4">Letzte Aktivitaeten</h2>
<div class="overflow-x-auto">
<table class="w-full text-left">
<thead><tr class="text-xs font-semibold text-gray-400 uppercase border-b border-gray-700"><th class="py-2 px-2">Datei</th><th class="py-2 px-2">Status</th><th class="py-2 px-2">Zuletzt</th></tr></thead>
<tbody class="text-sm divide-y divide-gray-700/50">
${recentActivity.length === 0 ? '<tr><td colspan="3" class="py-4 text-center text-gray-500 italic">Keine Aktivitaeten.</td></tr>' : ''}
${recentActivity.map(e => {
const lastStage = Object.keys(e.stages || {}).pop();
const lastTime = e.stages?.[lastStage]?.at?.substring(0, 16) || '';
return `<tr class="hover:bg-gray-750"><td class="py-2 px-2 font-medium text-gray-200">${e.id}</td><td class="py-2 px-2"><span class="px-2 py-0.5 text-xs font-semibold rounded border ${statusBadge(e.status)}">${e.status}</span></td><td class="py-2 px-2 text-xs text-gray-400">${lastTime}</td></tr>`;
}).join('')}
</tbody></table>
</div>
</div>
</div>
</div>
</body></html>`);
});

app.get('/api/status', (req, res) => {
  res.json({
    scheduler: scheduler.getStatus(),
    idle: isIdle()
  });
});

function startServer() {
  app.listen(PORT, () => {
    console.log(`🚀 Dashboard: http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
