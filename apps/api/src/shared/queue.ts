import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '../config.js';

/** BullMQ requires maxRetriesPerRequest: null on its connections. */
export const queueConnection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

export const QUEUE_NAMES = {
  audio: 'audio', // process uploaded audio into variants
  index: 'index', // (re)index entities into Meilisearch
  notify: 'notify', // fan out notifications
  rollup: 'rollup', // analytics rollups & popularity recompute
} as const;

export interface AudioJobData {
  uploadJobId: string;
}
export interface IndexJobData {
  entity: 'track' | 'album' | 'artist' | 'playlist' | 'genre' | 'all';
  id?: string;
  remove?: boolean;
}
export interface NotifyJobData {
  kind: 'new_release' | 'playlist_follow' | 'new_follower' | 'upload_status' | 'system';
  payload: Record<string, unknown>;
}
export interface RollupJobData {
  day?: string; // ISO date; defaults to yesterday
}

const opts = { connection: queueConnection };
export const audioQueue = new Queue<AudioJobData>(QUEUE_NAMES.audio, opts);
export const indexQueue = new Queue<IndexJobData>(QUEUE_NAMES.index, opts);
export const notifyQueue = new Queue<NotifyJobData>(QUEUE_NAMES.notify, opts);
export const rollupQueue = new Queue<RollupJobData>(QUEUE_NAMES.rollup, opts);
