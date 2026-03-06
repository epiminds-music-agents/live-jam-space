import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Redis from 'ioredis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 8080;
const ROWS = 16; // 4 rows per instrument (PULSE, WAVE, GHOST, CHAOS/default)
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
  console.warn('[Redis] Connection error:', err.message);
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

// --- In-memory state ---
const createEmptyGrid = () =>
  Array.from({ length: ROWS }, () => Array(STEPS).fill(false));

const state = {
  grid: createEmptyGrid(),
  bpm: 120,
  volume: -6,
  isMuted: false,
  isPlaying: false,
};

const agents = new Map();
const discussion = [];
const agentLastToggle = new Map();

// --- Redis persistence ---
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

function sanitizeAgentChatText(text) {
  if (typeof text !== 'string') return '…';
  let out = text.trim();
  out = out.replace(/```[\w]*\s*[\s\S]*?```/g, '').trim();
  const looksLikeMovePlan = /^\s*\[\s*(\{\s*"row"\s*:\s*\d+\s*,\s*"step"\s*:\s*\d+\s*\}\s*,?\s*)*\s*\]\s*$/;
  if (looksLikeMovePlan.test(out)) return '…';
  if (out.match(/\{\s*"row"\s*:\s*\d+\s*,\s*"step"\s*:\s*\d+\s*}/)) {
    out = out.replace(/\{\s*"row"\s*:\s*\d+\s*,\s*"step"\s*:\s*\d+\s*}[,\]\s]*/g, '').trim();
  }
  if (!out || out.replace(/[\s\[\],]/g, '').length === 0) return '…';
  return out.slice(0, 500);
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
  const gridData = await redis.hgetall('jam:grid');
  if (Object.keys(gridData).length > 0) {
    for (let r = 0; r < ROWS; r++) {
      for (let s = 0; s < STEPS; s++) {
        state.grid[r][s] = gridData[`r${r}s${s}`] === '1';
      }
    }
  }
  const pb = await redis.hgetall('jam:playback');
  if (pb.bpm) state.bpm = Number(pb.bpm);
  if (pb.volume) state.volume = Number(pb.volume);
  if (pb.isMuted) state.isMuted = pb.isMuted === '1';
  if (pb.isPlaying) state.isPlaying = pb.isPlaying === '1';
  const msgs = await redis.lrange('jam:discussion', 0, -1);
  discussion.length = 0;
  for (const m of msgs) {
    try { discussion.push(JSON.parse(m)); } catch {}
  }
}

// Fixed order so rows 0-3=kick, 4-7=guitar, 8-11=piano, 12-15=synth
const SCOPE_ORDER = ['PULSE', 'WAVE', 'GHOST', 'CHAOS'];

// --- Scope Partitioning ---
function recalculateScopes() {
  const agentList = [...agents.values()];
  const N = agentList.length;
  if (N === 0) return;
  agentList.sort((a, b) => {
    const i = SCOPE_ORDER.indexOf(a.name);
    const j = SCOPE_ORDER.indexOf(b.name);
    return (i === -1 ? 99 : i) - (j === -1 ? 99 : j);
  });
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
// Allow multiple toggles per beat so grid fills faster
const TOGGLES_PER_BEAT = 6;

function canAgentToggle(agentId) {
  if (!state.isPlaying) return { allowed: false, reason: 'not_playing' };
  const agent = agents.get(agentId);
  if (!agent) return { allowed: false, reason: 'unknown_agent' };
  const beatIntervalMs = 60000 / state.bpm;
  const minIntervalMs = beatIntervalMs / TOGGLES_PER_BEAT;
  const last = agentLastToggle.get(agentId) || 0;
  if (Date.now() - last < minIntervalMs) {
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
  if (!config) return;
  for (const agent of agents.values()) {
    if (agent.name === personality) return;
  }
  const agentId = crypto.randomUUID();
  const wsProto = process.env.WS_PROTO || 'wss';
  const host = process.env.WS_HOST || `localhost:${PORT}`;
  const wsEndpoint = `${wsProto}://${host}/ws`;

  const payload = { wsEndpoint, agentId, personality: config.personality, color: config.color };

  if (config.url) {
    console.log(`[Agent] Activating ${personality} at ${config.url}`);
    try {
      const res = await fetch(config.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      console.log(`[Agent] ${personality} activation response: ${res.status}`);
    } catch (err) {
      console.error(`[Agent] Failed to activate ${personality}:`, err.message);
    }
  } else {
    console.log(`[Agent] No URL for ${personality}, agentId: ${agentId}`);
  }
  return agentId;
}

// --- Express ---
const app = express();
app.use(express.static(join(__dirname, 'dist')));
app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

// --- HTTP + WebSocket ---
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(data, exclude = null) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client !== exclude && client.readyState === 1) client.send(msg);
  }
}

