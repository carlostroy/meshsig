// ============================================================================
// MeshSig Demo — Creates agents, connections, and live interactions.
// The "wow moment" — watch your network come alive.
// ============================================================================

import type { MeshServer } from './server.js';
import type { AgentIdentity } from './crypto.js';

interface DemoAgent {
  name: string;
  capabilities: { type: string; confidence: number }[];
  identity?: AgentIdentity;
}

const DEMO_AGENTS: DemoAgent[] = [
  { name: 'Arlo',   capabilities: [{ type: 'orchestration', confidence: 0.95 }, { type: 'strategy', confidence: 0.9 }] },
  { name: 'Vera',   capabilities: [{ type: 'data-analysis', confidence: 0.93 }, { type: 'market-research', confidence: 0.85 }] },
  { name: 'Rex',    capabilities: [{ type: 'code-review', confidence: 0.97 }, { type: 'qa', confidence: 0.88 }] },
  { name: 'Mia',    capabilities: [{ type: 'writing', confidence: 0.92 }, { type: 'market-research', confidence: 0.9 }] },
  { name: 'Cipher', capabilities: [{ type: 'data-analysis', confidence: 0.96 }] },
  { name: 'Forge',  capabilities: [{ type: 'code-review', confidence: 0.91 }, { type: 'strategy', confidence: 0.82 }] },
];

const DEMO_MESSAGES = [
  { from: 'Arlo', to: 'Vera', msg: 'Need Q1 market analysis for AI agents in LATAM' },
  { from: 'Vera', to: 'Arlo', msg: 'Starting analysis. Pulling data from 47 sources.' },
  { from: 'Arlo', to: 'Mia', msg: 'Draft executive summary once Vera delivers data' },
  { from: 'Mia', to: 'Arlo', msg: 'Ready. Waiting for data handoff from Vera.' },
  { from: 'Vera', to: 'Cipher', msg: 'Cross-check these funding numbers — some outliers detected' },
  { from: 'Cipher', to: 'Vera', msg: 'Confirmed. 3 data points were stale. Updated dataset attached.' },
  { from: 'Vera', to: 'Mia', msg: 'Analysis complete. 23 companies, 5 trends identified.' },
  { from: 'Mia', to: 'Rex', msg: 'Draft ready. Review for accuracy and formatting.' },
  { from: 'Rex', to: 'Mia', msg: 'Two factual corrections and formatting fixes applied.' },
  { from: 'Mia', to: 'Arlo', msg: 'Final report ready. 12 pages, reviewed and verified.' },
  { from: 'Arlo', to: 'Forge', msg: 'Package the report as API response for client dashboard' },
  { from: 'Forge', to: 'Arlo', msg: 'Done. Endpoint live, authentication configured.' },
  { from: 'Arlo', to: 'Vera', msg: 'New task: monitor competitor pricing changes daily' },
  { from: 'Rex', to: 'Forge', msg: 'Code review on dashboard endpoint — approved, clean.' },
  { from: 'Cipher', to: 'Arlo', msg: 'Anomaly detected in dataset #7. Flagging for review.' },
  { from: 'Arlo', to: 'Cipher', msg: 'Good catch. Route to Vera for deep analysis.' },
];

export async function runDemo(server: MeshServer): Promise<void> {
  const agents = new Map<string, DemoAgent>();
  const identities = new Map<string, AgentIdentity>();

  // Phase 1: Register agents one by one with delay
  console.log('  Starting demo...\n');

  for (let i = 0; i < DEMO_AGENTS.length; i++) {
    const agent = DEMO_AGENTS[i];
    await sleep(1500);

    const { identity } = await server.registry.registerAgent(agent.name, agent.capabilities);
    agent.identity = identity;
    agents.set(agent.name, agent);
    identities.set(agent.name, identity);

    const caps = agent.capabilities.map(c => c.type).join(', ');
    console.log(`  🟢 ${agent.name} joined — ${caps}`);
  }

  console.log(`\n  ${DEMO_AGENTS.length} agents in the mesh. Forming connections...\n`);
  await sleep(2000);

  // Phase 2: Create connections with handshakes
  const connectionPairs = [
    ['Arlo', 'Vera'], ['Arlo', 'Mia'], ['Arlo', 'Rex'], ['Arlo', 'Forge'],
    ['Vera', 'Cipher'], ['Vera', 'Mia'], ['Mia', 'Rex'], ['Rex', 'Forge'],
    ['Cipher', 'Arlo'],
  ];

  for (const [a, b] of connectionPairs) {
    await sleep(800);
    const idA = identities.get(a)!;
    const idB = identities.get(b)!;

    // Emit handshake event manually for the dashboard
    server.registry.emit('mesh-event', {
      type: 'handshake:verify',
      timestamp: new Date().toISOString(),
      data: { fromDid: idA.did, toDid: idB.did, fromName: a, toName: b },
    });

    await sleep(400);
    server.registry.createConnection(idA.did, idB.did);
    console.log(`  🔗 ${a} ↔ ${b} — verified handshake`);
  }

  console.log(`\n  ${connectionPairs.length} connections established. Messages flowing...\n`);
  await sleep(2000);

  // Phase 3: Simulate messages
  for (const msg of DEMO_MESSAGES) {
    await sleep(2000 + Math.random() * 2000);

    const fromId = identities.get(msg.from)!;
    const toId = identities.get(msg.to)!;

    const { sign } = await import('./crypto.js');
    const ts = new Date().toISOString();
    const sig = await sign(`${msg.msg}|${ts}`, fromId.privateKey);

    server.registry.logMessage(fromId.did, toId.did, msg.msg, sig, true);
    console.log(`  💬 ${msg.from} → ${msg.to}: "${msg.msg}"`);
  }

  console.log('\n  Demo messages complete. Network is alive.\n');
  console.log('  The mesh continues running. Open the dashboard to watch.');
  console.log('  Register new agents via the API. Connect more VPS instances.');
  console.log('  The graph grows.\n');

  // Phase 4: Keep alive with periodic heartbeats
  setInterval(async () => {
    for (const [name, id] of identities) {
      server.registry.touchAgent(id.did);
    }
  }, 30000);

  // Phase 5: Periodic random messages to keep it alive
  setInterval(async () => {
    const msg = DEMO_MESSAGES[Math.floor(Math.random() * DEMO_MESSAGES.length)];
    const fromId = identities.get(msg.from);
    const toId = identities.get(msg.to);
    if (!fromId || !toId) return;

    const { sign } = await import('./crypto.js');
    const ts = new Date().toISOString();
    const sig = await sign(`${msg.msg}|${ts}`, fromId.privateKey);
    server.registry.logMessage(fromId.did, toId.did, msg.msg, sig, true);
  }, 8000 + Math.random() * 7000);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
