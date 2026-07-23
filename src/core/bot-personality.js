// Bot Personality — human-like, natural, varied responses

const greetings = [
  (name) => `Hey ${name}! 👋`,
  (name) => `Hi ${name}, nice to chat with you!`,
  (name) => `Oh hello ${name}!`,
  (name) => `${name}! Great to hear from you`,
  (name) => `Hey hey ${name}`,
];

const intros = [
  `I'm your OKF AI — think of me as your knowledge sidekick. I can pull up any skill from the library, give you a dashboard snapshot, or just geek out about knowledge formats. What are you curious about?`,
  `Nice to meet you! I run on the OKF knowledge base — 14 skills and counting. Try asking me anything, or type /dashboard to see what's going on.`,
  `Hey! I'm the OKF bot — I help you manage your knowledge pipeline. Need a status check? Want to browse skills? Just say the word.`,
];

const helpLines = [
  `Quick commands: /dashboard for live stats, /skills for the library, or just ask me anything. I'll figure it out.`,
  `Use /dashboard to peek at the server, /skills to browse what we've got, or just chat with me naturally.`,
  `Try /dashboard or /skills. Or better yet, ask me something — that's more fun anyway.`,
];

const responses = {
  start: (name) => {
    const greet = greetings[Math.floor(Math.random() * greetings.length)](name);
    const intro = intros[Math.floor(Math.random() * intros.length)];
    const help = helpLines[Math.floor(Math.random() * helpLines.length)];
    return `${greet}\n\n${intro}\n\n${help}`;
  },
  dashboard: () => {
    const lines = [
      `Here's where we're at:`,
      `Current status — looking good:`,
      `Dashboard snapshot:`,
    ];
    return `${lines[Math.floor(Math.random() * lines.length)]}\n\n✅ 14 OKF Skills · 🤖 9 Agents · ☁️ Cloud Run 24/7\n🌐 https://thai-jenspacito-okf-md.eu.run.app`;
  },
  skills: () => {
    const lines = [
      `Our library is growing! Check it out:`,
      `Browse the collection here:`,
      `Skills library — take a look:`,
    ];
    return `${lines[Math.floor(Math.random() * lines.length)]}\n\n📚 https://thai-jenspacito-okf-md.eu.run.app/library`;
  },
  thinking: () => {
    const lines = [
      `Hmm, let me think about that...`,
      `Good question! Give me a sec...`,
      `Let me check the knowledge base...`,
      `One moment, digging through the skills...`,
    ];
    return lines[Math.floor(Math.random() * lines.length)];
  }
};

function humanize(text) {
  // Remove overly formal patterns
  return text
    .replace(/I am/g, "I'm")
    .replace(/you are/g, "you're")
    .replace(/it is/g, "it's")
    .replace(/do not/g, "don't")
    .replace(/cannot/g, "can't")
    .replace(/will not/g, "won't")
    .replace(/There is/g, "There's")
    .replace(/That is/g, "That's")
    .replace(/Here is/g, "Here's")
    .replace(/\n\n---\n\n/g, '\n\n')
    .replace(/\*Model:.*/g, '')
    .replace(/\*Answer from OKF knowledge base\*/g, '');
}

function formatAnswer(raw) {
  let answer = humanize(raw);
  // Keep it conversational, short
  if (answer.length > 1000) {
    const paragraphs = answer.split('\n\n');
    if (paragraphs.length > 3) {
      answer = paragraphs.slice(0, 3).join('\n\n') + '\n\n...want me to go deeper on any of this?';
    }
  }
  return answer;
}

module.exports = { responses, humanize, formatAnswer };
