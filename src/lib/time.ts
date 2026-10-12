// Pure date math in a user's or goal's time zone. Everything stored is UTC; a "day", "week" or
// "month" only exists relative to a zone, and it is not always 24 hours long (DST).
import { TZDate, tz } from '@date-fns/tz';
import {
  addDays,
  addMonths,
  addWeeks,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';

/** Half-open interval [start, end). */
export type Interval = { start: Date; end: Date };
export type Period = 'WEEKLY' | 'MONTHLY';
export type PaceStatus = 'UPCOMING' | 'AHEAD' | 'ON_TRACK' | 'BEHIND' | 'COMPLETED' | 'MISSED';

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
/** Progress within ±10 % of the expected value counts as on track (D-5). */
const ON_TRACK_TOLERANCE = 0.1;
/**
 * A shortfall under 1 % of the target is noise (a goal created an hour ago, a few minutes short);
 * calling it "behind" would only discourage.
 */
const MIN_SHORTFALL = 0.01;

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Calendar date ("2026-10-30") of an instant in a zone. */
export function localDateKey(instant: Date, timeZone: string): string {
  return format(instant, 'yyyy-MM-dd', { in: tz(timeZone) });
}

/** The instant a calendar date starts in a zone. */
export function startOfLocalDate(dateKey: string, timeZone: string): Date {
  if (!DATE_KEY.test(dateKey)) {
    throw new Error(`Invalid date key: ${dateKey}`);
  }
  const [year, month, day] = dateKey.split('-').map(Number) as [number, number, number];
  return new Date(new TZDate(year, month - 1, day, timeZone).getTime());
}

/** Calendar arithmetic on date keys; zone-free because a date key has no time of day. */
export function addDaysToKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Prisma returns @db.Date columns as UTC midnight. */
export function dateColumnToKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function dateKeyToColumn(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function nextLocalMidnight(instant: Date, timeZone: string): Date {
  const inZone = { in: tz(timeZone) };
  return new Date(startOfDay(addDays(instant, 1, inZone), inZone).getTime());
}

/**
 * Seconds per local calendar day. An interval that crosses midnight is split at the zone's
 * midnight, so 23:30-00:30 gives 30 minutes to each day, also on a 23- or 25-hour DST day.
 */
export function secondsByLocalDay(intervals: Interval[], timeZone: string): Map<string, number> {
  const totals = new Map<string, number>();
  for (const { start, end } of intervals) {
    let cursor = start;
    while (cursor < end) {
      const boundary = nextLocalMidnight(cursor, timeZone);
      const segmentEnd = boundary < end ? boundary : end;
      const key = localDateKey(cursor, timeZone);
      totals.set(key, (totals.get(key) ?? 0) + (segmentEnd.getTime() - cursor.getTime()) / 1000);
      cursor = segmentEnd;
    }
  }
  return totals;
}

/** Seconds of the intervals that fall inside the window. */
export function overlapSeconds(intervals: Interval[], window: Interval): number {
  let totalMs = 0;
  for (const { start, end } of intervals) {
    const from = Math.max(start.getTime(), window.start.getTime());
    const to = Math.min(end.getTime(), window.end.getTime());
    if (to > from) {
      totalMs += to - from;
    }
  }
  return totalMs / 1000;
}

/** The calendar week (Monday first) or month that contains the instant. */
export function periodContaining(instant: Date, period: Period, timeZone: string): Interval {
  const inZone = { in: tz(timeZone) };
  const start =
    period === 'WEEKLY'
      ? startOfWeek(instant, { ...inZone, weekStartsOn: 1 })
      : startOfMonth(instant, inZone);
  const end = period === 'WEEKLY' ? addWeeks(start, 1, inZone) : addMonths(start, 1, inZone);
  return { start: new Date(start.getTime()), end: new Date(end.getTime()) };
}

/** The period right before the given one. */
export function previousPeriod(current: Interval, period: Period, timeZone: string): Interval {
  const justBefore = new Date(current.start.getTime() - 1);
  return periodContaining(justBefore, period, timeZone);
}

/**
 * Where progress should be by `now` if it grew evenly from window start to window end, and how
 * the actual progress compares to that.
 */
export function computePace(input: {
  progress: number;
  target: number;
  window: Interval;
  now: Date;
}): { expected: number; status: PaceStatus } {
  const { progress, target, window, now } = input;
  const totalMs = window.end.getTime() - window.start.getTime();
  const elapsedMs = Math.min(Math.max(now.getTime() - window.start.getTime(), 0), totalMs);
  const expected = totalMs > 0 ? (target * elapsedMs) / totalMs : target;

  let status: PaceStatus;
  if (progress >= target) {
    status = 'COMPLETED';
  } else if (now >= window.end) {
    status = 'MISSED';
  } else if (now < window.start) {
    status = 'UPCOMING';
  } else if (progress > expected * (1 + ON_TRACK_TOLERANCE)) {
    status = 'AHEAD';
  } else if (
    progress < expected * (1 - ON_TRACK_TOLERANCE) &&
    expected - progress >= target * MIN_SHORTFALL
  ) {
    status = 'BEHIND';
  } else {
    status = 'ON_TRACK';
  }

  return { expected: Math.round(expected), status };
}
