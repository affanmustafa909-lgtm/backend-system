/**
 * Push schema and seed a hosted Postgres (Railway) database.
 *
 * Usage (from repository root):
 *   DATABASE_URL="postgresql://..." JWT_ACCESS_SECRET="min-32-chars" node backend/scripts/seed-live.mjs
 *
 * Uses the private/internal Railway DATABASE_URL when possible (no egress fees).
 * Public proxy URLs also work for one-off seeding from your machine.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..", "..");
const dbPkgRoot = join(repoRoot, "packages", "database-pg");
const apiRoot = join(repoRoot, "backend", "api");

function pnpmCmd() {
  if (process.platform === "win32") {
    return { cmd: "corepack", prefix: ["pnpm"] };
  }
  return { cmd: "pnpm", prefix: [] };
}

function runPnpm(args, cwd) {
  const { cmd, prefix } = pnpmCmd();
  return spawnSync(cmd, [...prefix, ...args], {
    cwd,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`[seed-live] Missing required env: ${name}`);
    process.exit(1);
  }
  return value;
}

function runSchemaPush() {
  console.log("[seed-live] Applying database schema…");
  const result = runPnpm(["exec", "drizzle-kit", "push", "--force"], dbPkgRoot);
  if (result.status !== 0) {
    console.error("[seed-live] Schema push failed.");
    process.exit(1);
  }
  console.log("[seed-live] Schema push complete.");
}

function buildApi() {
  const distMain = join(apiRoot, "dist", "main.js");
  if (existsSync(distMain)) {
    console.log("[seed-live] Using existing API build.");
    return;
  }
  console.log("[seed-live] Building API…");
  const result = runPnpm(["turbo", "run", "build", "--filter=@platform/api"], repoRoot);
  if (result.status !== 0) {
    console.error("[seed-live] API build failed.");
    process.exit(1);
  }
}

async function waitForHealth(port, timeoutMs = 120_000) {
  const started = Date.now();
  const url = `http://127.0.0.1:${port}/health`;
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const body = await res.json();
        console.log("[seed-live] API healthy:", body);
        return true;
      }
    } catch {
      // API still booting
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

async function seedViaApiBoot() {
  const port = process.env.SEED_PORT ?? "3099";
  process.env.PORT = port;
  process.env.HOST = "127.0.0.1";
  process.env.NODE_ENV = process.env.NODE_ENV ?? "production";

  console.log(`[seed-live] Starting API on :${port} to run idempotent seeds…`);

  const child = spawn("node", ["dist/main.js"], {
    cwd: apiRoot,
    stdio: "inherit",
    env: process.env,
  });

  const healthy = await waitForHealth(port);
  if (!healthy) {
    child.kill("SIGTERM");
    console.error("[seed-live] API did not become healthy — check DATABASE_URL and JWT_ACCESS_SECRET.");
    process.exit(1);
  }

  await new Promise((r) => setTimeout(r, 8000));

  child.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 1000));
  console.log("[seed-live] Seed complete. Demo login:");
  console.log(`  email:    ${process.env.SEED_USER_EMAIL ?? "admin@platform.local"}`);
  console.log(`  password: ${process.env.SEED_USER_PASSWORD ?? "changeme-please-01"}`);
}

requireEnv("DATABASE_URL");
requireEnv("JWT_ACCESS_SECRET");

runSchemaPush();
buildApi();
await seedViaApiBoot();
