const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const LOG_DIR = path.join(__dirname, '../../logs');
const REPORT_FILE = path.join(LOG_DIR, 'server-report.json');

const THRESHOLDS = {
  cpu: { soll: 20, warn: 70, max: 95 },
  ram: { soll: 50, warn: 85, max: 95 },
  disk: { soll: 50, warn: 80, max: 95 },
  uptime: { soll: 3600, warn: 86400, max: 604800 }
};

function getDiskUsage() {
  try {
    const cmd = 'powershell -NoProfile -Command "(Get-PSDrive C).Used; (Get-PSDrive C).Free"';
    const output = execSync(cmd, { encoding: 'utf8', windowsHide: true }).trim().split('\n');
    const used = parseInt(output[0]);
    const free = parseInt(output[1]);
    const total = used + free;
    if (total > 0) {
      return { used, total, pct: Math.round((used / total) * 100), free };
    }
  } catch {}
  return { used: 0, total: 0, pct: 0, free: 0 };
}

function getCpuPct() {
  const cpus = os.cpus();
  let totalIdle = 0, totalTick = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) totalTick += cpu.times[type];
    totalIdle += cpu.times.idle;
  }
  return Math.round((1 - totalIdle / totalTick) * 100);
}

function getRamPct() {
  const total = os.totalmem();
  const free = os.freemem();
  return Math.round(((total - free) / total) * 100);
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 GB';
  return (bytes / 1073741824).toFixed(1) + ' GB';
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return d + 'd ' + h + 'h';
  if (h > 0) return h + 'h ' + m + 'm';
  return m + 'm';
}

function getReport() {
  const cpu = getCpuPct();
  const disk = getDiskUsage();
  const uptime = process.uptime();
  const totalRam = os.totalmem();
  const ramFree = os.freemem();

  const report = {
    timestamp: new Date().toISOString(),
    metrics: {
      cpu: {
        soll: THRESHOLDS.cpu.soll,
        ist: cpu,
        max: THRESHOLDS.cpu.max,
        unit: '%',
        status: cpu > THRESHOLDS.cpu.max ? 'critical' : cpu > THRESHOLDS.cpu.warn ? 'warn' : cpu <= THRESHOLDS.cpu.soll ? 'under' : 'ok',
        bar: Math.min(cpu, 100)
      },
      ram: {
        soll: 4,
        ist: Math.round(ramFree / 1073741824 * 10) / 10,
        max: 16,
        unit: 'GB',
        total: formatBytes(totalRam),
        free: formatBytes(ramFree),
        status: ramFree / 1073741824 < 1 ? 'critical' : ramFree / 1073741824 < 3 ? 'warn' : ramFree / 1073741824 >= 8 ? 'under' : 'ok',
        bar: Math.min(Math.round((ramFree / totalRam) * 100), 100)
      },
      disk: {
        soll: THRESHOLDS.disk.soll,
        ist: disk.pct,
        max: THRESHOLDS.disk.max,
        unit: '%',
        total: formatBytes(disk.total),
        free: formatBytes(disk.free || 0),
        status: disk.pct > THRESHOLDS.disk.max ? 'critical' : disk.pct > THRESHOLDS.disk.warn ? 'warn' : disk.pct <= THRESHOLDS.disk.soll ? 'under' : 'ok',
        bar: Math.min(disk.pct, 100)
      },
      uptime: {
        ist: Math.round(uptime),
        formatted: formatUptime(uptime),
        unit: 's'
      },
      process: {
        rss: formatBytes(process.memoryUsage().rss),
        heap: formatBytes(process.memoryUsage().heapUsed)
      }
    },
    summary: 'ok'
  };

  const stati = [report.metrics.cpu.status, report.metrics.ram.status, report.metrics.disk.status];
  if (stati.includes('critical')) report.summary = 'critical';
  else if (stati.includes('warn')) report.summary = 'warn';
  else if (stati.every(s => s === 'under')) report.summary = 'under';
  else report.summary = 'ok';

  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  } catch {}

  return report;
}

module.exports = { getReport, THRESHOLDS, getDiskUsage, getCpuPct, getRamPct };
