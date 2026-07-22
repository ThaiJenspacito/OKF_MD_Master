const chokidar = require('chokidar');
const path = require('path');
const scheduler = require('./scheduler');
const config = require('../state/config');

function start() {
  const cfg = config.get();
  const watchDirs = cfg.watchDirs || [path.join(__dirname, '../../mock_documents')];

  watchDirs.forEach(watchDir => {
    if (!require('fs').existsSync(watchDir)) {
      console.log(`⚠️ Watch-Dir existiert nicht: ${watchDir}`);
      return;
    }

    const watcher = chokidar.watch(watchDir, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 }
    });

    watcher.on('add', (filePath) => {
      if (filePath.endsWith('.md')) {
        console.log(`👁️ [${path.basename(watchDir)}] Neu: ${path.basename(filePath)}`);
        scheduler.enqueue(filePath);
      }
    });

    watcher.on('change', (filePath) => {
      if (filePath.endsWith('.md')) {
        console.log(`👁️ [${path.basename(watchDir)}] Geaendert: ${path.basename(filePath)}`);
        scheduler.enqueue(filePath);
      }
    });

    console.log(`👁️ Watcher aktiv: ${watchDir}`);
  });
}

module.exports = { start };
