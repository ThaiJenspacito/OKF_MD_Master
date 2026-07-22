const { execSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

const IDLE_THRESHOLD_SEC = 120;
const CPU_THRESHOLD_PCT = 30;

const PS_SCRIPT = path.join(__dirname, '../../logs/check_idle.ps1');

if (!fs.existsSync(PS_SCRIPT)) {
  fs.mkdirSync(path.dirname(PS_SCRIPT), { recursive: true });
  fs.writeFileSync(PS_SCRIPT, `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public struct LASTINPUTINFO {
  public uint cbSize;
  public uint dwTime;
}
public class User32 {
  [DllImport("user32.dll")]
  public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
}
'@
$lii = New-Object LASTINPUTINFO
$lii.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($lii)
[User32]::GetLastInputInfo([ref]$lii) | Out-Null
[Math]::Floor(([Environment]::TickCount - $lii.dwTime) / 1000)
`.trim());
}

function getIdleSeconds() {
  try {
    const result = execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${PS_SCRIPT}"`,
      { timeout: 5000, windowsHide: true, encoding: 'utf8' }
    );
    const val = parseInt(result.trim(), 10);
    return Number.isNaN(val) ? 0 : val;
  } catch {
    return 0;
  }
}

function getCpuLoad() {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }
  return Math.round((1 - totalIdle / totalTick) * 100);
}

function isIdle(thresholdSec = IDLE_THRESHOLD_SEC, cpuThreshold = CPU_THRESHOLD_PCT) {
  const idleSec = getIdleSeconds();
  const cpuLoad = getCpuLoad();
  return {
    idle: idleSec >= thresholdSec && cpuLoad <= cpuThreshold,
    idleSeconds: idleSec,
    cpuLoad,
    thresholdSec,
    cpuThreshold
  };
}

module.exports = { getIdleSeconds, getCpuLoad, isIdle, IDLE_THRESHOLD_SEC, CPU_THRESHOLD_PCT };
