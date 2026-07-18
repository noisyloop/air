import { describe, expect, it } from 'vitest';
import {
  generateRefreshToken,
  hashToken,
  signAccessToken,
  signStreamToken,
  verifyAccessToken,
  verifyStreamToken,
} from '../../src/shared/tokens.js';
import { AppError } from '../../src/shared/errors.js';

describe('tokens', () => {
  it('round-trips access tokens with roles and permissions', () => {
    const token = signAccessToken({ sub: 'u1', roles: ['listener'], perms: ['track:read'] });
    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe('u1');
    expect(payload.perms).toContain('track:read');
  });

  it('rejects tampered access tokens', () => {
    const token = signAccessToken({ sub: 'u1', roles: [], perms: [] });
    expect(() => verifyAccessToken(token.slice(0, -2) + 'xx')).toThrowError(AppError);
  });

  it('generates unique refresh tokens with stable hashes', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a.token).not.toBe(b.token);
    expect(hashToken(a.token)).toBe(a.hash);
    expect(a.hash).toHaveLength(64);
  });

  it('binds stream tokens to a specific track', () => {
    const token = signStreamToken('u1', 'trackA');
    expect(verifyStreamToken(token, 'trackA').userId).toBe('u1');
    expect(() => verifyStreamToken(token, 'trackB')).toThrowError(AppError);
  });

  it('rejects access tokens used as stream tokens', () => {
    const token = signAccessToken({ sub: 'u1', roles: [], perms: [] });
    expect(() => verifyStreamToken(token, 'trackA')).toThrowError(AppError);
  });
});
