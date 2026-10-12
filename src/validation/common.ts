import { z } from 'zod';
import { isValidTimeZone } from '../lib/time';

export const idParam = z.coerce.number().int().positive();

export const timeZone = z
  .string()
  .max(64)
  .refine(isValidTimeZone, { message: 'must be an IANA time zone, e.g. Europe/Belgrade' });

export const dateKey = z.iso.date();

export const note = z
  .string()
  .trim()
  .max(500)
  .transform((value) => value || null)
  .nullable();

// bcrypt only uses the first 72 bytes; a longer password would silently match its prefix.
export const newPassword = z
  .string()
  .min(8)
  .refine((value) => Buffer.byteLength(value) <= 72, { message: 'must be at most 72 bytes' });
