import type { ProgressEntry } from '@prisma/client';
import * as progressEntryRepository from '../repositories/progressEntryRepository';
import { requireMembership, requireWritableGoal } from './goalService';
import { NotFoundError } from '../errors/NotFoundError';
import { ValidationError } from '../errors/ValidationError';
import { dateColumnToKey, dateKeyToColumn, localDateKey } from '../lib/time';

export function toProgressEntryDto(entry: ProgressEntry) {
  return {
    id: entry.id,
    goalId: entry.goalId,
    amount: entry.amount,
    occurredOn: dateColumnToKey(entry.occurredOn),
    note: entry.note,
  };
}

/** Dates are days in the goal's zone; "today" there is the latest allowed. */
function resolveDate(dateKey: string | undefined, timeZone: string) {
  const today = localDateKey(new Date(), timeZone);
  if (dateKey !== undefined && dateKey > today) {
    throw new ValidationError('occurredOn: must not be in the future', [
      { path: 'occurredOn', message: 'must not be in the future' },
    ]);
  }
  return dateKeyToColumn(dateKey ?? today);
}

async function requireOwnEntry(entryId: number, userId: number) {
  const entry = await progressEntryRepository.findById(entryId);
  if (!entry || entry.userId !== userId) {
    throw new NotFoundError('Progress entry');
  }
  return entry;
}

export async function createEntry(
  goalId: number,
  userId: number,
  input: { amount: number; occurredOn?: string | undefined; note: string | null }
) {
  const goal = await requireWritableGoal(goalId, userId, 'COUNT');
  const entry = await progressEntryRepository.create({
    userId,
    goalId,
    amount: input.amount,
    occurredOn: resolveDate(input.occurredOn, goal.timezone),
    note: input.note,
  });
  return toProgressEntryDto(entry);
}

export async function updateEntry(
  entryId: number,
  userId: number,
  input: {
    amount?: number | undefined;
    occurredOn?: string | undefined;
    note?: string | null | undefined;
  }
) {
  const existing = await requireOwnEntry(entryId, userId);
  const entry = await progressEntryRepository.update(entryId, {
    ...(input.amount !== undefined && { amount: input.amount }),
    ...(input.occurredOn !== undefined && {
      occurredOn: resolveDate(input.occurredOn, existing.goal.timezone),
    }),
    ...(input.note !== undefined && { note: input.note }),
  });
  return toProgressEntryDto(entry);
}

export async function deleteEntry(entryId: number, userId: number) {
  await requireOwnEntry(entryId, userId);
  await progressEntryRepository.remove(entryId);
}

export async function listGoalEntries(
  goalId: number,
  userId: number,
  pagination: { skip: number; take: number }
) {
  await requireMembership(goalId, userId);
  const { data, total } = await progressEntryRepository.listForGoal(goalId, pagination);
  return { data: data.map((e) => ({ ...toProgressEntryDto(e), user: e.user })), total };
}
