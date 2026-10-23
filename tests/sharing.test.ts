import { prisma } from '../src/config/prismaClient';
import { MAX_MEMBERS } from '../src/services/memberService';
import { api, createGoal, createUser, insertEntry, joinGoal } from './helpers';

describe('invites', () => {
  it('previews and accepts an invite (US-05)', async () => {
    const owner = await createUser({ name: 'Owner' });
    const marko = await createUser({ name: 'Marko' });
    const goal = await createGoal(owner.auth);

    const invite = await api().post(`/goals/${goal.id}/invites`).set('Authorization', owner.auth);
    expect(invite.status).toBe(201);
    expect(invite.body.token).toMatch(/^[0-9a-f]{64}$/);
    // Only a hash is stored.
    expect(await prisma.goalInvite.count({ where: { tokenHash: invite.body.token } })).toBe(0);

    const preview = await api()
      .get(`/invites/${invite.body.token}`)
      .set('Authorization', marko.auth);
    expect(preview.body).toMatchObject({
      ownerName: 'Owner',
      alreadyMember: false,
      goal: { name: 'Learn Angular' },
    });

    const accept = await api()
      .post(`/invites/${invite.body.token}/accept`)
      .set('Authorization', marko.auth);
    expect(accept.body).toEqual({ goalId: goal.id });
    // Accepting again is harmless.
    expect(
      (await api().post(`/invites/${invite.body.token}/accept`).set('Authorization', marko.auth))
        .status
    ).toBe(200);
    expect(await prisma.goalMember.count({ where: { goalId: goal.id } })).toBe(2);
  });

  it('refuses revoked, expired and unknown invites with 410', async () => {
    const owner = await createUser();
    const guest = await createUser();
    const goal = await createGoal(owner.auth);
    const revoked = await api().post(`/goals/${goal.id}/invites`).set('Authorization', owner.auth);
    await api()
      .delete(`/goals/${goal.id}/invites/${revoked.body.id}`)
      .set('Authorization', owner.auth);
    const expired = await api().post(`/goals/${goal.id}/invites`).set('Authorization', owner.auth);
    await prisma.goalInvite.update({
      where: { id: expired.body.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    for (const token of [revoked.body.token, expired.body.token, 'f'.repeat(64)]) {
      const res = await api().post(`/invites/${token}/accept`).set('Authorization', guest.auth);
      expect(res.status).toBe(410);
      expect(res.body.code).toBe('INVITE_INVALID');
    }
  });

  it(`stops at ${MAX_MEMBERS} members, also under parallel accepts`, async () => {
    const owner = await createUser();
    const goal = await createGoal(owner.auth);
    for (let i = 0; i < MAX_MEMBERS - 2; i++) {
      await joinGoal(owner.auth, (await createUser()).auth, goal.id);
    }
    const invite = await api().post(`/goals/${goal.id}/invites`).set('Authorization', owner.auth);
    const last = await Promise.all([createUser(), createUser()]);
    const results = await Promise.all(
      last.map((u) =>
        api().post(`/invites/${invite.body.token}/accept`).set('Authorization', u.auth)
      )
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.goalMember.count({ where: { goalId: goal.id } })).toBe(MAX_MEMBERS);
  });
});

describe('visibility in a shared goal', () => {
  it('members see entries on the goal and nothing else of each other', async () => {
    const owner = await createUser({ name: 'Owner' });
    const member = await createUser({ name: 'Member' });
    const shared = await createGoal(owner.auth, { name: 'Shared' });
    const privateGoal = await createGoal(owner.auth, { name: 'Private' });
    await joinGoal(owner.auth, member.auth, shared.id);

    await insertEntry(owner.user.id, shared.id, '2026-03-01T10:00:00Z', '2026-03-01T11:00:00Z');
    await insertEntry(
      owner.user.id,
      privateGoal.id,
      '2026-03-02T10:00:00Z',
      '2026-03-02T11:00:00Z'
    );
    await insertEntry(owner.user.id, null, '2026-03-03T10:00:00Z', '2026-03-03T11:00:00Z');
    await insertEntry(member.user.id, shared.id, '2026-03-01T12:00:00Z', '2026-03-01T14:00:00Z');

    const entries = await api()
      .get(`/goals/${shared.id}/time-entries`)
      .set('Authorization', member.auth);
    expect(entries.body.data).toHaveLength(2);
    expect(entries.body.data.map((e: { user: { name: string } }) => e.user.name).sort()).toEqual([
      'Member',
      'Owner',
    ]);

    const detail = await api().get(`/goals/${shared.id}`).set('Authorization', member.auth);
    expect(detail.body.progress.value).toBe(3 * 3600);
    expect(detail.body.contributions).toEqual([
      { userId: member.user.id, name: 'Member', value: 7200 },
      { userId: owner.user.id, name: 'Owner', value: 3600 },
    ]);

    expect(
      (await api().get(`/goals/${privateGoal.id}`).set('Authorization', member.auth)).status
    ).toBe(404);
    // Own lists and stats never include other people's entries.
    const own = await api().get('/time-entries').set('Authorization', member.auth);
    expect(own.body.data).toHaveLength(1);
    const heatmap = await api()
      .get('/stats/heatmap?from=2026-03-01&to=2026-03-31')
      .set('Authorization', member.auth);
    expect(heatmap.body.days).toEqual([{ date: '2026-03-01', seconds: 7200 }]);

    const members = await api()
      .get(`/goals/${shared.id}/members`)
      .set('Authorization', member.auth);
    expect(members.body[0]).not.toHaveProperty('email');
  });

  it("leaving detaches the member's entries from the goal (D-1)", async () => {
    const owner = await createUser();
    const member = await createUser();
    const goal = await createGoal(owner.auth);
    await joinGoal(owner.auth, member.auth, goal.id);
    const entry = await insertEntry(
      member.user.id,
      goal.id,
      '2026-03-01T12:00:00Z',
      '2026-03-01T14:00:00Z'
    );

    expect(
      (
        await api()
          .delete(`/goals/${goal.id}/members/${member.user.id}`)
          .set('Authorization', member.auth)
      ).status
    ).toBe(204);
    expect(await prisma.timeEntry.findUnique({ where: { id: entry.id } })).toMatchObject({
      goalId: null,
    });
    expect((await api().get(`/goals/${goal.id}`).set('Authorization', member.auth)).status).toBe(
      404
    );
    expect(
      (await api().post('/timer/start').set('Authorization', member.auth).send({ goalId: goal.id }))
        .status
    ).toBe(404);
  });

  it('owner can remove members but cannot leave; members cannot remove others', async () => {
    const owner = await createUser();
    const a = await createUser();
    const b = await createUser();
    const goal = await createGoal(owner.auth);
    await joinGoal(owner.auth, a.auth, goal.id);
    await joinGoal(owner.auth, b.auth, goal.id);

    expect(
      (await api().delete(`/goals/${goal.id}/members/${b.user.id}`).set('Authorization', a.auth))
        .status
    ).toBe(403);
    const leave = await api()
      .delete(`/goals/${goal.id}/members/${owner.user.id}`)
      .set('Authorization', owner.auth);
    expect(leave.status).toBe(409);
    expect(leave.body.code).toBe('OWNER_CANNOT_LEAVE');
    expect(
      (
        await api()
          .delete(`/goals/${goal.id}/members/${b.user.id}`)
          .set('Authorization', owner.auth)
      ).status
    ).toBe(204);
  });
});
