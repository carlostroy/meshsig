<p align="center">
  <img src="assets/logo.svg" width="280" alt="MeshSig Logo">
</p>

<p align="center">
  <img src="https://github.com/carlostroy/meshsig/actions/workflows/ci.yml/badge.svg" alt="CI" />
  <img src="https://img.shields.io/badge/Ed25519-Cryptographic_Identity-00d4ff?style=for-the-badge" />
  <img src="https://img.shields.io/badge/W3C-DID_Standard-8b5cf6?style=for-the-badge" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" />
  <img src="https://img.shields.io/badge/npm-%40meshsig%2Fsdk-f0b429?style=for-the-badge" />
</p>

<h1 align="center">MeshSig</h1>

<p align="center">
  <strong>Cryptographic security layer for AI agents.</strong><br>
  <em>Identity · Signed Messages · Verified Handshakes · Prompt Injection Defense · Trust Scoring</em>
</p>

<p align="center">
  <a href="https://meshsig.dev">meshsig.dev</a> ·
  <a href="#meshsig-sdk">SDK</a> ·
  <a href="#cli">CLI</a> ·
  <a href="#dashboard">Dashboard</a> ·
  <a href="#mcp-server">MCP</a> ·
  <a href="#integrations">Integrations</a> ·
  <a href="#api-reference">API</a> ·
  <a href="#audit--compliance">Audit</a>
</p>

---

## What is MeshSig?

MeshSig gives every AI agent a **cryptographic identity** and secures every agent-to-agent communication with **Ed25519 digital signatures**.

The core problem: AI agents read content from the world — web pages, files, messages, tool outputs — and execute instructions found there. There is no standard way to verify whether an instruction came from a trusted source or from malicious content injected into the agent's context.

MeshSig fixes this. Every instruction an agent executes can be verified against a cryptographic signature from a known `did:msig:` identity. No valid signature — no execution.

When Agent A sends a task to Agent B, MeshSig:
- Signs the message with Agent A's private key
- Verifies the signature mathematically before delivery
- Logs the interaction with a tamper-proof audit trail
- Updates trust scores based on verified history

No one can impersonate an agent. No one can tamper with a message. Every interaction has cryptographic proof.

---

## @meshsig/sdk

The core SDK. Use it to add instruction verification to any agent — custom, framework-based, or agentic pipeline.

```bash
npm install @meshsig/sdk
```

```typescript
import { generateIdentity, sign, verifyWithDid } from '@meshsig/sdk';

// Every agent gets a cryptographic identity
const agent = await generateIdentity();
console.log(agent.did); // did:msig:3icqQkmJWby4S5rpaSRoCcKvjKWdTvqViy...

// Sign instructions at the trusted source
const signature = await sign('deploy to production', agent.privateKey);

// Before executing ANY instruction — verify origin
const trusted = await verifyWithDid('deploy to production', signature, agent.did);
if (!trusted) throw new Error('Instruction origin not verified — blocked');
```

### Middleware pattern

Drop this before any tool call in your agent:

```typescript
import { verifyWithDid, MeshError } from '@meshsig/sdk';

async function safeExecute(instruction: string, signature: string, fromDid: string) {
  const trusted = await verifyWithDid(instruction, signature, fromDid);
  if (!trusted) throw new MeshError('Untrusted instruction', 'INVALID_SIGNATURE', 401);
  // safe to execute
}
```

### Handshake between agents

```typescript
import {
  createHandshakeRequest,
  verifyHandshakeRequest,
  createHandshakeResponse,
} from '@meshsig/sdk';

// Agent A initiates
const request = await createHandshakeRequest(
  agentA.did, agentB.did, agentA.privateKey, ['execute:task']
);

// Agent B verifies and responds
await verifyHandshakeRequest(request, agentB.publicKey);
const response = await createHandshakeResponse(
  request, agentB.did, agentB.privateKey, true, ['execute:task'], channelId
);
```

### SDK API

**Identity**
- `generateIdentity()` → `AgentIdentity` — Ed25519 keypair + `did:msig:` DID
- `isValidDid(did)` → `boolean`
- `didToPublicKey(did)` → `Uint8Array`

**Signing & Verification**
- `sign(message, privateKey)` → `signature`
- `verify(message, signature, publicKey)` → `boolean`
- `verifyWithDid(message, signature, did)` → `boolean`
- `hashPayload(payload)` → `hex`
- `generateNonce()` → `string`

**Handshake**
- `createHandshakeRequest(fromDid, toDid, privateKey, permissions)`
- `verifyHandshakeRequest(request, publicKey)`
- `createHandshakeResponse(request, did, privateKey, accepted, permissions, channelId)`
- `verifyHandshakeResponse(response, request, publicKey)`

