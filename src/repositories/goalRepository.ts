import { Prisma, type GoalMode, type GoalPeriod, type GoalType } from '@prisma/client';
import { prisma } from '../config/prismaClient';

type Client = typeof prisma | Prisma.TransactionClient;

const goalInclude = {
  targets: { orderBy: { effectiveFrom: 'asc' } },
  _count: { select: { members: true } },
} as const satisfies Prisma.GoalInclude;

export type GoalWithTargets = Prisma.GoalGetPayload<{ include: typeof goalInclude }>;

export async function findMembership(goalId: number, userId: number) {
  return await prisma.goalMember.findUnique({
    where: { goalId_userId: { goalId, userId } },
    include: { goal: { include: goalInclude } },
  });
}

export async function findGoalsForUser(userId: number, archived: boolean) {
  const memberships = await prisma.goalMember.findMany({
    where: { userId, goal: { archivedAt: archived ? { not: null } : null } },
    include: { goal: { include: goalInclude } },
    orderBy: { goal: { createdAt: 'desc' } },
  });
  return memberships.map(({ role, goal }) => ({ role, goal }));
}

export async function createGoal(data: {
  ownerId: number;
  name: string;
  type: GoalType;
  unit: string | null;
  mode: GoalMode;
  period: GoalPeriod | null;
  startDate: Date;
  deadline: Date | null;
  timezone: string;
  target: number;
}) {
  const { target, ...goal } = data;
  return await prisma.goal.create({
    data: {
      ...goal,
      targets: { create: { value: target, effectiveFrom: new Date() } },
      members: { create: { userId: data.ownerId, role: 'OWNER' } },
    },
    include: goalInclude,
  });
}

export async function updateGoal(
  goalId: number,
  data: Prisma.GoalUpdateInput,
  newTarget: number | undefined,
  client: Client
) {
  if (newTarget !== undefined) {
    await client.goalTarget.create({
      data: { goalId, value: newTarget, effectiveFrom: new Date() },
    });
  }
  return await client.goal.update({ where: { id: goalId }, data, include: goalInclude });
}

export async function deleteGoal(goalId: number, client: Client) {
  await client.goal.delete({ where: { id: goalId } });
}

/** Locks the goal row until the transaction ends, so member-count checks cannot race. */
export async function lockGoal(goalId: number, client: Prisma.TransactionClient) {
  await client.$queryRaw`SELECT id FROM Goal WHERE id = ${goalId} FOR UPDATE`;
}

export async function findMembers(goalId: number) {
  return await prisma.goalMember.findMany({
    where: { goalId },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { joinedAt: 'asc' },
  });
}

export async function countMembers(goalId: number, client: Client = prisma) {
  return await client.goalMember.count({ where: { goalId } });
}

export async function addMember(goalId: number, userId: number, client: Client) {
  await client.goalMember.create({ data: { goalId, userId, role: 'MEMBER' } });
}

export async function removeMember(goalId: number, userId: number, client: Client) {
  await client.goalMember.delete({ where: { goalId_userId: { goalId, userId } } });
}

export async function createInvite(data: {
  goalId: number;
  createdById: number;
  tokenHash: string;
  expiresAt: Date;
}) {
  return await prisma.goalInvite.create({ data });
}

export async function findActiveInvites(goalId: number) {
  return await prisma.goalInvite.findMany({
    where: { goalId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, expiresAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function revokeInvite(goalId: number, inviteId: number) {
  const result = await prisma.goalInvite.updateMany({
    where: { id: inviteId, goalId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count === 1;
}

export async function findInviteByTokenHash(tokenHash: string) {
  return await prisma.goalInvite.findUnique({
    where: { tokenHash },
    include: {
      goal: {
        include: { owner: { select: { name: true } }, _count: { select: { members: true } } },
      },
    },
  });
}
