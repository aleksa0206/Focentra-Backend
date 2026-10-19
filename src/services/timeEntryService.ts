import { Prisma, type TimeEntry } from '@prisma/client';
import { prisma } from '../config/prismaClient';
import * as timeEntryRepository from '../repositories/timeEntryRepository';
import * as userRepository from '../repositories/userRepository';
import { requireMembership, requireWritableGoal } from './goalService';
import { ConflictError } from '../errors/ConflictError';
import { NotFoundError } from '../errors/NotFoundError';
import { ValidationError } from '../errors/ValidationError';
import { UnauthorizedError } from '../errors/UnauthorizedError';
import { addDaysToKey, startOfLocalDate } from '../lib/time';

const MAX_ENTRY_MS = 24 * 60 * 60 * 1000;
// Client clocks drift; an entry ending a minute "in the future" is still fine.
const CLOCK_SKEW_MS = 60 * 1000;

export function toTimeEntryDto(entry: TimeEntry, now = new Date()) {
  const end = entry.endedAt ?? now;
  return {
    id: entry.id,
    goalId: entry.goalId,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
    note: entry.note,
    running: entry.endedAt === null,
    durationSeconds: Math.max(0, Math.round((end.getTime() - entry.startedAt.getTime()) / 1000)),
  };
}

function invalid(path: string, message: string): ValidationError {
  return new ValidationError(`${path}: ${message}`, [{ path, message }]);
}

function assertValidInterval(startedAt: Date, endedAt: Date) {
  if (endedAt <= startedAt) {
    throw invalid('endedAt', 'must be after startedAt');
  }
  if (endedAt.getTime() > Date.now() + CLOCK_SKEW_MS) {
    throw invalid('endedAt', 'must not be in the future');
  }
  if (endedAt.getTime() - startedAt.getTime() > MAX_ENTRY_MS) {
    throw invalid('endedAt', 'an entry can be at most 24 hours long');
  }
}

async function assertNoOverlap(
  userId: number,
  start: Date,
  end: Date | null,
  excludeId: number | null,
  tx: Prisma.TransactionClient
) {
  const overlap = await timeEntryRepository.findOverlap(userId, start, end, excludeId, tx);
  if (overlap?.endedAt === null && end === null) {
    throw new ConflictError('A timer is already running', 'TIMER_ALREADY_RUNNING');
  }
  if (overlap) {
    const error = new ConflictError('This overlaps another entry', 'ENTRY_OVERLAP');
    error.meta = { overlapping: toTimeEntryDto(overlap) };
    throw error;
  }
}

/** Runs a write under the user's row lock, so overlap checks and inserts cannot interleave. */
async function underUserLock<T>(userId: number, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  try {
    return await prisma.$transaction(async (tx) => {
      await timeEntryRepository.lockUser(userId, tx);
      return await fn(tx);
    });
  } catch (err) {
    // The unique index on runningUserId is the last line of defence for "one running timer".
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('A timer is already running', 'TIMER_ALREADY_RUNNING');
    }
    throw err;
  }
}

async function requireOwnEntry(entryId: number, userId: number) {
  const entry = await timeEntryRepository.findById(entryId);
  // Someone else's entry is "not found", not "forbidden": ids reveal nothing.
  if (!entry || entry.userId !== userId) {
    throw new NotFoundError('Time entry');
  }
  return entry;
}

export async function getRunning(userId: number) {
  const entry = await timeEntryRepository.findRunning(userId);
  return entry ? toTimeEntryDto(entry) : null;
}

export async function startTimer(
  userId: number,
  input: { goalId: number | null; note: string | null }
) {
  if (input.goalId !== null) {
    await requireWritableGoal(input.goalId, userId, 'TIME');
  }
  const entry = await underUserLock(userId, async (tx) => {
    const now = new Date();
    await assertNoOverlap(userId, now, null, null, tx);
    return await timeEntryRepository.create(
      { userId, goalId: input.goalId, startedAt: now, endedAt: null, note: input.note },
      tx
    );
  });
  return toTimeEntryDto(entry);
}

