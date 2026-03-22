# @meshsig/sdk

Cryptographic security layer for AI agents. Verify instruction origin before execution.
```bash
npm install @meshsig/sdk
```

## Why

In February 2026, a hacker exploited Cline's automated GitHub issue triage — a Claude-powered workflow — by injecting malicious instructions into an issue title. Claude executed them as if they were legitimate commands, poisoned the build cache, stole npm publish tokens, and silently installed malware on 4,000 developer machines.

The root cause: the agent had no way to distinguish a legitimate instruction from injected content.

MeshSig fixes this. Every instruction that an agent executes must carry a valid Ed25519 signature from a known `did:msig:` identity. No signature, no execution.

## How It Works
```
Without MeshSig:
  Agent reads GitHub issue → Claude sees instruction → executes

With MeshSig:
  Agent reads GitHub issue → verify(instruction, signature, did) → no sig → blocked
```

## Quick Start
```typescript
import { generateIdentity, sign, verify, verifyWithDid } from '@meshsig/sdk';

// Generate an identity for your agent
const agent = await generateIdentity();
console.log(agent.did); // did:msig:3icqQkmJWby4S5rpaSRoCcKvjKWdTvqViy...

// Sign an instruction (trusted source only)
const signature = await sign('deploy to production', agent.privateKey);

// Before executing ANY instruction — verify origin
const trusted = await verifyWithDid('deploy to production', signature, agent.did);
if (!trusted) throw new Error('Instruction origin not verified — blocked');
```

## Middleware Pattern
```typescript
import { verifyWithDid, MeshError } from '@meshsig/sdk';

// Drop this before any tool call in your agent
async function safeExecute(instruction: string, signature: string, fromDid: string) {
  const trusted = await verifyWithDid(instruction, signature, fromDid);
  if (!trusted) throw new MeshError('Untrusted instruction', 'INVALID_SIGNATURE', 401);
  // safe to execute
}
```

## Handshake Between Agents
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

## Works With Any Framework
```typescript
// LangChain, CrewAI, AutoGen, OpenClaw, or any agent system
import { verifyWithDid } from '@meshsig/sdk';

// Wrap your tool executor
const originalExecute = agent.execute.bind(agent);
agent.execute = async (instruction, meta) => {
  if (meta?.signature && meta?.fromDid) {
    const ok = await verifyWithDid(instruction, meta.signature, meta.fromDid);
    if (!ok) throw new Error('Blocked: unverified instruction origin');
  }
  return originalExecute(instruction, meta);
};
```

## API

### Identity
- `generateIdentity()` → `AgentIdentity` — Ed25519 keypair + `did:msig:` DID
- `isValidDid(did)` → `boolean`
- `didToPublicKey(did)` → `Uint8Array`

### Signing & Verification
- `sign(message, privateKey)` → `signature`
- `verify(message, signature, publicKey)` → `boolean`
- `verifyWithDid(message, signature, did)` → `boolean`
- `hashPayload(payload)` → `hex`
- `generateNonce()` → `string`

### Handshake
- `createHandshakeRequest(fromDid, toDid, privateKey, permissions)`
- `verifyHandshakeRequest(request, publicKey)`
- `createHandshakeResponse(request, did, privateKey, accepted, permissions, channelId)`
- `verifyHandshakeResponse(response, request, publicKey)`

### Security Utilities
- `RateLimiter` — per-IP rate limiting
- `ReplayGuard` — prevent signature replay attacks
- `validateAgentName(name)` — sanitize agent names
- `validateCapabilities(caps)` — sanitize capability lists

## Full Server

Need the full MeshSig server with dashboard, audit log, and MCP support?
```bash
npm install -g meshsig
meshsig start
```

[github.com/carlostroy/meshsig](https://github.com/carlostroy/meshsig)

## License

MIT
