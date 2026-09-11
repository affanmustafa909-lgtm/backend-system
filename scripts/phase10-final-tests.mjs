/**
 * Final-phase IO / audit / export suite. Real API, no mocks.
 *
 *   node scripts/phase10-final-tests.mjs
 *
 * HONESTY: not run in the authoring environment. Missing
 * FINAL_PHASE_TEST_RESULTS.json means NOT RUN — not a pass.
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

async function login() {
  const res = await post("/v1/auth/login", { email: EMAIL, password: PASSWORD }, { auth: false });
  if (!res.ok) throw new Error(`Login failed (${res.status}): ${msg(res)}`);
  token = res.json?.accessToken || res.json?.token || res.json?.access_token;
  if (!token) throw new Error("Login returned no token");
}

async function main() {
  const unauth = await get("/v1/pharmacy/io/modules");
  check("io.requiresAuth", unauth.status === 401 || unauth.status === 403, msg(unauth), "401/403", unauth.status);

  await login();

  const modules = await get("/v1/pharmacy/io/modules");
  const ids = (modules.json ?? []).map((m) => m.id);
  check("io.modules", modules.ok && ids.includes("medicines") && ids.includes("opening_stock"), msg(modules), true, modules.ok);

  const tpl = await get("/v1/pharmacy/io/templates/medicines");
  check(
    "io.template.csv",
    tpl.ok && typeof tpl.json?.csv === "string" && /Product Code/.test(tpl.json.csv) && /Paracetamol/.test(tpl.json.csv),
    msg(tpl),
    true,
    tpl.ok,
  );

  const unmapped = await post("/v1/pharmacy/io/validate", {
    branchCode: BRANCH,
    module: "medicines",
    headers: ["Medicine Name"],
    rows: [["X"]],
    mapping: {},
  });
  check("io.validate.requiresMapping", unmapped.status === 400, msg(unmapped), 400, unmapped.status);

  const sku = `FIN-${RUN_ID}`;
  const valid = await post("/v1/pharmacy/io/validate", {
    branchCode: BRANCH,
    module: "medicines",
    headers: ["Product Code", "Product Name"],
    rows: [[sku, `Final phase ${RUN_ID}`]],
    mapping: { sku: "Product Code", name: "Product Name" },
  });
  check("io.validate.validRow", valid.ok && valid.json?.validRows === 1, msg(valid), 1, valid.json?.validRows);

  const missing = await post("/v1/pharmacy/io/validate", {
    branchCode: BRANCH,
    module: "medicines",
    headers: ["Product Code", "Product Name"],
    rows: [["", "No code"]],
    mapping: { sku: "Product Code", name: "Product Name" },
  });
  check("io.validate.missingRequired", missing.ok && missing.json?.invalidRows >= 1, msg(missing), ">=1", missing.json?.invalidRows);

  const blocked = await post("/v1/pharmacy/io/commit", {
    branchCode: BRANCH,
    module: "medicines",
    headers: ["Product Code", "Product Name"],
    rows: [["", "No code"]],
    mapping: { sku: "Product Code", name: "Product Name" },
  });
  check("io.commit.rejectsInvalid", blocked.status === 400, msg(blocked), 400, blocked.status);

  const committed = await post("/v1/pharmacy/io/commit", {
    branchCode: BRANCH,
    module: "medicines",
    fileName: `final-${RUN_ID}.csv`,
    headers: ["Product Code", "Product Name"],
    rows: [[sku, `Final phase ${RUN_ID}`]],
    mapping: { sku: "Product Code", name: "Product Name" },
  });
  check("io.commit.imports", committed.ok && Number(committed.json?.importedRows) >= 1, msg(committed), ">=1", committed.json?.importedRows);

  const jobs = await get("/v1/pharmacy/io/jobs", { page: 1 });
  check("io.jobs.lists", jobs.ok && Array.isArray(jobs.json?.items), msg(jobs), true, jobs.ok);

  const exported = await post("/v1/pharmacy/io/export", { branchCode: BRANCH, module: "medicines", q: sku });
  check(
    "io.export.csv",
    exported.ok && typeof exported.json?.csv === "string" && exported.json.csv.includes(sku),
    msg(exported),
    true,
    exported.ok,
  );

  const badExport = await post("/v1/pharmacy/io/export", { branchCode: BRANCH, module: "journals" });
  check("io.export.unknownModule", badExport.status === 400, msg(badExport), 400, badExport.status);

  const audit = await get("/v1/pharmacy/io/audit", { page: 1, pageSize: 10 });
  check("audit.lists", audit.ok && Array.isArray(audit.json?.items), msg(audit), true, audit.ok);

  const health = await get("/v1/pharmacy/distribution/dashboard/kpis", { branchCode: BRANCH });
  check("dashboard.stillLive", health.ok || health.status === 404, "KPI route may be namespaced", "ok/404", health.status);

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const out = {
    phase: "final",
    runId: RUN_ID,
    api: API,
    generatedAt: new Date().toISOString(),
    summary: { passed, failed, total: results.length },
    results,
  };
  const dest = path.join(__dirname, "..", "..", "Universal-application-system-", "docs", "FINAL_PHASE_TEST_RESULTS.json");
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
