import { WebSocketServer } from 'ws';

const ROWS = 6;
const STEPS = 16;

const createEmptyGrid = () =>
  Array.from({ length: ROWS }, () => Array(STEPS).fill(false));

const state = {
  grid: createEmptyGrid(),
  agents: [], // { id, personalityName, color, description, pattern: boolean[][] }
  bpm: 120,
  volume: -6,
  isMuted: false,
  isPlaying: false,
};

const wss = new WebSocketServer({ port: 3001 });

function broadcast(data, exclude = null) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client !== exclude && client.readyState === 1) client.send(msg);
  }
}

wss.on('connection', (ws) => {
  const count = wss.clients.size;
  console.log(`[+] Client connected (${count} total)`);

  ws.send(JSON.stringify({ type: 'init', state, users: count }));
  broadcast({ type: 'users', count }, ws);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      switch (msg.type) {
        case 'cell_toggle': {
          const { row, step } = msg;
          state.grid[row][step] = !state.grid[row][step];
          broadcast({ type: 'cell_toggle', row, step, value: state.grid[row][step] }, ws);
          break;
        }
        case 'agent_add':
          state.agents.push(msg.agent);
          broadcast({ type: 'agent_add', agent: msg.agent }, ws);
          break;
        case 'agent_remove':
          state.agents = state.agents.filter((a) => a.id !== msg.id);
          broadcast({ type: 'agent_remove', id: msg.id }, ws);
          break;
        case 'bpm_change':
          state.bpm = msg.bpm;
          broadcast(msg, ws);
          break;
        case 'volume_change':
          state.volume = msg.volume;
          broadcast(msg, ws);
          break;
        case 'muted_change':
          state.isMuted = msg.isMuted;
          broadcast(msg, ws);
          break;
        case 'play_state':
          state.isPlaying = msg.isPlaying;
          broadcast(msg, ws);
          break;
        case 'grid_randomize':
          state.grid = msg.grid;
          broadcast(msg, ws);
          break;
        case 'grid_clear':
          state.grid = createEmptyGrid();
          state.agents = [];
          broadcast(msg, ws);
          break;
      }
    } catch (e) {
      console.error('Error processing message:', e);
    }
  });

  ws.on('close', () => {
    const remaining = wss.clients.size;
    console.log(`[-] Client disconnected (${remaining} remaining)`);
    broadcast({ type: 'users', count: remaining });
  });
});

console.log('WebSocket sync server running on ws://localhost:3001');
