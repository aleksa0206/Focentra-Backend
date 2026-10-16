import { prisma } from '../config/prismaClient';

/**
 * Counts one hit and returns the count in the current window. One upsert statement, so two
 * parallel requests cannot both read the old count (a read-then-write would undercount).
 */
export async function hit(key: string, windowMs: number): Promise<number> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + windowMs);
  // MySQL evaluates the assignments left to right: `count` still sees the old `expiresAt`.
  await prisma.$executeRaw`
    INSERT INTO RateLimitEntry (\`key\`, count, expiresAt) VALUES (${key}, 1, ${expiresAt})
    ON DUPLICATE KEY UPDATE
      count = IF(expiresAt < ${now}, 1, count + 1),
      expiresAt = IF(expiresAt < ${now}, ${expiresAt}, expiresAt)`;
  const entry = await prisma.rateLimitEntry.findUnique({ where: { key }, select: { count: true } });
  return entry?.count ?? 1;
}

export async function cleanupExpired() {
  await prisma.rateLimitEntry.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}
