import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWorkspaceRoot } from "./resolve-workspace.mjs";
import { ensureCriticalSchema } from "./ensure-schema.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(scriptDir, "..");
const appRoot = resolveWorkspaceRoot(apiRoot);
const dbPkgRoot = join(appRoot, "packages", "database-pg");

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`[railway] Missing required environment variable: ${name}`);
    process.exit(1);
  }
}

function runSchemaPush() {
  console.log(`[railway] Applying database schema from ${dbPkgRoot}…`);

  const pnpm = process.platform === "win32"
    ? { cmd: "corepack", args: ["pnpm", "exec", "drizzle-kit", "push", "--force"] }
    : { cmd: "pnpm", args: ["exec", "drizzle-kit", "push", "--force"] };

  const result = spawnSync(pnpm.cmd, pnpm.args, {
    cwd: dbPkgRoot,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    console.error(
      "[railway] Schema push failed — ensure DATABASE_URL is set and Postgres is reachable.",
    );
    console.warn(
      "[railway] Continuing startup anyway (existing Railway DBs often fail drizzle push on PK alters). ensure-schema will patch critical columns.",
    );
    return false;
  }

  console.log("[railway] Schema push complete.");
  return true;
}

async function waitForHealth(port, timeoutMs = 180_000) {
  const started = Date.now();
  const url = `http://127.0.0.1:${port}/health`;
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        console.log("[railway] Seed boot healthy:", await res.text());
        return true;
      }
    } catch {
      // still booting
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

async function runSeedBoot() {
  const seedPort = process.env.RAILWAY_SEED_PORT ?? "3098";
  console.log(`[railway] Running idempotent seed boot on :${seedPort}…`);

  const child = spawn("node", ["dist/main.js"], {
    cwd: apiRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: seedPort,
      HOST: "127.0.0.1",
    },
  });

  const healthy = await waitForHealth(seedPort);
  if (!healthy) {
    child.kill("SIGTERM");
    console.error("[railway] Seed boot did not become healthy — continuing with API start anyway.");
    return;
  }

  await new Promise((r) => setTimeout(r, 10_000));
  child.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 1000));
  console.log("[railway] Seed boot complete.");
}

function startApi() {
  mkdirSync(join(apiRoot, "data", "uploads"), { recursive: true });

  console.log("[railway] Starting API server…");
  const api = spawnSync("node", ["dist/main.js"], {
    cwd: apiRoot,
    stdio: "inherit",
    env: process.env,
  });
  process.exit(api.status ?? 0);
}

requireEnv("DATABASE_URL");
requireEnv("JWT_ACCESS_SECRET");

// Skip drizzle-kit push on boot — it often fails on existing Railway DBs
// ("column id is in a primary key") and previously caused permanent 502s.
const skipPush = (process.env.RAILWAY_SKIP_SCHEMA_PUSH ?? "1") !== "0";
if (skipPush) {
  console.warn("[railway] Skipping drizzle-kit push on boot (RAILWAY_SKIP_SCHEMA_PUSH=1).");
} else if (!runSchemaPush()) {
  console.warn("[railway] Schema push reported errors; starting API with existing schema.");
}

if (!ensureCriticalSchema()) {
  console.warn("[railway] ensure-schema had errors — continuing; login may fail if columns are missing.");
}

// Skip slow seed boot on Railway by default (was delaying/blocking healthy rollouts).
const skipSeed = (process.env.RAILWAY_SKIP_SEED_BOOT ?? "1") !== "0";
if (skipSeed) {
  console.warn("[railway] Skipping seed boot (RAILWAY_SKIP_SEED_BOOT=1).");
} else {
  try {
    await runSeedBoot();
  } catch (err) {
    console.warn("[railway] Seed boot failed — continuing:", err instanceof Error ? err.message : err);
  }
}

startApi();
