# Сайт афиши: сборка Next.js (output: standalone) и небольшой образ для запуска.
#
#   docker build -t afisha-web web
#   docker build -t afisha-web --build-arg NEXT_PUBLIC_API_BASE_URL=http://api:8000 web
#
# NEXT_PUBLIC_* вшиваются в сборку, поэтому это аргументы сборки, а не переменные запуска.
# ADMIN_TOKEN и остальные серверные переменные передаются при запуске (см. compose.yaml).

ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM ${NODE_IMAGE} AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_BASE_URL=
ARG NEXT_PUBLIC_DATA_MODE=demo
ARG NEXT_PUBLIC_TELEGRAM_BOT_URL=
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL} \
    NEXT_PUBLIC_DATA_MODE=${NEXT_PUBLIC_DATA_MODE} \
    NEXT_PUBLIC_TELEGRAM_BOT_URL=${NEXT_PUBLIC_TELEGRAM_BOT_URL} \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM ${NODE_IMAGE} AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3210 \
    HOSTNAME=0.0.0.0 \
    AFISHA_DATA_FILE=/data/admin-state.json
RUN addgroup -S -g 1001 afisha \
 && adduser -S -u 1001 -G afisha afisha \
 && mkdir -p /data \
 && chown afisha:afisha /data
COPY --from=build --chown=afisha:afisha /app/.next/standalone ./
COPY --from=build --chown=afisha:afisha /app/.next/static ./.next/static
COPY --from=build --chown=afisha:afisha /app/public ./public
USER afisha
EXPOSE 3210
VOLUME ["/data"]
# Проверяется сам сайт, а не бэк: /icon.svg отдаётся без похода в API.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3210/icon.svg >/dev/null || exit 1
CMD ["node", "server.js"]
