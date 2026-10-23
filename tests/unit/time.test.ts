import {
  addDaysToKey,
  computePace,
  localDateKey,
  overlapSeconds,
  periodContaining,
  previousPeriod,
  secondsByLocalDay,
  startOfLocalDate,
} from '../../src/lib/time';

const BG = 'Europe/Belgrade';
const at = (iso: string) => new Date(iso);

describe('localDateKey / startOfLocalDate', () => {
  it('uses the zone, not UTC', () => {
    // 23:30 UTC on Oct 29 is already Oct 30 in Belgrade (UTC+1 after DST ends).
    expect(localDateKey(at('2026-10-29T23:30:00Z'), BG)).toBe('2026-10-30');
    expect(startOfLocalDate('2026-10-30', BG).toISOString()).toBe('2026-10-29T23:00:00.000Z');
  });

  it('rejects malformed keys', () => {
    expect(() => startOfLocalDate('2026-1-5', BG)).toThrow();
  });

  it('adds days across month ends', () => {
    expect(addDaysToKey('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('secondsByLocalDay', () => {
  it('splits an interval at local midnight', () => {
    // 23:30-00:30 Belgrade time (UTC+1 in November).
    const days = secondsByLocalDay(
      [{ start: at('2026-11-10T22:30:00Z'), end: at('2026-11-10T23:30:00Z') }],
      BG
    );
    expect(Object.fromEntries(days)).toEqual({ '2026-11-10': 1800, '2026-11-11': 1800 });
  });

  it('counts a whole 25-hour day when DST ends', () => {
    // Oct 25 2026 in Belgrade lasts 25 hours.
    const days = secondsByLocalDay(
      [{ start: startOfLocalDate('2026-10-25', BG), end: startOfLocalDate('2026-10-26', BG) }],
      BG
    );
    expect(Object.fromEntries(days)).toEqual({ '2026-10-25': 25 * 3600 });
  });

  it('counts a whole 23-hour day when DST starts', () => {
    const days = secondsByLocalDay(
      [{ start: startOfLocalDate('2026-03-29', BG), end: startOfLocalDate('2026-03-30', BG) }],
      BG
    );
    expect(Object.fromEntries(days)).toEqual({ '2026-03-29': 23 * 3600 });
  });

  it('sums several intervals on the same day', () => {
    const days = secondsByLocalDay(
      [
        { start: at('2026-11-10T08:00:00Z'), end: at('2026-11-10T09:00:00Z') },
        { start: at('2026-11-10T10:00:00Z'), end: at('2026-11-10T10:30:00Z') },
      ],
      'UTC'
    );
    expect(days.get('2026-11-10')).toBe(5400);
  });
});

describe('overlapSeconds', () => {
  it('clips intervals to the window', () => {
    const window = { start: at('2026-11-10T00:00:00Z'), end: at('2026-11-11T00:00:00Z') };
    expect(
      overlapSeconds(
        [
          { start: at('2026-11-09T23:00:00Z'), end: at('2026-11-10T01:00:00Z') },
          { start: at('2026-11-10T12:00:00Z'), end: at('2026-11-10T12:10:00Z') },
          { start: at('2026-11-12T00:00:00Z'), end: at('2026-11-12T01:00:00Z') },
        ],
        window
      )
    ).toBe(3600 + 600);
  });
});

describe('periodContaining', () => {
  it('starts weeks on Monday at local midnight', () => {
    // Sunday evening in Belgrade, still the week of Monday Nov 9.
    const week = periodContaining(at('2026-11-15T22:00:00Z'), 'WEEKLY', BG);
    expect(week.start.toISOString()).toBe('2026-11-08T23:00:00.000Z');
    expect(week.end.toISOString()).toBe('2026-11-15T23:00:00.000Z');
  });

  it('handles a month that contains a DST change', () => {
    const month = periodContaining(at('2026-10-15T12:00:00Z'), 'MONTHLY', BG);
    expect(month.start.toISOString()).toBe('2026-09-30T22:00:00.000Z');
    expect(month.end.toISOString()).toBe('2026-10-31T23:00:00.000Z');
  });

  it('finds the previous period', () => {
    const week = periodContaining(at('2026-11-11T12:00:00Z'), 'WEEKLY', 'UTC');
    expect(previousPeriod(week, 'WEEKLY', 'UTC').start.toISOString()).toBe(
      '2026-11-02T00:00:00.000Z'
    );
  });
});

describe('computePace', () => {
  const window = { start: at('2026-10-01T00:00:00Z'), end: at('2026-12-31T00:00:00Z') };
  const half = new Date((window.start.getTime() + window.end.getTime()) / 2);

  it('is BEHIND when progress is under 90 % of expected (US-03)', () => {
    expect(computePace({ progress: 14, target: 40, window, now: half })).toEqual({
      expected: 20,
      status: 'BEHIND',
    });
  });

  it('does not call a fresh goal BEHIND for a shortfall under 1 % of the target', () => {
    const justStarted = new Date(window.start.getTime() + 3600_000);
    expect(computePace({ progress: 0, target: 40, window, now: justStarted }).status).toBe(
      'ON_TRACK'
    );
  });

  it('is ON_TRACK within the tolerance', () => {
    expect(computePace({ progress: 19, target: 40, window, now: half }).status).toBe('ON_TRACK');
  });

  it('is AHEAD above the tolerance', () => {
    expect(computePace({ progress: 23, target: 40, window, now: half }).status).toBe('AHEAD');
  });

  it('is COMPLETED once the target is reached, even before the deadline', () => {
    expect(computePace({ progress: 40, target: 40, window, now: half }).status).toBe('COMPLETED');
  });

  it('is MISSED after the window ends short of the target', () => {
    expect(
      computePace({ progress: 39, target: 40, window, now: at('2027-01-01T00:00:00Z') }).status
    ).toBe('MISSED');
  });

  it('is UPCOMING before the window starts', () => {
    expect(
      computePace({ progress: 0, target: 40, window, now: at('2026-09-01T00:00:00Z') })
    ).toEqual({ expected: 0, status: 'UPCOMING' });
  });
});
