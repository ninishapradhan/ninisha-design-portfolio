#!/usr/bin/env bash
# refresh.sh — Rebuild plugins, sync to this portfolio repo, push to GitHub.
#
# Run from this repo's root:
#   ./refresh.sh
#
# Optional: ./refresh.sh "commit message in quotes"

set -euo pipefail

# Load nvm so `npm` is on PATH inside this non-interactive shell.
# Without this, scripts can't find npm even though Terminal can.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CS_PLUGIN="/Users/ninishapradhan/Downloads/davinci-case-studies-plugin"
HP_PLUGIN="/Users/ninishapradhan/Downloads/davinci-homepage-plugin"
COMMIT_MSG="${1:-Refresh portfolio: rebuild + sync latest plugin builds}"

step() { printf "\n\033[1;35m→ %s\033[0m\n" "$1"; }

# ──────────────────────────────────────────────────────────────────────
step "1/5  Rebuilding case-studies plugin"
if [ -d "$CS_PLUGIN" ]; then
  (cd "$CS_PLUGIN" && npm run build)
else
  echo "  ⚠  $CS_PLUGIN not found — skipping rebuild."
fi

step "2/5  Rebuilding homepage plugin"
if [ -d "$HP_PLUGIN" ]; then
  (cd "$HP_PLUGIN" && npm run build)
else
  echo "  ⚠  $HP_PLUGIN not found — skipping rebuild."
fi

# ──────────────────────────────────────────────────────────────────────
step "3/5  Syncing case-studies preview into portfolio"
if [ -d "$CS_PLUGIN/build/preview" ]; then
  # rsync is more efficient than cp for repeat runs (only changes files
  # that actually differ). --delete removes files no longer in source.
  rsync -a --delete \
    "$CS_PLUGIN/build/preview/" \
    "$REPO_ROOT/case-studies/"
  echo "  ✓ case-studies/ synced"
else
  echo "  ⚠  No preview build found at $CS_PLUGIN/build/preview — skipping."
fi

step "4/5  Re-wrapping homepage SSR with standalone HTML shell"
if [ -f "$HP_PLUGIN/build/ssr.html" ]; then
  # Refresh the assets folder
  rsync -a --delete "$HP_PLUGIN/assets/" "$REPO_ROOT/homepage/assets/"
  # Refresh the React bundle
  cp "$HP_PLUGIN/build/bundle.js" "$REPO_ROOT/homepage/bundle.js"
  # Rebuild homepage/index.html with the SSR body wrapped in a full HTML
  # shell, with {{ASSET_BASE}} placeholders replaced by relative paths.
  SSR_CONTENT=$(sed 's|{{ASSET_BASE}}|./assets/|g' "$HP_PLUGIN/build/ssr.html")
  cat > "$REPO_ROOT/homepage/index.html" <<HTML
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>DaVinci Commerce — Homepage (Portfolio Preview)</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;600;700;800&display=swap" />
<link rel="stylesheet" href="./assets/styles.css" />
<style>body { margin: 0; background: #fff; font-family: "Nunito Sans", system-ui, sans-serif; color: #250651; }</style>
<script>window.DAVINCI_HOMEPAGE_CONFIG = { assetsUrl: "./assets/", demoUrl: "https://davincicommerce.ai/demo/" };</script>
</head>
<body>
<div id="davinci-homepage-root">
$SSR_CONTENT
</div>
<script src="./bundle.js" defer></script>
</body>
</html>
HTML
  echo "  ✓ homepage/ refreshed"
else
  echo "  ⚠  No ssr.html found at $HP_PLUGIN/build/ — skipping."
fi

# ──────────────────────────────────────────────────────────────────────
step "5/5  Committing and pushing to GitHub"
cd "$REPO_ROOT"

if git diff --quiet && git diff --cached --quiet; then
  echo "  ✓ No changes — portfolio is already up to date."
  exit 0
fi

git add -A
git commit -m "$COMMIT_MSG"
git push origin main

echo ""
echo "✅ Done. Live site updates in ~1 minute at:"
echo "   https://ninishapradhan.github.io/ninisha-design-portfolio/"
