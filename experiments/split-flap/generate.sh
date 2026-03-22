#!/bin/bash
set -euo pipefail
# Generate a snapshot from the ideagui-pipe (F1).
# Falls back gracefully if clavain-cli is unavailable.
cd "$(dirname "$0")"
node ../ideagui-pipe/cli.js --factory-only > snapshot.json 2>/dev/null || \
  echo '{"error":"clavain-cli unavailable, use mock-snapshot.json"}' > snapshot.json
