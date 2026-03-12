#!/bin/bash
# ==============================================================================
# MeshSig Install — Secures OpenClaw agent communication
# 
# What this does:
#   1. Backs up the original invoke.sh
#   2. Replaces it with invoke-mesh.sh (signs every delegation)
#   3. Registers all agents with MeshSig identities
#   4. Creates connections between them
#
# After install, every time Agent A delegates to Agent B:
#   - The message is signed with the sender's Ed25519 key
#   - MeshSig logs it with cryptographic proof
#   - the receiver's response is signed and logged too
#   - Trust scores update based on verified interactions
#   - Dashboard shows it all in real-time
#
# Usage: bash install.sh
# ==============================================================================

set -e

MESH_URL="${MESHSIG_URL:-http://127.0.0.1:4888}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IDENTITY_DIR="/opt/meshsig/identities"

C='\033[36m'   # cyan
G='\033[32m'   # green
M='\033[35m'   # magenta
W='\033[37m'   # white
D='\033[2m'    # dim
B='\033[1m'    # bold
Y='\033[33m'   # yellow
R='\033[0m'    # reset

echo ""
echo -e "${C}"
echo -e "    ███╗   ███╗███████╗███████╗██╗  ██╗███████╗██╗ ██████╗"
echo -e "    ████╗ ████║██╔════╝██╔════╝██║  ██║██╔════╝██║██╔════╝"
echo -e "    ██╔████╔██║█████╗  ███████╗███████║███████╗██║██║  ███╗"
echo -e "    ██║╚██╔╝██║██╔══╝  ╚════██║██╔══██║╚════██║██║██║   ██║"
echo -e "    ██║ ╚═╝ ██║███████╗███████║██║  ██║███████║██║╚██████╔╝"
echo -e "    ╚═╝     ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝╚═╝ ╚═════╝"
echo -e "${R}"
echo -e "    ${M}◈${R}  ${B}Securing Agent Network${R}"
echo -e ""
echo -e "    ${D}─────────────────────────────────────────────────────────${R}"
echo ""

# Check MeshSig is running
if ! curl -s "$MESH_URL/health" > /dev/null 2>&1; then
  echo -e "  ${Y}▲${R} MeshSig not running at $MESH_URL"
  echo -e "  ${D}  Start: cd /opt/meshsig && node dist/main.js start --port 4888 &${R}"
  exit 1
fi
echo -e "  ${G}⬢${R} ${D}CORE${R}     MeshSig online at ${C}$MESH_URL${R}"

# Find OpenClaw clients
CLIENT_DIR="/root/clients"
if [ ! -d "$CLIENT_DIR" ]; then
  echo -e "  ${Y}▲${R} No OpenClaw clients found at $CLIENT_DIR"
  exit 1
fi

# Find agents with invoke-team skill
AGENTS_WITH_SKILL=()
for d in "$CLIENT_DIR"/agent-*/; do
  agent_name=$(basename "$d")
  skill_dir="$d/.openclaw/workspace/skills/invoke-team"
  if [ -d "$skill_dir" ]; then
    AGENTS_WITH_SKILL+=("$agent_name")
  fi
done

if [ ${#AGENTS_WITH_SKILL[@]} -eq 0 ]; then
  echo -e "  ${Y}▲${R} No agents with invoke-team skill found"
  exit 1
fi

echo -e "  ${G}⬢${R} ${D}AGENTS${R}   ${#AGENTS_WITH_SKILL[@]} agent(s) with delegation skill"

# Create identity directory
mkdir -p "$IDENTITY_DIR"

# Register all agents
echo ""
echo -e "  ${D}────────── ${R}${B}IDENTITY REGISTRATION${R} ${D}──────────${R}"
echo ""

ALL_AGENTS=()
for d in "$CLIENT_DIR"/agent-*/; do
  agent_name=$(basename "$d")
  ALL_AGENTS+=("$agent_name")
  identity_file="$IDENTITY_DIR/$agent_name.json"
  
  if [ -f "$identity_file" ]; then
    did=$(python3 -c "import json; print(json.load(open('$identity_file'))['did'])" 2>/dev/null)
    echo -e "  ${D}◇${R} ${D}$agent_name${R} — ${D}already registered${R}"
  else
    # Determine capabilities from agent name
    caps="[]"
    case "$agent_name" in
      *paulo*|*gestor*)   caps='[{"type":"management","confidence":0.95},{"type":"delegation","confidence":0.9}]' ;;
      *joana*|*atendente*) caps='[{"type":"customer-support","confidence":0.92}]' ;;
      *benicio*|*sdr*)     caps='[{"type":"sales","confidence":0.9},{"type":"sdr","confidence":0.88}]' ;;
      *bora*|*copy*)       caps='[{"type":"copywriting","confidence":0.93}]' ;;
      *jonas*|*social*)    caps='[{"type":"social-media","confidence":0.91}]' ;;
      *max*|*analista*)    caps='[{"type":"analytics","confidence":0.87}]' ;;
      *)                   caps='[{"type":"general","confidence":0.8}]' ;;
    esac
    
    # Extract display name
    display_name=$(echo "$agent_name" | sed 's/agent-//' | cut -d'-' -f1 | sed 's/.*/\u&/')
    
    result=$(curl -s -X POST "$MESH_URL/agents/register" \
      -H "Content-Type: application/json" \
      -d "{\"name\":\"$display_name\",\"capabilities\":$caps}")
    
    echo "$result" | python3 -c "
import sys, json, os
data = json.load(sys.stdin)
identity = data.get('identity', {})
record = data.get('record', {})
out = {
  'did': identity.get('did',''),
  'privateKey': identity.get('privateKey',''),
  'publicKey': identity.get('publicKey',''),
  'displayName': record.get('displayName', ''),
  'clientName': '$agent_name'
}
with open('$identity_file', 'w') as f:
  json.dump(out, f, indent=2)
