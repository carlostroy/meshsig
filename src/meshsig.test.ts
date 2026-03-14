// ============================================================================
// MeshSig — Test Suite
// Covers: identity, signing, verification, handshake, registry, server, audit
// Run: npm test
// ============================================================================

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateIdentity, sign, verify, verifyWithDid, isValidDid,
  hashPayload, generateNonce, didToPublicKey,
  createHandshakeRequest, verifyHandshakeRequest, createHandshakeResponse,
} from './crypto.js';
import type { AgentIdentity } from './crypto.js';

// ============================================================================
// 1. IDENTITY
// ============================================================================

describe('Identity', () => {
  let identity: AgentIdentity;

  it('generates a valid identity', async () => {
    identity = await generateIdentity();
    assert.ok(identity.did.startsWith('did:msig:'));
    assert.ok(identity.publicKey.length > 0);
    assert.ok(identity.privateKey.length > 0);
    assert.ok(identity.createdAt);
  });

  it('generates unique identities each time', async () => {
    const id2 = await generateIdentity();
    assert.notEqual(identity.did, id2.did);
    assert.notEqual(identity.publicKey, id2.publicKey);
    assert.notEqual(identity.privateKey, id2.privateKey);
  });

  it('DID starts with did:msig:', async () => {
    assert.ok(identity.did.startsWith('did:msig:'));
  });

  it('validates correct DID format', () => {
    assert.ok(isValidDid(identity.did));
  });

  it('rejects invalid DID', () => {
    assert.ok(!isValidDid('did:wrong:abc'));
    assert.ok(!isValidDid('not-a-did'));
    assert.ok(!isValidDid(''));
  });

  it('extracts public key from DID', () => {
    const pk = didToPublicKey(identity.did);
    assert.equal(pk.length, 32); // Ed25519 public key is 32 bytes
  });

  it('throws on invalid DID extraction', () => {
    assert.throws(() => didToPublicKey('did:msig:invalid!!!'));
  });
});

// ============================================================================
// 2. SIGNING
// ============================================================================

describe('Signing', () => {
  let identity: AgentIdentity;

  before(async () => {
    identity = await generateIdentity();
  });

  it('signs a message', async () => {
    const sig = await sign('hello world', identity.privateKey);
    assert.ok(sig.length > 0);
    assert.ok(typeof sig === 'string');
  });

  it('produces different signatures for different messages', async () => {
    const sig1 = await sign('message one', identity.privateKey);
    const sig2 = await sign('message two', identity.privateKey);
    assert.notEqual(sig1, sig2);
  });

  it('produces deterministic signatures (same message = same sig)', async () => {
    const sig1 = await sign('deterministic', identity.privateKey);
    const sig2 = await sign('deterministic', identity.privateKey);
    assert.equal(sig1, sig2);
  });
});

// ============================================================================
// 3. VERIFICATION
// ============================================================================

describe('Verification', () => {
  let alice: AgentIdentity;
  let bob: AgentIdentity;

  before(async () => {
    alice = await generateIdentity();
    bob = await generateIdentity();
  });

  it('verifies a valid signature with public key', async () => {
    const sig = await sign('test message', alice.privateKey);
    const valid = await verify('test message', sig, alice.publicKey);
    assert.ok(valid);
  });

  it('verifies a valid signature with DID', async () => {
    const sig = await sign('test message', alice.privateKey);
    const valid = await verifyWithDid('test message', sig, alice.did);
    assert.ok(valid);
  });

  it('rejects signature with wrong message', async () => {
    const sig = await sign('original message', alice.privateKey);
    const valid = await verify('tampered message', sig, alice.publicKey);
    assert.ok(!valid);
  });

  it('rejects signature with wrong public key', async () => {
    const sig = await sign('test message', alice.privateKey);
    const valid = await verify('test message', sig, bob.publicKey);
    assert.ok(!valid);
  });

  it('rejects signature with wrong DID', async () => {
    const sig = await sign('test message', alice.privateKey);
    const valid = await verifyWithDid('test message', sig, bob.did);
    assert.ok(!valid);
  });

  it('rejects empty signature', async () => {
    const valid = await verify('test', '', alice.publicKey);
    assert.ok(!valid);
  });

  it('rejects garbage signature', async () => {
    const valid = await verify('test', 'not-a-real-signature', alice.publicKey);
    assert.ok(!valid);
  });
});

