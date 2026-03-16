#!/bin/bash
# ============================================================================
# MeshSig Proxy Deploy — Transparent interception via iptables
#
# Usage: bash scripts/deploy-proxy.sh <gateway_port>
# Example: bash scripts/deploy-proxy.sh 3001
#
# What it does:
# 1. Creates a 'meshsig' system user (if needed)
# 2. Starts MeshSig on port 4888 with --gateway pointing to your gateway
# 3. Adds iptables rule to redirect local traffic from <gateway_port> → 4888
#    (excludes MeshSig's own traffic to avoid loops)
# 4. Registers all agents found in /root/clients/
#
# No port changes. No config changes. Fully transparent.
# Your agents keep calling the same port. MeshSig intercepts and signs.
#
# To remove: bash scripts/deploy-proxy.sh --remove <gateway_port>
# ============================================================================

set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[33m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

MESH_PORT=4888

# Handle --remove
if [ "$1" = "--remove" ]; then
  GW_PORT="${2:-3001}"
  echo -e "\n${CYAN}${BOLD}  MeshSig Proxy Remove${RESET}\n"
  iptables -t nat -D OUTPUT -p tcp -d 127.0.0.1 --dport "$GW_PORT" -m owner ! --uid-owner meshsig -j REDIRECT --to-port $MESH_PORT 2>/dev/null && \
    echo -e "  ${GREEN}✓${RESET} iptables rule removed" || \
    echo -e "  ${DIM}No iptables rule found${RESET}"
  echo -e "  ${DIM}MeshSig service still running on port $MESH_PORT${RESET}"
  echo -e "  ${DIM}To stop: systemctl stop meshsig${RESET}\n"
  exit 0
fi

GW_PORT="${1:-3001}"

echo ""
echo -e "${CYAN}${BOLD}  MeshSig Proxy Deploy${RESET}"
echo -e "${DIM}  Intercepting port $GW_PORT → MeshSig signs → forwards back to $GW_PORT${RESET}"
echo ""

# Step 1: Verify gateway is running
if ! curl -s "http://127.0.0.1:$GW_PORT" > /dev/null 2>&1; then
  echo -e "  ${YELLOW}!${RESET} No service detected on port $GW_PORT"
  echo -e "  ${DIM}Make sure your gateway is running first${RESET}"
  echo ""
  exit 1
fi
echo -e "  ${GREEN}✓${RESET} Gateway detected on port $GW_PORT"

# Step 2: Create meshsig user (for iptables exclusion)
if ! id meshsig &>/dev/null; then
  useradd -r -s /bin/false -m -d /home/meshsig meshsig 2>/dev/null
  echo -e "  ${GREEN}✓${RESET} Created system user 'meshsig'"
else
  echo -e "  ${DIM}✓${RESET} User 'meshsig' exists"
fi

# Step 3: Permissions
mkdir -p /home/meshsig/.meshsig
chown -R meshsig:meshsig /home/meshsig
chmod -R 755 /opt/meshsig
chown -R meshsig:meshsig /opt/meshsig/identities 2>/dev/null || mkdir -p /opt/meshsig/identities && chown meshsig:meshsig /opt/meshsig/identities

# Step 4: Configure systemd
cat > /etc/systemd/system/meshsig.service << EOF
[Unit]
Description=MeshSig — Cryptographic security layer for AI agents
After=network.target

[Service]
Type=simple
User=meshsig
ExecStart=/usr/bin/node /opt/meshsig/dist/main.js start --no-terminal --gateway http://127.0.0.1:$GW_PORT
Restart=always
RestartSec=5
Environment=MESH_PORT=$MESH_PORT
Environment=HOME=/home/meshsig
WorkingDirectory=/opt/meshsig

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable meshsig 2>/dev/null
systemctl restart meshsig
sleep 3

# Verify MeshSig started
if curl -s "http://127.0.0.1:$MESH_PORT/health" 2>/dev/null | grep -q "ok"; then
  echo -e "  ${GREEN}✓${RESET} MeshSig running on port $MESH_PORT"
else
  echo -e "  ${RED}✗${RESET} MeshSig failed to start"
  echo -e "    Check: journalctl -u meshsig --no-pager -n 10"
  exit 1
fi

# Step 5: iptables — redirect gateway traffic through MeshSig
# Remove old rule if exists
iptables -t nat -D OUTPUT -p tcp -d 127.0.0.1 --dport "$GW_PORT" -m owner ! --uid-owner meshsig -j REDIRECT --to-port $MESH_PORT 2>/dev/null

# Add new rule
iptables -t nat -A OUTPUT -p tcp -d 127.0.0.1 --dport "$GW_PORT" -m owner ! --uid-owner meshsig -j REDIRECT --to-port $MESH_PORT
echo -e "  ${GREEN}✓${RESET} iptables: port $GW_PORT → MeshSig ($MESH_PORT)"

# Step 6: Register agents
echo ""
bash /opt/meshsig/scripts/install.sh

# Step 7: Make iptables persistent
if command -v iptables-save &>/dev/null; then
  iptables-save > /etc/iptables.rules 2>/dev/null
  echo -e "  ${DIM}iptables rules saved${RESET}"
fi

echo ""
echo -e "${GREEN}${BOLD}  ✓ MeshSig Proxy Active${RESET}"
echo ""
echo -e "  ${DIM}Your agents call port $GW_PORT as before${RESET}"
echo -e "  ${DIM}MeshSig intercepts, signs with Ed25519, forwards transparently${RESET}"
echo -e "  ${DIM}Dashboard: http://localhost:$MESH_PORT${RESET}"
echo ""
echo -e "  ${DIM}To remove: bash scripts/deploy-proxy.sh --remove $GW_PORT${RESET}"
echo ""
