/**
 * API integration tests — exercise real routes via fastify.inject against a
 * live Postgres (and Redis when available). Skipped automatically when
 * AIR_TEST_DB is not set.
 *
 *   AIR_TEST_DB=postgresql://air:air@localhost:5432/air npm test
 *
 * Requires the seed to have been run (roles must exist).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const DB = process.env.AIR_TEST_DB;

describe.skipIf(!DB)('API integration', () => {
  let app: FastifyInstance;
  let accessToken: string;
  let refreshCookie: string;
  const email = `it-${Date.now()}@test.local`;

  beforeAll(async () => {
    process.env.DATABASE_URL = DB!;
    const { buildApp } = await import('../../src/app.js');
    app = await buildApp();
  });

  afterAll(async () => {
    const { prisma } = await import('../../src/shared/prisma.js');
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it('registers a new account and sets a refresh cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'password123', displayName: 'Integration Test' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { accessToken: string; user: { roles: string[] } };
    expect(body.user.roles).toContain('listener');
    accessToken = body.accessToken;
    const setCookie = res.headers['set-cookie'];
    refreshCookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0]!;
    expect(refreshCookie).toMatch(/^air_refresh=/);
  });

  it('rejects duplicate registration', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'password123', displayName: 'Dup' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects bad credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('serves the authenticated profile', async () => {
    const res = await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${accessToken}` } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { email: string }).email).toBe(email);
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie: refreshCookie, 'x-air-client': 'web' },
    });
    expect(first.statusCode).toBe(200);
    // Reusing the OLD cookie must revoke the family.
    const reuse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie: refreshCookie, 'x-air-client': 'web' },
    });
    expect(reuse.statusCode).toBe(401);
    expect((reuse.json() as { code: string }).code).toBe('REFRESH_REUSED');
  });

  it('requires the CSRF client header on refresh', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/refresh', headers: { cookie: refreshCookie } });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { code: string }).code).toBe('CSRF_SUSPECTED');
  });

  it('lists catalog tracks with pagination envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/tracks?limit=5' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[]; total: number; totalPages: number };
    expect(body.items.length).toBeLessThanOrEqual(5);
    expect(body.total).toBeGreaterThan(0);
  });

  it('validates query input', async () => {
    const res = await app.inject({ method: 'GET', url: '/tracks?limit=9999' });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  it('enforces RBAC on admin routes', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('toggles favorites and reflects them in the library', async () => {
    const tracks = (
      (await app.inject({ method: 'GET', url: '/tracks?limit=1' })).json() as { items: { id: string }[] }
    ).items;
    const trackId = tracks[0]!.id;
    const auth = { authorization: `Bearer ${accessToken}` };

    const like = await app.inject({ method: 'POST', url: '/favorites', headers: auth, payload: { type: 'TRACK', id: trackId } });
    expect((like.json() as { liked: boolean }).liked).toBe(true);

    const list = await app.inject({ method: 'GET', url: '/favorites?type=TRACK', headers: auth });
    expect((list.json() as { total: number }).total).toBe(1);

    const unlike = await app.inject({ method: 'POST', url: '/favorites', headers: auth, payload: { type: 'TRACK', id: trackId } });
    expect((unlike.json() as { liked: boolean }).liked).toBe(false);
  });

  it('creates a playlist, adds tracks, and reorders them', async () => {
    const auth = { authorization: `Bearer ${accessToken}` };
    const created = await app.inject({
      method: 'POST',
      url: '/playlists',
      headers: auth,
      payload: { title: 'IT playlist', isPublic: false },
    });
    expect(created.statusCode).toBe(201);
    const playlistId = (created.json() as { id: string }).id;

    const tracks = (
      (await app.inject({ method: 'GET', url: '/tracks?limit=3' })).json() as { items: { id: string }[] }
    ).items.map((t) => t.id);
    const add = await app.inject({
      method: 'POST',
      url: `/playlists/${playlistId}/tracks`,
      headers: auth,
      payload: { trackIds: tracks },
    });
    expect((add.json() as { added: number }).added).toBe(3);

    const reversed = [...tracks].reverse();
    await app.inject({ method: 'PUT', url: `/playlists/${playlistId}/tracks`, headers: auth, payload: { trackIds: reversed } });
    const detail = await app.inject({ method: 'GET', url: `/playlists/${playlistId}`, headers: auth });
    const order = (detail.json() as { tracks: { id: string }[] }).tracks.map((t) => t.id);
    expect(order).toEqual(reversed);

    const del = await app.inject({ method: 'DELETE', url: `/playlists/${playlistId}`, headers: auth });
    expect(del.statusCode).toBe(200);
  });

  it('records history and resumes playback state', async () => {
    const auth = { authorization: `Bearer ${accessToken}` };
    const track = ((await app.inject({ method: 'GET', url: '/tracks?limit=1' })).json() as { items: { id: string }[] })
      .items[0]!;
    await app.inject({
      method: 'POST',
      url: '/history',
      headers: auth,
      payload: { trackId: track.id, msPlayed: 31_000, completed: false, source: 'QUEUE' },
    });
    await app.inject({
      method: 'POST',
      url: '/history/progress',
      headers: auth,
      payload: { trackId: track.id, positionMs: 12_345, queue: { trackIds: [track.id], index: 0 } },
    });
    const resume = await app.inject({ method: 'GET', url: '/history/resume', headers: auth });
    const body = resume.json() as { track: { id: string } | null; positionMs: number };
    expect(body.track?.id).toBe(track.id);
    expect(body.positionMs).toBe(12_345);
  });

  it('issues stream tokens and rejects streaming without one', async () => {
    const auth = { authorization: `Bearer ${accessToken}` };
    const track = ((await app.inject({ method: 'GET', url: '/tracks?limit=1' })).json() as { items: { id: string }[] })
      .items[0]!;
    const tokenRes = await app.inject({ method: 'POST', url: `/tracks/${track.id}/stream-token`, headers: auth });
    expect(tokenRes.statusCode).toBe(200);
    expect((tokenRes.json() as { token: string }).token).toBeTruthy();

    const anon = await app.inject({ method: 'GET', url: `/stream/${track.id}` });
    expect(anon.statusCode).toBe(401);
  });
});
