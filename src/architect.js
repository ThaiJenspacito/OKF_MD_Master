console.log('📋 architect.js (legacy) -> Weiterleitung an core/architect.js');

const architect = require('./core/architect');
architect.processAll().then(results => {
  console.log(`✅ Fertig. ${results.length} Dateien transformiert.`);
}).catch(err => {
  console.error('❌ Fehler:', err.message);
  process.exit(1);
});
