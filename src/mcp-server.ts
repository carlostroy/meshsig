#!/usr/bin/env node
// ============================================================================
// MeshSig MCP Server — Model Context Protocol integration
//
// Exposes MeshSig cryptographic operations as MCP tools that any
// AI application (Claude, Cursor, Windsurf, Cline) can use directly.
//
// Usage:
//   npx meshsig-mcp              # Start as stdio MCP server
//   node dist/mcp-server.js      # Direct execution
//
// Claude Desktop config (~/.claude/claude_desktop_config.json):
//   {
//     "mcpServers": {
//       "meshsig": {
//         "command": "npx",
//         "args": ["meshsig-mcp"]
//       }
//     }
//   }
// ============================================================================

import { generateIdentity, sign, verify, verifyWithDid, isValidDid, hashPayload } from './crypto.js';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const MESHSIG_DIR = resolve(homedir(), '.meshsig');
const IDENTITY_FILE = resolve(MESHSIG_DIR, 'identity.json');
const DEFAULT_SERVER = process.env.MESHSIG_SERVER || 'http://localhost:4888';

function ensureDir() {
  if (!existsSync(MESHSIG_DIR)) mkdirSync(MESHSIG_DIR, { recursive: true });
}

function loadIdentity(): any | null {
  if (!existsSync(IDENTITY_FILE)) return null;
  return JSON.parse(readFileSync(IDENTITY_FILE, 'utf-8'));
}

// -- MCP Protocol (JSON-RPC over stdio) --------------------------------------

interface JsonRpcRequest {
  jsonrpc: string;
  id: string | number;
  method: string;
  params?: any;
}

function sendResponse(id: string | number, result: any) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, result });
  process.stdout.write(`${msg}\n`);
}

function sendError(id: string | number, code: number, message: string) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
  process.stdout.write(`${msg}\n`);
}

function sendNotification(method: string, params: any) {
  const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
  process.stdout.write(`${msg}\n`);
}

// -- Tool Definitions --------------------------------------------------------

const TOOLS = [
  {
    name: 'meshsig_init',
    description: 'Generate a new Ed25519 cryptographic identity (DID + keypair). The identity is stored locally at ~/.meshsig/identity.json. This is required before signing messages.',
    inputSchema: {
      type: 'object',
      properties: {
        force: { type: 'boolean', description: 'Overwrite existing identity if one exists', default: false },
      },
    },
  },
  {
    name: 'meshsig_sign',
    description: 'Sign a message with your Ed25519 private key. Returns the digital signature, hash, and your DID. Requires meshsig_init to have been run first.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The message to sign' },
      },
      required: ['message'],
    },
  },
  {
    name: 'meshsig_verify',
    description: 'Verify an Ed25519 signature against a message and public key or DID. Returns whether the signature is valid. Anyone can verify without needing a private key.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The original message that was signed' },
        signature: { type: 'string', description: 'The Base64-encoded Ed25519 signature' },
        signer: { type: 'string', description: 'The signer\'s public key (Base64) or DID (did:msig:...)' },
      },
      required: ['message', 'signature', 'signer'],
    },
  },
  {
    name: 'meshsig_identity',
    description: 'Show your MeshSig identity — DID and public key. Returns null if no identity has been generated yet.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'meshsig_agents',
    description: 'List all agents registered on the MeshSig server with their DIDs, trust scores, capabilities, and origin (local/remote).',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'MeshSig server URL', default: 'http://localhost:4888' },
      },
    },
  },
  {
    name: 'meshsig_audit',
    description: 'Export the complete audit report from the MeshSig server — all agents, connections, signed messages, and verification status. Useful for compliance and security reviews.',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'MeshSig server URL', default: 'http://localhost:4888' },
      },
    },
  },
  {
    name: 'meshsig_stats',
    description: 'Get MeshSig server statistics — number of agents, connections, messages, and uptime.',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'MeshSig server URL', default: 'http://localhost:4888' },
      },
    },
  },
  {
    name: 'meshsig_revoke',
    description: 'Revoke a compromised agent. This permanently blocks all future messages from this agent. Cannot be undone.',
    inputSchema: {
      type: 'object',
      properties: {
        did: { type: 'string', description: 'The DID of the agent to revoke (did:msig:...)' },
        reason: { type: 'string', description: 'Reason for revocation', default: 'Compromised' },
        server: { type: 'string', description: 'MeshSig server URL', default: 'http://localhost:4888' },
      },
      required: ['did'],
    },
  },
  {
    name: 'meshsig_revoked',
    description: 'List all revoked (compromised) agents on the MeshSig server.',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'MeshSig server URL', default: 'http://localhost:4888' },
      },
    },
  },
];

// -- Tool Handlers -----------------------------------------------------------

