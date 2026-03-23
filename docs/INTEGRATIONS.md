# MeshSig Integrations

## Cline + MeshSig

Cline is an AI coding agent running inside VS Code. It reads files, executes commands, opens issues, and calls APIs automatically. By default, Cline has no way to verify whether an instruction came from a trusted source or from malicious content injected into its context.

MeshSig adds a cryptographic verification layer to Cline via the MCP protocol.

### Setup (2 minutes)

**1. Add MeshSig to your Cline MCP config**

Open your Cline MCP settings and add:

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

**2. Initialize your identity**

In the terminal:

```bash
npx meshsig init
# ✓ Identity generated
#   DID: did:msig:3icqQkmJWby4S5rpaSRoCcKvjKWdTvqViy...
```

**3. Start using MeshSig tools inside Cline**

Cline now has access to 9 MeshSig tools directly. You can ask Cline:

- *"Sign this deployment instruction with MeshSig"*
- *"Verify the signature of this message before executing"*
- *"Check if this agent identity is trusted"*
- *"Show me the audit log of recent delegations"*

### What This Protects

Without MeshSig, Cline reads content from the world — GitHub issues, files, web pages, tool outputs — and may execute instructions found there. A malicious issue title, a poisoned file, or a crafted API response can all trigger unintended actions.

With MeshSig:

```
WITHOUT MESHSIG:
  Cline reads GitHub issue → sees instruction → executes

WITH MESHSIG:
  Cline reads GitHub issue → no valid did:msig: signature → treats as data, not command
```

Instructions from trusted sources carry a valid Ed25519 signature. Everything else is data.

### Verification in Practice

```typescript
import { verifyWithDid } from '@meshsig/sdk';

// Before Cline executes any instruction from external content:
const trusted = await verifyWithDid(instruction, signature, fromDid);
if (!trusted) {
  throw new Error('Instruction origin not verified — blocked');
}
// Only reaches here if signature is valid
```

### Audit Trail

Every signed interaction is logged. Export anytime:

```bash
npx meshsig audit --json > cline-audit.json
```

---

## OpenClaw + MeshSig

OpenClaw is an AI agent runtime for running persistent agents on a VPS. MeshSig is natively integrated into OpenClaw via `invoke-mesh.sh` — every agent-to-agent delegation is cryptographically signed and verified automatically.

### How It Works

When Agent A (e.g. Paulo, your COO agent) delegates a task to Agent B (e.g. Bora, your Copywriter agent), the flow is:

```
WITHOUT MESHSIG:
  Paulo → invoke.sh → Bora  (no proof of origin)

WITH MESHSIG:
  Paulo → invoke-mesh.sh → [Ed25519 SIGN] → MeshSig → [VERIFY] → Bora
                                                  ↓
                                         Audit log + Dashboard
```

### Setup

**1. Install MeshSig on your OpenClaw VPS**

```bash
cd /opt/meshsig
bash scripts/install.sh
```

The install script automatically:
- Discovers all OpenClaw agents on the machine
- Generates an Ed25519 identity (`did:msig:...`) for each agent
- Creates verified connections via cryptographic handshake
- Replaces `invoke.sh` with a signed version (original backed up as `invoke.sh.backup`)

**2. Register new agents as they are provisioned**

```bash
bash scripts/register-agent.sh agent-name
```

**3. Remove agents when deprovisioned**

```bash
bash scripts/unregister-agent.sh agent-name
```

### Transparent Proxy Mode

MeshSig can intercept all agent traffic without any changes to your agents or gateway:

```bash
bash scripts/deploy-proxy.sh 3001
```

MeshSig intercepts traffic to port 3001, signs every delegation with Ed25519, and forwards to the real gateway. Your agents are unaware MeshSig exists.

```
Agent → localhost:3001 → [iptables] → MeshSig:4888 [SIGN ✓] → Gateway:3001 → executes
                                              ↓
                                       Dashboard + Audit
```

To remove:

```bash
bash scripts/deploy-proxy.sh --remove 3001
```

### Dashboard

Watch your OpenClaw agents exchange signed delegations in real time:

```bash
meshsig start --port 4888
# Open http://localhost:4888
```

### What Each Agent Gets

After installation, each OpenClaw agent has:

| Property | Value |
|----------|-------|
| Identity | `did:msig:...` (Ed25519 keypair) |
| Signing | Every delegation signed automatically |
| Verification | Every incoming delegation verified |
| Audit | Full log of who delegated what to whom |
| Trust Score | Updated on every verified interaction |

### Verified Delegation Example

Paulo delegates a task to Bora:

```bash
bash scripts/invoke-mesh.sh bora "Write a product launch post for MeshSig"
```

What happens:
1. MeshSig signs the instruction with Paulo's private key
2. Bora's identity is verified via handshake
3. The delegation is logged with timestamp and cryptographic proof
4. Bora executes — with full audit trail

### Revoking a Compromised Agent

If an agent is compromised:

```bash
meshsig revoke "did:msig:..." --reason "Key compromised"
```

All future delegations to or from this agent are blocked with `403 Forbidden`.

---

## Cline vs OpenClaw — Which Integration to Use?

| | Cline | OpenClaw |
|--|-------|----------|
| Where it runs | VS Code (local) | VPS (server) |
| Integration method | MCP protocol | Native scripts |
| Setup time | 2 minutes | 5 minutes |
| Instruction verification | Via MCP tools | Automatic (transparent proxy) |
| Agent-to-agent signing | Manual | Automatic |
| Dashboard | meshsig.dev | localhost:4888 |
| Best for | Individual developer | Multi-agent production system |

Both use the same cryptographic core — Ed25519 + `did:msig:` — and the same audit format.

---

## Further Reading

- [Security Whitepaper](docs/SECURITY.md)
- [Threat Model](THREAT-MODEL.md)
- [@meshsig/sdk on npm](https://www.npmjs.com/package/@meshsig/sdk)
- [meshsig.dev](https://meshsig.dev)
