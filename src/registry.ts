// ============================================================================
// MeshSig — Registry with Event Emission
// Every mutation emits an event for live visualization.
// ============================================================================

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { generateIdentity, hashPayload, sign, verify } from './crypto.js';
import type { AgentIdentity, Capability, PermissionScope } from './crypto.js';

export interface AgentRecord {
  id: string;
  did: string;
  publicKey: string;
  displayName: string;
  capabilities: Capability[];
  status: string;
  lastSeenAt: string | null;
  trustScore: number;
  interactionsTotal: number;
  interactionsSuccess: number;
  online: boolean;
  origin: string;
  originServer: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ConnectionRecord {
  id: string;
  agentADid: string;
  agentBDid: string;
  channelId: string;
  status: string;
  trustScore: number;
  messagesExchanged: number;
  createdAt: string;
}

export interface MeshEvent {
  type: string;
  timestamp: string;
  data: any;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY, did TEXT UNIQUE NOT NULL, public_key TEXT NOT NULL,
    display_name TEXT NOT NULL, capabilities TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active', last_seen_at TEXT,
    trust_score REAL NOT NULL DEFAULT 0.0,
    interactions_total INTEGER NOT NULL DEFAULT 0,
    interactions_success INTEGER NOT NULL DEFAULT 0,
    origin TEXT NOT NULL DEFAULT 'local',
    origin_server TEXT NOT NULL DEFAULT '',
    metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY, agent_a_did TEXT NOT NULL, agent_b_did TEXT NOT NULL,
    channel_id TEXT UNIQUE NOT NULL, status TEXT NOT NULL DEFAULT 'active',
    trust_score REAL NOT NULL DEFAULT 0.0,
    messages_exchanged INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, UNIQUE(agent_a_did, agent_b_did),
    FOREIGN KEY (agent_a_did) REFERENCES agents(did) ON DELETE CASCADE,
    FOREIGN KEY (agent_b_did) REFERENCES agents(did) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, from_did TEXT NOT NULL, to_did TEXT NOT NULL,
    content TEXT NOT NULL, signature TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS trust_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_did TEXT NOT NULL, to_did TEXT NOT NULL,
    event_type TEXT NOT NULL,
    score_delta REAL NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, agent_did TEXT NOT NULL,
    target_did TEXT, payload_hash TEXT NOT NULL, signature TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_agents_did ON agents(did);
  CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
  CREATE INDEX IF NOT EXISTS idx_connections_a ON connections(agent_a_did);
  CREATE INDEX IF NOT EXISTS idx_connections_b ON connections(agent_b_did);
  CREATE INDEX IF NOT EXISTS idx_messages_time ON messages(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_trust_from ON trust_events(from_did, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_trust_to ON trust_events(to_did, created_at DESC);
  CREATE TABLE IF NOT EXISTS revoked_agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT, did TEXT NOT NULL UNIQUE,
    reason TEXT NOT NULL, revoked_at TEXT NOT NULL,
    previous_public_key TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS key_rotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, did TEXT NOT NULL,
    old_public_key TEXT NOT NULL, new_public_key TEXT NOT NULL,
    rotated_at TEXT NOT NULL
  );
`;

export class Registry extends EventEmitter {
  private db: Database.Database;

  constructor(dbPath: string = ':memory:') {
    super();
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);

    // Migrate existing databases — add new columns if missing
    try { this.db.exec('ALTER TABLE agents ADD COLUMN origin TEXT NOT NULL DEFAULT \'local\''); } catch {}
    try { this.db.exec('ALTER TABLE agents ADD COLUMN origin_server TEXT NOT NULL DEFAULT \'\''); } catch {}
    try { this.db.exec('ALTER TABLE connections ADD COLUMN trust_score REAL NOT NULL DEFAULT 0.0'); } catch {}
    try { this.db.exec('ALTER TABLE connections ADD COLUMN messages_exchanged INTEGER NOT NULL DEFAULT 0'); } catch {}
    try { this.db.exec('ALTER TABLE agents ADD COLUMN trust_score REAL NOT NULL DEFAULT 0.0'); } catch {}
    try { this.db.exec('ALTER TABLE agents ADD COLUMN interactions_total INTEGER NOT NULL DEFAULT 0'); } catch {}
    try { this.db.exec('ALTER TABLE agents ADD COLUMN interactions_success INTEGER NOT NULL DEFAULT 0'); } catch {}
  }

  private emit_event(type: string, data: any): void {
    const event: MeshEvent = { type, timestamp: new Date().toISOString(), data };
    this.emit('mesh-event', event);
  }

  // -- Agents ----------------------------------------------------------------

  async registerAgent(name: string, capabilities: Capability[] = [], meta?: Record<string, unknown>): Promise<{
    identity: AgentIdentity; record: AgentRecord;
  }> {
    const identity = await generateIdentity();
    const now = new Date().toISOString();
    const id = randomUUID();

    this.db.prepare(`
      INSERT INTO agents (id, did, public_key, display_name, capabilities, status, last_seen_at, origin, origin_server, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, 'local', '', ?, ?, ?)
    `).run(id, identity.did, identity.publicKey, name, JSON.stringify(capabilities), now, JSON.stringify(meta || {}), now, now);

    const record = this._rowToAgent(this.db.prepare('SELECT * FROM agents WHERE did = ?').get(identity.did));

    this.emit_event('agent:register', {
      did: identity.did, name, capabilities,
      publicKey: identity.publicKey,
      origin: 'local',
    });

    return { identity, record };
  }

  /**
   * Import a remote agent from a peer server.
   * No keypair generated — just stores the public identity.
   */
  importRemoteAgent(agent: {
    did: string; name: string; publicKey: string;
    capabilities: Capability[]; originServer: string;
  }): AgentRecord | null {
    const existing = this.getAgent(agent.did);
    if (existing) {
      // Update last seen and origin
      const now = new Date().toISOString();
      this.db.prepare(`
        UPDATE agents SET last_seen_at = ?, origin = 'remote', origin_server = ?, updated_at = ?, status = 'active'
        WHERE did = ?
      `).run(now, agent.originServer, now, agent.did);
      return this.getAgent(agent.did);
    }

    const now = new Date().toISOString();
    const id = randomUUID();

    this.db.prepare(`
      INSERT INTO agents (id, did, public_key, display_name, capabilities, status, last_seen_at, origin, origin_server, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, 'remote', ?, '{}', ?, ?)
    `).run(id, agent.did, agent.publicKey, agent.name, JSON.stringify(agent.capabilities), now, agent.originServer, now, now);

    const record = this._rowToAgent(this.db.prepare('SELECT * FROM agents WHERE did = ?').get(agent.did));

    this.emit_event('agent:register', {
      did: agent.did, name: agent.name, capabilities: agent.capabilities,
      publicKey: agent.publicKey,
      origin: 'remote', originServer: agent.originServer,
    });

    return record;
  }

  getAgent(did: string): AgentRecord | null {
    const row = this.db.prepare('SELECT * FROM agents WHERE did = ?').get(did) as any;
    return row ? this._rowToAgent(row) : null;
  }

  listAgents(status?: string): AgentRecord[] {
    const q = status
      ? this.db.prepare('SELECT * FROM agents WHERE status = ? ORDER BY created_at')
      : this.db.prepare('SELECT * FROM agents ORDER BY created_at');
    return (status ? q.all(status) : q.all()).map((r: any) => this._rowToAgent(r));
  }

  touchAgent(did: string): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE agents SET last_seen_at = ?, updated_at = ? WHERE did = ?').run(now, now, did);
    this.emit_event('agent:heartbeat', { did, timestamp: now });
  }

  // -- Key Rotation ----------------------------------------------------------

  /**
   * Rotate an agent's keypair. The DID stays the same but the signing key changes.
   * Requires the current private key to prove ownership.
   */
  async rotateKey(did: string, currentPrivateKey: string): Promise<{ publicKey: string; privateKey: string; rotatedAt: string } | null> {
    const agent = this.getAgent(did);
    if (!agent) return null;

    // Verify caller owns the current key by signing a challenge
    const challenge = `rotate:${did}:${Date.now()}`;
    try {
      const sig = await sign(challenge, currentPrivateKey);
      const valid = await verify(challenge, sig, agent.publicKey);
      if (!valid) return null;
    } catch { return null; }

    // Generate new keypair
    const newIdentity = await generateIdentity();
    const now = new Date().toISOString();

    // Log the rotation
    this.db.prepare(`
      INSERT INTO key_rotations (did, old_public_key, new_public_key, rotated_at)
      VALUES (?, ?, ?, ?)
    `).run(did, agent.publicKey, newIdentity.publicKey, now);

    // Update agent's public key
    this.db.prepare(`
      UPDATE agents SET public_key = ?, updated_at = ? WHERE did = ?
    `).run(newIdentity.publicKey, now, did);

    this.emit_event('agent:key-rotated', {
      did, oldKeyPrefix: agent.publicKey.slice(0, 12) + '...',
      newKeyPrefix: newIdentity.publicKey.slice(0, 12) + '...', rotatedAt: now,
    });

    return { publicKey: newIdentity.publicKey, privateKey: newIdentity.privateKey, rotatedAt: now };
  }

  // -- Agent Revocation ------------------------------------------------------

  /**
   * Revoke an agent — mark as compromised. All future messages from this
   * agent will be rejected. Cannot be undone.
   */
  revokeAgent(did: string, reason: string): boolean {
    const agent = this.getAgent(did);
    if (!agent) return false;

    const now = new Date().toISOString();

    // Add to revocation list
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO revoked_agents (did, reason, revoked_at, previous_public_key)
        VALUES (?, ?, ?, ?)
      `).run(did, reason, now, agent.publicKey);
    } catch {}