async function handleTool(name: string, args: any): Promise<any> {
  switch (name) {
    case 'meshsig_init': {
      ensureDir();
      if (existsSync(IDENTITY_FILE) && !args.force) {
        const existing = loadIdentity();
        return { content: [{ type: 'text', text: `Identity already exists.\nDID: ${existing.did}\nPublic Key: ${existing.publicKey}\nUse force=true to regenerate.` }] };
      }
      const identity = await generateIdentity();
      writeFileSync(IDENTITY_FILE, JSON.stringify(identity, null, 2));
      return { content: [{ type: 'text', text: `✓ Identity generated\nDID: ${identity.did}\nPublic Key: ${identity.publicKey}\nStored at: ${IDENTITY_FILE}\n\nYour private key is stored locally. Never share it.` }] };
    }

    case 'meshsig_sign': {
      const identity = loadIdentity();
      if (!identity) return { content: [{ type: 'text', text: 'No identity found. Run meshsig_init first.' }], isError: true };
      const signature = await sign(args.message, identity.privateKey);
      const hash = hashPayload(args.message);
      return { content: [{ type: 'text', text: JSON.stringify({
        did: identity.did, message: args.message, signature, hash,
        publicKey: identity.publicKey, timestamp: new Date().toISOString(),
      }, null, 2) }] };
    }

    case 'meshsig_verify': {
      let valid: boolean;
      if (isValidDid(args.signer)) {
        valid = await verifyWithDid(args.message, args.signature, args.signer);
      } else {
        valid = await verify(args.message, args.signature, args.signer);
      }
      return { content: [{ type: 'text', text: valid
        ? `✓ SIGNATURE VALID\nSigner: ${args.signer}`
        : `✗ SIGNATURE INVALID\nSigner: ${args.signer}\nThe signature does not match the message and key provided.`
      }] };
    }

    case 'meshsig_identity': {
      const identity = loadIdentity();
      if (!identity) return { content: [{ type: 'text', text: 'No identity found. Run meshsig_init first.' }] };
      return { content: [{ type: 'text', text: JSON.stringify({
        did: identity.did, publicKey: identity.publicKey, createdAt: identity.createdAt,
      }, null, 2) }] };
    }

    case 'meshsig_agents': {
      const server = args.server || DEFAULT_SERVER;
      try {
        const res = await fetch(`${server}/agents`);
        const data = await res.json() as any;
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch { return { content: [{ type: 'text', text: `Cannot connect to MeshSig server at ${server}` }], isError: true }; }
    }

    case 'meshsig_audit': {
      const server = args.server || DEFAULT_SERVER;
      try {
        const res = await fetch(`${server}/audit/export`);
        const data = await res.json();
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch { return { content: [{ type: 'text', text: `Cannot connect to MeshSig server at ${server}` }], isError: true }; }
    }

    case 'meshsig_stats': {
      const server = args.server || DEFAULT_SERVER;
      try {
        const res = await fetch(`${server}/stats`);
        const data = await res.json();
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch { return { content: [{ type: 'text', text: `Cannot connect to MeshSig server at ${server}` }], isError: true }; }
    }

    case 'meshsig_revoke': {
      const server = args.server || DEFAULT_SERVER;
      try {
        const res = await fetch(`${server}/agents/revoke`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ did: args.did, reason: args.reason || 'Compromised' }),
        });
        const data = await res.json();
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch { return { content: [{ type: 'text', text: `Cannot connect to MeshSig server at ${server}` }], isError: true }; }
    }

    case 'meshsig_revoked': {
      const server = args.server || DEFAULT_SERVER;
      try {
        const res = await fetch(`${server}/revoked`);
        const data = await res.json();
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch { return { content: [{ type: 'text', text: `Cannot connect to MeshSig server at ${server}` }], isError: true }; }
    }

    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
}

// -- MCP Message Handler -----------------------------------------------------

async function handleMessage(req: JsonRpcRequest) {
  switch (req.method) {
    case 'initialize':
      sendResponse(req.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'meshsig', version: '0.7.0' },
      });
      break;

    case 'notifications/initialized':
      break;

    case 'tools/list':
      sendResponse(req.id, { tools: TOOLS });
      break;

    case 'tools/call': {
      const { name, arguments: args } = req.params;
      try {
        const result = await handleTool(name, args || {});
        sendResponse(req.id, result);
      } catch (err: any) {
        sendResponse(req.id, {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        });
      }
      break;
    }

    default:
      if (req.id !== undefined) {
        sendError(req.id, -32601, `Method not found: ${req.method}`);
      }
  }
}

// -- Stdio Transport ---------------------------------------------------------

let buffer = '';

process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const msg = JSON.parse(trimmed);
      handleMessage(msg).catch(err => {
        console.error('MCP handler error:', err);
      });
    } catch {
      // skip non-JSON lines
    }
  }
});

process.stdin.on('end', () => process.exit(0));

console.error('MeshSig MCP Server started — waiting for JSON-RPC messages on stdin');
