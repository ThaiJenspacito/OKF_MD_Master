require('dotenv').config();

const path = require('path');
const config = require('./state/config');
const watcher = require('./core/watcher');
const scheduler = require('./core/scheduler');
const { startServer } = require('./server');
const { initBot } = require('./bot');
const tray = require('./tray');

const cfg = config.get();
const PORT = process.env.PORT || 5000;

console.log('\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557');
console.log('\u2551      OKF MD Master v2.1         \u2551');
console.log('\u2551  DeepSeek + Offline-Ready       \u2551');
console.log('\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d');
console.log(`\ud83e\udd16 Modell: ${cfg.model}`);
console.log(`\ud83c\udf10 Scopes: ${(cfg.watchDirs || []).map(d => path.basename(d)).join(', ')}`);
console.log(`\ud83d\udccf Limit: ${Math.round((cfg.maxFileSize || 50000) / 1024)} KB`);
console.log('');

watcher.start();

scheduler.start();

startServer();

try {
  initBot();
} catch (err) {
  console.log('\u26a0\ufe0f Telegram Bot: deaktiviert');
}

try {
  tray.start(scheduler);
} catch (err) {
  console.log('\u26a0\ufe0f Tray: nicht verfuegbar');
}

process.on('SIGINT', () => {
  console.log('\n\ud83d\uded1 Shutdown...');
  scheduler.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\ud83d\uded1 Shutdown...');
  scheduler.stop();
  process.exit(0);
});

console.log(`\u2705 OKF MD Master laeuft. Dashboard: http://localhost:${PORT}`);
console.log('   Telegram: /dashboard fuer Uebersicht');
