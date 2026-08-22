# Deploy backend-system to Railway

Host the NestJS API (`backend-system/api`) on [Railway](https://railway.com) with a managed PostgreSQL database.

**Live API:** https://backend-desktop-production-5505.up.railway.app  
**Health:** https://backend-desktop-production-5505.up.railway.app/health

Quick checklist: **[RAILWAY-FIX.md](./RAILWAY-FIX.md)**

## Deployment files (all under `backend-system/`)

| File | Purpose |
| --- | --- |
| [`Dockerfile`](./Dockerfile) | Production Docker image (build with **Root Directory = `backend-system`**) |
| [`railway.toml`](./railway.toml) | Railway builder, health check, start command |
| [`railway.json`](./railway.json) | Same settings (JSON format) |
| [`railway.env.example`](./railway.env.example) | Required Railway environment variables |
| [`api/scripts/start-railway.mjs`](./api/scripts/start-railway.mjs) | Ensure schema + start API on boot |

## What Railway runs

On each deploy Railway will:

1. Build the Docker image from **`backend-system/`** using `Dockerfile` (`COPY api`, `COPY packages`)
2. Skip full `drizzle-kit push` by default (`RAILWAY_SKIP_SCHEMA_PUSH=1`); run `ensureCriticalSchema` instead
3. Skip seed boot by default (`RAILWAY_SKIP_SEED_BOOT=1`)
4. Start the API on `PORT` (set automatically by Railway) via `node /app/api/scripts/start-railway.mjs`
5. Health-check `GET /health`

## Step-by-step

### 1. Push code to GitHub

Railway deploys from Git. Commit and push the monorepo (service Root Directory = `backend-system`).

### 2. Create a Railway project

1. Go to [railway.com](https://railway.com) → **New Project**
2. Choose **Deploy from GitHub repo**
3. Select this repository (`Desktop-application-Multiple-System` or a standalone mirror of `backend-system`)

### 3. Add PostgreSQL

1. In the project, click **+ New** → **Database** → **PostgreSQL**
2. Wait until the database is running
3. Open the Postgres service → **Variables** → copy `DATABASE_URL` (or use reference variables below)

### 4. Configure the API service

Click your **API service** → **Settings**:

| Setting | Value |
| --- | --- |
| **Root Directory** | **Empty** when the GitHub repo is `basir2353/backend-system` (current live setup). Use **`backend-system`** only if the service is linked to the monorepo `Desktop-application-Multiple-System`. |
| **Builder** | **Dockerfile** |
| **Dockerfile path** | `Dockerfile` |
| **Start Command** | `node /app/api/scripts/start-railway.mjs` (or leave image CMD) |
| **Healthcheck Path** | `/health` |
| **Healthcheck Timeout** | `300` (seconds) |
| **Domain target port** | Must match Railway `PORT` (**8080** on current service — not hardcoded 3000) |

> **Important:** Do **not** set Root Directory to `backend-system/api` or use monorepo paths like `backend/Dockerfile` / `/app/backend/api/...`. Those paths cause build failure or instant crash → **502 Application failed to respond**.
>
> If deploy logs show `Listening on http://0.0.0.0:8080` but the public URL returns 502, fix the domain: `railway domain update YOUR-DOMAIN --port 8080`.

### 5. Set environment variables

Copy from [`railway.env.example`](./railway.env.example) into the API service → **Variables**:

| Variable | Value | Required |
| --- | --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Yes — reference your Postgres service |
| `JWT_ACCESS_SECRET` | Random string, min 32 chars | Yes |
| `NODE_ENV` | `production` | Yes |
| `CORS_ORIGINS` | Your frontend URL(s), comma-separated | Yes for browser |
| `SEED_SUPER_ADMIN_EMAIL` | `superadmin@platform.local` | First deploy / seed |
| `SEED_USER_EMAIL` | `admin@platform.local` | First deploy / seed |
| `SEED_USER_PASSWORD` | Strong password | First deploy / seed |
| `APP_PUBLIC_URL` | Your web app URL | Optional (invite links) |
| `RAILWAY_SKIP_SCHEMA_PUSH` | `1` (default) | Recommended |
| `RAILWAY_SKIP_SEED_BOOT` | `1` (default) | Recommended |

Example `CORS_ORIGINS`:

```
https://your-app.vercel.app,http://127.0.0.1:1420,tauri://localhost
```

Include `http://127.0.0.1:1420` for local desktop/web dev against the hosted API.
Include `tauri://localhost` for the installed Windows desktop app.

**Do not set `PORT`** — Railway injects it automatically.

SSL to Postgres is enabled automatically in production (see `packages/database-pg`).

### 6. Generate a public URL

1. API service → **Settings** → **Networking** → **Generate Domain**
2. You get a URL like `https://backend-desktop-production-5505.up.railway.app`

### 7. Seed the live database (first deploy)

From `backend-system/` on your machine (one-off — public Postgres URL is OK here):

```bash
DATABASE_URL="postgresql://..." \
JWT_ACCESS_SECRET="your-production-secret-min-32-chars" \
SEED_SUPER_ADMIN_EMAIL=superadmin@platform.local \
SEED_USER_EMAIL=admin@platform.local \
SEED_USER_PASSWORD="your-strong-password" \
pnpm seed:live
```

**On the API service**, always use the private reference `${{Postgres.DATABASE_URL}}` — not the public `*.proxy.rlwy.net` URL (avoids egress fees).

### 8. Verify deployment

```bash
curl https://YOUR-RAILWAY-DOMAIN.up.railway.app/health
curl https://YOUR-RAILWAY-DOMAIN.up.railway.app/health/db
```

Expected health: `{"status":"ok","ts":"..."}`

Login test:

```bash
curl -X POST https://YOUR-RAILWAY-DOMAIN.up.railway.app/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@platform.local","password":"YOUR-SEED-PASSWORD"}'
```

### 9. Point your clients at Railway

In your local `.env` (repo root):

```bash
VITE_API_BASE_URL=https://YOUR-RAILWAY-DOMAIN.up.railway.app
```

Mobile (`apps/waiter-mobile/.env`):

```bash
EXPO_PUBLIC_API_BASE_URL=https://YOUR-RAILWAY-DOMAIN.up.railway.app
```

Restart `pnpm dev:web`, `pnpm dev:launcher`, or the mobile app.

## Local Docker test (before Railway)

```bash
# From backend-system/
docker build -f Dockerfile -t platform-api .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL=postgresql://platform:platform@host.docker.internal:15432/platform \
  -e JWT_ACCESS_SECRET=dev-access-secret-change-me-min-32-chars-long \
  -e NODE_ENV=production \
  platform-api
```

Or: `docker compose --env-file .env.docker up -d --build`

## Optional: persistent file uploads

Menu images are stored in `/app/api/data/uploads/`. Railway's filesystem is ephemeral by default.

To keep uploads across deploys:

1. API service → **Volumes** → **Add Volume**
2. Mount path: `/app/api/data/uploads`

## Troubleshooting

| Issue | Fix |
| --- | --- |
| **502 Application failed to respond** | (1) Domain **target port** mismatch: if logs say `Listening on :8080` but domain targets `3000`, run `railway domain update YOUR-DOMAIN --port 8080`. (2) Start path must be `/app/api/...` (not `/app/backend/api/...`). (3) Env must have `DATABASE_URL` + `JWT_ACCESS_SECRET`. |
| Build / TypeScript errors | Root Directory = **`backend-system`**, Builder = **Dockerfile**, path = `Dockerfile`. |
| Build uses Nixpacks | Switch Builder to **Dockerfile** in Settings |
| DB connection error | Link `DATABASE_URL` to `${{Postgres.DATABASE_URL}}` |
| CORS blocked in browser | Add your frontend origin to `CORS_ORIGINS` |
| Schema push fails | Leave `RAILWAY_SKIP_SCHEMA_PUSH=1`; use `pnpm seed:live` or `ensureCriticalSchema` |
| **Healthcheck failure** | Open **View logs**. Common: missing `DATABASE_URL`, missing `JWT_ACCESS_SECRET`, wrong startCommand path. |

## Architecture

```
Railway Project
├── PostgreSQL          → DATABASE_URL (auto)
└── API (Docker)        → https://backend-desktop-production-5505.up.railway.app
         ↑
    Web / Desktop / Mobile clients (VITE_API_BASE_URL)
```
