# air — REST API reference

Base URL: `http://localhost:4000` (dev). All bodies are JSON. Errors share one shape:

```json
{ "statusCode": 401, "code": "TOKEN_INVALID", "message": "Invalid or expired access token" }
```

**Auth headers:** `Authorization: Bearer <accessToken>` for users, or `X-Api-Key: air_k1_…`
for server-to-server keys. The refresh token travels only in the `air_refresh` HttpOnly
cookie. `POST /auth/refresh` additionally requires `X-Air-Client: web` (CSRF guard).

**Pagination:** list endpoints accept `page` (≥1) and `limit` (1–100) and return
`{ items, page, limit, total, totalPages }`.

**Rate limits:** 300 req/min per user/IP globally (Redis-backed); tighter on
`/auth/login` (15/min), `/auth/register` (10/min), `/auth/refresh` (60/min).

Legend: 🔓 public · 🔑 authenticated · 🎫 permission required.

## Auth

| Method & path | Auth | Description |
| --- | --- | --- |
| `POST /auth/register` | 🔓 | `{email, password(≥8), displayName}` → `201 {accessToken, user}` + refresh cookie. New users get the `listener` role. `409 EMAIL_TAKEN` on duplicates. |
| `POST /auth/login` | 🔓 | `{email, password}` → `{accessToken, user}` + refresh cookie. `401 BAD_CREDENTIALS`. |
| `POST /auth/refresh` | cookie + `X-Air-Client` | Rotates the refresh token, returns a fresh `{accessToken, user}`. Reusing a rotated token revokes the whole session family (`401 REFRESH_REUSED`). |
| `POST /auth/logout` | cookie | Revokes the session family, clears the cookie. |
| `GET /auth/sessions` | 🔑 | Active sessions `{id, ip, userAgent, createdAt, expiresAt}`. |
| `DELETE /auth/sessions/:id` | 🔑 | Revoke one session. |

## Users & profile

| Method & path | Auth | Description |
| --- | --- | --- |
| `GET /me` | 🔑 | Full own profile incl. roles, permissions, artist profile, counts. |
| `PATCH /me` | 🔑 | Update `displayName`, `bio`, `avatarKey`. |
| `GET /users/:id` | 🔓 | Public profile with public playlists; `isFollowing` when authenticated. |
| `POST /users/:id/follow` | 🎫 `social:write` | Toggle follow → `{following}`. Notifies the target. |
| `GET /me/api-keys` | 🔑 | List API keys (prefix only, never the secret). |
| `POST /me/api-keys` | 🔑 | `{name, scopes[], expiresInDays?}` → `201 {id, secret}`. Secret shown once; scopes are capped to the caller's own permissions. |
| `DELETE /me/api-keys/:id` | 🔑 | Revoke a key. |

## Catalog

| Method & path | Auth | Description |
| --- | --- | --- |
| `GET /tracks` | 🔓 | Browse. Filters: `genre` (slug), `artistId`, `sort=popular\|newest`. |
| `GET /tracks/:id` | 🔓* | Track detail (id or slug): credits, lyrics, loudness, favorite count, available `qualities`, presigned `waveformUrl`. `liked` when authenticated. |
| `POST /tracks/:id/stream-token` | 🎫 `stream:audio` | Short-lived token (15 min) authorizing `GET /stream/:id`. |
| `GET /genres` | 🔓 | All genres with track/album/artist counts. |
| `GET /albums` | 🔓 | Browse. Filters: `genre`, `type=ALBUM\|SINGLE\|EP\|COMPILATION`, `sort=newest\|popular`. |
| `GET /albums/:id` | 🔓* | Album page (id or slug): all art sizes, ordered tracklist (with per-track `liked`), credits, total duration, popularity, `isLiked`. |
| `GET /artists` | 🔓 | Browse by `genre`, ordered by monthly listeners. |
| `GET /artists/:id` | 🔓* | Artist page (id or slug): bio, albums, singles/EPs, top-10 popular tracks, follower count, monthly listeners, `isFollowing`/`isLiked`. |
| `GET /artists/:id/related` | 🔓 | Genre-overlap related artists. |
| `GET /artists/:id/followers` | 🔓 | Paginated follower profiles. |
| `POST /artists/:id/follow` | 🎫 `social:write` | Toggle follow. |

