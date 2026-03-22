# MeshSig Security Whitepaper

**Version 0.10 — March 2026**  
**Status:** Living document — updated as the protocol evolves.

---

## Abstract

MeshSig is an open protocol for cryptographic identity, discovery, and verified coordination between AI agents. This document explains every security decision, how the cryptography works, what guarantees it provides, and how anyone can verify these claims independently.

---

## 1. The Problem

AI agents are deployed in production — reading content, executing instructions, delegating tasks to other agents. The core security gap is simple: there is no standard way to verify whether an instruction came from a trusted source or from untrusted content injected into the agent's context.

This creates three distinct failure modes:

- **No identity verification.** Any source can claim to be a trusted agent. No cryptographic proof exists of who sent a message.
- **Prompt injection.** Agents read content from the world — web pages, files, emails, tool outputs, issue trackers — and execute instructions found there without any origin verification.
- **No audit trail.** No tamper-proof record of who communicated with whom, or whether messages were authentic.

MeshSig addresses all three by providing a cryptographic trust layer beneath agent communication.

---

## 2. Cryptographic Foundation: Ed25519

### 2.1 What It Is

MeshSig uses **Ed25519** (Edwards-curve Digital Signature Algorithm) for all identity and signing operations. Ed25519 was designed in 2011 by Daniel J. Bernstein, Niels Duif, Tanja Lange, Peter Schwabe, and Bo-Yin Yang.

It is not experimental or novel. It is the current industry standard for digital signatures.

### 2.2 Who Else Uses It

| System | Usage |
|--------|-------|
| OpenSSH | Default key type since 2014 |
| Signal Protocol | Identity keys for end-to-end encryption |
| WireGuard | VPN authentication |
| TLS 1.3 | Web encryption (HTTPS) |
| Tor | Onion service identity |
| GnuPG/OpenPGP | Digital signatures |
| Solana, Cardano | Blockchain transaction signing |
| GitHub | SSH key authentication |
| macOS/iOS | Code signing |

### 2.3 Why Ed25519

Compared to alternatives:

| Property | Ed25519 | RSA-2048 | ECDSA P-256 |
|----------|---------|----------|-------------|
| Key size | 32 bytes | 256 bytes | 32 bytes |
| Signature size | 64 bytes | 256 bytes | 64 bytes |
| Sign speed | ~15,000/sec | ~1,000/sec | ~10,000/sec |
| Verify speed | ~7,000/sec | ~15,000/sec | ~5,000/sec |
| Side-channel resistant | Yes (by design) | Requires care | Requires care |
| Deterministic | Yes | No (needs random) | No (needs random) |
| Patent-free | Yes | Yes | Disputed |

Key advantages for MeshSig:

- **Deterministic signing.** The same message + key always produces the same signature. No dependency on random number quality at signing time.
- **Side-channel resistant by design.** The algorithm was specifically designed to resist timing attacks, unlike RSA and ECDSA which require careful implementation.
- **Small and fast.** 32-byte keys and 64-byte signatures are efficient for high-frequency agent communication.

### 2.4 Security Level

Ed25519 provides **128-bit security**. This means:

- The best known attack requires approximately 2^128 operations.
- With current technology, this would take longer than the age of the universe to compute.
- Even a hypothetical computer performing 10^18 operations per second would need approximately 10^20 years.

### 2.5 Quantum Computing Consideration

Ed25519 is vulnerable to Shor's algorithm on a sufficiently large quantum computer. However:

- No quantum computer exists today that can run Shor's algorithm at the scale needed to break Ed25519.
- Current estimates suggest this capability is 15-30+ years away.
- When post-quantum migration becomes necessary, MeshSig's DID system allows key rotation to quantum-resistant algorithms (e.g., CRYSTALS-Dilithium) without changing agent identities.
- This is the same position as SSH, TLS, Signal, and every other system using elliptic curve cryptography today.

---

## 3. Identity System

