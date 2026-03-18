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
  did=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['did'])" "$identity_file" 2>/dev/null)
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

# Generate keypair locally so we keep the privateKey for auto-signing
mkdir -p "$IDENTITY_DIR"
keygen_output=$(node -e "
const ed = require('@noble/ed25519');
const { sha512 } = require('@noble/hashes/sha512');
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));
const bs58 = require('bs58');
const priv = ed.utils.randomPrivateKey();
const pub = ed.getPublicKey(priv);
const did = 'did:msig:' + bs58.encode(pub);
const pubB64 = Buffer.from(pub).toString('base64');
const privB64 = Buffer.from(priv).toString('base64');
console.log(JSON.stringify({ did, publicKey: pubB64, privateKey: privB64 }));
" 2>/dev/null)

if [ -z "$keygen_output" ]; then
  echo '{"error":"keygen failed — ensure @noble/ed25519 and bs58 are installed"}'
  exit 1
fi

local_did=$(echo "$keygen_output" | python3 -c "import sys,json; print(json.load(sys.stdin)['did'])")
local_pub=$(echo "$keygen_output" | python3 -c "import sys,json; print(json.load(sys.stdin)['publicKey'])")
local_priv=$(echo "$keygen_output" | python3 -c "import sys,json; print(json.load(sys.stdin)['privateKey'])")

# Register with server using our locally-generated identity (server won't see privateKey)
result=$(curl -s -X POST "$MESH_URL/agents/register" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "import json,sys; print(json.dumps({'name': sys.argv[1], 'capabilities': json.loads(sys.argv[2]), 'clientIdentity': {'did': sys.argv[3], 'publicKey': sys.argv[4]}}))" "$display_name" "$caps" "$local_did" "$local_pub")")

# Save identity file WITH privateKey for auto-signing
python3 -c "
import sys, json, os
out = {
  'did': sys.argv[1],
  'publicKey': sys.argv[2],
  'privateKey': sys.argv[3],
  'displayName': sys.argv[4],
  'clientName': sys.argv[5]
}
identity_path = sys.argv[6]
with open(identity_path, 'w') as f:
  os.chmod(identity_path, 0o600)
  json.dump(out, f, indent=2)
print(json.dumps({'registered':True,'did':out['did'],'name':out['displayName']}))
" "$local_did" "$local_pub" "$local_priv" "$display_name" "$CLIENT_NAME" "$identity_file" 2>/dev/null

# Auto-connect to managers
for mgr_file in "$IDENTITY_DIR"/agent-*gestor*.json "$IDENTITY_DIR"/agent-*gerente*.json; do
  [ -f "$mgr_file" ] || continue
  mgr_did=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['did'])" "$mgr_file" 2>/dev/null)
  new_did=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['did'])" "$identity_file" 2>/dev/null)
  
  # NOTE: Handshake requires pre-signed request. Skipping auto-connect.
  # Use meshsig CLI to create handshakes with local signing.
  echo "  Handshake between $mgr_did and $new_did requires local signing — use meshsig CLI"
done
