import { Redis } from 'ioredis';
import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

export interface AgentConfig {
  id: string;
  name: string;
  personality: string;
  topic: string;
}

export abstract class BaseAgent {
  protected redis: Redis;
  protected config: AgentConfig;

  constructor(redis: Redis, config: AgentConfig) {
    this.redis = redis;
    this.config = config;
  }

  async think(state: { messages: any[] }) {
    console.log(`[Agent ${this.config.name}] Thinking...`);
    
    // Get last 10 messages for context
    const recentHistory = state.messages.slice(-10);
    
    try {
      const prompt = `
        You are a conversational AI agent named ${this.config.name}.
        Your personality is: ${this.config.personality}.
        The current topic of discussion is: ${this.config.topic}.
        
        Recent Conversation History:
        ${JSON.stringify(recentHistory, null, 2)}
        
        Decide whether to speak now or stay silent. If you speak, provide your message content.
        You should speak if the conversation is relevant to you, or if you were directly addressed, or if you have a burning thought.
        Don't be afraid to disagree or steer the conversation.
        
        If you choose to speak, keep it concise (under 2 sentences).
      `;

      const { object: action } = await generateObject({
        model: openai('gpt-4o'),
        prompt: prompt,
        schema: z.object({
          shouldSpeak: z.boolean(),
          content: z.string().nullable().describe("The content of your message, if you choose to speak. Null if silent."),
        }),
      });

      if (action.shouldSpeak && action.content) {
        await this.speak(action.content);
      } else {
        console.log(`[Agent ${this.config.name}] Decided to stay silent.`);
      }
    } catch (error) {
      console.error(`[Agent ${this.config.name}] Error thinking:`, error);
    }
  }

  async speak(content: string) {
    // Publish message to Redis
    await this.redis.publish('agent-message', JSON.stringify({ 
      agentId: this.config.id,
      agentName: this.config.name,
      content 
    }));
  }
}
