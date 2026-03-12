// ============================================================================
// MeshSig — Terminal Live Display
// Beautiful real-time visualization of the mesh in your terminal.
// ============================================================================

import type { MeshEvent } from './registry.js';

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';
const WHITE = '\x1b[37m';
const BG_BLACK = '\x1b[40m';

interface TermAgent {
  did: string;
  name: string;
  capabilities: string[];
  connections: Set<string>;
  messagesSent: number;
  messagesReceived: number;
  lastActive: Date;
}

export class TerminalDisplay {
  private agents: Map<string, TermAgent> = new Map();
  private connectionCount = 0;
  private messageCount = 0;
  private eventLog: string[] = [];
  private maxLogLines = 15;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private startTime = Date.now();

  start(): void {
    // Refresh display every 2 seconds
    this.refreshInterval = setInterval(() => this.render(), 2000);
  }

  stop(): void {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
  }

  handleEvent(event: MeshEvent): void {
    const d = event.data;

    switch (event.type) {
      case 'agent:register': {
        this.agents.set(d.did, {
          did: d.did,
          name: d.name,
          capabilities: (d.capabilities || []).map((c: any) => c.type),
          connections: new Set(),
          messagesSent: 0,
          messagesReceived: 0,
          lastActive: new Date(),
        });
        this.addLog(`${GREEN}●${RESET} ${BOLD}${d.name}${RESET} joined the mesh ${DIM}— ${(d.capabilities || []).map((c: any) => c.type).join(', ')}${RESET}`);
        this.render();
        break;
      }

      case 'connection:established': {
        this.connectionCount++;
        const a = this.agents.get(d.agentA.did);
        const b = this.agents.get(d.agentB.did);
        if (a) a.connections.add(d.agentB.did);
        if (b) b.connections.add(d.agentA.did);
        this.addLog(`${CYAN}◆${RESET} ${BOLD}${d.agentA.name}${RESET} ${DIM}↔${RESET} ${BOLD}${d.agentB.name}${RESET} ${DIM}— verified handshake${RESET}`);
        this.render();
        break;
      }

      case 'message:sent': {
        this.messageCount++;
        const from = this.agents.get(d.from.did);
        const to = this.agents.get(d.to.did);
        if (from) { from.messagesSent++; from.lastActive = new Date(); }
        if (to) { to.messagesReceived++; to.lastActive = new Date(); }
        const verified = d.verified ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
        this.addLog(`${YELLOW}▸${RESET} ${BOLD}${d.from.name}${RESET} → ${BOLD}${d.to.name}${RESET} ${verified} ${DIM}"${d.preview.slice(0, 55)}"${RESET}`);
        this.render();
        break;
      }

      case 'handshake:verify': {
        this.addLog(`${MAGENTA}⚡${RESET} ${DIM}Handshake:${RESET} ${d.fromName} ${DIM}↔${RESET} ${d.toName} ${GREEN}identity verified${RESET}`);
        this.render();
        break;
      }

      case 'discovery:query': {
        this.addLog(`${BLUE}🔍${RESET} ${DIM}Discovery:${RESET} "${d.capability}" ${DIM}→ found ${d.results} agent(s)${RESET}`);
        break;
      }

      case 'agent:heartbeat': break; // silent
    }
  }

  private addLog(line: string): void {
    this.eventLog.unshift(line);
    if (this.eventLog.length > this.maxLogLines) {
      this.eventLog.length = this.maxLogLines;
    }
  }

  render(): void {
    const agentList = [...this.agents.values()];
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const mins = Math.floor(uptime / 60);
    const secs = uptime % 60;

    // Build the network graph ASCII
    let graph = this.buildGraph(agentList);

    const output = [
      '',
      `  ${MAGENTA}${BOLD}MeshSig${RESET} ${DIM}— live network${RESET}`,
      `  ${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`,
      '',
      `  ${WHITE}${BOLD}${agentList.length}${RESET} ${DIM}agents${RESET}    ${CYAN}${BOLD}${this.connectionCount}${RESET} ${DIM}links${RESET}    ${YELLOW}${BOLD}${this.messageCount}${RESET} ${DIM}messages${RESET}    ${DIM}uptime ${mins}m${secs}s${RESET}`,
      '',
      graph,
      '',
      `  ${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`,
      `  ${DIM}LIVE EVENTS${RESET}`,
      '',
      ...this.eventLog.map(l => `  ${l}`),
      '',
      `  ${DIM}Dashboard: ${CYAN}http://localhost:4888${RESET}`,
    ];

    // Clear screen and draw
    process.stdout.write('\x1b[2J\x1b[H');
    console.log(output.join('\n'));
  }

  private buildGraph(agents: TermAgent[]): string {
    if (agents.length === 0) return `  ${DIM}(empty mesh — register agents to see the network)${RESET}`;

    const lines: string[] = [];

    // Draw agents as a network diagram
    const width = 64;
    const positions = this.calculatePositions(agents, width);

    // Draw connections first
    const connLines: string[] = [];
    for (const agent of agents) {
      for (const peerDid of agent.connections) {
        const peer = this.agents.get(peerDid);
        if (!peer) continue;
        const posA = positions.get(agent.did);
        const posB = positions.get(peer.did);
        if (posA && posB && posA.row < posB.row) {
          connLines.push(`  ${DIM}  ${agent.name.padEnd(8)} ──── ${peer.name}${RESET}`);
        }
      }
    }

    // Draw agent boxes
    for (const agent of agents) {
      const caps = agent.capabilities.slice(0, 2).join(', ');
      const connCount = agent.connections.size;
      const msgCount = agent.messagesSent + agent.messagesReceived;
      const isRecent = (Date.now() - agent.lastActive.getTime()) < 5000;
      const pulse = isRecent ? `${GREEN}●${RESET}` : `${DIM}○${RESET}`;
      const color = isRecent ? BOLD : DIM;

      lines.push(
        `  ${pulse} ${color}${agent.name.padEnd(10)}${RESET} ${DIM}${caps.padEnd(30)}${RESET} ${CYAN}${connCount}${RESET}${DIM} links${RESET}  ${YELLOW}${msgCount}${RESET}${DIM} msgs${RESET}`
      );
    }

    // Add connection summary
    if (connLines.length > 0) {
      lines.push('');
      lines.push(`  ${DIM}CONNECTIONS${RESET}`);
      for (const cl of connLines.slice(0, 8)) {
        lines.push(cl);
      }
      if (connLines.length > 8) {
        lines.push(`  ${DIM}  ... and ${connLines.length - 8} more${RESET}`);
      }
    }

    return lines.join('\n');
  }

  private calculatePositions(agents: TermAgent[], width: number): Map<string, { row: number; col: number }> {
    const positions = new Map<string, { row: number; col: number }>();
    agents.forEach((agent, i) => {
      positions.set(agent.did, { row: i, col: 0 });
    });
    return positions;
  }
}
