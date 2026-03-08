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
const ACTIVATION_TIMEOUT_MS = 15000;
let inferredPublicWsProto = null;
let inferredPublicWsHost = null;

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
const createEmptyVelocityGrid = () =>
  Array.from({ length: ROWS }, () => Array(STEPS).fill(0));
const createEmptyLengthGrid = () =>
  Array.from({ length: ROWS }, () => Array(STEPS).fill('16n'));
const createEmptyOwnerGrid = () =>
  Array.from({ length: ROWS }, () => Array(STEPS).fill(null));

const state = {
  grid: createEmptyGrid(),
  velocityGrid: createEmptyVelocityGrid(),
  lengthGrid: createEmptyLengthGrid(),
  bpm: 120,
  volume: -6,
  isMuted: false,
  isPlaying: false,
};
const cellOwners = createEmptyOwnerGrid();

function normalizeDiscussionKind(kind) {
  return kind === 'note' || kind === 'plan' ? kind : 'chat';
}

function normalizeDiscussionMessage(msg) {
  return {
    agentId: msg.agentId,
    name: msg.name,
    color: msg.color,
    kind: normalizeDiscussionKind(msg.kind),
    agreement: msg.agreement || undefined,
    text: msg.text,
    timestamp: msg.timestamp || Date.now(),
  };
}

const agents = new Map();
const discussion = [];
const agentLastToggle = new Map();
const pendingActivations = new Map();

// --- Redis persistence ---
async function saveGridToRedis() {
  if (!redisConnected) return;
  const fields = {};
  const velocityFields = {};
  const lengthFields = {};
  for (let r = 0; r < ROWS; r++) {
    for (let s = 0; s < STEPS; s++) {
      fields[`r${r}s${s}`] = state.grid[r][s] ? '1' : '0';
      velocityFields[`r${r}s${s}`] = String(state.velocityGrid[r][s] ?? 0);
      lengthFields[`r${r}s${s}`] = state.lengthGrid[r][s] || '16n';
    }
  }
  await redis.hset('jam:grid', fields);
  await redis.hset('jam:velocity', velocityFields);
  await redis.hset('jam:length', lengthFields);
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
  const normalized = normalizeDiscussionMessage(msg);
  discussion.push(normalized);
  if (discussion.length > DISCUSSION_CAP) discussion.shift();
  if (!redisConnected) return;
  await redis.rpush('jam:discussion', JSON.stringify(normalized));
  await redis.ltrim('jam:discussion', -DISCUSSION_CAP, -1);
}

