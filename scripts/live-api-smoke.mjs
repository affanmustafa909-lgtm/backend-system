/**
 * Live API smoke test for restaurant owner (basit@gmail.com).
 * Usage: node backend-system/scripts/live-api-smoke.mjs
 */
const BASE = process.env.API_BASE_URL ?? "https://backend-desktop-production-600b.up.railway.app";
const EMAIL = process.env.TEST_EMAIL ?? "basit@gmail.com";
const PASSWORD = process.env.TEST_PASSWORD ?? "basit@gmail.com";

function decodeJwt(token) {
  const payload = token.split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

async function req(method, path, { token, body, query } = {}) {
  const url = new URL(path.startsWith("http") ? path : `${BASE}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const started = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
      data: null,
    };
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text?.slice(0, 200) ?? null;
  }
  return {
    ok: res.ok,
    status: res.status,
    ms: Date.now() - started,
    error: res.ok
      ? null
      : typeof data === "object" && data && "message" in data
        ? String(data.message)
        : text?.slice(0, 180) || res.statusText,
    data,
  };
}

function row(label, r) {
  const mark = r.ok ? "OK " : "ERR";
  const detail = r.ok ? `${r.status} ${r.ms}ms` : `${r.status} ${r.ms}ms — ${r.error}`;
  console.log(`${mark}  ${label.padEnd(44)} ${detail}`);
  return r.ok;
}

async function main() {
  console.log(`BASE ${BASE}`);
  console.log(`USER ${EMAIL}\n`);

  const login = await req("POST", "/v1/auth/login", {
    body: { email: EMAIL, password: PASSWORD },
  });
  if (!row("POST /v1/auth/login", login) || !login.data?.accessToken) {
    process.exit(1);
  }
  const token = login.data.accessToken;
  const claims = decodeJwt(token);
  const branchCode = "MAIN";
  console.log(
    `    claims: role=${claims.role} org=${claims.organizationId} system=${claims.systemType}\n`,
  );

  const checks = [];
  const add = async (label, method, path, opts = {}) => {
    checks.push(await req(method, path, { token, ...opts }).then((r) => ({ label, r })));
  };

  await add("GET /health", "GET", "/health");
  await add("GET /v1/operations/branches", "GET", "/v1/operations/branches");
  await add("GET /v1/operations/dashboard", "GET", "/v1/operations/dashboard", {
    query: { branchCode },
  });

  await add("GET /v1/billing/orders", "GET", "/v1/billing/orders", { query: { branchCode } });
  await add("GET /v1/billing/waiters", "GET", "/v1/billing/waiters", { query: { branchCode } });
  await add("GET /v1/menu", "GET", "/v1/menu", { query: { branchCode } });
  await add("GET /v1/kitchen/tickets", "GET", "/v1/kitchen/tickets", { query: { branchCode } });
  await add("GET /v1/tables", "GET", "/v1/tables", { query: { branchCode } });
  await add("GET /v1/tables/admin", "GET", "/v1/tables/admin", { query: { branchCode } });

  await add("GET /v1/inventory", "GET", "/v1/inventory", { query: { branchCode } });
  await add("GET /v1/hr/employees", "GET", "/v1/hr/employees", { query: { branchCode } });
  await add("GET /v1/users", "GET", "/v1/users");

  await add("GET /v1/accounting/dashboard", "GET", "/v1/accounting/dashboard", {
    query: { branchCode },
  });
  await add("GET /v1/accounting/expenses", "GET", "/v1/accounting/expenses", {
    query: { branchCode },
  });
  await add("GET /v1/accounting/payable", "GET", "/v1/accounting/payable", {
    query: { branchCode },
  });
  await add("GET /v1/accounting/receivable", "GET", "/v1/accounting/receivable", {
    query: { branchCode },
  });
  // 404 = no open session (valid empty state)
  {
    const r = await req("GET", "/v1/accounting/cash-sessions/open", {
      token,
      query: { branchCode },
    });
    const softOk = r.ok || (r.status === 404 && /no open cash session/i.test(r.error ?? ""));
    checks.push({
      label: "GET /v1/accounting/cash-sessions/open",
      r: softOk ? { ...r, ok: true, status: r.status || 200 } : r,
    });
  }
  await add("GET /v1/accounting/vendors", "GET", "/v1/accounting/vendors", {
    query: { branchCode },
  });

  await add("GET /v1/tax-authority/features", "GET", "/v1/tax-authority/features");
  await add("GET /v1/tax-authority/status", "GET", "/v1/tax-authority/status", {
    query: { branchCode },
  });
  await add("GET /v1/tax-authority/invoices", "GET", "/v1/tax-authority/invoices", {
    query: { branchCode },
  });
  await add("GET /v1/pra/status", "GET", "/v1/pra/status", { query: { branchCode } });
  await add("GET /v1/pra/invoices", "GET", "/v1/pra/invoices", { query: { branchCode } });
  await add("GET /v1/pra/dashboard", "GET", "/v1/pra/dashboard", {
    query: { branchCode, mode: "real" },
  });
  await add("GET /v1/pra/activity-logs", "GET", "/v1/pra/activity-logs", {
    query: { branchCode },
  });
  await add("GET /v1/fbr/status", "GET", "/v1/fbr/status", { query: { branchCode } });

  await add("GET /v1/printing/printers", "GET", "/v1/printing/printers", {
    query: { branchCode },
  });
  await add("GET /v1/delivery/orders", "GET", "/v1/delivery/orders", { query: { branchCode } });
  await add("GET /v1/multi-branch/overview", "GET", "/v1/multi-branch/overview");
  await add("GET /v1/reports/catalog", "GET", "/v1/reports/catalog");
  await add("GET /v1/reports/sales-by-item", "GET", "/v1/reports/sales-by-item", {
    query: { branchCode },
  });

  let ok = 0;
  let fail = 0;
  const failures = [];
  for (const { label, r } of checks) {
    if (row(label, r)) ok += 1;
    else {
      fail += 1;
      failures.push({ label, status: r.status, error: r.error });
    }
  }

  console.log(`\nSummary: ${ok} ok · ${fail} failed · ${ok + fail} total`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(` - ${f.label}: [${f.status}] ${f.error}`);
  }

  console.log("\n--- POS write probe ---");
  const menu = await req("GET", "/v1/menu", { token, query: { branchCode } });
  row("GET /v1/menu (for POS)", menu);
  const items = Array.isArray(menu.data?.items) ? menu.data.items : [];
  const first = items.find((i) => i?.id && i?.isActive !== false && i?.price != null);
  let createdBillId = null;
  if (!first) {
    console.log("ERR  No menu item found for POS create probe");
    fail += 1;
  } else {
    const createBill = await req("POST", "/v1/billing/bills", {
      token,
      body: {
        branchCode,
        tableLabel: "SMOKE-TEST",
        lines: [{ menuItemId: first.id, label: first.name ?? "Item", qty: 1, unitPrice: first.price }],
        status: "held",
      },
    });
    if (row("POST /v1/billing/bills (held)", createBill)) {
      createdBillId = createBill.data?.id ?? null;
      ok += 1;
    } else fail += 1;
    if (createdBillId) {
      const del = await req("DELETE", `/v1/billing/bills/${createdBillId}`, { token });
      row("DELETE probe bill", del);
    }
  }

  console.log("\n--- Tax Active toggle (org admin) ---");
  const feat = await req("GET", "/v1/tax-authority/features", { token });
  row("features before", feat);
  if (feat.data) console.log("    ", JSON.stringify(feat.data));
  const patch = await req("PATCH", "/v1/tax-authority/features", {
    token,
    body: { praFakeEnabled: false, praRealEnabled: false, fbrEnabled: false },
  });
  row("PATCH Active/Inactive (admin)", patch);
  if (!patch.ok) fail += 1;
  else ok += 1;

  console.log("\n--- Staff active toggle ---");
  const users = await req("GET", "/v1/users", { token });
  const list = Array.isArray(users.data) ? users.data : users.data?.users ?? [];
  const staff = list.find(
    (u) =>
      u?.id &&
      !["owner", "admin", "Admin"].includes(u.role) &&
      String(u.email ?? "").toLowerCase() !== EMAIL.toLowerCase(),
  );
  if (!staff) {
    console.log("SKIP no non-admin staff to toggle");
  } else {
    const off = await req("PATCH", `/v1/users/${staff.id}`, {
      token,
      body: { active: false },
    });
    row(`PATCH user inactive (${staff.email})`, off);
    const on = await req("PATCH", `/v1/users/${staff.id}`, {
      token,
      body: { active: true },
    });
    row(`PATCH user active (${staff.email})`, on);
    if (!off.ok || !on.ok) fail += 1;
    else ok += 1;
  }

  process.exit(fail > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
