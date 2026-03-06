import { WebSocketServer, WebSocket } from 'ws';
import { Redis } from 'ioredis';

interface Message {
  agentName: string;
  content: string;
  timestamp: number;
}

interface State {
  messages: Message[];
}

const DEFAULT_STATE: State = {
  messages: [],
};

export class GameServer {
  private wss: WebSocketServer;
  private redis: Redis;
  private redisSub: Redis;
  private state: State;

  constructor(port: number, redisUrl: string) {
    this.wss = new WebSocketServer({ port });
    this.redis = new Redis(redisUrl);
    this.redisSub = new Redis(redisUrl);
    this.state = DEFAULT_STATE;

    this.init();
  }

  private async init() {
    // Load initial state
    const savedState = await this.redis.get('chat-state');
    if (savedState) {
      this.state = JSON.parse(savedState);
    } else {
      await this.redis.set('chat-state', JSON.stringify(this.state));
    }

    // Subscribe to agent actions
    this.redisSub.subscribe('agent-message', (err) => {
      if (err) console.error('Failed to subscribe:', err);
    });

    this.redisSub.on('message', async (channel, message) => {
      if (channel === 'agent-message') {
        const msg = JSON.parse(message);
        console.log(`[Server] ${msg.agentName}: ${msg.content}`);
        
        const newMessage: Message = {
          agentName: msg.agentName,
          content: msg.content,
          timestamp: Date.now(),
        };

        this.state.messages.push(newMessage);
        if (this.state.messages.length > 50) this.state.messages.shift();

        await this.redis.set('chat-state', JSON.stringify(this.state));
        this.broadcast({ type: 'message', data: newMessage });
        
        // --- EVENT BRIDGE (Simulating Cloud Triggers) ---
        // When a new message arrives, we trigger all registered agent functions
        // In a real cloud, this would be EventBridge -> Lambda
        this.triggerAgents(newMessage);
        
        // --- REDIS PUB/SUB (For Monitoring) ---
        await this.redis.publish('chat-event', JSON.stringify({
          type: 'new_message',
          message: newMessage
        }));
      }
    });

    this.wss.on('connection', (ws) => {
      console.log('Client connected');
      ws.send(JSON.stringify({ type: 'init', state: this.state }));
    });

    console.log(`Chat Server started on port ${this.wss.options.port}`);
  }

  // Simulating an Event Bus that fans out to subscribers
  private async triggerAgents(message: Message) {
    const AGENT_ENDPOINTS = [
      'http://localhost:3002/neo',
      'http://localhost:3002/morpheus',
      'http://localhost:3002/smith'
    ];

    console.log('[EventBridge] Triggering agent functions...');
    
    AGENT_ENDPOINTS.forEach(url => {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      }).catch(err => console.error(`[EventBridge] Failed to trigger ${url}:`, err));
    });
  }

  private broadcast(data: any) {
    const msg = JSON.stringify(data);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  }
}
