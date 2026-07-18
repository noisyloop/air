import type { NotificationType } from '@prisma/client';
import { prisma } from '../../shared/prisma.js';
import { pushToUser } from '../../shared/ws.js';
import type { NotifyJobData } from '../../shared/queue.js';

async function fanOut(
  userIds: string[],
  type: NotificationType,
  title: string,
  body: string | undefined,
  data: Record<string, unknown>,
): Promise<void> {
  // Batched insert, then realtime push to whoever is online.
  const BATCH = 500;
  for (let i = 0; i < userIds.length; i += BATCH) {
    const slice = userIds.slice(i, i + BATCH);
    await prisma.notification.createMany({
      data: slice.map((userId) => ({ userId, type, title, body, data: data as never })),
    });
    await Promise.all(slice.map((userId) => pushToUser(userId, { kind: 'notification', notification: { type, title, body, data, createdAt: new Date().toISOString() } })));
  }
}

export async function processNotifyJob(job: NotifyJobData): Promise<void> {
  switch (job.kind) {
    case 'new_release': {
      const { trackId, artistId } = job.payload as { trackId: string; artistId: string };
      const [track, followers] = await Promise.all([
        prisma.track.findUnique({ where: { id: trackId }, include: { artist: { select: { name: true } } } }),
        prisma.follow.findMany({ where: { artistId }, select: { followerId: true } }),
      ]);
      if (!track) return;
      await fanOut(
        followers.map((f) => f.followerId),
        'NEW_RELEASE',
        `${track.artist.name} released "${track.title}"`,
        undefined,
        { trackId, artistId },
      );
      break;
    }
    case 'upload_status': {
      const { userId, uploadJobId, status, title } = job.payload as {
        userId: string;
        uploadJobId: string;
        status: string;
        title: string;
      };
      await fanOut(
        [userId],
        'UPLOAD_STATUS',
        status === 'READY'
          ? `"${title}" is live`
          : status === 'AWAITING_APPROVAL'
            ? `"${title}" processed — awaiting approval`
            : `"${title}" processing ${status.toLowerCase()}`,
        undefined,
        { uploadJobId, status },
      );
      break;
    }
    case 'playlist_follow': {
      const { playlistId, ownerId, byUserId } = job.payload as {
        playlistId: string;
        ownerId: string;
        byUserId: string;
      };
      const by = await prisma.user.findUnique({ where: { id: byUserId }, select: { displayName: true } });
      await fanOut([ownerId], 'PLAYLIST_FOLLOW', `${by?.displayName ?? 'Someone'} saved your playlist`, undefined, {
        playlistId,
      });
      break;
    }
    case 'system': {
      const { title, body } = job.payload as { title: string; body?: string };
      const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true } });
      await fanOut(users.map((u) => u.id), 'SYSTEM', title, body, {});
      break;
    }
  }
}
