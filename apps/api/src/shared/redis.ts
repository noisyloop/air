import { Redis } from 'ioredis';
import { config } from '../config.js';

function createClient(): Redis {
  return new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: false,
  });
}

/** General-purpose client (cache, counters, rate limits). */
export const redis = createClient();
/** Dedicated subscriber connection — a subscribed client cannot issue commands. */
export const redisSub = createClient();

export const CHANNELS = {
  notifications: 'air:notifications', // payload: {userId, notification}
  activity: 'air:activity', // payload: {userId, event}
} as const;
