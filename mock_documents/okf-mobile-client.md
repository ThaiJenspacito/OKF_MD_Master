# OKF Mobile Client Architecture

A mobile-first OKF client with offline capabilities and multi-model support.

## Architecture

- **PWA (Primary)**: Installable on iOS, Android, Windows, macOS. No store needed
- **Telegram Bot**: Quick text-based access. Commands: /dashboard, /tokens, /chat
- **Capacitor Apps (Phase 2)**: Native store apps from single codebase

## Offline AI

- **Gemini Nano**: Chrome built-in AI. 0 bytes download, runs locally
- **Phi-2 via Transformers.js**: Universal fallback. 150MB download
- **Cohere Free**: Online-only via OpenRouter. Default for connected mode
- **Cloud Agent**: Full OKF knowledge base. Requires internet

## Model Selector

User chooses per session:
1. Offline Fast (Gemini Nano) — instant, no network
2. Offline Precise (Phi-2) — slower, better quality
3. Online Free (Cohere) — balanced, needs net
4. Cloud Full (OKF Agent) — all skills, needs net

## UX

- 3 Taps: Scan QR → Install → Chat
- Bottom tab bar: Chat | Skills | Status
- Auto-detect: Handy → redirect to /mobile
- 30-day session: no re-login
- Dark theme optimized for OLED screens