// ============================================================================
// 4. HASHING
// ============================================================================

describe('Hashing', () => {
  it('produces consistent hash for same input', () => {
    const h1 = hashPayload({ data: 'test' });
    const h2 = hashPayload({ data: 'test' });
    assert.equal(h1, h2);
  });

  it('produces different hash for different input', () => {
    const h1 = hashPayload({ data: 'test1' });
    const h2 = hashPayload({ data: 'test2' });
    assert.notEqual(h1, h2);
  });

  it('hash is hex string', () => {
    const h = hashPayload('test');
    assert.match(h, /^[0-9a-f]+$/);
  });

  it('nonce is unique each time', () => {
    const n1 = generateNonce();
    const n2 = generateNonce();
    assert.notEqual(n1, n2);
  });
});

// ============================================================================
// 5. HANDSHAKE
// ============================================================================

describe('Handshake', () => {
  let alice: AgentIdentity;
  let bob: AgentIdentity;

  before(async () => {
    alice = await generateIdentity();
    bob = await generateIdentity();
  });

  it('creates a valid handshake request', async () => {
    const req = await createHandshakeRequest(
      alice.did, bob.did, alice.privateKey, ['send:request']
    );
    assert.equal(req.fromDid, alice.did);
    assert.equal(req.toDid, bob.did);
    assert.ok(req.nonce.length > 0);
    assert.ok(req.signature.length > 0);
    assert.ok(req.timestamp);
    assert.deepEqual(req.requestedPermissions, ['send:request']);
  });

  it('verifies a valid handshake request', async () => {
    const req = await createHandshakeRequest(
      alice.did, bob.did, alice.privateKey, ['send:request']
    );
    const valid = await verifyHandshakeRequest(req, alice.publicKey);
    assert.ok(valid);
  });

  it('rejects handshake with wrong public key', async () => {
    const req = await createHandshakeRequest(
      alice.did, bob.did, alice.privateKey, ['send:request']
    );
    try {
      await verifyHandshakeRequest(req, bob.publicKey);
      assert.fail('Should have thrown');
    } catch (e: any) {
      assert.ok(e.message.includes('Invalid') || e.code === 'INVALID_SIGNATURE');
    }
  });

  it('creates a valid handshake response', async () => {
    const req = await createHandshakeRequest(
      alice.did, bob.did, alice.privateKey, ['send:request']
    );
    const resp = await createHandshakeResponse(
      req, bob.did, bob.privateKey, true, ['send:request'], 'channel-123'
    );
    assert.ok(resp.accepted);
    assert.equal(resp.channelId, 'channel-123');
    assert.ok(resp.signature.length > 0);
  });
});

// ============================================================================
// 6. SERVER (HTTP API)
// ============================================================================

