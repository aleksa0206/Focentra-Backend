import { prisma } from '../src/config/prismaClient';
import { api, createGoal, createUser, insertEntry, joinGoal } from './helpers';
import { localDateKey, addDaysToKey } from '../src/lib/time';

describe('creating and editing goals', () => {
  it('creates a deadline goal in hours and a recurring goal in units', async () => {
    const { auth } = await createUser({ timezone: 'Europe/Belgrade' });
    const deadline = await createGoal(auth);
    expect(deadline).toMatchObject({
      type: 'TIME',
      mode: 'DEADLINE',
      target: 144000,
      role: 'OWNER',
      memberCount: 1,
      timezone: 'Europe/Belgrade',
      progress: { value: 0 },
    });

    const recurring = await createGoal(auth, {
      type: 'COUNT',
      unit: 'pages',
      mode: 'RECURRING',
      period: 'WEEKLY',
      target: 100,
      deadline: undefined,
    });
    expect(recurring).toMatchObject({ unit: 'pages', period: 'WEEKLY', deadline: null });

    const list = await api().get('/goals').set('Authorization', auth);
    expect(list.body.map((g: { id: number }) => g.id).sort()).toEqual(
      [deadline.id, recurring.id].sort()
    );
  });

  it('rejects inconsistent goals', async () => {
    const { auth } = await createUser();
    const base = { name: 'x', target: 10, startDate: '2026-01-01' };
    const bad = [
      { ...base, type: 'COUNT', mode: 'RECURRING', period: 'WEEKLY' }, // no unit
      { ...base, type: 'TIME', unit: 'h', mode: 'RECURRING', period: 'WEEKLY' }, // unit on TIME
      { ...base, type: 'TIME', mode: 'DEADLINE' }, // no deadline
      { ...base, type: 'TIME', mode: 'RECURRING' }, // no period
      { ...base, type: 'TIME', mode: 'DEADLINE', deadline: '2025-12-31' }, // deadline before start
      { ...base, type: 'TIME', mode: 'RECURRING', period: 'WEEKLY', target: 0 },
    ];
    for (const body of bad) {
      expect((await api().post('/goals').set('Authorization', auth).send(body)).status).toBe(400);
    }
  });

  it('keeps type and mode fixed', async () => {
    const { auth } = await createUser();
    const goal = await createGoal(auth);
    expect(
      (await api().patch(`/goals/${goal.id}`).set('Authorization', auth).send({ type: 'COUNT' }))
        .status
    ).toBe(400);
  });

  it('records target changes instead of overwriting them', async () => {
    const { auth } = await createUser();
    const goal = await createGoal(auth);
    const res = await api()
      .patch(`/goals/${goal.id}`)
      .set('Authorization', auth)
      .send({ target: 3600 });
    expect(res.body.target).toBe(3600);
    expect(await prisma.goalTarget.count({ where: { goalId: goal.id } })).toBe(2);
  });

  it('archiving stops timers running on the goal', async () => {
    const { auth } = await createUser();
    const goal = await createGoal(auth);
    await api().post('/timer/start').set('Authorization', auth).send({ goalId: goal.id });

    await api().patch(`/goals/${goal.id}`).set('Authorization', auth).send({ archived: true });
    expect((await api().get('/timer').set('Authorization', auth)).body.entry).toBeNull();
    expect((await api().get('/goals').set('Authorization', auth)).body).toHaveLength(0);
    expect((await api().get('/goals?state=archived').set('Authorization', auth)).body).toHaveLength(
      1
    );
  });

  it('deleting a goal keeps the time entries, without the goal', async () => {
    const { user, auth } = await createUser();
    const goal = await createGoal(auth);
    const entry = await insertEntry(
      user.id,
      goal.id,
      '2026-02-01T10:00:00Z',
      '2026-02-01T11:00:00Z'
    );

    expect((await api().delete(`/goals/${goal.id}`).set('Authorization', auth)).status).toBe(204);
    expect(await prisma.timeEntry.findUnique({ where: { id: entry.id } })).toMatchObject({
      goalId: null,
    });
  });
});

describe('access control', () => {
  it("hides other users' goals behind 404", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const goal = await createGoal(owner.auth);

    for (const path of ['', '/chart', '/members', '/time-entries', '/progress-entries']) {
      expect(
        (await api().get(`/goals/${goal.id}${path}`).set('Authorization', stranger.auth)).status
      ).toBe(404);
    }
    expect(
      (
        await api()
          .patch(`/goals/${goal.id}`)
          .set('Authorization', stranger.auth)
          .send({ name: 'x' })
      ).status
    ).toBe(404);
    expect(
      (await api().delete(`/goals/${goal.id}`).set('Authorization', stranger.auth)).status
    ).toBe(404);
  });

  it('lets members read but not change the goal', async () => {
    const owner = await createUser();
    const member = await createUser();
    const goal = await createGoal(owner.auth);
    await joinGoal(owner.auth, member.auth, goal.id);

    expect((await api().get(`/goals/${goal.id}`).set('Authorization', member.auth)).status).toBe(
      200
    );
    const edit = await api()
      .patch(`/goals/${goal.id}`)
      .set('Authorization', member.auth)
      .send({ name: 'mine' });
    expect(edit.status).toBe(403);
    expect(edit.body.code).toBe('NOT_GOAL_OWNER');
    expect((await api().delete(`/goals/${goal.id}`).set('Authorization', member.auth)).status).toBe(
      403
    );
    expect(
      (await api().post(`/goals/${goal.id}/invites`).set('Authorization', member.auth)).status
    ).toBe(403);
  });
});

