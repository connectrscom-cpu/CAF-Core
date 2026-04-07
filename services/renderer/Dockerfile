FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      chromium fonts-noto-color-emoji fonts-noto-cjk ca-certificates && \
    rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY server.js ./
COPY templates/ ./templates/

EXPOSE 3333

CMD ["node", "server.js"]
