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

const ROWS = 16; // 4 rows per instrument (PULSE, WAVE, GHOST, CHAOS/default)
const STEPS = 16;
const DISCUSSION_CAP = 500;
const ACTIVATION_TIMEOUT_MS = 15000;

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
const createEmptyVelocityGrid = () =>
  Array.from({ length: ROWS }, () => Array(STEPS).fill(0));
const createEmptyOwnerGrid = () =>
  Array.from({ length: ROWS }, () => Array(STEPS).fill(null));

const state = {
  grid: createEmptyGrid(),
  velocityGrid: createEmptyVelocityGrid(),
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

// Agents: Map<agentId, { agentId, name, color, description, scopeStart, scopeEnd }>
const agents = new Map();
// Discussion messages
const discussion = [];
// Rate limiter: agentId -> last toggle timestamp
const agentLastToggle = new Map();
// Pending agent activations: personality -> { agentId, personality, requestedAt, timer }
const pendingActivations = new Map();

// --- Redis persistence helpers ---
async function saveGridToRedis() {
  if (!redisConnected) return;
  const fields = {};
  const velocityFields = {};
  for (let r = 0; r < ROWS; r++) {
    for (let s = 0; s < STEPS; s++) {
      fields[`r${r}s${s}`] = state.grid[r][s] ? '1' : '0';
      velocityFields[`r${r}s${s}`] = String(state.velocityGrid[r][s] ?? 0);
    }
  }
  await redis.hset('jam:grid', fields);
  await redis.hset('jam:velocity', velocityFields);
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
  // Load grid
  const gridData = await redis.hgetall('jam:grid');
  const velocityData = await redis.hgetall('jam:velocity');
  if (Object.keys(gridData).length > 0) {
    for (let r = 0; r < ROWS; r++) {
      for (let s = 0; s < STEPS; s++) {
        state.grid[r][s] = gridData[`r${r}s${s}`] === '1';
        state.velocityGrid[r][s] = Number(velocityData[`r${r}s${s}`] || 0);
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
  // Sort by fixed instrument order so each agent gets the same row block
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

// --- Rate Limiter (allow multiple toggles per beat so grid fills faster) ---
const TOGGLES_PER_BEAT = 6; // was 1; agents can now send up to 6 toggles per beat

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
        cellOwners[r][s] = null;
        cleared.push({ row: r, step: s });
      }
    }
  }
  if (cleared.length === 0) return;
  await saveGridToRedis();
  for (const cell of cleared) {
    broadcast({ type: 'cell_toggle', row: cell.row, step: cell.step, value: false, velocity: 0 });
  }
}

// --- Agent Activation ---
async function activateAgent(personality, agentId = crypto.randomUUID()) {
  const config = AGENT_POOL.find((a) => a.personality === personality);
  if (!config) {
    console.log(`[Agent] Unknown personality: ${personality}`);
    return null;
  }
  // Check if already connected
  if (isAgentConnected(personality)) {
    console.log(`[Agent] ${personality} already connected`);
    return null;
  }
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
      if (!res.ok) {
        console.error(`[Agent] Activation failed for ${personality}: ${res.status}`);
        return null;
      }
    } catch (err) {
      console.error(`[Agent] Failed to activate ${personality}:`, err.message);
      return null;
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

function getBrowserCount() {
  let count = 0;
  for (const client of wss.clients) {
    if (client.clientType === 'browser' && client.readyState === 1) count++;
  }
  return count;
}

wss.on('connection', (ws) => {
  ws.clientType = 'pending'; // becomes 'browser' or 'agent' after identification
  ws.agentId = null;
  ws.pendingTimer = null;

  const count = getBrowserCount();
  console.log(`[+] Client connected (${count} total)`);

  // Send init with full state
  sendTo(ws, {
    type: 'init',
    state: {
      grid: state.grid,
      velocityGrid: state.velocityGrid,
      bpm: state.bpm,
      volume: state.volume,
      isMuted: state.isMuted,
      isPlaying: state.isPlaying,
    },
    agents: getAgentsArray(),
    discussion,
    pendingActivations: getPendingActivationsArray(),
    users: count + 1, // +1 for this new connection
  });

  // If no agent_connect within 150ms, treat as a browser and broadcast the new count
  ws.pendingTimer = setTimeout(() => {
    ws.pendingTimer = null;
    if (ws.clientType === 'pending') {
      ws.clientType = 'browser';
      broadcast({ type: 'users', count: getBrowserCount() });
    }
  }, 150);

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      switch (msg.type) {
        // --- Agent connects ---
        case 'agent_connect': {
          const { agentId, name, color, description } = msg;
          if (ws.pendingTimer) { clearTimeout(ws.pendingTimer); ws.pendingTimer = null; }
          ws.clientType = 'agent';
          ws.agentId = agentId;
          clearPendingActivation({ personality: name, agentId });
          const duplicateIds = removeAgentsByName(name, agentId);
          closeAgentSocketsByIds(duplicateIds, ws);
          agents.set(agentId, { agentId, name, color, description, scopeStart: 0, scopeEnd: ROWS - 1 });
          recalculateScopes();
          await saveAgentsToRedis();
          await clearOutOfScopeOwnedCells();
          // Send scope assignment to this agent
          const agent = agents.get(agentId);
          sendTo(ws, {
            type: 'scope_assigned',
            agentId,
            scopeStart: agent.scopeStart,
            scopeEnd: agent.scopeEnd,
            currentGrid: state.grid,
            currentVelocityGrid: state.velocityGrid,
            bpm: state.bpm,
            volume: state.volume,
            isPlaying: state.isPlaying,
          });
          // Broadcast scope update to all
          broadcast({ type: 'scope_update', agents: getAgentsArray() });
          // Update user count (this connection switched from browser to agent)
          broadcast({ type: 'users', count: getBrowserCount() });
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
            clearPendingActivation({ personality: agent.name, agentId });
            recalculateScopes();
            await saveAgentsToRedis();
            await clearOutOfScopeOwnedCells();
            broadcast({ type: 'scope_update', agents: getAgentsArray() });
          }
          break;
        }

        // --- Cell toggle (agent or browser - but browser is now read-only in UI) ---
        case 'cell_toggle': {
          const { row, step, agentId, velocity } = msg;
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
          state.velocityGrid[row][step] = state.grid[row][step]
            ? Math.max(0.05, Math.min(1, Number(velocity) || 0.8))
            : 0;
          cellOwners[row][step] = state.grid[row][step] ? agentId || null : null;
          await saveGridToRedis();
          broadcast({ type: 'cell_toggle', row, step, value: state.grid[row][step], velocity: state.velocityGrid[row][step], agentId: agentId || null }, ws);
          break;
        }

        // --- Cell set (agent sets cell to explicit value instead of toggling) ---
        case 'cell_set': {
          const { row, step, value, velocity, agentId } = msg;
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
          if (state.grid[row][step] === newValue) break; // Already in desired state
          state.grid[row][step] = newValue;
          state.velocityGrid[row][step] = newValue
            ? Math.max(0.05, Math.min(1, Number(velocity) || state.velocityGrid[row][step] || 0.8))
            : 0;
          cellOwners[row][step] = newValue ? agentId || null : null;
          await saveGridToRedis();
          broadcast({ type: 'cell_toggle', row, step, value: newValue, velocity: state.velocityGrid[row][step], agentId: agentId || null }, ws);
          break;
        }

        // --- Agent chat message ---
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

        // --- Browser requests agent activation ---
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

        // --- Browser requests agent deactivation ---
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
          // Clear agent's grid cells
          for (let r = agentData.scopeStart; r <= agentData.scopeEnd; r++) {
            for (let s = 0; s < STEPS; s++) {
              if (state.grid[r][s]) {
                state.grid[r][s] = false;
                state.velocityGrid[r][s] = 0;
                cellOwners[r][s] = null;
                broadcast({ type: 'cell_toggle', row: r, step: s, value: false, velocity: 0 });
              }
            }
          }
          await saveGridToRedis();
          // Broadcast farewell message
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
          // Close the agent's WebSocket
          for (const client of wss.clients) {
            if (client.agentId === targetId) { client.close(); break; }
          }
          break;
        }

        // --- Reset session: kick all agents, clear grid ---
        case 'reset_session': {
          console.log('[Browser] Reset session requested');
          // Clear entire grid
          for (let r = 0; r < ROWS; r++) {
            for (let s = 0; s < STEPS; s++) {
              if (state.grid[r][s]) {
                state.grid[r][s] = false;
                state.velocityGrid[r][s] = 0;
                cellOwners[r][s] = null;
                broadcast({ type: 'cell_toggle', row: r, step: s, value: false, velocity: 0 });
              }
            }
          }
          await saveGridToRedis();
          // Kick all agents
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
          // Clear discussion
          discussion.length = 0;
          if (redisConnected) await redis.del('jam:discussion');
          broadcast({ type: 'reset_discussion' });
          console.log('[Browser] Session reset complete');
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
    if (ws.pendingTimer) { clearTimeout(ws.pendingTimer); ws.pendingTimer = null; }
    // If this was an agent, remove it
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
  console.log('WebSocket sync server running on ws://localhost:3001');
})();
