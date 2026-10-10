/**
 * All-systems live API retest against Railway (or API_BASE).
 * Continues on failures and writes a full pass/fail matrix.
 *
 *   node scripts/all-systems-live-retest.mjs
 *   API_BASE=https://backend-system-production-28a3.up.railway.app node scripts/all-systems-live-retest.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
const envRaw = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
const getEnv = (k, fallback = "") => {
  const m = envRaw.match(new RegExp(`^${k}=(.+)$`, "m"));
  return (m?.[1] ?? fallback).trim().replace(/^["']|["']$/g, "");
};

const API = (
  process.env.API_BASE ||
  process.env.API_URL ||
  "https://backend-system-production-28a3.up.railway.app"
).replace(/\/$/, "");

const DEMO_PASSWORD =
  process.env.SEED_USER_PASSWORD || getEnv("SEED_USER_PASSWORD", "Owner@12345");
const SUPER_PASSWORD =
  process.env.SEED_SUPER_ADMIN_PASSWORD ||
  getEnv("SEED_SUPER_ADMIN_PASSWORD", DEMO_PASSWORD);

/** @type {{ system: string; email: string; passwords: string[]; branch: string; routes: Array<[string, string, Record<string, unknown>?]> }} */
const SYSTEMS = [
  {
    system: "platform",
    email: process.env.SUPER_EMAIL || "superadmin@pops.platform",
    passwords: [SUPER_PASSWORD, "Owner@12345", "changeme-please-01"],
    branch: "",
    routes: [
      ["GET", "/v1/platform/system-types"],
      ["GET", "/v1/platform/businesses"],
      ["GET", "/v1/platform/users"],
      ["GET", "/v1/platform/analytics"],
      ["GET", "/v1/platform/settings"],
      ["GET", "/v1/platform/licence-payments"],
      ["GET", "/v1/platform/public-info"],
    ],
  },
  {
    system: "restaurant",
    email: "admin.restaurant@pops.demo",
    passwords: [DEMO_PASSWORD, "Owner@12345", "changeme-please-01"],
    branch: "REST-HQ",
    routes: [
      ["GET", "/v1/operations/branches"],
      ["GET", "/v1/operations/dashboard", { branchCode: "REST-HQ" }],
      ["GET", "/v1/menu", { branchCode: "REST-HQ" }],
      ["GET", "/v1/billing/orders", { branchCode: "REST-HQ" }],
      ["GET", "/v1/billing/waiters", { branchCode: "REST-HQ" }],
      ["GET", "/v1/kitchen/tickets", { branchCode: "REST-HQ" }],
      ["GET", "/v1/tables", { branchCode: "REST-HQ" }],
      ["GET", "/v1/tables/admin", { branchCode: "REST-HQ" }],
      ["GET", "/v1/inventory", { branchCode: "REST-HQ" }],
      ["GET", "/v1/hr/employees", { branchCode: "REST-HQ" }],
      ["GET", "/v1/users"],
      ["GET", "/v1/accounting/dashboard", { branchCode: "REST-HQ" }],
      ["GET", "/v1/accounting/expenses", { branchCode: "REST-HQ" }],
      ["GET", "/v1/accounting/payable", { branchCode: "REST-HQ" }],
      ["GET", "/v1/accounting/receivable", { branchCode: "REST-HQ" }],
      ["GET", "/v1/delivery/orders", { branchCode: "REST-HQ" }],
      ["GET", "/v1/reports/catalog", { branchCode: "REST-HQ" }],
      ["GET", "/v1/printing/printers", { branchCode: "REST-HQ" }],
      ["GET", "/v1/multi-branch/overview"],
      ["GET", "/v1/notifications/overview"],
      ["GET", "/v1/org/alerts"],
      ["GET", "/v1/sync/status"],
    ],
  },
  {
    system: "ice_cream",
    email: "admin.icecream@pops.demo",
    passwords: [DEMO_PASSWORD, "Owner@12345"],
    branch: "SCOOP-HQ",
    routes: [
      ["GET", "/v1/operations/branches"],
      ["GET", "/v1/menu", { branchCode: "SCOOP-HQ" }],
      ["GET", "/v1/billing/orders", { branchCode: "SCOOP-HQ" }],
      ["GET", "/v1/kitchen/tickets", { branchCode: "SCOOP-HQ" }],
      ["GET", "/v1/inventory", { branchCode: "SCOOP-HQ" }],
      ["GET", "/v1/accounting/dashboard", { branchCode: "SCOOP-HQ" }],
      ["GET", "/v1/hr/employees", { branchCode: "SCOOP-HQ" }],
    ],
  },
  {
    system: "pharmacy",
    email: "admin.pharmacy@pops.demo",
    passwords: [DEMO_PASSWORD, "Owner@12345"],
    branch: "PHAR-HQ",
    routes: [
      ["GET", "/v1/operations/branches"],
      ["GET", "/v1/pharmacy/lookup", { q: "a", branchCode: "PHAR-HQ" }],
      ["GET", "/v1/pharmacy/medicines", { branchCode: "PHAR-HQ", page: 1, pageSize: 10 }],
      ["GET", "/v1/pharmacy/companies"],
      ["GET", "/v1/pharmacy/trade-customers", { branchCode: "PHAR-HQ" }],
      ["GET", "/v1/pharmacy/warehouses", { branchCode: "PHAR-HQ" }],
      ["GET", "/v1/pharmacy/masters/medicines", { branchCode: "PHAR-HQ", page: 1, pageSize: 10 }],
      ["GET", "/v1/pharmacy/inventory/dashboard", { branchCode: "PHAR-HQ" }],
      ["GET", "/v1/pharmacy/inventory/stock", { branchCode: "PHAR-HQ", page: 1, pageSize: 10 }],
      ["GET", "/v1/pharmacy/sales/returns", { branchCode: "PHAR-HQ" }],
      ["GET", "/v1/pharmacy/purchase/dashboard", { branchCode: "PHAR-HQ" }],
      ["GET", "/v1/pharmacy/purchase/orders", { branchCode: "PHAR-HQ" }],
      ["GET", "/v1/accounting/dashboard", { branchCode: "PHAR-HQ" }],
      ["GET", "/v1/hr/employees", { branchCode: "PHAR-HQ" }],
      ["GET", "/v1/users"],
    ],
  },
  {
    system: "distribution",
    email: "admin.distribution@pops.demo",
    passwords: [DEMO_PASSWORD, "Owner@12345"],
    branch: "DIST-HQ",
    routes: [
      ["GET", "/v1/operations/branches"],
      ["GET", "/v1/pharmacy/distribution/dashboard/summary", { branchCode: "DIST-HQ" }],
      ["GET", "/v1/pharmacy/distribution/dashboard/sales-trend", { branchCode: "DIST-HQ" }],
      ["GET", "/v1/pharmacy/distribution/dashboard/action-center", { branchCode: "DIST-HQ" }],
      ["GET", "/v1/pharmacy/distribution/dashboard/stock-health", { branchCode: "DIST-HQ" }],
      ["GET", "/v1/pharmacy/distribution/ps-window", { branchCode: "DIST-HQ" }],
      ["GET", "/v1/pharmacy/distribution/orders", { branchCode: "DIST-HQ" }],
      ["GET", "/v1/pharmacy/distribution/invoices", { branchCode: "DIST-HQ" }],
      ["GET", "/v1/pharmacy/trade-customers", { branchCode: "DIST-HQ" }],
      ["GET", "/v1/pharmacy/warehouses", { branchCode: "DIST-HQ" }],
      ["GET", "/v1/pharmacy/medicines", { branchCode: "DIST-HQ", page: 1, pageSize: 10 }],
      ["GET", "/v1/pharmacy/inventory/dashboard", { branchCode: "DIST-HQ" }],
      ["GET", "/v1/pharmacy/inventory/stock", { branchCode: "DIST-HQ", page: 1, pageSize: 10 }],
      ["GET", "/v1/pharmacy/inventory/batches", { branchCode: "DIST-HQ", page: 1, pageSize: 10 }],
      ["GET", "/v1/pharmacy/purchase/dashboard", { branchCode: "DIST-HQ" }],
      ["GET", "/v1/pharmacy/purchase/orders", { branchCode: "DIST-HQ" }],
      ["GET", "/v1/pharmacy/purchase/grns", { branchCode: "DIST-HQ" }],
      ["GET", "/v1/pharmacy/delivery/dashboard", { branchCode: "DIST-HQ" }],
      ["GET", "/v1/pharmacy/delivery/orders", { branchCode: "DIST-HQ" }],
      ["GET", "/v1/pharmacy/collections/dashboard", { branchCode: "DIST-HQ" }],
      ["GET", "/v1/pharmacy/collections/aging", { branchCode: "DIST-HQ" }],
      ["GET", "/v1/pharmacy/finance/dashboard", { branchCode: "DIST-HQ" }],
      ["GET", "/v1/pharmacy/field-force/dashboard", { branchCode: "DIST-HQ" }],
      ["GET", "/v1/pharmacy/field-force/visits", { branchCode: "DIST-HQ" }],
      ["GET", "/v1/pharmacy/io/modules"],
      ["GET", "/v1/pharmacy/companies"],
      ["GET", "/v1/pharmacy/territories"],
      ["GET", "/v1/pharmacy/routes"],
      ["GET", "/v1/pharmacy/sales-force"],
      ["GET", "/v1/pharmacy/pricing/lists"],
      ["GET", "/v1/accounting/accounts", { branchCode: "DIST-HQ" }],
      ["GET", "/v1/accounting/ledger", { branchCode: "DIST-HQ" }],
      ["GET", "/v1/sync/status"],
      ["GET", "/v1/hr/employees", { branchCode: "DIST-HQ" }],
      ["GET", "/v1/users"],
    ],
  },
  {
    system: "general_store",
    email: "admin.store@pops.demo",
    passwords: [DEMO_PASSWORD, "Owner@12345"],
    branch: "STORE-HQ",
    routes: [
      ["GET", "/v1/operations/branches"],
      ["GET", "/v1/store/dashboard", { branchCode: "STORE-HQ" }],
      ["GET", "/v1/store/categories", { branchCode: "STORE-HQ" }],
      ["GET", "/v1/store/brands", { branchCode: "STORE-HQ" }],
      ["GET", "/v1/store/units", { branchCode: "STORE-HQ" }],
      ["GET", "/v1/store/products", { branchCode: "STORE-HQ" }],
      ["GET", "/v1/store/batches", { branchCode: "STORE-HQ" }],
      ["GET", "/v1/store/suppliers", { branchCode: "STORE-HQ" }],
      ["GET", "/v1/store/customers", { branchCode: "STORE-HQ" }],
      ["GET", "/v1/store/warehouses", { branchCode: "STORE-HQ" }],
      ["GET", "/v1/store/purchase/orders", { branchCode: "STORE-HQ" }],
      ["GET", "/v1/store/purchase/grn", { branchCode: "STORE-HQ" }],
      ["GET", "/v1/accounting/dashboard", { branchCode: "STORE-HQ" }],
      ["GET", "/v1/hr/employees", { branchCode: "STORE-HQ" }],
      ["GET", "/v1/users"],
    ],
  },
  {
    system: "grocery",
    email: "admin.grocery@pops.demo",
    passwords: [DEMO_PASSWORD, "Owner@12345"],
    branch: "GROC-HQ",
    routes: [
      ["GET", "/v1/operations/branches"],
      ["GET", "/v1/store/dashboard", { branchCode: "GROC-HQ" }],
      ["GET", "/v1/store/products", { branchCode: "GROC-HQ" }],
      ["GET", "/v1/store/customers", { branchCode: "GROC-HQ" }],
      ["GET", "/v1/accounting/dashboard", { branchCode: "GROC-HQ" }],
    ],
  },
  {
    system: "retail",
    email: "admin.retail@pops.demo",
    passwords: [DEMO_PASSWORD, "Owner@12345"],
    branch: "RETL-HQ",
    routes: [
      ["GET", "/v1/operations/branches"],
      ["GET", "/v1/store/dashboard", { branchCode: "RETL-HQ" }],
      ["GET", "/v1/store/products", { branchCode: "RETL-HQ" }],
      ["GET", "/v1/store/customers", { branchCode: "RETL-HQ" }],
      ["GET", "/v1/accounting/dashboard", { branchCode: "RETL-HQ" }],
    ],
  },
  {
    system: "education",
    email: "admin.education@pops.demo",
    passwords: [DEMO_PASSWORD, "Owner@12345"],
    branch: "EDU-HQ",
    routes: [
      ["GET", "/v1/operations/branches"],
      ["GET", "/v1/education/dashboard", { branchCode: "EDU-HQ" }],
      ["GET", "/v1/education/modules"],
      ["GET", "/v1/education/settings"],
      ["GET", "/v1/education/lookups"],
      ["GET", "/v1/education/sessions", { branchCode: "EDU-HQ" }],
      ["GET", "/v1/education/classes", { branchCode: "EDU-HQ" }],
      ["GET", "/v1/education/sections", { branchCode: "EDU-HQ" }],
      ["GET", "/v1/education/subjects", { branchCode: "EDU-HQ" }],
      ["GET", "/v1/education/students", { branchCode: "EDU-HQ" }],
      ["GET", "/v1/education/admissions", { branchCode: "EDU-HQ" }],
      ["GET", "/v1/education/staff", { branchCode: "EDU-HQ" }],
      ["GET", "/v1/education/guardians", { branchCode: "EDU-HQ" }],
      ["GET", "/v1/education/fee-structures", { branchCode: "EDU-HQ" }],
      ["GET", "/v1/education/fee-invoices", { branchCode: "EDU-HQ" }],
      ["GET", "/v1/education/fee-payments", { branchCode: "EDU-HQ" }],
      ["GET", "/v1/hr/employees", { branchCode: "EDU-HQ" }],
      ["GET", "/v1/accounting/dashboard", { branchCode: "EDU-HQ" }],
      ["GET", "/v1/users"],
    ],
  },
];

