// ============================================================================
// MeshSig Server — HTTP + WebSocket + Live Dashboard
// ============================================================================

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Registry } from './registry.js';
import { PeerNetwork } from './peers.js';
import {
  sign, verifyWithDid, createHandshakeRequest,
  verifyHandshakeRequest, createHandshakeResponse,
} from './crypto.js';
import type { MeshEvent } from './registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ServerConfig {
  port: number;
  host: string;
  dbPath: string;
  name: string;
  peers: string[];
}

export class MeshServer {
  public registry: Registry;
  public peerNetwork: PeerNetwork;
  private config: ServerConfig;
  private httpServer: ReturnType<typeof createServer>;
  private wss: WebSocketServer;
  private dashboards: Set<WebSocket> = new Set();
  private dashboardHtml: string;

  constructor(config: Partial<ServerConfig> = {}) {
    this.config = {
      port: config.port || parseInt(process.env.MESH_PORT || '4888'),
      host: config.host || '0.0.0.0',
      dbPath: config.dbPath || ':memory:',
      name: config.name || 'meshsig',
      peers: config.peers || [],
    };

    this.registry = new Registry(this.config.dbPath);
    this.peerNetwork = new PeerNetwork(this.registry, this.config.name);
    this.httpServer = createServer(this._handleHttp.bind(this));
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on('connection', this._handleWs.bind(this));

    // Broadcast registry events to all dashboards
    this.registry.on('mesh-event', (event: MeshEvent) => {
      this._broadcast(event);
    });

    // Broadcast peer events to dashboards
    this.peerNetwork.on('peer-event', (event: any) => {
      this._broadcast({ type: event.type, timestamp: new Date().toISOString(), data: event.data });
    });

    // Load dashboard HTML
    try {
      this.dashboardHtml = readFileSync(resolve(__dirname, 'dashboard.html'), 'utf-8');
    } catch {
      this.dashboardHtml = '<html><body><h1>MeshSig</h1><p>Dashboard file not found.</p></body></html>';
    }
  }

  async start(): Promise<void> {
    await new Promise<void>(r => this.httpServer.listen(this.config.port, this.config.host, r));

    // Connect to configured peers
    for (const peerUrl of this.config.peers) {
      this.peerNetwork.connectTo(peerUrl);
    }
  }

  async stop(): Promise<void> {
    this.peerNetwork.close();
    this.wss.close();
    await new Promise<void>(r => this.httpServer.close(() => r()));
    this.registry.close();
  }

  // -- HTTP ------------------------------------------------------------------

