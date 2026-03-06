import { BaseAgent, AgentConfig } from './BaseAgent';
import { Redis } from 'ioredis';

export class LLMAgent extends BaseAgent {
  constructor(redis: Redis, config: AgentConfig) {
    super(redis, config);
  }
  
  // You can override think() here if you want specific logic
  // e.g. different prompt strategies for Rhythm vs Melody
}
