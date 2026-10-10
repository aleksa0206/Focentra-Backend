import { env } from './config/env';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { logger } from './config/logger';
import { prisma } from './config/prismaClient';
import authRoutes from './routes/authRoutes';
import apiRoutes from './routes/apiRoutes';
import { errorMiddleware } from './middleware/errorMiddleware';
import { generalRateLimiter } from './middleware/dbRateLimiter';
import { metricsHandler, metricsMiddleware } from './middleware/metricsMiddleware';
import type {} from './types/express';

const app = express();

// Behind a proxy every request would otherwise share the proxy's IP and one rate-limit bucket.
app.set('trust proxy', env.TRUST_PROXY);

app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Before the logger and the rate limiter: a scrape every 15s would flood both.
app.get('/metrics', metricsHandler);
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'connected' });
  } catch {
    res.status(503).json({ status: 'error', database: 'disconnected' });
  }
});

app.use(metricsMiddleware);
app.use(
  pinoHttp({
    logger,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      censor: '[Redacted]',
    },
    // Invite tokens are secrets and travel in the path.
    serializers: {
      req: (req) => ({
        ...req,
        url: String(req.url).replace(/(\/invites\/)[^/?]+/, '$1[Redacted]'),
      }),
    },
  })
);
app.use(express.json({ limit: '20kb' }));
app.use(cookieParser());
app.use(generalRateLimiter);
app.use(authRoutes);
app.use(apiRoutes);
app.use(errorMiddleware);

export default app;
