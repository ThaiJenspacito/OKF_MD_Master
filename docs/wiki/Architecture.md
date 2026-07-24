# Architecture

## System Overview

OKF MD Master consists of **9 autonomous agents** working together in a pipeline:

```
.md files → Watcher → Auto-Scanner → Scout → Architect → Scheduler
                                              ↓
                                         OKF Skills
                                              ↓
                                    Quality Agent · Skill Agent · GitHub Bot · Social Manager
```

## The 9 Agents

| # | Agent | Role | Trigger |
|---|-------|------|---------|
| 1 | **Watcher** | File Monitor | Filesystem events (Chokidar) |
| 2 | **Auto-Scanner** | Device Discovery | Every 5 minutes |
| 3 | **Scout** | Copy & Validate | New file detected |
| 4 | **Architect** | LLM Transform | Files in queue + idle |
| 5 | **Scheduler** | Idle-Aware Processing | Every 10 seconds |
| 6 | **Quality Agent** | YAML Validation | On demand / after transform |
| 7 | **Skill Agent** | Chat AI | User questions |
| 8 | **GitHub Bot** | Issue Responder | Hourly / on demand |
| 9 | **Social Manager** | Post Generator | On demand |

## Data Flow

```
Source (.md) → data/originals/ (backup)
             → data/scouted/   (validated copy)
             → data/okf_ready/ (transformed, indexed)
             → data/processed/ (archive)
             
Failed → data/failed/ (retry up to 3x)
       → data/lessons-learned/ (archived forever)
```

## State Machine

```
discovered → scouted → architected → indexed → okf_ready
                ↓           ↓
             skipped      failed → retry (max 3x) → lessons_learned
```

## Key Design Principles

- **Zero Data Loss**: Every source file preserved in 4 copies
- **Idle-Aware**: Only processes when CPU < 30% and user idle > 2 min
- **Provider Flexibility**: Cohere, DeepSeek, Gemini with automatic fallback
- **P2P Sync**: Skills shared via GitHub between nodes
