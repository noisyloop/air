import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { config, isTest } from './config.js';
import { AppError } from './shared/errors.js';
import authPlugin from './plugins/auth.js';
import securityPlugin from './plugins/security.js';
import { startWsBridge } from './shared/ws.js';

import authRoutes from './modules/auth/routes.js';
import userRoutes from './modules/users/routes.js';
import artistRoutes from './modules/artists/routes.js';
import albumRoutes from './modules/albums/routes.js';
import trackRoutes from './modules/tracks/routes.js';
import playlistRoutes from './modules/playlists/routes.js';
import favoriteRoutes from './modules/favorites/routes.js';
import historyRoutes from './modules/history/routes.js';
import searchRoutes from './modules/search/routes.js';
import uploadRoutes from './modules/uploads/routes.js';
import streamingRoutes from './modules/streaming/routes.js';
import analyticsRoutes from './modules/analytics/routes.js';
import recommendationRoutes from './modules/recommendations/routes.js';
import notificationRoutes from './modules/notifications/routes.js';
import adminRoutes from './modules/admin/routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: isTest ? false : { level: config.LOG_LEVEL },
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
  });

  await app.register(authPlugin);
  await app.register(securityPlugin);
  await app.register(websocket);

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ statusCode: err.statusCode, code: err.code, message: err.message });
    }
    // Fastify-generated errors (body parse, 404 handler passthrough, rate limit)
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    return reply.status(status).send({
      statusCode: status,
      code: status >= 500 ? 'INTERNAL' : 'REQUEST_ERROR',
      message: status >= 500 ? 'Internal server error' : err.message,
    });
  });

  app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(userRoutes);
  await app.register(artistRoutes, { prefix: '/artists' });
  await app.register(albumRoutes, { prefix: '/albums' });
  await app.register(trackRoutes); // registers /tracks and /genres
  await app.register(playlistRoutes, { prefix: '/playlists' });
  await app.register(favoriteRoutes, { prefix: '/favorites' });
  await app.register(historyRoutes, { prefix: '/history' });
  await app.register(searchRoutes, { prefix: '/search' });
  await app.register(uploadRoutes, { prefix: '/uploads' });
  await app.register(streamingRoutes);
  await app.register(analyticsRoutes, { prefix: '/analytics' });
  await app.register(recommendationRoutes, { prefix: '/recommendations' });
  await app.register(notificationRoutes, { prefix: '/notifications' });
  await app.register(adminRoutes, { prefix: '/admin' });

  if (!isTest) startWsBridge();
  return app;
}
