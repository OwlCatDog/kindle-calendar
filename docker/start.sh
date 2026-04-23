#!/usr/bin/env bash
set -euo pipefail

python3 /app/fetch.py &
PYTHON_PID=$!

node /app/index.js &
NODE_PID=$!

cleanup() {
  kill -TERM "$PYTHON_PID" "$NODE_PID" 2>/dev/null || true
  wait "$PYTHON_PID" "$NODE_PID" 2>/dev/null || true
}

trap cleanup INT TERM

wait -n "$PYTHON_PID" "$NODE_PID"
STATUS=$?

cleanup
exit "$STATUS"
