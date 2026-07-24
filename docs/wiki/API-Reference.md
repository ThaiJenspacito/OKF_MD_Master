# API Reference

## Base URL

```
Local:  http://localhost:5000
Cloud:  https://thai-jenspacito-okf-md-299034318175.europe-west1.run.app
```

## Authentication

Most endpoints require login. Use one of:
- **Dev Bypass**: `GET /auth/dev` (development only)
- **Google OAuth**: POST credential to `/auth/google`
- **GitHub OAuth**: `GET /auth/github`
- **PIN**: POST `pin=180473` to `/login`

## Endpoints

### Status & Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | System status (scheduler, stats, config) |
| GET | `/api/health` | Health check (scheduler, LLM, memory) |
| GET | `/api/report` | Server report (CPU, RAM, Disk gauges) |

### Skills & Knowledge

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/library` | All skills with metadata |
| GET | `/api/knowledge` | Download full knowledge bundle (MD) |
| GET | `/api/knowledge/context` | RAG-ready context (JSON) |
| GET | `/api/download/:file` | Download single skill |
| GET | `/api/quality/report` | Quality audit report |

### Actions

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/scout/scan` | Trigger scout scan |
| POST | `/api/architect/process` | Trigger LLM transformation |
| POST | `/api/upload` | Upload .md file (multipart) |
| POST | `/api/fetch` | Fetch URL or GitHub repo |
| POST | `/api/fetch/model` | Fetch HuggingFace model docs |
| GET | `/api/scan/laptop` | Scan laptop for .md files |
| POST | `/api/scheduler/pause` | Pause processing |
| POST | `/api/scheduler/resume` | Resume processing |

### Chat & Social

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/chat` | Skill Agent chat query |
| POST | `/api/social/generate` | Generate social posts |
| GET | `/api/social/skills` | List skills for social |

### GitHub Integration

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/github/process` | Process GitHub issues |
| GET | `/api/github/stats` | GitHub bot statistics |
| POST | `/api/sync` | P2P skill sync |

### Bot Webhooks

| Method | Path | Description |
|--------|------|-------------|
| POST | `/telegram/webhook` | Telegram bot |
| POST | `/line/webhook` | LINE bot |
| POST | `/whatsapp/webhook` | WhatsApp bot |
| POST | `/google-chat/webhook` | Google Chat bot |
