# Running the Webapp as a Test Server with AI Agents

This guide explains how to run the app locally so you can change sounds/instruments and still have AI agents connect and play.

## 1. Start the dev stack

**Optional but recommended:** start Redis so the server persists grid state, agents, and discussion (and you avoid connection errors in the logs). The project includes a `docker-compose.yml` for Redis:

```bash
docker compose up -d redis
```

Then start the app:

```bash
npm install
npm run dev
```

This runs:

- **Vite** on **http://localhost:8080** (frontend; open this in the browser)
- **WebSocket server** on **ws://localhost:3001** (sync + agent connection)

If Redis is not running, the server still works but uses in-memory state and logs `[Redis] Connection error (falling back to in-memory)`.

## 2. Let agents reach your server

Agents are activated when you click their button; they then connect to the WebSocket URL your server sends them.

- **Agents running on the same machine**  
  No extra config. The server uses `WS_HOST=localhost:3001` and `WS_PROTO=ws` by default, so local agents can connect to `ws://localhost:3001/ws`.

- **Agents in the cloud (e.g. Cloud Run)**  
  They need a **public** WebSocket URL. Expose your local server with a tunnel (e.g. [ngrok](https://ngrok.com)):

  ```bash
  ngrok http 3001
  ```

  Then create a `.env` in the project root:

  ```env
  WS_PROTO=wss
  WS_HOST=<your-ngrok-host>
  AGENT_PULSE_URL=https://your-pulse-agent.run.app/activate
  AGENT_GHOST_URL=https://your-ghost-agent.run.app/activate
  AGENT_CHAOS_URL=https://your-chaos-agent.run.app/activate
  AGENT_WAVE_URL=https://your-wave-agent.run.app/activate
  ```

  Replace `<your-ngrok-host>` with the host ngrok shows (e.g. `abc123.ngrok-free.app`). If your tunnel uses a custom port in the URL, include it (e.g. `abc123.ngrok-free.app:443`). Replace the `AGENT_*_URL` values with your real agent activation endpoints.

  The server loads `.env` automatically and sends `wss://<WS_HOST>/ws` to agents when activating them.

## 3. Changing sounds and instruments

All playback and mapping live in the frontend. Edit **`src/pages/Index.tsx`**:

| What you want to change | Where in `Index.tsx` |
|-------------------------|----------------------|
| **Note (pitch) per row** | `NOTE_NAMES` (line ~13). Row 0 = first note, row 5 = last. Example: `["C5", "A4", "F4", "D4", "A3", "D3"]`. |
| **Row labels in the UI** | `ROW_LABELS` (line ~14). Example: `["HI", "MH", "MD", "ML", "LO", "SUB"]`. |
| **Synth sound (timbre)** | `initAudio` (around line 39). The `Tone.PolySynth(Tone.Synth, { ... })` options: e.g. `oscillator: { type: "triangle8" }` (try `"sine"`, `"square"`, `"sawtooth"`, `"triangle"`), and `envelope: { attack, decay, sustain, release }`. |

After saving, the Vite dev server hot-reloads; refresh or trigger play again to hear changes. The agents only toggle grid cells (rows/steps); the **browser** turns those cells into the notes and synth you defined, so your edits apply to what the agents “play” as well.

## Quick reference

- **App (UI):** http://localhost:8080  
- **WebSocket (server):** ws://localhost:3001  
- **Agent protocol:** see `AGENT_API.md`  
- **Server env vars:** `AGENT_API.md` (Environment Variables section)
