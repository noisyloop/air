# air — Engineer onboarding

Welcome! This doc gets you productive in under an hour.

## 1. What you're working on

air is a music streaming platform: React SPA → Fastify API → Postgres/Redis/MinIO/
Meilisearch, with an async worker for audio processing, search indexing, notifications,
and analytics. Read [architecture.md](architecture.md) first (10 min) — especially the
auth, upload, and streaming sequence diagrams.

> All audio must be licensed, user-owned, or placeholder content. Uploads require a
> rights attestation and (for non-admins) moderator approval. Don't build or test with
> content you don't have rights to.

## 2. Get it running

Follow [development.md](development.md). Success looks like: log in as
`listener@air.local`, press play on a "Made for you" card, hear a tone, see the player
bar, reload the page, and watch playback state survive.

## 3. Codebase tour (30 min)

Suggested reading order — each file is short:

1. `apps/api/src/app.ts` — how everything is wired.
2. `apps/api/src/plugins/auth.ts` + `modules/auth/service.ts` — identity, RBAC,
   refresh rotation. The threat model lives here.
3. `apps/api/src/modules/streaming/routes.ts` — byte-range proxy; the heart of playback.
4. `apps/api/src/worker/processors/audio.ts` — the upload pipeline end to end.
5. `apps/api/src/modules/recommendations/service.ts` — the scorer pattern; add a scorer
   by appending to `SCORERS`.
6. `apps/web/src/stores/player.ts` — the playback engine every UI surface talks to.
7. `apps/web/src/components/Layout.tsx` + `App.tsx` — shell, routing, guards.

## 4. Mental models

- **Permissions, not roles, gate routes.** Routes declare
  `app.requirePermission('track:upload')`; roles are just permission bundles defined in
  `shared/rbac.ts` and materialized by the seed.
- **The queue is the boundary between "fast" and "slow".** Request handlers never
  transcode, fan out notifications, or reindex — they enqueue.
- **Denormalized fields are worker-owned.** `popularity`, `monthlyListeners`,
  `playCount` (partly) are recomputed by rollups; don't hand-maintain them elsewhere.
- **The SPA owns no secrets.** Access token in memory, refresh in an HttpOnly cookie,
  stream access via short-lived per-track tokens.

## 5. Making your first change

A good starter: add a scorer to the recommendation engine or a new library tab.

1. Branch, code, and add a test beside the existing ones (`apps/api/test`,
   `apps/web/src/**/*.test.ts`).
2. `npm run typecheck && npm test` — integration tests need `AIR_TEST_DB`.
3. If you touched the schema: `npm run db:migrate:dev -w @air/api` and commit the
   generated migration.
4. Update [api.md](api.md) for any endpoint change — it documents *every* endpoint,
   keep it that way.

## 6. Where things live

| I want to… | Look in |
| --- | --- |
| Add an endpoint | `apps/api/src/modules/<module>/routes.ts` (+ api.md) |
| Change the schema | `apps/api/prisma/schema.prisma` (+ migration, erd.md) |
| Touch auth/security | `plugins/auth.ts`, `plugins/security.ts`, `modules/auth/` |
| Add a background job | `shared/queue.ts` + `worker/processors/` |
| Add a page | `apps/web/src/pages` + route in `App.tsx` + sidebar link |
| Change the player | `apps/web/src/stores/player.ts` (all UI reads this store) |
| Tune search | `shared/meili.ts` (settings) + `worker/processors/index-search.ts` |
