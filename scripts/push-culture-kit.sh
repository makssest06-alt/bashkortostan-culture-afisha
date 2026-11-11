#!/usr/bin/env bash
# Дополнительный helper для повторной загрузки изображений Bashkir Culture Kit.
#
# Текущая ветка уже содержит все 113 PNG (~137 MB): для просмотра галереи этот скрипт
# запускать не нужно. Он пригодится только при восстановлении или замене изображений
# из отдельно сохранённого архива и выполняет commit + push в research/6-culture-kit.
#
# Использование:
#   1. Распакуйте архив — должна получиться папка bashkir-culture-kit/
#      с подпапками 01-ornament-kuskar ... 08-modern-branding внутри.
#   2. Запустите из любого каталога:
#        bash scripts/push-culture-kit.sh /путь/к/bashkir-culture-kit
#   3. Скрипт склонирует репозиторий во временную папку, переключится на ветку research/6-culture-kit,
#      скопирует изображения в design/culture-kit/, пересоберёт галерею, закоммитит и запушит.
#   Нужен настроенный доступ к репозиторию (SSH-ключ или gh auth login) и python3 (для галереи).

set -euo pipefail

KIT_SRC="${1:?Укажите путь к распакованной папке bashkir-culture-kit}"
REPO="git@github.com:makssest06-alt/bashkortostan-culture-afisha.git"
BRANCH="research/6-culture-kit"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "> Клонирую репозиторий..."
git clone --depth 1 --branch "$BRANCH" "$REPO" "$TMP/repo"

DEST="$TMP/repo/design/culture-kit"
mkdir -p "$DEST"

for d in 01-ornament-kuskar 02-vyshivka 03-symbols 04-kostyum-ukrasheniya 05-yurta-byt 06-shulgan-tash 07-nature-landmarks 08-modern-branding; do
  if [ -d "$KIT_SRC/$d" ]; then
    mkdir -p "$DEST/$d"
    # копируем только изображения; manifest.md уже в репозитории
    find "$KIT_SRC/$d" -maxdepth 1 -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' \) -exec cp {} "$DEST/$d/" \;
    echo "> $d: скопировано"
  else
    echo "! $d не найдена в $KIT_SRC — пропускаю"
  fi
done

# пересобираем офлайн-галерею по загруженным изображениям
if command -v python3 >/dev/null; then
  (cd "$TMP/repo" && python3 scripts/build-culture-gallery.py)
fi

cd "$TMP/repo"
git add design/culture-kit
git commit -m "chore: загрузить изображения Bashkir Culture Kit (113 референсов)" || { echo 'Нет новых файлов для коммита'; exit 0; }
git push origin "$BRANCH"
echo "> Готово: изображения в ветке $BRANCH, папка design/culture-kit/"
