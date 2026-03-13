#!/bin/bash
# ==============================================================================
# MeshSig — Unregister an agent
#
# Called when xrunly-api deprovisions an agent.
# Usage: bash unregister-agent.sh <client_name>
# ==============================================================================

CLIENT_NAME="$1"
if [ -z "$CLIENT_NAME" ]; then
  echo '{"error":"client_name required"}'
  exit 1
fi

IDENTITY_DIR="/opt/meshsig/identities"
identity_file="$IDENTITY_DIR/$CLIENT_NAME.json"

if [ -f "$identity_file" ]; then
  rm -f "$identity_file"
  echo "{\"unregistered\":true,\"client\":\"$CLIENT_NAME\"}"
else
  echo "{\"not_found\":true,\"client\":\"$CLIENT_NAME\"}"
fi
