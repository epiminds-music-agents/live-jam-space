import { GameServer } from './server';
import { Redis } from 'ioredis';
import dotenv from 'dotenv';
// Note: We are NOT importing AgentManager or Agents here anymore.
// Agents are now separate processes (functions) managed by runtime.ts

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const PORT = parseInt(process.env.PORT || '3001');

async function main() {
  console.log('Initializing Event Environment (The Matrix)...');

  // Start the Main Server (Environment)
  // It handles:
  // 1. WebSocket connections for humans (Frontend)
  // 2. Redis Event Bridge (triggers Agent Functions via Webhooks)
  new GameServer(PORT, REDIS_URL);
}

main().catch(console.error);
