import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { parse } from '../../shared/validation.js';
import { notFound, badRequest } from '../../shared/errors.js';
import { hashToken } from '../../shared/tokens.js';
import { audit } from '../../shared/audit.js';
import { publicArtUrl } from '../../shared/s3.js';
import { PERMISSIONS, type PermissionKey } from '../../shared/rbac.js';
import { pushToUser } from '../../shared/ws.js';

const patchMeSchema = z.object({
  displayName: z.string().min(2).max(50).optional(),
  bio: z.string().max(500).nullable().optional(),
  avatarKey: z.string().max(300).nullable().optional(),
});

export default async function userRoutes(app: FastifyInstance) {
  app.get('/me', { preHandler: app.authenticate }, async (req) => {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.sub },
      select: {
        id: true, email: true, displayName: true, bio: true, avatarKey: true, createdAt: true,
        artistProfile: { select: { id: true, name: true, slug: true } },
        _count: { select: { followers: true, following: true, playlists: true } },
      },
    });
    if (!user) throw notFound('User not found');
    return { ...user, avatarUrl: publicArtUrl(user.avatarKey), roles: req.auth!.roles, permissions: req.auth!.perms };
  });

  app.patch('/me', { preHandler: app.authenticate }, async (req) => {
    const body = parse(patchMeSchema, req.body);
    const user = await prisma.user.update({ where: { id: req.auth!.sub }, data: body });
    audit({ actorId: req.auth!.sub, action: 'user.update_profile' });
    return { id: user.id, displayName: user.displayName, bio: user.bio, avatarUrl: publicArtUrl(user.avatarKey) };
  });

  app.get('/users/:id', { preHandler: app.optionalAuth }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const user = await prisma.user.findUnique({
      where: { id, isActive: true },
      select: {
        id: true, displayName: true, bio: true, avatarKey: true, createdAt: true,
        playlists: {
          where: { isPublic: true },
          select: { id: true, title: true, coverKey: true, _count: { select: { tracks: true } } },
          take: 20,
        },
        _count: { select: { followers: true, following: true } },
      },
    });
    if (!user) throw notFound('User not found');
    const isFollowing = req.auth
      ? !!(await prisma.follow.findFirst({ where: { followerId: req.auth.sub, followedUserId: id } }))
      : false;
    return { ...user, avatarUrl: publicArtUrl(user.avatarKey), isFollowing };
  });

  app.post(
    '/users/:id/follow',
    { preHandler: app.requirePermission(PERMISSIONS.socialWrite) },
    async (req) => {
      const { id } = parse(z.object({ id: z.string() }), req.params);
      if (id === req.auth!.sub) throw badRequest('Cannot follow yourself');
      const target = await prisma.user.findUnique({ where: { id, isActive: true }, select: { id: true } });
      if (!target) throw notFound('User not found');
      const existing = await prisma.follow.findFirst({ where: { followerId: req.auth!.sub, followedUserId: id } });
      if (existing) {
        await prisma.follow.delete({ where: { id: existing.id } });
        return { following: false };
      }
      await prisma.follow.create({ data: { followerId: req.auth!.sub, followedUserId: id } });
      const follower = await prisma.user.findUnique({ where: { id: req.auth!.sub }, select: { displayName: true } });
      const notification = await prisma.notification.create({
        data: {
          userId: id,
          type: 'NEW_FOLLOWER',
          title: `${follower?.displayName ?? 'Someone'} started following you`,
          data: { followerId: req.auth!.sub },
        },
      });
      void pushToUser(id, { kind: 'notification', notification });
      return { following: true };
    },
  );

  // --- API keys (server-to-server access) ---

  app.get('/me/api-keys', { preHandler: app.authenticate }, async (req) => {
    const items = await prisma.apiKey.findMany({
      where: { userId: req.auth!.sub, revokedAt: null },
      select: { id: true, name: true, prefix: true, scopes: true, lastUsedAt: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return { items };
  });

  app.post('/me/api-keys', { preHandler: app.authenticate }, async (req, reply) => {
    const body = parse(
      z.object({
        name: z.string().min(1).max(60),
        scopes: z.array(z.string()).max(20).default([]),
        expiresInDays: z.number().int().min(1).max(365).optional(),
      }),
      req.body,
    );
    // A key can only carry permissions its owner actually holds.
    const scopes = body.scopes.filter((s): s is PermissionKey => (req.auth!.perms as string[]).includes(s));
    const secret = `air_k1_${crypto.randomBytes(24).toString('base64url')}`;
    const key = await prisma.apiKey.create({
      data: {
        userId: req.auth!.sub,
        name: body.name,
        keyHash: hashToken(secret),
        prefix: secret.slice(0, 12),
        scopes,
        expiresAt: body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86_400_000) : null,
      },
    });
    audit({ actorId: req.auth!.sub, action: 'apikey.create', targetType: 'ApiKey', targetId: key.id });
    // The secret is returned exactly once.
    return reply.status(201).send({ id: key.id, name: key.name, secret, scopes });
  });

  app.delete('/me/api-keys/:id', { preHandler: app.authenticate }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    await prisma.apiKey.updateMany({ where: { id, userId: req.auth!.sub }, data: { revokedAt: new Date() } });
    audit({ actorId: req.auth!.sub, action: 'apikey.revoke', targetType: 'ApiKey', targetId: id });
    return { ok: true };
  });
}
