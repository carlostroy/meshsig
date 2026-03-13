#!/bin/bash
# ==============================================================================
# MeshSig Invoke — Secure agent-to-agent delegation
# Replaces invoke.sh with cryptographically signed communication.
# Every delegation is signed with Ed25519 and logged to MeshSig.
# ==============================================================================

TARGET="$1"
MESSAGE="$2"
CONTEXT="${3:-}"

if [ -z "$TARGET" ] || [ -z "$MESSAGE" ]; then
  echo '{"error":"Usage: invoke-mesh.sh <client_name> <message> [context]"}'
  exit 1
fi

MESH_URL="${MESHSIG_URL:-http://127.0.0.1:4888}"
GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:3001}"
GATEWAY_SECRET="${GATEWAY_SECRET:-a481d64a95af1a6178214c90669eeb694807755225c1c41bad9a6954abf171fd}"

# Agent identity file (created on first run by setup)
IDENTITY_DIR="/opt/meshsig/identities"
CALLER_NAME="${OPENCLAW_AGENT_NAME:-$(readlink -f "$SCRIPT_DIR" | sed "s|.*clients/||" | cut -d/ -f1)}"
CALLER_IDENTITY="$IDENTITY_DIR/$CALLER_NAME.json"
TARGET_IDENTITY="$IDENTITY_DIR/$TARGET.json"

# ---- Ensure identities exist ------------------------------------------------

ensure_identity() {
  local agent_name="$1"
  local identity_file="$IDENTITY_DIR/$agent_name.json"
  
  if [ ! -f "$identity_file" ]; then
    # Register with MeshSig and save identity
    local result=$(curl -s -X POST "$MESH_URL/agents/register" \
      -H "Content-Type: application/json" \
      -d "{\"name\":\"$agent_name\",\"capabilities\":[]}")
    
    echo "$result" | python3 -c "
import sys, json, os
data = json.load(sys.stdin)
identity = data.get('identity', {})
record = data.get('record', {})
out = {
  'did': identity.get('did',''),
  'privateKey': identity.get('privateKey',''),
  'publicKey': identity.get('publicKey',''),
  'displayName': record.get('displayName', '$agent_name')
}
os.makedirs('$IDENTITY_DIR', exist_ok=True)
with open('$identity_file', 'w') as f:
  json.dump(out, f, indent=2)
print(json.dumps({'registered': out['did']}))" 2>/dev/null
  fi
}

mkdir -p "$IDENTITY_DIR"
ensure_identity "$CALLER_NAME"
ensure_identity "$TARGET"

# ---- Read identities --------------------------------------------------------

CALLER_DID=$(python3 -c "import json; print(json.load(open('$CALLER_IDENTITY'))['did'])" 2>/dev/null)
CALLER_KEY=$(python3 -c "import json; print(json.load(open('$CALLER_IDENTITY'))['privateKey'])" 2>/dev/null)
TARGET_DID=$(python3 -c "import json; print(json.load(open('$TARGET_IDENTITY'))['did'])" 2>/dev/null)

if [ -z "$CALLER_DID" ] || [ -z "$TARGET_DID" ]; then
  echo '{"error":"Failed to load agent identities. Check MeshSig is running."}'
  exit 1
fi

# ---- Ensure connection exists -----------------------------------------------

