#!/usr/bin/env node
// ============================================================================
// MeshSig — The network where AI agents exist.
//
//   meshsig start              # Start the mesh
//   meshsig start --demo       # Start with demo agents
//   meshsig start --port 4888  # Custom port
// ============================================================================

import { MeshServer } from './server.js';
import { runDemo } from './demo.js';
import { TerminalDisplay } from './terminal.js';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync } from 'node:fs';

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';
const RESET = '\x1b[0m';

function parseArgs() {
  const args = process.argv.slice(2);
  const config: any = { peers: [] };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case 'start': break;
      case '--demo': config.demo = true; break;
      case '--port': case '-p': config.port = parseInt(args[++i]); break;
      case '--host': config.host = args[++i]; break;
      case '--db': config.dbPath = args[++i]; break;
      case '--name': config.name = args[++i]; break;
      case '--peer': config.peers.push(args[++i]); break;
      case '--no-terminal': config.noTerminal = true; break;
      case '--help': case '-h': showHelp(); process.exit(0);
      default:
        if (args[i] !== 'start') {
          console.error(`Unknown option: ${args[i]}`);
          showHelp();
          process.exit(1);
        }
    }
  }

  return config;
}

function showHelp() {
  console.log(`
${BOLD}MeshSig${RESET} — The network where AI agents exist.

${BOLD}USAGE${RESET}
  meshsig start [options]

${BOLD}OPTIONS${RESET}
  ${CYAN}--demo${RESET}           Start with demo agents and live interactions
  ${CYAN}--port, -p${RESET}       Server port (default: 4888)
  ${CYAN}--host${RESET}           Bind address (default: 0.0.0.0)
  ${CYAN}--db${RESET}             SQLite path (default: ~/.meshsig/mesh.db)
  ${CYAN}--name${RESET}           Server name
  ${CYAN}--peer <url>${RESET}     Connect to another MeshSig (repeatable)
  ${CYAN}--no-terminal${RESET}    Disable terminal live display
  ${CYAN}--help, -h${RESET}       Show this help

${BOLD}EXAMPLES${RESET}
  meshsig start                                Start the mesh
  meshsig start --demo                         Live demo (the wow moment)
  meshsig start --peer ws://other-vps:4888     Connect to another mesh

${BOLD}DASHBOARD${RESET}
  Open ${CYAN}http://localhost:4888${RESET} in your browser to see the live network.

${BOLD}API${RESET}
  Register agents, discover, sign/verify messages — all via HTTP.
  See ${CYAN}http://localhost:4888/health${RESET} for API docs.
`);
}

async function main() {
  const config = parseArgs();
  const command = process.argv[2];

  if (!command || command === '--help' || command === '-h') {
    showHelp();
    return;
  }

  if (command !== 'start') {
    console.error(`Unknown command: ${command}`);
    showHelp();
    process.exit(1);
  }

  // Ensure data dir
  const meshDir = resolve(homedir(), '.meshsig');
  if (!existsSync(meshDir)) mkdirSync(meshDir, { recursive: true });

  const port = config.port || 4888;
  const dbPath = config.dbPath || (config.demo ? ':memory:' : resolve(meshDir, 'mesh.db'));

  const server = new MeshServer({
    port,
    host: config.host || '0.0.0.0',
    dbPath,
    name: config.name || 'meshsig',
    peers: config.peers || [],
  });

  // Terminal live display
  const terminal = new TerminalDisplay();

  if (!config.noTerminal && !config.demo) {
    server.registry.on('mesh-event', (event: any) => {
      terminal.handleEvent(event);
    });
    server.peerNetwork.on('peer-event', (event: any) => {
      terminal.handleEvent(event);
    });
  } else if (!config.demo) {
    // Simple line-by-line output for non-terminal mode
    server.registry.on('mesh-event', (event: any) => {
      const t = event.type;
      const d = event.data;
      if (t === 'agent:register') {
        console.log(`  ${GREEN}●${RESET} ${BOLD}${d.name}${RESET} joined — ${DIM}${d.did.slice(0, 30)}...${RESET}`);
      } else if (t === 'connection:established') {
        console.log(`  ${CYAN}◆${RESET} ${d.agentA.name} ${DIM}↔${RESET} ${d.agentB.name} ${DIM}connected${RESET}`);
      } else if (t === 'message:sent') {
        const v = d.verified ? `${GREEN}✓${RESET}` : `${YELLOW}✗${RESET}`;
        console.log(`  ${YELLOW}▸${RESET} ${d.from.name} → ${d.to.name} ${v} ${DIM}"${d.preview.slice(0, 50)}"${RESET}`);
      }
    });
  }

  // Start server
  await server.start();

  console.log(`

${CYAN}    ███╗   ███╗███████╗███████╗██╗  ██╗███████╗██╗ ██████╗
    ████╗ ████║██╔════╝██╔════╝██║  ██║██╔════╝██║██╔════╝
    ██╔████╔██║█████╗  ███████╗███████║███████╗██║██║  ███╗
    ██║╚██╔╝██║██╔══╝  ╚════██║██╔══██║╚════██║██║██║   ██║
    ██║ ╚═╝ ██║███████╗███████║██║  ██║███████║██║╚██████╔╝
    ╚═╝     ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝╚═╝ ╚═════╝${RESET}

${MAGENTA}    ◈${RESET}  ${BOLD}Cryptographic security layer for AI agents${RESET}

${DIM}    ─────────────────────────────────────────────────────────${RESET}

    ${GREEN}●${RESET} ${DIM}DASHBOARD${RESET}   ${CYAN}${BOLD}http://localhost:${port}${RESET}
    ${GREEN}●${RESET} ${DIM}API${RESET}         ${CYAN}http://localhost:${port}/health${RESET}
    ${GREEN}●${RESET} ${DIM}WEBSOCKET${RESET}   ${CYAN}ws://localhost:${port}${RESET}

${DIM}    ─────────────────────────────────────────────────────────${RESET}

    ${DIM}CRYPTO${RESET}  Ed25519 digital signatures
    ${DIM}DID${RESET}     did:msig:* ${DIM}W3C decentralized identity${RESET}
    ${DIM}VERIFY${RESET}  Mutual challenge-response handshake
    ${DIM}TRUST${RESET}   Earned through verified interactions

${DIM}    ─────────────────────────────────────────────────────────${RESET}
`);

  // Run demo if requested
  if (config.demo) {
    await runDemo(server);
  } else if (!config.noTerminal) {
    // Start live terminal display after 1s (let banner show)
    setTimeout(() => terminal.start(), 1000);
  } else {
    console.log(`  ${DIM}Mesh active. Waiting for agents.${RESET}\n`);
  }

  // Graceful shutdown
  const shutdown = async () => {
    terminal.stop();
    console.log(`\n  ${DIM}Shutting down MeshSig...${RESET}`);
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
