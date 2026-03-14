#!/bin/bash
# ============================================================================
# MeshSig — Agent Auto-Discovery Daemon
# Watches /root/clients/ for new or removed agents.
# Registers new agents automatically. Removes deleted ones.
# 
# Usage:
#   bash scripts/watch-agents.sh              # Run in foreground
#   bash scripts/watch-agents.sh &            # Run in background
#   systemctl start meshsig-watcher           # Run as service
#
# Environment:
#   MESHSIG_URL      MeshSig server (default: http://localhost:4888)
#   CLIENTS_DIR      Agents directory (default: /root/clients)
#   WATCH_INTERVAL   Seconds between scans (default: 30)
# ============================================================================

set -e

MESHSIG_URL="${MESHSIG_URL:-http://localhost:4888}"
CLIENTS_DIR="${CLIENTS_DIR:-/root/clients}"
WATCH_INTERVAL="${WATCH_INTERVAL:-30}"
STATE_FILE="$HOME/.meshsig/known-agents.txt"

CYAN='\033[0;36m'
GREEN='\033[0;32m'
RED='\033[0;31m'
DIM='\033[2m'
RESET='\033[0m'

mkdir -p "$(dirname "$STATE_FILE")"
touch "$STATE_FILE"

# Auto-detect capabilities from agent name
detect_capabilities() {
  local name="$1"
  local lower=$(echo "$name" | tr '[:upper:]' '[:lower:]')
  local caps=""

  case "$lower" in
    *gestor*|*gerente*|*manager*|*coo*|*ceo*)
      caps='[{"type":"management","confidence":0.95},{"type":"delegation","confidence":0.9}]' ;;
    *atendente*|*suporte*|*support*|*cs*)
      caps='[{"type":"customer-support","confidence":0.92}]' ;;
    *sdr*|*vendas*|*sales*)
      caps='[{"type":"sales","confidence":0.9}]' ;;
    *social*|*marketing*|*mkt*)
      caps='[{"type":"social-media","confidence":0.88}]' ;;
    *analista*|*analyst*|*data*)
      caps='[{"type":"analysis","confidence":0.9}]' ;;
    *copy*|*writer*|*redator*)
      caps='[{"type":"copywriting","confidence":0.88}]' ;;
    *dev*|*code*|*eng*)
      caps='[{"type":"development","confidence":0.9}]' ;;
    *)
      caps='[{"type":"general","confidence":0.8}]' ;;
  esac

  echo "$caps"
}

# Get display name from directory name
get_display_name() {
  local dir="$1"
  # agent-neto---gestor-de-ia-17734011 → Neto
  echo "$dir" | sed 's/^agent-//' | cut -d'-' -f1 | sed 's/.*/\u&/'
}

# Register a new agent
register_agent() {
  local dir_name="$1"
  local display_name=$(get_display_name "$dir_name")
  local caps=$(detect_capabilities "$dir_name")

  local result=$(curl -s -X POST "$MESHSIG_URL/agents/register" \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"$display_name\",\"capabilities\":$caps}" 2>/dev/null)

  local did=$(echo "$result" | python3 -c "import sys,json;print(json.load(sys.stdin)['record']['did'])" 2>/dev/null)

  if [ -n "$did" ]; then
    echo -e "  ${GREEN}+${RESET} Registered ${CYAN}$display_name${RESET} → ${DIM}$did${RESET}"
    echo "$dir_name" >> "$STATE_FILE"
    
    # Save identity to agent directory for invoke-mesh.sh
    local id_dir="/opt/meshsig/identities"
    mkdir -p "$id_dir"
    echo "$result" | python3 -c "
import sys,json
d=json.load(sys.stdin)
with open('$id_dir/${dir_name}.json','w') as f:
    json.dump(d['identity'],f,indent=2)
" 2>/dev/null
  else
    echo -e "  ${RED}✗${RESET} Failed to register $display_name"
  fi
}

# Scan and sync
scan() {
  if [ ! -d "$CLIENTS_DIR" ]; then
    return
  fi

  local current_agents=()
  local changes=0

  # Find all agent directories
  for dir in "$CLIENTS_DIR"/*/; do
    [ -d "$dir" ] || continue
    local name=$(basename "$dir")
    
    # Skip non-agent directories
    [ "$name" = "." ] || [ "$name" = ".." ] && continue
    
    current_agents+=("$name")

    # Check if already registered
    if ! grep -qx "$name" "$STATE_FILE" 2>/dev/null; then
      register_agent "$name"
      changes=$((changes + 1))
    fi
  done

  # Check for removed agents
  while IFS= read -r known; do
    [ -z "$known" ] && continue
    local found=0
    for current in "${current_agents[@]}"; do
      if [ "$current" = "$known" ]; then
        found=1
        break
      fi
    done

    if [ "$found" = "0" ]; then
      local display_name=$(get_display_name "$known")
      echo -e "  ${RED}-${RESET} Agent removed: ${CYAN}$display_name${RESET}"
      # Remove from state file
      grep -vx "$known" "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
      changes=$((changes + 1))
    fi
  done < "$STATE_FILE"

  if [ "$changes" -gt 0 ]; then
    echo -e "  ${DIM}$(date '+%H:%M:%S') — $changes change(s) detected${RESET}"
  fi
}

# Main
echo ""
echo -e "${CYAN}MeshSig Agent Watcher${RESET}"
echo -e "${DIM}  Server:   $MESHSIG_URL${RESET}"
echo -e "${DIM}  Watching: $CLIENTS_DIR${RESET}"
echo -e "${DIM}  Interval: ${WATCH_INTERVAL}s${RESET}"
echo ""

# Initial scan
echo -e "${DIM}Initial scan...${RESET}"
scan

echo -e "${GREEN}●${RESET} Watching for changes every ${WATCH_INTERVAL}s..."
echo ""

# Watch loop
while true; do
  sleep "$WATCH_INTERVAL"
  scan
done
