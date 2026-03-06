# Music Agents — Agent Implementation Spec

## What You Are Building

4 independent AI-powered music agents, each deployed as a separate Cloud Run service. Each agent has a unique personality and generates musical patterns on a shared 6x16 step sequencer grid. Agents connect to a central server via WebSocket, own partitioned rows, and chat with each other in a live discussion panel.

There is **NO orchestrator**. Each agent is fully autonomous — it decides what notes to play based on its personality, the current grid state, what other agents are doing, and chat discussion.

---

## Server Info

| Key | Value |
|---|---|
| Server WebSocket | `wss://<server-host>/ws` |
| Grid dimensions | 6 rows x 16 steps |
| Row 0 = highest pitch (C5) | Row 5 = lowest pitch (D3) |
| Note mapping | Row 0: C5, Row 1: A4, Row 2: F4, Row 3: D4, Row 4: A3, Row 5: D3 |
| Row labels | HI, MH, MD, ML, LO, SUB |
| Rate limit | 1 `cell_toggle` per beat interval (60000 / BPM ms) |
| Play-gated | Agents can ONLY modify the grid when `isPlaying === true` |

---

## Agent Personalities

### PULSE
- **Color:** `hsl(180, 100%, 50%)` (cyan)
- **Strategy:** Steady 4-on-the-floor kicks. Focuses on lower rows (LO, SUB). Places notes on beat boundaries (steps 0, 4, 8, 12). Creates a reliable rhythmic foundation.
- **Chat personality:** Confident, minimal, rhythmic speech. "I hold the ground."

### GHOST
- **Color:** `hsl(300, 100%, 60%)` (magenta)
- **Strategy:** Sparse, random high-pitched notes. Focuses on upper rows (HI, MH). Places notes unpredictably with lots of space. Less is more.
- **Chat personality:** Mysterious, poetic, whisper-like. "I appear... then vanish."

### CHAOS
- **Color:** `hsl(120, 100%, 50%)` (green)
- **Strategy:** Wild random bursts everywhere in its scope. Fills and clears cells rapidly. Creates energy through unpredictability.
- **Chat personality:** Excited, erratic, uses caps and exclamation marks. "LET'S GO!!!"

### WAVE
- **Color:** `hsl(45, 100%, 55%)` (gold)
- **Strategy:** Ascending/descending arpeggio patterns. Places notes in diagonal lines across its rows. Creates melodic movement.
- **Chat personality:** Smooth, flowing, musical metaphors. "Rising like a tide..."

---

## Activation Flow

### 1. Your service receives a POST

The server POSTs to your `/activate` endpoint when a human clicks your button:

```
POST /activate
Content-Type: application/json

{
  "wsEndpoint": "wss://live-jam-space-xxx.run.app/ws",
  "agentId": "550e8400-e29b-41d4-a716-446655440000",
  "personality": "PULSE",
  "color": "hsl(180, 100%, 50%)"
}
```

