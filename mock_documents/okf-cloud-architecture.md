# OKF Cloud Architecture

The mirrored cloud deployment architecture for OKF MD Master.

## Structure

- **Cloud Run (Primary)**: Always-on, full processing, 9 agents, GitHub sync
- **Laptop (Client/Mirror)**: Read-only dashboard, chat via cloud API, auto-pull skills
- **GitHub (Sync Hub)**: Skills repository, P2P network, contributor tracking
- **Telegram (Quick Access)**: Text-based commands for mobile

## Security

- AI runs in Google Cloud (isolated)
- Laptop is read-only client — no critical data loss if stolen
- GitHub token limited to read/write repo only
- Cloud = source of truth, Laptop = cache

## Sync Flow

Cloud processes files → pushes skills to GitHub → Laptop pulls every 10min → Mobile reads via Cloud API

## Offline Mode

Laptop caches last 50 skills. Mobile uses Gemini Nano or Phi-2 for local AI. Re-syncs when online.
