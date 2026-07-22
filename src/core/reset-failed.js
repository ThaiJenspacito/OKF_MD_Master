const tracker = require('./state/tracker');
const fs = require('fs');
const path = require('path');

const failed = tracker.getByStatus('failed');
const ll = tracker.getByStatus('lessons_learned');

if (failed.length === 0 && ll.length === 0) {
  console.log('✅ Keine fehlgeschlagenen Eintraege.');
  process.exit(0);
}

console.log(`🔧 ${failed.length} temporaer fehlgeschlagen, ${ll.length} als Lessons-Learned archiviert.`);

for (const entry of failed) {
  const statePath = path.join(tracker.STATE_DIR, `${entry.id.replace('.md', '')}.json`);
  entry.status = 'scouted';
  entry.retries = 0;
  entry.error = null;
  delete entry.stages.failed;
  fs.writeFileSync(statePath, JSON.stringify(entry, null, 2));
  console.log(`↩️ ${entry.id} -> Zurueck auf scouted.`);
}

for (const entry of ll) {
  console.log(`📚 ${entry.id}: Archiviert als Lessons-Learned.`);
  if (entry.error) {
    console.log(`   Fehler: ${entry.error}`);
  }
}

console.log('✅ Reset abgeschlossen.');
