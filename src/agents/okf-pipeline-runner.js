#!/usr/bin/env node
// OKF Pipeline Runner — runs the full Scout → Architect pipeline
// Usage: node src/agents/okf-pipeline-runner.js [watchDir]

const path = require('path');
const scout = require('../core/scout');
const architect = require('../core/architect');
const qualityAgent = require('../core/okf-quality-agent');
const tracker = require('../state/tracker');

async function run(watchDir) {
  const scanPath = watchDir || path.join(__dirname, '../../mock_documents');

  console.log('╔═══════════════════════════════╗');
  console.log('║   OKF Pipeline Runner v2.2   ║');
  console.log('╚═══════════════════════════════╝\n');

  // Phase 1: Scout
  console.log('🔍 Phase 1: Scout scanning for .md files...');
  const discovered = scout.scanForKnowledge(scanPath);
  console.log(`   Found: ${discovered.length} new files\n`);

  if (discovered.length === 0) {
    console.log('📌 No new files to process. Running quality audit...\n');
  }

  // Phase 2: Architect
  const pending = tracker.getByStatus('scouted');
  const retry = tracker.getByStatus('failed');
  if (pending.length > 0 || retry.length > 0) {
    console.log(`🤖 Phase 2: Architect processing ${pending.length + retry.length} files...`);
    console.log(`   (${pending.length} new, ${retry.length} retry)\n`);
    const results = await architect.processAll();
    console.log(`   ✅ ${results.length} skills created\n`);
    results.forEach(r => console.log(`   📄 ${r.skillName} (${r.provider}/${r.model}, ${r.tokens} tokens, ${r.runtime}ms)`));
  }

  // Phase 3: Quality Audit
  console.log('\n✅ Phase 3: Quality Audit...');
  const report = qualityAgent.runAudit();
  console.log(`   ${report.summary.total} skills audited`);
  console.log(`   Average: ${report.summary.average}% | Grade: ${report.summary.grade}`);
  console.log(`   ${report.summary.pass} pass, ${report.summary.fail} fail`);
  console.log(`   ${report.summary.criticalIssues} critical issues, ${report.summary.warnings} warnings\n`);

  // Summary
  const all = tracker.getAll();
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(` Total: ${all.length} tracked | OKF: ${tracker.getByStatus('okf_ready').length} | Queue: ${pending.length} | Failed: ${retry.length} | Lessons: ${tracker.getByStatus('lessons_learned').length}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

const targetDir = process.argv[2];
run(targetDir).catch(e => { console.error('❌', e.message); process.exit(1); });
