# Build context MUST be the CAF-Core repository root:
#   fly deploy -c fly.caf-renderer.toml
# (Paths use services/… so COPY sees renderer + video-assembly + gateway.)

FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      chromium ffmpeg fonts-noto-color-emoji fonts-noto-cjk ca-certificates && \
    rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY services/renderer/package*.json renderer/
COPY services/video-assembly/package*.json video-assembly/
COPY services/media-gateway/package*.json media-gateway/

RUN cd renderer && npm install --production && cd .. && \
    cd video-assembly && npm install --production && cd .. && \
    cd media-gateway && npm install --production

COPY services/renderer/ renderer/
COPY services/video-assembly/ video-assembly/
COPY services/media-gateway/ media-gateway/

EXPOSE 8080

CMD ["node", "media-gateway/server.js"]
