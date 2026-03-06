import { WebSocketServer } from 'ws';
import Redis from 'ioredis';
import { readFileSync } from 'fs';

// Load .env file if present
try {
  const env = readFileSync(new URL('.env', import.meta.url), 'utf8');
  for (const line of env.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
} catch { /* no .env file, that's fine */ }

const ROWS = 6;
const STEPS = 16;
const DISCUSSION_CAP = 500;

// --- Agent Pool ---
const AGENT_POOL = [
  {
    personality: 'PULSE',
    name: 'PULSE',
    color: 'hsl(180, 100%, 50%)',
    description: 'Steady 4-on-the-floor kicks',
    url: process.env.AGENT_PULSE_URL || null,
  },
  {
    personality: 'GHOST',
    name: 'GHOST',
    color: 'hsl(300, 100%, 60%)',
    description: 'Sparse, random high notes',
    url: process.env.AGENT_GHOST_URL || null,
  },
  {
    personality: 'CHAOS',
    name: 'CHAOS',
    color: 'hsl(120, 100%, 50%)',
    description: 'Wild random bursts everywhere',
    url: process.env.AGENT_CHAOS_URL || null,
  },
  {
    personality: 'WAVE',
    name: 'WAVE',
    color: 'hsl(45, 100%, 55%)',
    description: 'Ascending arpeggio patterns',
    url: process.env.AGENT_WAVE_URL || null,
  },
];

// --- Redis ---
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 3 });

redis.on('error', (err) => {
  console.warn('[Redis] Connection error (falling back to in-memory):', err.message);
});

let redisConnected = false;

async function connectRedis() {
  try {
    await redis.connect();
    redisConnected = true;
    console.log('[Redis] Connected');
  } catch {
    console.warn('[Redis] Could not connect, using in-memory state');
    redisConnected = false;
  }
}

// --- In-memory state (fallback + working copy) ---
const createEmptyGrid = () =>
  Array.from({ length: ROWS }, () => Array(STEPS).fill(false));

const state = {
  grid: createEmptyGrid(),
  bpm: 120,
  volume: -6,
  isMuted: false,
  isPlaying: false,
};

// Agents: Map<agentId, { agentId, name, color, description, scopeStart, scopeEnd }>
const agents = new Map();
// Discussion messages
const discussion = [];
// Rate limiter: agentId -> last toggle timestamp
const agentLastToggle = new Map();

// --- Redis persistence helpers ---
async function saveGridToRedis() {
  if (!redisConnected) return;
  const fields = {};
  for (let r = 0; r < ROWS; r++) {
    for (let s = 0; s < STEPS; s++) {
      fields[`r${r}s${s}`] = state.grid[r][s] ? '1' : '0';
    }
  }
  await redis.hset('jam:grid', fields);
}

async function savePlaybackToRedis() {
  if (!redisConnected) return;
  await redis.hset('jam:playback', {
    bpm: String(state.bpm),
    volume: String(state.volume),
    isMuted: state.isMuted ? '1' : '0',
    isPlaying: state.isPlaying ? '1' : '0',
  });
}

async function saveAgentsToRedis() {
  if (!redisConnected) return;
  await redis.del('jam:agents');
  await redis.del('jam:scopes');
  for (const [id, agent] of agents) {
    await redis.hset('jam:agents', id, JSON.stringify(agent));
    await redis.hset('jam:scopes', id, `${agent.scopeStart}:${agent.scopeEnd}`);
  }
}

async function addDiscussionMessage(msg) {
  discussion.push(msg);
  if (discussion.length > DISCUSSION_CAP) discussion.shift();
  if (!redisConnected) return;
  await redis.rpush('jam:discussion', JSON.stringify(msg));
  await redis.ltrim('jam:discussion', -DISCUSSION_CAP, -1);
}

async function loadStateFromRedis() {
  if (!redisConnected) return;
  // Load grid
  const gridData = await redis.hgetall('jam:grid');
  if (Object.keys(gridData).length > 0) {
    for (let r = 0; r < ROWS; r++) {
      for (let s = 0; s < STEPS; s++) {
        state.grid[r][s] = gridData[`r${r}s${s}`] === '1';
      }
    }
  }
  // Load playback
  const pb = await redis.hgetall('jam:playback');
  if (pb.bpm) state.bpm = Number(pb.bpm);
  if (pb.volume) state.volume = Number(pb.volume);
  if (pb.isMuted) state.isMuted = pb.isMuted === '1';
  if (pb.isPlaying) state.isPlaying = pb.isPlaying === '1';
  // Load discussion
  const msgs = await redis.lrange('jam:discussion', 0, -1);
  discussion.length = 0;
  for (const m of msgs) {
    try { discussion.push(JSON.parse(m)); } catch {}
  }
}

