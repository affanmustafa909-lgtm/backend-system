/**
 * Phase 9 Finance suite. Real API, no mocks.
 *
 *   node scripts/phase9-finance-tests.mjs
 *
 * HONESTY: not run in the authoring environment. Missing
 * PHASE_9_TEST_RESULTS.json means NOT RUN — not a pass.
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
const patch = (route, body) => api("PATCH", route, { body });
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
  await login();

  const accounts = await get("/v1/accounting/accounts", { branchCode: BRANCH });
  check("coa.lists", accounts.ok && Array.isArray(accounts.json), msg(accounts), 200, accounts.status);
  const cash = (accounts.json ?? []).find((a) => a.code === "1101");
  const bank = (accounts.json ?? []).find((a) => a.code === "1102");
  const ar = (accounts.json ?? []).find((a) => a.code === "1301");
  const wholesale = (accounts.json ?? []).find((a) => a.code === "4111");
  check("coa.hasCash", Boolean(cash), "1101", true, Boolean(cash));
  check("coa.hasWholesale", Boolean(wholesale), "4111", true, Boolean(wholesale));

  if (cash && ar) {
    const unbalanced = await post("/v1/accounting/journal", {
      branchCode: BRANCH,
      entryDate: new Date().toISOString().slice(0, 10),
      description: `P9 unbalanced ${RUN_ID}`,
      lines: [
        { accountId: cash.id, debit: 100000, credit: 0 },
        { accountId: ar.id, debit: 0, credit: 90000 },
      ],
    });
    check("journal.rejectsUnbalanced", unbalanced.status === 400, msg(unbalanced), 400, unbalanced.status);

    const balanced = await post("/v1/accounting/journal", {
      branchCode: BRANCH,
      entryDate: new Date().toISOString().slice(0, 10),
      description: `P9 balanced ${RUN_ID}`,
      lines: [
        { accountId: cash.id, debit: 100000, credit: 0 },
        { accountId: bank?.id ?? ar.id, debit: 0, credit: 100000 },
      ],
    });
    check("journal.acceptsBalanced", balanced.ok && balanced.json?.id, msg(balanced), 200, balanced.status);

    if (balanced.json?.id) {
      const reverse = await post(`/v1/accounting/journal/${balanced.json.id}/reverse`, {
        reason: `phase9 reverse ${RUN_ID}`,
      });
      check("journal.reverse", reverse.ok, msg(reverse), 200, reverse.status);
      const again = await post(`/v1/accounting/journal/${balanced.json.id}/reverse`, {
        reason: "second reverse",
      });
      check("journal.reverse.idempotentReject", again.status === 400, msg(again), 400, again.status);
    }
  }

  const ledger = await get("/v1/accounting/ledger", { branchCode: BRANCH, page: 1, pageSize: 25 });
  check(
    "gl.paginated",
    ledger.ok && Array.isArray(ledger.json?.items) && typeof ledger.json?.total === "number",
    msg(ledger),
    "items+total",
    ledger.ok ? `${ledger.json?.items?.length}/${ledger.json?.total}` : ledger.status,
  );

  const dash = await get("/v1/pharmacy/finance/dashboard", { branchCode: BRANCH });
  check("distFinance.dashboard", dash.ok && dash.json?.kpis, msg(dash), 200, dash.status);
  check("distFinance.noFakeGross", dash.json?.kpis?.grossProfit == null, "grossProfit null unless COGS", null, dash.json?.kpis?.grossProfit);

  const recon = await get("/v1/pharmacy/finance/reconciliation", { branchCode: BRANCH });
  check("distFinance.recon", recon.ok && Array.isArray(recon.json?.checks), msg(recon), 200, recon.status);

  const periodName = `P9-${RUN_ID}`;
  const today = new Date().toISOString().slice(0, 10);
  const created = await post("/v1/accounting/periods", {
    branchCode: BRANCH,
    name: periodName,
    startDate: today,
    endDate: today,
  });
  check("period.create", created.ok && created.json?.id, msg(created), 200, created.status);
  if (created.json?.id) {
    const closed = await patch(`/v1/accounting/periods/${created.json.id}/close`, {});
    check("period.close", closed.ok && closed.json?.status === "closed", msg(closed), "closed", closed.json?.status);
    const blocked = await post("/v1/accounting/journal", {
      branchCode: BRANCH,
      entryDate: today,
      description: `P9 closed ${RUN_ID}`,
      lines: cash && ar
        ? [
            { accountId: cash.id, debit: 1, credit: 0 },
            { accountId: ar.id, debit: 0, credit: 1 },
          ]
        : [],
    });
    check("period.blocksPosting", blocked.status === 400, msg(blocked), 400, blocked.status);
    const reopened = await patch(`/v1/accounting/periods/${created.json.id}/reopen`, {
      reason: `phase9 reopen ${RUN_ID}`,
    });
    check("period.reopen", reopened.ok && reopened.json?.status === "open", msg(reopened), "open", reopened.json?.status);
  }

  const tb = await get("/v1/accounting/reports/trial-balance", { branchCode: BRANCH });
  check("report.trialBalance", tb.ok, msg(tb), 200, tb.status);

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const out = {
    phase: 9,
    runId: RUN_ID,
    api: API,
    generatedAt: new Date().toISOString(),
    summary: { passed, failed, total: results.length },
    results,
  };
  const dest = path.join(__dirname, "..", "..", "Universal-application-system-", "docs", "PHASE_9_TEST_RESULTS.json");
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
