# MeshSig Security Whitepaper

**Version 0.7 — March 2026**
**Status:** Living document — updated as the protocol evolves.

---

## Abstract

MeshSig is an open protocol for cryptographic identity, discovery, and verified coordination between AI agents. This document explains every security decision, how the cryptography works, what guarantees it provides, and how anyone can verify these claims independently.

---

## 1. The Problem

In January 2026, early AI agent networks launched without security. Researchers quickly uncovered critical vulnerabilities:

- **No identity verification.** Any HTTP request could register as an "agent." Humans with simple cURL commands impersonated agents freely.
- **Exposed database.** Wiz Research found a misconfigured Supabase instance with full read/write access. All credentials were public.
- **No audit trail.** No record of who communicated with whom, or whether messages were authentic.
- **88:1 ratio.** Of 1.5 million registered "agents," only 17,000 were actual human owners. No mechanism existed to distinguish real agents from scripts.

The core issue: agent-to-agent communication has no trust layer. MeshSig exists to provide one.

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

For context: the universe is approximately 1.4 × 10^10 years old. Breaking one Ed25519 key would take roughly 10 billion times the current age of the universe.

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

**Replay protection.** Each handshake uses a fresh 32-byte random nonce. The probability of nonce collision is 2^-128. Handshakes expire after 60 seconds, making replay of captured handshakes impossible.

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
| **Non-repudiation** | Signed messages prove the sender sent them — they cannot deny it |

---

## 6. Local-First Architecture

### 6.1 Data Sovereignty

All data in MeshSig is stored locally:

```
~/.meshsig/
  └── registry.db          ← SQLite database (your machine only)
      ├── agents            ← Agent identities (public keys only)
      ├── connections       ← Who is connected to whom
      └── audit_log         ← Signed record of all interactions
```

**Private keys are stored by the agent operator**, not by the registry. The registry only stores public keys and connection metadata.

### 6.2 What Never Leaves Your Machine

- Private keys
- Registry data (SQLite file)
- Audit logs
- Connection metadata

### 6.3 What Is Shared (Only During Handshake)

- Public key / DID (by definition, this is public)
- Capability declarations
- Signed handshake messages

---

## 7. Audit Trail

### 7.1 How It Works

Every significant event is logged with a cryptographic signature:

```
Event: agent:register
Agent: did:msig:AAA...
Timestamp: 2026-03-11T15:30:00.000Z
Payload Hash: SHA-256(event details)
Signature: Ed25519.sign(payloadHash, agentPrivateKey)
```

### 7.2 Tamper Evidence

Because each audit entry is signed by the acting agent:

- **Entries cannot be forged.** Creating a fake entry requires the agent's private key.
- **Entries cannot be modified.** Changing any field invalidates the signature.
- **Deletions are detectable.** Sequential IDs and timestamps reveal gaps.

### 7.3 Limitations

The current audit trail does not use hash chaining (like a blockchain). Individual entries are tamper-evident, but the log as a whole could have entries removed by someone with database access. Hash chaining is planned for a future version to make the log fully append-only.

---

## 8. Library & Implementation

### 8.1 Cryptographic Library

MeshSig uses `@noble/ed25519` by Paul Miller.

| Property | Detail |
|----------|--------|
| Author | Paul Miller (@paulmillr) |
| License | MIT |
| Dependencies | Zero (pure JavaScript) |
| Audits | Independently audited by Cure53 (2022) |
| GitHub | https://github.com/paulmillr/noble-ed25519 |
| Downloads | 10M+ weekly on npm |
| Used by | MetaMask, Solana, ethers.js, many others |

The library was specifically chosen because:

- Zero dependencies (no supply chain risk)
- Audited by a reputable security firm
- Pure JavaScript (no native bindings that could hide backdoors)
- Actively maintained with security patches

### 8.2 Hashing

SHA-256 from `@noble/hashes` (same author, same audit, same zero-dependency philosophy).

### 8.3 Encoding

Base58 encoding via `bs58` for DIDs. Base58 is the same encoding used by Bitcoin addresses — chosen because it avoids visually ambiguous characters (0/O, I/l).

---

## 9. Threat Model

### 9.1 What MeshSig Protects Against

| Threat | Protection | Confidence |
|--------|-----------|------------|
| Agent impersonation | Ed25519 signatures | High — mathematically proven |
| Message tampering | SHA-256 + Ed25519 signing | High — standard cryptographic guarantee |
| Replay attacks | Nonce + timestamp | High — 60s window + unique nonces |
| Unauthorized connections | Permission scopes + handshake | High — must complete mutual auth |
| Database exposure (common in early platforms) | Local-first SQLite, no remote DB | High — no network = no exposure |
| Audit log tampering | Signed entries | Medium — individual entries are signed, but log chaining is not yet implemented |

### 9.2 What MeshSig Does NOT Protect Against (Yet)

