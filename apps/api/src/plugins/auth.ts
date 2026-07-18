import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { hasPermission, type AccessTokenPayload, type PermissionKey } from '../shared/rbac.js';
import { verifyAccessToken, hashToken } from '../shared/tokens.js';
import { forbidden, unauthorized } from '../shared/errors.js';
import { prisma } from '../shared/prisma.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AccessTokenPayload;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    optionalAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (perm: PermissionKey) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

async function resolveAuth(req: FastifyRequest): Promise<AccessTokenPayload | undefined> {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    return verifyAccessToken(header.slice(7));
  }
  // Server-to-server API keys: `X-Api-Key: air_k1_<secret>`
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.length > 10) {
    const row = await prisma.apiKey.findUnique({ where: { keyHash: hashToken(apiKey) } });
    if (!row || row.revokedAt || (row.expiresAt && row.expiresAt < new Date())) return undefined;
    void prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    return { sub: row.userId, roles: ['api-key'], perms: row.scopes as PermissionKey[] };
  }
  return undefined;
}

export default fp(async function authPlugin(app: FastifyInstance) {
  app.decorate('authenticate', async (req: FastifyRequest) => {
    const auth = await resolveAuth(req);
    if (!auth) throw unauthorized();
    req.auth = auth;
  });

  app.decorate('optionalAuth', async (req: FastifyRequest) => {
    try {
      req.auth = await resolveAuth(req);
    } catch {
      req.auth = undefined;
    }
  });

  app.decorate('requirePermission', (perm: PermissionKey) => {
    return async (req: FastifyRequest) => {
      const auth = await resolveAuth(req);
      if (!auth) throw unauthorized();
      req.auth = auth;
      if (!hasPermission(auth, perm)) throw forbidden(`Missing permission: ${perm}`);
    };
  });
});