  private async _handleHttp(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    try {
      let body: any = null;
      if (method === 'POST') body = await this._readBody(req);

      // Dashboard
      if (method === 'GET' && (path === '/' || path === '/dashboard')) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(this.dashboardHtml);
        return;
      }

      // Health
      if (method === 'GET' && path === '/health') {
        return this._json(res, 200, { status: 'ok', name: this.config.name });
      }

      // Stats
      if (method === 'GET' && path === '/stats') {
        return this._json(res, 200, { ...this.registry.stats(), uptime: process.uptime() });
      }

      // Snapshot (full state)
      if (method === 'GET' && path === '/snapshot') {
        return this._json(res, 200, this.registry.snapshot());
      }

      // Register agent
      if (method === 'POST' && path === '/agents/register') {
        const result = await this.registry.registerAgent(body.name, body.capabilities || []);
        return this._json(res, 201, result);
      }

      // List agents
      if (method === 'GET' && path === '/agents') {
        return this._json(res, 200, { agents: this.registry.listAgents(url.searchParams.get('status') || undefined) });
      }

      // Get agent
      if (method === 'GET' && path.startsWith('/agents/did:')) {
        const did = path.slice('/agents/'.length);
        const agent = this.registry.getAgent(did);
        if (!agent) return this._json(res, 404, { error: 'Not found' });
        return this._json(res, 200, { agent });
      }

      // Discover
      if (method === 'POST' && path === '/discover') {
        const agents = this.registry.discover(body);
        this._broadcast({
          type: 'discovery:query', timestamp: new Date().toISOString(),
          data: { capability: body.capability, results: agents.length },
        });
        return this._json(res, 200, { agents, total: agents.length });
      }

      // Sign
      if (method === 'POST' && path === '/messages/sign') {
        const ts = new Date().toISOString();
        const sig = await sign(`${body.message}|${ts}`, body.privateKey);
        return this._json(res, 200, { protocol: 'meshsig-v1', did: body.did, message: body.message, signature: sig, timestamp: ts });
      }

      // Verify
      if (method === 'POST' && path === '/messages/verify') {
        const content = body.timestamp ? `${body.message}|${body.timestamp}` : body.message;
        const valid = await verifyWithDid(content, body.signature, body.did);
        return this._json(res, 200, { valid, did: body.did });
      }

      // Send message (sign + log + broadcast)
      if (method === 'POST' && path === '/messages/send') {
        const ts = new Date().toISOString();
        const sig = await sign(`${body.message}|${ts}`, body.privateKey);
        const valid = await verifyWithDid(`${body.message}|${ts}`, sig, body.fromDid);
        this.registry.logMessage(body.fromDid, body.toDid, body.message, sig, valid);
        return this._json(res, 200, { sent: true, verified: valid, signature: sig, timestamp: ts });
      }

      // Handshake
      if (method === 'POST' && path === '/handshake') {
        const agentA = this.registry.getAgent(body.fromDid);
        const agentB = this.registry.getAgent(body.toDid);
        if (!agentA || !agentB) return this._json(res, 404, { error: 'Agent not found' });

        const req2 = await createHandshakeRequest(body.fromDid, body.toDid, body.privateKeyA, body.permissions || ['send:request']);
        await verifyHandshakeRequest(req2, agentA.publicKey);

        this._broadcast({
          type: 'handshake:verify', timestamp: new Date().toISOString(),
          data: { fromDid: body.fromDid, toDid: body.toDid, fromName: agentA.displayName, toName: agentB.displayName },
        });

        const conn = this.registry.createConnection(body.fromDid, body.toDid);
        const resp = await createHandshakeResponse(req2, body.toDid, body.privateKeyB, true, body.permissions || ['send:request'], conn.channelId);

        return this._json(res, 200, { connection: conn, handshake: { request: req2, response: resp } });
      }

      // Connections
      if (method === 'GET' && path === '/connections') {
        const did = url.searchParams.get('did') || undefined;
        return this._json(res, 200, { connections: this.registry.getConnections(did) });
      }

      // Messages
      if (method === 'GET' && path === '/messages') {
        const limit = parseInt(url.searchParams.get('limit') || '50');
        return this._json(res, 200, { messages: this.registry.getMessages(limit) });
      }

      // Peers
      if (method === 'GET' && path === '/peers') {
        return this._json(res, 200, { peers: this.peerNetwork.listPeers() });
      }

      if (method === 'POST' && path === '/peers/connect') {
        if (!body?.url) return this._json(res, 400, { error: 'url required' });
        const peer = this.peerNetwork.connectTo(body.url);
        return this._json(res, 200, { message: 'Connecting...', peerId: peer.id });
      }

      // Network discover (local + remote)
      if (method === 'POST' && path === '/discover/network') {
        const local = this.registry.discover(body);
        const remote = await this.peerNetwork.discoverRemote(body);
        return this._json(res, 200, { local, remote, total: local.length + remote.length });
      }

      // API docs
      this._json(res, 404, { error: 'Not found', endpoints: [
        'GET  /', 'GET  /health', 'GET  /stats', 'GET  /snapshot',
        'POST /agents/register', 'GET  /agents', 'GET  /agents/:did',
        'POST /discover', 'POST /discover/network',
        'POST /messages/sign', 'POST /messages/verify', 'POST /messages/send',
        'POST /handshake', 'GET  /connections', 'GET  /messages',
        'GET  /peers', 'POST /peers/connect',
        'WS   ws://host:port',
      ]});

    } catch (err: any) {
      this._json(res, err.statusCode || 500, { error: err.message });
    }
  }

  // -- WebSocket -------------------------------------------------------------

  private _handleWs(ws: WebSocket, req: IncomingMessage) {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const role = url.searchParams.get('role');

    // Peer connection
    if (role === 'peer') {
      const fromName = url.searchParams.get('from') || 'unknown';
      this.peerNetwork.handleIncoming(ws, fromName);
      return;
    }

    // Dashboard connection
    this.dashboards.add(ws);

    // Send current state immediately
    ws.send(JSON.stringify({
      type: 'snapshot',
      timestamp: new Date().toISOString(),
      data: this.registry.snapshot(),
    }));

    ws.on('close', () => this.dashboards.delete(ws));
  }

  private _broadcast(event: MeshEvent) {
    const json = JSON.stringify(event);
    for (const ws of this.dashboards) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(json); } catch {}
      }
    }
  }

  // -- Helpers ---------------------------------------------------------------

  private _json(res: ServerResponse, status: number, data: any) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  }

  private _readBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { reject(new Error('Invalid JSON')); } });
    });
  }
}
