import Redis from 'ioredis';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from backend directory explicitly
dotenv.config({ path: path.join(__dirname, '.env') });

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

console.log(`Connecting to Redis at ${REDIS_URL}...`);

const redisSub = new Redis(REDIS_URL);

redisSub.on('error', (err) => {
    console.error('Redis Connection Error:', err);
});

redisSub.on('connect', () => {
    console.log('Connected to Redis.');
});

// Use pattern subscription to catch all events
redisSub.psubscribe('*', (err, count) => {
    if (err) {
        console.error('Failed to subscribe:', err);
    } else {
        console.log(`Subscribed to ${count} pattern(s). Listening for everything...`);
    }
});

redisSub.on('pmessage', (pattern, channel, message) => {
    console.log(`[Event on ${channel}]`, message);
});
