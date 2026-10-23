import { prisma } from '../src/config/prismaClient';
import { api, createGoal, createUser, hoursAgo, insertEntry } from './helpers';

describe('timer', () => {
  it('starts, reports and stops a timer on a goal', async () => {
    const { auth } = await createUser();
    const goal = await createGoal(auth);

    const start = await api()
      .post('/timer/start')
      .set('Authorization', auth)
      .send({ goalId: goal.id, note: 'ch. 3' });
    expect(start.status).toBe(201);
    expect(start.body).toMatchObject({ goalId: goal.id, running: true, note: 'ch. 3' });

    const running = await api().get('/timer').set('Authorization', auth);
    expect(running.body.entry.id).toBe(start.body.id);

    const stop = await api().post('/timer/stop').set('Authorization', auth);
    expect(stop.status).toBe(200);
    expect(stop.body).toMatchObject({ id: start.body.id, running: false });
    expect((await api().get('/timer').set('Authorization', auth)).body.entry).toBeNull();
  });

  it('allows only one running timer, also for parallel starts', async () => {
    const { auth } = await createUser();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        api().post('/timer/start').set('Authorization', auth).send({})
      )
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe('TIMER_ALREADY_RUNNING');
    expect(await prisma.timeEntry.count({ where: { endedAt: null } })).toBe(1);
  });

  it('a second stop finds nothing to stop', async () => {
    const { auth } = await createUser();
    await api().post('/timer/start').set('Authorization', auth).send({});
    const [a, b] = await Promise.all([
      api().post('/timer/stop').set('Authorization', auth),
      api().post('/timer/stop').set('Authorization', auth),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a, b].find((r) => r.status === 409)!.body.code).toBe('NO_TIMER_RUNNING');
  });

  it("cannot run on a goal measured in units, an archived goal or someone else's goal", async () => {
    const { auth } = await createUser();
    const other = await createUser();
    const countGoal = await createGoal(auth, { type: 'COUNT', unit: 'pages', target: 300 });
    const archived = await createGoal(auth);
    await api().patch(`/goals/${archived.id}`).set('Authorization', auth).send({ archived: true });
    const foreign = await createGoal(other.auth);

    expect(
      (await api().post('/timer/start').set('Authorization', auth).send({ goalId: countGoal.id }))
        .status
    ).toBe(400);
    const onArchived = await api()
      .post('/timer/start')
      .set('Authorization', auth)
      .send({ goalId: archived.id });
    expect(onArchived.status).toBe(409);
    expect(onArchived.body.code).toBe('GOAL_ARCHIVED');
    expect(
      (await api().post('/timer/start').set('Authorization', auth).send({ goalId: foreign.id }))
        .status
    ).toBe(404);
  });
});

describe('manual time entries', () => {
  it('adds a past entry and lists it', async () => {
    const { auth } = await createUser();
    const res = await api()
      .post('/time-entries')
      .set('Authorization', auth)
      .send({ startedAt: hoursAgo(3), endedAt: hoursAgo(1) });
    expect(res.status).toBe(201);
    expect(res.body.durationSeconds).toBe(7200);

    const list = await api().get('/time-entries').set('Authorization', auth);
    expect(list.body.meta.total).toBe(1);
  });

  it('rejects overlaps and says with which entry (US-02)', async () => {
    const { user, auth } = await createUser();
    const existing = await insertEntry(
      user.id,
      null,
      '2026-05-01T15:00:00Z',
      '2026-05-01T17:00:00Z'
    );
    const res = await api()
      .post('/time-entries')
      .set('Authorization', auth)
      .send({ startedAt: '2026-05-01T14:00:00Z', endedAt: '2026-05-01T16:00:00Z' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'ENTRY_OVERLAP', overlapping: { id: existing.id } });

    // Touching ends are not an overlap.
    const adjacent = await api()
      .post('/time-entries')
      .set('Authorization', auth)
      .send({ startedAt: '2026-05-01T14:00:00Z', endedAt: '2026-05-01T15:00:00Z' });
    expect(adjacent.status).toBe(201);
  });

  it('lets only one of two parallel overlapping entries in', async () => {
    const { auth } = await createUser();
    const body = { startedAt: '2026-05-02T10:00:00Z', endedAt: '2026-05-02T11:00:00Z' };
    const results = await Promise.all([
      api().post('/time-entries').set('Authorization', auth).send(body),
      api().post('/time-entries').set('Authorization', auth).send(body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('rejects an entry overlapping the running timer', async () => {
    const { auth } = await createUser();
    await api().post('/timer/start').set('Authorization', auth).send({});
    const res = await api()
      .post('/time-entries')
      .set('Authorization', auth)
      .send({ startedAt: hoursAgo(1), endedAt: new Date().toISOString() });
    expect(res.status).toBe(409);
  });

  it('validates the interval', async () => {
    const { auth } = await createUser();
    const send = (startedAt: string, endedAt: string) =>
      api().post('/time-entries').set('Authorization', auth).send({ startedAt, endedAt });

    expect((await send(hoursAgo(1), hoursAgo(2))).status).toBe(400);
    expect((await send(hoursAgo(1), new Date(Date.now() + 3600_000).toISOString())).status).toBe(
      400
    );
    expect((await send(hoursAgo(30), hoursAgo(2))).status).toBe(400);
    expect((await send('yesterday', hoursAgo(2))).status).toBe(400);
  });

  it('edits and deletes only own entries; others get 404', async () => {
    const { user, auth } = await createUser();
    const other = await createUser();
    const entry = await insertEntry(user.id, null, '2026-05-01T10:00:00Z', '2026-05-01T11:00:00Z');

    const edit = await api()
      .patch(`/time-entries/${entry.id}`)
      .set('Authorization', auth)
      .send({ endedAt: '2026-05-01T11:30:00Z', note: 'longer' });
    expect(edit.status).toBe(200);
    expect(edit.body.durationSeconds).toBe(5400);

    expect(
      (
        await api()
          .patch(`/time-entries/${entry.id}`)
          .set('Authorization', other.auth)
          .send({ note: 'x' })
      ).status
    ).toBe(404);
    expect(
      (await api().delete(`/time-entries/${entry.id}`).set('Authorization', other.auth)).status
    ).toBe(404);
    expect(
      (await api().delete(`/time-entries/${entry.id}`).set('Authorization', auth)).status
    ).toBe(204);
  });

  it('cannot end a running entry by editing it', async () => {
    const { auth } = await createUser();
    const start = await api().post('/timer/start').set('Authorization', auth).send({});
    const res = await api()
      .patch(`/time-entries/${start.body.id}`)
      .set('Authorization', auth)
      .send({ endedAt: new Date().toISOString() });
    expect(res.status).toBe(400);
  });
});
