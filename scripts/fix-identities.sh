#!/bin/bash
# ==============================================================================
# MeshSig — Fix existing identity files by adding privateKey
#
# Regenerates keypairs for agents whose identity files lack a privateKey.
# Updates both the local file and the server registration.
# Usage: bash fix-identities.sh
# ==============================================================================

MESH_URL="${MESHSIG_URL:-http://127.0.0.1:4888}"
IDENTITY_DIR="/opt/meshsig/identities"
NODE_MODULES="/opt/meshsig/node_modules"

if [ ! -d "$IDENTITY_DIR" ]; then
  echo "No identities directory found at $IDENTITY_DIR"
  exit 1
fi

echo "=== MeshSig Identity Fix ==="
echo "Scanning $IDENTITY_DIR for files missing privateKey..."
echo ""

for identity_file in "$IDENTITY_DIR"/*.json; do
  [ -f "$identity_file" ] || continue

  filename=$(basename "$identity_file")

  # Check if privateKey already exists
  has_key=$(python3 -c "
import json, sys
data = json.load(open(sys.argv[1]))
print('yes' if data.get('privateKey') else 'no')
" "$identity_file" 2>/dev/null)

  if [ "$has_key" = "yes" ]; then
    echo "✓ $filename — already has privateKey, skipping"
    continue
  fi

  echo "✗ $filename — missing privateKey, regenerating..."

  # Read existing identity info
  old_info=$(python3 -c "
import json, sys
data = json.load(open(sys.argv[1]))
print(json.dumps(data))
" "$identity_file" 2>/dev/null)

  old_did=$(echo "$old_info" | python3 -c "import sys,json; print(json.load(sys.stdin).get('did',''))")
  display_name=$(echo "$old_info" | python3 -c "import sys,json; print(json.load(sys.stdin).get('displayName',''))")
  client_name=$(echo "$old_info" | python3 -c "import sys,json; print(json.load(sys.stdin).get('clientName',''))")

  # Generate new keypair
  keygen_output=$(cd /opt/meshsig && node -e "
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
    echo "  ERROR: keygen failed for $filename"
    continue
  fi

  new_did=$(echo "$keygen_output" | python3 -c "import sys,json; print(json.load(sys.stdin)['did'])")
  new_pub=$(echo "$keygen_output" | python3 -c "import sys,json; print(json.load(sys.stdin)['publicKey'])")
  new_priv=$(echo "$keygen_output" | python3 -c "import sys,json; print(json.load(sys.stdin)['privateKey'])")

  # Delete old agent registration from server
  if [ -n "$old_did" ]; then
    curl -s -X DELETE "$MESH_URL/agents/$old_did" \
      -H "x-api-key: $(grep -oP 'apiKey.*?"\K[^"]+' /opt/meshsig/.env 2>/dev/null || echo '')" > /dev/null 2>&1
  fi

  # Get capabilities from old registration
  caps=$(curl -s "$MESH_URL/agents" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for a in data.get('agents', []):
  if a.get('displayName','') == sys.argv[1]:
    print(json.dumps(a.get('capabilities', [{'type':'general','confidence':0.8}])))
    sys.exit(0)
print('[{\"type\":\"general\",\"confidence\":0.8}]')
" "$display_name" 2>/dev/null)

  # Re-register with new keypair
  curl -s -X POST "$MESH_URL/agents/register" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c "import json,sys; print(json.dumps({'name': sys.argv[1], 'capabilities': json.loads(sys.argv[2]), 'clientIdentity': {'did': sys.argv[3], 'publicKey': sys.argv[4]}}))" "$display_name" "$caps" "$new_did" "$new_pub")" > /dev/null 2>&1

  # Update identity file with privateKey
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
" "$new_did" "$new_pub" "$new_priv" "$display_name" "$client_name" "$identity_file"

  echo "  ✓ Fixed! New DID: ${new_did:0:40}..."
done

echo ""
echo "=== Done! Restart meshsig: systemctl restart meshsig ==="
