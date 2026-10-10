/**
 * Railway entrypoint — healthcheck-proof boot.
 *
 * Railway probes `$PORT/health` as soon as the container starts. Nest can take
 * a long time (or hang) on `NestFactory.create` / DB work, which made deploys
 * fail even when the image built fine.
 *
 * Fix:
 * 1. Bind `$PORT` immediately with a tiny proxy that ALWAYS returns 200 on /health.
 * 2. Run Nest on an internal loopback port; proxy all other traffic to it.
 * 3. Schema bootstrap runs AFTER Nest is reachable (or times out), never blocks /health.
 */
import { spawn } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(scriptDir, "..");

const publicPort = Number(process.env.PORT ?? 3000);
const publicHost = process.env.HOST ?? "0.0.0.0";
const internalPort = Number(process.env.INTERNAL_API_PORT ?? 3999);
const BOOTSTRAP_TIMEOUT_MS = Number(process.env.RAILWAY_BOOTSTRAP_TIMEOUT_MS ?? 90_000);
const NEST_RESTART_LIMIT = Number(process.env.RAILWAY_NEST_RESTART_LIMIT ?? 10);

let nestReady = false;
let nestRestarts = 0;
let bootstrapStarted = false;

function warnIfMissing(name) {
  if (!process.env[name]?.trim()) {
    console.error(`[railway] Missing ${name} — continuing so /health can still bind.`);
  }
}

function isHealthPath(url) {
  const path = (url ?? "").split("?")[0] ?? "";
  return path === "/health" || path.startsWith("/health/");
}

function proxyToNest(req, res) {
  const headers = { ...req.headers, host: `127.0.0.1:${internalPort}` };
  const proxyReq = httpRequest(
    {
      hostname: "127.0.0.1",
      port: internalPort,
      path: req.url,
      method: req.method,
      headers,
      timeout: 120_000,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on("error", (err) => {
    console.error("[railway] proxy error:", err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
    }
    res.end(JSON.stringify({ status: "bad_gateway", message: "API not ready" }));
  });
  proxyReq.on("timeout", () => {
    proxyReq.destroy();
  });
  req.pipe(proxyReq);
}

function startPublicServer() {
  const server = createServer((req, res) => {
    // Railway healthcheck — always succeed from the moment this process starts.
    if (isHealthPath(req.url)) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          nest: nestReady,
          ts: new Date().toISOString(),
        }),
      );
      return;
    }

    if (!nestReady) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "starting", nest: false }));
      return;
    }

    proxyToNest(req, res);
  });

  server.listen(publicPort, publicHost, () => {
    console.log(
      `[railway] Public /health bound on http://${publicHost}:${publicPort} (Nest → 127.0.0.1:${internalPort})`,
    );
  });

  server.on("error", (err) => {
    console.error("[railway] Public server failed:", err);
    process.exit(1);
  });

  return server;
}

function pollNestUntilReady() {
  const started = Date.now();
  const timer = setInterval(() => {
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port: internalPort,
        path: "/health",
        method: "GET",
        timeout: 2000,
      },
      (res) => {
        res.resume();
        if (res.statusCode === 200) {
          if (!nestReady) {
            nestReady = true;
            console.log(
              `[railway] Nest ready on :${internalPort} after ${Date.now() - started}ms`,
            );
            startBootstrapInBackground();
          }
          clearInterval(timer);
        }
      },
    );
    req.on("error", () => {
      // still booting
    });
    req.on("timeout", () => req.destroy());
    req.end();
  }, 500);
}

function startBootstrapInBackground() {
  if (bootstrapStarted) return;
  bootstrapStarted = true;

  if (process.env.RAILWAY_SKIP_BOOTSTRAP === "1") {
    console.warn("[railway] RAILWAY_SKIP_BOOTSTRAP=1 — skipping schema bootstrap");
    return;
  }

  console.warn(
    `[railway] Schema bootstrap starting (timeout ${Math.round(BOOTSTRAP_TIMEOUT_MS / 1000)}s)`,
  );

  const child = spawn(process.execPath, [join(scriptDir, "bootstrap-live-db.mjs")], {
    cwd: apiRoot,
    stdio: "inherit",
    env: process.env,
  });

  const timer = setTimeout(() => {
    console.error(
      `[railway] Schema bootstrap exceeded ${BOOTSTRAP_TIMEOUT_MS}ms — killing bootstrap (API keeps serving)`,
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
    console.error(`[railway] Bootstrap exited with code ${code ?? "?"} (API keeps serving)`);
  });
}

function startNest() {
  console.log(`[railway] Starting Nest on 127.0.0.1:${internalPort}…`);
  const api = spawn(process.execPath, ["dist/main.js"], {
    cwd: apiRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: String(internalPort),
      HOST: "127.0.0.1",
    },
  });

  api.on("error", (err) => {
    nestReady = false;
    console.error("[railway] Failed to spawn Nest:", err);
    scheduleNestRestart();
  });

  api.on("exit", (code, signal) => {
    nestReady = false;
    console.error(
      `[railway] Nest exited code=${code ?? "?"} signal=${signal ?? "none"} — public /health still up`,
    );
    scheduleNestRestart();
  });

  return api;
}

function scheduleNestRestart() {
  if (nestRestarts >= NEST_RESTART_LIMIT) {
    console.error(
      `[railway] Nest restart limit (${NEST_RESTART_LIMIT}) reached — leaving /health up for diagnosis`,
    );
    return;
  }
  nestRestarts += 1;
  const delay = Math.min(1000 * nestRestarts, 10_000);
  console.warn(`[railway] Restarting Nest in ${delay}ms (attempt ${nestRestarts}/${NEST_RESTART_LIMIT})`);
  setTimeout(() => {
    startNest();
    pollNestUntilReady();
  }, delay);
}

warnIfMissing("DATABASE_URL");
warnIfMissing("JWT_ACCESS_SECRET");
mkdirSync(join(apiRoot, "data", "uploads"), { recursive: true });

// 1) Bind public /health NOW — Railway can pass healthcheck immediately.
startPublicServer();

// 2) Nest on internal port; proxy flips to it when /health responds.
startNest();
pollNestUntilReady();

// Keep process alive; children + server hold the event loop.
process.on("SIGTERM", () => {
  console.log("[railway] SIGTERM received");
  process.exit(0);
});
process.on("SIGINT", () => {
  process.exit(0);
});
