#!/usr/bin/env bash
# Wöchentliche Sicherung der verschlüsselten Daten auf dem Branch "backup" (mit Verlauf).
# Es wird nur hinzugefügt, nie etwas entfernt. Unveränderte Monatsdateien sind byte-identisch,
# Git speichert sie deshalb nur einmal.
set -euo pipefail
cd "${GITHUB_WORKSPACE:-$(pwd)}"
URL="https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
DIR=out/backup
mkdir -p out
if git ls-remote --exit-code --heads "$URL" backup >/dev/null 2>&1; then
  [ -d "$DIR/.git" ] || git clone -q -b backup "$URL" "$DIR"
else
  mkdir -p "$DIR"
  [ -d "$DIR/.git" ] || { git -C "$DIR" init -q -b backup; git -C "$DIR" remote add origin "$URL"; }
fi
last=$(git -C "$DIR" log -1 --format=%ct 2>/dev/null || echo 0)
age=$(( $(date +%s) - last ))
if [ "$age" -lt 561600 ] && [ -z "${FORCE_BACKUP:-}" ]; then
  echo "Sicherung ist aktuell (vor $(( age / 3600 )) Std.)."
  exit 0
fi
mkdir -p "$DIR/d"
cp -f site/d/* "$DIR/d/"
cd "$DIR"
git config user.name "bot"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -A
if git diff --cached --quiet; then echo "Keine Änderung seit der letzten Sicherung."; exit 0; fi
git commit -q -m "Sicherung $(date -u +%Y-%m-%d)"
for i in 1 2 3; do git push -q origin backup && exit 0; sleep 5; done
echo "Sicherung konnte nicht gepusht werden" >&2
exit 1
