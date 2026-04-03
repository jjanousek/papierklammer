#!/bin/bash
set -e

cd /Users/aischool/work/papierklammer_droid

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  pnpm install
fi

echo "Init complete"
