# Quelle: https://github.com/ThaiJenspacito/OKF_MD_Master
# GitHub: ThaiJenspacito/OKF_MD_Master

# OKF MD Master v2.1

**Autonome, lokal laufende Wissensbrücke** — verwandelt unstrukturierte Markdown-Notizen automatisch in das standardisierte **Open Knowledge Format (OKF)** mit YAML-Frontmatter. Entwickelt als Hintergrund-Infrastruktur fuer AI-Agenten und Google AI Studio.

---

## Kernfunktionen

- **Zero Data Loss** — Jede Quelldatei wird in 4 Stufen erhalten: `originals/`, `scouted/`, `okf_ready/`, `processed/`. Nichts wird je geloescht.
- **Idle-Aware** — Verarbeitet nur wenn der Rechner ungenutzt ist (>2 Min kein Input, CPU <30%). Keine Ressourcen-Belastung beim Arbeiten.
- **Cost-Routing** — Standard: DeepSeek (~0,014$/1K Tokens). Automatischer Fallback auf OpenRouter (kostenlose Modelle).
- **Offline-Ready** — DNS-Check vor API-Calls. Bei Netzwerkausfall: Queue wird gehalten und spaeter automatisch abgearbeitet.
- **Telegram-Steuerung** — Volles Dashboard, Token-Verbrauch, Scope-Kontrolle, Modellwechsel — alles per Chat.
- **Windows Tray** — Minimiert in die Taskleiste, startet mit Windows.
- **Lessons-Learned** — Fehlgeschlagene Verarbeitungen werden nicht verworfen, sondern archiviert.

---

## Architektur

```
mock_documents/               ← User schreibt .md-Dateien
       │
       ▼  (Chokidar Watcher)
  [Scheduler]  ◄── Idle-Detector (Win32 API + CPU)
       │
       ├──► [Scout]      → data/originals/  + data/scouted/
       │
       ├──► [Architect]  → LLM-Call (DeepSeek → OpenRouter Fallback)
       │                        │
       │                        ▼
       │                   data/okf_ready/    (OKF-Skills)
       │                   data/processed/    (Archiv)
       │                   data/lessons-learned/ (Fehlerarchiv)
       │
       ▼
  [Dashboard]     ← http://localhost:5000
  [Telegram Bot]  ← /dashboard /tokens /limit /scope /pause
  [Windows Tray]  ← Taskleiste
```

### Pipeline: 3 Agenten

| Agent | Datei | Funktion |
|-------|-------|----------|
| **Scout** | `src/core/scout.js` | Entdeckt .md-Dateien, filtert (Groesse/Inhalt), kopiert in Sandbox |
| **Architect** | `src/core/architect.js` | Transformiert via LLM ins OKF-Format, Retry-Logik, Lessons-Learned |
| **Scheduler** | `src/core/scheduler.js` | Queue-Manager, Idle-Gate, Offline-Erkennung, Batch-Steuerung |

---

## Verzeichnisstruktur

```
okf_md_master/
├── src/
│   ├── index.js              # Main Entry (startet alles)
│   ├── core/
│   │   ├── watcher.js        # Chokidar Multi-Dir Watch
│   │   ├── scout.js          # Datei-Entdeckung & Kopie
│   │   ├── architect.js      # LLM-OKF-Transformation
│   │   ├── scheduler.js      # Queue + Idle + Offline
│   │   ├── idle-detector.js  # Win32 GetLastInputInfo
│   │   └── reset-failed.js   # Utility: Status zuruecksetzen
│   ├── state/
│   │   ├── tracker.js        # JSON-Status pro Datei
│   │   └── config.js         # Runtime-Konfiguration
│   ├── server.js             # Web-Dashboard (Express)
│   ├── bot.js                # Telegram Bot
│   └── tray.js               # Windows System Tray
├── data/
│   ├── originals/            # Unveraenderte Originale
│   ├── scouted/             # Scout-Kopien
│   ├── okf_ready/           # OKF-transformierte Skills
│   ├── processed/           # Verarbeitete Archiv-Kopien
│   ├── failed/              # Temporaer fehlgeschlagen
│   ├── lessons-learned/     # Permanentes Fehlerarchiv
│   ├── state/               # JSON-Status-Tracker
│   └── index.md             # Master-Index aller Skills
├── logs/                    # scout.log, architect.log, system.log
├── mock_documents/          # Standard Watch-Ordner
├── backend/                 # Python/FastAPI (Platzhalter)
├── .env                     # Konfiguration
└── package.json
```

---

## Status-Modell

Jede Datei durchlaeuft eine definierte Zustandsmaschine:

