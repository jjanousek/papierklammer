#!/bin/bash
set -euo pipefail

cd /Users/aischool/work/papierklammer_droid

if [ ! -d "node_modules" ]; then
  pnpm install
fi

NODE_COUNT="$(ps -Ao pid,args | grep '[n]ode' | wc -l | tr -d ' ')"
echo "Observed node-related process count before mission work: ${NODE_COUNT}"

if [ "${NODE_COUNT}" -gt 20 ]; then
  echo "WARNING: high Node process count detected; keep validation strictly sequential and do not start extra Node-heavy helpers"
fi

echo "Init complete"
