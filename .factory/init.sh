#!/bin/bash
set -euo pipefail

cd /Users/aischool/work/papierklammer_droid

if [ ! -d "node_modules" ]; then
  pnpm install
fi

mkdir -p /tmp/papierklammer-mission-64c225d0

if ! command -v codex >/dev/null 2>&1; then
  echo "WARNING: codex CLI is not installed; codex_local validation will be blocked"
fi

echo "Init complete"
