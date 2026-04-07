FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src/ src/
COPY migrations/ migrations/
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/migrations ./migrations

# Carousel .hbs for GET /api/templates/* (renderer CAF_TEMPLATE_API_URL → caf-core)
COPY services/renderer/templates /app/carousel-templates
ENV CAROUSEL_TEMPLATES_DIR=/app/carousel-templates

EXPOSE 3847
CMD ["node", "dist/server.js"]
