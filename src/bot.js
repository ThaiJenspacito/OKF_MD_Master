const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const scheduler = require('./core/scheduler');
const tracker = require('./state/tracker');
const config = require('./state/config');
const architect = require('./core/architect');
require('dotenv').config();

let userStates = {};

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function initBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const allowedChatId = parseInt(process.env.ALLOWED_CHAT_ID);

  if (!token || !allowedChatId) {
    console.log('\u26a0\ufe0f Telegram Bot nicht gestartet: Token oder Chat-ID fehlt.');
    return;
  }

  const bot = new TelegramBot(token, { polling: true });
  console.log('\ud83e\udd16 Telegram-Bot bereit.');

  const mainMenuKeyboard = {
    reply_markup: {
      keyboard: [
        [{ text: '\ud83d\udcca Dashboard' }, { text: '\ud83d\udcb0 Tokens' }],
        [{ text: '\u23f8\ufe0f Pausieren' }, { text: '\u25b6\ufe0f Fortsetzen' }],
        [{ text: '\ud83c\udf10 Scope' }, { text: '\u2699\ufe0f Limit' }]
      ],
      resize_keyboard: true
    }
  };

  function sendDashboard(chatId) {
    const s = scheduler.getStatus();
    const cfg = config.get();
    const all = tracker.getAll();
    const tokens = architect.getTokenEstimate();
    const scoutedFiles = all.filter(e => e.status === 'scouted');
    const totalBytes = scoutedFiles.reduce((sum, e) => sum + (e.stages?.scouted?.sizeBytes || 0), 0);

    bot.sendMessage(chatId,
      `*\ud83d\udcca OKF MD Master Dashboard*\n` +
      `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n` +
      `\ud83d\udfe2 Status: ${s.paused ? '*PAUSIERT*' : s.running ? '*Aktiv*' : 'Gestoppt'}\n` +
      `\u2705 OKF Skills: *${s.stats.okf_ready}*\n` +
      `\ud83d\udcdd In Queue: *${s.stats.scouted + s.stats.failed}* (${formatBytes(totalBytes)})\n` +
      `\ud83d\udcd6 Lessons: *${s.stats.lessons_learned || 0}*\n` +
      `\u2728 Token (Session): ~*${tokens.toLocaleString()}*\n` +
      `\ud83e\udd16 Modell: \`${cfg.model}\`\n` +
      `\ud83c\udf10 Scopes: \`${(cfg.watchDirs || []).map(d => path.basename(d)).join(', ')}\`\n` +
      `\ud83d\udccf Max-Datei: ${formatBytes(cfg.maxFileSize || 50000)}\n` +
      `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n` +
      `\ud83d\udee0\ufe0f /limit 100 -> Max 100 KB Dateien\n` +
      `\ud83e\udd16 /model deepseek-chat -> LLM wechseln\n` +
      `\ud83d\udcc1 /scope add Pfad -> Ordner hinzufuegen`,
      { parse_mode: 'Markdown', ...mainMenuKeyboard }
    );
  }

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    if (chatId !== allowedChatId) return;

    const text = msg.text;

    if (text && text.startsWith('/')) {
      const [cmd, ...args] = text.split(/\s+/);
      const arg = args.join(' ');

      switch (cmd) {
        case '/start':
        case '\ud83d\udcca Dashboard':
          sendDashboard(chatId);
          break;

        case '/tokens':
        case '\ud83d\udcb0 Tokens': {
          const tokens = architect.getTokenEstimate();
          const all = tracker.getAll();
          const okf = all.filter(e => e.status === 'okf_ready');
          const totalIn = okf.reduce((s, e) => s + (e.stages?.architected?.inputTokens || 0), 0);
          const totalOut = okf.reduce((s, e) => s + (e.stages?.architected?.outputTokens || 0), 0);
          const totalCost = okf.reduce((s, e) => s + (e.stages?.architected?.cost || 0), 0);

          bot.sendMessage(chatId,
            `*\ud83d\udcb0 Token-Verbrauch*\n` +
            `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n` +
            `Session gesamt: ~*${tokens.toLocaleString()}* Tokens\n` +
            `OKF Skills: *${okf.length}* erstellt\n` +
            `Input: ~${(totalIn / 1000).toFixed(1)}K | Output: ~${(totalOut / 1000).toFixed(1)}K\n` +
            `Kosten (ca.): $${totalCost.toFixed(4)}\n` +
            `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n` +
            `\ud83d\udee0\ufe0f /model deepseek-chat  -> Wechseln`,
            { parse_mode: 'Markdown', ...mainMenuKeyboard }
          );
          break;
        }

        case '/pause':
        case '\u23f8\ufe0f Pausieren':
          scheduler.pause();
          config.update({ paused: true });
          bot.sendMessage(chatId, '\u23f8\ufe0f Verarbeitung *pausiert*.', { parse_mode: 'Markdown', ...mainMenuKeyboard });
          break;

        case '/resume':
        case '\u25b6\ufe0f Fortsetzen':
          scheduler.resume();
          config.update({ paused: false });
          bot.sendMessage(chatId, '\u25b6\ufe0f Verarbeitung *fortgesetzt*.', { parse_mode: 'Markdown', ...mainMenuKeyboard });
          break;

        case '/limit':
        case '\u2699\ufe0f Limit': {
          if (!arg) {
            const cfg = config.get();
            bot.sendMessage(chatId, `Aktuelles Limit: *${formatBytes(cfg.maxFileSize || 50000)}*\n\ud83d\udee0\ufe0f /limit 100 -> 100 KB`, { parse_mode: 'Markdown', ...mainMenuKeyboard });
            return;
          }
          const kb = parseInt(arg);
          if (isNaN(kb) || kb < 1) {
            bot.sendMessage(chatId, '\u26a0\ufe0f /limit <KB> z.B. /limit 100', mainMenuKeyboard);
            return;
          }
          config.update({ maxFileSize: kb * 1024 });
          bot.sendMessage(chatId, `\u2705 Max-Dateigroesse: *${kb} KB* (${formatBytes(kb * 1024)})`, { parse_mode: 'Markdown', ...mainMenuKeyboard });
          break;
        }

        case '/model': {
          if (!arg) {
            const cfg = config.get();
            bot.sendMessage(chatId, `Aktuell: \`${cfg.model}\`\nFallback: \`${cfg.fallbackModel}\`\n\ud83d\udee0\ufe0f /model deepseek-chat`, { parse_mode: 'Markdown', ...mainMenuKeyboard });
            return;
          }
          config.update({ model: arg.trim() });
          bot.sendMessage(chatId, `\u2705 Modell: \`${arg.trim()}\``, { parse_mode: 'Markdown', ...mainMenuKeyboard });
          break;
        }

        case '/scope':
        case '\ud83c\udf10 Scope': {
          if (!arg) {
            const cfg = config.get();
            const dirs = (cfg.watchDirs || []).map(d => path.basename(d)).join(', ');
            bot.sendMessage(chatId,
              `*\ud83c\udf10 Watch-Bereiche*\n` +
              `Aktiv: \`${dirs}\`\n\n` +
              `/scope add ./neuer_ordner\n` +
              `/scope del mock_documents`,
              { parse_mode: 'Markdown', ...mainMenuKeyboard }
            );
            return;
          }
          const parts = arg.split(/\s+/);
          if (parts[0] === 'add' && parts[1]) {
            const newDir = parts[1];
            const cfg = config.get();
            const dirs = [...(cfg.watchDirs || [])];
            if (!dirs.includes(newDir)) {
              dirs.push(newDir);
              config.update({ watchDirs: dirs });
              bot.sendMessage(chatId, `\u2705 Scope hinzugefuegt: \`${newDir}\`\n\ud83d\udd04 Neustart noetig.`, { parse_mode: 'Markdown', ...mainMenuKeyboard });
            }
          } else if (parts[0] === 'del' && parts[1]) {
            const cfg = config.get();
            const dirs = (cfg.watchDirs || []).filter(d => !d.includes(parts[1]));
            config.update({ watchDirs: dirs });
            bot.sendMessage(chatId, `\u2705 Scope entfernt: \`${parts[1]}\``, { parse_mode: 'Markdown', ...mainMenuKeyboard });
          }
          break;
        }

        case '/status':
          sendDashboard(chatId);
          break;

        case '/help':
          bot.sendMessage(chatId,
            `*\ud83d\udcd6 OKF MD Master Befehle*\n` +
            `/dashboard - Uebersicht\n` +
            `/tokens - Token-Verbrauch\n` +
            `/pause | /resume - Steuerung\n` +
            `/limit <KB> - Max Dateigroesse\n` +
            `/model <name> - LLM wechseln\n` +
            `/scope add|del <Pfad> - Bereiche`,
            { parse_mode: 'Markdown', ...mainMenuKeyboard }
          );
          break;

        default:
          bot.sendMessage(chatId, `Unbekannt. /help fuer Befehle.`, mainMenuKeyboard);
      }
      return;
    }

    if (userStates[chatId] === 'AWAITING_URL') {
      userStates[chatId] = null;
      const url = text.trim();
      if (!url.startsWith('http')) {
        return bot.sendMessage(chatId, '\u26a0\ufe0f Ungueltiger Link.', mainMenuKeyboard);
      }
      bot.sendMessage(chatId, '\ud83d\udce6 Wird verarbeitet... (Coming soon)', mainMenuKeyboard);
      return;
    }

    switch (text) {
      case '/start':
        sendDashboard(chatId);
        break;
      case '\ud83d\udcca Dashboard':
        sendDashboard(chatId);
        break;
      case '\ud83d\udcb0 Tokens':
        bot.sendMessage(chatId, 'Tokens...', mainMenuKeyboard);
        break;
      case '\u23f8\ufe0f Pausieren':
        scheduler.pause();
        config.update({ paused: true });
        bot.sendMessage(chatId, '\u23f8\ufe0f Pausiert.', mainMenuKeyboard);
        break;
      case '\u25b6\ufe0f Fortsetzen':
        scheduler.resume();
        config.update({ paused: false });
        bot.sendMessage(chatId, '\u25b6\ufe0f Fortgesetzt.', mainMenuKeyboard);
        break;
      case '\ud83c\udf10 Scope':
        bot.sendMessage(chatId, '/scope add|del <Pfad>', mainMenuKeyboard);
        break;
      case '\u2699\ufe0f Limit':
        bot.sendMessage(chatId, '/limit <KB> z.B. /limit 100', mainMenuKeyboard);
        break;
      default:
        bot.sendMessage(chatId, '\ud83d\udcd6 /help fuer Befehle.', mainMenuKeyboard);
    }
  });
}

module.exports = { initBot };
