import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { parse } from '../../shared/validation.js';
import { forbidden, notFound } from '../../shared/errors.js';
import { pageQuerySchema, skipTake, toPage } from '../../shared/pagination.js';
import { serializePlaylist, serializeTrack, trackInclude } from '../../shared/serialize.js';
import { PERMISSIONS } from '../../shared/rbac.js';
import { audit } from '../../shared/audit.js';
import { pushToUser } from '../../shared/ws.js';
import { indexQueue } from '../../shared/queue.js';

const idParam = z.object({ id: z.string() });
const playlistInclude = {
  owner: { select: { id: true, displayName: true } },
  _count: { select: { tracks: true } },
} as const;

const upsertSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  isPublic: z.boolean().optional(),
  isCollaborative: z.boolean().optional(),
  coverKey: z.string().max(300).nullable().optional(),
});

async function loadPlaylist(id: string) {
  const playlist = await prisma.playlist.findFirst({
    where: { OR: [{ id }, { shareId: id }] },
    include: { ...playlistInclude, collaborators: { select: { userId: true } } },
  });
  if (!playlist) throw notFound('Playlist not found');
  return playlist;
}

type Loaded = Awaited<ReturnType<typeof loadPlaylist>>;

function canView(p: Loaded, req: FastifyRequest): boolean {
  return p.isPublic || p.ownerId === req.auth?.sub || p.collaborators.some((c) => c.userId === req.auth?.sub);
}

function assertCanEditTracks(p: Loaded, req: FastifyRequest): void {
  const uid = req.auth?.sub;
  const ok = p.ownerId === uid || (p.isCollaborative && p.collaborators.some((c) => c.userId === uid));
  if (!ok) throw forbidden('You cannot edit this playlist');
}

function assertOwner(p: Loaded, req: FastifyRequest): void {
  if (p.ownerId !== req.auth?.sub) throw forbidden('Only the owner can do this');
}

const scheduleIndex = (id: string, remove = false) =>
  void indexQueue.add('playlist', { entity: 'playlist', id, remove }).catch(() => undefined);

