#!/bin/bash
# ==============================================================================
# MeshSig Uninstall — Restores original invoke.sh
# ==============================================================================

CLIENT_DIR="/root/clients"

echo ""
echo "  Restoring original invoke.sh files..."
echo ""

for d in "$CLIENT_DIR"/agent-*/; do
  agent_name=$(basename "$d")
  skill_dir="$d/.openclaw/workspace/skills/invoke-team"
  backup="$skill_dir/invoke.sh.original"
  
  if [ -f "$backup" ]; then
    cp "$backup" "$skill_dir/invoke.sh"
    echo "  ✓ $agent_name — restored original invoke.sh"
  fi
done

echo ""
echo "  Done. MeshSig signing removed. Original communication restored."
echo ""
