/**
 * Phase 2 dashboard performance + smoke probe.
 *
 * Usage:
 *   node scripts/phase2-dashboard-perf.mjs
 *   API_BASE=https://... BRANCH_CODE=DIST-HQ node scripts/phase2-dashboard-perf.mjs
 *
 * Measures wall-clock latency for each modular dashboard endpoint.
 * Writes docs/PHASE_2_PERFORMANCE.md when UNIVERSAL_DOCS is set, else
 * backend-system/scripts/phase2-perf-report.json
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
const BRANCH = process.env.BRANCH_CODE || "DIST-HQ";
const RUNS = Math.max(1, Number(process.env.PERF_RUNS || 3));

const ENDPOINTS = [
  "summary",
  "sales-trend",
  "top-products",
  "top-customers",
  "company-performance",
  "salesmen",
  "action-center",
  "stock-health",
  "recovery",
  "deliveries",
  "field-force",
];

async function login() {
  const res = await fetch(`${API}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Login failed: ${json.message || res.status}`);
  const token = json.accessToken || json.token || json.access_token;
  if (!token) throw new Error("No access token in login response");
  return token;
}

async function timedGet(token, suffix, query = {}) {
  const u = new URL(`${API}/v1/pharmacy/distribution/dashboard/${suffix}`);
  for (const [k, v] of Object.entries(query)) {
    if (v != null && v !== "") u.searchParams.set(k, String(v));
  }
  const t0 = performance.now();
  const res = await fetch(u, { headers: { authorization: `Bearer ${token}` } });
  const text = await res.text();
  const ms = performance.now() - t0;
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, ms, bytes: text.length, json };
}

function avg(nums) {
  return nums.reduce((a, b) => a + b, 0) / (nums.length || 1);
}

async function main() {
  console.log(`API=${API} branch=${BRANCH} runs=${RUNS}`);
  const token = await login();
  console.log("Login OK");

  // Unauthorized probe
  const unauth = await fetch(`${API}/v1/pharmacy/distribution/dashboard/summary`);
  const security = {
    unauthorizedWithoutToken: unauth.status === 401 || unauth.status === 403,
    status: unauth.status,
  };

  // Bad warehouse probe
  const badWh = await timedGet(token, "summary", {
    branchCode: BRANCH,
    warehouseId: "00000000-0000-0000-0000-000000000099",
    preset: "today",
  });

  const results = [];
  for (const ep of ENDPOINTS) {
    const samples = [];
    let last = null;
    let ok = true;
    let err = "";
    for (let i = 0; i < RUNS; i++) {
      last = await timedGet(token, ep, { branchCode: BRANCH, preset: ep === "sales-trend" ? "last30" : "today" });
      samples.push(last.ms);
      if (!last.ok) {
        ok = false;
        err = `HTTP ${last.status}`;
      }
    }
    results.push({
      endpoint: `/v1/pharmacy/distribution/dashboard/${ep}`,
      ok,
      error: err,
      runs: RUNS,
      avgMs: Math.round(avg(samples)),
      minMs: Math.round(Math.min(...samples)),
      maxMs: Math.round(Math.max(...samples)),
      responseBytes: last?.bytes ?? 0,
      hasGeneratedAt: Boolean(last?.json?.generatedAt),
    });
    console.log(
      `${ok ? "OK" : "FAIL"} ${ep.padEnd(22)} avg=${Math.round(avg(samples))}ms max=${Math.round(Math.max(...samples))}ms bytes=${last?.bytes ?? 0}`,
    );
  }

  // Parallel storm (simulates dashboard mount)
  const tStorm0 = performance.now();
  await Promise.all(
    ENDPOINTS.map((ep) =>
      timedGet(token, ep, { branchCode: BRANCH, preset: ep === "sales-trend" ? "last30" : "today" }),
    ),
  );
  const stormMs = Math.round(performance.now() - tStorm0);
  console.log(`Parallel all widgets: ${stormMs}ms (${ENDPOINTS.length} requests)`);

  const report = {
    measuredAt: new Date().toISOString(),
    api: API,
    branch: BRANCH,
    runs: RUNS,
    security,
    badWarehouseRejected: !badWh.ok,
    parallelAllWidgetsMs: stormMs,
    requestCountOnMount: ENDPOINTS.length,
    endpoints: results,
  };

  const outJson = path.join(__dirname, "phase2-perf-report.json");
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2));
  console.log(`Wrote ${outJson}`);

  const docsCandidate = path.join(
    __dirname,
    "..",
    "..",
    "Universal-application-system-",
    "docs",
    "PHASE_2_PERFORMANCE.md",
  );
  const md = `# Phase 2 — Dashboard Performance

**Measured:** ${report.measuredAt}  
**API:** \`${API}\`  
**Branch:** \`${BRANCH}\`  
**Runs per endpoint:** ${RUNS}

## Request architecture

| Metric | Value |
|--------|-------|
| Modular endpoints | ${ENDPOINTS.length} |
| Typical PS Window mount | ${ENDPOINTS.length} aggregate GETs (independent widgets) |
| Parallel storm (all widgets) | **${stormMs} ms** |
| Full-table load to browser | **No** — server aggregations only |

## Security probes

| Check | Result |
|-------|--------|
| Unauthorized (no token) | ${security.unauthorizedWithoutToken ? "PASS (401/403)" : `FAIL (status ${security.status})`} |
| Invalid warehouseId | ${report.badWarehouseRejected ? "PASS (rejected)" : "FAIL (accepted)"} |

## Endpoint timings

| Endpoint | OK | Avg ms | Min | Max | Bytes |
|----------|----|--------|-----|-----|-------|
${results
  .map(
    (r) =>
      `| \`${r.endpoint}\` | ${r.ok ? "yes" : "NO " + r.error} | ${r.avgMs} | ${r.minMs} | ${r.maxMs} | ${r.responseBytes} |`,
  )
  .join("\n")}

## Notes

- Timings are wall-clock client→API including network; DB time is not separately instrumented in this probe.
- Indexes for Phase 2 are listed in \`docs/PHASE_2_INDEXES.md\` — apply via \`pnpm db:push\` on the target database.
- Legacy \`/distribution/ps-window\` and \`/ps-window/widgets\` remain for backward compatibility; the PS Window UI now uses modular \`/dashboard/*\` routes.
- Target: summary &lt; 300ms on warm DB where practical; large orgs may need further EXPLAIN-driven tuning.

## Before vs after (architecture)

| | Before Phase 2 hardening | After |
|--|--------------------------|-------|
| Shell API | 1 fat \`ps-window\` (13 parallel SQL) | \`summary\` + focused widgets |
| Widgets | 1 fat \`widgets\` (all-or-nothing) | 10 independent endpoints |
| Filters | branch only | date preset + WH/company/salesman/territory/route |
| Sales basis | Mixed invoice/order (**incorrect deltas**) | Invoice-unified |
| Indexes | Almost none | 18 secondary indexes documented |
`;

  try {
    fs.mkdirSync(path.dirname(docsCandidate), { recursive: true });
    fs.writeFileSync(docsCandidate, md);
    console.log(`Wrote ${docsCandidate}`);
  } catch (e) {
    console.warn("Could not write docs markdown:", e.message);
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length || !security.unauthorizedWithoutToken) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
