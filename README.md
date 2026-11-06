# Focentra Backend

[![CI](https://github.com/aleksa0206/Focentra-Backend/actions/workflows/ci.yml/badge.svg)](https://github.com/aleksa0206/Focentra-Backend/actions/workflows/ci.yml)

API for Focentra, a time tracker built around goals. You set a goal ("40 h of Angular by December", "8 h every week", "300 pages"), run a timer while you work, and the API tells you if you're ahead, on track or behind. Goals can be shared with friends, everyone's time adds up.

Live: [focentra.space](https://focentra.space) | Frontend: [Focentra-Frontend](https://github.com/aleksa0206/Focentra-Frontend)

![Focentra dashboard](https://raw.githubusercontent.com/aleksa0206/Focentra-Frontend/main/docs/screenshots/dashboard.png)

## What it does

- Goals in hours or units, with a deadline or repeating weekly/monthly
- Pace status: `AHEAD`, `ON_TRACK`, `BEHIND`, `COMPLETED`, `MISSED`, `UPCOMING`
- Timer (one running timer per user, enforced in the database)
- Manual time entries that can't overlap
- History for recurring goals, each past week/month keeps the target it had
- Shared goals with invite links
- Stats in the user's time zone: heatmap, hours per week, time per goal
- Email verification, password reset, TOTP 2FA, JSON export, account deletion

## Stack

Node.js 24, TypeScript, Express 5, Prisma 7, MySQL 8, Zod, date-fns, Pino, Jest + Supertest, Docker.

Code is split into routes, controllers, services and repositories. Time zone math is in `src/lib/time.ts` with its own unit tests. Errors always look like `{ "error": "...", "code": "ENTRY_OVERLAP" }` so the frontend can tell two different 409s apart.

## Running locally

Needs Node.js 24 and Docker (for MySQL).

```bash
npm install
docker compose up -d       # MySQL on 127.0.0.1:3307
cp .env.example .env       # set JWT_SECRET
npx prisma migrate deploy
npx prisma generate
npm run seed:demo          # optional, demo user with a year of data
npm run dev                # http://localhost:4000
```

Demo login: `demo@focentra.local` / `Password123`. For emails in development I use [MailHog](https://github.com/mailhog/MailHog) on `localhost:1025`.

### Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `PORT` | no | default `4000` |
| `NODE_ENV` | no | `development` / `test` / `production` |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | yes | on Windows use `127.0.0.1`, not `localhost` |
| `DATABASE_URL` | yes | only for Prisma CLI (migrations) |
| `JWT_SECRET` | yes | at least 32 characters |
| `FRONTEND_URL` | in production | CORS and links in emails |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | in production | emails |
| `TRUST_PROXY` | no | number of proxies in front of the app, leave `0` if there are none |
| `METRICS_TOKEN` | no | enables `GET /metrics` |

## API

| Area | Endpoints |
| --- | --- |
| Auth | `/auth/register`, `/auth/verify-email`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/me`, `/auth/2fa/*` |
| Profile | `PATCH /me`, `DELETE /me`, `GET /me/export` |
| Goals | `GET/POST /goals`, `GET/PATCH/DELETE /goals/:id`, `/goals/:id/chart`, `/goals/:id/periods` |
| Sharing | `/goals/:id/members`, `/goals/:id/invites`, `/invites/:token`, `POST /invites/:token/accept` |
| Timer | `GET /timer`, `POST /timer/start`, `POST /timer/stop` |
| Time entries | `GET/POST /time-entries`, `PATCH/DELETE /time-entries/:id` |
| Progress | `GET/POST /goals/:id/progress-entries`, `PATCH/DELETE /progress-entries/:id` |
| Stats | `/stats/heatmap`, `/stats/trend`, `/stats/breakdown` |
| Ops | `GET /health`, `GET /metrics` |

Durations are in seconds, dates are `YYYY-MM-DD`.

## Tests

Integration tests run against a real MySQL test database from `.env.test` (name must end with `_test`). Some of them send parallel requests on purpose, e.g. two timer starts at once or two overlapping entries, to check that only one gets through.

```bash
npm run test:migrate
npm test
```

## Notes

- Progress isn't stored, it's calculated from entries on every read. No background jobs, nothing goes out of sync. Downside: deleting entries can turn a completed goal back into an active one.
- Time zone math is done in Node and not in SQL, because the MySQL Docker image has no time zone tables and `CONVERT_TZ` just returns `NULL`.
- A goal has its own time zone (copied from the owner), so all members of a shared goal have the same week boundaries.

## Deployment

`docker-compose.prod.yaml` runs MySQL, migrations, the API, the frontend and a Cloudflare Tunnel on one server, with no open ports. It expects `../Focentra-Frontend` next to this repo and a `.env.production` with the variables above plus `MYSQL_ROOT_PASSWORD` and `TUNNEL_TOKEN`.

```bash
docker compose --env-file .env.production -f docker-compose.prod.yaml up -d --build
```
