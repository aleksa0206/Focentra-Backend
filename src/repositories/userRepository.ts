import { Prisma, type User } from '@prisma/client';
import { prisma } from '../config/prismaClient';

const safeUserSelect = {
  id: true,
  email: true,
  name: true,
  timezone: true,
  twoFactorEnabled: true,
  createdAt: true,
} as const;

export type SafeUser = Prisma.UserGetPayload<{ select: typeof safeUserSelect }>;

export function toSafeUser(user: User): SafeUser {
  const { id, email, name, timezone, twoFactorEnabled, createdAt } = user;
  return { id, email, name, timezone, twoFactorEnabled, createdAt };
}

export async function create(data: {
  email: string;
  name: string;
  passwordHash: string;
  timezone: string;
  emailVerificationTokenHash: string;
  emailVerificationExpiresAt: Date;
}) {
  return await prisma.user.create({ data });
}

export async function findById(id: number) {
  return await prisma.user.findUnique({ where: { id } });
}

export async function findByEmail(email: string) {
  return await prisma.user.findUnique({ where: { email } });
}

export async function findSafeById(id: number) {
  return await prisma.user.findUnique({ where: { id }, select: safeUserSelect });
}

export async function updateProfile(id: number, data: { name?: string; timezone?: string }) {
  return await prisma.user.update({ where: { id }, data, select: safeUserSelect });
}

export async function remove(id: number) {
  await prisma.user.delete({ where: { id } });
}

/** Atomic increment: parallel wrong guesses each see their own count. */
export async function incrementFailedLoginAttempts(id: number) {
  const user = await prisma.user.update({
    where: { id },
    data: { failedLoginAttempts: { increment: 1 } },
    select: { failedLoginAttempts: true },
  });
  return user.failedLoginAttempts;
}

export async function setAccountLock(id: number, lockedUntil: Date | null) {
  await prisma.user.update({ where: { id }, data: { lockedUntil, failedLoginAttempts: 0 } });
}

export async function setEmailVerificationToken(id: number, tokenHash: string, expiresAt: Date) {
  await prisma.user.update({
    where: { id },
    data: { emailVerificationTokenHash: tokenHash, emailVerificationExpiresAt: expiresAt },
  });
}

export async function findByEmailVerificationTokenHash(tokenHash: string) {
  return await prisma.user.findUnique({ where: { emailVerificationTokenHash: tokenHash } });
}

/** Marks the email verified only if the token is still valid; true when this call consumed it. */
export async function consumeEmailVerificationToken(id: number, tokenHash: string) {
  const result = await prisma.user.updateMany({
    where: {
      id,
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpiresAt: { gt: new Date() },
    },
    data: {
      emailVerified: true,
      emailVerificationTokenHash: null,
      emailVerificationExpiresAt: null,
    },
  });
  return result.count === 1;
}

export async function setPasswordResetToken(id: number, tokenHash: string, expiresAt: Date) {
  await prisma.user.update({
    where: { id },
    data: { resetPasswordTokenHash: tokenHash, resetPasswordExpiresAt: expiresAt },
  });
}

export async function findByResetTokenHash(tokenHash: string) {
  return await prisma.user.findUnique({ where: { resetPasswordTokenHash: tokenHash } });
}

/** Sets the new password only if the token is still valid; two parallel resets cannot both win. */
export async function consumeResetTokenAndSetPassword(
  id: number,
  tokenHash: string,
  passwordHash: string
) {
  const result = await prisma.user.updateMany({
    where: { id, resetPasswordTokenHash: tokenHash, resetPasswordExpiresAt: { gt: new Date() } },
    data: {
      passwordHash,
      resetPasswordTokenHash: null,
      resetPasswordExpiresAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });
  return result.count === 1;
}

export async function setTwoFactorSecret(id: number, secret: string) {
  await prisma.user.update({ where: { id }, data: { twoFactorSecret: secret } });
}

export async function enableTwoFactor(id: number) {
  await prisma.user.update({ where: { id }, data: { twoFactorEnabled: true } });
}

export async function disableTwoFactor(id: number) {
  await prisma.user.update({
    where: { id },
    data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorLastTimeStep: null },
  });
}

/** A TOTP code is valid for its whole 30 s window; it may be used only once. */
export async function consumeTwoFactorTimeStep(id: number, timeStep: number) {
  const result = await prisma.user.updateMany({
    where: {
      id,
      OR: [{ twoFactorLastTimeStep: null }, { twoFactorLastTimeStep: { lt: timeStep } }],
    },
    data: { twoFactorLastTimeStep: timeStep },
  });
  return result.count === 1;
}
