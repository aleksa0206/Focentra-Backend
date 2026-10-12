import { RefreshToken } from '@prisma/client';
import { prisma } from '../config/prismaClient';

export async function createRefreshToken(data: {
  userId: number;
  token: string;
  expiresAt: Date;
}): Promise<RefreshToken> {
  return await prisma.refreshToken.create({ data });
}

export async function revokeRefreshToken(refreshTokenId: number): Promise<RefreshToken> {
  return await prisma.refreshToken.update({
    where: { id: refreshTokenId },
    data: { revoked: true },
  });
}

export async function revokeRefreshTokenIfActive(refreshTokenId: number): Promise<boolean> {
  const result = await prisma.refreshToken.updateMany({
    where: { id: refreshTokenId, revoked: false },
    data: { revoked: true },
  });
  return result.count === 1;
}

export async function findRefreshTokenByTokenHash(tokenHash: string) {
  return await prisma.refreshToken.findUnique({ where: { token: tokenHash } });
}

export async function deleteExpired() {
  await prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}

export async function revokeAllForUser(userId: number) {
  return await prisma.refreshToken.updateMany({
    where: { userId, revoked: false },
    data: { revoked: true },
  });
}
