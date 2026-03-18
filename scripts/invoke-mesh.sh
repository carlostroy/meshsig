#!/bin/bash
# MeshSig Invoke — Wrapper for secure TypeScript implementation
TARGET="$1"; MESSAGE="$2"; CONTEXT="${3:-}"
if [ -z "$TARGET" ] || [ -z "$MESSAGE" ]; then
  echo '{"error":"Usage: invoke-mesh.sh <client_name> <message> [context]"}'; exit 1
fi
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MESH_DIR="${SCRIPT_DIR%/scripts}"
if [ -f "$MESH_DIR/dist/invoke-mesh.js" ]; then
  exec node "$MESH_DIR/dist/invoke-mesh.js" "$TARGET" "$MESSAGE" "$CONTEXT"
elif [ -f "/opt/meshsig/dist/invoke-mesh.js" ]; then
  exec node /opt/meshsig/dist/invoke-mesh.js "$TARGET" "$MESSAGE" "$CONTEXT"
else
  echo '{"error":"MeshSig not compiled. Run: cd /opt/meshsig && npx tsc"}'; exit 1
fi
