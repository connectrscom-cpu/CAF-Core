FROM node:20-slim AS review-builder
WORKDIR /app
# Core deps for webpack when Review bundles ../../src/services (e.g. @supabase/supabase-js).
COPY package.json package-lock.json* ./
# Review build typechecks ../../src (needs @types/pg etc.)
RUN npm ci
COPY apps/review/package.json apps/review/package-lock.json ./apps/review/
RUN cd apps/review && npm ci
COPY apps/review ./apps/review
COPY src ./src
COPY tsconfig.json ./
RUN cd apps/review && npm run build
RUN cp -r apps/review/.next/static apps/review/.next/standalone/.next/static

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

# Embedded CAF Review (Next.js standalone)
COPY --from=review-builder /app/apps/review/.next/standalone /app/review-standalone
ENV CAF_REVIEW_STANDALONE_DIR=/app/review-standalone
ENV CAF_REVIEW_ENABLED=1

# Carousel .hbs for GET /api/templates/* (renderer CAF_TEMPLATE_API_URL → caf-core)
COPY services/renderer/templates /app/carousel-templates
ENV CAROUSEL_TEMPLATES_DIR=/app/carousel-templates

EXPOSE 3847
CMD ["node", "dist/server.js"]
