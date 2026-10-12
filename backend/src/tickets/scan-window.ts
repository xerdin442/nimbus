/** Doors open an hour before the showtime starts. */
export const SCAN_OPENS_BEFORE_START_MS = 60 * 60 * 1000;

export type ScanTiming = 'open' | 'too_early' | 'not_today' | 'showtime_ended';

const localDate = (date: Date, timezone: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

/**
 * Whether a ticket can be used at `now`: from an hour before the start until the showtime ends.
 * Early scans say whether the showtime is later today or on another day, in the location's timezone.
 */
export function scanTiming(
  now: Date,
  startsAt: Date,
  endsAt: Date,
  timezone: string,
): ScanTiming {
  if (now.getTime() > endsAt.getTime()) {
    return 'showtime_ended';
  }
  if (now.getTime() < startsAt.getTime() - SCAN_OPENS_BEFORE_START_MS) {
    return localDate(now, timezone) === localDate(startsAt, timezone)
      ? 'too_early'
      : 'not_today';
  }
  return 'open';
}