\* Optional auth: extra fields appear for logged-in callers.

## Playlists & library

| Method & path | Auth | Description |
| --- | --- | --- |
| `GET /playlists` | 🔑 | Caller's library: own + collaborative playlists (with `pinned`), plus folders. |
| `POST /playlists` | 🎫 `playlist:write` | `{title, description?, isPublic?, isCollaborative?, coverKey?}` → `201`. |
| `GET /playlists/:id` | 🔓* | Playlist detail (accepts id **or shareId**). Private playlists 404 for outsiders. Includes `canEdit`, `canAddTracks`, per-track `liked`, `addedBy`. |
| `PUT /playlists/:id` | owner | Update metadata / visibility / collaborative flag. |
| `DELETE /playlists/:id` | owner | Delete. |
| `POST /playlists/:id/tracks` | owner/collab | `{trackIds[]}` append (deduplicated) → `{added}`. Notifies the owner on collaborator adds. |
| `DELETE /playlists/:id/tracks/:trackId` | owner/collab | Remove a track. |
| `PUT /playlists/:id/tracks` | owner/collab | `{trackIds[]}` full reorder. |
| `POST /playlists/:id/collaborators` | owner | `{userId}` invite (notifies invitee). |
| `DELETE /playlists/:id/collaborators/:userId` | owner | Remove collaborator. |
| `POST /playlists/:id/pin` | 🔑 | Toggle pin in the caller's sidebar. |
| `GET /playlists/:id/share` | owner | `{shareId, url}` public link. |
| `POST /playlists/folders` | 🔑 | Create a library folder. |
| `DELETE /playlists/folders/:id` | 🔑 | Delete a folder (playlists survive). |
| `PUT /playlists/folders/:id/items` | 🔑 | `{playlistIds[]}` set folder contents/order. |

## Favorites

| Method & path | Auth | Description |
| --- | --- | --- |
| `POST /favorites` | 🎫 `social:write` | `{type: TRACK\|ALBUM\|ARTIST\|PLAYLIST, id}` toggle → `{liked}`. |
| `GET /favorites?type=…` | 🔑 | Paginated liked items of one type, newest first, fully hydrated. |

## History & playback state

| Method & path | Auth | Description |
| --- | --- | --- |
| `POST /history` | 🔑 | Record a play: `{trackId, msPlayed, completed, source, contextId?}`. Plays ≥30s (or completed) increment the public play counter. |
| `GET /history` | 🔑 | Recently played, deduplicated by track. |
| `POST /history/progress` | 🔑 | Heartbeat: `{trackId, positionMs, queue?, sessionId?, deltaMs?}` — powers resume + session duration analytics. |
| `GET /history/resume` | 🔑 | Last track, position, and queue for resume-after-reconnect. |
| `POST /history/sessions` | 🔑 | Open a listening session → `{sessionId}` (device analytics + bandwidth accounting). |
| `POST /history/sessions/:id/end` | 🔑 | Close a session. |

## Search

| Method & path | Auth | Description |
| --- | --- | --- |
| `GET /search?q=&type=&limit=` | 🔓* | Federated typo-tolerant search across tracks/albums/artists/public playlists/genres. Logs the query for trending & analytics. |
| `GET /search/suggest?q=` | 🔓 | Fast autocomplete (top artists/tracks/albums). |
| `GET /search/recent` | 🔑 | Caller's last 10 queries. `DELETE` clears. |
| `GET /search/trending` | 🔓 | Top queries (daily decayed). |

## Uploads

| Method & path | Auth | Description |
| --- | --- | --- |
| `POST /uploads` | 🎫 `track:upload` | `{artistId, filename, mimeType, sizeBytes, metadata{title, albumTitle, albumType?, trackNumber?, genres?, explicit?, releaseDate?, rightsAttestation: true}}` → `201 {uploadJobId, signedUrl}`. Artists may only upload for their own profile; the rights attestation is mandatory. Max 200 MB; WAV/FLAC/MP3/AAC/OGG. |
| _client `PUT <signedUrl>`_ | — | Upload the file directly to object storage. |
| `POST /uploads/:id/complete` | 🎫 `track:upload` | Verifies the object landed, enqueues async processing. |
| `GET /uploads` | 🎫 `track:upload` | Caller's jobs with status: `PENDING → UPLOADED → PROCESSING → AWAITING_APPROVAL\|READY\|FAILED\|REJECTED`. |
| `GET /uploads/:id` | owner/admin | Single job detail. |

