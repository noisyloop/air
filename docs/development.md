# air — Local development guide

## Prerequisites

- Node.js ≥ 20 (22 recommended) and npm ≥ 10
- Docker + Docker Compose (for Postgres, Redis, MinIO, Meilisearch)
- `ffmpeg` on your PATH if you want full audio processing outside Docker
  (the worker degrades gracefully without it — originals are served unencoded)

## First run

```bash
cp .env.example .env          # defaults work out of the box
docker compose up -d postgres redis minio meilisearch
npm install
npm run db:migrate            # prisma migrate deploy
npm run db:seed               # demo users + faker catalog + placeholder audio
```

Start the three dev processes (separate terminals):

```bash
npm run dev:api               # Fastify with tsx watch → http://localhost:4000
npm run dev:worker            # BullMQ consumers (audio/index/notify/rollup)
npm run dev:web               # Vite → http://localhost:5173 (proxies /api and /ws)
```

Build the search index once the worker is up: log in as `admin@air.local` and
`POST /admin/reindex`, or simply wait for the weekly scheduler.

**Demo accounts** (password `password123`): `admin@air.local`, `artist@air.local`
(owns the "Nova Waves" artist profile — can upload), `listener@air.local`.

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run typecheck` | TypeScript across all workspaces |
| `npm test` | Vitest unit tests (API + web) |
| `AIR_TEST_DB=postgresql://air:air_dev_password@localhost:5432/air npm test -w @air/api` | + live API integration tests |
| `npx playwright test` (in `apps/web`) | E2E against a running dev stack |
| `npm run build` | Production builds (API `tsc`, web `vite build`) |
| `npm run db:migrate:dev -w @air/api` | Create a new migration after schema edits |
| `SEED_SCALE=3 npm run db:seed` | Bigger mock dataset |
| `npm run format` | Prettier |

## Working on the upload pipeline locally

1. Log in as `artist@air.local`, open **Upload**, pick any audio file you have rights to.
2. The browser PUTs to MinIO via a signed URL; `POST /uploads/:id/complete` enqueues the job.
3. Watch the worker terminal: probe → loudness → waveform → 4 encodes → art thumbs.
4. The upload lands in **AWAITING_APPROVAL**; approve it from the admin Dashboard → Uploads.

MinIO console: http://localhost:9001 (`air-minio` / `air_minio_secret`).
Meilisearch: http://localhost:7700 (key `air_meili_master_key`).

## Conventions

- Modules own their routes (`src/modules/<name>/routes.ts`); shared infrastructure lives
  in `src/shared`. Services stay transport-independent — no `req`/`reply` beyond routes.
- Validation with zod at every boundary (`parse(schema, input)` throws a 400).
- Anything privileged calls `audit(...)`.
- Long-running work goes on a queue, never in a request handler.
- Frontend server-data goes through `useFetch`/`api`; client state lives in Zustand stores.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `roles not initialized` on register | Run `npm run db:seed` (creates roles/permissions). |
| Search returns nothing | Worker not running or index empty → `POST /admin/reindex`. |
| Uploads stuck in `UPLOADED` | Worker not running; start `npm run dev:worker`. |
| No audio on seeded tracks | MinIO wasn't up during seed → re-run `npm run db:seed`. |
| 429 responses in dev | Redis-backed rate limit; back off or raise `RATE_LIMIT_MAX`. |
