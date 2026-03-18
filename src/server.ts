// ============================================================================
// MeshSig Server — HTTP + WebSocket + Live Dashboard
// ============================================================================

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { WebSocketServer, WebSocket } from 'ws';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Registry } from './registry.js';
import { PeerNetwork } from './peers.js';
import {
  sign, verify, verifyWithDid,
  verifyHandshakeRequest,
} from './crypto.js';
import type { MeshEvent } from './registry.js';

import {
  loadAuthConfig, isPublicRoute, checkAuth, checkWsAuth,
  setCorsHeaders, readBodyWithLimit, BodyTooLargeError,
  RateLimiter, ReplayGuard, validateAgentName, validateCapabilities,
  jsonError, type AuthConfig,
} from './auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ServerConfig {
  port: number;
  host: string;
  dbPath: string;
  name: string;
  peers: string[];
  gatewayUrl?: string; // upstream gateway to proxy (e.g. http://localhost:3001)
  tlsCert?: string;    // path to TLS certificate file
  tlsKey?: string;     // path to TLS private key file
}

export class MeshServer {
  public registry: Registry;
  public peerNetwork: PeerNetwork;
  private config: ServerConfig;
  private httpServer: ReturnType<typeof createServer>;
  private wss: WebSocketServer;
  private dashboards: Set<WebSocket> = new Set();
  private dashboardHtml: string;
  private authConfig: AuthConfig;
  private rateLimiter: RateLimiter;
  private replayGuard: ReplayGuard;

