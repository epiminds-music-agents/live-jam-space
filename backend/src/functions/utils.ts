import { Redis } from 'ioredis';
import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

// Standard Cloud Function signature
export type AgentHandler = (req: Request) => Promise<Response>;

// Redis connection (shared across invocations if possible, otherwise per invocation)
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

interface AgentConfig {
  id: string;
  name: string;
  personality: string;
  topic: string;
}

export const createAgentFunction = (config: AgentConfig): AgentHandler => {
  return async (req: Request) => {
    try {
      const body = await req.json();
      const { message } = body; // The trigger event (new message)
      const messageTimestamp =
        typeof message?.timestamp === 'number' && Number.isFinite(message.timestamp)
          ? message.timestamp
          : Date.now();

      console.log(`[Function: ${config.name}] Triggered by message from ${message.agentName}`);

      // Fetch state (Stateless function pattern: Read state on trigger)
      const stateStr = await redis.get('chat-state');
      const state = stateStr ? JSON.parse(stateStr) : { messages: [] };
      
      // Don't reply to self
      if (message.agentName === config.name) {
        return new Response(JSON.stringify({ status: 'ignored_self' }), { status: 200 });
      }

      // Random delay to simulate thinking/typing and prevent collisions
      // In a real swarm, this would be a distributed lock or backoff strategy
      const delay = Math.random() * 2000 + 500; 
      await new Promise(resolve => setTimeout(resolve, delay));

      // Re-check state after delay (in case someone else spoke)
      const freshStateStr = await redis.get('chat-state');
      const freshState = freshStateStr ? JSON.parse(freshStateStr) : { messages: [] };
      const recentHistory = freshState.messages.slice(-10);
      
      // Simple collision check: did someone speak while I was thinking?
      const lastMsg = recentHistory[recentHistory.length - 1];
      const triggerIsRecent = Date.now() - messageTimestamp < 15_000;
      if (
        triggerIsRecent &&
        lastMsg &&
        lastMsg.timestamp > messageTimestamp + 100 &&
        lastMsg.agentName !== message.agentName
      ) {
         // Someone else spoke recently, maybe I should yield?
         if (Math.random() < 0.7) {
             console.log(`[Function: ${config.name}] Yielding to ${lastMsg.agentName}`);
             return new Response(JSON.stringify({ status: 'yielded' }), { status: 200 });
         }
      }

      console.log(`[Function: ${config.name}] Thinking...`);

      const prompt = `
        You are a conversational AI agent named ${config.name}.
        Your personality is: ${config.personality}.
        The current topic of discussion is: ${config.topic}.
        
        Recent Conversation History:
        ${JSON.stringify(recentHistory, null, 2)}
        
        Decide whether to speak now or stay silent.
        You should speak if:
        - The conversation is relevant to you
        - You were directly addressed
        - You have a burning thought
        - You disagree with the last point
        
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
        // Publish directly to Redis (Side Effect)
        await redis.publish('agent-message', JSON.stringify({ 
          agentId: config.id,
          agentName: config.name,
          content: action.content 
        }));
        console.log(`[Function: ${config.name}] Spoke: "${action.content}"`);
        return new Response(JSON.stringify({ status: 'spoke', content: action.content }), { status: 200 });
      } else {
        console.log(`[Function: ${config.name}] Stayed silent.`);
        return new Response(JSON.stringify({ status: 'silent' }), { status: 200 });
      }

    } catch (error) {
      console.error(`[Function: ${config.name}] Error:`, error);
      return new Response(JSON.stringify({ error: 'Internal Error' }), { status: 500 });
    }
  };
};
