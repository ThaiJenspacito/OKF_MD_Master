const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const DATA_DIR = path.join(__dirname, '../../data');
const OKF_DIR = path.join(DATA_DIR, 'okf_ready');
const REPORT_FILE = path.join(DATA_DIR, 'quality-report.json');

const REQUIRED_FIELDS = ['name', 'description', 'type', 'version', 'tags'];
const VALID_TYPES = ['skill', 'lessons-learned', 'agent-skill', 'workflow-enforcement-prompt'];
const MIN_CONTENT_LENGTH = 100;
const MIN_DESCRIPTION_LENGTH = 20;
const MAX_TAGS = 10;

function validateFrontmatter(parsed, filename) {
  const issues = [];
  const data = parsed.data || {};

  for (const field of REQUIRED_FIELDS) {
    if (!data[field]) {
      issues.push({ field, severity: 'error', msg: `Missing required field: ${field}` });
    }
  }

  if (data.type && !VALID_TYPES.includes(data.type)) {
    issues.push({ field: 'type', severity: 'warn', msg: `Unknown type "${data.type}". Valid: ${VALID_TYPES.join(', ')}` });
  }

  if (data.version && !/^\d+\.\d+\.\d+$/.test(data.version)) {
    issues.push({ field: 'version', severity: 'warn', msg: `Version should be semver (e.g. 1.0.0), got: ${data.version}` });
  }

  if (data.name && data.name === filename.replace('.md', '')) {
    issues.push({ field: 'name', severity: 'info', msg: 'Name matches filename — consider a more descriptive name' });
  }

  if (data.description && data.description.length < MIN_DESCRIPTION_LENGTH) {
    issues.push({ field: 'description', severity: 'warn', msg: `Description too short (${data.description.length} chars, min ${MIN_DESCRIPTION_LENGTH})` });
  }

  if (data.tags) {
    if (!Array.isArray(data.tags)) {
      issues.push({ field: 'tags', severity: 'error', msg: 'Tags must be an array' });
    } else {
      if (data.tags.length === 0) {
        issues.push({ field: 'tags', severity: 'warn', msg: 'No tags provided' });
      }
      if (data.tags.length > MAX_TAGS) {
        issues.push({ field: 'tags', severity: 'warn', msg: `Too many tags (${data.tags.length}, max ${MAX_TAGS})` });
      }
      const duplicates = data.tags.filter((t, i) => data.tags.indexOf(t) !== i);
      if (duplicates.length > 0) {
        issues.push({ field: 'tags', severity: 'info', msg: `Duplicate tags: ${[...new Set(duplicates)].join(', ')}` });
      }
    }
  }

  if (Object.keys(parsed.data || {}).length === 0) {
    issues.push({ field: 'format', severity: 'error', msg: 'No YAML frontmatter found — file is not valid OKF' });
  }

  return issues;
}

function validateContent(content, filename) {
  const issues = [];
  const bodyContent = content.replace(/^---[\s\S]*?---\s*/, '').trim();

  if (bodyContent.length < MIN_CONTENT_LENGTH) {
    issues.push({ field: 'content', severity: 'warn', msg: `Content too short (${bodyContent.length} chars, min ${MIN_CONTENT_LENGTH})` });
  }

  const headings = (bodyContent.match(/^#+\s/gm) || []);
  if (headings.length === 0) {
    issues.push({ field: 'content', severity: 'info', msg: 'No markdown headings found' });
  }

  if (bodyContent.includes('TODO') || bodyContent.includes('FIXME')) {
    issues.push({ field: 'content', severity: 'info', msg: 'Contains TODO/FIXME markers' });
  }

  return issues;
}

function calculateScore(issues) {
  const errors = issues.filter(i => i.severity === 'error').length;
  const warns = issues.filter(i => i.severity === 'warn').length;
  const infos = issues.filter(i => i.severity === 'info').length;
  const score = Math.max(0, 100 - (errors * 30) - (warns * 10) - (infos * 3));
  return Math.round(score);
}

function getGrade(score) {
  if (score >= 95) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function runAudit() {
  const results = [];
  if (!fs.existsSync(OKF_DIR)) return { results, summary: { total: 0, average: 0, pass: 0, fail: 0 } };

  const files = fs.readdirSync(OKF_DIR).filter(f => f.endsWith('.md'));

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(OKF_DIR, file), 'utf8');
      const parsed = matter(raw);
      const fmIssues = validateFrontmatter(parsed, file);
      const contentIssues = validateContent(raw, file);
      const allIssues = [...fmIssues, ...contentIssues];
      const score = calculateScore(allIssues);

      results.push({
        file,
        name: parsed.data.name || file,
        score,
        grade: getGrade(score),
        issues: allIssues.length,
        errors: allIssues.filter(i => i.severity === 'error').length,
        warnings: allIssues.filter(i => i.severity === 'warn').length,
        info: allIssues.filter(i => i.severity === 'info').length,
        details: allIssues,
        tags: parsed.data.tags || [],
        type: parsed.data.type || 'unknown'
      });
    } catch (e) {
      results.push({
        file,
        name: file,
        score: 0,
        grade: 'F',
        issues: 1,
        errors: 1,
        warnings: 0,
        info: 0,
        details: [{ field: 'parse', severity: 'error', msg: e.message }],
        tags: [],
        type: 'error'
      });
    }
  }

  results.sort((a, b) => a.score - b.score);

  const avg = results.length > 0 ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length) : 0;

  const summary = {
    auditedAt: new Date().toISOString(),
    total: results.length,
    average: avg,
    grade: getGrade(avg),
    pass: results.filter(r => r.score >= 70).length,
    fail: results.filter(r => r.score < 70).length,
    criticalIssues: results.reduce((s, r) => s + r.errors, 0),
    warnings: results.reduce((s, r) => s + r.warnings, 0),
    suggestions: results.reduce((s, r) => s + r.info, 0)
  };

  const report = { summary, results };
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  return report;
}

function getReport() {
  if (!fs.existsSync(REPORT_FILE)) return runAudit();
  return JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));
}

module.exports = { runAudit, getReport };
