# syntax=docker/dockerfile:1
# Build context is the admin-console repository root:
#   docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_ADMIN_API_URL=https://admin-api.example \
#     --build-arg NEXT_PUBLIC_ADMIN_API_DID=did:web:admin-api.example \
#     --build-arg NEXT_PUBLIC_DEFAULT_PDS=https://pds.example \
#     -t admin-web .
# NEXT_PUBLIC_* values are compiled into the browser bundle and must stay public.
FROM node:24.22.1-alpine AS build
WORKDIR /src
ENV CI=1 NEXT_TELEMETRY_DISABLED=1 NEXT_STANDALONE=1

RUN corepack enable && corepack prepare pnpm@11.28.5 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/lexicons/package.json packages/lexicons/
RUN pnpm install --frozen-lockfile

COPY apps/web apps/web

ARG NEXT_PUBLIC_ADMIN_API_URL=http://127.0.0.1:2587
ARG NEXT_PUBLIC_ADMIN_API_DID=did:web:localhost%3A2587
ARG NEXT_PUBLIC_DEFAULT_PDS=https://bsky.social
ENV NEXT_PUBLIC_ADMIN_API_URL=$NEXT_PUBLIC_ADMIN_API_URL \
    NEXT_PUBLIC_ADMIN_API_DID=$NEXT_PUBLIC_ADMIN_API_DID \
    NEXT_PUBLIC_DEFAULT_PDS=$NEXT_PUBLIC_DEFAULT_PDS

RUN pnpm --filter @admin/web build

FROM node:24.22.1-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8101 HOSTNAME=0.0.0.0
WORKDIR /app

# The traced tree keeps the workspace layout: server at apps/web/server.js,
# production node_modules at the root. Static assets are not traced.
COPY --from=build --chown=node:node /src/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /src/apps/web/.next/static ./apps/web/.next/static
RUN mkdir -p /app/apps/web/.next/cache && chown -R node:node /app/apps/web/.next

USER node
EXPOSE 8101
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT ?? 8101) + '/healthz').then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))"
STOPSIGNAL SIGTERM
CMD ["node", "apps/web/server.js"]
