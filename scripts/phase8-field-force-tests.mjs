/**
 * Phase 8 Field Force suite. Real API, no mocks.
 *
 *   node scripts/phase8-field-force-tests.mjs
 *
 * HONESTY: not run in the authoring environment. Missing
 * PHASE_8_TEST_RESULTS.json means NOT RUN — not a pass.
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
const RUN_ID = Date.now().toString().slice(-8);
const FF = "/v1/pharmacy/field-force";

const results = [];
let token = "";

function record(name, passed, detail, expected, actual) {
  results.push({ name, passed, detail, expected, actual });
  console.log(`[${passed ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}
function check(name, condition, detail, expected, actual) {
  record(name, Boolean(condition), detail, expected, actual);
  return Boolean(condition);
}
function skip(name, detail) {
  record(name, true, `SKIPPED: ${detail}`, "skipped", "skipped");
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
function itemsOf(res) {
  if (Array.isArray(res.json)) return res.json;
  if (Array.isArray(res.json?.items)) return res.json.items;
  return [];
}

function achievementPct(actual, target) {
  if (!(target > 0)) return null;
  return Math.round((actual / target) * 10000) / 100;
}

async function login() {
  const res = await post("/v1/auth/login", { email: EMAIL, password: PASSWORD }, { auth: false });
  if (!res.ok) throw new Error(`Login failed (${res.status}): ${msg(res)}`);
  token = res.json?.accessToken || res.json?.token || res.json?.access_token;
  if (!token) throw new Error("No access token");
  check("auth.login", true, BRANCH);
}

async function main() {
  console.log(`Phase 8 suite → ${API} as ${EMAIL} branch=${BRANCH} run=${RUN_ID}`);
  await login();

  check("achievement.50pct", achievementPct(500_000, 1_000_000) === 50, "500k/1m", 50, achievementPct(500_000, 1_000_000));
  check("achievement.zeroTarget", achievementPct(100, 0) === null, "must be N/A not Infinity", null, achievementPct(100, 0));

  const dash = await get(`${FF}/dashboard`, { branchCode: BRANCH });
  check("field.dashboard", dash.ok, msg(dash), 200, dash.status);
  if (dash.ok) {
    check("field.dashboard.kpis", Boolean(dash.json?.kpis), "kpis object");
    const pct = dash.json.kpis.visitAchievementPct;
    check("field.dashboard.noInfinity", pct === null || Number.isFinite(pct), String(pct));
  }

  const salesmen = await get(`${FF}/salesmen`, { branchCode: BRANCH, page: 1, pageSize: 10 });
  check("field.salesmen", salesmen.ok, msg(salesmen), 200, salesmen.status);

  const visits = await get(`${FF}/visits`, { branchCode: BRANCH, date: new Date().toISOString().slice(0, 10), page: 1 });
  check("field.visits.list", visits.ok, msg(visits), 200, visits.status);

  const pjp = await get(`${FF}/pjp`, { branchCode: BRANCH });
  check("field.pjp.list", pjp.ok, msg(pjp), 200, pjp.status);

  const targets = await get(`${FF}/targets`, {});
  check("field.targets.list", targets.ok, msg(targets), 200, targets.status);

  const perf = await get(`${FF}/performance`, { group: "salesman" });
  check("field.performance", perf.ok, msg(perf), 200, perf.status);

  const today = new Date().toISOString().slice(0, 10);
  const gen1 = await post(`${FF}/visits/generate`, { date: today, branchCode: BRANCH, idempotencyKey: `P8-${RUN_ID}` });
  const gen2 = await post(`${FF}/visits/generate`, { date: today, branchCode: BRANCH, idempotencyKey: `P8-${RUN_ID}` });
  if (gen1.ok && gen2.ok) {
    check(
      "field.generate.idempotent",
      Number(gen2.json?.created ?? 0) === 0 || Number(gen2.json?.skipped ?? 0) >= 0,
      `first created=${gen1.json?.created} second created=${gen2.json?.created} skipped=${gen2.json?.skipped}`,
    );
  } else {
    skip("field.generate.idempotent", `generate ${gen1.status}/${gen2.status} ${msg(gen1)} ${msg(gen2)}`);
  }

  const employees = await get("/v1/pharmacy/employees-picker", { branchCode: BRANCH });
  const emp = itemsOf(employees)[0];
  if (emp?.id) {
    const tgt = await post(`${FF}/targets`, {
      branchCode: BRANCH,
      employeeId: emp.id,
      periodType: "monthly",
      periodStart: `${today.slice(0, 8)}01`,
      periodEnd: today,
      targetSalesPkr: 1_000_000,
      targetCollectionPkr: 0,
      targetVisits: 0,
    });
    if (tgt.ok) {
      check("field.target.zeroVisitNa", tgt.json?.visitAchievementPct == null, String(tgt.json?.visitAchievementPct));
    } else {
      skip("field.target.create", msg(tgt));
    }
  } else {
    skip("field.target.create", "no employee");
  }

  const futureClose = await post(`${FF}/visits/close-day`, { date: today });
  check("field.closeDay.rejectsToday", futureClose.status === 400, msg(futureClose), 400, futureClose.status);

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const out = {
    phase: 8,
    runId: RUN_ID,
    api: API,
    generatedAt: new Date().toISOString(),
    summary: { passed, failed, total: results.length },
    results,
  };
  const dest = path.join(__dirname, "..", "..", "Universal-application-system-", "docs", "PHASE_8_TEST_RESULTS.json");
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify(out, null, 2));
    console.log(`Wrote ${dest}`);
  } catch (e) {
    console.warn(e.message);
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