async function loadStateFromRedis() {
  if (!redisConnected) return;
  const gridData = await redis.hgetall('jam:grid');
  const velocityData = await redis.hgetall('jam:velocity');
  const lengthData = await redis.hgetall('jam:length');
  if (Object.keys(gridData).length > 0) {
    for (let r = 0; r < ROWS; r++) {
      for (let s = 0; s < STEPS; s++) {
        state.grid[r][s] = gridData[`r${r}s${s}`] === '1';
        state.velocityGrid[r][s] = Number(velocityData[`r${r}s${s}`] || 0);
        state.lengthGrid[r][s] = lengthData[`r${r}s${s}`] || '16n';
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
    try { discussion.push(normalizeDiscussionMessage(JSON.parse(m))); } catch {}
  }
}

// Fixed order so rows 0-3=kick, 4-7=guitar, 8-11=piano, 12-15=synth
const SCOPE_ORDER = ['PULSE', 'WAVE', 'GHOST', 'CHAOS'];

function compareAgentsByScopeOrder(left, right) {
  const leftIndex = SCOPE_ORDER.indexOf(left.name);
  const rightIndex = SCOPE_ORDER.indexOf(right.name);
  return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
}

// --- Scope Partitioning ---
function recalculateScopes() {
  const agentList = [...agents.values()];
  const N = agentList.length;
  if (N === 0) return;
  agentList.sort(compareAgentsByScopeOrder);
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
  return [...agents.values()].sort(compareAgentsByScopeOrder);
}

function getPendingActivationsArray() {
  return [...pendingActivations.values()]
    .map(({ agentId, personality, requestedAt }) => ({
      agentId,
      personality,
      requestedAt,
    }))
    .sort((left, right) => left.requestedAt - right.requestedAt);
}

function isAgentConnected(personality) {
  for (const agent of agents.values()) {
    if (agent.name === personality) return true;
  }
  return false;
}

function closeAgentSocketsByIds(agentIds, exclude = null) {
  if (agentIds.length === 0) return;
  const idSet = new Set(agentIds);
  for (const client of wss.clients) {
    if (client === exclude) continue;
    if (client.clientType !== 'agent') continue;
    if (!idSet.has(client.agentId)) continue;
    client.close();
  }
}

function clearPendingActivation({ personality = null, agentId = null } = {}) {
  let changed = false;
  const clearAll = !personality && !agentId;
  for (const [key, pending] of pendingActivations) {
    if (clearAll) {
      clearTimeout(pending.timer);
      pendingActivations.delete(key);
      changed = true;
      continue;
    }
    const matchesPersonality = personality && pending.personality === personality;
    const matchesAgentId = agentId && pending.agentId === agentId;
    if (!matchesPersonality && !matchesAgentId) continue;
    clearTimeout(pending.timer);
    pendingActivations.delete(key);
    changed = true;
  }
  if (changed) {
    broadcast({ type: 'activation_update', pendingActivations: getPendingActivationsArray() });
  }
}

function toWebSocketProto(forwardedProto) {
  if (!forwardedProto) return null;
  if (forwardedProto === 'https') return 'wss';
  if (forwardedProto === 'http') return 'ws';
  if (forwardedProto === 'wss' || forwardedProto === 'ws') return forwardedProto;
  return null;
}

function rememberPublicWebSocketTarget(req) {
  const forwardedProtoHeader = req.headers['x-forwarded-proto'];
  const forwardedProto = Array.isArray(forwardedProtoHeader)
    ? forwardedProtoHeader[0]
    : forwardedProtoHeader?.split(',')[0]?.trim();
  const hostHeader = req.headers['x-forwarded-host'] || req.headers.host;
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  const wsProto = toWebSocketProto(forwardedProto);
  if (wsProto) inferredPublicWsProto = wsProto;
  if (host) inferredPublicWsHost = host.trim();
}

function setPendingActivation(personality, agentId) {
  clearPendingActivation({ personality });
  const pending = {
    agentId,
    personality,
    requestedAt: Date.now(),
    timer: setTimeout(() => {
      const current = pendingActivations.get(personality);
      if (!current || current.agentId !== agentId) return;
      pendingActivations.delete(personality);
      console.warn(`[Agent] Activation timed out for ${personality}`);
      broadcast({ type: 'activation_update', pendingActivations: getPendingActivationsArray() });
    }, ACTIVATION_TIMEOUT_MS),
  };
  pendingActivations.set(personality, pending);
  broadcast({ type: 'activation_update', pendingActivations: getPendingActivationsArray() });
}

function removeAgentsByName(name, keepAgentId = null) {
  const removedIds = [];
  for (const [id, agent] of agents) {
    if (agent.name !== name) continue;
    if (keepAgentId && id === keepAgentId) continue;
    agents.delete(id);
    agentLastToggle.delete(id);
    removedIds.push(id);
  }
  return removedIds;
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

async function clearOutOfScopeOwnedCells() {
  const cleared = [];
  for (let r = 0; r < ROWS; r++) {
    for (let s = 0; s < STEPS; s++) {
      if (!state.grid[r][s]) {
        cellOwners[r][s] = null;
        continue;
      }
      const ownerId = cellOwners[r][s];
      if (!ownerId) continue;
      if (!isInScope(ownerId, r)) {
        state.grid[r][s] = false;
        state.velocityGrid[r][s] = 0;
        state.lengthGrid[r][s] = '16n';
        cellOwners[r][s] = null;
        cleared.push({ row: r, step: s });
      }
    }
  }
  if (cleared.length === 0) return;
  await saveGridToRedis();
  for (const cell of cleared) {
    broadcast({ type: 'cell_toggle', row: cell.row, step: cell.step, value: false, velocity: 0, length: '16n' });
  }
}

// --- Agent Activation ---
async function activateAgent(personality, agentId = crypto.randomUUID()) {
  const config = AGENT_POOL.find((a) => a.personality === personality);
  if (!config) return null;
  if (isAgentConnected(personality)) return null;
  const wsProto = process.env.WS_PROTO || inferredPublicWsProto || 'wss';
  const host = process.env.WS_HOST || inferredPublicWsHost || `localhost:${PORT}`;
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
      if (!res.ok) {
        console.error(`[Agent] Activation failed for ${personality}: ${res.status}`);
        return null;
      }
    } catch (err) {
      console.error(`[Agent] Failed to activate ${personality}:`, err.message);
      return null;
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

wss.on('connection', (ws, req) => {
  rememberPublicWebSocketTarget(req);
  ws.clientType = 'browser';
  ws.agentId = null;

  const count = getBrowserCount();
  console.log(`[+] Client connected (${count} total)`);

  sendTo(ws, {
    type: 'init',
    state: {
      grid: state.grid,
      velocityGrid: state.velocityGrid,
      lengthGrid: state.lengthGrid,
      bpm: state.bpm,
      volume: state.volume,
      isMuted: state.isMuted,
      isPlaying: state.isPlaying,
    },
    agents: getAgentsArray(),
    discussion,
    pendingActivations: getPendingActivationsArray(),
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
          clearPendingActivation({ personality: name, agentId });
          const duplicateIds = removeAgentsByName(name, agentId);
          closeAgentSocketsByIds(duplicateIds, ws);
          agents.set(agentId, { agentId, name, color, description, scopeStart: 0, scopeEnd: ROWS - 1 });
          recalculateScopes();
          await saveAgentsToRedis();
          await clearOutOfScopeOwnedCells();
          const agent = agents.get(agentId);
          sendTo(ws, {
            type: 'scope_assigned',
            agentId,
            scopeStart: agent.scopeStart,
            scopeEnd: agent.scopeEnd,
            currentGrid: state.grid,
            currentVelocityGrid: state.velocityGrid,
            currentLengthGrid: state.lengthGrid,
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
            clearPendingActivation({ personality: agent.name, agentId });
            recalculateScopes();
            await saveAgentsToRedis();
            await clearOutOfScopeOwnedCells();
            broadcast({ type: 'scope_update', agents: getAgentsArray() });
          }
          break;
        }
        case 'cell_toggle': {
          const { row, step, agentId, velocity, length } = msg;
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
          state.velocityGrid[row][step] = state.grid[row][step]
            ? Math.max(0.05, Math.min(1, Number(velocity) || 0.8))
            : 0;
          state.lengthGrid[row][step] = state.grid[row][step]
            ? (length === '32n' || length === '8n' || length === '4n' ? length : '16n')
            : '16n';
          cellOwners[row][step] = state.grid[row][step] ? agentId || null : null;
          await saveGridToRedis();
          broadcast({ type: 'cell_toggle', row, step, value: state.grid[row][step], velocity: state.velocityGrid[row][step], length: state.lengthGrid[row][step], agentId: agentId || null }, ws);
          break;
        }
        case 'cell_set': {
          const { row, step, value, velocity, length, agentId } = msg;
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
          const newValue = Boolean(value);
          if (state.grid[row][step] === newValue) break;
          state.grid[row][step] = newValue;
          state.velocityGrid[row][step] = newValue
            ? Math.max(0.05, Math.min(1, Number(velocity) || state.velocityGrid[row][step] || 0.8))
            : 0;
          state.lengthGrid[row][step] = newValue
            ? (length === '32n' || length === '8n' || length === '4n' ? length : state.lengthGrid[row][step] || '16n')
            : '16n';
          cellOwners[row][step] = newValue ? agentId || null : null;
          await saveGridToRedis();
          broadcast({ type: 'cell_toggle', row, step, value: newValue, velocity: state.velocityGrid[row][step], length: state.lengthGrid[row][step], agentId: agentId || null }, ws);
          break;
        }
        case 'agent_message': {
          const chatMsg = normalizeDiscussionMessage({
            agentId: msg.agentId,
            name: msg.name,
            color: msg.color,
            kind: msg.kind,
            agreement: msg.agreement,
            text: msg.text,
            timestamp: msg.timestamp || Date.now(),
          });
          await addDiscussionMessage(chatMsg);
          broadcast({ type: 'agent_message', message: chatMsg });
          break;
        }
        case 'activate_agent': {
          const { personality } = msg;
          console.log(`[Browser] Requested activation of ${personality}`);
          if (isAgentConnected(personality) || pendingActivations.has(personality)) {
            sendTo(ws, { type: 'scope_update', agents: getAgentsArray() });
            sendTo(ws, { type: 'activation_update', pendingActivations: getPendingActivationsArray() });
            break;
          }
          const agentId = crypto.randomUUID();
          setPendingActivation(personality, agentId);
          const activatedAgentId = await activateAgent(personality, agentId);
          if (!activatedAgentId) {
            clearPendingActivation({ personality, agentId });
          }
          break;
        }
        case 'deactivate_agent': {
          const { personality } = msg;
          console.log(`[Browser] Requested deactivation of ${personality}`);
          clearPendingActivation({ personality });
          let targetId = null;
          for (const [id, agent] of agents) {
            if (agent.name === personality) { targetId = id; break; }
          }
          if (!targetId) {
            sendTo(ws, { type: 'scope_update', agents: getAgentsArray() });
            break;
          }
          const agentData = agents.get(targetId);
          for (let r = agentData.scopeStart; r <= agentData.scopeEnd; r++) {
            for (let s = 0; s < STEPS; s++) {
              if (state.grid[r][s]) {
                state.grid[r][s] = false;
                state.velocityGrid[r][s] = 0;
                state.lengthGrid[r][s] = '16n';
                cellOwners[r][s] = null;
                broadcast({ type: 'cell_toggle', row: r, step: s, value: false, velocity: 0, length: '16n' });
              }
            }
          }
          await saveGridToRedis();
          const farewellMsg = {
            agentId: targetId,
            name: agentData.name,
            color: agentData.color,
            kind: 'chat',
            text: 'I am leaving',
            timestamp: Date.now(),
          };
          await addDiscussionMessage(farewellMsg);
          broadcast({ type: 'agent_message', message: farewellMsg });
          agents.delete(targetId);
          agentLastToggle.delete(targetId);
          recalculateScopes();
          await saveAgentsToRedis();
          await clearOutOfScopeOwnedCells();
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
                state.velocityGrid[r][s] = 0;
                state.lengthGrid[r][s] = '16n';
                cellOwners[r][s] = null;
                broadcast({ type: 'cell_toggle', row: r, step: s, value: false, velocity: 0, length: '16n' });
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
          clearPendingActivation();
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
        clearPendingActivation({ personality: agent.name, agentId: ws.agentId });
        recalculateScopes();
        await saveAgentsToRedis();
        await clearOutOfScopeOwnedCells();
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
