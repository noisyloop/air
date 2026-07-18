import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { parse } from '../../shared/validation.js';
import { pageQuerySchema, skipTake, toPage } from '../../shared/pagination.js';

export default async function notificationRoutes(app: FastifyInstance) {
  // GET /notifications — newest first, with unread count
  app.get('/', { preHandler: app.authenticate }, async (req) => {
    const q = parse(pageQuerySchema.extend({ unread: z.coerce.boolean().optional() }), req.query);
    const where = { userId: req.auth!.sub, ...(q.unread ? { readAt: null } : {}) };
    const [items, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q.page, q.limit) }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId: req.auth!.sub, readAt: null } }),
    ]);
    return { ...toPage(items, total, q.page, q.limit), unreadCount };
  });

  // POST /notifications/read — mark some or all read
  app.post('/read', { preHandler: app.authenticate }, async (req) => {
    const { ids } = parse(z.object({ ids: z.array(z.string()).max(100).optional() }), req.body ?? {});
    await prisma.notification.updateMany({
      where: { userId: req.auth!.sub, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    });
    return { ok: true };
  });

  app.delete('/:id', { preHandler: app.authenticate }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    await prisma.notification.deleteMany({ where: { id, userId: req.auth!.sub } });
    return { ok: true };
  });
}
