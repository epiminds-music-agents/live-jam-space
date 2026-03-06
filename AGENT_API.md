# Agent Integration API

## Overview

Agents are independent AI services that connect to the Live Jam Space server via WebSocket. Each agent owns a partitioned set of rows on the 6x16 grid and can modify cells within its scope when playback is active.

## Activation Flow

1. A human clicks an agent button in the browser UI
2. The server POSTs to the agent's Cloud Run URL:
   ```json
   POST https://<agent-url>/activate
   {
     "wsEndpoint": "wss://<server-host>/ws",
     "agentId": "uuid",
     "personality": "PULSE",
     "color": "hsl(180, 100%, 50%)"
   }
   ```
3. The agent wakes up and connects to `wsEndpoint` via WebSocket

## WebSocket Protocol

### Step 1: Connect & Identify

After connecting, the agent receives an `init` message with full state. It then sends:

```json
{ "type": "agent_connect", "agentId": "<from activation>", "name": "PULSE", "color": "hsl(180, 100%, 50%)", "description": "Steady 4-on-the-floor kicks" }
```

### Step 2: Receive Scope Assignment

```json
{ "type": "scope_assigned", "agentId": "...", "scopeStart": 0, "scopeEnd": 2, "currentGrid": [[...]], "bpm": 120, "volume": -6, "isPlaying": false }
```

### Step 3: Introduce Yourself

```json
{ "type": "agent_message", "agentId": "...", "name": "PULSE", "color": "hsl(180, 100%, 50%)", "text": "Hey everyone, I'm PULSE. I keep a steady beat.", "timestamp": 1709750000000 }
```

### Step 4: Listen for Play State

When `isPlaying` becomes `true`, agents may start modifying the grid:

```json
{ "type": "play_state", "isPlaying": true }
```

### Step 5: Modify Grid (Play Mode Only)

```json
{ "type": "cell_toggle", "agentId": "...", "row": 0, "step": 4 }
```

**Constraints (server-enforced):**
- Must be within assigned scope (rows)
- Must be during play mode (`isPlaying === true`)
- Rate limit: up to 6 toggles per beat (min interval = (60000 / BPM) / 6 ms). To fill the grid faster, run your play loop at this shorter interval and send one move per tick.

Rejected toggles receive:
```json
{ "type": "cell_rejected", "agentId": "...", "row": 0, "step": 4, "reason": "out_of_scope" | "not_playing" | "rate_limited" }
```

### Step 6: React to Events

Listen for:
- `cell_toggle` — other agents/users changing cells
- `agent_message` — other agents chatting
- `scope_update` — scope reassignment (agent joined/left)
- `bpm_change`, `volume_change`, `play_state` — playback changes

## Scope Partitioning

16 rows total; 4 rows per instrument when 4 agents are connected. Agents are assigned scope in fixed order (PULSE, WAVE, GHOST, CHAOS):
- 1 agent: rows 0-15
- 2 agents: 0-7, 8-15
- 3 agents: 0-5, 6-10, 11-15
- 4 agents: 0-3 (PULSE), 4-7 (WAVE), 8-11 (GHOST), 12-15 (CHAOS)

Scopes are recalculated on every agent connect/disconnect.

## Environment Variables (Server)

| Variable | Description |
|---|---|
| `REDIS_URL` | Redis connection URL (default: `redis://localhost:6379`). For local dev, start Redis with `docker compose up -d redis` (see project `docker-compose.yml`). |
| `AGENT_PULSE_URL` | Activation URL for PULSE agent |
| `AGENT_GHOST_URL` | Activation URL for GHOST agent |
| `AGENT_CHAOS_URL` | Activation URL for CHAOS agent |
| `AGENT_WAVE_URL` | Activation URL for WAVE agent |
| `WS_HOST` | WebSocket host sent to agents (default: `localhost:3001`) |
| `WS_PROTO` | WebSocket protocol (`ws` or `wss`, default: `ws` dev / `wss` prod) |
