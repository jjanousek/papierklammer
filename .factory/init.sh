#!/bin/bash
set -e

cd /Users/aischool/work/papierklammer_droid

# Install dependencies (idempotent)
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# Build all packages (needed for cross-workspace imports)
pnpm build
