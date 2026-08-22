# API service

NestJS modular monolith: authentication, catalog, billing, kitchen, inventory, HR, accounting, multi-branch, notifications, pharmacy, store, delivery, and sync.

Located at `backend/api/` — **host this service** on your server. Web, desktop, and mobile clients connect via `VITE_API_BASE_URL` / `EXPO_PUBLIC_API_BASE_URL`.

## Development

```bash
# From repository root
pnpm dev:api
```

Requires PostgreSQL. Start with `docker compose up -d` and apply schema with `pnpm db:push`.

## Environment

Uses the root `.env` file. Key variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `PORT` | HTTP port (default 3000) |
| `JWT_ACCESS_SECRET` | JWT signing secret |
| `CORS_ORIGINS` | Comma-separated browser origins (required when hosting) |

## Structure

```
src/
  auth/          JWT login, refresh tokens
  billing/       POS bills and checkout
  kitchen/       Kitchen tickets
  menu/          Menu catalog and image uploads
  inventory/     Stock, recipes, suppliers
  hr/            Employees, attendance, payroll
  accounting/    Chart of accounts, journals
  sync/          Client sync push stub
  ...
data/uploads/    Runtime menu image uploads (gitignored)
```

## Production

```bash
pnpm --filter @platform/api build
pnpm --filter @platform/api start
```

Dockerfile included for container deployment.
