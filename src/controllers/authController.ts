import type { CookieOptions, Request, Response } from 'express';
import * as authService from '../services/authService';
import * as userRepository from '../repositories/userRepository';
import { UnauthorizedError } from '../errors/UnauthorizedError';
import { env } from '../config/env';

const REFRESH_COOKIE = 'refreshToken';
// Only /auth/* ever sees the cookie, and sameSite=strict keeps other sites from sending it.
const REFRESH_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: authService.REFRESH_TOKEN_TTL_MS,
  path: '/auth',
};

function sendSession(
  res: Response,
  session: { accessToken: string; refreshToken: string; user?: unknown }
) {
  res.cookie(REFRESH_COOKIE, session.refreshToken, REFRESH_COOKIE_OPTIONS);
  res.json({
    token: session.accessToken,
    ...(session.user !== undefined && { user: session.user }),
  });
}

export async function register(req: Request, res: Response) {
  await authService.register(req.body);
  res.status(201).json({ message: 'Check your email to activate your account.' });
}

export async function verifyEmail(req: Request, res: Response) {
  sendSession(res, await authService.verifyEmail(req.body.token));
}

export async function resendVerification(req: Request, res: Response) {
  await authService.resendVerificationEmail(req.body.email);
  res.json({ message: 'If that account still needs confirming, a new link has been sent.' });
}

export async function login(req: Request, res: Response) {
  sendSession(res, await authService.login(req.body.email, req.body.password));
}

export async function verifyTwoFactorLogin(req: Request, res: Response) {
  sendSession(res, await authService.verifyTwoFactorLogin(req.body.tempToken, req.body.code));
}

export async function refresh(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) {
    throw new UnauthorizedError('Refresh token missing');
  }
  sendSession(res, await authService.refresh(token));
}

export async function logout(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (token) {
    await authService.logout(token);
  }
  res.clearCookie(REFRESH_COOKIE, { path: '/auth' });
  res.status(204).send();
}

export async function me(req: Request, res: Response) {
  const user = await userRepository.findSafeById(req.user!.userId);
  if (!user) {
    throw new UnauthorizedError('User no longer exists');
  }
  res.json(user);
}

export async function forgotPassword(req: Request, res: Response) {
  await authService.requestPasswordReset(req.body.email);
  res.json({ message: 'If that email exists, a reset link has been sent.' });
}

export async function resetPassword(req: Request, res: Response) {
  await authService.resetPassword(req.body.token, req.body.newPassword);
  res.status(204).send();
}

export async function setupTwoFactor(req: Request, res: Response) {
  const { qrCode, secret } = await authService.setupTwoFactor(req.user!.userId);
  res.json({ qrCode, secret });
}

export async function confirmTwoFactor(req: Request, res: Response) {
  await authService.confirmTwoFactor(req.user!.userId, req.body.code);
  res.status(204).send();
}

export async function disableTwoFactor(req: Request, res: Response) {
  await authService.disableTwoFactor(req.user!.userId, req.body.code);
  res.status(204).send();
}
