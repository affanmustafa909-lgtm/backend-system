/**
 * Railway entrypoint.
 *
 * Permanent healthcheck fix:
 * 1. Start Nest FIRST so /health binds on PORT immediately.
 * 2. Run schema bootstrap in parallel (capped by timeout).
 *
 * Previously bootstrap ran before listen(). On Railway the old replica still holds
 * DB locks during deploy, so ensure-schema / drizzle push could stall for >5m,
 * /health never bound, and the deploy failed even though the image built fine.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(scriptDir, "..");
const BOOTSTRAP_TIMEOUT_MS = Number(process.env.RAILWAY_BOOTSTRAP_TIMEOUT_MS ?? 90_000);

function warnIfMissing(name) {
  if (!process.env[name]?.trim()) {
    console.error(`[railway] Missing ${name} — starting API anyway so /health can bind.`);
  }
}

function startBootstrapInBackground() {
  if (process.env.RAILWAY_SKIP_BOOTSTRAP === "1") {
    console.warn("[railway] RAILWAY_SKIP_BOOTSTRAP=1 — skipping schema bootstrap");
    return;
  }

  console.warn(
    `[railway] Schema bootstrap starting in background (timeout ${Math.round(BOOTSTRAP_TIMEOUT_MS / 1000)}s)`,
  );

  const child = spawn(process.execPath, [join(scriptDir, "bootstrap-live-db.mjs")], {
    cwd: apiRoot,
    stdio: "inherit",
    env: process.env,
    // Detach false — keep logs in the same Railway deploy log stream.
  });

  const timer = setTimeout(() => {
    console.error(
      `[railway] Schema bootstrap exceeded ${BOOTSTRAP_TIMEOUT_MS}ms — killing bootstrap (API keeps running)`,
    );
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
  }, BOOTSTRAP_TIMEOUT_MS);

  child.on("error", (err) => {
    clearTimeout(timer);
    console.error("[railway] Bootstrap spawn failed:", err.message);
  });

  child.on("exit", (code, signal) => {
    clearTimeout(timer);
    if (signal) {
      console.error(`[railway] Bootstrap stopped by signal ${signal}`);
      return;
    }
    if (code === 0) {
      console.log("[railway] Schema bootstrap finished OK");
      return;
    }
    console.error(`[railway] Bootstrap exited with code ${code ?? "?"} (API keeps running)`);
  });
}

function startApiServer() {
  console.log("[railway] Starting API server first so /health can bind…");
  const api = spawn(process.execPath, ["dist/main.js"], {
    cwd: apiRoot,
    stdio: "inherit",
    env: process.env,
  });

  const forward = (signal) => {
    try {
      api.kill(signal);
    } catch {
      // ignore
    }
  };
  process.on("SIGTERM", () => forward("SIGTERM"));
  process.on("SIGINT", () => forward("SIGINT"));

  api.on("error", (err) => {
    console.error("[railway] Failed to start API:", err);
    process.exit(1);
  });

  api.on("exit", (code, signal) => {
    if (signal) {
      console.error(`[railway] API exited from signal ${signal}`);
      process.exit(1);
    }
    process.exit(code ?? 0);
  });
}

warnIfMissing("DATABASE_URL");
warnIfMissing("JWT_ACCESS_SECRET");
mkdirSync(join(apiRoot, "data", "uploads"), { recursive: true });

// API first → Railway /health succeeds. Schema catches up in parallel.
startApiServer();
startBootstrapInBackground();