## Streaming & realtime

| Method & path | Auth | Description |
| --- | --- | --- |
| `GET /stream/:trackId?token=&quality=&session=` | stream token | Byte-range audio proxy. Honors `Range` (`206 Partial Content`, `Accept-Ranges`, `Content-Range`) for seeking/progressive playback. `quality=low\|med\|high\|auto` picks an encode (`X-Air-Quality` response header names it). `session` attributes bandwidth to a listening session. Also accepts `Authorization: Bearer`. |
| `GET /ws?token=<accessToken>` | 🔑 | WebSocket. Server pushes `{kind: "notification", notification}`; client may send `ping`. |

## Recommendations

| Method & path | Auth | Description |
| --- | --- | --- |
| `GET /recommendations?limit=` | 🔑 | Ranked "Made for you" tracks (collaborative + genre + recency + popularity + freshness scorers; cached 10 min). |
| `GET /recommendations/home` | 🔓* | Sectioned home feed: made-for-you, new releases, popular, because-you-listened-to. |
| `GET /recommendations/radio/:trackId` | 🔑 | ~20-track radio queue seeded from a track. |

## Notifications

| Method & path | Auth | Description |
| --- | --- | --- |
| `GET /notifications?unread=` | 🔑 | Paginated + `unreadCount`. |
| `POST /notifications/read` | 🔑 | `{ids?}` mark some or all read. |
| `DELETE /notifications/:id` | 🔑 | Dismiss. |

## Analytics

| Method & path | Auth | Description |
| --- | --- | --- |
| `GET /analytics/top-tracks?days=` | 🔓 | Public chart (plays in window). |
| `GET /analytics/top-artists?days=` | 🔓 | Public chart. |
| `GET /analytics/overview?days=` | 🎫 `admin:analytics` | Totals, plays, unique/daily listeners, sessions & average duration, bandwidth, searches, retention rate, uploads by status, daily rollup series. |
| `GET /analytics/top-searches?days=` | 🎫 `admin:analytics` | Most searched terms. |

## Admin

All under `🎫` admin permissions; every mutation is audit-logged.

| Method & path | Permission | Description |
| --- | --- | --- |
| `GET /admin/users?search=` | `admin:users` | Paginated user management view. |
| `PATCH /admin/users/:id` | `admin:users` | `{isActive?, roles?}` suspend/reactivate (revokes sessions) or reassign roles. Self-suspension is blocked. |
| `POST /admin/artists` / `PATCH /admin/artists/:id` | `admin:users` | Create/update artist profiles, link owner accounts, verify. |
| `GET /admin/uploads?status=` | `admin:uploads` | Moderation queue. |
| `POST /admin/uploads/:id/review` | `admin:uploads` | `{approve, reason?}` — approve publishes the track, indexes it, and notifies followers; reject notifies the uploader. |
| `PATCH /admin/tracks/:id` | `admin:uploads` | Moderate metadata (title, explicit, lyrics, credits). |
| `DELETE /admin/tracks/:id` | `admin:system` | Remove a track (cascades, deindexes). |
| `GET /admin/health` | `admin:system` | Postgres/Redis/Meilisearch/storage checks + queue depths. |
| `GET /admin/storage` | `admin:system` | Object counts and bytes for originals, variants, uploads. |
| `GET /admin/audit-logs?action=&actorId=` | `admin:audit` | Paginated audit trail. |
| `POST /admin/announcements` | `admin:system` | Broadcast a system notification to all users (queued). |
| `POST /admin/reindex` | `admin:system` | Rebuild all Meilisearch indexes (queued). |
| `POST /admin/rollup` | `admin:system` | `{day?}` run an analytics rollup (queued). |

## GraphQL (optional)

Not enabled in this build. The module layout supports adding a `graphql/` module with
[mercurius](https://mercurius.dev) resolvers delegating to the same service functions —
the REST services are transport-independent by design.
