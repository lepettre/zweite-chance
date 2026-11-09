#!/usr/bin/env bash
# Veröffentlicht docs/ (App) + site/d (verschlüsselte Daten) als verlaufsloser Branch gh-pages.
# So wächst das Repository nicht, und auf main liegen nur Programmdateien.
set -euo pipefail
cd "${GITHUB_WORKSPACE:-$(pwd)}"
rm -rf out/pub && mkdir -p out/pub
cp docs/index.html docs/app.js docs/core.js docs/styles.css docs/bookmarklet.src.js out/pub/
cp -r site/d out/pub/d
touch out/pub/.nojekyll
cd out/pub
git init -q -b gh-pages
git config user.name "bot"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -A
git commit -q -m "Stand $(date -u +%Y-%m-%dT%H:%MZ)"
git remote add origin "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
for i in 1 2 3; do git push -q -f origin gh-pages && exit 0; sleep 5; done
echo "Veröffentlichen fehlgeschlagen" >&2
exit 1
