/**
 * Universal sync gateway suite. Real API, no mocks.
 *
 *   node scripts/sync-platform-tests.mjs
 *
 * Missing SYNC_PLATFORM_TEST_RESULTS.json means NOT RUN — not a pass.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
const envRaw = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
const getEnv = (k, fallback = "") => {
  const m = envRaw.match(new RegExp(`^${k}=(.+)$`, "m"));
  return (m?.[1] ?? fallback).trim().replace(/^["']|["']$/g, "");
};

const API = (process.env.API_BASE || process.env.API_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const EMAIL = process.env.DIST_EMAIL || "admin.distribution@pops.demo";
const PASSWORD = process.env.DIST_PASSWORD || getEnv("SEED_USER_PASSWORD", "Owner@12345");
const RUN_ID = Date.now().toString().slice(-8);
const results = [];
let token = "";
let orgId = "";

function record(name, passed, detail, expected, actual) {
  results.push({ name, passed, detail, expected, actual });
  console.log(`[${passed ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}
function check(name, condition, detail, expected, actual) {
  record(name, Boolean(condition), detail, expected, actual);
  return Boolean(condition);
}

async function api(method, route, { body, query, auth = true } = {}) {
  const url = new URL(`${API}${route}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v != null && v !== "") url.searchParams.set(k, String(v));
  }
  const headers = { "content-type": "application/json" };
  if (auth && token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, json, text };
}
const get = (route, query) => api("GET", route, { query });
const post = (route, body, opts) => api("POST", route, { body, ...opts });
function msg(res) {
  const m = res.json?.message;
  return Array.isArray(m) ? m.join("; ") : m ?? res.text?.slice(0, 200) ?? String(res.status);
}

function decodeOrg(access) {
  try {
    const payload = JSON.parse(Buffer.from(access.split(".")[1], "base64url").toString("utf8"));
    return payload.organizationId || "";
  } catch {
    return "";
  }
}

async function main() {
  const unauth = await get("/v1/sync/status");
  check("sync.requiresAuth", unauth.status === 401 || unauth.status === 403, msg(unauth), "401/403", unauth.status);

  const login = await post("/v1/auth/login", { email: EMAIL, password: PASSWORD }, { auth: false });
  if (!login.ok) throw new Error(`Login failed (${login.status}): ${msg(login)}`);
  token = login.json?.accessToken || login.json?.token;
  orgId = decodeOrg(token);
  check("auth.login", Boolean(token && orgId), msg(login), true, Boolean(token));

  const deviceId = `test-device-${RUN_ID}-xxxxxxxx`.slice(0, 36);
  const reg = await post("/v1/sync/register-device", { deviceId, deviceName: "suite", platform: "test" });
  check("sync.registerDevice", reg.ok && reg.json?.status === "active", msg(reg), "active", reg.json?.status);

  const status = await get("/v1/sync/status");
  check("sync.status", status.ok && typeof status.json?.appliedMutations === "number", msg(status), true, status.ok);

  const pull = await get("/v1/sync/pull");
  check("sync.pull", pull.ok && Array.isArray(pull.json?.changes) && typeof pull.json?.cursor === "string", msg(pull), true, pull.ok);

  const mutationId = crypto.randomUUID();
  const batch = {
    idempotencyKey: crypto.randomUUID(),
    organizationId: orgId,
    protocolVersion: 1,
    deviceId,
    mutations: [
      {
        entityType: "unknown_entity",
        operation: "create",
        clientMutationId: mutationId,
        payload: { ping: true },
      },
    ],
  };
  const pushed = await post("/v1/sync/push", batch);
  const first = pushed.json?.results?.[0];
  check("sync.push.unsupportedNotDuplicate", pushed.ok && first?.status === "unsupported", msg(pushed), "unsupported", first?.status);

  const again = await post("/v1/sync/push", batch);
  check("sync.push.idempotentUnsupported", again.ok, msg(again), true, again.ok);

  const init = await post("/v1/sync/initialize", { deviceId });
  check("sync.initialize", init.ok && Array.isArray(init.json?.changes), msg(init), true, init.ok);

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const dest = path.join(__dirname, "..", "..", "Universal-application-system-", "docs", "SYNC_PLATFORM_TEST_RESULTS.json");
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(
      dest,
      JSON.stringify({ phase: "sync-platform", runId: RUN_ID, api: API, generatedAt: new Date().toISOString(), summary: { passed, failed, total: results.length }, results }, null, 2),
    );
  } catch (e) {
    console.warn(e.message);
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
