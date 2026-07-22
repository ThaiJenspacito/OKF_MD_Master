const { OAuth2Client } = require('google-auth-library');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const USERS_FILE = path.join(__dirname, '../../data/users.json');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const client = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return {}; }
}

function saveUsers(users) {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

async function verifyGoogleToken(idToken) {
  if (!client) throw new Error('GOOGLE_CLIENT_ID nicht konfiguriert');
  const ticket = await client.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
  return ticket.getPayload();
}

function getUserByEmail(email) {
  const users = loadUsers();
  return users[email] || null;
}

function getOrCreateUser(email, name, picture) {
  const users = loadUsers();
  if (!users[email]) {
    users[email] = {
      email,
      name,
      picture,
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString(),
      loginCount: 1
    };
  } else {
    users[email].lastLogin = new Date().toISOString();
    users[email].loginCount = (users[email].loginCount || 0) + 1;
    users[email].name = name || users[email].name;
    users[email].picture = picture || users[email].picture;
  }
  saveUsers(users);
  return users[email];
}

function getAllUsers() {
  return loadUsers();
}

module.exports = { verifyGoogleToken, getOrCreateUser, getUserByEmail, getAllUsers, GOOGLE_CLIENT_ID };
