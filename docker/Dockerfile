# syntax=docker/dockerfile:1.7
# Multi-stage build: deps -> build -> runtime. Target < 200 MB final image.

FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY apps/bot/package.json apps/bot/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm fetch

FROM deps AS build
WORKDIR /app
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
# Rebuild native modules need toolchain
RUN apk add --no-cache python3 make g++ sqlite-dev
COPY . .
RUN pnpm install --frozen-lockfile --offline
RUN pnpm -r build
RUN pnpm deploy --filter=@mosbot/bot --prod /prod/bot
RUN cp -r apps/web/dist /prod/bot/public

FROM node:20-alpine AS runtime
RUN apk add --no-cache tini
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /prod/bot .
RUN chown -R node:node /app
USER node
VOLUME ["/data", "/config", "/logs"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
