import { describe, expect, it } from 'vitest';
import type { AudioVariant } from '@prisma/client';
import { selectVariant } from '../../src/modules/streaming/routes.js';

const variant = (format: AudioVariant['format'], bitrateKbps: number): AudioVariant =>
  ({ id: `${format}-${bitrateKbps}`, trackId: 't', format, bitrateKbps, objectKey: 'k', sizeBytes: 1n, createdAt: new Date() });

const variants = [variant('AAC', 320), variant('AAC', 96), variant('OPUS', 128), variant('AAC', 192)];

describe('selectVariant', () => {
  it('returns null when no variants exist', () => {
    expect(selectVariant([], 'auto')).toBeNull();
  });

  it('picks the highest bitrate for high/auto', () => {
    expect(selectVariant(variants, 'high')?.bitrateKbps).toBe(320);
    expect(selectVariant(variants, 'auto')?.bitrateKbps).toBe(320);
  });

  it('picks the lowest bitrate for low', () => {
    expect(selectVariant(variants, 'low')?.bitrateKbps).toBe(96);
  });

  it('picks a middle bitrate for med', () => {
    expect(selectVariant(variants, 'med')?.bitrateKbps).toBe(128);
  });

  it('handles a single variant for every quality tier', () => {
    const only = [variant('WAV', 353)];
    for (const q of ['low', 'med', 'high', 'auto'] as const) {
      expect(selectVariant(only, q)?.bitrateKbps).toBe(353);
    }
  });
});
