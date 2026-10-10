import { env } from './config/env';
import app from './app';
import { logger } from './config/logger';
import { prisma } from './config/prismaClient';
import * as rateLimitRepository from './repositories/rateLimitRepository';
import * as refreshTokenRepository from './repositories/refreshTokenRepository';

const server = app.listen(env.PORT, () => {
  logger.info(`Server listening on port ${env.PORT}`);
});

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => {
    logger.error('Forced shutdown: timeout exceeded.');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// The process is in an unknown state after these: log why, exit, and let Docker restart it.
function crash(kind: string, err: unknown) {
  logger.fatal({ err }, kind);
  process.exit(1);
}
process.on('unhandledRejection', (err) => crash('Unhandled promise rejection', err));
process.on('uncaughtException', (err) => crash('Uncaught exception', err));

// Expired rows are never read again; without this both tables only grow.
setInterval(
  () => {
    Promise.all([
      rateLimitRepository.cleanupExpired(),
      refreshTokenRepository.deleteExpired(),
    ]).catch((err) => logger.error({ err }, 'Cleanup of expired rows failed'));
  },
  60 * 60 * 1000
).unref();
