# Recovery Guide — OKF MD Master

## After PC crash — you can't lose anything.

---

## ✅ What survives automatically

| What | Where | Status |
|------|-------|--------|
| **All OKF Skills** | GitHub: `github.com/ThaiJenspacito/OKF_MD_Master` | Safe |
| **Live Dashboard** | Cloud Run: `thai-jenspacito-okf-md-299034318175.europe-west1.run.app` | 24/7 |
| **Chat AI** | Cloud Run + all 4 bots | Running |
| **Source Code** | GitHub | Complete |
| **Settings** | `.env` in project folder | Needs manual backup |

---

## 🔄 Recovery — 3 commands

```bash
# 1. Clone back from GitHub
git clone https://github.com/ThaiJenspacito/OKF_MD_Master.git
cd OKF_MD_Master

# 2. Install
npm install

# 3. Start (create .env first if needed)
cp .env.example .env
npm start
```

Open `http://localhost:5000` — you're back.

---

## ⚡ If PC is dead but you still need to work

The Cloud Run instance runs 24/7 independently:

```
https://thai-jenspacito-okf-md-299034318175.europe-west1.run.app
```

Accesible from any device — phone, tablet, another PC.

**Login:** Click "Continue without password" or use Google/GitHub login.

**Mobile:** Open the URL on your phone → add to Home Screen → App icon appears.

---

## 🔑 Your .env backup (keep safe — never commit)

```
ADMIN_PIN=your-pin
GITHUB_TOKEN=your-github-token
OPENROUTER_API_KEY=your-openrouter-key
GOOGLE_CLIENT_ID=your-google-client-id
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
```

> ⚠️ Copy your real keys from your local `.env` file. Never share them.

---

## 📱 Bot Recovery

| Bot | How to restore |
|-----|---------------|
| Telegram | Already running on @JensBeckerBot — no action needed |
| LINE | Token is in `.env` — set webhook URL in LINE Console again |
| WhatsApp | Token already deployed |
| Google Chat | API enabled — just add bot to a space |

---

## ☁️ Cloud Run — auto-heals

Cloud Run automatically restarts on:
- Crash
- Update
- No traffic (scales to zero, starts on next request)

No manual action needed. It's Google-managed infrastructure.

---

**TL;DR: Everything on GitHub + Cloud Run. PC crashes = clone → npm install → npm start.**