  constructor(config: Partial<ServerConfig> = {}) {
    this.config = {
      port: config.port || parseInt(process.env.MESH_PORT || '4888'),
      host: config.host || process.env.MESH_HOST || '127.0.0.1',
      dbPath: config.dbPath || ':memory:',
      name: config.name || 'meshsig',
      peers: config.peers || [],
      gatewayUrl: config.gatewayUrl || process.env.MESH_GATEWAY || undefined,
      tlsCert: config.tlsCert || process.env.MESH_TLS_CERT || undefined,
      tlsKey: config.tlsKey || process.env.MESH_TLS_KEY || undefined,
    };

    this.registry = new Registry(this.config.dbPath);
    this.peerNetwork = new PeerNetwork(this.registry, this.config.name);
    this.authConfig = loadAuthConfig();
    this.rateLimiter = new RateLimiter(this.authConfig.rateLimit, this.authConfig.rateWindow);
    this.replayGuard = new ReplayGuard(this.authConfig.replayWindow);

    // Use HTTPS if TLS cert and key are provided
    if (this.config.tlsCert && this.config.tlsKey && existsSync(this.config.tlsCert) && existsSync(this.config.tlsKey)) {
      this.httpServer = createHttpsServer({
        cert: readFileSync(this.config.tlsCert),
        key: readFileSync(this.config.tlsKey),
      }, this._handleHttp.bind(this));
    } else {
      this.httpServer = createServer(this._handleHttp.bind(this));
    }
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

    setCorsHeaders(res, req, this.authConfig);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    try {
      let body: any = null;
      if (method === 'POST') body = await this._readBody(req);

      // Rate limiting
      const clientIp = this.rateLimiter.getClientIp(req);
      const rateCheck = this.rateLimiter.check(clientIp);
      res.setHeader('X-RateLimit-Remaining', String(rateCheck.remaining));
      if (!rateCheck.allowed) {
        return jsonError(res, 429, 'Rate limit exceeded');
      }

      // Authentication
      if (!isPublicRoute(method!, path)) {
        const auth = checkAuth(req, this.authConfig);
        if (!auth.ok) {
          return jsonError(res, 401, auth.error || 'Unauthorized');
        }
      }

      // Dashboard
      if (method === 'GET' && (path === '/' || path === '/dashboard')) {
        res.writeHead(200, {
          'Content-Type': 'text/html',
          'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self' ws: wss:; img-src 'self' data:",
        });
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

      // Register agent — client should provide their own DID and public key (generated locally)
      if (method === 'POST' && path === '/agents/register') {
        const nameCheck = validateAgentName(body?.name);
        if (!nameCheck.valid) return this._json(res, 400, { error: nameCheck.error });
        const capsCheck = validateCapabilities(body?.capabilities);
        if (!capsCheck.valid) return this._json(res, 400, { error: capsCheck.error });
        const clientIdentity = (body?.did && body?.publicKey) ? { did: body.did, publicKey: body.publicKey } : undefined;
        const result = await this.registry.registerAgent(nameCheck.sanitized!, capsCheck.sanitized || [], undefined, clientIdentity);
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

      // Delete agent — requires x-admin-key header for authorization
      if (method === 'DELETE' && path.startsWith('/agents/')) {
        if (!req.headers['x-admin-key']) {
          return this._json(res, 403, { error: 'Agent deletion requires x-admin-key header for authorization' });
        }
        const identifier = decodeURIComponent(path.slice('/agents/'.length));
        const deleted = this.registry.deleteAgent(identifier);
        if (!deleted) return this._json(res, 404, { error: 'Agent not found' });
        this._broadcast({ type: 'agent:removed', timestamp: new Date().toISOString(), data: { identifier } });
        return this._json(res, 200, { message: 'Agent deleted', identifier });
      }

      // Key rotation — client proves ownership via signed challenge, provides new public key
      if (method === 'POST' && path === '/agents/rotate-key') {
        if (!body?.did || !body?.challenge || !body?.challengeSignature || !body?.newPublicKey) {
          return this._json(res, 400, { error: 'did, challenge, challengeSignature, and newPublicKey required. Sign the challenge locally with your current private key.' });
        }
        const result = await this.registry.rotateKey(body.did, body.challenge, body.challengeSignature, body.newPublicKey);
        if (!result) return this._json(res, 404, { error: 'Agent not found or invalid ownership proof' });
        return this._json(res, 200, {
          message: 'Key rotated successfully',
          did: body.did,
          newPublicKey: result.publicKey,
          rotatedAt: result.rotatedAt,
        });
      }

      // Revoke agent — requires ownership proof (signed challenge) or admin API key
      if (method === 'POST' && path === '/agents/revoke') {
        if (!body?.did) return this._json(res, 400, { error: 'did required' });
        // Require ownership proof: a signed challenge proving the caller owns this agent
        if (body.challenge && body.challengeSignature) {
          const agent = this.registry.getAgent(body.did);
          if (!agent) return this._json(res, 404, { error: 'Agent not found' });
          const valid = await verify(body.challenge, body.challengeSignature, agent.publicKey);
          if (!valid) return this._json(res, 403, { error: 'Invalid ownership proof — challenge signature does not match agent public key' });
        } else if (!req.headers['x-admin-key']) {
          return this._json(res, 403, { error: 'Revocation requires either ownership proof (challenge + challengeSignature) or x-admin-key header' });
        }
        const reason = body.reason || 'Revoked by operator';
        const revoked = this.registry.revokeAgent(body.did, reason);
        if (!revoked) return this._json(res, 404, { error: 'Agent not found' });
        this._broadcast({
          type: 'agent:revoked', timestamp: new Date().toISOString(),
          data: { did: body.did, reason },
        });
        return this._json(res, 200, { message: 'Agent revoked', did: body.did, reason });
      }

      // Revocation list — public list of compromised/revoked agents
      if (method === 'GET' && path === '/revoked') {
        return this._json(res, 200, { revoked: this.registry.getRevokedAgents() });
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

      // Sign — client must provide a pre-computed signature (signing happens client-side)
      if (method === 'POST' && path === '/messages/sign') {
        if (!body?.message || !body?.signature || !body?.did || !body?.timestamp) {
          return this._json(res, 400, { error: 'message, signature, did, and timestamp required. Sign locally using: meshsig sign <message>' });
        }
        // Check for replay attacks
        if (!this.replayGuard.check(body.signature)) {
          return this._json(res, 409, { error: 'Replay detected — this signature has already been submitted' });
        }
        // Verify the provided signature is valid
        const content = `${body.message}|${body.timestamp}`;
        const valid = await verifyWithDid(content, body.signature, body.did);
        if (!valid) return this._json(res, 400, { error: 'Invalid signature — message was not signed by the provided DID' });
        return this._json(res, 200, { protocol: 'meshsig-v1', did: body.did, message: body.message, signature: body.signature, timestamp: body.timestamp, verified: true });
      }

      // Verify
      if (method === 'POST' && path === '/messages/verify') {
        const content = body.timestamp ? `${body.message}|${body.timestamp}` : body.message;
        const valid = await verifyWithDid(content, body.signature, body.did);
        return this._json(res, 200, { valid, did: body.did });
      }

      // Send message — client signs locally, server verifies and logs
      if (method === 'POST' && path === '/messages/send') {
        if (!body?.fromDid || !body?.toDid || !body?.message || !body?.signature || !body?.timestamp) {
          return this._json(res, 400, { error: 'fromDid, toDid, message, signature, and timestamp required. Sign locally before sending.' });
        }
        // Check revocation before processing
        if (this.registry.isRevoked(body.fromDid)) {
          return this._json(res, 403, { error: 'Agent is revoked', did: body.fromDid });
        }
        if (this.registry.isRevoked(body.toDid)) {
          return this._json(res, 403, { error: 'Target agent is revoked', did: body.toDid });
        }
        // Check for replay attacks
        if (!this.replayGuard.check(body.signature)) {
          return this._json(res, 409, { error: 'Replay detected — this signature has already been submitted' });
        }
        const content = `${body.message}|${body.timestamp}`;
        const valid = await verifyWithDid(content, body.signature, body.fromDid);
        this.registry.logMessage(body.fromDid, body.toDid, body.message, body.signature, valid);
        return this._json(res, 200, { sent: true, verified: valid, signature: body.signature, timestamp: body.timestamp });
      }

      // Handshake — client provides pre-signed handshake request and response
      if (method === 'POST' && path === '/handshake') {
        if (!body?.handshakeRequest) {
          return this._json(res, 400, { error: 'handshakeRequest required (pre-signed by client). Never send private keys to the server.' });
        }
        const req2 = body.handshakeRequest;
        const agentA = this.registry.getAgent(req2.fromDid);
        const agentB = this.registry.getAgent(req2.toDid);
        if (!agentA || !agentB) return this._json(res, 404, { error: 'Agent not found' });

        // Verify the handshake request signature
        await verifyHandshakeRequest(req2, agentA.publicKey);

        this._broadcast({
          type: 'handshake:verify', timestamp: new Date().toISOString(),
          data: { fromDid: req2.fromDid, toDid: req2.toDid, fromName: agentA.displayName, toName: agentB.displayName },
        });

        const conn = this.registry.createConnection(req2.fromDid, req2.toDid);

        // If client provided a pre-signed response, verify and use it
        if (body.handshakeResponse) {
          return this._json(res, 200, { connection: conn, handshake: { request: req2, response: body.handshakeResponse } });
        }

        // Otherwise return connection with pending response (client B must sign separately)
        return this._json(res, 200, { connection: conn, handshake: { request: req2, responsePending: true } });
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

      // Audit export — full compliance report
      if (method === 'GET' && path === '/audit/export') {
        const format = url.searchParams.get('format') || 'json';
        const agents = this.registry.listAgents();
        const connections = this.registry.getConnections();
        const messages = this.registry.getMessages(1000);
        const rstats = this.registry.stats();
        const uptime = process.uptime();

        const report = {
          meshsig: {
            version: '0.5.0',
            exported: new Date().toISOString(),
            server: this.config.name,
          },
          summary: {
            totalAgents: agents.length,
            localAgents: agents.filter(a => a.origin === 'local').length,
            remoteAgents: agents.filter(a => a.origin === 'remote').length,
            totalConnections: connections.length,
            totalMessages: messages.length,
            verifiedMessages: messages.filter((m: any) => m.verified).length,
            failedVerifications: messages.filter((m: any) => !m.verified).length,
            averageTrust: agents.length > 0
              ? agents.reduce((sum, a) => sum + a.trustScore, 0) / agents.length
              : 0,
            uptime,
          },
          agents: agents.map(a => ({
            did: a.did,
            name: a.displayName,
            publicKey: a.publicKey,
            capabilities: a.capabilities,
            trustScore: a.trustScore,
            interactionsTotal: a.interactionsTotal,
            interactionsSuccess: a.interactionsSuccess,
            origin: a.origin,
            originServer: a.originServer,
            createdAt: a.createdAt,
          })),
          connections: connections.map((c: any) => ({
            agentA: c.agentADid,
            agentB: c.agentBDid,
            trustScore: c.trustScore,
            messagesExchanged: c.messagesExchanged,
            createdAt: c.createdAt,
          })),
          messages: messages.map((m: any) => ({
            id: m.id,
            from: m.fromDid,
            to: m.toDid,
            content: m.content,
            signature: m.signature,
            verified: !!m.verified,
            timestamp: m.createdAt,
          })),
        };

        return this._json(res, 200, report);
      }

      // Public verify endpoint — anyone can verify a signature
      if (method === 'POST' && path === '/verify') {
        const { message, signature, publicKey, did } = body;
        if (!message || !signature) return this._json(res, 400, { error: 'message and signature required' });
        if (!publicKey && !did) return this._json(res, 400, { error: 'publicKey or did required' });

        let valid: boolean;
        if (did) {
          valid = await verifyWithDid(message, signature, did);
        } else {
          valid = await verify(message, signature, publicKey);
        }

        return this._json(res, 200, {
          valid,
          message: message.slice(0, 100),
          signer: did || publicKey,
          verifiedAt: new Date().toISOString(),
        });
      }

      // Verify page — browser-based signature verifier
      if (method === 'GET' && path === '/verify') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(this._verifyPageHtml());
        return;
      }

      // ================================================================
      // PROXY — Intercept agent-to-agent communication
      // Signs every delegation with Ed25519 before forwarding to gateway
      // ================================================================

      if (this.config.gatewayUrl) {
        // Intercept invoke-agent: sign + log + forward
        if (method === 'POST' && (path === '/invoke-agent' || path === '/invoke-team')) {
          return this._proxyWithSignature(req, res, body, path);
        }

        // Forward all other unmatched routes to gateway (transparent proxy)
        return this._proxyPassthrough(req, res, body, path, method!);
      }

      // API docs
      this._json(res, 404, { error: 'Not found', endpoints: [
        'GET  /', 'GET  /health', 'GET  /stats', 'GET  /snapshot',
        'POST /agents/register', 'GET  /agents', 'GET  /agents/:did',
        'POST /discover', 'POST /discover/network',
        'POST /messages/send', 'POST /messages/verify',
        'POST /handshake', 'GET  /connections', 'GET  /messages',
        'GET  /peers', 'POST /peers/connect',
        'GET  /audit/export', 'GET  /verify', 'POST /verify',
        'POST /messages/sign', 'POST /messages/verify', 'POST /messages/send',
        'POST /handshake', 'GET  /connections', 'GET  /messages',
        'GET  /peers', 'POST /peers/connect',
        'WS   ws://host:port',
      ]});

    } catch (err: any) {
      if (err instanceof BodyTooLargeError) {
        return jsonError(res, 413, err.message);
      }
      const status = err.statusCode || 500;
      const message = status < 500 ? err.message : 'Internal server error';
      jsonError(res, status, message);
    }
  }

  // -- WebSocket -------------------------------------------------------------

  private _handleWs(ws: WebSocket, req: IncomingMessage) {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const role = url.searchParams.get('role');

    // Peer connections require authentication
    if (role === 'peer') {
      if (this.authConfig.apiKey && !checkWsAuth(req, this.authConfig)) {
        ws.close(4401, 'Unauthorized — peer connections require token');
        return;
      }
      const fromName = url.searchParams.get('from') || 'unknown';
      this.peerNetwork.handleIncoming(ws, fromName);
      return;
    }

    // Dashboard connection (public — same as GET / dashboard page)
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
    return readBodyWithLimit(req, this.authConfig.maxBodySize);
  }

  // Rate limiting handled by RateLimiter class from auth module

  // -- Proxy -----------------------------------------------------------------

  /**
   * Proxy /invoke-agent with cryptographic signing.
   * Signs the delegation, logs it, broadcasts to dashboard, then forwards.
   */
  private async _proxyWithSignature(req: IncomingMessage, res: ServerResponse, body: any, path: string) {
    const gatewayUrl = this.config.gatewayUrl!;
    const target = body?.target_client_name || body?.clientName || body?.agent || 'unknown';
    const message = body?.message || '';
    const callerHeader = req.headers['x-meshsig-caller'] as string || '';

    // Try to find caller agent from registered agents
    let callerDid: string | undefined;
    let callerName = callerHeader || 'unknown';
    let callerKey: string | undefined;

    // Auto-detect caller from request context
    const cwd = body?._cwd || '';
    if (cwd) {
      const match = cwd.match(/agent-[^/]+/);
      if (match) {
        const agents = this.registry.listAgents();
        const found = agents.find(a => cwd.includes(a.displayName.toLowerCase()) || match[0].toLowerCase().includes(a.displayName.toLowerCase()));
        if (found) {
          callerDid = found.did;
          callerName = found.displayName;
        }
      }
    }

    // Find target agent
    let targetDid: string | undefined;
    let targetName = target;
    const agents = this.registry.listAgents();
    for (const a of agents) {
      if (target.toLowerCase().includes(a.displayName.toLowerCase())) {
        targetDid = a.did;
        targetName = a.displayName;
        break;
      }
    }

    // If we don't have caller, try to find from agents list
    if (!callerDid) {
      // Use first manager as default caller
      const manager = agents.find(a => a.capabilities?.some((c: any) => c.type === 'management' || c.type === 'delegation'));
      if (manager) {
        callerDid = manager.did;
        callerName = manager.displayName;
      }
    }

    // Verify pre-signed delegation if signature provided in request headers
    let signature = '';
    let verified = false;
    const sigHeader = req.headers['x-meshsig-signature'] as string || '';
    const tsHeader = req.headers['x-meshsig-timestamp'] as string || '';

    if (sigHeader && tsHeader && callerDid) {
      try {
        verified = await verifyWithDid(`${message}|${tsHeader}`, sigHeader, callerDid);
        signature = sigHeader;

        // Log the verified message
        if (callerDid && targetDid) {
          this.registry.logMessage(callerDid, targetDid, message, signature, verified);
        }
      } catch (err: any) {
        console.error(`[proxy] verification failed: ${err.message}`);
      }
    }

    // Broadcast to dashboard (same format as message:sent)
    this._broadcast({
      type: 'message:sent',
      timestamp: new Date().toISOString(),
      data: {
        from: { did: callerDid || '', name: callerName, trustScore: 0 },
        to: { did: targetDid || '', name: targetName },
        preview: message.slice(0, 200),
        verified,
        signature: signature.slice(0, 40),
        proxy: true,
      },
    });

    // Forward to real gateway
    try {
      const gwRes = await fetch(`${gatewayUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...( req.headers['x-api-secret'] ? { 'x-api-secret': req.headers['x-api-secret'] as string } : {}),
        },
        body: JSON.stringify(body),
      });
      const gwData = await gwRes.json() as any;
      
      // Broadcast response from target agent
      try {
        const responseText = gwData?.response?.result?.payloads?.[0]?.text 
          || gwData?.result?.payloads?.[0]?.text
          || gwData?.response?.summary
          || '';
        if (responseText) {
          this._broadcast({
            type: 'message:sent',
            timestamp: new Date().toISOString(),
            data: {
              from: { did: targetDid || '', name: targetName, trustScore: 0 },
              to: { did: callerDid || '', name: callerName },
              preview: responseText.slice(0, 200),
              verified: true,
              signature: 'response',
              proxy: true,
              isResponse: true,
            },
          });
          // Log the response too
          if (targetDid && callerDid) {
            this.registry.logMessage(targetDid, callerDid, responseText, 'response', true);
          }
        }
      } catch {}

      // Add meshsig metadata to response
      gwData._meshsig = {
        signed: verified,
        from: callerName,
        to: targetName,
        signature: signature ? signature.slice(0, 20) + '...' : null,
      };

      return this._json(res, gwRes.status, gwData);
    } catch (err: any) {
      return this._json(res, 502, { error: 'Gateway unreachable' });
    }
  }

  /**
   * Transparent passthrough proxy — forwards unmatched routes to gateway.
   */
  private async _proxyPassthrough(req: IncomingMessage, res: ServerResponse, body: any, path: string, method: string) {
    const gatewayUrl = this.config.gatewayUrl!;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (req.headers['x-api-secret']) headers['x-api-secret'] = req.headers['x-api-secret'] as string;
      if (req.headers['authorization']) headers['authorization'] = req.headers['authorization'] as string;

      const fetchOpts: any = { method, headers };
      if (method === 'POST' && body) fetchOpts.body = JSON.stringify(body);

      const gwRes = await fetch(`${gatewayUrl}${path}`, fetchOpts);
      const contentType = gwRes.headers.get('content-type') || 'application/json';

      if (contentType.includes('json')) {
        const gwData = await gwRes.json();
        return this._json(res, gwRes.status, gwData);
      } else {
        const text = await gwRes.text();
        res.writeHead(gwRes.status, { 'Content-Type': contentType });
        res.end(text);
      }
    } catch (err: any) {
      return this._json(res, 502, { error: 'Gateway unreachable' });
    }
  }

  private _verifyPageHtml(): string {
    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MeshSig — Signature Verifier</title>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#050a12;color:#c8d6e5;font-family:'Outfit',sans-serif;min-height:100vh;
  display:flex;align-items:center;justify-content:center;padding:40px 20px}
body::after{content:'';position:fixed;top:0;left:0;right:0;bottom:0;
  background:repeating-linear-gradient(0deg,rgba(0,0,0,0.02) 0px,rgba(0,0,0,0.02) 1px,transparent 1px,transparent 2px);
  pointer-events:none;z-index:999}
.card{background:#0a1220;border:1px solid #0d2137;border-radius:16px;padding:48px;
  max-width:600px;width:100%;position:relative;z-index:1}
h1{font:700 24px 'JetBrains Mono',monospace;color:#00d4ff;margin-bottom:8px;letter-spacing:0.04em}
.sub{font:300 14px 'Outfit',sans-serif;color:#3a7ca5;margin-bottom:32px}
label{font:500 11px 'JetBrains Mono',monospace;color:#3a7ca5;letter-spacing:0.1em;
  display:block;margin-bottom:6px;margin-top:20px}
textarea,input{width:100%;background:#050a12;border:1px solid #1e3a5f;border-radius:8px;
  padding:12px 16px;color:#c8d6e5;font:400 13px 'JetBrains Mono',monospace;
  outline:none;transition:border-color 0.3s;resize:vertical}
textarea:focus,input:focus{border-color:#00d4ff}
textarea{min-height:80px}
button{width:100%;margin-top:28px;padding:14px;background:#00d4ff;color:#050a12;
  font:600 14px 'JetBrains Mono',monospace;border:none;border-radius:8px;cursor:pointer;
  transition:all 0.3s;letter-spacing:0.04em}
button:hover{box-shadow:0 0 30px rgba(0,212,255,0.3);transform:translateY(-1px)}
button:disabled{opacity:0.5;cursor:not-allowed;transform:none;box-shadow:none}
#result{margin-top:24px;padding:20px;border-radius:10px;display:none;text-align:center;
  font:600 16px 'JetBrains Mono',monospace}
#result.valid{display:block;background:rgba(0,255,136,0.06);border:1px solid rgba(0,255,136,0.2);color:#00ff88}
#result.invalid{display:block;background:rgba(255,51,85,0.06);border:1px solid rgba(255,51,85,0.2);color:#ff3355}
#result .detail{font:400 11px 'JetBrains Mono',monospace;color:#3a7ca5;margin-top:8px}
.back{display:inline-block;margin-bottom:24px;font:400 12px 'JetBrains Mono',monospace;
  color:#3a7ca5;text-decoration:none;transition:color 0.3s}
.back:hover{color:#00d4ff}
.or{text-align:center;color:#1e3a5f;font:11px 'JetBrains Mono',monospace;margin:4px 0}
</style>
</head><body>
<div class="card">
  <a href="/" class="back">&larr; Dashboard</a>
  <h1>VERIFY SIGNATURE</h1>
  <p class="sub">Paste a message, its Ed25519 signature, and the signer's public key or DID to verify authenticity.</p>

  <label>MESSAGE</label>
  <textarea id="msg" placeholder="The original message that was signed"></textarea>

  <label>SIGNATURE (Base64)</label>
  <input id="sig" placeholder="HkyrXOPOXF7v422A4iOcg/qkg/Juy...">

  <label>PUBLIC KEY (Base64)</label>
  <input id="pk" placeholder="KGC0lHB6Cwhhg1kyEjrPk0EjUujIO+Wq...">
  <div class="or">— or —</div>
  <label>DID</label>
  <input id="did" placeholder="did:msig:3icqQkmJWby4S5rpa...">

  <button onclick="doVerify()">VERIFY SIGNATURE</button>

  <div id="result">
    <div id="result-text"></div>
    <div class="detail" id="result-detail"></div>
  </div>
</div>
<script>
async function doVerify(){
  const msg=document.getElementById('msg').value.trim();
  const sig=document.getElementById('sig').value.trim();
  const pk=document.getElementById('pk').value.trim();
  const did=document.getElementById('did').value.trim();
  const r=document.getElementById('result');
  const rt=document.getElementById('result-text');
  const rd=document.getElementById('result-detail');

  if(!msg||!sig||(!pk&&!did)){r.className='invalid';r.style.display='block';rt.textContent='Fill all fields';return}

  const body={message:msg,signature:sig};
  if(did)body.did=did; else body.publicKey=pk;

  try{
    const res=await fetch('/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await res.json();
    if(data.valid){
      r.className='valid';rt.textContent='\\u2713 SIGNATURE VALID';
      rd.textContent='Verified at '+data.verifiedAt+' \\u2014 Signer: '+(data.signer||'').slice(0,40)+'...';
    } else {
      r.className='invalid';rt.textContent='\\u2717 SIGNATURE INVALID';
      rd.textContent='The signature does not match the message and key provided.';
    }
  }catch(e){r.className='invalid';rt.textContent='Error: '+e.message;rd.textContent=''}
}
</script>
</body></html>`;
  }
}
