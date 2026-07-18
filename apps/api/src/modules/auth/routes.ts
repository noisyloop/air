import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parse } from '../../shared/validation.js';
import { config } from '../../config.js';
import { audit } from '../../shared/audit.js';
import { unauthorized } from '../../shared/errors.js';
import * as auth from './service.js';

const REFRESH_COOKIE = 'air_refresh';

const registerSchema = z.object({
  email: z.string().email().max(254).transform((e) => e.toLowerCase()),
  password: z.string().min(8).max(128),
  displayName: z.string().min(2).max(50),
});
const loginSchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(128),
});

function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    domain: config.COOKIE_DOMAIN,
    path: '/auth',
    maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86_400,
  });
}

function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE, { path: '/auth', domain: config.COOKIE_DOMAIN });
}

const meta = (req: FastifyRequest) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

/** Lightweight CSRF guard: simple cross-site requests cannot set custom headers. */
function requireClientHeader(req: FastifyRequest): void {
  if (req.headers['x-air-client'] !== 'web') {
    throw unauthorized('Missing client header', 'CSRF_SUSPECTED');
  }
}

export default async function authRoutes(app: FastifyInstance) {
  app.post('/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(registerSchema, req.body);
    const result = await auth.register(body, meta(req));
    setRefreshCookie(reply, result.refreshToken);
    audit({ actorId: result.user.id, action: 'auth.register', ip: req.ip });
    return reply.status(201).send({ accessToken: result.accessToken, user: result.user });
  });

  app.post('/login', { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(loginSchema, req.body);
    const result = await auth.login(body, meta(req));
    setRefreshCookie(reply, result.refreshToken);
    audit({ actorId: result.user.id, action: 'auth.login', ip: req.ip });
    return { accessToken: result.accessToken, user: result.user };
  });

  app.post('/refresh', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    requireClientHeader(req);
    const token = req.cookies[REFRESH_COOKIE];
    if (!token) throw unauthorized('No refresh token', 'REFRESH_MISSING');
    try {
      const result = await auth.refresh(token, meta(req));
      setRefreshCookie(reply, result.refreshToken);
      return { accessToken: result.accessToken, user: result.user };
    } catch (err) {
      clearRefreshCookie(reply);
      throw err;
    }
  });

  app.post('/logout', async (req, reply) => {
    await auth.logout(req.cookies[REFRESH_COOKIE]);
    clearRefreshCookie(reply);
    return { ok: true };
  });

  app.get('/sessions', { preHandler: app.authenticate }, async (req) => {
    return { items: await auth.listSessions(req.auth!.sub) };
  });

  app.delete('/sessions/:id', { preHandler: app.authenticate }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    await auth.revokeSession(req.auth!.sub, id);
    audit({ actorId: req.auth!.sub, action: 'auth.session_revoke', targetType: 'AuthSession', targetId: id });
    return { ok: true };
  });
}