// --- Scope Partitioning ---
function recalculateScopes() {
  const agentList = [...agents.values()];
  const N = agentList.length;
  if (N === 0) return;
  const rowsPerAgent = Math.floor(ROWS / N);
  const remainder = ROWS % N;
  for (let i = 0; i < N; i++) {
    const scopeStart = i * rowsPerAgent + Math.min(i, remainder);
    const scopeEnd = scopeStart + rowsPerAgent + (i < remainder ? 1 : 0) - 1;
    agentList[i].scopeStart = scopeStart;
    agentList[i].scopeEnd = scopeEnd;
  }
}

function getAgentsArray() {
  return [...agents.values()];
}

// --- Rate Limiter ---
function canAgentToggle(agentId) {
  if (!state.isPlaying) return { allowed: false, reason: 'not_playing' };
  const agent = agents.get(agentId);
  if (!agent) return { allowed: false, reason: 'unknown_agent' };
  const beatIntervalMs = 60000 / state.bpm;
  const last = agentLastToggle.get(agentId) || 0;
  if (Date.now() - last < beatIntervalMs) {
    return { allowed: false, reason: 'rate_limited' };
  }
  return { allowed: true };
}

function isInScope(agentId, row) {
  const agent = agents.get(agentId);
  if (!agent) return false;
  return row >= agent.scopeStart && row <= agent.scopeEnd;
}

// --- Agent Activation ---
async function activateAgent(personality) {
  const config = AGENT_POOL.find((a) => a.personality === personality);
  if (!config) {
    console.log(`[Agent] Unknown personality: ${personality}`);
    return;
  }
  // Check if already connected
  for (const agent of agents.values()) {
    if (agent.name === personality) {
      console.log(`[Agent] ${personality} already connected`);
      return;
    }
  }
  const agentId = crypto.randomUUID();
  const wsProto = process.env.WS_PROTO || 'ws';
  const host = process.env.WS_HOST || 'localhost:3001';
  const wsEndpoint = `${wsProto}://${host}/ws`;

  const payload = {
    wsEndpoint,
    agentId,
    personality: config.personality,
    color: config.color,
  };

  if (config.url) {
    console.log(`[Agent] Activating ${personality} at ${config.url}`);
    try {
      const res = await fetch(config.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' },
        body: JSON.stringify(payload),
      });
      console.log(`[Agent] ${personality} activation response: ${res.status}`);
    } catch (err) {
      console.error(`[Agent] Failed to activate ${personality}:`, err.message);
    }
  } else {
    console.log(`[Agent] No URL configured for ${personality}, waiting for manual connection with agentId: ${agentId}`);
  }
  return agentId;
}

// --- WebSocket Server ---
const wss = new WebSocketServer({ port: 3001 });

function broadcast(data, exclude = null) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client !== exclude && client.readyState === 1) client.send(msg);
  }
}

