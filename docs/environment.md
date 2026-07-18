# air — Environment variables

All configuration is environment-driven and validated at boot (`apps/api/src/config.ts`);
the API exits with a clear error on invalid values. Copy `.env.example` → `.env` for dev.

## API & worker

| Variable | Default (dev) | Description |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development` / `test` / `production`. |
| `API_PORT` / `API_HOST` | `4000` / `0.0.0.0` | Listen address. |
| `WEB_ORIGIN` | `http://localhost:5173` | Exact SPA origin allowed by CORS (credentialed). |
| `DATABASE_URL` | local postgres | Postgres connection string (Prisma). |
| `REDIS_URL` | `redis://localhost:6379` | Cache, queues, rate limits, pub/sub. |
| `LOG_LEVEL` | `info` | Pino level. |
| `RATE_LIMIT_MAX` | `300` | Global requests/min per user or IP. |

### Auth

| Variable | Default | Description |
| --- | --- | --- |
| `JWT_ACCESS_SECRET` | dev placeholder | **Change in prod** (`openssl rand -hex 32`). Signs access + stream tokens. |
| `JWT_REFRESH_SECRET` | dev placeholder | Reserved for refresh-token signing schemes; keep distinct. |
| `ACCESS_TOKEN_TTL` | `15m` | Access-token lifetime (jsonwebtoken duration string). |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | Refresh session lifetime. |
| `COOKIE_SECURE` | `false` | Set `true` behind HTTPS (required in prod). |
| `COOKIE_DOMAIN` | `localhost` | Cookie domain for the refresh cookie. |
| `SIGNED_URL_TTL` | `900` | Seconds for presigned S3 URLs and stream tokens. |

### Object storage (S3-compatible)

| Variable | Default | Description |
| --- | --- | --- |
| `S3_ENDPOINT` | `http://localhost:9000` | MinIO/S3 endpoint (path-style). |
| `S3_REGION` | `us-east-1` | Region for the SDK. |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | dev creds | Storage credentials. |
| `S3_BUCKET_AUDIO` | `air-audio` | Streamable encodes + waveforms (private). |
| `S3_BUCKET_ART` | `air-art` | Artwork/avatars (public-read). |
| `S3_BUCKET_UPLOADS` | `air-uploads` | Raw uploads awaiting processing (private). |
| `S3_PUBLIC_URL` | `http://localhost:9000` | Base URL browsers use for public art. |

### Search

| Variable | Default | Description |
| --- | --- | --- |
| `MEILI_HOST` | `http://localhost:7700` | Meilisearch URL. |
| `MEILI_MASTER_KEY` | dev key | Meilisearch API key. |

## Frontend (build-time, Vite)

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_API_URL` | `/api` (dev proxy) | API base URL baked into the bundle. |
| `VITE_WS_URL` | derived from host | WebSocket URL (`wss://…/ws` in prod). |

## Compose-only

`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` feed the postgres container and the
composed `DATABASE_URL`.

## Test-only

| Variable | Description |
| --- | --- |
| `AIR_TEST_DB` | Postgres URL enabling API integration tests. |
| `E2E_BASE_URL` | Playwright base URL (default `http://localhost:5173`). |
| `PW_EXECUTABLE_PATH` | Use a system Chromium instead of a downloaded one. |
| `SEED_SCALE` | Multiplier for seed data volume. |
