// Progress of a goal is never stored: it is computed from the entries every time it is read
// (D-8), so there is no background job and nothing to get out of sync.
import type { GoalTarget } from '@prisma/client';
import * as timeEntryRepository from '../repositories/timeEntryRepository';
import * as progressEntryRepository from '../repositories/progressEntryRepository';
import type { GoalWithTargets } from '../repositories/goalRepository';
import {
  addDaysToKey,
  computePace,
  dateColumnToKey,
  dateKeyToColumn,
  localDateKey,
  overlapSeconds,
  periodContaining,
  previousPeriod,
  secondsByLocalDay,
  startOfLocalDate,
  type Interval,
} from '../lib/time';

const HISTORY_PERIODS = 12;

export function goalStart(goal: GoalWithTargets): Date {
  return startOfLocalDate(dateColumnToKey(goal.startDate), goal.timezone);
}

/** Target valid at an instant: the last change before it (D-2). */
export function targetAt(targets: GoalTarget[], instant: Date): number {
  let value = targets[0]?.value ?? 0;
  for (const target of targets) {
    if (target.effectiveFrom < instant) {
      value = target.value;
    }
  }
  return value;
}

export function currentTarget(goal: GoalWithTargets): number {
  return goal.targets.at(-1)?.value ?? 0;
}

/**
 * The window progress is measured in right now: the whole goal for DEADLINE, the current week or
 * month for RECURRING. A period that began before the goal starts counts from the goal's start.
 */
export function activeWindow(goal: GoalWithTargets, now: Date): Interval {
  const start = goalStart(goal);
  if (goal.mode === 'DEADLINE') {
    const lastDay = dateColumnToKey(goal.deadline!);
    return { start, end: startOfLocalDate(addDaysToKey(lastDay, 1), goal.timezone) };
  }
  const period = periodContaining(now < start ? start : now, goal.period!, goal.timezone);
  return { start: period.start < start ? start : period.start, end: period.end };
}

type Contribution = { userId: number; value: number };

/** Each member's progress inside the window. A running timer counts up to `now`. */
async function contributions(
  goal: GoalWithTargets,
  window: Interval,
  now: Date
): Promise<Contribution[]> {
  const totals = new Map<number, number>();
  const add = (userId: number, value: number) =>
    totals.set(userId, (totals.get(userId) ?? 0) + value);

  if (goal.type === 'TIME') {
    const entries = await timeEntryRepository.findForGoalInRange(goal.id, window.start, window.end);
    for (const entry of entries) {
      add(
        entry.userId,
        overlapSeconds([{ start: entry.startedAt, end: entry.endedAt ?? now }], window)
      );
    }
  } else {
    const entries = await progressEntryRepository.findForGoalInRange(
      goal.id,
      dateKeyToColumn(localDateKey(window.start, goal.timezone)),
      dateKeyToColumn(localDateKey(window.end, goal.timezone))
    );
    for (const entry of entries) {
      add(entry.userId, entry.amount);
    }
  }

  return [...totals].map(([userId, value]) => ({ userId, value: Math.round(value) }));
}

export async function summarize(goal: GoalWithTargets, now: Date) {
  const window = activeWindow(goal, now);
  const target = currentTarget(goal);
  const byUser = await contributions(goal, window, now);
  const progress = byUser.reduce((sum, c) => sum + c.value, 0);
  const { expected, status } = computePace({ progress, target, window, now });

  return {
    windowStart: window.start,
    windowEnd: window.end,
    value: progress,
    target,
    expected,
    status,
    contributions: byUser,
  };
}

/** Cumulative progress per local day of the active window, up to today. */
export async function chart(goal: GoalWithTargets, now: Date) {
  const window = activeWindow(goal, now);
  const until = now < window.end ? now : window.end;
  const points: { date: string; value: number }[] = [];
  if (until <= window.start) {
    return {
      windowStart: window.start,
      windowEnd: window.end,
      target: currentTarget(goal),
      points,
    };
  }

  const daily = new Map<string, number>();
  if (goal.type === 'TIME') {
    const entries = await timeEntryRepository.findForGoalInRange(goal.id, window.start, until);
    const clipped = entries
      .map((e) => ({
        start: e.startedAt < window.start ? window.start : e.startedAt,
        end: (e.endedAt ?? now) > until ? until : (e.endedAt ?? now),
      }))
      .filter((i) => i.end > i.start);
    for (const [key, seconds] of secondsByLocalDay(clipped, goal.timezone)) {
      daily.set(key, seconds);
    }
  } else {
    const entries = await progressEntryRepository.findForGoalInRange(
      goal.id,
      dateKeyToColumn(localDateKey(window.start, goal.timezone)),
      dateKeyToColumn(addDaysToKey(localDateKey(until, goal.timezone), 1))
    );
    for (const entry of entries) {
      const key = dateColumnToKey(entry.occurredOn);
      daily.set(key, (daily.get(key) ?? 0) + entry.amount);
    }
  }

  const lastKey = localDateKey(new Date(until.getTime() - 1), goal.timezone);
  let cumulative = 0;
  for (
    let key = localDateKey(window.start, goal.timezone);
    key <= lastKey;
    key = addDaysToKey(key, 1)
  ) {
    cumulative += daily.get(key) ?? 0;
    points.push({ date: key, value: Math.round(cumulative) });
  }
  return { windowStart: window.start, windowEnd: window.end, target: currentTarget(goal), points };
}

/** The current and previous periods of a RECURRING goal, newest first. */
export async function periodHistory(goal: GoalWithTargets, now: Date) {
  const start = goalStart(goal);
  if (now < start) {
    return [];
  }

  const periods: Interval[] = [];
  for (
    let period = periodContaining(now, goal.period!, goal.timezone);
    periods.length < HISTORY_PERIODS && period.end > start;
    period = previousPeriod(period, goal.period!, goal.timezone)
  ) {
    periods.push({ start: period.start < start ? start : period.start, end: period.end });
  }

  const span = { start: periods.at(-1)!.start, end: periods[0]!.end };
  let progressIn: (window: Interval) => number;

  if (goal.type === 'TIME') {
    const entries = await timeEntryRepository.findForGoalInRange(goal.id, span.start, span.end);
    const intervals = entries.map((e) => ({ start: e.startedAt, end: e.endedAt ?? now }));
    progressIn = (window) => Math.round(overlapSeconds(intervals, window));
  } else {
    const entries = await progressEntryRepository.findForGoalInRange(
      goal.id,
      dateKeyToColumn(localDateKey(span.start, goal.timezone)),
      dateKeyToColumn(localDateKey(span.end, goal.timezone))
    );
    progressIn = (window) => {
      const from = localDateKey(window.start, goal.timezone);
      const to = localDateKey(window.end, goal.timezone);
      return entries
        .filter((e) => {
          const key = dateColumnToKey(e.occurredOn);
          return key >= from && key < to;
        })
        .reduce((sum, e) => sum + e.amount, 0);
    };
  }

  return periods.map((window) => {
    const target = targetAt(goal.targets, window.end);
    const value = progressIn(window);
    return {
      start: window.start,
      end: window.end,
      target,
      value,
      achieved: value >= target,
      current: now >= window.start && now < window.end,
    };
  });
}
