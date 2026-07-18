/**
 * air worker — consumes BullMQ queues for audio processing, search indexing,
 * notification fan-out, and analytics rollups. Shares the API codebase and is
 * deployed as a separate container.
 */
import { Worker } from 'bullmq';
import { QUEUE_NAMES, queueConnection, rollupQueue, indexQueue } from '../shared/queue.js';
import type { AudioJobData, IndexJobData, NotifyJobData, RollupJobData } from '../shared/queue.js';
import { configureIndexes } from '../shared/meili.js';
import { processAudioJob } from './processors/audio.js';
import { processIndexJob } from './processors/index-search.js';
import { processNotifyJob } from './processors/notify.js';
import { processRollupJob } from './processors/rollup.js';

const log = (msg: string, extra?: unknown) =>
  console.log(`[worker] ${new Date().toISOString()} ${msg}`, extra ?? '');

await configureIndexes().catch((e) => log('meilisearch not ready (will retry on demand):', e.message));

const workers = [
  new Worker<AudioJobData>(QUEUE_NAMES.audio, (job) => processAudioJob(job.data), {
    connection: queueConnection,
    concurrency: 2, // transcoding is CPU-bound
  }),
  new Worker<IndexJobData>(QUEUE_NAMES.index, (job) => processIndexJob(job.data), {
    connection: queueConnection,
    concurrency: 8,
  }),
  new Worker<NotifyJobData>(QUEUE_NAMES.notify, (job) => processNotifyJob(job.data), {
    connection: queueConnection,
    concurrency: 8,
  }),
  new Worker<RollupJobData>(QUEUE_NAMES.rollup, (job) => processRollupJob(job.data), {
    connection: queueConnection,
    concurrency: 1,
  }),
];

for (const w of workers) {
  w.on('completed', (job) => log(`${w.name}:${job.name} #${job.id} completed`));
  w.on('failed', (job, err) => log(`${w.name}:${job?.name} #${job?.id} FAILED: ${err.message}`));
}

// Nightly rollup at 03:10 UTC + full reindex weekly.
await rollupQueue.upsertJobScheduler('nightly-rollup', { pattern: '10 3 * * *' }, { name: 'rollup', data: {} });
await indexQueue.upsertJobScheduler(
  'weekly-reindex',
  { pattern: '30 4 * * 1' },
  { name: 'all', data: { entity: 'all' } },
);

log(`listening on queues: ${workers.map((w) => w.name).join(', ')}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    log(`received ${signal}, closing`);
    await Promise.all(workers.map((w) => w.close()));
    process.exit(0);
  });
}