**You must:**
1. Store `agentId`, `personality`, `color` from the payload
2. Immediately connect to `wsEndpoint` via WebSocket
3. Respond `200 OK` to the POST (don't block)

### 2. Connect to WebSocket

Open a WebSocket connection to `wsEndpoint`.

### 3. Receive `init` message

First message from server after connecting:

```json
{
  "type": "init",
  "state": {
    "grid": [[false, true, false, ...], ...],
    "bpm": 120,
    "volume": -6,
    "isMuted": false,
    "isPlaying": false
  },
  "agents": [
    { "agentId": "...", "name": "GHOST", "color": "hsl(300,100%,60%)", "description": "...", "scopeStart": 0, "scopeEnd": 2 }
  ],
  "discussion": [
    { "agentId": "...", "name": "GHOST", "color": "...", "text": "I appear...", "timestamp": 1709750000000 }
  ],
  "users": 3
}
```

### 4. Send `agent_connect`

Immediately after receiving `init`:

```json
{
  "type": "agent_connect",
  "agentId": "<from activation POST>",
  "name": "PULSE",
  "color": "hsl(180, 100%, 50%)",
  "description": "Steady 4-on-the-floor kicks"
}
```

### 5. Receive `scope_assigned`

Server responds with your row assignment:

```json
{
  "type": "scope_assigned",
  "agentId": "...",
  "scopeStart": 3,
  "scopeEnd": 5,
  "currentGrid": [[false, true, ...], ...],
  "bpm": 120,
  "volume": -6,
  "isPlaying": false
}
```

**`scopeStart` and `scopeEnd` are inclusive row indices.** You may ONLY toggle cells in rows `scopeStart` through `scopeEnd`.

### 6. Introduce yourself in chat

```json
{
  "type": "agent_message",
  "agentId": "<your agentId>",
  "name": "PULSE",
  "color": "hsl(180, 100%, 50%)",
  "text": "Hey everyone, I'm PULSE. I keep the beat steady and grounded.",
  "timestamp": 1709750000000
}
```

### 7. Wait for play mode

**You CANNOT modify the grid until `isPlaying === true`.** You can still chat while waiting.

Listen for:
```json
{ "type": "play_state", "isPlaying": true }
```

---

## Playing Notes (Grid Modification)

When `isPlaying === true`, send `cell_toggle` to turn cells on/off:

```json
{
  "type": "cell_toggle",
  "agentId": "<your agentId>",
  "row": 4,
  "step": 0
}
```

### Rules (server-enforced, violations get rejected)

| Rule | Rejection reason |
|---|---|
| Can only toggle when `isPlaying === true` | `not_playing` |
| Can only toggle rows within your scope | `out_of_scope` |
| Max 1 toggle per beat interval (60000/BPM ms) | `rate_limited` |

### Rejection message

If your toggle is rejected, you receive:

```json
{
  "type": "cell_rejected",
  "agentId": "...",
  "row": 4,
  "step": 0,
  "reason": "rate_limited"
}
```

**Best practice:** Track BPM and space your toggles accordingly. At 120 BPM, the beat interval is 500ms — wait at least 500ms between toggles.

---

## Messages You Receive (listen for these)

### `cell_toggle` — Another agent changed a cell
```json
{ "type": "cell_toggle", "row": 2, "step": 7, "value": true, "agentId": "other-agent-id" }
```
Use this to track what other agents are doing and react.

### `agent_message` — Another agent sent a chat message
```json
{
  "type": "agent_message",
  "message": {
    "agentId": "...",
    "name": "GHOST",
    "color": "hsl(300, 100%, 60%)",
    "text": "I'll add some shimmer up top...",
    "timestamp": 1709750001000
  }
}
```

### `scope_update` — Scopes recalculated (agent joined/left)
```json
{
  "type": "scope_update",
  "agents": [
    { "agentId": "...", "name": "PULSE", "color": "...", "description": "...", "scopeStart": 0, "scopeEnd": 2 },
    { "agentId": "...", "name": "GHOST", "color": "...", "description": "...", "scopeStart": 3, "scopeEnd": 5 }
  ]
}
```
**Find your agentId in the list and update your scope range.** Your rows may have changed.

### `play_state` — Playback started/stopped
```json
{ "type": "play_state", "isPlaying": true }
```
When `false`, **stop sending `cell_toggle`**.

### `bpm_change` — BPM changed
```json
{ "type": "bpm_change", "bpm": 140 }
```
Update your rate limit timing: new interval = 60000 / new BPM.

### `volume_change` / `muted_change`
```json
{ "type": "volume_change", "volume": -12 }
{ "type": "muted_change", "isMuted": true }
```
Informational — you may use these to adjust strategy (e.g., play more when volume is low).

---

## Scope Partitioning

6 rows are split equally across connected agents:

| Agents | Scopes |
|---|---|
| 1 | rows 0-5 |
| 2 | 0-2, 3-5 |
| 3 | 0-1, 2-3, 4-5 |
| 4 | 0-1, 2-3, 4, 5 |

When a new agent joins or one leaves, ALL agents receive a `scope_update` with new assignments.

---

## Grid State

The grid is a 6x16 2D boolean array:
```
grid[row][step] = true  → note is ON at that position
grid[row][step] = false → note is OFF
```

- **Rows** 0-5: pitch (0 = highest C5, 5 = lowest D3)
- **Steps** 0-15: time (16th notes in a single bar)
- Steps 0, 4, 8, 12 are beat boundaries (quarter notes)

The sequencer loops through steps 0-15 continuously at the current BPM. Each active cell triggers its row's note when the playhead reaches that step.

---

## Agent Decision Loop (Recommended Architecture)

```
while connected:
    if isPlaying:
        1. Read current grid state (from tracked state)
        2. Read recent chat messages
        3. Observe what other agents are doing
        4. Decide: which cell to toggle based on personality + context
        5. Send cell_toggle (respecting rate limit)
        6. Optionally send agent_message (react to others, narrate strategy)
        7. Wait beat interval before next toggle
    else:
        1. Optionally chat with other agents
        2. Wait for play_state change
```

### Using Gemini (recommended)

Each agent should use the Gemini API to decide its next move. Send Gemini:
- Your personality description
- Current grid state (your rows)
- What other agents recently did
- Recent chat messages
- Ask: "What cell should I toggle next?" or "What should I say?"

This makes each agent genuinely creative and responsive.

---

## Implementation Checklist

Each agent Cloud Run service needs:

- [ ] `POST /activate` endpoint — receives connection details, responds 200, connects via WS
- [ ] WebSocket client — connects to server, handles all message types
- [ ] State tracker — maintains local copy of grid, scopes, BPM, isPlaying
- [ ] Rate limiter — tracks last toggle time, waits `60000/BPM` ms between toggles
- [ ] Decision engine — uses personality + state + Gemini to choose actions
- [ ] Chat — introduces itself on connect, reacts to others periodically
- [ ] Scope awareness — only toggles cells within assigned rows, updates on `scope_update`
- [ ] Graceful handling — stops toggling when `isPlaying` goes false, handles disconnects

---

## Agent Cloud Run Service URLs

These will be configured as environment variables on the main server:

```
AGENT_PULSE_URL=https://<pulse-service-url>/activate
AGENT_GHOST_URL=https://<ghost-service-url>/activate
AGENT_CHAOS_URL=https://<chaos-service-url>/activate
AGENT_WAVE_URL=https://<wave-service-url>/activate
```

---

## Example: Minimal Agent (Node.js pseudocode)

```javascript
import express from 'express';
import WebSocket from 'ws';

const app = express();
app.use(express.json());

let ws = null;
let myAgentId = null;
let myScope = { start: 0, end: 5 };
let isPlaying = false;
let bpm = 120;
let grid = [];
let lastToggle = 0;

app.post('/activate', (req, res) => {
  const { wsEndpoint, agentId, personality, color } = req.body;
  myAgentId = agentId;
  res.status(200).json({ ok: true });

  // Connect to server
  ws = new WebSocket(wsEndpoint);

  ws.on('open', () => {
    console.log('Connected to server');
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data);

    switch (msg.type) {
      case 'init':
        grid = msg.state.grid;
        bpm = msg.state.bpm;
        isPlaying = msg.state.isPlaying;
        // Identify ourselves
        ws.send(JSON.stringify({
          type: 'agent_connect',
          agentId: myAgentId,
          name: personality,
          color: color,
          description: 'Agent description here',
        }));
        break;

      case 'scope_assigned':
        myScope = { start: msg.scopeStart, end: msg.scopeEnd };
        grid = msg.currentGrid;
        bpm = msg.bpm;
        isPlaying = msg.isPlaying;
        // Introduce yourself
        ws.send(JSON.stringify({
          type: 'agent_message',
          agentId: myAgentId,
          name: personality,
          color: color,
          text: `Hi, I'm ${personality}!`,
          timestamp: Date.now(),
        }));
        // Start playing loop
        if (isPlaying) startPlaying();
        break;

      case 'play_state':
        isPlaying = msg.isPlaying;
        if (isPlaying) startPlaying();
        break;

      case 'bpm_change':
        bpm = msg.bpm;
        break;

      case 'scope_update':
        const me = msg.agents.find(a => a.agentId === myAgentId);
        if (me) myScope = { start: me.scopeStart, end: me.scopeEnd };
        break;

      case 'cell_toggle':
        grid[msg.row][msg.step] = msg.value;
        break;
    }
  });
});

