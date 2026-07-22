let scheduler = null;

function start(sched) {
  scheduler = sched;
  console.log('  Tray: systray2 verfuegbar (Minimized-Mode).');
  console.log('  Zum Beenden: STRG+C oder Task-Manager.');
}

module.exports = { start };
