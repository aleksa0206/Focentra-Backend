import { createHash, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { collectDefaultMetrics, Histogram, register } from 'prom-client';
import { env } from '../config/env';

collectDefaultMetrics();

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const stopTimer = httpRequestDuration.startTimer();
  res.on('finish', () => {
    // The route pattern, never the raw URL: ids in the path would create one time series per record.
    const route = req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched';
    stopTimer({ method: req.method, route, status: res.statusCode });
  });
  next();
}

const sha256 = (value: string) => createHash('sha256').update(value).digest();

// Disabled (404) unless METRICS_TOKEN is set; metrics expose route names and traffic volumes.
export async function metricsHandler(req: Request, res: Response) {
  if (!env.METRICS_TOKEN) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const provided = req.headers.authorization ?? '';
  if (!timingSafeEqual(sha256(provided), sha256(`Bearer ${env.METRICS_TOKEN}`))) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.setHeader('Content-Type', register.contentType);
  res.send(await register.metrics());
}
