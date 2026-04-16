#!/bin/bash
set -euo pipefail

cd /Users/aischool/work/papierklammer_droid

if [ ! -d "node_modules" ]; then
  pnpm install
fi

mkdir -p /tmp/papierklammer-tui-mission

python3 <<'PY'
import os
import signal
import subprocess

repo = "/Users/aischool/work/papierklammer_droid"
patterns = [
    "scripts/dev-with-tui.mjs",
    "scripts/dev-tui.mjs",
    "server/scripts/dev-watch.ts",
    "packages/orchestrator-tui/src/index.tsx",
    "../scripts/dev-runner.ts watch",
    "codex app-server",
]

try:
    output = subprocess.check_output(["ps", "-Ao", "pid=,command="], text=True)
except subprocess.CalledProcessError:
    output = ""

for line in output.splitlines():
    stripped = line.strip()
    if not stripped:
        continue
    pid_text, _, command = stripped.partition(" ")
    if not pid_text.isdigit():
        continue
    pid = int(pid_text)
    if pid == os.getpid():
        continue
    if repo not in command:
        continue
    if any(pattern in command for pattern in patterns):
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
PY

pnpm dev:stop >/dev/null 2>&1 || true

REPO_NODE_COUNT="$( (ps -Ao pid,args | grep '[n]ode' | grep '/Users/aischool/work/papierklammer_droid' | wc -l | tr -d ' ') || true )"
echo "Observed repo-owned Node process count after cleanup: ${REPO_NODE_COUNT}"

if [ "${REPO_NODE_COUNT}" -gt 6 ]; then
  echo "WARNING: repo-owned Node process count is already high; avoid starting overlapping app/TUI/Codex helpers until it is reduced"
fi

echo "Init complete"
