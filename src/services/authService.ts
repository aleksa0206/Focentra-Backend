import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { TOTP, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';
import QRCode from 'qrcode';
import * as userRepository from '../repositories/userRepository';
import * as refreshTokenRepository from '../repositories/refreshTokenRepository';
import * as emailService from './emailService';
import { UnauthorizedError } from '../errors/UnauthorizedError';
import { LockedError } from '../errors/LockedError';
import { TwoFactorRequiredError } from '../errors/TwoFactorRequiredError';
import { ConflictError } from '../errors/ConflictError';
import { ForbiddenError } from '../errors/ForbiddenError';
import { logger } from '../config/logger';
import { env } from '../config/env';

const totp = new TOTP({
  crypto: new NobleCryptoPlugin(),
  base32: new ScureBase32Plugin(),
  issuer: 'Focentra',
});

const BCRYPT_ROUNDS = 12;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const REFRESH_REUSE_GRACE_MS = 60 * 1000;
// Compared against when the email is unknown, so both cases take the same time.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('timing-equalizer', BCRYPT_ROUNDS);

export function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

// A mail outage must not fail the request: the token is already saved and can be resent, and a
// 500 that only happens for existing accounts would tell anyone which emails are registered.
async function sendEmailSafely(send: () => Promise<void>) {
  try {
    await send();
  } catch (err) {
    logger.error({ err }, 'Failed to send email');
  }
}

function signAccessToken(userId: number) {
  return jwt.sign({ userId }, env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '15m' });
}

function signTempToken(userId: number) {
  return jwt.sign({ userId, purpose: '2fa-pending' }, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '5m',
  });
}

async function issueTokens(userId: number) {
  const refreshToken = randomToken();
  await refreshTokenRepository.createRefreshToken({
    userId,
    token: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });
  return { accessToken: signAccessToken(userId), refreshToken };
}

function assertNotLocked(user: { lockedUntil: Date | null }) {
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new LockedError('Account is temporarily locked due to too many failed login attempts');
  }
}

// Wrong passwords and wrong 2FA codes share one counter, so neither can be guessed indefinitely.
async function registerFailedAttempt(userId: number) {
  const attempts = await userRepository.incrementFailedLoginAttempts(userId);
  if (attempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
    await userRepository.setAccountLock(userId, new Date(Date.now() + LOCKOUT_DURATION_MS));
    logger.warn({ userId }, 'Account locked after too many failed login attempts');
    throw new LockedError(
      'Account locked due to too many failed login attempts. Try again in 15 minutes.'
    );
  }
  logger.warn({ userId, attempt: attempts }, 'Failed login attempt');
}

async function clearFailedAttempts(user: {
  id: number;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
}) {
  if (user.failedLoginAttempts > 0 || user.lockedUntil) {
    await userRepository.setAccountLock(user.id, null);
  }
}

export async function register(input: {
  name: string;
  email: string;
  password: string;
  timezone: string;
}) {
  // The unique index still decides a race; this only gives the common case a clear message.
  if (await userRepository.findByEmail(input.email)) {
    throw new ConflictError('An account with this email already exists', 'EMAIL_TAKEN');
  }

  const rawToken = randomToken();
  const user = await userRepository.create({
    email: input.email,
    name: input.name,
    timezone: input.timezone,
    passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
    emailVerificationTokenHash: hashToken(rawToken),
    emailVerificationExpiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
  });
  logger.info({ userId: user.id }, 'User registered');

  await sendEmailSafely(() => emailService.sendVerificationEmail(input.email, rawToken));
}

export async function verifyEmail(rawToken: string) {
  const tokenHash = hashToken(rawToken);
  const user = await userRepository.findByEmailVerificationTokenHash(tokenHash);
  if (!user || !(await userRepository.consumeEmailVerificationToken(user.id, tokenHash))) {
    throw new UnauthorizedError('Invalid or expired verification link');
  }

  // The link proves the mailbox, so it signs the user in like a login would.
  const tokens = await issueTokens(user.id);
  return { ...tokens, user: userRepository.toSafeUser(user) };
}

export async function resendVerificationEmail(email: string) {
  const user = await userRepository.findByEmail(email);
  // Same response whether or not the account exists or is already verified (no enumeration).
  if (!user || user.emailVerified) {
    return;
  }
  const rawToken = randomToken();
  await userRepository.setEmailVerificationToken(
    user.id,
    hashToken(rawToken),
    new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS)
  );
  await sendEmailSafely(() => emailService.sendVerificationEmail(user.email, rawToken));
}

export async function login(email: string, password: string) {
  const user = await userRepository.findByEmail(email);

  if (!user) {
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    throw new UnauthorizedError('Invalid email or password');
  }

  assertNotLocked(user);

  if (!(await bcrypt.compare(password, user.passwordHash))) {
    await registerFailedAttempt(user.id);
    throw new UnauthorizedError('Invalid email or password');
  }

  // Checked only after the password, so it reveals nothing to someone guessing emails.
  if (!user.emailVerified) {
    throw new ForbiddenError('Email address is not verified', 'EMAIL_NOT_VERIFIED');
  }

  // With 2FA the counter is cleared only after the code, otherwise logging in again would reset
  // the count of wrong codes.
  if (user.twoFactorEnabled) {
    throw new TwoFactorRequiredError(signTempToken(user.id));
  }

  await clearFailedAttempts(user);
  logger.info({ userId: user.id }, 'User logged in');
  const tokens = await issueTokens(user.id);
  return { ...tokens, user: userRepository.toSafeUser(user) };
}

