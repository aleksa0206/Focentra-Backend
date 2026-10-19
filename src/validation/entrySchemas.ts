import { z } from 'zod';
import { dateKey, idParam, note } from './common';

const instant = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const goalId = z.number().int().positive().nullable();

export const startTimerSchema = z.object({
  goalId: goalId.default(null),
  note: note.default(null),
});

export const createTimeEntrySchema = z.object({
  startedAt: instant,
  endedAt: instant,
  goalId: goalId.default(null),
  note: note.default(null),
});

export const updateTimeEntrySchema = z
  .strictObject({ startedAt: instant, endedAt: instant, goalId, note })
  .partial();

export const listTimeEntriesQuery = z
  .object({
    from: dateKey.optional(),
    to: dateKey.optional(),
    goalId: idParam.optional(),
  })
  .refine((q) => (q.from === undefined) === (q.to === undefined), {
    message: 'from and to go together',
    path: ['to'],
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'must not be before from',
    path: ['to'],
  });

const amount = z.number().int().positive().max(1_000_000);

export const createProgressEntrySchema = z.object({
  amount,
  occurredOn: dateKey.optional(),
  note: note.default(null),
});

export const updateProgressEntrySchema = z
  .strictObject({ amount, occurredOn: dateKey, note })
  .partial();

export const rangeQuery = z.object({ from: dateKey, to: dateKey });

export const heatmapQuery = z.object({ from: dateKey.optional(), to: dateKey.optional() });

export const trendQuery = z.object({
  weeks: z.coerce.number().int().min(1).max(52).default(12),
});