```
discovered → scouted → architected → indexed → okf_ready
                ↓           ↓
             skipped      failed → retry (max 3x) → lessons_learned
```

Zustand wird in `data/state/<filename>.json` persistiert:

```json
{
  "id": "mein-erstes-wissen.md",
  "status": "okf_ready",
  "stages": {
    "discovered": { "at": "2026-07-22T10:00:00Z", "ok": true },
    "scouted": { "at": "2026-07-22T10:00:01Z", "ok": true },
    "architected": {
      "at": "2026-07-22T10:00:15Z", "ok": true,
      "model": "deepseek-chat", "provider": "deepseek",
      "inputTokens": 1200, "outputTokens": 300, "cost": 0.021
    },
    "indexed": { "at": "2026-07-22T10:00:16Z", "ok": true },
    "okf_ready": { "at": "2026-07-22T10:00:16Z", "ok": true }
  },
  "retries": 0, "maxRetries": 3
}
```

---

## OKF-Format

Jeder transformierte Skill erhaelt YAML-Frontmatter:

```yaml
---
name: LaundryList App Architect
description: Umfassende Architektur fuer eine Offline-First Android App
type: skill
version: 1.0.0
tags:
  - Android
  - Offline-First
  - JetpackCompose
---
```

Lessons-Learned werden mit `type: lessons-learned` und vollstaendigem Fehlerkontext archiviert.

---

## Konfiguration (.env)

```env
# LLM (schnell & kostenguenstig)
OKF_MODEL=deepseek-chat
OKF_FALLBACK_MODEL=google/gemma-3-27b-it:free
OKF_MAX_TOKENS=4096
DEEPSEEK_API_KEY=sk-xxx
OPENROUTER_API_KEY=sk-or-v1-xxx

# Scope-Kontrolle (Komma-getrennt, relativ oder absolut)
WATCH_DIRS=mock_documents
MAX_FILE_SIZE_KB=50

# Idle-Detection
IDLE_THRESHOLD_SEC=120
CPU_THRESHOLD_PCT=30

# Telegram
TELEGRAM_BOT_TOKEN=xxx
ALLOWED_CHAT_ID=xxx

# Server
PORT=5000
ADMIN_PIN=180473
```

---

## Installation & Start

```bash
# 1. Abhaengigkeiten installieren
npm install

# 2. .env konfigurieren (API-Keys eintragen)
copy .env.example .env   # falls vorhanden

# 3. Starten
npm start

# Einzeln:
npm run dashboard    # Nur Web-Dashboard
npm run reset-failed # Fehlgeschlagene zuruecksetzen
```

### Windows Autostart

Die Tray-App (`systray2`) startet mit dem System, wenn eine Verknuepfung in den Autostart-Ordner gelegt wird:

```
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
```

---

## Telegram-Befehle

| Befehl | Funktion |
|--------|----------|
| `/dashboard` | Komplette Uebersicht (Skills, Queue, Tokens, Modell) |
| `/tokens` | Token-Verbrauch + Kosten |
| `/limit 100` | Max-Dateigroesse auf 100 KB setzen |
| `/model deepseek-chat` | LLM-Modell wechseln |
| `/scope add ./ordner` | Watch-Bereich hinzufuegen |
| `/scope del ordner` | Watch-Bereich entfernen |
| `/pause` | Verarbeitung pausieren |
| `/resume` | Verarbeitung fortsetzen |
| `/help` | Alle Befehle anzeigen |

---

## Workflow

1. **Datei ablegen** — `.md`-Datei in einen der Watch-Ordner speichern
2. **Scout entdeckt** — Datei wird kopiert (original bleibt unangetastet)
3. **Scheduler wartet** — auf Idle-Zustand (120s kein Input, CPU <30%)
4. **Architect transformiert** — DeepSeek/OpenRouter erstellt OKF-YAML
5. **Skill bereit** — Liegt in `data/okf_ready/`, Index aktualisiert
6. **Bei Fehler** — 3 Retries, dann `data/lessons-learned/`

---

## Technologien

| Komponente | Technologie |
|------------|------------|
| Runtime | Node.js 24+ |
| LLM Primary | DeepSeek (OpenAI SDK) |
| LLM Fallback | OpenRouter (Gemma 3, kostenlos) |
| Web Dashboard | Express.js + Tailwind CSS |
| File Watch | Chokidar |
| Idle Detection | PowerShell + Win32 GetLastInputInfo |
| Telegram Bot | node-telegram-bot-api |
| Windows Tray | systray2 |
| YAML Parsing | gray-matter |
| Backend (Platzhalter) | Python FastAPI |

---

## Lizenz

MIT
