// ============================================================================
// MeshSig — Auto-Discovery
// Find other MeshSig instances on the local network via UDP broadcast.
// No manual configuration needed on the same LAN.
// ============================================================================

import { createSocket, Socket } from 'node:dgram';
import { EventEmitter } from 'node:events';

const DISCOVERY_PORT = 4889;
const BROADCAST_INTERVAL = 5000;
const MAGIC = 'MESHSIG';

export interface DiscoveredPeer {
  address: string;
  port: number;
  name: string;
  agentCount: number;
  firstSeen: string;
  lastSeen: string;
}

export class AutoDiscovery extends EventEmitter {
  private socket: Socket | null = null;
  private broadcastTimer: ReturnType<typeof setInterval> | null = null;
  private peers: Map<string, DiscoveredPeer> = new Map();
  private serverName: string;
  private serverPort: number;
  private agentCount: number = 0;

  constructor(serverName: string, serverPort: number) {
    super();
    this.serverName = serverName;
    this.serverPort = serverPort;
  }

  start(): void {
    try {
      this.socket = createSocket({ type: 'udp4', reuseAddr: true });

      this.socket.on('message', (msg, rinfo) => {
        this._handleMessage(msg, rinfo);
      });

      this.socket.on('error', () => {
        // Discovery is best-effort, don't crash on errors
      });

      this.socket.bind(DISCOVERY_PORT, () => {
        this.socket!.setBroadcast(true);

        // Start periodic broadcast
        this.broadcastTimer = setInterval(() => this._broadcast(), BROADCAST_INTERVAL);
        this._broadcast(); // Send immediately
      });
    } catch {
      // Discovery is optional — if UDP doesn't work, that's fine
    }
  }

  stop(): void {
    if (this.broadcastTimer) clearInterval(this.broadcastTimer);
    if (this.socket) {
      try { this.socket.close(); } catch {}
    }
  }

  setAgentCount(count: number): void {
    this.agentCount = count;
  }

  getDiscoveredPeers(): DiscoveredPeer[] {
    // Filter out peers not seen in last 15 seconds
    const now = Date.now();
    const alive: DiscoveredPeer[] = [];
    for (const [key, peer] of this.peers) {
      if (now - new Date(peer.lastSeen).getTime() < 15_000) {
        alive.push(peer);
      } else {
        this.peers.delete(key);
      }
    }
    return alive;
  }

  private _broadcast(): void {
    if (!this.socket) return;
    const msg = Buffer.from(JSON.stringify({
      magic: MAGIC,
      name: this.serverName,
      port: this.serverPort,
      agents: this.agentCount,
      timestamp: new Date().toISOString(),
    }));

    try {
      this.socket.send(msg, 0, msg.length, DISCOVERY_PORT, '255.255.255.255');
    } catch {
      // Best effort
    }
  }

  private _handleMessage(msg: Buffer, rinfo: { address: string; port: number }): void {
    try {
      const data = JSON.parse(msg.toString());
      if (data.magic !== MAGIC) return;
      if (data.name === this.serverName) return; // Ignore self

      const key = `${rinfo.address}:${data.port}`;
      const now = new Date().toISOString();

      const existing = this.peers.get(key);
      if (existing) {
        existing.lastSeen = now;
        existing.agentCount = data.agents;
      } else {
        const peer: DiscoveredPeer = {
          address: rinfo.address,
          port: data.port,
          name: data.name,
          agentCount: data.agents,
          firstSeen: now,
          lastSeen: now,
        };
        this.peers.set(key, peer);

        this.emit('discovered', peer);
      }
    } catch {
      // Ignore malformed messages
    }
  }
}
