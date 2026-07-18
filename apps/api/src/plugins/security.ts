import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { Redis } from 'ioredis';
import { config, isTest } from '../config.js';

/** CORS, security headers/CSP, cookies, and Redis-backed rate limiting. */
export default fp(async function securityPlugin(app: FastifyInstance) {
  await app.register(cors, {
    origin: [config.WEB_ORIGIN],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Key', 'X-Air-Client'],
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', config.S3_PUBLIC_URL],
        mediaSrc: ["'self'", config.S3_PUBLIC_URL],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // artwork/audio consumed by SPA origin
  });

  await app.register(cookie);

  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    // Dedicated connection: @fastify/rate-limit requires enableAutoPipelining off.
    redis: isTest ? undefined : new Redis(config.REDIS_URL, { connectTimeout: 500, maxRetriesPerRequest: 1 }),
    keyGenerator: (req) => (req.auth?.sub ? `u:${req.auth.sub}` : `ip:${req.ip}`),
    errorResponseBuilder: () => ({
      statusCode: 429,
      code: 'RATE_LIMITED',
      message: 'Too many requests, slow down.',
    }),
  });
});