export default async function playlistRoutes(app: FastifyInstance) {
  // GET /playlists — the caller's library (own + collaborating + pinned + folders)
  app.get('/', { preHandler: app.authenticate }, async (req) => {
    const uid = req.auth!.sub;
    const [own, collab, pins, folders] = await Promise.all([
      prisma.playlist.findMany({ where: { ownerId: uid }, include: playlistInclude, orderBy: { updatedAt: 'desc' } }),
      prisma.playlist.findMany({
        where: { collaborators: { some: { userId: uid } } },
        include: playlistInclude,
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.playlistPin.findMany({ where: { userId: uid }, orderBy: { position: 'asc' } }),
      prisma.libraryFolder.findMany({
        where: { userId: uid },
        include: { items: { orderBy: { position: 'asc' }, include: { playlist: { include: playlistInclude } } } },
        orderBy: { position: 'asc' },
      }),
    ]);
    const pinnedIds = new Set(pins.map((p) => p.playlistId));
    return {
      items: [...own, ...collab].map((p) => ({ ...serializePlaylist(p), pinned: pinnedIds.has(p.id) })),
      folders: folders.map((f) => ({
        id: f.id,
        name: f.name,
        playlists: f.items.map((i) => serializePlaylist(i.playlist)),
      })),
    };
  });

  // POST /playlists
  app.post('/', { preHandler: app.requirePermission(PERMISSIONS.playlistWrite) }, async (req, reply) => {
    const body = parse(upsertSchema, req.body);
    const playlist = await prisma.playlist.create({
      data: { ...body, ownerId: req.auth!.sub },
      include: playlistInclude,
    });
    if (playlist.isPublic) scheduleIndex(playlist.id);
    return reply.status(201).send(serializePlaylist(playlist));
  });

  // GET /playlists/:id — accepts id or shareId
  app.get('/:id', { preHandler: app.optionalAuth }, async (req) => {
    const { id } = parse(idParam, req.params);
    const playlist = await loadPlaylist(id);
    if (!canView(playlist, req)) throw notFound('Playlist not found');
    const tracks = await prisma.playlistTrack.findMany({
      where: { playlistId: playlist.id },
      include: { track: { include: trackInclude }, addedBy: { select: { id: true, displayName: true } } },
      orderBy: { position: 'asc' },
    });
    const likedIds = req.auth
      ? new Set(
          (
            await prisma.favorite.findMany({
              where: { userId: req.auth.sub, trackId: { in: tracks.map((t) => t.trackId) } },
              select: { trackId: true },
            })
          ).map((f) => f.trackId),
        )
      : new Set<string | null>();
    return {
      ...serializePlaylist(playlist),
      canEdit: playlist.ownerId === req.auth?.sub,
      canAddTracks:
        playlist.ownerId === req.auth?.sub ||
        (playlist.isCollaborative && playlist.collaborators.some((c) => c.userId === req.auth?.sub)),
      totalDurationMs: tracks.reduce((s, t) => s + t.track.durationMs, 0),
      tracks: tracks.map((t) => ({
        ...serializeTrack({ ...t.track, liked: likedIds.has(t.trackId) }),
        position: t.position,
        addedAt: t.addedAt,
        addedBy: t.addedBy,
      })),
    };
  });

  // PUT /playlists/:id
  app.put('/:id', { preHandler: app.requirePermission(PERMISSIONS.playlistWrite) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(upsertSchema.partial(), req.body);
    const playlist = await loadPlaylist(id);
    assertOwner(playlist, req);
    const updated = await prisma.playlist.update({ where: { id: playlist.id }, data: body, include: playlistInclude });
    scheduleIndex(playlist.id, !updated.isPublic);
    return serializePlaylist(updated);
  });

  // DELETE /playlists/:id
  app.delete('/:id', { preHandler: app.requirePermission(PERMISSIONS.playlistWrite) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const playlist = await loadPlaylist(id);
    assertOwner(playlist, req);
    await prisma.playlist.delete({ where: { id: playlist.id } });
    scheduleIndex(playlist.id, true);
    audit({ actorId: req.auth!.sub, action: 'playlist.delete', targetType: 'Playlist', targetId: playlist.id });
    return { ok: true };
  });

  // POST /playlists/:id/tracks — append tracks
  app.post('/:id/tracks', { preHandler: app.requirePermission(PERMISSIONS.playlistWrite) }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { trackIds } = parse(z.object({ trackIds: z.array(z.string()).min(1).max(100) }), req.body);
    const playlist = await loadPlaylist(id);
    assertCanEditTracks(playlist, req);
    const existing = await prisma.playlistTrack.findMany({
      where: { playlistId: playlist.id },
      select: { trackId: true, position: true },
    });
    const have = new Set(existing.map((e) => e.trackId));
    let pos = existing.reduce((m, e) => Math.max(m, e.position), -1) + 1;
    const fresh = [...new Set(trackIds)].filter((t) => !have.has(t));
    const valid = await prisma.track.findMany({ where: { id: { in: fresh } }, select: { id: true } });
    await prisma.playlistTrack.createMany({
      data: valid.map((t) => ({ playlistId: playlist.id, trackId: t.id, position: pos++, addedById: req.auth!.sub })),
    });
    await prisma.playlist.update({ where: { id: playlist.id }, data: { updatedAt: new Date() } });
    // Notify the owner when a collaborator adds tracks.
    if (playlist.ownerId !== req.auth!.sub && valid.length > 0) {
      const n = await prisma.notification.create({
        data: {
          userId: playlist.ownerId,
          type: 'PLAYLIST_COLLAB',
          title: `${valid.length} track(s) added to "${playlist.title}"`,
          data: { playlistId: playlist.id },
        },
      });
      void pushToUser(playlist.ownerId, { kind: 'notification', notification: n });
    }
    return reply.status(201).send({ added: valid.length });
  });

  // DELETE /playlists/:id/tracks/:trackId
  app.delete('/:id/tracks/:trackId', { preHandler: app.requirePermission(PERMISSIONS.playlistWrite) }, async (req) => {
    const { id, trackId } = parse(z.object({ id: z.string(), trackId: z.string() }), req.params);
    const playlist = await loadPlaylist(id);
    assertCanEditTracks(playlist, req);
    await prisma.playlistTrack.deleteMany({ where: { playlistId: playlist.id, trackId } });
    return { ok: true };
  });

  // PUT /playlists/:id/tracks — full reorder
  app.put('/:id/tracks', { preHandler: app.requirePermission(PERMISSIONS.playlistWrite) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { trackIds } = parse(z.object({ trackIds: z.array(z.string()).max(1000) }), req.body);
    const playlist = await loadPlaylist(id);
    assertCanEditTracks(playlist, req);
    await prisma.$transaction(
      trackIds.map((trackId, position) =>
        prisma.playlistTrack.updateMany({ where: { playlistId: playlist.id, trackId }, data: { position } }),
      ),
    );
    return { ok: true };
  });

  // POST /playlists/:id/collaborators — owner invites a user
  app.post('/:id/collaborators', { preHandler: app.requirePermission(PERMISSIONS.playlistWrite) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { userId } = parse(z.object({ userId: z.string() }), req.body);
    const playlist = await loadPlaylist(id);
    assertOwner(playlist, req);
    const user = await prisma.user.findUnique({ where: { id: userId, isActive: true }, select: { id: true } });
    if (!user) throw notFound('User not found');
    await prisma.playlistCollaborator.upsert({
      where: { playlistId_userId: { playlistId: playlist.id, userId } },
      create: { playlistId: playlist.id, userId },
      update: {},
    });
    const n = await prisma.notification.create({
      data: {
        userId,
        type: 'PLAYLIST_COLLAB',
        title: `You can now collaborate on "${playlist.title}"`,
        data: { playlistId: playlist.id },
      },
    });
    void pushToUser(userId, { kind: 'notification', notification: n });
    return { ok: true };
  });

  app.delete('/:id/collaborators/:userId', { preHandler: app.requirePermission(PERMISSIONS.playlistWrite) }, async (req) => {
    const { id, userId } = parse(z.object({ id: z.string(), userId: z.string() }), req.params);
    const playlist = await loadPlaylist(id);
    assertOwner(playlist, req);
    await prisma.playlistCollaborator.deleteMany({ where: { playlistId: playlist.id, userId } });
    return { ok: true };
  });

  // POST /playlists/:id/pin — toggle pin in the caller's library
  app.post('/:id/pin', { preHandler: app.authenticate }, async (req) => {
    const { id } = parse(idParam, req.params);
    const playlist = await loadPlaylist(id);
    if (!canView(playlist, req)) throw notFound('Playlist not found');
    const key = { userId: req.auth!.sub, playlistId: playlist.id };
    const existing = await prisma.playlistPin.findUnique({ where: { userId_playlistId: key } });
    if (existing) {
      await prisma.playlistPin.delete({ where: { userId_playlistId: key } });
      return { pinned: false };
    }
    await prisma.playlistPin.create({ data: key });
    return { pinned: true };
  });

  // GET /playlists/:id/share — public share link info
  app.get('/:id/share', { preHandler: app.authenticate }, async (req) => {
    const { id } = parse(idParam, req.params);
    const playlist = await loadPlaylist(id);
    assertOwner(playlist, req);
    return { shareId: playlist.shareId, url: `/playlist/${playlist.shareId}` };
  });

  // --- Library folders ---

  app.post('/folders', { preHandler: app.authenticate }, async (req, reply) => {
    const { name } = parse(z.object({ name: z.string().min(1).max(60) }), req.body);
    const folder = await prisma.libraryFolder.create({ data: { userId: req.auth!.sub, name } });
    return reply.status(201).send({ id: folder.id, name: folder.name });
  });

  app.delete('/folders/:id', { preHandler: app.authenticate }, async (req) => {
    const { id } = parse(idParam, req.params);
    await prisma.libraryFolder.deleteMany({ where: { id, userId: req.auth!.sub } });
    return { ok: true };
  });

  app.put('/folders/:id/items', { preHandler: app.authenticate }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { playlistIds } = parse(z.object({ playlistIds: z.array(z.string()).max(200) }), req.body);
    const folder = await prisma.libraryFolder.findFirst({ where: { id, userId: req.auth!.sub } });
    if (!folder) throw notFound('Folder not found');
    await prisma.$transaction([
      prisma.libraryFolderItem.deleteMany({ where: { folderId: id } }),
      prisma.libraryFolderItem.createMany({
        data: playlistIds.map((playlistId, position) => ({ folderId: id, playlistId, position })),
        skipDuplicates: true,
      }),
    ]);
    return { ok: true };
  });
}
