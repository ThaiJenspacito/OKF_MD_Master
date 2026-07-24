# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please **do not** open a public issue.

Instead, report it to: **mail@jensbecker.com**

We will respond within 48 hours and work with you on a fix.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.x (main) | ✅ Active |
| 1.x | ❌ EOL |

## Security Features

- All OKF skills are validated via the Quality Agent before release
- API keys are never stored in the repository
- `.env` is gitignored — credentials stay local
- GitHub OAuth requires verified client IDs
- Cloud Run runs in Google's isolated environment
- LINE webhook signature verification enforced
- WhatsApp webhook verify token required
- 30-day session expiry with secure cookies

## Dependencies

- Dependencies are audited via `npm audit`
- Critical updates applied within 7 days
- No telemetry or tracking in the codebase