describe('progress and pace', () => {
  it('computes progress and BEHIND for a deadline goal (US-03)', async () => {
    const { user, auth } = await createUser();
    // Started 50 days ago, ends in 50 days: half the time is gone, so 20 of 40 h are expected.
    const today = localDateKey(new Date(), 'UTC');
    const goal = await createGoal(auth, {
      startDate: addDaysToKey(today, -50),
      deadline: addDaysToKey(today, 49),
    });
    const tenDaysAgo = new Date(Date.now() - 10 * 86400_000);
    await insertEntry(
      user.id,
      goal.id,
      tenDaysAgo.toISOString(),
      new Date(tenDaysAgo.getTime() + 14 * 3600_000).toISOString()
    );

    const res = await api().get(`/goals/${goal.id}`).set('Authorization', auth);
    expect(res.body.progress.value).toBe(14 * 3600);
    expect(res.body.progress.status).toBe('BEHIND');
    expect(res.body.progress.expected).toBeGreaterThan(19 * 3600);
    expect(res.body.progress.expected).toBeLessThan(21 * 3600);
  });

  it('ignores time outside the goal window and counts a running timer', async () => {
    const { user, auth } = await createUser();
    const today = localDateKey(new Date(), 'UTC');
    const goal = await createGoal(auth, { startDate: today, deadline: addDaysToKey(today, 30) });
    await insertEntry(user.id, goal.id, '2020-01-01T10:00:00Z', '2020-01-01T12:00:00Z');
    await prisma.timeEntry.create({
      data: {
        userId: user.id,
        goalId: goal.id,
        startedAt: new Date(Date.now() - 600_000),
        runningUserId: user.id,
      },
    });

    const res = await api().get(`/goals/${goal.id}`).set('Authorization', auth);
    expect(res.body.progress.value).toBeGreaterThanOrEqual(600);
    expect(res.body.progress.value).toBeLessThan(700);
  });

  it('sums progress entries for a goal in units and keeps period history', async () => {
    const { auth } = await createUser();
    const goal = await createGoal(auth, {
      type: 'COUNT',
      unit: 'pages',
      mode: 'RECURRING',
      period: 'WEEKLY',
      target: 100,
      startDate: '2025-01-06',
      deadline: undefined,
    });
    const add = (amount: number, occurredOn?: string) =>
      api()
        .post(`/goals/${goal.id}/progress-entries`)
        .set('Authorization', auth)
        .send({ amount, occurredOn });

    expect((await add(30)).status).toBe(201);
    expect((await add(25)).status).toBe(201);
    expect((await add(5, '2099-01-01')).status).toBe(400);

    const res = await api().get(`/goals/${goal.id}`).set('Authorization', auth);
    expect(res.body.progress.value).toBe(55);

    const periods = await api().get(`/goals/${goal.id}/periods`).set('Authorization', auth);
    expect(periods.status).toBe(200);
    expect(periods.body).toHaveLength(12);
    expect(periods.body[0]).toMatchObject({
      current: true,
      value: 55,
      target: 100,
      achieved: false,
    });
  });

  it('keeps the old target for past periods (D-2)', async () => {
    const { auth } = await createUser();
    const goal = await createGoal(auth, {
      mode: 'RECURRING',
      period: 'WEEKLY',
      target: 8 * 3600,
      startDate: '2025-01-06',
      deadline: undefined,
    });
    // Pretend the first target was set long ago, then change it now.
    await prisma.goalTarget.updateMany({
      where: { goalId: goal.id },
      data: { effectiveFrom: new Date('2025-01-01') },
    });
    await api()
      .patch(`/goals/${goal.id}`)
      .set('Authorization', auth)
      .send({ target: 10 * 3600 });

    const periods = (await api().get(`/goals/${goal.id}/periods`).set('Authorization', auth)).body;
    expect(periods[0].target).toBe(10 * 3600);
    expect(periods[1].target).toBe(8 * 3600);
  });

  it('builds a cumulative chart', async () => {
    const { user, auth } = await createUser();
    const today = localDateKey(new Date(), 'UTC');
    const goal = await createGoal(auth, {
      startDate: addDaysToKey(today, -2),
      deadline: addDaysToKey(today, 10),
    });
    const yesterday = `${addDaysToKey(today, -1)}T10:00:00Z`;
    await insertEntry(user.id, goal.id, yesterday, `${addDaysToKey(today, -1)}T11:00:00Z`);

    const chart = (await api().get(`/goals/${goal.id}/chart`).set('Authorization', auth)).body;
    expect(chart.points.map((p: { value: number }) => p.value)).toEqual([0, 3600, 3600]);
  });
});