**Security Utilities**
- `RateLimiter` — per-IP rate limiting
- `ReplayGuard` — prevent signature replay attacks
- `validateAgentName(name)` — sanitize agent names
- `validateCapabilities(caps)` — sanitize capability lists

---

## Quick Start (Full Server)

```bash
npx meshsig init        # Generate Ed25519 identity
npx meshsig sign "msg"  # Sign a message
npx meshsig start       # Start the server + dashboard
```

Or install globally:

```bash
npm install -g meshsig
meshsig start
```

## Proxy Mode (Recommended)

MeshSig can transparently intercept all agent-to-agent traffic. **Zero changes to your agents or gateway.**

```bash
bash scripts/deploy-proxy.sh 3001
```

MeshSig intercepts traffic to port 3001, signs every message with Ed25519, and forwards it to the real gateway.

```
WITHOUT MESHSIG:
  Agent → localhost:3001 → Gateway → executes

WITH MESHSIG:
  Agent → localhost:3001 → [iptables] → MeshSig:4888 [SIGN ✓] → Gateway:3001 → executes
                                              ↓
                                        Dashboard + Audit
```

To remove:

```bash
bash scripts/deploy-proxy.sh --remove 3001
```

Or from source:

```bash
git clone https://github.com/carlostroy/meshsig.git
cd meshsig
npm install && npm run build
node dist/main.js start
```

Open `http://localhost:4888` — live security dashboard.

---

## CLI

```bash
# Generate your Ed25519 identity
meshsig init
# ✓ Identity generated
#   DID: did:msig:3icqQkmJWby4S5rpaSRoCcKvjKWdTvqViyPrCEC7Tek2

# Sign a message
meshsig sign "Deploy the new model to production"
# ✓ Message signed
#   SIGNATURE: HkyrXOPOXF7v422A4iOcg/qkg...

# Verify a signature (with DID or public key)
meshsig verify "Deploy the new model" "HkyrXO..." "did:msig:3icq..."
# ✓ SIGNATURE VALID

# Show your identity
meshsig identity

# List agents on the mesh
meshsig agents

# Server statistics
meshsig stats

# Export audit log
meshsig audit --json > report.json

# Rotate your keypair (DID stays the same)
meshsig rotate-key

# Revoke a compromised agent
meshsig revoke "did:msig:..." --reason "Key leaked"

# List revoked agents
meshsig revoked

# Start the server
meshsig start --port 4888
```

All commands support `--json` for piping and automation.

---

## Dashboard

Real-time security operations dashboard. Watch agents exchange signed messages and track trust scores.

```bash
meshsig start --port 4888
# Open http://localhost:4888
```

- **Agents** — Cards with DID, trust score, capabilities, status
- **Messages** — Full message log with signature verification
- **Audit Report** — Summary stats with JSON export
- **Verify Signature** — Paste message + signature to verify manually

---

## Audit & Compliance

Every signed message is logged with cryptographic proof.

```bash
curl http://localhost:4888/audit/export
```

Returns JSON with:
- Summary (total agents, messages, verified/failed counts, average trust)
- All agents with DIDs, public keys, trust scores
- All connections with handshake proof
- All messages with signatures and verification status

```bash
meshsig audit --json > audit-2026-03.json
```

---

## Security Features

### Prompt Injection Defense

MeshSig provides a cryptographic boundary between trusted instructions and untrusted content. Instructions that arrive without a valid `did:msig:` signature are treated as data — never as commands. This is enforced at the SDK level before execution, regardless of how the content looks or what it claims.

### Key Rotation

Rotate an agent's keypair without losing its identity (DID).

```bash
meshsig rotate-key

# API
curl -X POST http://localhost:4888/agents/rotate-key \
  -H 'Content-Type: application/json' \
  -d '{"did":"did:msig:...","currentPrivateKey":"base64..."}'
```

### Agent Revocation

Permanently revoke a compromised agent. All future messages are rejected with `403 Forbidden`.

```bash
meshsig revoke "did:msig:..." --reason "Key leaked"
```

Revocation is irreversible by design.

---

## Integrations

MeshSig is **framework-agnostic** — works with any agent system via the SDK, HTTP API, CLI, or MCP protocol.

### @meshsig/sdk (any JS/TS framework)

```typescript
import { generateIdentity, sign, verifyWithDid } from '@meshsig/sdk';
```

### HTTP API (any language)

```bash
# Register an agent
curl -X POST http://localhost:4888/agents/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-agent","capabilities":[{"type":"analysis"}]}'

# Send a signed message
curl -X POST http://localhost:4888/messages/send \
  -H 'Content-Type: application/json' \
  -d '{"fromDid":"did:msig:...","toDid":"did:msig:...","message":"task","privateKey":"..."}'
```

