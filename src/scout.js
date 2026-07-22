const path = require('path');

const targetPath = process.argv[2] || path.join(__dirname, '../mock_documents');

console.log('📋 scout.js (legacy) -> Weiterleitung an core/scout.js');

const scout = require('./core/scout');
scout.scanForKnowledge(targetPath);