export async function verifyTwoFactorLogin(tempToken: string, code: string) {
  let payload: jwt.JwtPayload | string;
  try {
    payload = jwt.verify(tempToken, env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    throw new UnauthorizedError('Invalid or expired temporary token');
  }
  if (
    typeof payload === 'string' ||
    payload.purpose !== '2fa-pending' ||
    typeof payload.userId !== 'number'
  ) {
    throw new UnauthorizedError('Invalid temporary token');
  }

  const user = await userRepository.findById(payload.userId);
  if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
    throw new UnauthorizedError('Two-factor authentication is not enabled for this account');
  }

  assertNotLocked(user);

  const result = await totp.verify(code, { secret: user.twoFactorSecret });
  if (!result.valid) {
    await registerFailedAttempt(user.id);
    throw new UnauthorizedError('Invalid two-factor code');
  }
  if (!(await userRepository.consumeTwoFactorTimeStep(user.id, result.timeStep))) {
    throw new UnauthorizedError('Invalid two-factor code');
  }

  await clearFailedAttempts(user);
  logger.info({ userId: user.id }, 'User logged in with 2FA');
  const tokens = await issueTokens(user.id);
  return { ...tokens, user: userRepository.toSafeUser(user) };
}

export async function setupTwoFactor(userId: number) {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw new UnauthorizedError('User no longer exists');
  }
  // Replacing the secret of an enabled 2FA would let anyone holding a session take it over;
  // disabling first requires a valid code.
  if (user.twoFactorEnabled) {
    throw new ConflictError('Two-factor authentication is already enabled');
  }

  const secret = totp.generateSecret();
  await userRepository.setTwoFactorSecret(userId, secret);
  return { qrCode: await QRCode.toDataURL(totp.toURI({ label: user.email, secret })), secret };
}

async function verifyOwnCode(userId: number, code: string, requireEnabled: boolean) {
  const user = await userRepository.findById(userId);
  if (!user?.twoFactorSecret || user.twoFactorEnabled !== requireEnabled) {
    throw new ConflictError(
      requireEnabled
        ? 'Two-factor authentication is not enabled'
        : 'Two-factor setup was not started'
    );
  }
  const result = await totp.verify(code, { secret: user.twoFactorSecret });
  if (!result.valid || !(await userRepository.consumeTwoFactorTimeStep(userId, result.timeStep))) {
    throw new UnauthorizedError('Invalid two-factor code');
  }
}

export async function confirmTwoFactor(userId: number, code: string) {
  await verifyOwnCode(userId, code, false);
  await userRepository.enableTwoFactor(userId);
  logger.info({ userId }, 'Two-factor authentication enabled');
}

export async function disableTwoFactor(userId: number, code: string) {
  await verifyOwnCode(userId, code, true);
  await userRepository.disableTwoFactor(userId);
  logger.info({ userId }, 'Two-factor authentication disabled');
}

export async function refresh(oldRefreshToken: string) {
  const existing = await refreshTokenRepository.findRefreshTokenByTokenHash(
    hashToken(oldRefreshToken)
  );

  if (!existing || existing.expiresAt < new Date()) {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }
  if (existing.revoked) {
    // An old token coming back means it was copied: end every session of that user. The grace
    // period covers two tabs refreshing with the same cookie at the same moment.
    if (existing.updatedAt.getTime() < Date.now() - REFRESH_REUSE_GRACE_MS) {
      await refreshTokenRepository.revokeAllForUser(existing.userId);
      logger.warn(
        { userId: existing.userId },
        'Refresh token reuse detected, all sessions revoked'
      );
    }
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  // Only one of two parallel refreshes with the same token gets through.
  if (!(await refreshTokenRepository.revokeRefreshTokenIfActive(existing.id))) {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  return await issueTokens(existing.userId);
}

export async function logout(refreshToken: string) {
  const existing = await refreshTokenRepository.findRefreshTokenByTokenHash(
    hashToken(refreshToken)
  );
  if (existing) {
    await refreshTokenRepository.revokeRefreshToken(existing.id);
  }
}

export async function requestPasswordReset(email: string) {
  const user = await userRepository.findByEmail(email);
  if (!user) {
    return;
  }
  const rawToken = randomToken();
  await userRepository.setPasswordResetToken(
    user.id,
    hashToken(rawToken),
    new Date(Date.now() + RESET_TOKEN_TTL_MS)
  );
  await sendEmailSafely(() => emailService.sendPasswordResetEmail(user.email, rawToken));
}

export async function resetPassword(rawToken: string, newPassword: string) {
  const tokenHash = hashToken(rawToken);
  const user = await userRepository.findByResetTokenHash(tokenHash);
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  if (
    !user ||
    !(await userRepository.consumeResetTokenAndSetPassword(user.id, tokenHash, passwordHash))
  ) {
    throw new UnauthorizedError('Invalid or expired reset token');
  }

  // Whoever knew the old password may still hold a session.
  await refreshTokenRepository.revokeAllForUser(user.id);
  logger.info({ userId: user.id }, 'Password reset');
}

// 403, not 401: the frontend treats 401 as an expired session and would try to refresh.
export async function verifyPassword(userId: number, password: string) {
  const user = await userRepository.findById(userId);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new ForbiddenError('Wrong password', 'WRONG_PASSWORD');
  }
}
