import * as emailService from '../src/services/emailService';
import { prisma } from '../src/config/prismaClient';
import { api, createUser, PASSWORD } from './helpers';

function captureEmails() {
  const sent: { kind: string; to: string; token: string }[] = [];
  jest.spyOn(emailService, 'sendVerificationEmail').mockImplementation(async (to, token) => {
    sent.push({ kind: 'verify', to, token });
  });
  jest.spyOn(emailService, 'sendPasswordResetEmail').mockImplementation(async (to, token) => {
    sent.push({ kind: 'reset', to, token });
  });
  return sent;
}

const refreshCookie = (res: { headers: Record<string, unknown> }) =>
  ([] as string[])
    .concat((res.headers['set-cookie'] as string[]) ?? [])
    .find((c) => c.startsWith('refreshToken='))!
    .split(';')[0]!;

afterEach(() => jest.restoreAllMocks());

describe('registration and email verification', () => {
  it('registers, verifies by link and signs in', async () => {
    const emails = captureEmails();
    const register = await api().post('/auth/register').send({
      name: 'Ana',
      email: 'Ana@Test.local',
      password: PASSWORD,
      timezone: 'Europe/Belgrade',
    });
    expect(register.status).toBe(201);

    const login = await api()
      .post('/auth/login')
      .send({ email: 'ana@test.local', password: PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body.code).toBe('EMAIL_NOT_VERIFIED');

    const verify = await api().post('/auth/verify-email').send({ token: emails[0]!.token });
    expect(verify.status).toBe(200);
    expect(verify.body.user).toMatchObject({
      email: 'ana@test.local',
      timezone: 'Europe/Belgrade',
    });
    expect(verify.body.user.passwordHash).toBeUndefined();

    // The link works once.
    expect((await api().post('/auth/verify-email').send({ token: emails[0]!.token })).status).toBe(
      401
    );
  });

  it('rejects a duplicate email and an unknown time zone', async () => {
    captureEmails();
    const body = { name: 'A', email: 'dup@test.local', password: PASSWORD };
    expect((await api().post('/auth/register').send(body)).status).toBe(201);
    const again = await api().post('/auth/register').send(body);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('EMAIL_TAKEN');

    const badZone = await api()
      .post('/auth/register')
      .send({ ...body, email: 'zone@test.local', timezone: 'Mars/Olympus' });
    expect(badZone.status).toBe(400);
  });

  it('rejects passwords longer than 72 bytes (bcrypt would ignore the rest)', async () => {
    const res = await api()
      .post('/auth/register')
      .send({ name: 'A', email: 'long@test.local', password: 'ž'.repeat(40) });
    expect(res.status).toBe(400);
  });
});

describe('login, lockout and sessions', () => {
  it('locks the account after 5 wrong passwords, even with the right one afterwards', async () => {
    const { user } = await createUser();
    for (let i = 0; i < 4; i++) {
      expect(
        (await api().post('/auth/login').send({ email: user.email, password: 'wrong' })).status
      ).toBe(401);
    }
    expect(
      (await api().post('/auth/login').send({ email: user.email, password: 'wrong' })).status
    ).toBe(423);
    expect(
      (await api().post('/auth/login').send({ email: user.email, password: PASSWORD })).status
    ).toBe(423);
  });

  it('gives the same answer for an unknown email and a wrong password', async () => {
    const { user } = await createUser();
    const unknown = await api()
      .post('/auth/login')
      .send({ email: 'nobody@test.local', password: 'x' });
    const wrong = await api().post('/auth/login').send({ email: user.email, password: 'x' });
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  it('rotates the refresh token and revokes everything when an old one is replayed', async () => {
    const { user } = await createUser();
    const login = await api().post('/auth/login').send({ email: user.email, password: PASSWORD });
    const first = refreshCookie(login);

    const refreshed = await api().post('/auth/refresh').set('Cookie', first);
    expect(refreshed.status).toBe(200);
    const second = refreshCookie(refreshed);
    expect(second).not.toBe(first);

    // Replay after the grace period: treated as theft.
    await prisma.refreshToken.updateMany({
      data: { updatedAt: new Date(Date.now() - 120_000) },
      where: { revoked: true },
    });
    expect((await api().post('/auth/refresh').set('Cookie', first)).status).toBe(401);
    expect((await api().post('/auth/refresh').set('Cookie', second)).status).toBe(401);
  });

  it('logout revokes the session server-side', async () => {
    const { user } = await createUser();
    const cookie = refreshCookie(
      await api().post('/auth/login').send({ email: user.email, password: PASSWORD })
    );
    expect((await api().post('/auth/logout').set('Cookie', cookie)).status).toBe(204);
    expect((await api().post('/auth/refresh').set('Cookie', cookie)).status).toBe(401);
  });

  it('rejects a missing, malformed or 2FA temp token on protected routes', async () => {
    expect((await api().get('/auth/me')).status).toBe(401);
    expect((await api().get('/auth/me').set('Authorization', 'Bearer nope')).status).toBe(401);
  });
});

describe('password reset', () => {
  it('resets once, signs out other sessions and unlocks the account', async () => {
    const emails = captureEmails();
    const { user } = await createUser();
    const cookie = refreshCookie(
      await api().post('/auth/login').send({ email: user.email, password: PASSWORD })
    );

    await api().post('/auth/forgot-password').send({ email: user.email });
    const token = emails.find((e) => e.kind === 'reset')!.token;

    const [a, b] = await Promise.all([
      api().post('/auth/reset-password').send({ token, newPassword: 'brand new password 1' }),
      api().post('/auth/reset-password').send({ token, newPassword: 'brand new password 2' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([204, 401]);

    expect((await api().post('/auth/refresh').set('Cookie', cookie)).status).toBe(401);
    expect(
      (await api().post('/auth/login').send({ email: user.email, password: PASSWORD })).status
    ).toBe(401);
  });

  it('answers the same for unknown emails', async () => {
    const res = await api().post('/auth/forgot-password').send({ email: 'ghost@test.local' });
    expect(res.status).toBe(200);
  });
});

describe('two-factor authentication', () => {
  it('requires the code at login once enabled', async () => {
    const { user, auth } = await createUser();
    expect((await api().post('/auth/2fa/setup').set('Authorization', auth)).status).toBe(200);
    expect(
      (await api().post('/auth/2fa/confirm').set('Authorization', auth).send({ code: '123456' }))
        .status
    ).toBe(204);
    // The confirm used up the current 30 s code; pretend the next one has arrived.
    await prisma.user.update({ where: { id: user.id }, data: { twoFactorLastTimeStep: 0 } });

    const login = await api().post('/auth/login').send({ email: user.email, password: PASSWORD });
    expect(login.status).toBe(401);
    expect(login.body.code).toBe('TWO_FACTOR_REQUIRED');

    // The temp token is not an access token.
    expect(
      (await api().get('/auth/me').set('Authorization', `Bearer ${login.body.tempToken}`)).status
    ).toBe(401);

    expect(
      (
        await api()
          .post('/auth/2fa/verify-login')
          .send({ tempToken: login.body.tempToken, code: '000000' })
      ).status
    ).toBe(401);
    const ok = await api()
      .post('/auth/2fa/verify-login')
      .send({ tempToken: login.body.tempToken, code: '123456' });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toEqual(expect.any(String));

    // The same code cannot log in twice.
    const again = await api().post('/auth/login').send({ email: user.email, password: PASSWORD });
    expect(
      (
        await api()
          .post('/auth/2fa/verify-login')
          .send({ tempToken: again.body.tempToken, code: '123456' })
      ).status
    ).toBe(401);
  });
});

describe('profile and account deletion', () => {
  it('updates name and time zone', async () => {
    const { auth } = await createUser();
    const res = await api()
      .patch('/me')
      .set('Authorization', auth)
      .send({ timezone: 'America/New_York' });
    expect(res.status).toBe(200);
    expect(res.body.timezone).toBe('America/New_York');
    expect(
      (await api().patch('/me').set('Authorization', auth).send({ email: 'x@y.z' })).status
    ).toBe(400);
  });

  it('deletes the account only with the right password', async () => {
    const { user, auth } = await createUser();
    const wrong = await api().delete('/me').set('Authorization', auth).send({ password: 'nope' });
    expect(wrong.status).toBe(403);
    expect(wrong.body.code).toBe('WRONG_PASSWORD');

    expect(
      (await api().delete('/me').set('Authorization', auth).send({ password: PASSWORD })).status
    ).toBe(204);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
  });

  it('exports own data', async () => {
    const { auth } = await createUser();
    const res = await api().get('/me/export').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ goals: [], timeEntries: [], progressEntries: [] });
  });
});
