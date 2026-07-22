const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const DATA_DIR = path.join(__dirname, '../../data');
const SYNC_LOG = path.join(DATA_DIR, 'sync-log.json');
const SYNC_STATE = path.join(DATA_DIR, 'sync-state.json');

function getGitHubClient() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN nicht in .env gesetzt');
  return { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github.v3+json' } };
}

async function getRepoInfo(owner, repo) {
  const client = getGitHubClient();
  try {
    const { data } = await axios.get(`https://api.github.com/repos/${owner}/${repo}`, client);
    return { stars: data.stargazers_count, forks: data.forks_count, updated: data.updated_at, desc: data.description };
  } catch { return null; }
}

async function getContributors(owner, repo) {
  const client = getGitHubClient();
  try {
    const { data } = await axios.get(`https://api.github.com/repos/${owner}/${repo}/contributors?per_page=10`, client);
    return data.map(c => ({ login: c.login, contributions: c.contributions, avatar: c.avatar_url }));
  } catch { return []; }
}

async function pullFromRepo(owner, repo, branch = 'main') {
  const client = getGitHubClient();
  const results = { pulled: 0, new: 0, errors: [] };

  try {
    const { data: tree } = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, client
    );

    const skillFiles = (tree.tree || []).filter(f =>
      f.path.startsWith('data/okf_ready/') && f.path.endsWith('.md') && f.path !== 'data/okf_ready/.gitkeep'
    );

    for (const file of skillFiles) {
      try {
        const { data: blob } = await axios.get(
          `https://api.github.com/repos/${owner}/${repo}/contents/${file.path}?ref=${branch}`, client
        );
        const content = Buffer.from(blob.content, 'base64').toString('utf8');
        const localPath = path.join(DATA_DIR, 'okf_ready', path.basename(file.path));
        if (!fs.existsSync(localPath)) {
          fs.writeFileSync(localPath, content);
          results.new++;
        }
        results.pulled++;
      } catch (e) {
        results.errors.push(file.path + ': ' + e.message);
      }
    }
  } catch (e) {
    results.errors.push('GitHub API: ' + e.message);
  }

  logSync('pull', `${owner}/${repo}`, results.pulled, results.new);
  return results;
}

async function pushToRepo(owner, repo, branch = 'main') {
  const client = getGitHubClient();
  const localDir = path.join(DATA_DIR, 'okf_ready');
  const results = { pushed: 0, errors: [] };

  if (!fs.existsSync(localDir)) return results;

  const files = fs.readdirSync(localDir).filter(f => f.endsWith('.md') && f !== '.gitkeep');

  for (const file of files.slice(0, 5)) {
    try {
      const content = fs.readFileSync(path.join(localDir, file), 'utf8');
      const base64 = Buffer.from(content).toString('base64');

      try {
        const { data: existing } = await axios.get(
          `https://api.github.com/repos/${owner}/${repo}/contents/data/okf_ready/${file}`, client
        );
        if (existing.sha) continue;
      } catch {}

      await axios.put(
        `https://api.github.com/repos/${owner}/${repo}/contents/data/okf_ready/${file}`, {
          message: `OKF Skill: ${file}`,
          content: base64,
          branch
        }, client
      );
      results.pushed++;
    } catch (e) {
      results.errors.push(file + ': ' + e.message);
    }
  }

  logSync('push', `${owner}/${repo}`, 0, results.pushed);
  return results;
}

async function fullSync(owner, repo) {
  const pullResults = await pullFromRepo(owner, repo);
  const pushResults = await pushToRepo(owner, repo);
  const repoInfo = await getRepoInfo(owner, repo);
  const contributors = await getContributors(owner, repo);

  const state = {
    repo: `${owner}/${repo}`,
    lastSync: new Date().toISOString(),
    pull: pullResults,
    push: pushResults,
    repoInfo,
    contributors
  };

  fs.writeFileSync(SYNC_STATE, JSON.stringify(state, null, 2));
  return state;
}

function logSync(action, repo, total, changed) {
  const entries = fs.existsSync(SYNC_LOG) ? JSON.parse(fs.readFileSync(SYNC_LOG, 'utf8')) : [];
  entries.push({ at: new Date().toISOString(), action, repo, total, changed });
  if (entries.length > 50) entries.splice(0, entries.length - 50);
  fs.writeFileSync(SYNC_LOG, JSON.stringify(entries, null, 2));
}

function getSyncState() {
  if (!fs.existsSync(SYNC_STATE)) return null;
  return JSON.parse(fs.readFileSync(SYNC_STATE, 'utf8'));
}

function getSyncLog() {
  if (!fs.existsSync(SYNC_LOG)) return [];
  return JSON.parse(fs.readFileSync(SYNC_LOG, 'utf8'));
}

module.exports = { pullFromRepo, pushToRepo, fullSync, getSyncState, getSyncLog, getRepoInfo, getContributors };
