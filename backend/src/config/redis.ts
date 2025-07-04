import { createClient } from 'redis';
import { REDIS_URL, SERVER_ID } from './environment'; 

export const redisClient = createClient({ url: REDIS_URL });
export const subscriber = redisClient.duplicate();

redisClient.on('error', (err) => console.error(`[${SERVER_ID}] Redis Publisher Client Error`, err));
subscriber.on('error', (err) => console.error(`[${SERVER_ID}] Redis Subscriber Client Error`, err));