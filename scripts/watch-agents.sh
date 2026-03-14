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
    echo "$dir_name|$did|$display_name" >> "$STATE_FILE"
    
    # Save identity
    local id_dir="/opt/meshsig/identities"
    mkdir -p "$id_dir"
    echo "$result" | python3 -c "
import sys,json
d=json.load(sys.stdin)
with open('$id_dir/${dir_name}.json','w') as f:
    json.dump(d['identity'],f,indent=2)
" 2>/dev/null

    # Install invoke-mesh.sh if agent has invoke-team skill
    local agent_dir="$CLIENTS_DIR/$dir_name"
    local skill_dir="$agent_dir/.openclaw/skills/invoke-team"
    if [ -d "$skill_dir" ]; then
      local invoke_file="$skill_dir/invoke.sh"
      if [ -f "$invoke_file" ] && ! grep -q "meshsig" "$invoke_file" 2>/dev/null; then
        cp "$invoke_file" "${invoke_file}.bak"
        cp /opt/meshsig/scripts/invoke-mesh.sh "$invoke_file"
        chmod +x "$invoke_file"
        echo -e "  ${GREEN}+${RESET} Installed invoke-mesh.sh on ${CYAN}$display_name${RESET}"
      fi
    fi

    # Create connections with existing agents
    connect_new_agent "$did" "$display_name"
  else
    echo -e "  ${RED}✗${RESET} Failed to register $display_name"
  fi
}

# Connect new agent to existing agents via handshake
connect_new_agent() {
  local new_did="$1"
  local new_name="$2"

  # Get all existing agents
  local agents=$(curl -s "$MESHSIG_URL/agents" 2>/dev/null)
  local count=$(echo "$agents" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('agents',[])))" 2>/dev/null)
  
  [ "$count" -lt 2 ] && return

  # Find managers — connect new agent to managers, or if new agent IS a manager, connect to all
  local is_manager=0
  echo "$new_name" | grep -iqE "gestor|gerente|manager|coo|ceo|antony|pedro" && is_manager=1

  echo "$agents" | python3 -c "
import sys, json, subprocess

data = json.load(sys.stdin)
agents = data.get('agents', [])
new_did = '$new_did'
is_manager = $is_manager

for a in agents:
    if a['did'] == new_did:
        continue
    # Connect if new agent is manager OR existing agent is manager
    a_caps = [c.get('type','') for c in a.get('capabilities',[])]
    if is_manager or 'management' in a_caps or 'delegation' in a_caps:
        print(f'{a[\"did\"]}|{a[\"displayName\"]}')
" 2>/dev/null | while IFS='|' read -r other_did other_name; do
    [ -z "$other_did" ] && continue
    # Get private keys from identities
    local new_key=$(python3 -c "
import json,glob
for f in glob.glob('/opt/meshsig/identities/*.json'):
    d=json.load(open(f))
    if d.get('did','')=='$new_did': print(d['privateKey']); break
" 2>/dev/null)
    local other_key=$(python3 -c "
import json,glob
for f in glob.glob('/opt/meshsig/identities/*.json'):
    d=json.load(open(f))
    if d.get('did','')=='$other_did': print(d['privateKey']); break
" 2>/dev/null)

    if [ -n "$new_key" ] && [ -n "$other_key" ]; then
      curl -s -X POST "$MESHSIG_URL/handshake" \
        -H 'Content-Type: application/json' \
        -d "{\"fromDid\":\"$new_did\",\"toDid\":\"$other_did\",\"privateKeyA\":\"$new_key\",\"privateKeyB\":\"$other_key\"}" > /dev/null 2>&1
      echo -e "  ${GREEN}⟷${RESET} ${CYAN}$new_name${RESET} ↔ ${CYAN}$other_name${RESET} — handshake verified"
    fi
  done
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
    if ! grep -q "^$name|" "$STATE_FILE" 2>/dev/null; then
      register_agent "$name"
      changes=$((changes + 1))
    fi
  done

  # Check for removed agents
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    local known_dir=$(echo "$line" | cut -d'|' -f1)
    local known_did=$(echo "$line" | cut -d'|' -f2)
    local known_name=$(echo "$line" | cut -d'|' -f3)
    local found=0
    for current in "${current_agents[@]}"; do
      if [ "$current" = "$known_dir" ]; then
        found=1
        break
      fi
    done

    if [ "$found" = "0" ]; then
      # Delete from MeshSig server
      if [ -n "$known_did" ]; then
        curl -s -X DELETE "$MESHSIG_URL/agents/$known_did" > /dev/null 2>&1
      fi
      echo -e "  ${RED}-${RESET} Agent removed: ${CYAN}${known_name:-$known_dir}${RESET}"
      # Remove from state file
      grep -v "^$known_dir|" "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
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