# Check if connection exists, create if not
CONNECTION=$(curl -s "$MESH_URL/connections?did=$CALLER_DID" | python3 -c "
import sys, json
data = json.load(sys.stdin)
conns = data.get('connections', [])
target = '$TARGET_DID'
for c in conns:
  if c['agentADid'] == target or c['agentBDid'] == target:
    print(c['channelId'])
    break
" 2>/dev/null)

if [ -z "$CONNECTION" ]; then
  # Perform handshake
  CALLER_PKEY=$(python3 -c "import json; print(json.load(open('$CALLER_IDENTITY'))['privateKey'])" 2>/dev/null)
  TARGET_PKEY=$(python3 -c "import json; print(json.load(open('$TARGET_IDENTITY'))['privateKey'])" 2>/dev/null)
  
  curl -s -X POST "$MESH_URL/handshake" \
    -H "Content-Type: application/json" \
    -d "{\"fromDid\":\"$CALLER_DID\",\"toDid\":\"$TARGET_DID\",\"privateKeyA\":\"$CALLER_PKEY\",\"privateKeyB\":\"$TARGET_PKEY\",\"permissions\":[\"send:request\",\"execute:task\"]}" > /dev/null 2>&1
fi

# ---- Sign and send message via MeshSig ------------------------------------

# 1. Sign the message through MeshSig
FULL_MESSAGE="$MESSAGE"
if [ -n "$CONTEXT" ]; then
  FULL_MESSAGE="$MESSAGE | Context: $CONTEXT"
fi

SIGN_RESULT=$(curl -s -X POST "$MESH_URL/messages/send" \
  -H "Content-Type: application/json" \
  -d "{
    \"fromDid\": \"$CALLER_DID\",
    \"toDid\": \"$TARGET_DID\",
    \"message\": $(python3 -c "import json; print(json.dumps('$FULL_MESSAGE'))"),
    \"privateKey\": \"$CALLER_KEY\"
  }")

VERIFIED=$(echo "$SIGN_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('verified', False))" 2>/dev/null)

if [ "$VERIFIED" != "True" ]; then
  echo "{\"error\":\"MeshSig signature verification failed\",\"details\":$SIGN_RESULT}"
  exit 1
fi

# 2. Forward to actual agent via agent-gateway — WITH verified identity context
CALLER_DISPLAY=$(python3 -c "import json; print(json.load(open('$CALLER_IDENTITY'))['displayName'])" 2>/dev/null)
CALLER_CAPS=$(curl -s "$MESH_URL/agents/$CALLER_DID" | python3 -c "
import sys,json
try:
  a = json.load(sys.stdin).get('agent',{})
  caps = ', '.join([c['type'] for c in a.get('capabilities',[])])
  trust = a.get('trustScore', 0)
  print(f'{caps} (trust: {trust*100:.0f}%)')
except:
  print('')
" 2>/dev/null)

# Build enriched message with identity
ENRICHED_MESSAGE=$(python3 -c "
import json
caller = '$CALLER_DISPLAY'
caller_did = '$CALLER_DID'
caps = '$CALLER_CAPS'
msg = '''$MESSAGE'''
ctx = '''${CONTEXT:-}'''

parts = []
parts.append(f'[MeshSig Verified Message]')
parts.append(f'From: {caller} ({caller_did[:30]}...)')
if caps:
    parts.append(f'Role: {caps}')
parts.append(f'Signature: Ed25519 verified ✓')
parts.append(f'')
parts.append(f'Task: {msg}')
if ctx:
    parts.append(f'Context: {ctx}')

print(json.dumps('\n'.join(parts)))
")

RESPONSE=$(curl -s --max-time 120 -X POST "$GATEWAY_URL/invoke-agent" \
  -H "Content-Type: application/json" \
  -H "x-api-secret: $GATEWAY_SECRET" \
  -d "{
    \"target_client_name\": \"$TARGET\",
    \"message\": $ENRICHED_MESSAGE,
    \"context\": $(python3 -c "import json; print(json.dumps('${CONTEXT:-}'))")
  }")

# 3. Log the response through MeshSig (signed by target)
TARGET_KEY=$(python3 -c "import json; print(json.load(open('$TARGET_IDENTITY'))['privateKey'])" 2>/dev/null)

RESPONSE_PREVIEW=$(echo "$RESPONSE" | python3 -c "
import sys, json
try:
  data = json.load(sys.stdin)
  text = data.get('response', data.get('message', str(data)))[:200]
  print(text)
except:
  print(sys.stdin.read()[:200])
" 2>/dev/null)

if [ -n "$RESPONSE_PREVIEW" ]; then
  curl -s -X POST "$MESH_URL/messages/send" \
    -H "Content-Type: application/json" \
    -d "{
      \"fromDid\": \"$TARGET_DID\",
      \"toDid\": \"$CALLER_DID\",
      \"message\": $(python3 -c "import json; print(json.dumps('$RESPONSE_PREVIEW'))"),
      \"privateKey\": \"$TARGET_KEY\"
    }" > /dev/null 2>&1
fi

# 4. Return the response (same format as original invoke.sh)
echo "$RESPONSE"
