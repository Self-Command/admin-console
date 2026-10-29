# syntax=docker/dockerfile:1
# Build context is the admin-console repository root:
#   docker build -f apps/api/Dockerfile -t admin-api .
FROM node:24.22.1-alpine AS build
WORKDIR /src
ENV CI=1

RUN corepack enable && corepack prepare pnpm@11.28.5 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/lexicons/package.json packages/lexicons/
RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY packages/lexicons packages/lexicons

# The deploy target path must match the runtime path so that the absolute
# symlinks pnpm writes into node_modules stay valid inside the image.
RUN pnpm --filter @admin/api deploy --prod /app \
  && rm -rf /app/tests /app/vitest.config.ts /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/Dockerfile

FROM node:24.22.1-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app /app

USER node
EXPOSE 2587
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.ADMIN_API_PORT ?? 2587) + '/healthz').then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))"
STOPSIGNAL SIGTERM
CMD ["node", "--import", "tsx", "src/main.ts"]
