FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev
COPY index.js ./
ENV NODE_ENV=production
CMD ["node", "index.js"]
