# syntax=docker/dockerfile:1.7
# One-shot image that applies database migrations (DATABASE_DIRECT_URL, not the pooler).
FROM node:26.12.0-trixie-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN npm install --global --no-fund --no-audit pnpm@11.22.0

FROM base AS build
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @rotline/db deploy --legacy --prod /out \
	&& cp -r packages/db/prisma packages/db/prisma.config.ts /out/

FROM node:26.12.0-trixie-slim AS runtime
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /db
COPY --from=build --chown=node:node /out /db
USER node
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]
