import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/config/prismaClient';

export const api = () => request(app);
export const PASSWORD = 'correct horse battery';
const passwordHash = bcrypt.hashSync(PASSWORD, 4);

export async function cleanDatabase() {
  // Children first; cascades would do it too, but explicit is faster to reason about.
  await prisma.rateLimitEntry.deleteMany();
  await prisma.progressEntry.deleteMany();
  await prisma.timeEntry.deleteMany();
  await prisma.goalInvite.deleteMany();
  await prisma.goalMember.deleteMany();
  await prisma.goalTarget.deleteMany();
  await prisma.goal.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
}

let counter = 0;
export async function createUser(overrides: { timezone?: string; name?: string } = {}) {
  counter += 1;
  const user = await prisma.user.create({
    data: {
      email: `user${counter}-${Date.now()}@test.local`,
      name: overrides.name ?? `User ${counter}`,
      passwordHash,
      timezone: overrides.timezone ?? 'UTC',
      emailVerified: true,
    },
  });
  return { user, auth: `Bearer ${tokenFor(user.id)}` };
}

export function tokenFor(userId: number) {
  return jwt.sign({ userId }, process.env.JWT_SECRET!, { algorithm: 'HS256', expiresIn: '15m' });
}

export async function createGoal(
  auth: string,
  body: Record<string, unknown> = {}
): Promise<{ id: number } & Record<string, any>> {
  const res = await api()
    .post('/goals')
    .set('Authorization', auth)
    .send({
      name: 'Learn Angular',
      type: 'TIME',
      mode: 'DEADLINE',
      target: 40 * 3600,
      startDate: '2026-01-01',
      deadline: '2026-12-31',
      ...body,
    });
  if (res.status !== 201) {
    throw new Error(`createGoal failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

/** Inserts a finished entry directly, bypassing "not in the future" checks. */
export async function insertEntry(
  userId: number,
  goalId: number | null,
  startIso: string,
  endIso: string
) {
  return await prisma.timeEntry.create({
    data: { userId, goalId, startedAt: new Date(startIso), endedAt: new Date(endIso) },
  });
}

/** Makes a second user a member of the goal through a real invite. */
export async function joinGoal(ownerAuth: string, memberAuth: string, goalId: number) {
  const invite = await api().post(`/goals/${goalId}/invites`).set('Authorization', ownerAuth);
  // Every test request comes from one IP; tests joining many members would hit the limit.
  await prisma.rateLimitEntry.deleteMany();
  const res = await api()
    .post(`/invites/${invite.body.token}/accept`)
    .set('Authorization', memberAuth);
  if (res.status !== 200) {
    throw new Error(`joinGoal failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

export const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();
