#!/usr/bin/env node
// ============================================================================
// MeshSig CLI — Cryptographic security layer for AI agents
//
//   meshsig init                    Generate Ed25519 identity
//   meshsig sign <message>          Sign a message
//   meshsig verify <msg> <sig> <key> Verify a signature
//   meshsig identity                Show your identity
//   meshsig agents                  List agents on server
//   meshsig audit                   Export audit log
//   meshsig start                   Start the MeshSig server
// ============================================================================

import { MeshServer } from './server.js';
import { runDemo } from './demo.js';
import { TerminalDisplay } from './terminal.js';
import { generateIdentity, sign, verify, verifyWithDid, isValidDid, hashPayload } from './crypto.js';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

const MESHSIG_DIR = resolve(homedir(), '.meshsig');
const IDENTITY_FILE = resolve(MESHSIG_DIR, 'identity.json');
const DEFAULT_SERVER = 'http://localhost:4888';

// -- Helpers -----------------------------------------------------------------

function ensureDir() {
  if (!existsSync(MESHSIG_DIR)) mkdirSync(MESHSIG_DIR, { recursive: true });
}

function loadIdentity(): any | null {
  if (!existsSync(IDENTITY_FILE)) return null;
  return JSON.parse(readFileSync(IDENTITY_FILE, 'utf-8'));
}

function printIdentity(id: any) {
  console.log(`
  ${CYAN}${BOLD}MeshSig Identity${RESET}

  ${DIM}DID${RESET}          ${CYAN}${id.did}${RESET}
  ${DIM}PUBLIC KEY${RESET}   ${id.publicKey}
  ${DIM}CREATED${RESET}      ${id.createdAt}
  ${DIM}STORED${RESET}       ${DIM}${IDENTITY_FILE}${RESET}
`);
}

// -- Commands ----------------------------------------------------------------

async function cmdInit(force: boolean) {
  ensureDir();

  if (existsSync(IDENTITY_FILE) && !force) {
    const existing = loadIdentity();
    console.log(`\n  ${YELLOW}Identity already exists.${RESET} Use ${CYAN}--force${RESET} to regenerate.\n`);
    printIdentity(existing);
    return;
  }

  const identity = await generateIdentity();
  writeFileSync(IDENTITY_FILE, JSON.stringify(identity, null, 2));

  console.log(`\n  ${GREEN}${BOLD}✓ Identity generated${RESET}`);
  printIdentity(identity);
  console.log(`  ${DIM}Your private key is stored locally. Never share it.${RESET}\n`);
}

async function cmdSign(message: string) {
  const identity = loadIdentity();
  if (!identity) {
    console.log(`\n  ${RED}No identity found.${RESET} Run ${CYAN}meshsig init${RESET} first.\n`);
    process.exit(1);
  }

  const signature = await sign(message, identity.privateKey);
  const hash = hashPayload(message);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({
      did: identity.did,
      message,
      signature,
      hash,
      publicKey: identity.publicKey,
      timestamp: new Date().toISOString(),
    }, null, 2));
    return;
  }

  console.log(`
  ${GREEN}${BOLD}✓ Message signed${RESET}

  ${DIM}FROM${RESET}         ${CYAN}${identity.did}${RESET}
  ${DIM}MESSAGE${RESET}      ${message.slice(0, 80)}${message.length > 80 ? '...' : ''}
  ${DIM}SIGNATURE${RESET}    ${signature}
  ${DIM}HASH${RESET}         ${hash}
  ${DIM}PUBLIC KEY${RESET}   ${identity.publicKey}
`);
}