const results = [];

function decodeJwt(token) {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function errMsg(data, text, statusText) {
  if (data && typeof data === "object") {
    const m = data.message ?? data.error;
    if (Array.isArray(m)) return m.join("; ");
    if (m != null) return String(m);
  }
  return (text || statusText || "").slice(0, 200);
}

async function req(method, route, { token, query, body } = {}) {
  const url = new URL(`${API}${route}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v != null && v !== "") url.searchParams.set(k, String(v));
  }
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return {
      ok: res.ok,
      status: res.status,
      ms: Date.now() - started,
      error: res.ok ? null : errMsg(data, text, res.statusText),
      data,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
      data: null,
    };
  }
}

function record(row) {
  results.push(row);
  const mark = row.ok ? "PASS" : "FAIL";
  const detail = row.ok
    ? `${row.status} ${row.ms}ms`
    : `${row.status} ${row.ms}ms — ${row.error ?? ""}`;
  console.log(`${mark}  [${row.system}] ${row.name.padEnd(56)} ${detail}`);
}

async function loginWithFallback(email, passwords) {
  const tried = [];
  for (const password of [...new Set(passwords.filter(Boolean))]) {
    const r = await req("POST", "/v1/auth/login", {
      body: { email, password },
    });
    tried.push({ passwordHint: password.slice(0, 3) + "***", status: r.status, error: r.error });
    if (r.ok && r.data?.accessToken) {
      return { token: r.data.accessToken, passwordUsed: password, login: r };
    }
  }
  return { token: null, passwordUsed: null, login: null, tried };
}

async function main() {
  console.log(`\n=== ALL SYSTEMS LIVE RETEST ===`);
  console.log(`API  ${API}`);
  console.log(`At   ${new Date().toISOString()}\n`);

  const health = await req("GET", "/health");
  record({
    system: "infra",
    name: "GET /health",
    ok: health.ok && health.data?.nest === true,
    status: health.status,
    ms: health.ms,
    error:
      health.ok && health.data?.nest !== true
        ? `nest=${health.data?.nest} boot=${health.data?.boot}`
        : health.error,
    meta: health.data,
  });

  if (!health.ok || health.data?.nest !== true) {
    console.error("\nNest not ready — aborting system matrix.");
  }

  for (const sys of SYSTEMS) {
    console.log(`\n--- ${sys.system} (${sys.email}) ---`);
    const auth = await loginWithFallback(sys.email, sys.passwords);
    if (!auth.token) {
      record({
        system: sys.system,
        name: `POST /v1/auth/login (${sys.email})`,
        ok: false,
        status: auth.tried?.[auth.tried.length - 1]?.status ?? 0,
        ms: 0,
        error: `login failed; tried=${JSON.stringify(auth.tried)}`,
      });
      continue;
    }
    const claims = decodeJwt(auth.token);
    record({
      system: sys.system,
      name: `POST /v1/auth/login (${sys.email})`,
      ok: true,
      status: 200,
      ms: auth.login.ms,
      error: null,
      meta: {
        role: claims?.role,
        systemType: claims?.systemType,
        organizationId: claims?.organizationId,
      },
    });

    for (const [method, route, query] of sys.routes) {
      const r = await req(method, route, { token: auth.token, query });
      record({
        system: sys.system,
        name: `${method} ${route}`,
        ok: r.ok,
        status: r.status,
        ms: r.ms,
        error: r.error,
      });
    }
  }

  // Cross-system isolation: restaurant token must not access education dashboard as owner scope
  console.log(`\n--- cross-system isolation ---`);
  const rest = await loginWithFallback("admin.restaurant@pops.demo", [
    DEMO_PASSWORD,
    "Owner@12345",
  ]);
  if (rest.token) {
    const blocked = await req("GET", "/v1/education/dashboard", { token: rest.token });
    // 403/404/401 all acceptable as isolation; 200 with foreign data would be a fail
    const isolated = !blocked.ok || blocked.status === 403 || blocked.status === 404;
    record({
      system: "isolation",
      name: "restaurant token → GET /v1/education/dashboard blocked",
      ok: isolated,
      status: blocked.status,
      ms: blocked.ms,
      error: isolated ? null : "unexpected access to education from restaurant token",
    });

    const distBlocked = await req("GET", "/v1/pharmacy/distribution/dashboard/summary", {
      token: rest.token,
      query: { branchCode: "DIST-HQ" },
    });
    const distIsolated =
      !distBlocked.ok || distBlocked.status === 403 || distBlocked.status === 404;
    record({
      system: "isolation",
      name: "restaurant token → dist dashboard blocked",
      ok: distIsolated,
      status: distBlocked.status,
      ms: distBlocked.ms,
      error: distIsolated ? null : "unexpected access to distribution from restaurant token",
    });
  }

  const bySystem = {};
  for (const r of results) {
    bySystem[r.system] ??= { pass: 0, fail: 0, total: 0 };
    bySystem[r.system].total += 1;
    if (r.ok) bySystem[r.system].pass += 1;
    else bySystem[r.system].fail += 1;
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const summary = {
    api: API,
    at: new Date().toISOString(),
    health: health.data,
    totals: { total: results.length, passed, failed },
    bySystem,
    failures: results.filter((r) => !r.ok).map((r) => ({
      system: r.system,
      name: r.name,
      status: r.status,
      error: r.error,
    })),
    results,
  };

  const out = path.join(__dirname, "ALL_SYSTEMS_LIVE_RETEST.json");
  fs.writeFileSync(out, JSON.stringify(summary, null, 2));

  console.log(`\n=== SUMMARY ===`);
  for (const [name, s] of Object.entries(bySystem)) {
    console.log(
      `${name.padEnd(16)} ${String(s.pass).padStart(3)}/${String(s.total).padStart(3)} pass` +
        (s.fail ? `  (${s.fail} fail)` : ""),
    );
  }
  console.log(`\nTOTAL ${passed}/${results.length} passed · ${failed} failed`);
  console.log(`Wrote ${out}`);

  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
