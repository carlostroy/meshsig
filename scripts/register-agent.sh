#!/bin/bash
# ==============================================================================
# MeshSig — Auto-register a new agent
#
# Called automatically when a new agent is provisioned.
# Usage: bash register-agent.sh <client_name>
# Example: bash register-agent.sh agent-mari---atendente-de--17734059
# ==============================================================================

CLIENT_NAME="$1"
if [ -z "$CLIENT_NAME" ]; then
  echo '{"error":"client_name required"}'
  exit 1
fi

MESH_URL="${MESHSIG_URL:-http://127.0.0.1:4888}"
IDENTITY_DIR="/opt/meshsig/identities"
identity_file="$IDENTITY_DIR/$CLIENT_NAME.json"

# Check MeshSig is running
if ! curl -s "$MESH_URL/health" > /dev/null 2>&1; then
  echo '{"error":"meshsig not running"}'
  exit 1
fi

# Already registered?
if [ -f "$identity_file" ]; then
  did=$(python3 -c "import json; print(json.load(open('$identity_file'))['did'])" 2>/dev/null)
  echo "{\"already_registered\":true,\"did\":\"$did\"}"
  exit 0
fi

# Detect capabilities
case "$CLIENT_NAME" in
  *gestor*|*gerente*|*manager*|*coo*|*ceo*)
    caps='[{"type":"management","confidence":0.95},{"type":"delegation","confidence":0.9}]' ;;
  *atendente*|*suporte*|*support*)
    caps='[{"type":"customer-support","confidence":0.92}]' ;;
  *sdr*|*vendas*|*sales*)
    caps='[{"type":"sales","confidence":0.9},{"type":"sdr","confidence":0.88}]' ;;
  *copy*|*redator*|*writer*|*content*)
    caps='[{"type":"copywriting","confidence":0.93}]' ;;
  *social*|*marketing*|*instagram*)
    caps='[{"type":"social-media","confidence":0.91}]' ;;
  *analista*|*analytics*|*dados*|*data*)
    caps='[{"type":"analytics","confidence":0.87}]' ;;
  *)
    caps='[{"type":"general","confidence":0.8}]' ;;
esac

# Extract display name
display_name=$(echo "$CLIENT_NAME" | sed 's/^agent-//' | cut -d'-' -f1 | sed 's/./\U&/')

# Register
mkdir -p "$IDENTITY_DIR"
result=$(curl -s -X POST "$MESH_URL/agents/register" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$display_name\",\"capabilities\":$caps}")

# Save identity file
echo "$result" | python3 -c "
import sys, json
data = json.load(sys.stdin)
identity = data.get('identity', {})
record = data.get('record', {})
out = {
  'did': identity.get('did',''),
  'privateKey': identity.get('privateKey',''),
  'publicKey': identity.get('publicKey',''),
  'displayName': record.get('displayName', ''),
  'clientName': '$CLIENT_NAME'
}
with open('$identity_file', 'w') as f:
  json.dump(out, f, indent=2)
print(json.dumps({'registered':True,'did':out['did'],'name':out['displayName']}))
" 2>/dev/null

# Auto-connect to managers
for mgr_file in "$IDENTITY_DIR"/agent-*gestor*.json "$IDENTITY_DIR"/agent-*gerente*.json; do
  [ -f "$mgr_file" ] || continue
  mgr_did=$(python3 -c "import json; print(json.load(open('$mgr_file'))['did'])" 2>/dev/null)
  mgr_key=$(python3 -c "import json; print(json.load(open('$mgr_file'))['privateKey'])" 2>/dev/null)
  new_did=$(python3 -c "import json; print(json.load(open('$identity_file'))['did'])" 2>/dev/null)
  new_key=$(python3 -c "import json; print(json.load(open('$identity_file'))['privateKey'])" 2>/dev/null)
  
  curl -s -X POST "$MESH_URL/handshake" \
    -H "Content-Type: application/json" \
    -d "{\"fromDid\":\"$mgr_did\",\"toDid\":\"$new_did\",\"privateKeyA\":\"$mgr_key\",\"privateKeyB\":\"$new_key\"}" > /dev/null 2>&1
done
