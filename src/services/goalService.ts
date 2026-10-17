import type { GoalMode, GoalPeriod, GoalType, MemberRole, Prisma } from '@prisma/client';
import { prisma } from '../config/prismaClient';
import * as goalRepository from '../repositories/goalRepository';
import * as timeEntryRepository from '../repositories/timeEntryRepository';
import * as userRepository from '../repositories/userRepository';
import type { GoalWithTargets } from '../repositories/goalRepository';
import { NotFoundError } from '../errors/NotFoundError';
import { ForbiddenError } from '../errors/ForbiddenError';
import { ConflictError } from '../errors/ConflictError';
import { ValidationError } from '../errors/ValidationError';
import { UnauthorizedError } from '../errors/UnauthorizedError';
import { dateColumnToKey, dateKeyToColumn, localDateKey } from '../lib/time';
import * as goalProgress from './goalProgress';

/**
 * The one access check for goals. Personal goals have an OWNER membership too, so there is no
 * separate branch to forget. Non-members get 404, so ids reveal nothing.
 */
export async function requireMembership(goalId: number, userId: number) {
  const membership = await goalRepository.findMembership(goalId, userId);
  if (!membership) {
    throw new NotFoundError('Goal');
  }
  return membership;
}

export async function requireOwner(goalId: number, userId: number) {
  const membership = await requireMembership(goalId, userId);
  if (membership.role !== 'OWNER') {
    throw new ForbiddenError('Only the goal owner can do this', 'NOT_GOAL_OWNER');
  }
  return membership;
}

/** A goal entries can be added to: the caller is a member, the type fits, it is not archived. */
export async function requireWritableGoal(goalId: number, userId: number, type: GoalType) {
  const { goal } = await requireMembership(goalId, userId);
  if (goal.type !== type) {
    throw new ValidationError(
      type === 'TIME'
        ? 'Time can only be logged on a goal measured in hours'
        : 'Progress can only be logged on a goal measured in units',
      [{ path: 'goalId', message: 'wrong goal type' }]
    );
  }
  if (goal.archivedAt) {
    throw new ConflictError('This goal is archived', 'GOAL_ARCHIVED');
  }
  return goal;
}

export function toGoalDto(goal: GoalWithTargets, role: MemberRole) {
  return {
    id: goal.id,
    name: goal.name,
    type: goal.type,
    unit: goal.unit,
    mode: goal.mode,
    period: goal.period,
    startDate: dateColumnToKey(goal.startDate),
    deadline: goal.deadline ? dateColumnToKey(goal.deadline) : null,
    timezone: goal.timezone,
    archived: goal.archivedAt !== null,
    role,
    memberCount: goal._count.members,
    target: goalProgress.currentTarget(goal),
  };
}

async function withProgress(goal: GoalWithTargets, role: MemberRole, now: Date) {
  const { contributions, ...progress } = await goalProgress.summarize(goal, now);
  return { ...toGoalDto(goal, role), progress, contributions };
}

export async function listGoals(userId: number, archived: boolean) {
  const now = new Date();
  // ponytail: one progress query per goal; batch them if users end up with hundreds of goals.
  const goals = await goalRepository.findGoalsForUser(userId, archived);
  return await Promise.all(
    goals.map(async ({ goal, role }) => {
      const { contributions: _contributions, ...dto } = await withProgress(goal, role, now);
      return dto;
    })
  );
}

export async function getGoal(goalId: number, userId: number) {
  const { goal, role } = await requireMembership(goalId, userId);
  const detail = await withProgress(goal, role, new Date());

  // Names only for goals that are actually shared; a personal goal has one contributor.
  const members = goal._count.members > 1 ? await goalRepository.findMembers(goal.id) : [];
  const names = new Map(members.map((m) => [m.userId, m.user.name]));
  return {
    ...detail,
    contributions: detail.contributions
      .map((c) => ({ ...c, name: names.get(c.userId) ?? null }))
      .sort((a, b) => b.value - a.value),
  };
}

