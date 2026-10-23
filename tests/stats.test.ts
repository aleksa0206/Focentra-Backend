import { api, createGoal, createUser, insertEntry } from './helpers';

describe('statistics', () => {
  it('splits the heatmap at local midnight (US-06)', async () => {
    const { user, auth } = await createUser({ timezone: 'Europe/Belgrade' });
    // 23:30-00:30 in Belgrade (UTC+1 in November).
    await insertEntry(user.id, null, '2026-11-10T22:30:00Z', '2026-11-10T23:30:00Z');

    const res = await api()
      .get('/stats/heatmap?from=2026-11-01&to=2026-11-30')
      .set('Authorization', auth);
    expect(res.body.days).toEqual([
      { date: '2026-11-10', seconds: 1800 },
      { date: '2026-11-11', seconds: 1800 },
    ]);

    // The same entry, seen from UTC, falls on one day.
    await api().patch('/me').set('Authorization', auth).send({ timezone: 'UTC' });
    const utc = await api()
      .get('/stats/heatmap?from=2026-11-01&to=2026-11-30')
      .set('Authorization', auth);
    expect(utc.body.days).toEqual([{ date: '2026-11-10', seconds: 3600 }]);
  });

  it('limits the range', async () => {
    const { auth } = await createUser();
    expect(
      (await api().get('/stats/heatmap?from=2025-01-01&to=2026-06-01').set('Authorization', auth))
        .status
    ).toBe(400);
    expect(
      (await api().get('/stats/heatmap?from=2026-02-01&to=2026-01-01').set('Authorization', auth))
        .status
    ).toBe(400);
    expect((await api().get('/stats/heatmap?from=nope').set('Authorization', auth)).status).toBe(
      400
    );
  });

  it('returns weekly totals, oldest first', async () => {
    const { auth } = await createUser();
    const res = await api().get('/stats/trend?weeks=4').set('Authorization', auth);
    expect(res.body.weeks).toHaveLength(4);
    expect(res.body.weeks[0].weekStart < res.body.weeks[3].weekStart).toBe(true);
    expect((await api().get('/stats/trend?weeks=99').set('Authorization', auth)).status).toBe(400);
  });

  it('breaks time down by goal', async () => {
    const { user, auth } = await createUser();
    const goal = await createGoal(auth, { name: 'Angular' });
    await insertEntry(user.id, goal.id, '2026-04-01T10:00:00Z', '2026-04-01T12:00:00Z');
    await insertEntry(user.id, null, '2026-04-02T10:00:00Z', '2026-04-02T10:30:00Z');

    const res = await api()
      .get('/stats/breakdown?from=2026-04-01&to=2026-04-30')
      .set('Authorization', auth);
    expect(res.body.items).toEqual([
      { goalId: goal.id, name: 'Angular', seconds: 7200 },
      { goalId: null, name: null, seconds: 1800 },
    ]);
  });
});
