#!/usr/bin/env bash
# Single-source-of-truth icon sync. The ONE command that refreshes every
# Noah brand mark in both repos.
#
# What it does:
#   1. Runs brand/build.py to regenerate noah-icon.svg + noah-icon-plated.svg
#      from the parameter dict in build.py.
#   2. Runs brand/render-targets.py to push those SVGs out to every
#      consuming surface (website favicon, in-page logo, desktop splash,
#      Tauri icon variants, iOS, Android).
#
# If you ever discover a surface that's not unified — fix render-targets.py
# (add a new step + path) rather than copying files by hand.
#
# Usage:
#   bash brand/sync.sh

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PY="${PY:-$HOME/.claude-python/bin/python}"

if ! "$PY" -c "import cairosvg, PIL" 2>/dev/null; then
  echo "ERROR: cairosvg + Pillow required."
  echo "       Install: $PY -m pip install cairosvg Pillow" >&2
  exit 1
fi

echo "[1/2] Regenerating canonical SVGs..."
"$PY" "$HERE/build.py"

echo "[2/2] Rendering targets..."
"$PY" "$HERE/render-targets.py"

echo
echo "Refresh checklist for the user:"
echo "  • Website: deploy onnoah.app (wrangler pages deploy public)"
echo "  • Desktop dev: restart 'pnpm tauri dev' so new icon.icns is baked"
echo "  • Desktop release: rebuild + cut a release so users get the new icon"
