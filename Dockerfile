FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ src/
COPY public/ public/
COPY .env.example .env

ENV PORT=8080

EXPOSE 8080

CMD ["node", "src/index.js"]
