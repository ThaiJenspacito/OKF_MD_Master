const fs = require('fs');
const path = require('path');

const APPROVAL_FILE = path.join(__dirname, '../../data/approval-queue.json');
const TENANTS_DIR = path.join(__dirname, '../../data/tenants');

const REJECTION_REASONS = {
  duplicate: 'Doppelte Daten — Datei existiert bereits',
  wrong_format: 'Falsches Format — nur .md, .txt, .json, .csv, .yaml, .yml erlaubt',
  too_large: 'Zu gross — max 500 KB pro Datei',
  no_content: 'Kein sinnvoller Inhalt — Datei ist zu kurz oder leer',
  policy: 'Richtlinien-Verstoß — Inhalt entspricht nicht den Upload-Richtlinien',
  other: 'Anderer Grund — siehe Admin-Kommentar'
};

function getQueue() {
  if (!fs.existsSync(APPROVAL_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(APPROVAL_FILE, 'utf8')); } catch { return []; }
}

function saveQueue(queue) {
  fs.mkdirSync(path.dirname(APPROVAL_FILE), { recursive: true });
  fs.writeFileSync(APPROVAL_FILE, JSON.stringify(queue, null, 2));
}

function addToQueue(email, filename, filePath, size) {
  const queue = getQueue();
  queue.push({
    id: Date.now().toString(36),
    email,
    filename,
    filePath,
    sizeBytes: size,
    submitted: new Date().toISOString(),
    status: 'pending'
  });
  saveQueue(queue);
  return queue.length;
}

function approveItem(id, adminEmail) {
  const queue = getQueue();
  const idx = queue.findIndex(i => i.id === id);
  if (idx === -1) return null;
  const item = queue[idx];
  item.status = 'approved';
  item.reviewedBy = adminEmail;
  item.reviewedAt = new Date().toISOString();

  const tenantDir = path.join(TENANTS_DIR, item.email, 'incoming');
  fs.mkdirSync(tenantDir, { recursive: true });
  if (fs.existsSync(item.filePath)) {
    fs.copyFileSync(item.filePath, path.join(tenantDir, item.filename));
  }

  queue.splice(idx, 1);
  saveQueue(queue);

  addToJournal(item.email, 'approved', item.filename, 'Upload genehmigt');
  return item;
}

function rejectItem(id, reasonCode, adminComment, adminEmail) {
  const queue = getQueue();
  const idx = queue.findIndex(i => i.id === id);
  if (idx === -1) return null;
  const item = queue[idx];
  const reason = REJECTION_REASONS[reasonCode] || adminComment || 'Abgelehnt';

  item.status = 'rejected';
  item.reasonCode = reasonCode;
  item.reasonText = reason;
  item.adminComment = adminComment || '';
  item.reviewedBy = adminEmail;
  item.reviewedAt = new Date().toISOString();

  queue.splice(idx, 1);
  saveQueue(queue);

  addToJournal(item.email, 'rejected', item.filename, reason);
  return item;
}

function addToJournal(email, action, filename, detail) {
  const journalFile = path.join(TENANTS_DIR, email, 'journal.json');
  fs.mkdirSync(path.dirname(journalFile), { recursive: true });
  const entries = fs.existsSync(journalFile) ? JSON.parse(fs.readFileSync(journalFile, 'utf8')) : [];
  entries.push({
    at: new Date().toISOString(),
    action,
    filename,
    detail
  });
  if (entries.length > 100) entries.splice(0, entries.length - 100);
  fs.writeFileSync(journalFile, JSON.stringify(entries, null, 2));
}

function getJournal(email) {
  const journalFile = path.join(TENANTS_DIR, email, 'journal.json');
  if (!fs.existsSync(journalFile)) return [];
  return JSON.parse(fs.readFileSync(journalFile, 'utf8'));
}

function getStats() {
  const queue = getQueue();
  return {
    pending: queue.length,
    todayApproved: queue.filter(i => i.status === 'approved').length,
    todayRejected: queue.filter(i => i.status === 'rejected').length
  };
}

function ensureTenantDir(email) {
  const dirs = ['incoming', 'originals', 'scouted', 'okf_ready', 'state'];
  dirs.forEach(d => fs.mkdirSync(path.join(TENANTS_DIR, email, d), { recursive: true }));
}

module.exports = {
  REJECTION_REASONS, getQueue, addToQueue, approveItem, rejectItem,
  getJournal, getStats, ensureTenantDir
};
