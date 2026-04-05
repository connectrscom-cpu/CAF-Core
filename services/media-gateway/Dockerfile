FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      chromium ffmpeg fonts-noto-color-emoji fonts-noto-cjk ca-certificates && \
    rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY renderer/package.json renderer/package-lock.json* renderer/
COPY video-assembly/package.json video-assembly/package-lock.json* video-assembly/
COPY media-gateway/package.json media-gateway/package-lock.json* media-gateway/

RUN cd renderer && npm install --production && cd .. && \
    cd video-assembly && npm install --production && cd .. && \
    cd media-gateway && npm install --production

COPY renderer/ renderer/
COPY video-assembly/ video-assembly/
COPY media-gateway/ media-gateway/

EXPOSE 3300

CMD ["node", "media-gateway/server.js"]
