require('dotenv').config();

const path = require('path');
const config = require('./state/config');
const { startServer } = require('./server');

const isCloudRun = process.env.CLOUD_RUN === '1';
const cfg = config.get();
const PORT = process.env.PORT || 5000;

console.log('OKF MD Master v2.2' + (isCloudRun ? ' (Cloud Run)' : ''));
console.log('Model: ' + cfg.model);

if (!isCloudRun) {
  const watcher = require('./core/watcher');
  const scheduler = require('./core/scheduler');
  const tray = require('./tray');

  console.log('Scopes: ' + (cfg.watchDirs || []).map(d => path.basename(d)).join(', '));
  console.log('Limit: ' + Math.round((cfg.maxFileSize || 50000) / 1024) + ' KB');

  watcher.start();
  scheduler.start();

  try {
    tray.start(scheduler);
  } catch (err) {
    console.log('Tray: nicht verfuegbar');
  }

  process.on('SIGINT', () => { scheduler.stop(); process.exit(0); });
  process.on('SIGTERM', () => { scheduler.stop(); process.exit(0); });
}

startServer();
console.log('Dashboard: http://localhost:' + PORT);

// Register Telegram webhook
const tgBot = require('./core/telegram-bot');
const CLOUD_URL = process.env.CLOUD_RUN_URL || ('http://localhost:' + PORT);
if (tgBot.TG_TOKEN) {
  tgBot.setWebhook(CLOUD_URL + '/telegram/webhook').then(r => {
    console.log('Telegram webhook: ' + (r.ok ? '✅ set' : '❌ ' + r.description));
  }).catch(() => {});
}
