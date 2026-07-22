const SysTray = require('systray2');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const PORT = process.env.PORT || 5000;

let scheduler = null;

const iconBase64 = (() => {
  const bmp = Buffer.alloc(32 * 32 * 4);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4;
      const dist = Math.sqrt((x - 16) ** 2 + (y - 16) ** 2);
      if (dist < 14) {
        const g = Math.round(200 - dist * 10);
        bmp[i] = 0; bmp[i + 1] = Math.max(g, 50); bmp[i + 2] = Math.max(g, 100); bmp[i + 3] = 255;
      } else {
        bmp[i] = 0; bmp[i + 1] = 0; bmp[i + 2] = 0; bmp[i + 3] = 0;
      }
    }
  }
  return bmp.toString('base64');
})();

const tray = new SysTray({
  menu: {
    icon: iconBase64,
    title: 'OKF MD Master',
    tooltip: 'OKF MD Master',
    items: [
      { title: 'Dashboard oeffnen', tooltip: `http://localhost:${PORT}`, checked: false, enabled: true },
      { title: 'Pausieren', tooltip: 'Pause idle processing', checked: false, enabled: true },
      { title: 'Fortsetzen', tooltip: 'Resume processing', checked: false, enabled: false },
      { title: 'Trenner', tooltip: '', checked: false, enabled: true, isSeparator: true },
      { title: 'Beenden', tooltip: 'Exit', checked: false, enabled: true }
    ]
  },
  copyDir: false,
  debug: false
});

let pauseItem = tray.menu.items[1];
let resumeItem = tray.menu.items[2];

tray.onClick((action) => {
  if (!action || !action.item) return;

  switch (action.item.title) {
    case 'Dashboard oeffnen':
      exec(`start http://localhost:${PORT}`);
      break;
    case 'Pausieren':
      if (scheduler) scheduler.pause();
      tray.sendAction({ type: 'update-item', item: { ...pauseItem, enabled: false }, seq_id: 1 });
      tray.sendAction({ type: 'update-item', item: { ...resumeItem, enabled: true }, seq_id: 2 });
      break;
    case 'Fortsetzen':
      if (scheduler) scheduler.resume();
      tray.sendAction({ type: 'update-item', item: { ...pauseItem, enabled: true }, seq_id: 1 });
      tray.sendAction({ type: 'update-item', item: { ...resumeItem, enabled: false }, seq_id: 2 });
      break;
    case 'Beenden':
      if (scheduler) scheduler.stop();
      tray.kill();
      process.exit(0);
  }
});

function start(sched) {
  scheduler = sched;
  console.log('🖥️ Tray-App gestartet. OKF MD Master laeuft im Hintergrund.');
}

module.exports = { start };
