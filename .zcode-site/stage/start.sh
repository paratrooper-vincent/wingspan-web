#!/usr/bin/env bash
# 展翅翱翔 · 零依赖 Node 服务器
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
export NODE_ENV=production
export PORT="${PORT:-3000}"
export HOST=0.0.0.0 HOSTNAME=0.0.0.0
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=384}"
export DATA_DIR="${DATA_DIR:-$PWD/.data}"
mkdir -p "$DATA_DIR"
exec node server/server.js
