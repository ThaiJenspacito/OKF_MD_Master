const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DATA_DIR = path.join(__dirname, '../../data');
const STATE_FILE = path.join(DATA_DIR, 'github-issue-state.json');

function getClient() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not configured');
  return {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'OKF-MD-Master'
    }
  };
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { lastChecked: null, processedIssues: [], stats: { answered: 0, escalated: 0, total: 0 } };
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function getOpenIssues(owner, repo) {
  const client = getClient();
  const { data } = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=20&sort=created`,
    client
  );
  return (data || []).filter(i => !i.pull_request).map(i => ({
    number: i.number,
    title: i.title,
    body: i.body || '',
    user: i.user?.login || 'unknown',
    createdAt: i.created_at,
    labels: (i.labels || []).map(l => l.name),
    comments: i.comments
  }));
}

async function getComments(owner, repo, issueNumber) {
  const client = getClient();
  const { data } = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    client
  );
  return (data || []).map(c => ({ user: c.user?.login, body: c.body }));
}

async function postComment(owner, repo, issueNumber, body) {
  const client = getClient();
  await axios.post(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    { body },
    client
  );
}

async function addLabel(owner, repo, issueNumber, labels) {
  const client = getClient();
  await axios.post(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/labels`,
    { labels },
    client
  );
}

async function assignIssue(owner, repo, issueNumber, assignee) {
  const client = getClient();
  await axios.post(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/assignees`,
    { assignees: [assignee] },
    client
  );
}

async function processIssues(owner, repo, skillAgent) {
  const state = loadState();
  const issues = await getOpenIssues(owner, repo);
  const results = { answered: 0, escalated: 0, skipped: 0 };

  for (const issue of issues) {
    if (state.processedIssues.includes(issue.number)) continue;

    const comments = await getComments(owner, repo, issue.number);
    const botComments = comments.filter(c => c.user === 'github-actions[bot]' || c.body.includes('OKF Bot'));
    if (botComments.length > 0) {
      state.processedIssues.push(issue.number);
      continue;
    }

    state.stats.total++;

    try {
      const answer = await skillAgent.ask(`Issue: ${issue.title}\n\n${issue.body}`, []);

      if (answer.answer.includes('Dazu habe ich kein Wissen') || answer.answer.includes('nicht in den Skills')) {
        await postComment(owner, repo, issue.number,
          `🤖 **OKF Bot**: I don't have enough knowledge to answer this yet.\n\n` +
          `@${owner} — this needs your attention.\n\n` +
          `> ${issue.title}`
        );
        try {
          await addLabel(owner, repo, issue.number, ['needs-human']);
          await assignIssue(owner, repo, issue.number, owner);
        } catch {}
        results.escalated++;
        state.stats.escalated++;
      } else {
        await postComment(owner, repo, issue.number,
          `🤖 **OKF Bot**: Here's what I found in the OKF knowledge base:\n\n${answer.answer}\n\n` +
          `---\n*Model: ${answer.model} · ${answer.tokens} tokens · ${answer.skillCount} skills loaded*`
        );
        results.answered++;
        state.stats.answered++;
      }
    } catch (e) {
      results.skipped++;
    }

    state.processedIssues.push(issue.number);
  }

  state.lastChecked = new Date().toISOString();
  if (state.processedIssues.length > 200) state.processedIssues = state.processedIssues.slice(-200);
  saveState(state);
  return { ...results, stats: state.stats };
}

function getStats() {
  return loadState().stats;
}

module.exports = { processIssues, getOpenIssues, getStats };
