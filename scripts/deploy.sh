#!/usr/bin/env bash
# Rebuild the PWA and publish pwa/ to the gh-pages branch.
set -euo pipefail
npm run build:pwa
git add pwa && git commit -m "Rebuild PWA" || true
git subtree split --prefix pwa -b gh-pages-tmp
git push -f origin gh-pages-tmp:gh-pages
git branch -D gh-pages-tmp
