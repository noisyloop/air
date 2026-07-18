import { describe, expect, it } from 'vitest';
import { scoreCandidate, type Candidate, type UserSignals } from '../../src/modules/recommendations/service.js';

const baseSignals: UserSignals = {
  userId: 'u1',
  recentTrackIds: ['t1', 't2'],
  playedTrackIds: new Set(['t1', 't2']),
  genreCounts: new Map([
    ['jazz', 8],
    ['ambient', 2],
  ]),
  artistCounts: new Map([['a1', 10]]),
  likedTrackIds: new Set(['t9']),
};

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  id: 'c1',
  artistId: 'aX',
  genreIds: [],
  popularity: 0,
  publishedAt: null,
  coPlayCount: 0,
  ...over,
});

describe('recommendation scoring', () => {
  it('scores co-played tracks above unknown tracks', () => {
    const coPlayed = scoreCandidate(baseSignals, candidate({ coPlayCount: 10 }));
    const unknown = scoreCandidate(baseSignals, candidate());
    expect(coPlayed).toBeGreaterThan(unknown);
  });

  it('boosts genre overlap proportionally to the user profile', () => {
    const jazz = scoreCandidate(baseSignals, candidate({ genreIds: ['jazz'] }));
    const ambient = scoreCandidate(baseSignals, candidate({ genreIds: ['ambient'] }));
    const none = scoreCandidate(baseSignals, candidate({ genreIds: ['metal'] }));
    expect(jazz).toBeGreaterThan(ambient);
    expect(ambient).toBeGreaterThan(none);
  });

  it('boosts familiar artists but not tracks the user already played', () => {
    const familiarNew = scoreCandidate(baseSignals, candidate({ artistId: 'a1' }));
    const familiarPlayed = scoreCandidate(baseSignals, candidate({ id: 't1', artistId: 'a1' }));
    expect(familiarNew).toBeGreaterThan(familiarPlayed);
  });

  it('damps popularity so it cannot dominate personalization', () => {
    const popularOnly = scoreCandidate(baseSignals, candidate({ popularity: 100 }));
    const personalized = scoreCandidate(baseSignals, candidate({ coPlayCount: 10, genreIds: ['jazz'] }));
    expect(personalized).toBeGreaterThan(popularOnly);
  });

  it('boosts fresh releases within a 30-day window', () => {
    const fresh = scoreCandidate(baseSignals, candidate({ publishedAt: new Date() }));
    const old = scoreCandidate(baseSignals, candidate({ publishedAt: new Date('2020-01-01') }));
    expect(fresh).toBeGreaterThan(old);
  });
});
