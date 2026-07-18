import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import type { AccessTokenPayload } from './rbac.js';
import { unauthorized } from './errors.js';

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, config.JWT_ACCESS_SECRET, {
    expiresIn: config.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
    issuer: 'air',
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, config.JWT_ACCESS_SECRET, { issuer: 'air' }) as AccessTokenPayload;
  } catch {
    throw unauthorized('Invalid or expired access token', 'TOKEN_INVALID');
  }
}

/** Opaque refresh token + SHA-256 hash for at-rest storage. */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Short-lived signed stream token — authorizes GET /stream/:trackId without
 * putting the long-lived access token in a URL.
 */
export function signStreamToken(userId: string, trackId: string): string {
  return jwt.sign({ sub: userId, trackId, kind: 'stream' }, config.JWT_ACCESS_SECRET, {
    expiresIn: config.SIGNED_URL_TTL,
    issuer: 'air',
  });
}

export function verifyStreamToken(token: string, trackId: string): { userId: string } {
  try {
    const p = jwt.verify(token, config.JWT_ACCESS_SECRET, { issuer: 'air' }) as jwt.JwtPayload;
    if (p.kind !== 'stream' || p.trackId !== trackId) throw new Error('mismatch');
    return { userId: String(p.sub) };
  } catch {
    throw unauthorized('Invalid stream token', 'STREAM_TOKEN_INVALID');
  }
}
