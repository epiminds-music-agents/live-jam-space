import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis(REDIS_URL);
export const redisSub = new Redis(REDIS_URL);
export const redisPub = new Redis(REDIS_URL);

redis.on('error', (err) => console.error('Redis Client Error', err));
redisSub.on('error', (err) => console.error('Redis Sub Error', err));
redisPub.on('error', (err) => console.error('Redis Pub Error', err));
