const fs = require('fs');
const path = require('path');
const { globSync } = require('glob');
const tracker = require('../state/tracker');
const config = require('../state/config');

const DATA_DIR = path.join(__dirname, '../../data');
const ORIGINALS_DIR = path.join(DATA_DIR, 'originals');
const SCOUTED_DIR = path.join(DATA_DIR, 'scouted');
const LOG_FILE = path.join(__dirname, '../../logs/scout.log');

fs.mkdirSync(ORIGINALS_DIR, { recursive: true });
fs.mkdirSync(SCOUTED_DIR, { recursive: true });
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

function log(level, message) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const line = `[${ts}] [${level}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line);
  console.log(`📋 ${message}`);
}

function scanForKnowledge() {
  const cfg = config.get();
  const watchDirs = cfg.watchDirs || [path.join(__dirname, '../../mock_documents')];

  log('INFO', `Scout startet. Watch-Dirs: ${watchDirs.join(', ')}`);

  const discovered = [];

  for (const scanPath of watchDirs) {
    if (!fs.existsSync(scanPath)) {
      log('WARN', `Pfad existiert nicht: ${scanPath}`);
      continue;
    }

    const files = globSync(`${scanPath}/**/*.md`, {
      ignore: ['**/node_modules/**', '**/.git/**', '**/.agents/**', '**/data/**']
    });

    for (const file of files) {
      const filename = path.basename(file);

      try {
        const stat = fs.statSync(file);
        if (cfg.maxFileSize && stat.size > cfg.maxFileSize) {
          log('WARN', `Uebersprungen (zu gross ${stat.size} > ${cfg.maxFileSize}): ${filename}`);
          tracker.create(filename, file);
          tracker.transition(filename, 'skipped', {
            reason: `Datei zu gross (${stat.size} > ${cfg.maxFileSize} Bytes)`
          });
          continue;
        }

        const fileContent = fs.readFileSync(file, 'utf8');
        if (fileContent.trim().length < 20) {
          log('WARN', `Uebersprungen (zu kurz): ${filename}`);
          continue;
        }

        const existing = tracker.getState(filename);
        if (existing && existing.hash && existing.hash === tracker.fileHash(file)) {
          continue;
        }

        const originalCopy = path.join(ORIGINALS_DIR, filename);
        fs.copyFileSync(file, originalCopy);

        const scoutedCopy = path.join(SCOUTED_DIR, filename);
        fs.copyFileSync(file, scoutedCopy);

        tracker.create(filename, file);
        tracker.transition(filename, 'scouted', {
          copyPath: scoutedCopy,
          originalCopyPath: originalCopy,
          sourcePath: file,
          sizeBytes: stat.size
        });

        log('INFO', `Gescoutet: ${filename} (${stat.size} Bytes)`);
        discovered.push({ filename, scoutedPath: scoutedCopy, originalPath: file });
      } catch (err) {
        log('ERROR', `Fehler bei ${filename}: ${err.message}`);
      }
    }
  }

  log('INFO', `Scan abgeschlossen. ${discovered.length} neue Dateien.`);
  return discovered;
}

function scanFile(filePath) {
  const cfg = config.get();
  const filename = path.basename(filePath);

  if (!fs.existsSync(filePath)) return null;

  const stat = fs.statSync(filePath);
  if (cfg.maxFileSize && stat.size > cfg.maxFileSize) {
    log('WARN', `Uebersprungen (zu gross): ${filename}`);
    return null;
  }

  const fileContent = fs.readFileSync(filePath, 'utf8');
  if (fileContent.trim().length < 20) return null;

  const existing = tracker.getState(filename);
  if (existing && existing.hash && existing.hash === tracker.fileHash(filePath)) {
    return null;
  }

  const originalCopy = path.join(ORIGINALS_DIR, filename);
  fs.copyFileSync(filePath, originalCopy);

  const scoutedCopy = path.join(SCOUTED_DIR, filename);
  fs.copyFileSync(filePath, scoutedCopy);

  tracker.create(filename, filePath);
  tracker.transition(filename, 'scouted', {
    copyPath: scoutedCopy,
    originalCopyPath: originalCopy,
    sourcePath: filePath,
    sizeBytes: stat.size
  });

  log('INFO', `Gescoutet: ${filename} (${stat.size} Bytes)`);
  return { filename, scoutedPath: scoutedCopy, originalPath: filePath };
}

module.exports = { scanForKnowledge, scanFile, log };