    // Mark agent as revoked
    this.db.prepare(`
      UPDATE agents SET status = 'revoked', updated_at = ? WHERE did = ?
    `).run(now, did);

    this.emit_event('agent:revoked', { did, name: agent.displayName, reason, revokedAt: now });

    return true;
  }

  /**
   * Check if an agent is revoked.
   */
  isRevoked(did: string): boolean {
    const row = this.db.prepare('SELECT did FROM revoked_agents WHERE did = ?').get(did) as any;
    return !!row;
  }

  /**
   * Get the full revocation list.
   */
  getRevokedAgents(): any[] {
    return this.db.prepare('SELECT * FROM revoked_agents ORDER BY revoked_at DESC').all();
  }

  // -- Discovery -------------------------------------------------------------

  discover(query: { capability?: string; minConfidence?: number; limit?: number }): AgentRecord[] {
    let agents = this.listAgents('active');
    if (query.capability) {
      agents = agents.filter(a => a.capabilities.some(c =>
        c.type === query.capability && (c.confidence ?? 1) >= (query.minConfidence ?? 0)
      ));
    }
    return query.limit ? agents.slice(0, query.limit) : agents;
  }

  // -- Connections -----------------------------------------------------------

  createConnection(agentADid: string, agentBDid: string): ConnectionRecord {
    const id = randomUUID();
    const channelId = randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO connections (id, agent_a_did, agent_b_did, channel_id, status, trust_score, messages_exchanged, created_at)
      VALUES (?, ?, ?, ?, 'active', 0.0, 0, ?)
    `).run(id, agentADid, agentBDid, channelId, now);

    const conn: ConnectionRecord = { id, agentADid, agentBDid, channelId, status: 'active', trustScore: 0, messagesExchanged: 0, createdAt: now };

    const agentA = this.getAgent(agentADid);
    const agentB = this.getAgent(agentBDid);

    this.emit_event('connection:established', {
      channelId,
      agentA: { did: agentADid, name: agentA?.displayName },
      agentB: { did: agentBDid, name: agentB?.displayName },
    });

    return conn;
  }

  getConnections(did?: string): ConnectionRecord[] {
    const q = did
      ? this.db.prepare('SELECT * FROM connections WHERE (agent_a_did = ? OR agent_b_did = ?) AND status = ?')
      : this.db.prepare('SELECT * FROM connections WHERE status = ?');
    const rows = did ? q.all(did, did, 'active') : q.all('active');
    return (rows as any[]).map(r => ({
      id: r.id, agentADid: r.agent_a_did, agentBDid: r.agent_b_did,
      channelId: r.channel_id, status: r.status, trustScore: r.trust_score || 0,
      messagesExchanged: r.messages_exchanged || 0, createdAt: r.created_at,
    }));
  }

  // -- Messages --------------------------------------------------------------

  logMessage(fromDid: string, toDid: string, content: string, signature: string, verified: boolean): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO messages (from_did, to_did, content, signature, verified, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(fromDid, toDid, content, signature, verified ? 1 : 0, now);

    // Update connection message count and trust
    this.db.prepare(`
      UPDATE connections SET messages_exchanged = messages_exchanged + 1,
      trust_score = MIN(1.0, trust_score + CASE WHEN ? THEN 0.02 ELSE -0.05 END)
      WHERE ((agent_a_did = ? AND agent_b_did = ?) OR (agent_a_did = ? AND agent_b_did = ?))
      AND status = 'active'
    `).run(verified ? 1 : 0, fromDid, toDid, toDid, fromDid);

    // Update sender agent trust
    this.db.prepare(`
      UPDATE agents SET interactions_total = interactions_total + 1,
      interactions_success = interactions_success + CASE WHEN ? THEN 1 ELSE 0 END,
      trust_score = CAST(interactions_success + CASE WHEN ? THEN 1 ELSE 0 END AS REAL) / (interactions_total + 1)
      WHERE did = ?
    `).run(verified ? 1 : 0, verified ? 1 : 0, fromDid);

    // Log trust event
    if (verified) {
      this.db.prepare(`
        INSERT INTO trust_events (from_did, to_did, event_type, score_delta, reason, created_at)
        VALUES (?, ?, 'message:verified', 0.02, 'Verified signed message', ?)
      `).run(fromDid, toDid, now);
    }

    const fromAgent = this.getAgent(fromDid);
    const toAgent = this.getAgent(toDid);

    this.emit_event('message:sent', {
      from: { did: fromDid, name: fromAgent?.displayName, trustScore: fromAgent?.trustScore },
      to: { did: toDid, name: toAgent?.displayName, trustScore: toAgent?.trustScore },
      preview: content.slice(0, 80),
      verified,
      signature: signature.slice(0, 20) + '...',
    });
  }

  getMessages(limit = 50): any[] {
    return this.db.prepare('SELECT * FROM messages ORDER BY created_at DESC LIMIT ?').all(limit) as any[];
  }

  // -- Trust Scoring ---------------------------------------------------------

  /**
   * Record a trust event between agents (positive or negative).
   */
  recordTrustEvent(fromDid: string, toDid: string, type: string, delta: number, reason: string): void {
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO trust_events (from_did, to_did, event_type, score_delta, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(fromDid, toDid, type, delta, reason, now);

    // Update connection trust
    this.db.prepare(`
      UPDATE connections SET trust_score = MAX(0, MIN(1.0, trust_score + ?))
      WHERE ((agent_a_did = ? AND agent_b_did = ?) OR (agent_a_did = ? AND agent_b_did = ?))
      AND status = 'active'
    `).run(delta, fromDid, toDid, toDid, fromDid);

    this.emit_event('trust:update', {
      from: fromDid, to: toDid, type, delta, reason,
      fromName: this.getAgent(fromDid)?.displayName,
      toName: this.getAgent(toDid)?.displayName,
    });
  }

  /**
   * Get trust history for an agent.
   */
  getTrustHistory(did: string, limit = 20): any[] {
    return this.db.prepare(`
      SELECT * FROM trust_events WHERE from_did = ? OR to_did = ? ORDER BY created_at DESC LIMIT ?
    `).all(did, did, limit) as any[];
  }

  // -- Heartbeat (online detection) ------------------------------------------

  /**
   * Check if agent is online (seen in last 30 seconds).
   */
  isOnline(did: string): boolean {
    const agent = this.getAgent(did);
    if (!agent || !agent.lastSeenAt) return false;
    return (Date.now() - new Date(agent.lastSeenAt).getTime()) < 30_000;
  }

  // -- Stats -----------------------------------------------------------------

  stats(): Record<string, number> {
    const agents = (this.db.prepare("SELECT COUNT(*) as n FROM agents").get() as any).n;
    const active = (this.db.prepare("SELECT COUNT(*) as n FROM agents WHERE status='active'").get() as any).n;
    const connections = (this.db.prepare("SELECT COUNT(*) as n FROM connections WHERE status='active'").get() as any).n;
    const messages = (this.db.prepare("SELECT COUNT(*) as n FROM messages").get() as any).n;
    return { agents, active, connections, messages };
  }

  // -- Snapshot (full state for dashboard) -----------------------------------

  snapshot(): { agents: AgentRecord[]; connections: ConnectionRecord[] } {
    return {
      agents: this.listAgents('active'),
      connections: this.getConnections(),
    };
  }

  close(): void { this.db.close(); }

  private _rowToAgent(row: any): AgentRecord {
    const lastSeen = row.last_seen_at;
    const online = lastSeen ? (Date.now() - new Date(lastSeen).getTime()) < 30_000 : false;
    return {
      id: row.id, did: row.did, publicKey: row.public_key,
      displayName: row.display_name, capabilities: JSON.parse(row.capabilities),
      status: row.status, lastSeenAt: lastSeen,
      trustScore: row.trust_score || 0,
      interactionsTotal: row.interactions_total || 0,
      interactionsSuccess: row.interactions_success || 0,
      online,
      origin: row.origin || 'local',
      originServer: row.origin_server || '',
      metadata: JSON.parse(row.metadata), createdAt: row.created_at,
    };
  }
}
