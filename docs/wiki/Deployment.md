# Deployment

## Cloud Run (Recommended)

```bash
# One-time setup
gcloud auth login
gcloud config set project gen-lang-client-0382869895
gcloud services enable run.googleapis.com

# Deploy
gcloud run deploy thai-jenspacito-okf-md \
  --source . --region europe-west1 \
  --allow-unauthenticated --memory 512Mi --port 8080
```

## Docker

```bash
docker build -t okf-md-master .
docker run -p 8080:8080 -e CLOUD_RUN=1 okf-md-master
```

## GitHub Pages

```bash
# Settings → Pages → Source: Deploy from branch
# Branch: main → /docs → Save
# URL: https://thaijenspacito.github.io/OKF_MD_Master/
```

## CI/CD

Push to `main` triggers `cloudbuild.yaml`:
1. Docker build
2. Push to Container Registry
3. Deploy to Cloud Run

## Environment Variables (Cloud Run)

```
CLOUD_RUN=1
CLOUD_RUN_URL=https://thai-jenspacito-okf-md-299034318175.europe-west1.run.app
GOOGLE_CLIENT_ID=xxx
ADMIN_PIN=180473
OKF_MODEL=cohere/north-mini-code:free
TELEGRAM_BOT_TOKEN=xxx
LINE_CHANNEL_TOKEN=xxx
```
