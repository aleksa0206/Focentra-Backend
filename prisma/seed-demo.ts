// Creates a demo account with goals and a year of study sessions, so the heatmap and charts have
// something to show. Runs once per database: if the demo user exists it does nothing.
//   npm run seed:demo
import 'dotenv/config';
import bcrypt from 'bcrypt';
import { prisma } from '../src/config/prismaClient';
import { addDaysToKey, dateKeyToColumn, localDateKey, startOfLocalDate } from '../src/lib/time';

const EMAIL = 'demo@focentra.local';
const PASSWORD = 'Password123';
const TIMEZONE = 'Europe/Belgrade';
const DAY_MS = 86_400_000;

// Deterministic "random" numbers, so every seeded database looks the same.
let seed = 42;
function random() {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}

async function main() {
  if (await prisma.user.findUnique({ where: { email: EMAIL } })) {
    console.log(`Demo data already exists (${EMAIL}). Nothing to do.`);
    return;
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const user = await prisma.user.create({
    data: {
      email: EMAIL,
      name: 'Demo Student',
      passwordHash,
      timezone: TIMEZONE,
      emailVerified: true,
    },
  });
  const friend = await prisma.user.create({
    data: {
      email: 'friend@focentra.local',
      name: 'Study Buddy',
      passwordHash,
      timezone: TIMEZONE,
      emailVerified: true,
    },
  });

  const today = localDateKey(new Date(), TIMEZONE);
  const goal = (data: {
    name: string;
    type: 'TIME' | 'COUNT';
    unit?: string;
    mode: 'DEADLINE' | 'RECURRING';
    period?: 'WEEKLY' | 'MONTHLY';
    target: number;
    startOffset: number;
    deadlineOffset?: number;
  }) =>
    prisma.goal.create({
      data: {
        ownerId: user.id,
        name: data.name,
        type: data.type,
        unit: data.unit ?? null,
        mode: data.mode,
        period: data.period ?? null,
        startDate: dateKeyToColumn(addDaysToKey(today, data.startOffset)),
        deadline:
          data.deadlineOffset === undefined
            ? null
            : dateKeyToColumn(addDaysToKey(today, data.deadlineOffset)),
        timezone: TIMEZONE,
        targets: {
          create: { value: data.target, effectiveFrom: new Date(Date.now() - 400 * DAY_MS) },
        },
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });

  const angular = await goal({
    name: 'Learn Angular',
    type: 'TIME',
    mode: 'DEADLINE',
    target: 120 * 3600,
    startOffset: -60,
    deadlineOffset: 40,
  });
  const weekly = await goal({
    name: 'Study 8 h a week',
    type: 'TIME',
    mode: 'RECURRING',
    period: 'WEEKLY',
    target: 8 * 3600,
    startOffset: -365,
  });
  const book = await goal({
    name: 'Read "Designing Data-Intensive Applications"',
    type: 'COUNT',
    unit: 'pages',
    mode: 'DEADLINE',
    target: 600,
    startOffset: -30,
    deadlineOffset: 30,
  });
  const shared = await goal({
    name: 'Exam prep group',
    type: 'TIME',
    mode: 'DEADLINE',
    target: 200 * 3600,
    startOffset: -20,
    deadlineOffset: 25,
  });
  await prisma.goalMember.create({
    data: { goalId: shared.id, userId: friend.id, role: 'MEMBER' },
  });

  // One or two sessions on most days of the past year, more on weekdays.
  const entries = [];
  for (let offset = -364; offset <= -1; offset++) {
    const dateKey = addDaysToKey(today, offset);
    const weekday = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
    // The last week is always active, so the dashboard shows a streak.
    if (offset < -7 && random() < (weekday === 0 || weekday === 6 ? 0.45 : 0.2)) {
      continue;
    }
    const sessions = random() < 0.35 ? 2 : 1;
    let hour = 9 + Math.floor(random() * 4);
    for (let s = 0; s < sessions; s++) {
      const start = new Date(startOfLocalDate(dateKey, TIMEZONE).getTime() + hour * 3600_000);
      const minutes = 25 + Math.floor(random() * 150);
      const goalId =
        offset >= -60 && random() < 0.5
          ? angular.id
          : offset >= -20 && random() < 0.3
            ? shared.id
            : weekly.id;
      entries.push({
        userId: user.id,
        goalId,
        startedAt: start,
        endedAt: new Date(start.getTime() + minutes * 60_000),
        note: null,
      });
      hour += Math.ceil(minutes / 60) + 1 + Math.floor(random() * 3);
    }
  }
  await prisma.timeEntry.createMany({ data: entries });

  for (let offset = -19; offset <= -1; offset++) {
    const start = new Date(
      startOfLocalDate(addDaysToKey(today, offset), TIMEZONE).getTime() + 18 * 3600_000
    );
    await prisma.timeEntry.create({
      data: {
        userId: friend.id,
        goalId: shared.id,
        startedAt: start,
        endedAt: new Date(start.getTime() + (60 + Math.floor(random() * 120)) * 60_000),
      },
    });
  }

  for (let offset = -29; offset <= 0; offset++) {
    if (random() < 0.4) continue;
    await prisma.progressEntry.create({
      data: {
        userId: user.id,
        goalId: book.id,
        amount: 5 + Math.floor(random() * 25),
        occurredOn: dateKeyToColumn(addDaysToKey(today, offset)),
      },
    });
  }

  console.log(`Demo data created. Sign in as ${EMAIL} / ${PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
