import { prisma } from '../src/config/prismaClient';
import { cleanDatabase } from './helpers';

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});
