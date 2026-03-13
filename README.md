<p align="center">
  <img src="https://img.shields.io/badge/Ed25519-Cryptographic_Identity-00d4ff?style=for-the-badge" />
  <img src="https://img.shields.io/badge/W3C-DID_Standard-8b5cf6?style=for-the-badge" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" />
</p>

<h1 align="center">MeshSig</h1>

<p align="center">
  <strong>Cryptographic security layer for AI agents.</strong><br>
  <em>Identity · Verification · Signed Communication · Trust</em>
</p>

<p align="center">
  <a href="https://meshsig.ai">meshsig.ai</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#openclaw-integration">OpenClaw Integration</a> ·
  <a href="#api-reference">API</a>
</p>

---

## What is MeshSig?

MeshSig gives every AI agent a **cryptographic identity** and secures every agent-to-agent communication with **Ed25519 digital signatures**.

When Agent A sends a task to Agent B, MeshSig:
- Signs the message with Agent A's private key
- Verifies the signature mathematically before delivery
- Logs the interaction with tamper-proof audit trail
- Updates trust scores based on verified history

No one can impersonate an agent. No one can tamper with a message. Every interaction has cryptographic proof.

## Why It Matters

AI agents are being deployed in production — handling customer data, executing transactions, making decisions. But there's no standard way to:

- **Prove** which agent sent a message
- **Verify** that a message wasn't tampered with
- **Audit** what happened and who did it
- **Trust** an agent based on its real track record

MeshSig solves all four. Same cryptography behind SSH, Signal, and WireGuard — applied to AI agent communication.

## Quick Start

```bash
git clone https://github.com/carlostroy/meshsig.git
cd meshsig
npm install
npm run build
node dist/main.js start --port 4888
```

Open `http://localhost:4888` for the live dashboard.

## OpenClaw Integration

MeshSig integrates natively with [OpenClaw](https://openclaw.com) — the open-source AI agent framework. One install secures all agent-to-agent delegations with cryptographic signatures.

### Install

```bash
# With MeshSig running on the same server as OpenClaw:
cd /path/to/meshsig
bash scripts/install.sh
```

The install script automatically:
1. Discovers all OpenClaw agents on the machine
2. Generates Ed25519 identity (`did:msig:...`) for each agent
3. Creates verified connections via cryptographic handshake
4. Replaces `invoke.sh` with a signed version (original backed up)

After install, every delegation between agents is automatically signed, verified, and logged. No code changes needed.

### What Changes

```
Before MeshSig:
  Agent A → invoke.sh → Agent B
  (no proof of who sent what)

After MeshSig:
  Agent A → invoke-mesh.sh → [SIGN] → MeshSig → [VERIFY + LOG] → Agent B
  (cryptographic proof on every message)
```

### Uninstall

```bash
bash scripts/uninstall.sh
```

Restores original `invoke.sh` files. No data lost.

## How It Works

### Identity

Every agent receives an Ed25519 keypair and a W3C Decentralized Identifier:

```
did:msig:6QoiRtfC29pfDoDA4um3TMrBpaCq6kr...
```

The DID is derived from the public key. Impossible to forge. Universally verifiable.

### Signed Messages

Every message carries a digital signature:

```json
{
  "from": "did:msig:6Qoi...",
  "to": "did:msig:8GkC...",
  "message": "Analyze the Q1 sales report",
  "signature": "LsBbF/FRgaacn1jIMBwK6hxr22jCT...",
  "verified": true,
  "timestamp": "2026-03-12T19:31:33.808Z"
}
```

Anyone can verify the signature against the sender's public key. If one character of the message was changed, verification fails.

### Trust Scoring

Trust is earned, not declared:
- Every verified message: trust increases
- Every failed verification: trust decreases
- Trust is per-agent and per-connection
- Based on real interactions, not self-assessment

### Live Dashboard

Browser-based real-time visualization:
- Agent network graph (D3.js force simulation)
- Connections with trust indicators
- Messages flowing between agents
- Event log with signatures

### Multi-Server Networking

Connect MeshSig instances across servers:

```bash
# Server 1
node dist/main.js start --port 4888

# Server 2 — connects to Server 1
node dist/main.js start --port 4888 --peer ws://server1:4888
```

Agents on different servers discover each other automatically.

## API Reference

```
GET  /                  Live dashboard
GET  /health            Server status
GET  /stats             Network statistics
GET  /snapshot          Full network state

POST /agents/register   Register agent → returns Ed25519 keypair + DID
GET  /agents            List all agents with trust scores
GET  /agents/:did       Get specific agent

POST /discover          Find agents by capability
POST /discover/network  Find across connected peers

POST /messages/send     Sign + verify + log a message
POST /messages/verify   Verify a signature

POST /handshake         Cryptographic handshake between agents
GET  /connections       List verified connections
GET  /messages          Recent signed messages

GET  /peers             Connected MeshSig instances
POST /peers/connect     Connect to another instance

WS   ws://host:port     Live event stream
```

## Security

| Layer | Implementation |
|-------|---------------|
| Signatures | Ed25519 — same as SSH, Signal, WireGuard, TLS 1.3 |
| Identity | W3C DID standard (`did:msig:`) |
| Handshake | Mutual challenge-response with nonce and timestamp |
| Storage | Local SQLite — no cloud dependency, data stays on your machine |
| Audit | Tamper-evident log with cryptographic hashes |

See [docs/SECURITY.md](docs/SECURITY.md) for the full security whitepaper.

## Requirements

- Node.js ≥ 18

No database to configure. No cloud services. No API keys. Install, start, secure.

## License

MIT

---

<p align="center">
  <strong>MeshSig</strong> — Cryptographic security layer for AI agents.<br>
  <a href="https://meshsig.ai">meshsig.ai</a>
</p>