function sendTo(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

function getBrowserCount() {
  let count = 0;
  for (const client of wss.clients) {
    if (client.clientType !== 'agent' && client.readyState === 1) count++;
  }
  return count;
}

wss.on('connection', (ws) => {
  ws.clientType = 'browser';
  ws.agentId = null;

  const count = getBrowserCount();
  console.log(`[+] Client connected (${count} total)`);

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
        case 'agent_connect': {
          const { agentId, name, color, description } = msg;
          ws.clientType = 'agent';
          ws.agentId = agentId;
          agents.set(agentId, { agentId, name, color, description, scopeStart: 0, scopeEnd: ROWS - 1 });
          recalculateScopes();
          await saveAgentsToRedis();
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
          broadcast({ type: 'scope_update', agents: getAgentsArray() });
          broadcast({ type: 'users', count: getBrowserCount() });
          console.log(`[Agent] ${name} connected (scope: rows ${agent.scopeStart}-${agent.scopeEnd})`);
          break;
        }
        case 'agent_disconnect': {
          const { agentId } = msg;
          const agent = agents.get(agentId);
          if (agent) {
            agents.delete(agentId);
            agentLastToggle.delete(agentId);
            recalculateScopes();
            await saveAgentsToRedis();
            broadcast({ type: 'scope_update', agents: getAgentsArray() });
          }
          break;
        }
        case 'cell_toggle': {
          const { row, step, agentId } = msg;
          if (row < 0 || row >= ROWS || step < 0 || step >= STEPS) break;
          if (agentId) {
            if (!state.isPlaying) {
              sendTo(ws, { type: 'cell_rejected', agentId, row, step, reason: 'not_playing' });
              break;
            }
            if (!isInScope(agentId, row)) {
              sendTo(ws, { type: 'cell_rejected', agentId, row, step, reason: 'out_of_scope' });
              break;
            }
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
        case 'agent_message': {
          const chatMsg = {
            agentId: msg.agentId,
            name: msg.name,
            color: msg.color,
            text: sanitizeAgentChatText(msg.text),
            timestamp: msg.timestamp || Date.now(),
          };
          await addDiscussionMessage(chatMsg);
          broadcast({ type: 'agent_message', message: chatMsg });
          break;
        }
        case 'activate_agent': {
          const { personality } = msg;
          console.log(`[Browser] Requested activation of ${personality}`);
          await activateAgent(personality);
          break;
        }
        case 'deactivate_agent': {
          const { personality } = msg;
          console.log(`[Browser] Requested deactivation of ${personality}`);
          let targetId = null;
          for (const [id, agent] of agents) {
            if (agent.name === personality) { targetId = id; break; }
          }
          if (!targetId) break;
          const agentData = agents.get(targetId);
          for (let r = agentData.scopeStart; r <= agentData.scopeEnd; r++) {
            for (let s = 0; s < STEPS; s++) {
              if (state.grid[r][s]) {
                state.grid[r][s] = false;
                broadcast({ type: 'cell_toggle', row: r, step: s, value: false });
              }
            }
          }
          await saveGridToRedis();
          const farewellMsg = {
            agentId: targetId,
            name: agentData.name,
            color: agentData.color,
            text: 'I am leaving',
            timestamp: Date.now(),
          };
          await addDiscussionMessage(farewellMsg);
          broadcast({ type: 'agent_message', message: farewellMsg });
          agents.delete(targetId);
          agentLastToggle.delete(targetId);
          recalculateScopes();
          await saveAgentsToRedis();
          broadcast({ type: 'scope_update', agents: getAgentsArray() });
          for (const client of wss.clients) {
            if (client.agentId === targetId) { client.close(); break; }
          }
          break;
        }
        case 'reset_session': {
          console.log('[Browser] Reset session requested');
          for (let r = 0; r < ROWS; r++) {
            for (let s = 0; s < STEPS; s++) {
              if (state.grid[r][s]) {
                state.grid[r][s] = false;
                broadcast({ type: 'cell_toggle', row: r, step: s, value: false });
              }
            }
          }
          await saveGridToRedis();
          const agentClients = [];
          for (const client of wss.clients) {
            if (client.clientType === 'agent') agentClients.push(client);
          }
          agents.clear();
          agentLastToggle.clear();
          await saveAgentsToRedis();
          broadcast({ type: 'scope_update', agents: [] });
          for (const client of agentClients) {
            client.close();
          }
          discussion.length = 0;
          if (redisConnected) await redis.del('jam:discussion');
          broadcast({ type: 'reset_discussion' });
          break;
        }
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
    const remaining = getBrowserCount();
    console.log(`[-] Client disconnected (${remaining} remaining)`);
    broadcast({ type: 'users', count: remaining });
  });
});

// --- Startup ---
(async () => {
  await connectRedis();
  await loadStateFromRedis();
  server.listen(PORT, () => {
    console.log(`Production server running on port ${PORT}`);
  });
})();