export async function stopTimer(userId: number) {
  const running = await timeEntryRepository.findRunning(userId);
  // A second Stop (from another device) finds nothing to stop.
  if (!running || (await timeEntryRepository.stopRunning(userId, new Date())) === 0) {
    throw new ConflictError('No timer is running', 'NO_TIMER_RUNNING');
  }
  return toTimeEntryDto((await timeEntryRepository.findById(running.id))!);
}

export async function createEntry(
  userId: number,
  input: { startedAt: Date; endedAt: Date; goalId: number | null; note: string | null }
) {
  assertValidInterval(input.startedAt, input.endedAt);
  if (input.goalId !== null) {
    await requireWritableGoal(input.goalId, userId, 'TIME');
  }
  const entry = await underUserLock(userId, async (tx) => {
    await assertNoOverlap(userId, input.startedAt, input.endedAt, null, tx);
    return await timeEntryRepository.create({ userId, ...input }, tx);
  });
  return toTimeEntryDto(entry);
}

export async function updateEntry(
  entryId: number,
  userId: number,
  input: {
    startedAt?: Date | undefined;
    endedAt?: Date | undefined;
    goalId?: number | null | undefined;
    note?: string | null | undefined;
  }
) {
  const existing = await requireOwnEntry(entryId, userId);
  const running = existing.endedAt === null;
  if (running && input.endedAt !== undefined) {
    throw invalid('endedAt', 'stop the timer to end a running entry');
  }

  const startedAt = input.startedAt ?? existing.startedAt;
  if (running) {
    if (startedAt.getTime() > Date.now()) {
      throw invalid('startedAt', 'must not be in the future');
    }
  } else {
    assertValidInterval(startedAt, input.endedAt ?? existing.endedAt!);
  }
  if (input.goalId !== undefined && input.goalId !== null && input.goalId !== existing.goalId) {
    await requireWritableGoal(input.goalId, userId, 'TIME');
  }

  const entry = await underUserLock(userId, async (tx) => {
    if (input.startedAt !== undefined || input.endedAt !== undefined) {
      await assertNoOverlap(
        userId,
        startedAt,
        running ? null : (input.endedAt ?? existing.endedAt),
        entryId,
        tx
      );
    }
    return await timeEntryRepository.update(
      entryId,
      {
        ...(input.startedAt !== undefined && { startedAt: input.startedAt }),
        ...(input.endedAt !== undefined && { endedAt: input.endedAt }),
        ...(input.goalId !== undefined && { goalId: input.goalId }),
        ...(input.note !== undefined && { note: input.note }),
      },
      tx
    );
  });
  return toTimeEntryDto(entry);
}

export async function deleteEntry(entryId: number, userId: number) {
  await requireOwnEntry(entryId, userId);
  await timeEntryRepository.remove(entryId);
}

export async function listEntries(
  userId: number,
  filters: { from?: string | undefined; to?: string | undefined; goalId?: number | undefined },
  pagination: { skip: number; take: number }
) {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw new UnauthorizedError('User no longer exists');
  }
  // from/to are calendar days in the user's zone; `to` is included.
  const range =
    filters.from && filters.to
      ? {
          from: startOfLocalDate(filters.from, user.timezone),
          to: startOfLocalDate(addDaysToKey(filters.to, 1), user.timezone),
        }
      : {};
  const { data, total } = await timeEntryRepository.listForUser(
    userId,
    { ...range, ...(filters.goalId !== undefined && { goalId: filters.goalId }) },
    pagination
  );
  const now = new Date();
  return {
    data: data.map((entry) => ({ ...toTimeEntryDto(entry, now), goal: entry.goal })),
    total,
  };
}

/** Everyone's entries on a goal the caller is a member of; nothing outside that goal (US-05). */
export async function listGoalEntries(
  goalId: number,
  userId: number,
  pagination: { skip: number; take: number }
) {
  await requireMembership(goalId, userId);
  const { data, total } = await timeEntryRepository.listForGoal(goalId, pagination);
  const now = new Date();
  return {
    data: data.map((entry) => ({ ...toTimeEntryDto(entry, now), user: entry.user })),
    total,
  };
}
