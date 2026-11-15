import { usagePeriodStart } from './usage.service';

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('usagePeriodStart', () => {
  it('anchors the usage month to the subscription start day', () => {
    expect(
      usagePeriodStart(utc('2026-01-15'), utc('2026-11-20')).toISOString(),
    ).toBe(utc('2026-11-15').toISOString());
  });

  it('keeps the previous month before the anchor day', () => {
    expect(
      usagePeriodStart(utc('2026-01-15'), utc('2026-11-10')).toISOString(),
    ).toBe(utc('2026-10-15').toISOString());
  });

  it('clamps a 31st anchor to the last day of shorter months', () => {
    expect(
      usagePeriodStart(utc('2026-01-31'), utc('2026-03-05')).toISOString(),
    ).toBe(utc('2026-02-28').toISOString());
  });

  it('resets monthly for annual plans too', () => {
    expect(
      usagePeriodStart(utc('2025-06-09'), utc('2026-11-01')).toISOString(),
    ).toBe(utc('2026-10-09').toISOString());
  });
});
