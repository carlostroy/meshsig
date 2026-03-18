# MeshSig — Threat Model

**Version:** 0.6.0
**Last Updated:** March 2026

## What MeshSig Protects

MeshSig provides **cryptographic identity and message verification** for AI agent communication. Specifically:

- **Agent Identity:** Each agent has a unique Ed25519 keypair and a DID (`did:msig:`) derived from the public key. This proves an agent is who it claims to be.
- **Message Integrity:** Every agent-to-agent delegation is signed with Ed25519. The recipient (or any third party) can verify the signature to confirm the message was not tampered with and was sent by the claimed sender.
- **Delegation Auditability:** All signed messages are logged with timestamps, creating an auditable trail of who delegated what to whom.
- **Revocation:** Compromised agents can be revoked, preventing further signed communications.

## What MeshSig Does NOT Protect

MeshSig is an **identity and trust layer**, not a complete security solution. It does NOT provide:

- **Sandbox / Containment:** MeshSig does not restrict what an agent can do on the host system. For containment, see NemoClaw or similar runtime isolation tools.
- **Network Guardrails:** MeshSig does not control or filter outbound network requests from agents.
- **Privacy Routing:** MeshSig does not inspect or redact sensitive data in messages between agents.
- **Encryption in Transit:** MeshSig signs messages but does not encrypt them. Use TLS (HTTPS) to protect messages in transit.
- **Encryption at Rest:** Identity files are stored as JSON on disk with owner-only permissions (0o600), but no application-level encryption.
- **Skill/Plugin Verification:** MeshSig does not scan or audit OpenClaw skills or plugins.
- **DDoS Protection:** Use a reverse proxy (nginx, Cloudflare) for production deployments.

## Trust Assumptions

1. **The host machine is trusted.** If an attacker has root access, all bets are off.
2. **The LLM provider is trusted.** MeshSig proves *who* sent a message, not that the content is safe.
3. **Key generation is secure.** MeshSig relies on `@noble/ed25519` using the system CSPRNG.
4. **Time is approximately correct.** Handshake expiration and replay protection depend on system clocks.

## Known Attack Vectors

### 1. Prompt Injection via Signed Messages
**Risk:** A compromised agent sends a signed message containing prompt injection. The signature may cause the recipient to trust it more.
**Mitigation:** Agents should validate message content independently of signature verification.

### 2. Key Theft from Identity Files
**Risk:** Read access to `/opt/meshsig/identities/` enables impersonation.
**Mitigation:** Files created with mode 0o600. Future: encrypted key storage and HSM integration.

### 3. Replay Attacks
**Risk:** Captured signed messages re-sent.
**Mitigation:** Timestamp in signed payload + replay guard rejecting seen signatures within 5-minute window. Handshakes expire after 60 seconds.

### 4. Man-in-the-Middle
**Risk:** Without TLS, messages can be read and modified.
**Mitigation:** Deploy behind HTTPS. Signatures detect tampering but not eavesdropping.

### 5. Rogue Agent Registration
**Risk:** Without API key, anyone can register fake agents.
**Mitigation:** Set `MESHSIG_API_KEY`. Monitor audit log for unexpected registrations.

## Security Contact

Report vulnerabilities via GitHub Issues or email security@meshsig.ai.
We commit to acknowledging reports within 48 hours.
