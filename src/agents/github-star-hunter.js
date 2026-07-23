#!/usr/bin/env node
// GitHub Star Hunter — finds relevant repos and stars them automatically
// Usage: node src/agents/github-star-hunter.js [query]

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const TOKEN = process.env.GITHUB_TOKEN;
const QUERIES = [
  'okf+skills+open-knowledge-format',
  'mcp+server+agent+tools',
  'ai+coding+agent+framework',
  'llm+knowledge+management+rag',
  'saas+boilerplate+open+source',
  'web+design+ui+component+library'
];

async function searchGitHub(query) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=5`;
  const headers = { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'OKF-StarHunter' };
  const res = await fetch(url, { headers });
  const data = await res.json();
  return (data.items || []).map(r => ({ fullName: r.full_name, stars: r.stargazers_count, desc: r.description, url: r.html_url }));
}

async function starRepo(fullName) {
  const url = `https://api.github.com/user/starred/${fullName}`;
  const headers = { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'OKF-StarHunter', 'Content-Length': '0' };
  try {
    await fetch(url, { method: 'PUT', headers });
    return true;
  } catch { return false; }
}

async function run() {
  if (!TOKEN) { console.log('GITHUB_TOKEN not set in .env'); process.exit(1); }

  console.log('🔭 GitHub Star Hunter — searching for relevant repos...\n');

  const allResults = [];
  for (const query of QUERIES) {
    const results = await searchGitHub(query);
    allResults.push(...results);
    console.log(`📡 "${query}" → ${results.length} repos (top: ${results[0]?.stars.toLocaleString()} ⭐ ${results[0]?.fullName})`);
  }

  const unique = [...new Map(allResults.map(r => [r.fullName, r])).values()]
    .filter(r => !r.fullName.startsWith('ThaiJenspacito/'))
    .filter(r => r.stars > 50)
    .sort((a, b) => b.stars - a.stars)
    .slice(0, 15);

  console.log(`\n📊 Top ${unique.length} repos eligible for starring:\n`);

  const historyFile = path.join(__dirname, '../../data/star-history.json');
  const history = fs.existsSync(historyFile) ? JSON.parse(fs.readFileSync(historyFile, 'utf8')) : [];

  let newStars = 0;
  for (const repo of unique) {
    if (history.includes(repo.fullName)) {
      console.log(`   ⏭️  ${repo.fullName} (already starred)`);
      continue;
    }
    const starred = await starRepo(repo.fullName);
    if (starred) {
      console.log(`   ⭐ ${repo.fullName} (${repo.stars.toLocaleString()} ⭐)`);
      history.push(repo.fullName);
      newStars++;
    }
  }

  fs.mkdirSync(path.dirname(historyFile), { recursive: true });
  fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
  console.log(`\n✅ ${newStars} new repos starred. ${history.length} total in history.`);
}

run().catch(e => { console.error(e.message); process.exit(1); });