describe('Server API', () => {
  let server: any;
  let port: number;
  let agentA: any;
  let agentB: any;

  before(async () => {
    const { MeshServer } = await import('./server.js');
    port = 4900 + Math.floor(Math.random() * 100);
    server = new MeshServer({ port, host: '127.0.0.1', dbPath: ':memory:', name: 'test', peers: [] });
    await server.start();
  });

  after(async () => {
    await server.stop();
  });

  it('GET /health returns ok', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    const data = await res.json() as any;
    assert.equal(data.status, 'ok');
  });

  it('GET /stats returns stats', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/stats`);
    const data = await res.json() as any;
    assert.ok('agents' in data);
    assert.ok('uptime' in data);
  });

  it('POST /agents/register creates agent', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/agents/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'TestAgent-A', capabilities: [{ type: 'testing', confidence: 0.99 }] }),
    });
    const data = await res.json() as any;
    agentA = data;
    assert.equal(res.status, 201);
    assert.ok(data.record.did.startsWith('did:msig:'));
    assert.equal(data.record.displayName, 'TestAgent-A');
    assert.ok(data.identity.privateKey);
  });

  it('POST /agents/register creates second agent', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/agents/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'TestAgent-B', capabilities: [{ type: 'analysis' }] }),
    });
    agentB = await res.json() as any;
    assert.equal(res.status, 201);
  });

  it('GET /agents lists agents', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/agents`);
    const data = await res.json() as any;
    assert.ok(data.agents.length >= 2);
  });

  it('GET /agents/:did returns specific agent', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/agents/${agentA.record.did}`);
    const data = await res.json() as any;
    assert.equal(data.agent.displayName, 'TestAgent-A');
  });

  it('POST /messages/send signs and verifies message', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/messages/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromDid: agentA.record.did, toDid: agentB.record.did,
        message: 'Hello from test', privateKey: agentA.identity.privateKey,
      }),
    });
    const data = await res.json() as any;
    assert.ok(data.sent);
    assert.ok(data.verified);
    assert.ok(data.signature);
  });

  it('POST /verify validates signature', async () => {
    const sig = await sign('verify-test', agentA.identity.privateKey);
    const res = await fetch(`http://127.0.0.1:${port}/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'verify-test', signature: sig, did: agentA.record.did }),
    });
    const data = await res.json() as any;
    assert.ok(data.valid);
  });

  it('POST /verify rejects bad signature', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'test', signature: 'fake', did: agentA.record.did }),
    });
    const data = await res.json() as any;
    assert.ok(!data.valid);
  });

  it('GET /audit/export returns report', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/audit/export`);
    const data = await res.json() as any;
    assert.ok(data.meshsig);
    assert.ok(data.summary);
    assert.ok(data.agents.length >= 2);
    assert.ok(data.messages.length >= 1);
  });

  it('GET /messages returns messages', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/messages`);
    const data = await res.json() as any;
    assert.ok(data.messages.length >= 1);
  });

  it('POST /agents/revoke blocks agent', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/agents/revoke`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did: agentA.record.did, reason: 'Test revocation' }),
    });
    const data = await res.json() as any;
    assert.equal(data.message, 'Agent revoked');
  });

  it('revoked agent cannot send messages', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/messages/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromDid: agentA.record.did, toDid: agentB.record.did,
        message: 'Should fail', privateKey: agentA.identity.privateKey,
      }),
    });
    assert.equal(res.status, 403);
    const data = await res.json() as any;
    assert.ok(data.error.includes('revoked'));
  });

  it('GET /revoked lists revoked agents', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/revoked`);
    const data = await res.json() as any;
    assert.ok(data.revoked.length >= 1);
    assert.equal(data.revoked[0].reason, 'Test revocation');
  });

  it('POST /agents/rotate-key rotates key', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/agents/rotate-key`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did: agentB.record.did, currentPrivateKey: agentB.identity.privateKey }),
    });
    const data = await res.json() as any;
    assert.equal(data.message, 'Key rotated successfully');
    assert.ok(data.newPublicKey);
    assert.notEqual(data.newPublicKey, agentB.identity.publicKey);
  });

  it('rate limiter returns 429 after limit', async () => {
    // Make many requests quickly
    const promises = [];
    for (let i = 0; i < 65; i++) {
      promises.push(fetch(`http://127.0.0.1:${port}/stats`));
    }
    const results = await Promise.all(promises);
    const statuses = results.map(r => r.status);
    assert.ok(statuses.includes(429), 'Should have at least one 429');
  });

  it('GET /verify returns HTML page', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/verify`);
    // May get 429 if rate limiter is active from previous test
    if (res.status === 200) {
      const text = await res.text();
      assert.ok(text.includes('VERIFY SIGNATURE') || text.includes('verify'));
    } else {
      assert.equal(res.status, 429); // rate limited is acceptable here
    }
  });

  it('GET / returns dashboard HTML', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.ok(res.headers.get('content-type')?.includes('text/html'));
  });
});
