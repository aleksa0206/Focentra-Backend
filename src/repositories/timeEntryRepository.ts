import { Prisma } from '@prisma/client';
import { prisma } from '../config/prismaClient';

type Client = typeof prisma | Prisma.TransactionClient;

/**
 * Serializes all writes to one user's time entries. Without it, two parallel requests could both
 * pass the overlap check and both insert (a read-then-write race).
 */
export async function lockUser(userId: number, client: Prisma.TransactionClient) {
  await client.$queryRaw`SELECT id FROM User WHERE id = ${userId} FOR UPDATE`;
}

/**
 * First entry of the user that overlaps [start, end). `end` null means "open ended" (a timer that
 * starts now). A running entry counts as reaching into the future.
 */
export async function findOverlap(
  userId: number,
  start: Date,
  end: Date | null,
  excludeId: number | null,
  client: Client
) {
  return await client.timeEntry.findFirst({
    where: {
      userId,
      ...(excludeId !== null && { id: { not: excludeId } }),
      ...(end !== null && { startedAt: { lt: end } }),
      OR: [{ endedAt: null }, { endedAt: { gt: start } }],
    },
    orderBy: { startedAt: 'asc' },
  });
}

export async function findById(id: number) {
  return await prisma.timeEntry.findUnique({ where: { id } });
}

export async function findRunning(userId: number) {
  return await prisma.timeEntry.findUnique({ where: { runningUserId: userId } });
}

export async function create(
  data: {
    userId: number;
    goalId: number | null;
    startedAt: Date;
    endedAt: Date | null;
    note: string | null;
  },
  client: Client
) {
  return await client.timeEntry.create({
    data: { ...data, runningUserId: data.endedAt === null ? data.userId : null },
  });
}

export async function update(
  id: number,
  data: { startedAt?: Date; endedAt?: Date; goalId?: number | null; note?: string | null },
  client: Client
) {
  return await client.timeEntry.update({ where: { id }, data });
}

/** Stops the user's timer; null when none was running (e.g. stopped from another device). */
export async function stopRunning(userId: number, endedAt: Date) {
  const result = await prisma.timeEntry.updateMany({
    where: { runningUserId: userId },
    data: { endedAt, runningUserId: null },
  });
  return result.count;
}

/** Stops every member's running timer on a goal (before archiving or deleting it). */
export async function stopRunningOnGoal(goalId: number, endedAt: Date, client: Client) {
  await client.timeEntry.updateMany({
    where: { goalId, runningUserId: { not: null } },
    data: { endedAt, runningUserId: null },
  });
}

export async function detachFromGoal(goalId: number, userId: number, client: Client) {
  await client.timeEntry.updateMany({ where: { goalId, userId }, data: { goalId: null } });
}

export async function remove(id: number) {
  await prisma.timeEntry.delete({ where: { id } });
}

const overlapping = (start: Date, end: Date): Prisma.TimeEntryWhereInput => ({
  startedAt: { lt: end },
  OR: [{ endedAt: null }, { endedAt: { gt: start } }],
});

export async function findForGoalInRange(goalId: number, start: Date, end: Date) {
  return await prisma.timeEntry.findMany({
    where: { goalId, ...overlapping(start, end) },
    select: { userId: true, startedAt: true, endedAt: true },
  });
}

export async function findForUserInRange(userId: number, start: Date, end: Date) {
  return await prisma.timeEntry.findMany({
    where: { userId, ...overlapping(start, end) },
    select: { goalId: true, startedAt: true, endedAt: true, goal: { select: { name: true } } },
  });
}

export async function listForUser(
  userId: number,
  filters: { from?: Date; to?: Date; goalId?: number },
  pagination: { skip: number; take: number }
) {
  const where: Prisma.TimeEntryWhereInput = {
    userId,
    ...(filters.goalId !== undefined && { goalId: filters.goalId }),
    ...(filters.from !== undefined && filters.to !== undefined
      ? overlapping(filters.from, filters.to)
      : {}),
  };
  const [data, total] = await Promise.all([
    prisma.timeEntry.findMany({
      where,
      include: { goal: { select: { id: true, name: true } } },
      orderBy: { startedAt: 'desc' },
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.timeEntry.count({ where }),
  ]);
  return { data, total };
}

export async function listForGoal(goalId: number, pagination: { skip: number; take: number }) {
  const where = { goalId };
  const [data, total] = await Promise.all([
    prisma.timeEntry.findMany({
      where,
      include: { user: { select: { id: true, name: true } } },
      orderBy: { startedAt: 'desc' },
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.timeEntry.count({ where }),
  ]);
  return { data, total };
}

export async function findAllForUser(userId: number) {
  return await prisma.timeEntry.findMany({ where: { userId }, orderBy: { startedAt: 'asc' } });
}
