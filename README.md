# air

A full-stack music streaming platform built as a production-grade educational / portfolio
reference. Spotify-inspired UI, real streaming backend, async upload pipeline, search,
recommendations, analytics, and an admin dashboard.

> **Content policy:** air only serves audio the operator has the rights to distribute —
> licensed, user-owned, or placeholder assets. It implements no piracy, DRM circumvention,
> or access to third-party streaming services.

## Stack

| Layer       | Technology                                            |
| ----------- | ----------------------------------------------------- |
| Frontend    | React, TypeScript, Vite, TailwindCSS, Zustand, React Router, Framer Motion |
| Backend     | Node.js, Fastify, TypeScript                          |
| Database    | PostgreSQL + Prisma (migrations included)             |
| Cache/Queue | Redis (+ BullMQ for the worker)                       |
| Storage     | MinIO (S3-compatible), signed URLs                    |
| Search      | Meilisearch (typo-tolerant full text, autocomplete)   |
| Realtime    | WebSockets (notifications, now-playing, activity)     |
| Auth        | JWT access tokens, rotating refresh tokens, Argon2    |

## Repository layout

```
apps/
  api/    Fastify API + background worker (single codebase, two entrypoints)
  web/    React SPA
docs/     Architecture, API reference, ERD, deployment & onboarding guides
```

## Quick start

```bash
cp .env.example .env
docker compose up -d postgres redis minio meilisearch   # infrastructure
npm install
npm run db:migrate                                      # apply Prisma migrations
npm run db:seed                                         # demo data (CC0 placeholder audio)
npm run dev:api                                         # http://localhost:4000
npm run dev:worker                                      # upload/audio pipeline
npm run dev:web                                         # http://localhost:5173
```

Or run everything containerized: `docker compose --profile full up --build`.

Demo accounts after seeding: `admin@air.local` / `listener@air.local` / `artist@air.local`
(password `password123` for all — dev only).

## Documentation

- [Architecture](docs/architecture.md) — services, data flow, diagrams
- [API reference](docs/api.md) — every REST endpoint
- [Database ERD](docs/erd.md)
- [Local development](docs/development.md)
- [Deployment guide](docs/deployment.md)
- [Environment variables](docs/environment.md)
- [Onboarding](docs/onboarding.md)

## License

MIT — see [LICENSE](LICENSE).
