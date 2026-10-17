import { z } from 'zod';
import { dateKey } from './common';

// TIME targets are seconds: at most 10 000 hours. COUNT targets: at most a million units.
const MAX_TIME_TARGET = 10_000 * 3600;
const MAX_COUNT_TARGET = 1_000_000;

const name = z.string().trim().min(1).max(100);
const unit = z.string().trim().min(1).max(20);
const target = z.number().int().positive();

export const createGoalSchema = z
  .object({
    name,
    type: z.enum(['TIME', 'COUNT']),
    unit: unit.optional(),
    mode: z.enum(['DEADLINE', 'RECURRING']),
    period: z.enum(['WEEKLY', 'MONTHLY']).optional(),
    target,
    startDate: dateKey.optional(),
    deadline: dateKey.optional(),
  })
  .superRefine((goal, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });

    if (goal.type === 'COUNT' && !goal.unit)
      issue('unit', 'is required for goals measured in units');
    if (goal.type === 'TIME' && goal.unit)
      issue('unit', 'only goals measured in units have a unit');
    if (goal.mode === 'DEADLINE' && !goal.deadline)
      issue('deadline', 'is required for deadline goals');
    if (goal.mode === 'DEADLINE' && goal.period)
      issue('period', 'only recurring goals have a period');
    if (goal.mode === 'RECURRING' && !goal.period)
      issue('period', 'is required for recurring goals');
    if (goal.mode === 'RECURRING' && goal.deadline)
      issue('deadline', 'only deadline goals have a deadline');
    if (goal.target > (goal.type === 'TIME' ? MAX_TIME_TARGET : MAX_COUNT_TARGET)) {
      issue('target', 'is too large');
    }
  });

// Type, mode and period are fixed after creation; strictObject turns an attempt into a 400.
export const updateGoalSchema = z
  .strictObject({
    name,
    unit,
    target: target.max(MAX_TIME_TARGET),
    startDate: dateKey,
    deadline: dateKey,
    archived: z.boolean(),
  })
  .partial();

export const listGoalsQuery = z.object({
  state: z.enum(['active', 'archived']).default('active'),
});
