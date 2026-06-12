# Fly.io Dockerfile — VoiceHub Server
FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY src/ ./src/

ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/index.js"]
