#!/usr/bin/env bash
# Veröffentlicht docs/ (App) + Daten als verlaufsloser Branch gh-pages.
#   publish.sh            -> Fundgrube-Lauf: besitzt d/ (k/ wird frisch vom Server übernommen)
#   publish.sh k a b ...  -> Katalog-/Sortiment-Lauf: besitzt nur die Dateien a, b ... in k/ (alles andere wird frisch übernommen)
# Langlaufende Jobs überschreiben so nie die Daten, die ein anderer Job inzwischen veröffentlicht hat.
set -euo pipefail
cd "${GITHUB_WORKSPACE:-$(pwd)}"
OWN="${1:-d}"; [ $# -gt 0 ] && shift || true
URL="https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
fresh="$(mktemp -d)"
git clone -q --depth 1 -b gh-pages "$URL" "$fresh" 2>/dev/null || mkdir -p "$fresh/d" "$fresh/k"
rm -rf out/pub && mkdir -p out/pub
cp docs/index.html docs/app.js docs/core.js docs/styles.css docs/bookmarklet.src.js out/pub/
cp docs/manifest.webmanifest out/pub/
cp -r docs/icons out/pub/icons
touch out/pub/.nojekyll
[ -d "$fresh/d" ] && cp -r "$fresh/d" out/pub/d
[ -d "$fresh/k" ] && cp -r "$fresh/k" out/pub/k
if [ "$OWN" = d ]; then
  rm -rf out/pub/d && cp -r site/d out/pub/d
else
  mkdir -p out/pub/k
  for f in "$@"; do [ -f "site/k/$f" ] && cp -f "site/k/$f" "out/pub/k/$f"; done
fi
cd out/pub
git init -q -b gh-pages
git config user.name "bot"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -A
git commit -q -m "Stand $(date -u +%Y-%m-%dT%H:%MZ)"
git remote add origin "$URL"
for i in 1 2 3; do git push -q -f origin gh-pages && exit 0; sleep 5; done
echo "Veröffentlichen fehlgeschlagen" >&2
exit 1