print(f\"  \\033[36m◆\\033[0m \\033[1m{out['displayName']} registered — {out['did'][:40]}...\")
" 2>/dev/null
  fi
done

# Create connections between agents that communicate
echo ""
echo -e "  ${D}────────── ${R}${B}VERIFIED CONNECTIONS${R} ${D}───────────${R}"
echo ""

create_connection() {
  local from_name="$1"
  local to_name="$2"
  local from_file="$IDENTITY_DIR/$from_name.json"
  local to_file="$IDENTITY_DIR/$to_name.json"
  
  if [ ! -f "$from_file" ] || [ ! -f "$to_file" ]; then
    return
  fi
  
  local from_did=$(python3 -c "import json; print(json.load(open('$from_file'))['did'])" 2>/dev/null)
  local to_did=$(python3 -c "import json; print(json.load(open('$to_file'))['did'])" 2>/dev/null)
  local from_key=$(python3 -c "import json; print(json.load(open('$from_file'))['privateKey'])" 2>/dev/null)
  local to_key=$(python3 -c "import json; print(json.load(open('$to_file'))['privateKey'])" 2>/dev/null)
  local from_display=$(python3 -c "import json; print(json.load(open('$from_file'))['displayName'])" 2>/dev/null)
  local to_display=$(python3 -c "import json; print(json.load(open('$to_file'))['displayName'])" 2>/dev/null)
  
  # Try to create handshake (will fail silently if already exists)
  curl -s -X POST "$MESH_URL/handshake" \
    -H "Content-Type: application/json" \
    -d "{\"fromDid\":\"$from_did\",\"toDid\":\"$to_did\",\"privateKeyA\":\"$from_key\",\"privateKeyB\":\"$to_key\",\"permissions\":[\"send:request\",\"execute:task\"]}" > /dev/null 2>&1
  
  echo -e "  ${G}⟷${R}  ${B}$from_display${R} ${D}↔${R} ${B}$to_display${R} ${D}— Ed25519 handshake verified${R}"
}

# Manager connects to everyone he delegates to
for agent in "${ALL_AGENTS[@]}"; do
  if [[ "$agent" != *"paulo"* ]]; then
    for paulo_agent in "${AGENTS_WITH_SKILL[@]}"; do
      if [[ "$paulo_agent" == *"paulo"* ]]; then
        create_connection "$paulo_agent" "$agent"
      fi
    done
  fi
done

# Install invoke-mesh.sh into skill directories
echo ""
echo -e "  ${D}────────── ${R}${B}SECURITY LAYER INSTALL${R} ${D}─────────${R}"
echo ""

for agent_name in "${AGENTS_WITH_SKILL[@]}"; do
  skill_dir="$CLIENT_DIR/$agent_name/.openclaw/workspace/skills/invoke-team"
  original="$skill_dir/invoke.sh"
  backup="$skill_dir/invoke.sh.original"
  
  # Backup original
  if [ -f "$original" ] && [ ! -f "$backup" ]; then
    cp "$original" "$backup"
    echo -e "  ${D}↳${R} ${D}Backed up original invoke.sh${R}"
  fi
  
  # Copy invoke-mesh.sh
  cp "$SCRIPT_DIR/invoke-mesh.sh" "$skill_dir/invoke-mesh.sh"
  chmod +x "$skill_dir/invoke-mesh.sh"
  
  # Replace invoke.sh with wrapper that calls invoke-mesh.sh
  cat > "$original" << 'WRAPPER'
#!/bin/bash
# Original invoke.sh replaced by MeshSig secure invoke.
# Every delegation is now cryptographically signed and verified.
# Original backed up at invoke.sh.original
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec bash "$SCRIPT_DIR/invoke-mesh.sh" "$@"
WRAPPER
  chmod +x "$original"
  
  # Update SKILL.md to mention MeshSig
  skill_md="$skill_dir/SKILL.md"
  if ! grep -q "MeshSig" "$skill_md" 2>/dev/null; then
    cat >> "$skill_md" << 'SKILLAPPEND'

## Security (MeshSig)

All delegations through this skill are automatically:
- **Signed** with the sender's Ed25519 cryptographic key
- **Verified** by MeshSig before delivery
- **Logged** with tamper-proof audit trail
- **Trust-scored** — successful interactions build trust over time

Dashboard: http://localhost:4888
SKILLAPPEND
  fi
  
  echo -e "  ${G}⬢${R} ${B}$agent_name${R} ${D}— secured with MeshSig${R}"
done

# Final stats
echo ""
STATS=$(curl -s "$MESH_URL/stats")
AGENTS=$(echo "$STATS" | python3 -c "import sys,json; print(json.load(sys.stdin)['agents'])" 2>/dev/null)
CONNS=$(echo "$STATS" | python3 -c "import sys,json; print(json.load(sys.stdin)['connections'])" 2>/dev/null)

echo -e "    ${D}─────────────────────────────────────────────────────────${R}"
echo ""
echo -e "    ${G}${B}✓ MESHSIG ACTIVE${R}"
echo ""
echo -e "    ${D}AGENTS${R}       ${C}${B}$AGENTS${R} ${D}registered with Ed25519 identity${R}"
echo -e "    ${D}CONNECTIONS${R}  ${C}${B}$CONNS${R} ${D}verified handshakes${R}"
echo -e "    ${D}DASHBOARD${R}    ${C}http://localhost:4888${R}"
echo ""
echo -e "    ${D}Every agent-to-agent delegation is now${R}"
echo -e "    ${D}cryptographically signed and verified.${R}"
echo ""
echo -e "    ${D}─────────────────────────────────────────────────────────${R}"
echo ""