async function cmdVerify(message: string, signature: string, keyOrDid: string) {
  let valid: boolean;
  let label: string;

  if (isValidDid(keyOrDid)) {
    valid = await verifyWithDid(message, signature, keyOrDid);
    label = `DID: ${keyOrDid}`;
  } else {
    valid = await verify(message, signature, keyOrDid);
    label = `Key: ${keyOrDid.slice(0, 30)}...`;
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ valid, message, signature, signer: keyOrDid }));
    if (!valid) process.exit(1);
    return;
  }

  if (valid) {
    console.log(`\n  ${GREEN}${BOLD}✓ SIGNATURE VALID${RESET}\n\n  ${DIM}${label}${RESET}\n`);
  } else {
    console.log(`\n  ${RED}${BOLD}✗ SIGNATURE INVALID${RESET}\n\n  ${DIM}${label}${RESET}\n`);
    process.exit(1);
  }
}

function cmdIdentity() {
  const identity = loadIdentity();
  if (!identity) {
    console.log(`\n  ${RED}No identity found.${RESET} Run ${CYAN}meshsig init${RESET} first.\n`);
    process.exit(1);
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({
      did: identity.did,
      publicKey: identity.publicKey,
      createdAt: identity.createdAt,
    }, null, 2));
    return;
  }

  printIdentity(identity);
}

async function cmdAgents(server: string) {
  try {
    const res = await fetch(`${server}/agents`);
    const data = await res.json() as any;

    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    console.log(`\n  ${CYAN}${BOLD}MeshSig Agents${RESET} — ${server}\n`);

    if (!data.agents || data.agents.length === 0) {
      console.log(`  ${DIM}No agents registered.${RESET}\n`);
      return;
    }

    for (const a of data.agents) {
      const origin = a.origin === 'remote' ? `${YELLOW}remote${RESET}` : `${GREEN}local${RESET}`;
      const trust = a.trustScore > 0 ? ` · ${(a.trustScore * 100).toFixed(0)}%` : '';
      const caps = (a.capabilities || []).map((c: any) => c.type).join(', ');
      console.log(`  ${CYAN}${a.displayName}${RESET} ${DIM}${a.did.slice(0, 30)}...${RESET}`);
      console.log(`    ${origin} ${DIM}${caps}${trust}${RESET}`);
    }
    console.log(`\n  ${DIM}${data.agents.length} agents total${RESET}\n`);
  } catch {
    console.log(`\n  ${RED}Cannot connect to ${server}${RESET}`);
    console.log(`  ${DIM}Start the server: meshsig start${RESET}\n`);
    process.exit(1);
  }
}

async function cmdAudit(server: string, format: string) {
  try {
    const [msgRes, agentRes, connRes] = await Promise.all([
      fetch(`${server}/messages`),
      fetch(`${server}/agents`),
      fetch(`${server}/connections`),
    ]);

    const messages = (await msgRes.json() as any).messages || [];
    const agents = (await agentRes.json() as any).agents || [];
    const connections = (await connRes.json() as any).connections || [];

    if (format === 'json') {
      console.log(JSON.stringify({
        exported: new Date().toISOString(),
        server,
        summary: {
          agents: agents.length,
          connections: connections.length,
          messages: messages.length,
          verifiedMessages: messages.filter((m: any) => m.verified).length,
        },
        agents: agents.map((a: any) => ({
          did: a.did,
          name: a.displayName,
          publicKey: a.publicKey,
          trustScore: a.trustScore,
          origin: a.origin,
        })),
        messages: messages.map((m: any) => ({
          from: m.fromDid,
          to: m.toDid,
          content: m.content,
          signature: m.signature,
          verified: m.verified,
          timestamp: m.createdAt,
        })),
      }, null, 2));
      return;
    }

    // Pretty print
    console.log(`
  ${CYAN}${BOLD}MeshSig Audit Report${RESET}
  ${DIM}Generated: ${new Date().toISOString()}${RESET}
  ${DIM}Server: ${server}${RESET}

  ${BOLD}SUMMARY${RESET}
  Agents:          ${CYAN}${agents.length}${RESET}
  Connections:     ${CYAN}${connections.length}${RESET}
  Messages:        ${CYAN}${messages.length}${RESET}
  Verified:        ${GREEN}${messages.filter((m: any) => m.verified).length}${RESET}
  Failed:          ${RED}${messages.filter((m: any) => !m.verified).length}${RESET}
`);

    if (messages.length > 0) {
      console.log(`  ${BOLD}SIGNED MESSAGES${RESET}\n`);
      for (const m of messages.slice(-20)) {
        const v = m.verified ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
        const from = agents.find((a: any) => a.did === m.fromDid)?.displayName || m.fromDid?.slice(0, 20);
        const to = agents.find((a: any) => a.did === m.toDid)?.displayName || m.toDid?.slice(0, 20);
        console.log(`  ${v} ${DIM}${m.createdAt}${RESET} ${CYAN}${from}${RESET} → ${CYAN}${to}${RESET}`);
        console.log(`    ${DIM}${m.content?.slice(0, 60) || ''}${RESET}`);
        console.log(`    ${DIM}sig: ${m.signature?.slice(0, 40)}...${RESET}\n`);
      }
    }
  } catch {
    console.log(`\n  ${RED}Cannot connect to ${server}${RESET}\n`);
    process.exit(1);
  }
}

