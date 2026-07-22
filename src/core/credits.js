const fs = require('fs');
const path = require('path');

const CREDITS_FILE = path.join(__dirname, '../../data/credits.json');

function load() {
  if (!fs.existsSync(CREDITS_FILE)) return { global: { totalProcessed: 0, totalCredits: 0 }, users: {} };
  try { return JSON.parse(fs.readFileSync(CREDITS_FILE, 'utf8')); } catch { return { global: { totalProcessed: 0, totalCredits: 0 }, users: {} }; }
}

function save(data) {
  fs.mkdirSync(path.dirname(CREDITS_FILE), { recursive: true });
  fs.writeFileSync(CREDITS_FILE, JSON.stringify(data, null, 2));
}

function getUserCredits(email, name) {
  const data = load();
  if (!data.users[email]) {
    data.users[email] = {
      name: name || email,
      joined: new Date().toISOString(),
      filesProcessed: 0,
      tokensProcessed: 0,
      credits: 0,
      downloads: 0,
      downloadLimit: 50,
      cpuContribution: 0,
      settings: { sharePower: true, maxDownloads: 50, autoProcess: true }
    };
    save(data);
  }
  return data.users[email];
}

function addProcessed(email, name, tokens, files = 1) {
  const data = load();
  const user = getUserCredits(email, name);

  const newCredits = Math.floor(tokens / 100);
  user.filesProcessed = (user.filesProcessed || 0) + files;
  user.tokensProcessed = (user.tokensProcessed || 0) + tokens;
  user.credits = (user.credits || 0) + newCredits;
  user.downloadLimit = 50 + Math.floor(user.credits / 10);
  user.lastActive = new Date().toISOString();

  data.global.totalProcessed = (data.global.totalProcessed || 0) + files;
  data.global.totalCredits = (data.global.totalCredits || 0) + newCredits;

  save(data);
  return { user, newCredits, downloadLimit: user.downloadLimit };
}

function canDownload(email) {
  const user = getUserCredits(email);
  if (!user) return { allowed: true, remaining: -1, limit: -1, credits: 0 };

  const remaining = (user.downloadLimit || 50) - (user.downloads || 0);
  return {
    allowed: remaining > 0,
    remaining,
    limit: user.downloadLimit || 50,
    credits: user.credits || 0
  };
}

function trackDownload(email) {
  const data = load();
  if (!data.users[email]) return;

  data.users[email].downloads = (data.users[email].downloads || 0) + 1;
  save(data);
}

function addCpuContribution(email, seconds) {
  const data = load();
  if (!data.users[email]) return;
  const hrs = seconds / 3600;
  data.users[email].cpuContribution = (data.users[email].cpuContribution || 0) + hrs;
  data.users[email].lastActive = new Date().toISOString();
  save(data);
}

function getStats(email) {
  const user = getUserCredits(email);
  const data = load();
  return {
    user,
    global: data.global,
    canDownload: canDownload(email),
    totalUsers: Object.keys(data.users).length
  };
}

function updateSettings(email, settings) {
  const data = load();
  if (!data.users[email]) getUserCredits(email);
  data.users[email].settings = { ...data.users[email].settings, ...settings };
  if (settings.maxDownloads) data.users[email].downloadLimit = settings.maxDownloads;
  save(data);
  return data.users[email];
}

function getLeaderboard() {
  const data = load();
  return Object.entries(data.users)
    .map(([email, u]) => ({ email: email.substring(0, 20) + '...', name: u.name, credits: u.credits || 0, files: u.filesProcessed || 0, tokens: u.tokensProcessed || 0, cpu: (u.cpuContribution || 0).toFixed(1) + 'h' }))
    .sort((a, b) => b.credits - a.credits)
    .slice(0, 10);
}

module.exports = { getUserCredits, addProcessed, canDownload, trackDownload, addCpuContribution, getStats, updateSettings, getLeaderboard, load };
