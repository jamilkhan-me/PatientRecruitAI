# RecruitAI

AI-driven clinical trial patient recruitment platform.

## Architecture (Phase 1)

| Layer | Stack |
|-------|--------|
| Frontend | React 18 + TypeScript + Vite (`src/`) |
| API | NestJS + Prisma (`apps/api/`) |
| Database | PostgreSQL 16 (Docker) |
| Auth | Email/password + JWT |

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Start PostgreSQL

```bash
npm run db:up
```

### 3. Run migrations & seed demo data

```bash
cd apps/api && cp .env.example .env
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```

Or from the repo root (after `db:up`):

```bash
npm run db:migrate
npm run db:seed
```

### 4. Start API + web

**Terminal 1 — API (port 3001):**

```bash
npm run dev:api
```

**Terminal 2 — Web (port 3000):**

```bash
npm run dev
```

Or both together:

```bash
npm run dev:all
```

Open http://localhost:3000

## Demo logins

| Email | Password | Role |
|-------|----------|------|
| sarah@clinic.org | password123 | Admin |
| james@clinic.org | password123 | Researcher |
| lisa@clinic.org | password123 | Recruiter |

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/auth/login` | Sign in |
| POST | `/api/auth/register` | Register |
| GET | `/api/auth/me` | Current user (JWT) |
| GET | `/api/trials` | List trials |
| POST | `/api/trials` | Create trial (admin) |
| PATCH | `/api/trials/:id` | Update trial (admin) |
| GET | `/api/patients` | List patients (`?trialId=`) |
| POST | `/api/patients` | Create patient |
| POST | `/api/patients/bulk` | Bulk create |
| PATCH | `/api/patients/:id` | Update patient |

## Docker

```bash
docker compose up -d    # PostgreSQL on localhost:5432
docker compose down     # Stop database
```

## What's persisted vs local (Phase 1)

**API + PostgreSQL:** users, trials, patients (including stage changes, notes, AI scores)

**Still client-side (Phase 2):** documents, notifications, outreach templates

## Production notes

- Change `JWT_SECRET` in `apps/api/.env`
- Use `prisma migrate deploy` in CI/CD
- AWS: RDS PostgreSQL, ECS/EKS for API, S3 for documents (Phase 2)
