# syntax=docker/dockerfile:1.7
FROM node:26.12.0-trixie-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN npm install --global --no-fund --no-audit pnpm@11.22.0
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @rotline/web build

FROM nginxinc/nginx-unprivileged:1.31.7-alpine AS runtime
# API_UPSTREAM: where /api is proxied; GAME_UPSTREAM: where /game WebSockets go
ENV API_UPSTREAM=http://api:3100 GAME_UPSTREAM=http://game:3200 DNS_RESOLVER=127.0.0.11 NGINX_ENVSUBST_FILTER=^(API_UPSTREAM|GAME_UPSTREAM|DNS_RESOLVER)$
COPY apps/web/docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
