# Getting Started

## 30 Seconds to Running

```bash
git clone https://github.com/ThaiJenspacito/OKF_MD_Master.git
cd OKF_MD_Master
npm install
npm start
```

Open `http://localhost:5000` → Click **Continue without password**.

## Prerequisites

- **Node.js 22+** (recommended)
- **npm** (comes with Node.js)
- Optional: API keys for LLM providers (Cohere, DeepSeek, Gemini)

## Configuration

Copy `.env.example` to `.env` and add your API keys:

```env
# LLM Provider (at least one required)
OPENROUTER_API_KEY=sk-or-v1-xxx
DEEPSEEK_API_KEY=sk-xxx
GEMINI_API_KEY=AIza-xxx

# Admin
ADMIN_PIN=180473

# Optional: OAuth
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx
```

## First Run

1. Drop `.md` files into `mock_documents/`
2. The Scout agent detects them automatically
3. The Architect transforms them via LLM
4. OKF Skills appear in `data/okf_ready/`

## Deployment Options

- **Local**: `npm start` (Windows/Mac/Linux)
- **Cloud Run**: `gcloud run deploy` (auto-configured via `cloudbuild.yaml`)
- **Docker**: `docker build -t okf-md-master . && docker run -p 8080:8080 okf-md-master`

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Port 5000 in use | Change `PORT` in `.env` |
| LLM not working | Check API key in `.env` |
| No files processing | Check `WATCH_DIRS` in `.env` |
| Charts not loading | Refresh page (pure CSS, no CDN needed) |
