#!/usr/bin/env bash
# Готовит .env для docker compose: генерирует ADMIN_TOKEN и POSTGRES_PASSWORD,
# чтобы API не падал на production-проверках с placeholder из .env.example.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  cp .env.example .env
fi

generate_token() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
  fi
}

replace_value() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key}=" .env; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" .env
  else
    printf '\n%s=%s\n' "$key" "$value" >> .env
  fi
}

if grep -qE '^ADMIN_TOKEN=(|change-me-to-a-long-random-string)$' .env; then
  replace_value ADMIN_TOKEN "$(generate_token)"
fi
if grep -qE '^POSTGRES_PASSWORD=(|afisha)$' .env; then
  replace_value POSTGRES_PASSWORD "$(generate_token)"
fi

rm -f .env.bak
chmod 600 .env

echo "Готово: .env создан/обновлён, ADMIN_TOKEN и POSTGRES_PASSWORD сгенерированы."
echo "Осталось указать TELEGRAM_BOT_TOKEN (и LLM_API_KEY, если нужен живой LLM), затем:"
echo "  docker compose up --build"
