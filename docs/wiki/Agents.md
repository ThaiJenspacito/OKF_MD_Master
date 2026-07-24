# Agents

Deep dive into the 9 autonomous agents.

## 1. Watcher
- **File**: `src/core/watcher.js`
- **Role**: Monitors directories for new .md files
- **Tech**: Chokidar (filesystem events)
- **Trigger**: File created or modified

## 2. Auto-Scanner
- **File**: `src/core/scheduler.js` (autoScanLaptop function)
- **Role**: Periodically searches for new files
- **Interval**: Every 5 minutes
- **Scope**: All configured watch directories

## 3. Scout
- **File**: `src/core/scout.js`
- **Role**: Copies files to sandbox, validates content
- **Validation**: Min 20 chars, max file size
- **Output**: `data/originals/` + `data/scouted/`

## 4. Architect
- **File**: `src/core/architect.js`
- **Role**: Transforms raw .md to OKF via LLM
- **Models**: Cohere, DeepSeek, Gemini with auto-fallback
- **Output**: YAML-frontmatter enriched .md in `data/okf_ready/`

## 5. Scheduler
- **File**: `src/core/scheduler.js`
- **Role**: Queue manager, idle-aware processing
- **Idle Gate**: CPU < 30%, user idle > 2 minutes
- **Batch Size**: Max 5 files per cycle

## 6. Quality Agent
- **File**: `src/core/okf-quality-agent.js`
- **Role**: Validates YAML, content, tags
- **Score**: 0-100% with letter grades (A+ through F)
- **Checks**: Required fields, content length, tag duplicates

## 7. Skill Agent
- **File**: `src/core/skill-agent.js`
- **Role**: Chat AI that answers from OKF knowledge
- **Context**: All OKF skills loaded as system prompt
- **Channels**: Web, Mobile, Telegram, LINE, WhatsApp, Google Chat

## 8. GitHub Bot
- **File**: `src/core/github-bot.js`
- **Role**: Auto-responds to GitHub issues
- **Escalation**: Assigns to @ThaiJenspacito when unsure
- **Labels**: `needs-human` for unanswered issues

## 9. Social Manager
- **File**: `src/core/social.js`
- **Role**: Generates platform-optimized posts
- **Platforms**: X, GitHub, Discord, Instagram, TikTok, YouTube, Facebook, Google
- **Features**: 8 platform-specific tones, hashtag generation