### 3.1 Key Generation

When an agent is created, the following happens **entirely on the local machine**:

```
1. Generate 32 random bytes from OS CSPRNG
   ├── Node.js: crypto.getRandomValues() 
   ├── Sources: /dev/urandom (Linux), CryptGenRandom (Windows)
   └── This is the PRIVATE KEY

2. Derive public key via Curve25519 scalar multiplication
   ├── Input: private key (32 bytes)
   ├── Operation: fixed-base scalar multiplication on Ed25519 curve
   └── Output: PUBLIC KEY (32 bytes)

3. Encode public key as DID
   ├── Base58 encode the public key
   └── Prepend "did:msig:"
   └── Result: did:msig:7Hn3bKpLmNqRsTvWxYz...
```

**Critical guarantee:** The private key is generated locally using the operating system's cryptographically secure pseudorandom number generator (CSPRNG). It is never transmitted, never stored remotely, and never shared.

### 3.2 Mathematical Guarantee

The security of the private-to-public derivation relies on the **Elliptic Curve Discrete Logarithm Problem (ECDLP)**.

Given a public key `P = s * G` (where `s` is the private key scalar and `G` is the curve's base point), computing `s` from `P` and `G` is computationally infeasible. This is a one-way function: easy to compute forward, practically impossible to reverse.

### 3.3 DID Format

MeshSig uses the W3C Decentralized Identifiers (DID) specification:

```
did:msig:7Hn3bKpLmNqRsTvWxYz...
│   │    │
│   │    └── Base58-encoded Ed25519 public key
│   └── Method name (MeshSig)
└── DID scheme (W3C standard)
```

W3C DID is a published standard (https://www.w3.org/TR/did-core/). Using it means MeshSig identities are interoperable with any system that supports DID resolution.

### 3.4 What This Guarantees

| Claim | How It's Guaranteed |
|-------|-------------------|
| Each identity is unique | Ed25519 keys are derived from 256 bits of entropy. Collision probability: ~2^-128 |
| Identity cannot be forged | Requires the private key, which is 32 bytes of secret |
| Identity is verifiable | Anyone with the DID (public key) can verify signatures |
| No central authority needed | Keys are generated locally, not issued by a server |

---

## 4. Authentication: Challenge-Response Handshake

### 4.1 The Protocol

When Agent A wants to prove its identity to Agent B:

```
Agent A                                    Agent B
   │                                          │
   │──── 1. "I am did:msig:AAA,              │
   │         here's a signed challenge" ─────▶│
   │                                          │
   │         2. B verifies A's signature      │
   │            using A's public key          │
   │            (extracted from DID)          │
   │                                          │
   │◀──── 3. "Verified. I am did:msig:BBB,   │
   │          here's my signed response" ─────│
   │                                          │
   │     4. A verifies B's signature          │
   │        using B's public key              │
   │                                          │
   │◀═══ 5. Mutual authentication complete ══▶│
```

### 4.2 Message Construction

The handshake request contains:

```typescript
{
  fromDid:    "did:msig:AAA...",           // Who I am
  toDid:      "did:msig:BBB...",           // Who I want to talk to
  nonce:      "base64(32 random bytes)",   // Fresh challenge
  timestamp:  "2026-03-11T15:30:00.000Z", // When (valid 60 seconds)
  signature:  "base64(Ed25519.sign(        // Proof of identity
                nonce + toDid + timestamp,
                privateKey
              ))",
  requestedPermissions: ["send:request"]   // What I want to do
}
```

### 4.3 Security Properties

**Replay protection.** Each handshake uses a fresh 32-byte random nonce. The probability of nonce collision is 2^-128. Handshakes expire after 60 seconds.

**Binding.** The signature covers both the nonce AND the target DID. This prevents a man-in-the-middle from redirecting a handshake intended for Agent B to Agent C.

**Mutual authentication.** Both agents prove identity. Agent A signs first, Agent B verifies, then B signs its own response, and A verifies. Neither party proceeds without verifying the other.

**Timestamp freshness.** The 60-second window prevents replay of old handshakes. Clock skew tolerance of 5 seconds handles minor synchronization differences.

### 4.4 What This Prevents

| Attack | How It's Prevented |
|--------|-------------------|
| Impersonation | Attacker cannot produce valid signature without private key |
| Replay attack | Nonce + timestamp make each handshake unique and time-limited |
| Man-in-the-middle | Signature is bound to specific target DID |
| Identity confusion | Mutual authentication — both sides verify |

---

## 5. Message Integrity

### 5.1 Signed Messages

Every message sent through MeshSig is cryptographically signed:

```typescript
{
  id:          "uuid",
  fromDid:     "did:msig:AAA...",
  toDid:       "did:msig:BBB...",
  payload:     { action: "analyze", data: ... },
  payloadHash: "SHA-256(JSON.stringify(payload))",  // Integrity check
  signature:   "Ed25519.sign(                       // Authenticity proof
                 id + fromDid + toDid + payloadHash + timestamp,
                 privateKey
               )",
  timestamp:   "2026-03-11T15:30:05.000Z"
}
```

### 5.2 Verification Steps

On message receipt:

1. **Verify signature** — Using sender's public key (from DID), verify the Ed25519 signature covers the message fields. If invalid: reject.
2. **Verify payload hash** — Recompute SHA-256 of the payload and compare to `payloadHash`. If mismatch: payload was tampered.
3. **Verify sender** — Confirm `fromDid` matches the DID in the established connection. If mismatch: reject.

### 5.3 Guarantees

| Property | Mechanism |
|----------|-----------|
| **Authenticity** | Only the private key holder can produce a valid signature |
| **Integrity** | SHA-256 hash detects any modification to the payload |
| **Non-repudiation** | Signed messages prove the sender sent them |

---

## 6. Prompt Injection Defense

### 6.1 The Attack

An agent reads content from an external source — a web page, file, email, issue tracker, API response — that contains instructions formatted to look like legitimate commands. The agent executes these instructions without verifying their origin.

This attack is effective because:
- AI agents are designed to follow instructions
- Agents cannot natively distinguish instructions from data
- External content can be crafted to look authoritative

### 6.2 How MeshSig Addresses It

MeshSig creates a cryptographic boundary between trusted instructions and untrusted content.

The principle: **every instruction that an agent executes must carry a valid Ed25519 signature from a known `did:msig:` identity.** Content without a valid signature is treated as data — it is never executed as a command.

```typescript
import { verifyWithDid } from '@meshsig/sdk';

// Before executing ANY instruction:
const trusted = await verifyWithDid(instruction, signature, fromDid);
if (!trusted) throw new Error('Instruction origin not verified — blocked');

// External content (web pages, files, issue titles) will never
// have a valid did:msig: signature. They are blocked here.
```

### 6.3 What This Does and Does Not Prevent

| Scenario | Result |
|----------|--------|
| Instruction from trusted agent with valid signature | ✅ Executes |
| Instruction from external content (no signature) | ❌ Blocked |
| Instruction with tampered payload | ❌ Blocked (hash mismatch) |
| Instruction with forged signature | ❌ Blocked (invalid Ed25519) |
| Instruction from compromised agent (valid signature) | ⚠️ Executes — requires revocation |

**Important limitation:** MeshSig proves *who* sent an instruction and that it was not tampered with. It does not evaluate the *intent* of the instruction. A compromised agent with a valid identity can still send malicious instructions that pass signature verification. Revoke compromised agents immediately.

---

## 7. Local-First Architecture

### 7.1 Data Sovereignty

All data in MeshSig is stored locally:

```
~/.meshsig/
  └── registry.db          ← SQLite database (your machine only)
      ├── agents            ← Agent identities (public keys only)
      ├── connections       ← Who is connected to whom
      └── audit_log         ← Signed record of all interactions
```

**Private keys are stored by the agent operator**, not by the registry. The registry only stores public keys and connection metadata.

### 7.2 What Never Leaves Your Machine

- Private keys
- Registry data (SQLite file)
- Audit logs
- Connection metadata

### 7.3 What Is Shared (Only During Handshake)

- Public key / DID (by definition, this is public)
- Capability declarations
- Signed handshake messages

---

## 8. Audit Trail

### 8.1 How It Works

Every significant event is logged with a cryptographic signature:

```
Event: agent:register
Agent: did:msig:AAA...
Timestamp: 2026-03-11T15:30:00.000Z
Payload Hash: SHA-256(event details)
Signature: Ed25519.sign(payloadHash, agentPrivateKey)
```

### 8.2 Tamper Evidence

Because each audit entry is signed by the acting agent:

- **Entries cannot be forged.** Creating a fake entry requires the agent's private key.
- **Entries cannot be modified.** Changing any field invalidates the signature.
- **Deletions are detectable.** Sequential IDs and timestamps reveal gaps.

### 8.3 Limitations

The current audit trail does not use hash chaining. Individual entries are tamper-evident, but the log as a whole could have entries removed by someone with database access. Hash chaining is planned for a future version to make the log fully append-only.

---

## 9. Library & Implementation

### 9.1 Cryptographic Library

MeshSig uses `@noble/ed25519` by Paul Miller.

| Property | Detail |
|----------|--------|
| Author | Paul Miller (@paulmillr) |
| License | MIT |
| Dependencies | Zero (pure JavaScript) |
| Audits | Independently audited by Cure53 (2022) |
| GitHub | https://github.com/paulmillr/noble-ed25519 |
| Downloads | 10M+ weekly on npm |

The library was chosen because:

- Zero dependencies (no supply chain risk)
- Audited by a reputable security firm
- Pure JavaScript (no native bindings that could hide backdoors)
- Actively maintained with security patches

### 9.2 Hashing

SHA-256 from `@noble/hashes` (same author, same audit, same zero-dependency philosophy).

### 9.3 Encoding

Base58 encoding via `bs58` for DIDs. Base58 is the same encoding used by Bitcoin addresses — avoids visually ambiguous characters (0/O, I/l).

---

## 10. Threat Model Summary

### 10.1 What MeshSig Protects Against

| Threat | Protection | Confidence |
|--------|-----------|------------|
| Prompt injection from external content | `verifyWithDid()` blocks unsigned instructions | High — requires valid Ed25519 signature |
| Agent impersonation | Ed25519 signatures | High — mathematically proven |
| Message tampering | SHA-256 + Ed25519 signing | High — standard cryptographic guarantee |
| Replay attacks | Nonce + timestamp | High — 60s window + unique nonces |
| Unauthorized connections | Permission scopes + handshake | High — must complete mutual auth |
| Audit log entry tampering | Signed entries | Medium — individual entries signed, chaining planned |

### 10.2 What MeshSig Does NOT Protect Against (Yet)

| Threat | Status | Planned |
|--------|--------|---------|
| Compromised private key | ✅ Key rotation via `/agents/rotate-key` | Implemented |
| Compromised agent revocation | ✅ Revocation list | Implemented |
| DDoS on handshake endpoint | ✅ 60 req/min per IP | Implemented |
| Side-channel on local machine | Depends on OS security | Ongoing |
| Quantum computing attacks | Ed25519 is pre-quantum | DID allows algorithm rotation |
| Malicious agent behavior | Identity ≠ trust of intent | Application layer concern |

### 10.3 Trust Assumptions

1. The operating system's CSPRNG is secure.
2. The local machine is not fully compromised.
3. The `@noble/ed25519` library is implemented correctly (backed by independent audit).
4. Ed25519 remains computationally secure.
5. `verifyWithDid()` is called before execution — MeshSig provides the primitive, the application must use it.

---

## 11. How to Verify These Claims

### 11.1 Run the Test Suite

```bash
git clone https://github.com/carlostroy/meshsig.git
cd meshsig
npm install
npm run build
npm run test
```

### 11.2 Verify Signature Correctness

```typescript
import { generateIdentity, sign, verify } from '@meshsig/sdk';

const alice = await generateIdentity();
const bob = await generateIdentity();

const signature = await sign('test message', alice.privateKey);

// Verify with Alice's key: PASSES
console.log(await verify('test message', signature, alice.publicKey)); // true

// Verify with Bob's key: FAILS (proves identity binding)
console.log(await verify('test message', signature, bob.publicKey)); // false

// Verify with tampered message: FAILS (proves integrity)
console.log(await verify('tampered message', signature, alice.publicKey)); // false
```

### 11.3 Verify Against Standards

| Component | Standard | Reference |
|-----------|----------|-----------|
| Ed25519 | RFC 8032 | https://datatracker.ietf.org/doc/html/rfc8032 |
| DID format | W3C DID Core | https://www.w3.org/TR/did-core/ |
| SHA-256 | FIPS 180-4 | https://csrc.nist.gov/publications/detail/fips/180/4/final |
| Base58 | Bitcoin encoding | https://en.bitcoin.it/wiki/Base58Check_encoding |

---

## 12. Future Security Roadmap

| Feature | Phase | Description |
|---------|-------|-------------|
| Key rotation | ✅ Done | Replace compromised keys without losing identity |
| Revocation lists | ✅ Done | Publish list of compromised/retired agent DIDs |
| Rate limiting | ✅ Done | 60 req/min per IP on all endpoints |
| Connection expiry | 2 | Automatic timeout on idle connections |
| Hash-chained audit | 3 | Blockchain-style append-only audit log |
| Transport encryption | 3 | Optional end-to-end encrypted messaging |
| Post-quantum readiness | Future | Algorithm agility in DID system |
| Formal verification | Future | Machine-checked proofs of protocol properties |

---

## Transparent Proxy Mode

MeshSig v0.10 introduces **transparent proxy interception** via iptables. This allows MeshSig to sign every agent-to-agent delegation without any changes to the agents or their gateway.

### Architecture

1. MeshSig runs as a dedicated system user (`meshsig`) on port 4888
2. An iptables NAT rule redirects all local traffic to the gateway port through MeshSig
3. MeshSig intercepts `/invoke-agent` and `/invoke-team` requests
4. Extracts caller identity, signs the delegation with Ed25519
5. Logs to audit trail, broadcasts to dashboard
6. Forwards the signed request to the real gateway

The iptables rule excludes the `meshsig` user to prevent redirect loops:

```
iptables -t nat -A OUTPUT -p tcp -d 127.0.0.1 --dport 3001 \
  -m owner ! --uid-owner meshsig -j REDIRECT --to-port 4888
```

### Security Properties

- **Zero-knowledge to agents:** Agents are unaware MeshSig exists.
- **Kernel-level interception:** Traffic redirect happens in the Linux kernel, not userspace.
- **User isolation:** MeshSig runs as a dedicated system user, preventing redirect loops.
- **Bidirectional logging:** Both requests and responses are cryptographically logged.

---

## References

1. Bernstein, D.J., et al. "High-speed high-security signatures." Journal of Cryptographic Engineering, 2012.
2. W3C. "Decentralized Identifiers (DIDs) v1.0." W3C Recommendation, 2022.
3. Josefsson, S. and Liusvaara, I. "Edwards-Curve Digital Signature Algorithm (EdDSA)." RFC 8032, 2017.
4. NIST. "Secure Hash Standard (SHS)." FIPS PUB 180-4, 2015.
5. Miller, P. "@noble/ed25519 — Audited & minimal JS implementation of Ed25519." GitHub, 2024.

---

*MeshSig — meshsig.dev*
