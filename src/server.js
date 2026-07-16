const express = require('express');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { exec } = require('child_process');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3333;

const AGENTS_DIR = path.join(__dirname, '../.agents');
const INDEX_FILE = path.join(AGENTS_DIR, 'skills/index.md');
const LOG_FILE = path.join(AGENTS_DIR, 'scout_activity.log');
const ACTIVE_LOCAL_DIR = path.join(AGENTS_DIR, 'skills/active/local');
const WATCH_DIR = path.join(__dirname, '../mock_documents'); // Dein Quellordner

// Helper: Liest Zeilen aus einer Datei
function readLines(filePath) {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8').split('\n').filter(line => line.trim());
}

// 👁️ DER WACHHUND (Chokidar)
// Überwacht den Ordner und startet die Pipeline bei Änderungen
const watcher = chokidar.watch(WATCH_DIR, {
    persistent: true,
    ignoreInitial: true // Ignoriert bestehende Dateien beim Start, reagiert nur auf Neues/Änderungen
});

watcher.on('all', (event, filePath) => {
    if (filePath.endsWith('.md')) {
        console.log(`⚡ Datei-Event erkannt (${event}): ${path.basename(filePath)} -> Starte Pipeline autonom...`);
        
        // Führt 'npm run pipeline' automatisch im Hintergrund aus
        exec('npm run pipeline', (error, stdout, stderr) => {
            if (error) {
                console.error(`🚨 Autonome Pipeline abgebrochen:`, error.message);
                return;
            }
            console.log(`🤖 Pipeline-Ergebnis:\n${stdout}`);
        });
    }
});

console.log(`👁️ Auto-Watch aktiv: Überwache '${WATCH_DIR}' auf Änderungen...`);

// 🌐 WEB-DASHBOARD ROUTE
app.get('/', (req, res) => {
    let skillCount = 0;
    if (fs.existsSync(ACTIVE_LOCAL_DIR)) {
        skillCount = fs.readdirSync(ACTIVE_LOCAL_DIR).filter(f => f.endsWith('.md')).length;
    }

    const logLines = readLines(LOG_FILE).slice(2); 
    const logs = logLines.map(line => {
        const parts = line.split('|').map(p => p.trim());
        if (parts.length < 6) return null;
        return { time: parts[1], path: parts[2], file: parts[3], status: parts[4], desc: parts[5] };
    }).filter(Boolean).reverse().slice(0, 10); 

    const indexLines = readLines(INDEX_FILE).filter(l => l.startsWith('*'));
    const skills = indexLines.map(line => {
        const match = line.match(/\* \[(.*?)\]\((.*?)\) - (.*)/);
        if (match) return { name: match[1], path: match[2], date: match[3] };
        return null;
    }).filter(Boolean);

    res.send(`
    <!DOCTYPE html>
    <html lang="de" class="dark">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>OKF MD Master - Dashboard</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <script>tailwind.config = { darkMode: 'class' }</script>
    </head>
    <body class="bg-gray-900 text-gray-100 font-sans min-h-screen">
        <div class="container mx-auto px-4 py-8">
            <header class="flex justify-between items-center border-b border-gray-800 pb-6 mb-8">
                <div>
                    <h1 class="text-3xl font-bold tracking-tight bg-gradient-to-r from-teal-400 to-blue-500 bg-clip-text text-transparent">🗂️ OKF MD Master</h1>
                    <p class="text-sm text-gray-400 mt-1">Autonomer Markdown & Knowledge Architect</p>
                </div>
                <div class="flex items-center space-x-4">
                    <span class="flex h-3 w-3 relative">
                        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span class="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                    </span>
                    <span class="text-sm font-medium text-gray-300">Auto-Watch & Server aktiv (Port ${PORT})</span>
                </div>
            </header>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <div class="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg">
                    <h3 class="text-gray-400 text-sm font-semibold uppercase tracking-wider">Aktive OKF-Skills</h3>
                    <p class="text-5xl font-extrabold text-teal-400 mt-2">${skillCount}</p>
                </div>
                <div class="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg">
                    <h3 class="text-gray-400 text-sm font-semibold uppercase tracking-wider">KI-Architektur</h3>
                    <p class="text-xl font-bold text-blue-400 mt-4 flex items-center">
                        <span class="bg-blue-900/50 text-blue-300 px-3 py-1 rounded-md border border-blue-700">gemini-3.1-flash-lite</span>
                    </p>
                </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div class="lg:col-span-1 bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg">
                    <h2 class="text-xl font-bold border-b border-gray-700 pb-3 mb-4 text-gray-200">🗃️ Skill Register</h2>
                    {skills.length === 0 ? '<p class="text-gray-500 italic text-sm">Noch keine Skills registriert.</p>' : ''}
                    <ul class="space-y-3">
                        ${skills.map(s => `
                            <li class="p-3 bg-gray-700/50 rounded-lg border border-gray-600/50 flex flex-col justify-between hover:bg-gray-700 transition">
                                <span class="font-medium text-teal-300 text-sm break-all">${s.name}</span>
                                <span class="text-xs text-gray-400 mt-2 flex justify-between">
                                    <span>📂 local</span>
                                    <span>${s.date}</span>
                                </span>
                            </li>
                        `).join('')}
                    </ul>
                </div>

                <div class="lg:col-span-2 bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg">
                    <h2 class="text-xl font-bold border-b border-gray-700 pb-3 mb-4 text-gray-200">🕵️‍♂️ Letzte Scout-Aktivitäten</h2>
                    <div class="overflow-x-auto">
                        <table class="w-full text-left border-collapse">
                            <thead>
                                <tr class="text-xs font-semibold text-gray-400 uppercase border-b border-gray-700">
                                    <th class="py-3 px-2">Zeit</th>
                                    <th class="py-3 px-2">Datei</th>
                                    <th class="py-3 px-2">Status</th>
                                    <th class="py-3 px-2">Details</th>
                                </tr>
                            </thead>
                            <tbody class="text-sm divide-y divide-gray-700/50">
                                ${logs.length === 0 ? '<tr><td colspan="4" class="py-4 text-center text-gray-500 italic">Noch keine Scout-Einträge vorhanden.</td></tr>' : ''}
                                ${logs.map(log => {
                                    const isSuccess = log.status.includes('🟢') || log.status.includes('AKTIVIERT');
                                    const statusClass = isSuccess ? 'bg-green-900/40 text-green-300 border-green-700' : 'bg-yellow-900/40 text-yellow-300 border-yellow-700';
                                    return `
                                        <tr class="hover:bg-gray-750 transition">
                                            <td class="py-3 px-2 text-xs text-gray-400 whitespace-nowrap">${log.time}</td>
                                            <td class="py-3 px-2 font-medium text-gray-200 max-w-[150px] truncate" title="${log.file}">${log.file}</td>
                                            <td class="py-3 px-2">
                                                <span class="px-2 py-0.5 text-xs font-semibold rounded border ${statusClass}">${log.status}</span>
                                            </td>
                                            <td class="py-3 px-2 text-xs text-gray-400 max-w-[250px] truncate" title="${log.desc}">${log.desc}</td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    </body>
    </html>
    `);
});

app.listen(PORT, () => {
    console.log(`🚀 Web-Dashboard bereit unter http://localhost:${PORT}`);
});