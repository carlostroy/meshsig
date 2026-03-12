// ============================================================================
// MeshSig — Peer Networking
// Connect MeshSig instances across machines/VPS. The mesh grows.
// ============================================================================

import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Registry, AgentRecord } from './registry.js';

export interface PeerInfo {
  id: string;
  url: string;
  status: 'connecting' | 'connected' | 'disconnected';
  name: string | null;
  agents: string[];
  connectedAt: string;
}

export class PeerNetwork extends EventEmitter {
  private peers: Map<string, PeerInfo & { ws: WebSocket }> = new Map();
  private registry: Registry;
  private serverName: string;
  private reconnectTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(registry: Registry, serverName: string) {
    super();
    this.registry = registry;
    this.serverName = serverName;

    // When local agents change, announce to peers
    this.registry.on('mesh-event', (event: any) => {
      if (event.type === 'agent:register') {
        this.announceAll();
      }
    });
  }

  // -- Outgoing connections --------------------------------------------------

  connectTo(url: string): PeerInfo {
    const id = randomUUID().slice(0, 8);
    const wsUrl = url.replace(/^http/, 'ws') + (url.includes('?') ? '&' : '?') + `role=peer&from=${this.serverName}`;

    const ws = new WebSocket(wsUrl);
    const peer: PeerInfo & { ws: WebSocket } = {
      id, url, ws, status: 'connecting', name: null,
      agents: [], connectedAt: new Date().toISOString(),
    };

    ws.on('open', () => {
      peer.status = 'connected';
      this.emit('peer-event', { type: 'peer:connected', data: { url, agents: 0 } });
      this.sendAnnounce(ws);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handlePeerMessage(peer, msg);
      } catch {}
    });

    ws.on('close', () => {
      peer.status = 'disconnected';
      this.emit('peer-event', { type: 'peer:disconnected', data: { url } });

      // Auto-reconnect after 5s
      const timer = setTimeout(() => {
        if (this.peers.has(id)) {
          this.peers.delete(id);
          this.connectTo(url);
        }
      }, 5000);
      this.reconnectTimers.set(id, timer);
    });

    ws.on('error', () => {}); // Suppress errors, close handler deals with it

    this.peers.set(id, peer);
    return peer;
  }

  // -- Incoming connections --------------------------------------------------

  handleIncoming(ws: WebSocket, fromName: string): void {
    const id = randomUUID().slice(0, 8);
    const peer: PeerInfo & { ws: WebSocket } = {
      id, url: `incoming:${fromName}`, ws, status: 'connected',
      name: fromName, agents: [], connectedAt: new Date().toISOString(),
    };

    this.emit('peer-event', { type: 'peer:connected', data: { url: `incoming:${fromName}`, agents: 0 } });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handlePeerMessage(peer, msg);
      } catch {}
    });

    ws.on('close', () => {
      this.peers.delete(id);
      this.emit('peer-event', { type: 'peer:disconnected', data: { url: peer.url } });
    });

    this.peers.set(id, peer);
    this.sendAnnounce(ws);
  }

  // -- Protocol --------------------------------------------------------------

  private sendAnnounce(ws: WebSocket): void {
    const agents = this.registry.listAgents('active');
    ws.send(JSON.stringify({
      type: 'peer:announce',
      serverName: this.serverName,
      agents: agents.map(a => ({
        did: a.did, name: a.displayName,
        capabilities: a.capabilities, publicKey: a.publicKey,
      })),
    }));
  }

  private announceAll(): void {
    for (const [, peer] of this.peers) {
      if (peer.status === 'connected' && peer.ws.readyState === WebSocket.OPEN) {
        this.sendAnnounce(peer.ws);
      }
    }
  }

  private handlePeerMessage(peer: PeerInfo & { ws: WebSocket }, msg: any): void {
    switch (msg.type) {
      case 'peer:announce': {
        peer.name = msg.serverName;
        peer.agents = (msg.agents || []).map((a: any) => a.did);

        // Import remote agents into local registry
        for (const agent of msg.agents || []) {
          if (!this.registry.getAgent(agent.did)) {
            // We don't have this agent locally — we could register it as remote
            // For now, just track it in the peer info
          }
        }

        this.emit('peer-event', {
          type: 'peer:connected',
          data: { url: peer.url, agents: peer.agents.length, name: msg.serverName },
        });
        break;
      }

      case 'peer:discover': {
        const results = this.registry.discover(msg.query || {});
        peer.ws.send(JSON.stringify({
          type: 'peer:discover:result',
          requestId: msg.requestId,
          agents: results,
        }));
        break;
      }

      case 'peer:message': {
        // Relay signed message to local dashboard/handlers
        this.emit('peer-message', msg);
        break;
      }
    }
  }

  // -- Routing ---------------------------------------------------------------

  /**
   * Try to route a message to a remote agent on a connected peer.
   */
  routeToRemote(toDid: string, payload: any): boolean {
    for (const [, peer] of this.peers) {
      if (peer.status === 'connected' && peer.agents.includes(toDid)) {
        peer.ws.send(JSON.stringify({
          type: 'peer:message',
          toDid,
          payload,
        }));
        return true;
      }
    }
    return false;
  }

  /**
   * Query all peers for discovery.
   */
  async discoverRemote(query: any, timeoutMs = 3000): Promise<AgentRecord[]> {
    const requestId = randomUUID();
    const results: AgentRecord[] = [];

    const promises = [...this.peers.values()]
      .filter(p => p.status === 'connected' && p.ws.readyState === WebSocket.OPEN)
      .map(peer => new Promise<AgentRecord[]>((resolve) => {
        const timer = setTimeout(() => resolve([]), timeoutMs);

        const handler = (data: any) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'peer:discover:result' && msg.requestId === requestId) {
              clearTimeout(timer);
              peer.ws.off('message', handler);
              resolve(msg.agents || []);
            }
          } catch {}
        };

        peer.ws.on('message', handler);
        peer.ws.send(JSON.stringify({ type: 'peer:discover', requestId, query }));
      }));

    const settled = await Promise.allSettled(promises);
    for (const r of settled) {
      if (r.status === 'fulfilled') results.push(...r.value);
    }
    return results;
  }

  // -- Info ------------------------------------------------------------------

  listPeers(): PeerInfo[] {
    return [...this.peers.values()].map(({ ws, ...info }) => info);
  }

  getConnectedCount(): number {
    return [...this.peers.values()].filter(p => p.status === 'connected').length;
  }

  // -- Cleanup ---------------------------------------------------------------

  close(): void {
    for (const [, timer] of this.reconnectTimers) clearTimeout(timer);
    for (const [, peer] of this.peers) {
      try { peer.ws.close(); } catch {}
    }
  }
}