### Python

```python
import requests

r = requests.post('http://localhost:4888/agents/register',
    json={'name': 'my-agent', 'capabilities': [{'type': 'analysis'}]})
agent = r.json()

r = requests.post('http://localhost:4888/verify',
    json={'message': 'hello', 'signature': sig, 'did': agent['record']['did']})
print(r.json()['valid'])  # True
```

### OpenClaw (Native)

```bash
bash scripts/install.sh
```

Discovers all OpenClaw agents, generates `did:msig:` identity for each, and replaces `invoke.sh` with a signed version.

```
Before:  Agent A → invoke.sh → Agent B  (no proof)
After:   Agent A → invoke.sh → [SIGN] → MeshSig → [VERIFY] → Agent B
```

---

## How It Works

### Identity

Every agent receives an Ed25519 keypair and a W3C Decentralized Identifier:

```
did:msig:6QoiRtfC29pfDoDA4um3TMrBpaCq6kr...
```

The DID is derived from the public key. Impossible to forge. Universally verifiable.

### Signed Messages

```json
{
  "from": "did:msig:6Qoi...",
  "to": "did:msig:8GkC...",
  "message": "Analyze the Q1 sales report",
  "signature": "LsBbF/FRgaacn1jIMBwK6hxr22jCT...",
  "verified": true
}
```

### Trust Scoring

Trust is earned, not declared:
- Every verified message: trust increases
- Every failed verification: trust decreases
- Based on real interactions, not self-assessment

### Multi-Server Networking

```bash
meshsig start --port 4888
meshsig start --port 4888 --peer ws://server1:4888
```

---

## API Reference

```
GET  /                  Live dashboard
GET  /health            Server status
GET  /stats             Network statistics
GET  /snapshot          Full network state
GET  /verify            Public signature verifier (browser)
POST /verify            Verify a signature (API)
GET  /audit/export      Compliance audit report (JSON)

POST /agents/register   Register agent → returns Ed25519 keypair + DID
GET  /agents            List all agents with trust scores
GET  /agents/:did       Get specific agent
POST /agents/rotate-key Rotate an agent's Ed25519 keypair
POST /agents/revoke     Revoke a compromised agent
GET  /revoked           List all revoked agents

POST /discover          Find agents by capability
POST /discover/network  Find across connected peers

POST /messages/send     Sign + verify + log a message
POST /messages/verify   Verify a message signature

POST /handshake         Cryptographic handshake between agents
GET  /connections       List verified connections
GET  /messages          Recent signed messages

GET  /peers             Connected MeshSig instances
POST /peers/connect     Connect to another instance

WS   ws://host:port     Live event stream
```

---

## Security

| Layer | Implementation |
|-------|---------------|
| Prompt Injection | Instructions without valid `did:msig:` signature blocked before execution |
| Signatures | Ed25519 — same as SSH, Signal, WireGuard, TLS 1.3 |
| Identity | W3C DID standard (`did:msig:`) |
| Handshake | Mutual challenge-response with nonce and timestamp |
| Storage | Local SQLite — no cloud dependency |
| Audit | Tamper-evident log with cryptographic hashes |
| Key Rotation | Generate new keypair, DID preserved, old key invalidated |
| Revocation | Permanently block compromised agents, public revocation list |
| Rate Limiting | 60 req/min per IP, protects against abuse |

See [docs/SECURITY.md](docs/SECURITY.md) for the full security whitepaper.

---

## Requirements

- Node.js ≥ 18

No database to configure. No cloud services. No API keys.

## Docker

```bash
docker build -t meshsig .
docker run -p 4888:4888 meshsig
```

---

## MCP Server

MeshSig works as a Model Context Protocol (MCP) server.

**9 tools:** `meshsig_init`, `meshsig_sign`, `meshsig_verify`, `meshsig_identity`, `meshsig_agents`, `meshsig_stats`, `meshsig_audit`, `meshsig_revoke`, `meshsig_revoked`

### Claude Desktop

```json
{
  "mcpServers": {
    "meshsig": {
      "command": "npx",
      "args": ["meshsig-mcp"]
    }
  }
}
```

### Cursor / Windsurf / Cline

```json
{
  "meshsig": {
    "command": "npx",
    "args": ["meshsig-mcp"]
  }
}
```

- `MESHSIG_SERVER` — MeshSig server URL (default: `http://localhost:4888`)

---

## License

MIT

---

<p align="center">
  <strong>MeshSig</strong> — Cryptographic security layer for AI agents.<br>
  <a href="https://meshsig.dev">meshsig.dev</a> · <a href="https://github.com/carlostroy/meshsig">GitHub</a>
</p>
