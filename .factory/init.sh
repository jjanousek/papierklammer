#!/bin/bash
set -euo pipefail

cd /Users/aischool/work/papierklammer_droid

if [ ! -d node_modules ]; then
  pnpm install
fi

mkdir -p /tmp/papierklammer-onboarding-mission

if [ -f /tmp/papierklammer-onboarding-mission/qa-app.pid ]; then
  PID="$(cat /tmp/papierklammer-onboarding-mission/qa-app.pid)"
  if ! kill -0 "$PID" 2>/dev/null; then
    rm -f /tmp/papierklammer-onboarding-mission/qa-app.pid
  fi
fi

if [ ! -f server/dist/index.js ] || [ ! -f server/ui-dist/index.html ]; then
  pnpm --filter @papierklammer/ui build
  pnpm --filter @papierklammer/server prepare:ui-dist
  pnpm --filter @papierklammer/server build
fi

REPO_NODE_COUNT="$( (ps -Ao pid,args | grep '[n]ode' | grep '/Users/aischool/work/papierklammer_droid' | wc -l | tr -d ' ') || true )"
echo "Observed repo-owned Node process count: ${REPO_NODE_COUNT}"

if [ -n "${REPO_NODE_COUNT}" ] && [ "${REPO_NODE_COUNT}" -gt 3 ]; then
  echo "WARNING: another mission or manual session already owns repo Node processes. Do not start extra long-running helpers unless required, and stop only the PIDs you started."
fi

echo "Init complete"