export async function createGoal(
  userId: number,
  input: {
    name: string;
    type: GoalType;
    unit?: string | undefined;
    mode: GoalMode;
    period?: GoalPeriod | undefined;
    target: number;
    startDate?: string | undefined;
    deadline?: string | undefined;
  }
) {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw new UnauthorizedError('User no longer exists');
  }
  const startDate = input.startDate ?? localDateKey(new Date(), user.timezone);
  if (input.deadline && input.deadline < startDate) {
    throw new ValidationError('deadline: must not be before the start date', [
      { path: 'deadline', message: 'must not be before the start date' },
    ]);
  }

  const goal = await goalRepository.createGoal({
    ownerId: userId,
    name: input.name,
    type: input.type,
    unit: input.type === 'COUNT' ? input.unit! : null,
    mode: input.mode,
    period: input.mode === 'RECURRING' ? input.period! : null,
    startDate: dateKeyToColumn(startDate),
    deadline: input.mode === 'DEADLINE' ? dateKeyToColumn(input.deadline!) : null,
    timezone: user.timezone,
    target: input.target,
  });
  return await withProgress(goal, 'OWNER', new Date());
}

export async function updateGoal(
  goalId: number,
  userId: number,
  input: {
    name?: string | undefined;
    unit?: string | undefined;
    target?: number | undefined;
    startDate?: string | undefined;
    deadline?: string | undefined;
    archived?: boolean | undefined;
  }
) {
  const { goal } = await requireOwner(goalId, userId);

  if (input.unit !== undefined && goal.type !== 'COUNT') {
    throw new ValidationError('unit: only goals measured in units have a unit', [
      { path: 'unit', message: 'only goals measured in units have a unit' },
    ]);
  }
  if (input.deadline !== undefined && goal.mode !== 'DEADLINE') {
    throw new ValidationError('deadline: only deadline goals have a deadline', [
      { path: 'deadline', message: 'only deadline goals have a deadline' },
    ]);
  }
  if (input.target !== undefined && goal.type === 'COUNT' && input.target > 1_000_000) {
    throw new ValidationError('target: is too large', [
      { path: 'target', message: 'is too large' },
    ]);
  }
  const startDate = input.startDate ?? dateColumnToKey(goal.startDate);
  const deadline = input.deadline ?? (goal.deadline && dateColumnToKey(goal.deadline));
  if (deadline && deadline < startDate) {
    throw new ValidationError('deadline: must not be before the start date', [
      { path: 'deadline', message: 'must not be before the start date' },
    ]);
  }

  const data: Prisma.GoalUpdateInput = {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.unit !== undefined && { unit: input.unit }),
    ...(input.startDate !== undefined && { startDate: dateKeyToColumn(input.startDate) }),
    ...(input.deadline !== undefined && { deadline: dateKeyToColumn(input.deadline) }),
    ...(input.archived !== undefined && { archivedAt: input.archived ? new Date() : null }),
  };
  const newTarget =
    input.target !== undefined && input.target !== goalProgress.currentTarget(goal)
      ? input.target
      : undefined;

  const updated = await prisma.$transaction(async (tx) => {
    // Archiving with a timer running on it stops that timer, for every member.
    if (input.archived === true && !goal.archivedAt) {
      await timeEntryRepository.stopRunningOnGoal(goalId, new Date(), tx);
    }
    return await goalRepository.updateGoal(goalId, data, newTarget, tx);
  });
  return await withProgress(updated, 'OWNER', new Date());
}

/** Time entries stay with their users, detached from the goal; progress entries go with it. */
export async function deleteGoal(goalId: number, userId: number) {
  await requireOwner(goalId, userId);
  await prisma.$transaction(async (tx) => {
    await timeEntryRepository.stopRunningOnGoal(goalId, new Date(), tx);
    await goalRepository.deleteGoal(goalId, tx);
  });
}

export async function getChart(goalId: number, userId: number) {
  const { goal } = await requireMembership(goalId, userId);
  return await goalProgress.chart(goal, new Date());
}

export async function getPeriods(goalId: number, userId: number) {
  const { goal } = await requireMembership(goalId, userId);
  if (goal.mode !== 'RECURRING') {
    throw new ConflictError('Only recurring goals have periods', 'NOT_RECURRING');
  }
  return await goalProgress.periodHistory(goal, new Date());
}
