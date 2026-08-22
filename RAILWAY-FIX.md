# Railway quick reference

Use the full guide: **[RAILWAY.md](./RAILWAY.md)**

Live API: https://backend-desktop-production-5505.up.railway.app

## Required Railway settings

GitHub repo for this service: **`basir2353/backend-system`** (standalone — Root Directory empty).

| Setting | Value |
| --- | --- |
| Root Directory | *(empty — repo is already backend-system)* |
| Builder | Dockerfile |
| Dockerfile path | `Dockerfile` |
| Start command | `node /app/api/scripts/start-railway.mjs` |
| Healthcheck | `/health` |
| **Public domain target port** | Must match Railway `PORT` (usually **8080**, not 3000) |

If `/health` returns **502 Application failed to respond** but deploy logs show `Listening on http://0.0.0.0:8080`, the domain is pointing at the wrong port:

```bash
railway domain update backend-desktop-production-5505.up.railway.app --port 8080
```

## After push to GitHub (or `railway up` from this folder)

1. Railway → your API service → **Redeploy** (if using GitHub auto-deploy)
2. Verify: `curl https://backend-desktop-production-5505.up.railway.app/health`
3. Verify DB: `curl https://backend-desktop-production-5505.up.railway.app/health/db`
4. Test login: `admin@platform.local` / `changeme-please-01`
