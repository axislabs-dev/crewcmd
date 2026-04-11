#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK_HOME="${HOME}/.openclaw/hooks/crewcmd-hooks"

cd "$ROOT_DIR"
pnpm build

mkdir -p "$HOOK_HOME"
rsync -a --delete \
  --exclude 'node_modules' \
  --exclude '.turbo' \
  "$ROOT_DIR/" "$HOOK_HOME/"

openclaw hooks enable subagent-trace
openclaw gateway restart

echo "Installed CrewCmd hook pack to $HOOK_HOME"
