import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AudioVariant } from '@prisma/client';
import { prisma } from '../../shared/prisma.js';
import { parse } from '../../shared/validation.js';
import { notFound, unauthorized } from '../../shared/errors.js';
import { getObjectStream, BUCKETS } from '../../shared/s3.js';
import { verifyStreamToken, verifyAccessToken } from '../../shared/tokens.js';

const CONTENT_TYPES: Record<string, string> = {
  AAC: 'audio/mp4',
  OPUS: 'audio/ogg',
  MP3: 'audio/mpeg',
  WAV: 'audio/wav',
};

/** Pick the best variant for a requested quality tier. */
export function selectVariant(variants: AudioVariant[], quality: 'low' | 'med' | 'high' | 'auto'): AudioVariant | null {
  if (variants.length === 0) return null;
  const sorted = [...variants].sort((a, b) => a.bitrateKbps - b.bitrateKbps);
  switch (quality) {
    case 'low':
      return sorted[0]!;
    case 'med':
      return sorted[Math.floor((sorted.length - 1) / 2)]!;
    default:
      return sorted[sorted.length - 1]!;
  }
}

export default async function streamingRoutes(app: FastifyInstance) {
  /**
   * GET /stream/:trackId?token=...&quality=high|med|low|auto
   *
   * Byte-range proxy from object storage. Authorized by a short-lived stream
   * token (query param, because <audio> cannot set headers) or a Bearer token.
   * Supports seeking (Range), progressive playback, and adaptive quality.
   */
  app.get('/stream/:trackId', async (req, reply) => {
    const { trackId } = parse(z.object({ trackId: z.string() }), req.params);
    const { token, quality, session } = parse(
      z.object({
        token: z.string().optional(),
        quality: z.enum(['low', 'med', 'high', 'auto']).default('auto'),
        session: z.string().optional(),
      }),
      req.query,
    );

    let userId: string;
    if (token) {
      userId = verifyStreamToken(token, trackId).userId;
    } else if (req.headers.authorization?.startsWith('Bearer ')) {
      userId = verifyAccessToken(req.headers.authorization.slice(7)).sub;
    } else {
      throw unauthorized('Stream token required', 'STREAM_TOKEN_MISSING');
    }

    const track = await prisma.track.findUnique({ where: { id: trackId }, include: { variants: true } });
    if (!track) throw notFound('Track not found');
    const variant = selectVariant(track.variants, quality);
    if (!variant) throw notFound('No streamable audio for this track', 'NO_AUDIO');

    const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
    const obj = await getObjectStream(BUCKETS.audio, variant.objectKey, range).catch(() => null);
    if (!obj) throw notFound('Audio object unavailable', 'AUDIO_MISSING');

    // Bandwidth accounting (approximate: counts bytes requested from storage).
    if (session) {
      void prisma.listeningSession
        .updateMany({
          where: { id: session, userId },
          data: { bytesServed: { increment: BigInt(obj.contentLength) }, lastSeenAt: new Date() },
        })
        .catch(() => undefined);
    }

    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Type', obj.contentType ?? CONTENT_TYPES[variant.format] ?? 'application/octet-stream');
    reply.header('Content-Length', obj.contentLength);
    reply.header('Cache-Control', 'private, max-age=0');
    reply.header('X-Air-Quality', `${variant.format.toLowerCase()}-${variant.bitrateKbps}`);
    if (obj.contentRange) {
      reply.header('Content-Range', obj.contentRange);
      reply.status(206);
    } else {
      reply.status(200);
    }
    return reply.send(obj.body);
  });

  /** WS /ws?token=<access token> — realtime notifications & activity. */
  app.get('/ws', { websocket: true }, (socket, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    try {
      const payload = verifyAccessToken(token ?? '');
      // Register after successful auth only.
      void import('../../shared/ws.js').then(({ registerSocket }) => registerSocket(payload.sub, socket));
      socket.send(JSON.stringify({ kind: 'hello', userId: payload.sub }));
      socket.on('message', (raw: Buffer) => {
        // Client pings keep the connection warm; echo pongs.
        if (raw.toString() === 'ping') socket.send('pong');
      });
    } catch {
      socket.close(4401, 'unauthorized');
    }
  });
}
