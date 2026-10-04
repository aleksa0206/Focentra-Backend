import 'dotenv/config';
import { z } from 'zod';

const isProduction = process.env.NODE_ENV === 'production';

// Required in production; dev/test fall back so the app boots without e.g. a mail server.
const requiredInProduction = (devDefault: string) =>
  isProduction ? z.string().min(1) : z.string().default(devDefault);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive(),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().min(1),

  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  FRONTEND_URL: requiredInProduction('http://localhost:4200'),
  // Number of reverse proxies in front of the app (0 = none). With 0, X-Forwarded-For is ignored,
  // so clients cannot spoof the IP their rate limit is keyed on.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  SMTP_HOST: requiredInProduction('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().min(1).default('Focentra <noreply@focentra.local>'),

  // Bearer token Prometheus sends to GET /metrics; the endpoint is disabled when unset.
  METRICS_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(16).optional()),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // Messages name the variable and the rule only, never the value.
  throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
}

export const env = parsed.data;
