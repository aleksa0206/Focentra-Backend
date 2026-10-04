import pino from 'pino';

const level = { production: 'info', test: 'silent' }[process.env.NODE_ENV ?? ''] ?? 'debug';

export const logger =
  process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test'
    ? pino({ level })
    : pino({ level, transport: { target: 'pino-pretty', options: { colorize: true } } });
