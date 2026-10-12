import { scanTiming } from './scan-window';

describe('scanTiming', () => {
  // 19:30–22:00 in Lagos (UTC+1) = 18:30–21:00 UTC.
  const startsAt = new Date('2026-10-12T18:30:00Z');
  const endsAt = new Date('2026-10-12T21:00:00Z');
  const at = (iso: string) =>
    scanTiming(new Date(iso), startsAt, endsAt, 'Africa/Lagos');

  it('opens an hour before the start and stays open until the end', () => {
    expect(at('2026-10-12T17:30:00Z')).toBe('open');
    expect(at('2026-10-12T19:45:00Z')).toBe('open');
    expect(at('2026-10-12T21:00:00Z')).toBe('open');
  });

  it('is too early earlier the same local day', () => {
    expect(at('2026-10-12T17:29:00Z')).toBe('too_early');
    expect(at('2026-10-11T23:30:00Z')).toBe('too_early'); // 00:30 on the 12th in Lagos
  });

  it('is not today on an earlier local day', () => {
    expect(at('2026-10-11T22:30:00Z')).toBe('not_today'); // 23:30 on the 11th in Lagos
  });

  it('is over once the showtime ends', () => {
    expect(at('2026-10-12T21:00:01Z')).toBe('showtime_ended');
    expect(at('2026-10-13T18:00:00Z')).toBe('showtime_ended');
  });
});
