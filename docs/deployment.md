# air — Deployment guide

## Container images

Two Dockerfiles produce three services:

| Image | Build | Runs |
| --- | --- | --- |
| API + worker | `docker build -f apps/api/Dockerfile .` | `node dist/server.js` (api) / `node dist/worker/index.js` (worker) — same image, different command. ffmpeg is baked in for the pipeline. |
| Web | `docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=https://api.example.com --build-arg VITE_WS_URL=wss://api.example.com/ws .` | nginx serving the static SPA with an SPA fallback. |

Full local stack: `docker compose --profile full up --build`.

## Production topology

```
                    ┌────────────┐
   users ── HTTPS ──┤ LB / CDN   ├──► web (nginx, static)
                    │ (TLS term) ├──► api ×N (stateless)
                    └────────────┘        │
                                          ├── PostgreSQL (managed / HA)
                                          ├── Redis (cache, queues, rate limits, pub/sub)
                                          ├── S3 / MinIO (audio, art, uploads buckets)
                                          └── Meilisearch
                                   worker ×M (same image; scale by queue depth)
```

- **API replicas are stateless** — JWTs carry identity, WebSocket fan-out crosses
  instances via Redis pub/sub, and rate limits live in Redis. Scale horizontally behind
  any HTTP/WS-capable load balancer.
- **Worker** scales independently; audio transcoding is CPU-bound (`concurrency: 2` per
  process by default).
- **Storage**: keep the three buckets (`air-audio`, `air-art`, `air-uploads`). `air-art`
  is public-read; the other two are private and only reached via presigned URLs / the
  stream proxy. For heavy traffic, front `air-art` (and optionally the stream endpoint)
  with a CDN.

## Checklist

1. **Secrets** — set strong `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, DB/Redis/MinIO/
   Meili credentials. Never ship the `.env.example` defaults.
2. **Cookies/TLS** — `COOKIE_SECURE=true`, `COOKIE_DOMAIN=your-domain`, serve everything
   over HTTPS/WSS, set `WEB_ORIGIN` to the exact SPA origin (CORS allow-list).
3. **Migrations** — run `npx prisma migrate deploy` as a release step before rollout.
4. **Seed roles** — on a fresh database run the seed once (or insert roles/permissions
   manually); registration needs the `listener` role to exist.
5. **Buckets** — create the three buckets and set `air-art` to public-read
   (see `minio-init` in docker-compose for the `mc` commands).
6. **Search** — `POST /admin/reindex` after first deploy; the weekly scheduler keeps it fresh.
7. **Rollups** — the worker schedules nightly analytics at 03:10 UTC; backfill with
   `POST /admin/rollup {day}` per day if you import history.
8. **Health** — LB health check on `GET /health`; deeper diagnostics at `GET /admin/health`.
9. **Backups** — Postgres (catalog + users) and the audio bucket are the state that matters;
   Redis and Meilisearch are rebuildable caches/indexes.
10. **Logs/metrics** — Fastify logs JSON to stdout; ship to your aggregator. Queue depths
    are exposed via `/admin/health`.

## Zero-downtime notes

- Prisma migrations here are additive; for destructive changes use expand/contract.
- Rolling API restarts are safe (stateless); the SPA reconnects WS with backoff and
  resumes playback from `GET /history/resume`.
- BullMQ jobs are idempotent-ish: audio processing re-checks job status, indexing is
  upsert-based; failed jobs retry 3× with exponential backoff.
