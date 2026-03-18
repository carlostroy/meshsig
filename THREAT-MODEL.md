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

- **Sandbox / Containment:** MeshSig does not restrict what an agent can do on the host system. It does not isolate agent processes, limit file access, or enforce execution boundaries. For containment, see NemoClaw or similar runtime isolation tools.
- **Network Guardrails:** MeshSig does not control or filter outbound network requests from agents. It does not prevent data exfiltration via HTTP, DNS, or other channels.
- **Privacy Routing:** MeshSig does not inspect or redact sensitive data in messages between agents. PII, credentials, or business-critical data in message payloads is not filtered.
- **Encryption in Transit:** MeshSig signs messages but does not encrypt them. Message content is visible to anyone who can intercept network traffic. Use TLS (HTTPS) to protect messages in transit.
- **Encryption at Rest:** Identity files (including private keys) are stored as JSON on disk. While file permissions are set to owner-only (0o600), there is no application-level encryption of stored keys.
- **Skill/Plugin Verification:** MeshSig does not scan, audit, or verify the safety of OpenClaw skills or plugins.
- **DDoS Protection:** The built-in rate limiter is basic. For production deployments exposed to the internet, use a reverse proxy (nginx, Cloudflare) for DDoS mitigation.

## Trust Assumptions

MeshSig operates under the following assumptions:

1. **The host machine is trusted.** If an attacker has root access to the machine running MeshSig, all bets are off. Private keys, the SQLite database, and the MeshSig process itself are all compromised.
2. **The LLM provider is trusted.** MeshSig signs delegations between agents but cannot prevent the underlying LLM from being manipulated via prompt injection. MeshSig proves *who* sent a message, not that the message content is safe.
3. **Key generation is secure.** MeshSig relies on `@noble/ed25519` for key generation, which uses the system's CSPRNG. If the system's random number generator is compromised, generated keys are weak.
4. **Time is approximately correct.** Handshake expiration and replay protection depend on system clocks being within a few minutes of each other. NTP should be running on all nodes.

## Known Attack Vectors

### 1. Prompt Injection via Signed Messages
**Risk:** An attacker compromises Agent A and uses it to send a signed, verified message to Agent B containing a prompt injection payload. Because the message is cryptographically signed, Agent B may treat it with higher trust.
**Mitigation:** MeshSig proves identity, not intent. Agents should validate message content independently of signature verification.

### 2. Key Theft from Identity Files
**Risk:** If an attacker gains read access to `/opt/meshsig/identities/`, they can steal private keys and impersonate any agent.
**Mitigation:** Identity files are created with mode 0o600 (owner-only). Future versions will support encrypted key storage and HSM integration.

### 3. Replay Attacks
**Risk:** An attacker captures a signed message and re-sends it.
**Mitigation:** Messages include timestamps in the signed payload. The server maintains a replay guard that rejects signatures seen within a 5-minute window. Handshakes expire after 60 seconds.

### 4. Man-in-the-Middle
**Risk:** Without TLS, an attacker on the network can read and modify messages between agents and the MeshSig server.
**Mitigation:** Deploy behind HTTPS. MeshSig signatures detect tampering even without TLS, but message confidentiality requires encryption in transit.

### 5. Rogue Agent Registration
**Risk:** If the API key is leaked or not set, anyone can register agents, create fake identities, and pollute the trust network.
**Mitigation:** Set `MESHSIG_API_KEY` and restrict write endpoints. Monitor the audit log for unexpected registrations.

## Security Contact

Report vulnerabilities via GitHub Issues (for non-sensitive issues) or email security@meshsig.ai (for sensitive disclosures).

We commit to acknowledging reports within 48 hours and providing a fix timeline within 7 days.
