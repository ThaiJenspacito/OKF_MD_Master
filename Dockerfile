FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ src/
COPY public/ public/

RUN mkdir -p data/originals data/scouted data/okf_ready data/processed data/failed data/lessons-learned data/state logs mock_documents

ENV PORT=8080
ENV CLOUD_RUN=1

EXPOSE 8080

CMD ["node", "src/index.js"]
