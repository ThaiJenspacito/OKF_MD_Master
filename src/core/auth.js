const { OAuth2Client } = require('google-auth-library');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const USERS_FILE = path.join(__dirname, '../../data/users.json');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GH_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GH_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return {}; }
}

function saveUsers(users) {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

async function verifyGoogleToken(idToken) {
  if (!googleClient) throw new Error('GOOGLE_CLIENT_ID not configured');
  const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
  return ticket.getPayload();
}

async function getGitHubToken(code) {
  if (!GH_CLIENT_ID || !GH_CLIENT_SECRET) throw new Error('GitHub OAuth not configured');
  const res = await axios.post('https://github.com/login/oauth/access_token',
    { client_id: GH_CLIENT_ID, client_secret: GH_CLIENT_SECRET, code },
    { headers: { Accept: 'application/json' } }
  );
  if (res.data.error) throw new Error(res.data.error_description || res.data.error);
  return res.data.access_token;
}

async function getGitHubUser(token) {
  const res = await axios.get('https://api.github.com/user', {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
  });

  const emails = await axios.get('https://api.github.com/user/emails', {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
  });

  const primaryEmail = (emails.data || []).find(e => e.primary)?.email || res.data.email || res.data.login + '@github';
  return {
    email: primaryEmail,
    name: res.data.name || res.data.login,
    picture: res.data.avatar_url,
    login: res.data.login
  };
}

function getUserByEmail(email) {
  const users = loadUsers();
  return users[email] || null;
}

function getOrCreateUser(email, name, picture, login) {
  const users = loadUsers();
  const isFirstUser = Object.keys(users).length === 0;
  const isFounder = email === 'happygoatlamplaimat@gmail.com';
  if (!users[email]) {
    users[email] = {
      email, name, picture, login,
      role: (isFirstUser || isFounder) ? 'admin' : 'pending',
      status: (isFirstUser || isFounder) ? 'active' : 'pending',
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString(),
      loginCount: 1,
      provider: login ? 'github' : 'google'
    };
  } else {
    users[email].lastLogin = new Date().toISOString();
    users[email].loginCount = (users[email].loginCount || 0) + 1;
    users[email].name = name || users[email].name;
    users[email].picture = picture || users[email].picture;
    if (isFounder) users[email].role = 'admin';
    if (isFounder) users[email].status = 'active';
    if (!users[email].role) users[email].role = 'pending';
    if (!users[email].status) users[email].status = 'pending';
  }
  saveUsers(users);
  return users[email];
}

function activateUser(email) {
  const users = loadUsers();
  if (users[email]) {
    users[email].status = 'active';
    users[email].role = 'client';
    users[email].activatedAt = new Date().toISOString();
    saveUsers(users);
    return true;
  }
  return false;
}

function deactivateUser(email) {
  const users = loadUsers();
  if (users[email]) {
    users[email].status = 'rejected';
    saveUsers(users);
    return true;
  }
  return false;
}

function getPendingUsers() {
  const users = loadUsers();
  return Object.entries(users)
    .filter(([, u]) => u.status === 'pending')
    .map(([email, u]) => ({ email, name: u.name, picture: u.picture, provider: u.provider, createdAt: u.createdAt }));
}

function isActive(email) {
  const user = getUserByEmail(email);
  return user && user.status === 'active';
}
  saveUsers(users);
  return users[email];
}

function isAdmin(email) {
  const user = getUserByEmail(email);
  return user && user.role === 'admin';
}

function setRole(email, role) {
  const users = loadUsers();
  if (users[email]) {
    users[email].role = role;
    saveUsers(users);
    return true;
  }
  return false;
}

function getAllUsers() {
  return loadUsers();
}

module.exports = {
  verifyGoogleToken, getGitHubToken, getGitHubUser,
  getOrCreateUser, getUserByEmail, getAllUsers, isAdmin, setRole,
  activateUser, deactivateUser, getPendingUsers, isActive,
  GOOGLE_CLIENT_ID, GH_CLIENT_ID, GH_CLIENT_SECRET
};