async function cmdStats(server: string) {
  try {
    const res = await fetch(`${server}/stats`);
    const data = await res.json() as any;

    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    const up = Math.floor(data.uptime || 0);
    const h = Math.floor(up / 3600);
    const m = Math.floor((up % 3600) / 60);

    console.log(`
  ${CYAN}${BOLD}MeshSig Status${RESET} — ${server}

  ${DIM}AGENTS${RESET}       ${CYAN}${BOLD}${data.agents}${RESET}
  ${DIM}ACTIVE${RESET}       ${CYAN}${data.active}${RESET}
  ${DIM}CONNECTIONS${RESET}  ${CYAN}${data.connections}${RESET}
  ${DIM}MESSAGES${RESET}     ${CYAN}${data.messages}${RESET}
  ${DIM}UPTIME${RESET}       ${DIM}${h}h ${m}m${RESET}
`);
  } catch {
    console.log(`\n  ${RED}Cannot connect to ${server}${RESET}\n`);
    process.exit(1);
  }
}

// -- Server command ----------------------------------------------------------

function parseStartArgs() {
  const args = process.argv.slice(3); // skip 'node', 'main.js', 'start'
  const config: any = { peers: [] };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--demo': config.demo = true; break;
      case '--port': case '-p': config.port = parseInt(args[++i]); break;
      case '--host': config.host = args[++i]; break;
      case '--db': config.dbPath = args[++i]; break;
      case '--name': config.name = args[++i]; break;
      case '--peer': config.peers.push(args[++i]); break;
      case '--no-terminal': config.noTerminal = true; break;
    }
  }

  return config;
}

