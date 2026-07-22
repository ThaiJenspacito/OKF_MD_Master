# Express API Template

Ein minimales Express.js API-Template fuer REST-Services.

## Setup

```bash
npm init -y
npm install express cors helmet morgan dotenv
```

## Struktur

```
src/
  routes/
    users.js
    auth.js
  middleware/
    auth.js
    errorHandler.js
  models/
    user.js
  app.js
  server.js
```

## Middleware

- **Helmet** fuer Security-Header
- **CORS** mit Whitelist
- **Morgan** fuer Request-Logging
- **Rate Limiting** via express-rate-limit (100 req/15min)

## Endpunkte

- `POST /api/auth/login` - JWT Login
- `GET /api/users` - Alle User (admin)
- `POST /api/users` - User erstellen
