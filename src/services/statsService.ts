// Statistics over the caller's own time entries only, in the caller's zone. Entries of other
// members of a shared goal never show up here.
import * as timeEntryRepository from '../repositories/timeEntryRepository';
import * as userRepository from '../repositories/userRepository';
import { UnauthorizedError } from '../errors/UnauthorizedError';
import { ValidationError } from '../errors/ValidationError';
import {
  addDaysToKey,
  localDateKey,
  overlapSeconds,
  periodContaining,
  previousPeriod,
  secondsByLocalDay,
  startOfLocalDate,
  type Interval,
} from '../lib/time';

// Bounds the work one request can cause (a year of entries is a few thousand rows).
const MAX_RANGE_DAYS = 366;

async function userZone(userId: number) {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw new UnauthorizedError('User no longer exists');
  }
  return user.timezone;
}

function dayRange(from: string, to: string, timeZone: string): Interval {
  const days =
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000;
  if (days < 0 || days >= MAX_RANGE_DAYS) {
    throw new ValidationError(`to: range must be 1 to ${MAX_RANGE_DAYS} days`, [
      { path: 'to', message: `range must be 1 to ${MAX_RANGE_DAYS} days` },
    ]);
  }
  return {
    start: startOfLocalDate(from, timeZone),
    end: startOfLocalDate(addDaysToKey(to, 1), timeZone),
  };
}

async function intervalsIn(userId: number, range: Interval, now: Date) {
  const entries = await timeEntryRepository.findForUserInRange(userId, range.start, range.end);
  return entries.map((e) => ({
    goalId: e.goalId,
    goalName: e.goal?.name ?? null,
    start: e.startedAt < range.start ? range.start : e.startedAt,
    end: (e.endedAt ?? now) > range.end ? range.end : (e.endedAt ?? now),
  }));
}

/** Seconds per day; `to` defaults to today and `from` to 364 days before it. */
export async function heatmap(
  userId: number,
  query: { from?: string | undefined; to?: string | undefined }
) {
  const timeZone = await userZone(userId);
  const now = new Date();
  const to = query.to ?? localDateKey(now, timeZone);
  const from = query.from ?? addDaysToKey(to, -364);
  const intervals = await intervalsIn(userId, dayRange(from, to, timeZone), now);

  const days = [...secondsByLocalDay(intervals, timeZone)]
    .map(([date, seconds]) => ({ date, seconds: Math.round(seconds) }))
    .filter((d) => d.seconds > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  return { from, to, timezone: timeZone, days };
}

/** Totals for the last `weeks` calendar weeks (Monday first), oldest first. */
export async function trend(userId: number, weeks: number) {
  const timeZone = await userZone(userId);
  const now = new Date();

  const periods: Interval[] = [periodContaining(now, 'WEEKLY', timeZone)];
  while (periods.length < weeks) {
    periods.unshift(previousPeriod(periods[0]!, 'WEEKLY', timeZone));
  }
  const intervals = await intervalsIn(
    userId,
    { start: periods[0]!.start, end: periods.at(-1)!.end },
    now
  );

  return {
    timezone: timeZone,
    weeks: periods.map((week) => ({
      weekStart: localDateKey(week.start, timeZone),
      seconds: Math.round(overlapSeconds(intervals, week)),
    })),
  };
}

/** Time per goal in a day range; entries without a goal are grouped under goalId null. */
export async function breakdown(userId: number, query: { from: string; to: string }) {
  const timeZone = await userZone(userId);
  const intervals = await intervalsIn(userId, dayRange(query.from, query.to, timeZone), new Date());

  const totals = new Map<
    number | null,
    { goalId: number | null; name: string | null; seconds: number }
  >();
  for (const interval of intervals) {
    const item = totals.get(interval.goalId) ?? {
      goalId: interval.goalId,
      name: interval.goalName,
      seconds: 0,
    };
    item.seconds += (interval.end.getTime() - interval.start.getTime()) / 1000;
    totals.set(interval.goalId, item);
  }
  return {
    from: query.from,
    to: query.to,
    items: [...totals.values()]
      .map((item) => ({ ...item, seconds: Math.round(item.seconds) }))
      .filter((item) => item.seconds > 0)
      .sort((a, b) => b.seconds - a.seconds),
  };
}
