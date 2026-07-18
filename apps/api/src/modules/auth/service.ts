import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { prisma } from '../../shared/prisma.js';
import { config } from '../../config.js';
import { generateRefreshToken, hashToken, signAccessToken } from '../../shared/tokens.js';
import { badRequest, conflict, unauthorized } from '../../shared/errors.js';
import type { AccessTokenPayload, PermissionKey } from '../../shared/rbac.js';

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  permissions: PermissionKey[];
}

async function loadPayload(userId: string): Promise<{ payload: AccessTokenPayload; user: PublicUser }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
  });
  if (!user || !user.isActive) throw unauthorized('Account unavailable');
  const roles = user.roles.map((r) => r.role.name);
  const perms = [
    ...new Set(user.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.key as PermissionKey))),
  ];
  return {
    payload: { sub: user.id, roles, perms },
    user: { id: user.id, email: user.email, displayName: user.displayName, roles, permissions: perms },
  };
}

async function createSession(
  userId: string,
  meta: { ip?: string; userAgent?: string },
  family = nanoid(),
): Promise<string> {
  const { token, hash } = generateRefreshToken();
  await prisma.authSession.create({
    data: {
      userId,
      tokenHash: hash,
      family,
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 255),
      expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    },
  });
  return token;
}

export async function register(
  input: { email: string; password: string; displayName: string },
  meta: { ip?: string; userAgent?: string },
): Promise<AuthResult> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw conflict('An account with this email already exists', 'EMAIL_TAKEN');
  const listenerRole = await prisma.role.findUnique({ where: { name: 'listener' } });
  if (!listenerRole) throw badRequest('System roles not initialized — run the database seed');

  const user = await prisma.user.create({
    data: {
      email: input.email,
      displayName: input.displayName,
      passwordHash: await argon2.hash(input.password),
      roles: { create: [{ roleId: listenerRole.id }] },
    },
  });
  const { payload, user: publicUser } = await loadPayload(user.id);
  return {
    accessToken: signAccessToken(payload),
    refreshToken: await createSession(user.id, meta),
    user: publicUser,
  };
}

export async function login(
  input: { email: string; password: string },
  meta: { ip?: string; userAgent?: string },
): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Constant-shape failure: hash-verify against a dummy when the user is missing.
  const dummyHash = '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const ok = await argon2.verify(user?.passwordHash ?? dummyHash, input.password).catch(() => false);
  if (!user || !ok || !user.isActive) throw unauthorized('Invalid email or password', 'BAD_CREDENTIALS');

  const { payload, user: publicUser } = await loadPayload(user.id);
  return {
    accessToken: signAccessToken(payload),
    refreshToken: await createSession(user.id, meta),
    user: publicUser,
  };
}

/**
 * Rotate a refresh token. Reuse of an already-rotated token means theft:
 * the entire session family is revoked.
 */
export async function refresh(
  refreshToken: string,
  meta: { ip?: string; userAgent?: string },
): Promise<AuthResult> {
  const session = await prisma.authSession.findUnique({ where: { tokenHash: hashToken(refreshToken) } });
  if (!session) throw unauthorized('Unknown refresh token', 'REFRESH_INVALID');
  if (session.revokedAt || session.rotatedAt) {
    await prisma.authSession.updateMany({
      where: { family: session.family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw unauthorized('Refresh token reuse detected — session revoked', 'REFRESH_REUSED');
  }
  if (session.expiresAt < new Date()) throw unauthorized('Refresh token expired', 'REFRESH_EXPIRED');

  await prisma.authSession.update({ where: { id: session.id }, data: { rotatedAt: new Date() } });
  const { payload, user } = await loadPayload(session.userId);
  return {
    accessToken: signAccessToken(payload),
    refreshToken: await createSession(session.userId, meta, session.family),
    user,
  };
}

export async function logout(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;
  const session = await prisma.authSession.findUnique({ where: { tokenHash: hashToken(refreshToken) } });
  if (session) {
    await prisma.authSession.updateMany({
      where: { family: session.family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

export async function listSessions(userId: string) {
  return prisma.authSession.findMany({
    where: { userId, revokedAt: null, rotatedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, ip: true, userAgent: true, createdAt: true, expiresAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  await prisma.authSession.updateMany({ where: { id: sessionId, userId }, data: { revokedAt: new Date() } });
}
