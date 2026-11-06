# Focentra Backend

REST API for Focentra, a personal time tracker built around goals. You set a goal in hours ("40 h of Angular by December", "8 h of study every week") or in units ("300 pages"), run a timer while you work, and the API tells you whether you are ahead of the plan, on track or behind it. Goals can be shared with a study group: everyone's time adds up, and each member sees the entries on that goal but nothing else of the others.

- Live: [focentra.space](https://focentra.space)
- Frontend: [Focentra-Frontend](https://github.com/aleksa0206/Focentra-Frontend) (Angular)

![Focentra dashboard](https://raw.githubusercontent.com/aleksa0206/Focentra-Frontend/main/docs/screenshots/dashboard.png)

## Features

- **Goals** measured in hours (filled by the timer) or in units (filled by logged progress), either with a deadline or repeating every week or month.
- **Pace**: progress is compared with an even pace from start to deadline (or through the current week or month). Status is `AHEAD`, `ON_TRACK` (within 10 %), `BEHIND`, `COMPLETED`, `MISSED` or `UPCOMING`, with how far ahead or behind.
- **Timer** with one running timer per user, guaranteed by the database. It survives closing the tab and switching devices, because the server keeps the start time.
- **Manual time entries**: add or fix past time. Entries of one user never overlap, and parallel requests can't sneak past that check.
- **Period history** for recurring goals. Every past week or month keeps the target it had at the time, even after the target changes.
- **Shared goals**: invite links (7 days, revocable, up to 20 members). Leaving a goal detaches the member's time from it.
- **Statistics** in the user's time zone: a year-long activity heatmap, hours per week and time per goal. A session from 23:30 to 00:30 counts half on each day, also on days with a DST change.
- **Account**: email verification, password reset, optional TOTP 2FA, data export (JSON) and account deletion.

## Security

- The short-lived JWT access token (15 min) is returned in the response body. The refresh token is opaque, stored hashed, rotated on every use, and sent only as an `httpOnly`, `sameSite=strict` cookie scoped to `/auth`. Reusing an old refresh token revokes every session of that user.
- Accounts lock after 5 failed logins (password or 2FA code). The counter is incremented atomically, so parallel guesses can't get extra tries. Login takes the same time whether or not the email exists.
- Reset, verification and invite tokens are random 256-bit values stored as SHA-256 hashes. Reset and verification links are consumed atomically, so each works only once.
- Passwords are hashed with bcrypt (cost 12). Passwords over 72 bytes are rejected, because bcrypt would silently ignore the rest.
- Access checks: there is one check for goals ("is the caller a member"). Personal goals have an owner membership too, so there is no second code path to forget. Someone else's goal or entry answers `404`, so ids reveal nothing.
- The rate limiter keeps its counts in the database, so the limits hold across several instances. It uses a single upsert, so counts can't be lost under load.
- Environment variables are validated at startup, and the app refuses to boot with missing or weak config. Logs redact tokens, cookies and invite tokens in URLs.

## Tech stack

Node.js 24, TypeScript, Express 5, Prisma 7 (MariaDB adapter) on MySQL 8, Zod, `date-fns` + `@date-fns/tz`, Pino, Jest + Supertest, Nodemailer, Docker.

Layered architecture: `routes → controllers → services → repositories → Prisma`. Business rules and access checks live in services, and only repositories touch the database. Date math in time zones is in `src/lib/time.ts`: pure functions with their own unit tests.

Errors have one shape: `{ "error": "...", "code": "ENTRY_OVERLAP", ...extra }`. The `code` field lets the frontend tell apart cases that share a status, e.g. two different `409`s.

## Getting started

Requirements: Node.js 24, Docker (for MySQL).

```bash
npm install
docker compose up -d            # MySQL on 127.0.0.1:3307 (dev and test databases)
cp .env.example .env            # then set JWT_SECRET (see below)
npx prisma migrate deploy
npx prisma generate
npm run seed:demo               # optional: demo user with a year of data
npm run dev                     # http://localhost:4000
```

`npm run seed:demo` creates `demo@focentra.local` with the password `Password123`: four goals, a shared one with `friend@focentra.local` (same password), and a year of sessions, so the heatmap has data.

Emails (verification, password reset) go to the SMTP server in `.env`. [MailHog](https://github.com/mailhog/MailHog) on `localhost:1025` works well for development.

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `PORT` | no | Default `4000` |
| `NODE_ENV` | no | `development` / `test` / `production` |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | yes | Used by the app at runtime. On Windows use `127.0.0.1`, not `localhost` |
| `DATABASE_URL` | yes | Used only by the Prisma CLI (migrations) |
| `JWT_SECRET` | yes | At least 32 characters |
| `FRONTEND_URL` | in production | CORS origin and the base of links in emails. Default `http://localhost:4200` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | `SMTP_HOST` in production | Verification and password-reset emails |
| `TRUST_PROXY` | no | Number of reverse proxies in front of the app. Default `0`; set it only when a proxy really is there, otherwise clients can spoof their rate-limit IP |
| `METRICS_TOKEN` | no | Enables `GET /metrics` (Prometheus) with this bearer token |

## Tests

Unit tests cover the time-zone math. Integration tests run against a real MySQL database configured in `.env.test` (a database whose name ends in `_test`; the suite refuses to run otherwise). They include races: parallel timer starts, parallel overlapping entries, parallel password resets, and parallel invite accepts at the member limit.

```bash
npm run test:migrate   # after every new migration
npm test
```

CI (GitHub Actions) runs formatting, type checking and the full test suite against MySQL 8 on every push, and builds the Docker image.

## API overview

| Area | Endpoints |
| --- | --- |
| Auth | `POST /auth/register`, `/auth/verify-email`, `/auth/resend-verification`, `/auth/login`, `/auth/2fa/verify-login`, `/auth/refresh`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password`; `GET /auth/me`; `POST /auth/2fa/setup`, `/auth/2fa/confirm`; `DELETE /auth/2fa` |
| Profile | `PATCH /me`, `DELETE /me` (needs the password), `GET /me/export` |
| Goals | `GET /goals?state=active\|archived`, `POST /goals`, `GET/PATCH/DELETE /goals/:id`, `GET /goals/:id/chart`, `GET /goals/:id/periods` |
| Sharing | `GET /goals/:id/members`, `DELETE /goals/:id/members/:userId`, `GET/POST /goals/:id/invites`, `DELETE /goals/:id/invites/:inviteId`, `GET /invites/:token`, `POST /invites/:token/accept` |
| Timer | `GET /timer`, `POST /timer/start`, `POST /timer/stop` |
| Time entries | `GET/POST /time-entries`, `PATCH/DELETE /time-entries/:id`, `GET /goals/:id/time-entries` |
| Progress | `GET/POST /goals/:id/progress-entries`, `PATCH/DELETE /progress-entries/:id` |
| Statistics | `GET /stats/heatmap?from&to`, `GET /stats/trend?weeks`, `GET /stats/breakdown?from&to` |
| Ops | `GET /health`, `GET /metrics` |

Durations and `TIME` targets are in seconds. Calendar dates are `YYYY-MM-DD` and instants are ISO 8601.

## Decisions that aren't obvious from the code

- **Progress is never stored.** It is computed from the entries on every read, so there is no background job and nothing to go stale. The cost: deleting entries can turn a `COMPLETED` goal back into an active one.
- **Time-zone math runs in Node, not in SQL.** The MySQL Docker image ships without time-zone tables, and `CONVERT_TZ` would silently return `NULL`. A year of one user's entries is a few thousand rows.
- **A goal has its own time zone**, copied from the owner when it is created, so all members of a shared goal share one set of week boundaries.
- **Deleting a goal keeps the time**: entries stay in the users' logs without a goal. Logged units are deleted, because they mean nothing without the goal.

## Docker and production

```bash
docker build -t focentra-backend .
docker run --env-file .env -p 4000:4000 focentra-backend
```

The runtime image has no Prisma CLI; migrations run from the build stage (`docker build --target build`).

`docker-compose.prod.yaml` runs MySQL, migrations, the API, the frontend (nginx, which also proxies `/api`) and a Cloudflare Tunnel on a single host. No ports are published; the tunnel is the only way in. It expects the frontend repo checked out next to this one (`../Focentra-Frontend`) and a git-ignored `.env.production` with the variables above plus `MYSQL_ROOT_PASSWORD` and `TUNNEL_TOKEN`:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yaml up -d --build
```

The stack is a separate compose project (`focentra`), so it can run on the same host as other apps. Back up the `mysql_data` volume regularly, e.g. a daily `mysqldump` to another machine.