async function cmdStart() {
  const config = parseStartArgs();
  const port = config.port || 4888;
  const host = config.host || '0.0.0.0';

  ensureDir();
  const dbPath = config.dbPath || resolve(MESHSIG_DIR, 'mesh.db');
  const server = new MeshServer({ port, host, dbPath, name: config.name, peers: config.peers || [] });
  const terminal = new TerminalDisplay();

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

  if (config.demo) {
    await runDemo(server);
  } else if (!config.noTerminal) {
    setTimeout(() => terminal.start(), 1000);
  } else {
    console.log(`  ${DIM}Mesh active. Waiting for agents.${RESET}\n`);
  }

  const shutdown = async () => {
    terminal.stop();
    console.log(`\n  ${DIM}Shutting down MeshSig...${RESET}`);
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// -- Help --------------------------------------------------------------------

function showHelp() {
  console.log(`
${CYAN}${BOLD}MeshSig${RESET} — Cryptographic security layer for AI agents

${BOLD}COMMANDS${RESET}

  ${CYAN}meshsig init${RESET}                          Generate Ed25519 identity
  ${CYAN}meshsig sign${RESET} ${DIM}<message>${RESET}                Sign a message with your key
  ${CYAN}meshsig verify${RESET} ${DIM}<msg> <sig> <key|did>${RESET}  Verify a signature
  ${CYAN}meshsig identity${RESET}                      Show your DID and public key
  ${CYAN}meshsig agents${RESET}                        List agents on the mesh
  ${CYAN}meshsig stats${RESET}                         Server statistics
  ${CYAN}meshsig audit${RESET}                         Export signed message audit log
  ${CYAN}meshsig start${RESET}                         Start the MeshSig server

${BOLD}OPTIONS${RESET}

  ${DIM}--server <url>${RESET}     MeshSig server (default: http://localhost:4888)
  ${DIM}--json${RESET}             Output as JSON (for piping)
  ${DIM}--force${RESET}            Overwrite existing identity on init

${BOLD}SERVER OPTIONS${RESET} (meshsig start)

  ${DIM}--port, -p <n>${RESET}     Server port (default: 4888)
  ${DIM}--demo${RESET}             Start with demo agents
  ${DIM}--peer <url>${RESET}       Connect to another MeshSig
  ${DIM}--no-terminal${RESET}      Disable live terminal display

${BOLD}EXAMPLES${RESET}

  ${GREEN}# Generate your identity${RESET}
  meshsig init

  ${GREEN}# Sign a message${RESET}
  meshsig sign "Deploy the new model to production"

  ${GREEN}# Verify someone's signature${RESET}
  meshsig verify "message" "base64sig" "did:msig:abc123..."

  ${GREEN}# Export audit log as JSON${RESET}
  meshsig audit --json > audit-report.json

  ${GREEN}# Start the server${RESET}
  meshsig start --port 4888

  ${GREEN}# Pipe: sign and verify in one shot${RESET}
  meshsig sign "hello" --json | meshsig verify --json

${DIM}https://meshsig.ai${RESET} — ${DIM}https://github.com/carlostroy/meshsig${RESET}
`);
}

// -- Main router -------------------------------------------------------------

async function main() {
  const cmd = process.argv[2];
  const args = process.argv.slice(3);

  // Find --server flag
  const serverIdx = args.indexOf('--server');
  const server = serverIdx >= 0 ? args[serverIdx + 1] : DEFAULT_SERVER;

  switch (cmd) {
    case 'init':
      await cmdInit(args.includes('--force'));
      break;

    case 'sign':
      const msg = args.find(a => !a.startsWith('-'));
      if (!msg) { console.log(`\n  ${RED}Usage: meshsig sign <message>${RESET}\n`); process.exit(1); }
      await cmdSign(msg);
      break;

    case 'verify': {
      const vArgs = args.filter(a => !a.startsWith('-'));
      if (vArgs.length < 3) {
        console.log(`\n  ${RED}Usage: meshsig verify <message> <signature> <publicKey|did>${RESET}\n`);
        process.exit(1);
      }
      await cmdVerify(vArgs[0], vArgs[1], vArgs[2]);
      break;
    }

    case 'identity': case 'id': case 'whoami':
      cmdIdentity();
      break;

    case 'agents': case 'ls':
      await cmdAgents(server);
      break;

    case 'stats': case 'status':
      await cmdStats(server);
      break;

    case 'audit':
      const format = args.includes('--json') ? 'json' : 'pretty';
      await cmdAudit(server, format);
      break;

    case 'start':
      await cmdStart();
      break;

    case 'help': case '--help': case '-h': case undefined:
      showHelp();
      break;

    default:
      console.log(`\n  ${RED}Unknown command: ${cmd}${RESET}`);
      showHelp();
      process.exit(1);
  }
}

main().catch(err => {
  console.error(`\n  ${RED}Error: ${err.message}${RESET}\n`);
  process.exit(1);
});
