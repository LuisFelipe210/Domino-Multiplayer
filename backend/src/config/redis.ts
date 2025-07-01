// backend/src/config/redis.ts
import { createClient } from 'redis';

const redisUrl = process.env.REDIS_URL;

// Cliente principal para comandos (GET, SET, etc.)
export const redisClient = createClient({ url: redisUrl });

// Cliente duplicado, dedicado apenas a subscrições (Pub/Sub)
export const subscriber = redisClient.duplicate();

redisClient.on('error', (err) => console.error(`[${process.env.SERVER_ID}] Redis Publisher Client Error`, err));
subscriber.on('error', (err) => console.error(`[${process.env.SERVER_ID}] Redis Subscriber Client Error`, err));
