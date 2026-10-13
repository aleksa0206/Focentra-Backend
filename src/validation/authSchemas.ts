import { z } from 'zod';
import { newPassword, timeZone } from './common';

const email = z.email().max(255).toLowerCase();

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email,
  password: newPassword,
  timezone: timeZone.default('UTC'),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(200),
});

export const tokenSchema = z.object({ token: z.string().min(1).max(200) });

export const emailSchema = z.object({ email });

export const verifyTwoFactorLoginSchema = z.object({
  tempToken: z.string().min(1),
  code: z.string().regex(/^\d{6}$/),
});

export const twoFactorCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });

export const resetPasswordSchema = z.object({
  token: z.string().min(1).max(200),
  newPassword,
});

export const updateProfileSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(100),
    timezone: timeZone,
  })
  .partial();

export const passwordConfirmationSchema = z.object({ password: z.string().min(1).max(200) });
