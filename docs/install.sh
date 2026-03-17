#!/bin/bash
# ============================================================================
# MeshSig — One-line installer
# curl -fsSL https://meshsig.dev/install.sh | bash
# ============================================================================

set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
RED='\033[0;31m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

echo ""
echo -e "${CYAN}${BOLD}  MeshSig${RESET} — Cryptographic security layer for AI agents"
echo -e "${DIM}  https://meshsig.dev${RESET}"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
  echo -e "${RED}  Node.js is required but not installed.${RESET}"
  echo ""
  echo -e "  Install Node.js first:"
  echo -e "    ${CYAN}https://nodejs.org${RESET}"
  echo ""
  echo -e "  Or use a package manager:"
  echo -e "    ${DIM}macOS:${RESET}   brew install node"
  echo -e "    ${DIM}Ubuntu:${RESET}  sudo apt install nodejs npm"
  echo -e "    ${DIM}Arch:${RESET}    sudo pacman -S nodejs npm"
  echo ""
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo -e "${RED}  Node.js 18+ required. You have $(node -v).${RESET}"
  echo -e "  Update: ${CYAN}https://nodejs.org${RESET}"
  exit 1
fi

echo -e "  ${GREEN}✓${RESET} Node.js $(node -v) detected"

# Install meshsig
echo -e "  ${DIM}Installing meshsig...${RESET}"
npm install -g meshsig --silent 2>/dev/null || npm install -g meshsig

if ! command -v meshsig &> /dev/null; then
  echo -e "${RED}  Installation failed. Try manually:${RESET}"
  echo -e "    npm install -g meshsig"
  exit 1
fi

echo -e "  ${GREEN}✓${RESET} meshsig $(meshsig --version 2>/dev/null || echo 'installed')"

# Generate identity
echo ""
echo -e "  ${DIM}Generating Ed25519 identity...${RESET}"
meshsig init 2>/dev/null || true

echo ""
echo -e "${GREEN}${BOLD}  ✓ MeshSig installed successfully${RESET}"
echo ""
echo -e "  ${BOLD}Quick start:${RESET}"
echo -e "    ${CYAN}meshsig sign${RESET} \"hello world\"     ${DIM}# Sign a message${RESET}"
echo -e "    ${CYAN}meshsig verify${RESET} msg sig did      ${DIM}# Verify a signature${RESET}"
echo -e "    ${CYAN}meshsig start${RESET}                   ${DIM}# Start dashboard${RESET}"
echo -e "    ${CYAN}meshsig help${RESET}                    ${DIM}# All 11 commands${RESET}"
echo ""
echo -e "  ${BOLD}MCP Server:${RESET}"
echo -e "    ${CYAN}npx meshsig-mcp${RESET}                 ${DIM}# For Claude, Cursor, Windsurf${RESET}"
echo ""
echo -e "  ${DIM}Docs: https://meshsig.dev${RESET}"
echo -e "  ${DIM}GitHub: https://github.com/carlostroy/meshsig${RESET}"
echo ""
