#!/usr/bin/env bash
# Holt den zuletzt veröffentlichten Stand (verschlüsselte Daten) nach site/d.
set -euo pipefail
cd "${GITHUB_WORKSPACE:-$(pwd)}"
rm -rf site
if git ls-remote --exit-code --heads "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" gh-pages >/dev/null 2>&1; then
  git clone -q --depth 1 -b gh-pages "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" site
else
  echo "Noch kein gh-pages-Branch - erster Lauf."
  mkdir -p site/d
fi
