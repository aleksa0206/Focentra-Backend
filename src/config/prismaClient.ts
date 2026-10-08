import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';
import { env } from './env';

const adapter = new PrismaMariaDb({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  connectionLimit: 10,
  // MySQL 8 (caching_sha2_password) needs a full handshake on the first login after a server
  // restart; without this the driver cannot complete it and the pool just times out. The
  // database is only ever reached over localhost or a private Docker network.
  allowPublicKeyRetrieval: true,
});

export const prisma = new PrismaClient({ adapter });
