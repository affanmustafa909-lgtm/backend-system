# Backend

Hosted NestJS API and control plane. Clients (web, desktop, mobile) connect to this service when online; local offline queues sync back via `/v1/sync/push`.

| Service | Package | Path |
| --- | --- | --- |
| API | `@platform/api` | [`api/`](./api/) |

## Local development

```bash
# From repository root
cp backend/.env.example backend/.env   # or edit backend/.env for Railway DB
docker compose up -d    # PostgreSQL (if using local DATABASE_URL)
pnpm db:push            # Apply schema
pnpm dev:api            # NestJS on :3000
```

Environment files (in order of precedence for `backend/api`):

| File | Purpose |
| --- | --- |
| [`backend/.env`](./.env) | **Backend-only** — DB, JWT, CORS, seed (recommended) |
| [`.env`](../.env) | Monorepo root — also includes client `VITE_*` vars |

## Production (self-hosted)

```bash
# Copy and edit production env
cp deployment/.env.production.example deployment/.env.production

# Start API + PostgreSQL
docker compose -f deployment/docker-compose.prod.yml --env-file deployment/.env.production up -d

# Apply schema (first deploy)
docker compose -f deployment/docker-compose.prod.yml --env-file deployment/.env.production run --rm api-migrate
```

Set `CORS_ORIGINS` to your hosted frontend URL(s). Desktop (Tauri) and mobile apps call the API directly and do not need CORS entries.

## Railway (recommended)

See **[RAILWAY.md](./RAILWAY.md)** for the full deploy guide.

1. Railway → New Project → GitHub repo
2. Add **PostgreSQL**
3. Set **Dockerfile path** to `backend/Dockerfile` (Root Directory = repo root)
4. Set variables from [`railway.env.example`](./railway.env.example)
5. Generate domain → use as `VITE_API_BASE_URL` in clients

## Docker image only

```bash
docker build -f backend/Dockerfile -t platform-api .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/platform \
  -e JWT_ACCESS_SECRET=your-secret-min-32-chars \
  -e CORS_ORIGINS=https://app.yourdomain.com \
  platform-api
```

## Docker Compose (API + Postgres)

```bash
cp backend/.env.docker.example backend/.env.docker
docker compose -f backend/docker-compose.yml --env-file backend/.env.docker up -d --build
```

**Live Railway API:** https://backend-desktop-production-5505.up.railway.app  
Health: https://backend-desktop-production-5505.up.railway.app/health
