import { prisma } from '../config/prismaClient';
import * as goalRepository from '../repositories/goalRepository';
import * as timeEntryRepository from '../repositories/timeEntryRepository';
import * as progressEntryRepository from '../repositories/progressEntryRepository';
import { requireMembership, requireOwner } from './goalService';
import { hashToken, randomToken } from './authService';
import { ConflictError } from '../errors/ConflictError';
import { ForbiddenError } from '../errors/ForbiddenError';
import { GoneError } from '../errors/GoneError';
import { NotFoundError } from '../errors/NotFoundError';
import { logger } from '../config/logger';

export const MAX_MEMBERS = 20;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function listMembers(goalId: number, userId: number) {
  await requireMembership(goalId, userId);
  const members = await goalRepository.findMembers(goalId);
  // Names only: members of a shared goal don't need each other's email addresses.
  return members.map((m) => ({
    userId: m.userId,
    name: m.user.name,
    role: m.role,
    joinedAt: m.joinedAt,
  }));
}

/**
 * The owner removes a member, or a member leaves. Their entries stop counting toward the goal:
 * time entries are detached, progress entries deleted (they mean nothing without the goal) (D-1).
 */
export async function removeMember(goalId: number, targetUserId: number, userId: number) {
  const membership = await requireMembership(goalId, userId);
  const isSelf = targetUserId === userId;

  if (isSelf && membership.role === 'OWNER') {
    throw new ConflictError(
      'The owner cannot leave; delete the goal instead',
      'OWNER_CANNOT_LEAVE'
    );
  }
  if (!isSelf && membership.role !== 'OWNER') {
    throw new ForbiddenError('Only the goal owner can remove members', 'NOT_GOAL_OWNER');
  }
  if (!isSelf && !(await goalRepository.findMembership(goalId, targetUserId))) {
    throw new NotFoundError('Member');
  }

  await prisma.$transaction(async (tx) => {
    await goalRepository.removeMember(goalId, targetUserId, tx);
    await timeEntryRepository.detachFromGoal(goalId, targetUserId, tx);
    await progressEntryRepository.deleteForMember(goalId, targetUserId, tx);
  });
  logger.info(
    { goalId, memberId: targetUserId, by: userId },
    isSelf ? 'Member left goal' : 'Member removed from goal'
  );
}

export async function createInvite(goalId: number, userId: number) {
  const { goal } = await requireOwner(goalId, userId);
  if (goal.archivedAt) {
    throw new ConflictError('This goal is archived', 'GOAL_ARCHIVED');
  }
  // Only the hash is stored; the raw token exists in this response and in the link.
  const token = randomToken();
  const invite = await goalRepository.createInvite({
    goalId,
    createdById: userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });
  return { id: invite.id, token, expiresAt: invite.expiresAt };
}

export async function listInvites(goalId: number, userId: number) {
  await requireOwner(goalId, userId);
  return await goalRepository.findActiveInvites(goalId);
}

export async function revokeInvite(goalId: number, inviteId: number, userId: number) {
  await requireOwner(goalId, userId);
  if (!(await goalRepository.revokeInvite(goalId, inviteId))) {
    throw new NotFoundError('Invite');
  }
}

async function findUsableInvite(token: string) {
  const invite = await goalRepository.findInviteByTokenHash(hashToken(token));
  if (!invite || invite.revokedAt || invite.expiresAt <= new Date()) {
    throw new GoneError('This invite link is invalid or has expired', 'INVITE_INVALID');
  }
  if (invite.goal.archivedAt) {
    throw new ConflictError('This goal is archived', 'GOAL_ARCHIVED');
  }
  return invite;
}

export async function previewInvite(token: string, userId: number) {
  const invite = await findUsableInvite(token);
  const { goal } = invite;
  return {
    goal: { id: goal.id, name: goal.name, type: goal.type, unit: goal.unit, mode: goal.mode },
    ownerName: goal.owner.name,
    memberCount: goal._count.members,
    alreadyMember: (await goalRepository.findMembership(goal.id, userId)) !== null,
  };
}

export async function acceptInvite(token: string, userId: number) {
  const invite = await findUsableInvite(token);
  const goalId = invite.goalId;

  await prisma.$transaction(async (tx) => {
    // Locked so two accepts at 19 members cannot both make it 20 + 1.
    await goalRepository.lockGoal(goalId, tx);
    if (await tx.goalMember.findUnique({ where: { goalId_userId: { goalId, userId } } })) {
      return;
    }
    if ((await goalRepository.countMembers(goalId, tx)) >= MAX_MEMBERS) {
      throw new ConflictError(`A goal can have at most ${MAX_MEMBERS} members`, 'GOAL_FULL');
    }
    await goalRepository.addMember(goalId, userId, tx);
  });
  logger.info({ goalId, userId, inviteId: invite.id }, 'Invite accepted');
  return { goalId };
}