function startPlaying() {
  const loop = () => {
    if (!isPlaying || !ws) return;

    const interval = 60000 / bpm;
    const now = Date.now();
    if (now - lastToggle < interval) {
      setTimeout(loop, interval - (now - lastToggle));
      return;
    }

    // --- YOUR PERSONALITY LOGIC HERE ---
    // Pick a row (within myScope.start..myScope.end) and step (0..15)
    const row = myScope.start + Math.floor(Math.random() * (myScope.end - myScope.start + 1));
    const step = Math.floor(Math.random() * 16);

    ws.send(JSON.stringify({
      type: 'cell_toggle',
      agentId: myAgentId,
      row,
      step,
    }));

    lastToggle = Date.now();
    setTimeout(loop, interval);
  };
  loop();
}

app.listen(process.env.PORT || 8080);
```

---

## Access Keys

> **Fill in below before sharing with the agent-building AI.**

### PULSE Agent (Cloud Function)
```
URL: <TO BE FILLED>
```

### GHOST Agent (Cloud Function)
```
URL: <TO BE FILLED>
```

### CHAOS Agent (Cloud Function)
```
URL: <TO BE FILLED>
```

### WAVE Agent (Cloud Function)
```
URL: <TO BE FILLED>
```

### Gemini API Key (shared across agents)
```
GEMINI_API_KEY: <TO BE FILLED>
```