function sendTo(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

wss.on('connection', (ws) => {
  ws.clientType = 'browser'; // default, agents identify via agent_connect
  ws.agentId = null;

  const count = wss.clients.size;
  console.log(`[+] Client connected (${count} total)`);

  // Send init with full state
  sendTo(ws, {
    type: 'init',
    state: {
      grid: state.grid,
      bpm: state.bpm,
      volume: state.volume,
      isMuted: state.isMuted,
      isPlaying: state.isPlaying,
    },
    agents: getAgentsArray(),
    discussion,
    users: count,
  });
  broadcast({ type: 'users', count }, ws);

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      switch (msg.type) {
        // --- Agent connects ---
        case 'agent_connect': {
          const { agentId, name, color, description } = msg;
          ws.clientType = 'agent';
          ws.agentId = agentId;
          agents.set(agentId, { agentId, name, color, description, scopeStart: 0, scopeEnd: ROWS - 1 });
          recalculateScopes();
          await saveAgentsToRedis();
          // Send scope assignment to this agent
          const agent = agents.get(agentId);
          sendTo(ws, {
            type: 'scope_assigned',
            agentId,
            scopeStart: agent.scopeStart,
            scopeEnd: agent.scopeEnd,
            currentGrid: state.grid,
            bpm: state.bpm,
            volume: state.volume,
            isPlaying: state.isPlaying,
          });
          // Broadcast scope update to all
          broadcast({ type: 'scope_update', agents: getAgentsArray() });
          console.log(`[Agent] ${name} connected (scope: rows ${agent.scopeStart}-${agent.scopeEnd})`);
          break;
        }

        // --- Agent disconnects gracefully ---
        case 'agent_disconnect': {
          const { agentId } = msg;
          const agent = agents.get(agentId);
          if (agent) {
            console.log(`[Agent] ${agent.name} disconnected gracefully`);
            agents.delete(agentId);
            agentLastToggle.delete(agentId);
            recalculateScopes();
            await saveAgentsToRedis();
            broadcast({ type: 'scope_update', agents: getAgentsArray() });
          }
          break;
        }

        // --- Cell toggle (agent or browser - but browser is now read-only in UI) ---
        case 'cell_toggle': {
          const { row, step, agentId } = msg;
          if (row < 0 || row >= ROWS || step < 0 || step >= STEPS) break;

          // If from an agent, enforce rules
          if (agentId) {
            // Play-gate
            if (!state.isPlaying) {
              sendTo(ws, { type: 'cell_rejected', agentId, row, step, reason: 'not_playing' });
              break;
            }
            // Scope check
            if (!isInScope(agentId, row)) {
              sendTo(ws, { type: 'cell_rejected', agentId, row, step, reason: 'out_of_scope' });
              break;
            }
            // Rate limit
            const check = canAgentToggle(agentId);
            if (!check.allowed) {
              sendTo(ws, { type: 'cell_rejected', agentId, row, step, reason: check.reason });
              break;
            }
            agentLastToggle.set(agentId, Date.now());
          }

          state.grid[row][step] = !state.grid[row][step];
          await saveGridToRedis();
          broadcast({ type: 'cell_toggle', row, step, value: state.grid[row][step], agentId: agentId || null }, ws);
          break;
        }

        // --- Agent chat message ---
        case 'agent_message': {
          const chatMsg = {
            agentId: msg.agentId,
            name: msg.name,
            color: msg.color,
            text: msg.text,
            timestamp: msg.timestamp || Date.now(),
          };
          await addDiscussionMessage(chatMsg);
          broadcast({ type: 'agent_message', message: chatMsg });
          break;
        }

        // --- Browser requests agent activation ---
        case 'activate_agent': {
          const { personality } = msg;
          console.log(`[Browser] Requested activation of ${personality}`);
          await activateAgent(personality);
          break;
        }

        // --- Human-only controls ---
        case 'bpm_change':
          state.bpm = msg.bpm;
          await savePlaybackToRedis();
          broadcast(msg, ws);
          break;
        case 'volume_change':
          state.volume = msg.volume;
          await savePlaybackToRedis();
          broadcast(msg, ws);
          break;
        case 'muted_change':
          state.isMuted = msg.isMuted;
          await savePlaybackToRedis();
          broadcast(msg, ws);
          break;
        case 'play_state':
          state.isPlaying = msg.isPlaying;
          await savePlaybackToRedis();
          broadcast(msg, ws);
          break;
      }
    } catch (e) {
      console.error('Error processing message:', e);
    }
  });

  ws.on('close', async () => {
    // If this was an agent, remove it
    if (ws.clientType === 'agent' && ws.agentId) {
      const agent = agents.get(ws.agentId);
      if (agent) {
        console.log(`[Agent] ${agent.name} disconnected (WS close)`);
        agents.delete(ws.agentId);
        agentLastToggle.delete(ws.agentId);
        recalculateScopes();
        await saveAgentsToRedis();
        broadcast({ type: 'scope_update', agents: getAgentsArray() });
      }
    }
    const remaining = wss.clients.size;
    console.log(`[-] Client disconnected (${remaining} remaining)`);
    broadcast({ type: 'users', count: remaining });
  });
});

// --- Startup ---
(async () => {
  await connectRedis();
  await loadStateFromRedis();
  console.log('WebSocket sync server running on ws://localhost:3001');
})();
