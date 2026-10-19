import { Prisma } from '@prisma/client';
import { prisma } from '../config/prismaClient';

type Client = typeof prisma | Prisma.TransactionClient;

export async function create(data: {
  userId: number;
  goalId: number;
  amount: number;
  occurredOn: Date;
  note: string | null;
}) {
  return await prisma.progressEntry.create({ data });
}

export async function findById(id: number) {
  return await prisma.progressEntry.findUnique({ where: { id }, include: { goal: true } });
}

export async function update(
  id: number,
  data: { amount?: number; occurredOn?: Date; note?: string | null }
) {
  return await prisma.progressEntry.update({ where: { id }, data });
}

export async function remove(id: number) {
  await prisma.progressEntry.delete({ where: { id } });
}

export async function deleteForMember(goalId: number, userId: number, client: Client) {
  await client.progressEntry.deleteMany({ where: { goalId, userId } });
}

/** Entries with occurredOn in [fromDate, toDate); both are @db.Date values. */
export async function findForGoalInRange(goalId: number, fromDate: Date, toDate: Date) {
  return await prisma.progressEntry.findMany({
    where: { goalId, occurredOn: { gte: fromDate, lt: toDate } },
    select: { userId: true, amount: true, occurredOn: true },
  });
}

export async function listForGoal(goalId: number, pagination: { skip: number; take: number }) {
  const where = { goalId };
  const [data, total] = await Promise.all([
    prisma.progressEntry.findMany({
      where,
      include: { user: { select: { id: true, name: true } } },
      orderBy: [{ occurredOn: 'desc' }, { id: 'desc' }],
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.progressEntry.count({ where }),
  ]);
  return { data, total };
}

export async function findAllForUser(userId: number) {
  return await prisma.progressEntry.findMany({ where: { userId }, orderBy: { occurredOn: 'asc' } });
}