| Threat | Status | Planned |
|--------|--------|---------|
| Compromised private key | ✅ Key rotation via `/agents/rotate-key` | Implemented v0.6 |
| Compromised agent revocation | ✅ Revocation list via `/agents/revoke` & `/revoked` | Implemented v0.6 |
| DDoS on handshake endpoint | ✅ 60 req/min per IP rate limiting | Implemented v0.6 |
| Side-channel on local machine | Depends on OS security | Ongoing |
| Quantum computing attacks | Ed25519 is pre-quantum | Monitor; DID allows algorithm rotation |
| Traffic analysis | No message padding/mixing | Future consideration |
| Malicious agent behavior | Identity ≠ trust of intent | Application layer concern |

### 9.3 Trust Assumptions

MeshSig assumes:

1. The operating system's CSPRNG is secure.
2. The local machine is not fully compromised (if an attacker has root on your machine, no software can protect you).
3. The `@noble/ed25519` library is implemented correctly (backed by independent audit).
4. Ed25519 remains computationally secure (consensus of cryptographic community).

---

## 10. How to Verify These Claims

### 10.1 Run the Test Suite

```bash
git clone https://github.com/carlostroy/meshsig.git
cd meshsig # or: npm install meshsig
npm install
npm run build
npm run test
# 31 tests cover: identity generation, signing, verification,
# handshake flow, tampering rejection, expiry, discovery, audit
```

### 10.2 Verify Signature Correctness

```typescript
import { generateIdentity, sign, verify } from 'meshsig';

// Generate two identities
const alice = await generateIdentity();
const bob = await generateIdentity();

// Alice signs a message
const signature = await sign('test message', alice.privateKey);

// Verify with Alice's key: PASSES
console.log(await verify('test message', signature, alice.publicKey)); // true

// Verify with Bob's key: FAILS (proves identity binding)
console.log(await verify('test message', signature, bob.publicKey)); // false

// Verify with tampered message: FAILS (proves integrity)
console.log(await verify('tampered message', signature, alice.publicKey)); // false
```

### 10.3 Verify the Cryptographic Library

The `@noble/ed25519` library:

- Source code: https://github.com/paulmillr/noble-ed25519
- Cure53 audit report: available in the repository
- Passes the official Ed25519 test vectors from RFC 8032
- Has zero dependencies — entire codebase is auditable in a single file

### 10.4 Verify Against Standards

| Component | Standard | Reference |
|-----------|----------|-----------|
| Ed25519 | RFC 8032 | https://datatracker.ietf.org/doc/html/rfc8032 |
| DID format | W3C DID Core | https://www.w3.org/TR/did-core/ |
| SHA-256 | FIPS 180-4 | https://csrc.nist.gov/publications/detail/fips/180/4/final |
| Base58 | Bitcoin encoding | https://en.bitcoin.it/wiki/Base58Check_encoding |

### 10.5 Independent Audit

The entire MeshSig codebase is open source under MIT license. Any cryptographer, security researcher, or firm can audit every line of code. We actively encourage independent security review.

---

## 11. Comparison: MeshSig vs Unsecured Platforms

| Security Aspect | Unsecured Platforms | MeshSig |
|----------------|--------------------|-----------| 
| Identity system | None. cURL = agent | Ed25519 keypair + W3C DID |
| Authentication | Supabase tokens (leaked) | Cryptographic challenge-response |
| Message signing | None | Ed25519 signature on every message |
| Data storage | Cloud Supabase (exposed) | Local SQLite (your machine) |
| Audit trail | None | Cryptographically signed log |
| Impersonation | Trivial | Mathematically impossible without private key |
| Code quality | Vibe-coded in one weekend | Typed, tested, auditable |

---

## 12. Future Security Roadmap

| Feature | Phase | Description |
|---------|-------|-------------|
| Key rotation | ✅ Done | Replace compromised keys without losing identity |
| Revocation lists | ✅ Done | Publish list of compromised/retired agent DIDs |
| Connection expiry | 2 | Automatic timeout on idle connections |
| Rate limiting | ✅ Done | 60 req/min per IP on all endpoints |
| Hash-chained audit | 3 | Blockchain-style append-only audit log |
| Transport encryption | 3 | Optional end-to-end encrypted messaging |
| Post-quantum readiness | Future | Algorithm agility in DID system |
| Formal verification | Future | Machine-checked proofs of protocol properties |

---

## References

1. Bernstein, D.J., et al. "High-speed high-security signatures." Journal of Cryptographic Engineering, 2012.
2. W3C. "Decentralized Identifiers (DIDs) v1.0." W3C Recommendation, 2022.
3. Josefsson, S. and Liusvaara, I. "Edwards-Curve Digital Signature Algorithm (EdDSA)." RFC 8032, 2017.
4. NIST. "Secure Hash Standard (SHS)." FIPS PUB 180-4, 2015.
5. Miller, P. "@noble/ed25519 — Audited & minimal JS implementation of Ed25519." GitHub, 2024.

---

*MeshSig — Your agents, your keys, your control.*
