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
    console.log('Telegram Bot: disabled (no token)');
    return;
  }

  const bot = new TelegramBot(token, { polling: true });
  console.log('Telegram Bot: ready');

  const mainMenuKeyboard = {
    reply_markup: {
      keyboard: [
        [{ text: '📊 Dashboard' }, { text: '💰 Tokens' }],
        [{ text: '⏸️ Pause' }, { text: '▶️ Resume' }],
        [{ text: '🌐 Scope' }, { text: '⚙️ Limit' }]
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
      `*📊 OKF MD Master Dashboard*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🟢 Status: ${s.paused ? '*PAUSED*' : s.running ? '*Active*' : 'Stopped'}\n` +
      `✅ OKF Skills: *${s.stats.okf_ready}*\n` +
      `📝 In Queue: *${s.stats.scouted + s.stats.failed}* (${formatBytes(totalBytes)})\n` +
      `📖 Lessons: *${s.stats.lessons_learned || 0}*\n` +
      `✨ Tokens (Session): ~*${tokens.toLocaleString()}*\n` +
      `🤖 Model: \`${cfg.model}\`\n` +
      `🌐 Scopes: \`${(cfg.watchDirs || []).map(d => path.basename(d)).join(', ')}\`\n` +
      `📏 Max File: ${formatBytes(cfg.maxFileSize || 50000)}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🛠️ /limit 100 -> Max 100 KB files\n` +
      `🤖 /model deepseek-chat -> Switch LLM\n` +
      `📁 /scope add path -> Add directory`,
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
        case '📊 Dashboard':
          sendDashboard(chatId);
          break;

        case '/tokens':
        case '💰 Tokens': {
          const tokens = architect.getTokenEstimate();
          const all = tracker.getAll();
          const okf = all.filter(e => e.status === 'okf_ready');
          const totalIn = okf.reduce((s, e) => s + (e.stages?.architected?.inputTokens || 0), 0);
          const totalOut = okf.reduce((s, e) => s + (e.stages?.architected?.outputTokens || 0), 0);
          const totalCost = okf.reduce((s, e) => s + (e.stages?.architected?.cost || 0), 0);

          bot.sendMessage(chatId,
            `*💰 Token Usage*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `Session total: ~*${tokens.toLocaleString()}* tokens\n` +
            `OKF Skills: *${okf.length}* created\n` +
            `Input: ~${(totalIn / 1000).toFixed(1)}K | Output: ~${(totalOut / 1000).toFixed(1)}K\n` +
            `Cost (est.): $${totalCost.toFixed(4)}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🛠️ /model deepseek-chat -> Switch`,
            { parse_mode: 'Markdown', ...mainMenuKeyboard }
          );
          break;
        }

        case '/pause':
        case '⏸️ Pause':
          scheduler.pause();
          config.update({ paused: true });
          bot.sendMessage(chatId, '⏸️ Processing *paused*.', { parse_mode: 'Markdown', ...mainMenuKeyboard });
          break;

        case '/resume':
        case '▶️ Resume':
          scheduler.resume();
          config.update({ paused: false });
          bot.sendMessage(chatId, '▶️ Processing *resumed*.', { parse_mode: 'Markdown', ...mainMenuKeyboard });
          break;

        case '/limit':
        case '⚙️ Limit': {
          if (!arg) {
            const cfg = config.get();
            bot.sendMessage(chatId, `Current limit: *${formatBytes(cfg.maxFileSize || 50000)}*\n🛠️ /limit 100 -> 100 KB`, { parse_mode: 'Markdown', ...mainMenuKeyboard });
            return;
          }
          const kb = parseInt(arg);
          if (isNaN(kb) || kb < 1) {
            bot.sendMessage(chatId, '⚠️ /limit <KB> e.g. /limit 100', mainMenuKeyboard);
            return;
          }
          config.update({ maxFileSize: kb * 1024 });
          bot.sendMessage(chatId, `✅ Max file size: *${kb} KB* (${formatBytes(kb * 1024)})`, { parse_mode: 'Markdown', ...mainMenuKeyboard });
          break;
        }

        case '/model': {
          if (!arg) {
            const cfg = config.get();
            bot.sendMessage(chatId, `Current: \`${cfg.model}\`\nFallback: \`${cfg.fallbackModel}\`\n🛠️ /model deepseek-chat`, { parse_mode: 'Markdown', ...mainMenuKeyboard });
            return;
          }
          config.update({ model: arg.trim() });
          bot.sendMessage(chatId, `✅ Model: \`${arg.trim()}\``, { parse_mode: 'Markdown', ...mainMenuKeyboard });
          break;
        }

        case '/scope':
        case '🌐 Scope': {
          if (!arg) {
            const cfg = config.get();
            const dirs = (cfg.watchDirs || []).map(d => path.basename(d)).join(', ');
            bot.sendMessage(chatId,
              `*🌐 Watch Scopes*\n` +
              `Active: \`${dirs}\`\n\n` +
              `/scope add ./new_folder\n` +
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
              bot.sendMessage(chatId, `✅ Scope added: \`${newDir}\`\n🔄 Restart required.`, { parse_mode: 'Markdown', ...mainMenuKeyboard });
            }
          } else if (parts[0] === 'del' && parts[1]) {
            const cfg = config.get();
            const dirs = (cfg.watchDirs || []).filter(d => !d.includes(parts[1]));
            config.update({ watchDirs: dirs });
            bot.sendMessage(chatId, `✅ Scope removed: \`${parts[1]}\``, { parse_mode: 'Markdown', ...mainMenuKeyboard });
          }
          break;
        }

        case '/status':
          sendDashboard(chatId);
          break;

        case '/help':
          bot.sendMessage(chatId,
            `*📖 OKF MD Master Commands*\n` +
            `/dashboard - Overview\n` +
            `/tokens - Token usage\n` +
            `/pause | /resume - Control\n` +
            `/limit <KB> - Max file size\n` +
            `/model <name> - Switch LLM\n` +
            `/scope add|del <path> - Directories`,
            { parse_mode: 'Markdown', ...mainMenuKeyboard }
          );
          break;

        default:
          bot.sendMessage(chatId, `Unknown. /help for commands.`, mainMenuKeyboard);
      }
      return;
    }

    if (userStates[chatId] === 'AWAITING_URL') {
      userStates[chatId] = null;
      const url = text.trim();
      if (!url.startsWith('http')) {
        return bot.sendMessage(chatId, '⚠️ Invalid URL.', mainMenuKeyboard);
      }
      bot.sendMessage(chatId, '📦 Processing... (Coming soon)', mainMenuKeyboard);
      return;
    }

    switch (text) {
      case '/start':
      case '📊 Dashboard':
        sendDashboard(chatId);
        break;
      case '💰 Tokens':
        bot.sendMessage(chatId, 'Tokens...', mainMenuKeyboard);
        break;
      case '⏸️ Pause':
        scheduler.pause();
        config.update({ paused: true });
        bot.sendMessage(chatId, '⏸️ Paused.', mainMenuKeyboard);
        break;
      case '▶️ Resume':
        scheduler.resume();
        config.update({ paused: false });
        bot.sendMessage(chatId, '▶️ Resumed.', mainMenuKeyboard);
        break;
      case '🌐 Scope':
        bot.sendMessage(chatId, '/scope add|del <path>', mainMenuKeyboard);
        break;
      case '⚙️ Limit':
        bot.sendMessage(chatId, '/limit <KB> e.g. /limit 100', mainMenuKeyboard);
        break;
      default:
        bot.sendMessage(chatId, '📖 /help for commands.', mainMenuKeyboard);
    }
  });
}

module.exports = { initBot };
