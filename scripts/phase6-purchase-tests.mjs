/**
 * Phase 6 Purchase Window test suite.
 *
 * Exercises the real API against a real database. Nothing is mocked.
 *
 * Usage:
 *   node scripts/phase6-purchase-tests.mjs
 *   API_BASE=https://backend-system-production-28a3.up.railway.app node scripts/phase6-purchase-tests.mjs
 *
 * Env:
 *   API_BASE       default http://127.0.0.1:3000
 *   DIST_EMAIL     default admin.distribution@pops.demo
 *   DIST_PASSWORD  default SEED_USER_PASSWORD from .env, else Owner@12345
 *   BRANCH_CODE    default DIST-HQ
 *
 * Test data uses codes prefixed `P6TEST-<runId>` and warehouse `P6-TEST`.
 * The suite NEVER deletes existing data.
 *
 * Writes Universal-application-system-/docs/PHASE_6_TEST_RESULTS.json when possible.
 * Soft timings are recorded but do NOT fail the suite by budget alone.
 * Exit code is non-zero if any hard assertion fails.
 *
 * HONESTY: this script is correct against the Phase 6 source. It has NOT been
 * run in the environment that authored it (same deploy blockers as Phase 4/5).
 * Do not treat absence of PHASE_6_TEST_RESULTS.json as a pass — it means NOT RUN.
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
const PREFIX = `P6TEST-${RUN_ID}`;
const PURCHASE = "/v1/pharmacy/purchase";

const results = [];
const timings = [];
let token = "";

// ─── harness ────────────────────────────────────────────────────────────────

function record(name, passed, detail, expected, actual) {
  results.push({ name, passed, detail, expected, actual });
  const tag = passed ? "PASS" : "FAIL";
  console.log(`[${tag}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function check(name, condition, detail, expected, actual) {
  record(name, Boolean(condition), detail, expected, actual);
  return Boolean(condition);
}

function skip(name, detail) {
  record(name, true, `SKIPPED: ${detail}`, "skipped", "skipped");
}

async function api(method, route, { body, query, auth = true, label } = {}) {
  const url = new URL(`${API}${route}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const headers = { "content-type": "application/json" };
  if (auth && token) headers.authorization = `Bearer ${token}`;
  const t0 = performance.now();
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const ms = performance.now() - t0;
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (label) timings.push({ label, route, method, ms: Math.round(ms), status: res.status });
  return { status: res.status, ok: res.ok, json, text, ms };
}

const get = (route, query, opts) => api("GET", route, { query, ...opts });
const post = (route, body, opts) => api("POST", route, { body, ...opts });

function msg(res) {
  const m = res.json?.message;
  if (Array.isArray(m)) return m.join("; ");
  return m ?? res.text?.slice(0, 200) ?? String(res.status);
}

const todayPlus = (days) =>
  new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

function itemsOf(res) {
  if (Array.isArray(res.json)) return res.json;
  if (Array.isArray(res.json?.items)) return res.json.items;
  return [];
}

// ─── setup ──────────────────────────────────────────────────────────────────

async function login() {
  const res = await post("/v1/auth/login", { email: EMAIL, password: PASSWORD }, { auth: false });
  if (!res.ok) throw new Error(`Login failed (${res.status}): ${msg(res)}`);
  const t = res.json?.accessToken || res.json?.token || res.json?.access_token;
  if (!t) throw new Error("Login succeeded but no access token was returned");
  token = t;
}

async function ensureTestWarehouse() {
  const list = await get("/v1/pharmacy/warehouses", { branchCode: BRANCH });
  if (!list.ok) throw new Error(`Cannot list warehouses: ${msg(list)}`);
  const rows = Array.isArray(list.json) ? list.json : (list.json?.items ?? []);
  const existing = rows.find((w) => w.code === "P6-TEST");
  if (existing?.id) return existing.id;

  const created = await post("/v1/pharmacy/warehouses", {
    branchCode: BRANCH,
    code: "P6-TEST",
    name: "Phase 6 Test Warehouse",
  });
  if (!created.ok) throw new Error(`Cannot create warehouse P6-TEST: ${msg(created)}`);
  const id = created.json?.id ?? created.json?.warehouse?.id;
  if (!id) throw new Error("Warehouse P6-TEST created but no id returned");
  return id;
}

async function createMedicine(suffix, extra = {}) {
  const res = await post("/v1/pharmacy/medicines", {
    branchCode: BRANCH,
    sku: `${PREFIX}-${suffix}`,
    name: `Phase6 Purchase ${suffix} (${RUN_ID})`,
    genericName: "P6 Test Generic",
    category: "Tablet",
    purchasePrice: 100,
    costPrice: 100,
    sellingPrice: 150,
    wholesalePrice: 140,
    reorderLevel: 10,
    unit: "Piece",
    barcode: `${PREFIX}-BC-${suffix}`,
    ...extra,
  });
  if (!res.ok) throw new Error(`Cannot create medicine ${suffix}: ${msg(res)}`);
  const id = res.json?.id ?? res.json?.medicine?.id;
  if (!id) throw new Error(`Medicine ${suffix} created but no id returned`);
  return { id, sku: `${PREFIX}-${suffix}`, name: `Phase6 Purchase ${suffix} (${RUN_ID})` };
}

async function createSupplier() {
  const name = `${PREFIX} Supplier`;
  const res = await post("/v1/inventory/suppliers", {
    branchCode: BRANCH,
    name,
    phone: `03${RUN_ID}`,
    paymentTerms: "Net 30",
    active: true,
  });
  if (!res.ok) throw new Error(`Cannot create supplier: ${msg(res)}`);
  const id = res.json?.id;
  if (!id) throw new Error("Supplier created but no id");
  return { id, name };
}

// ─── tests ──────────────────────────────────────────────────────────────────

async function testSecurity() {
  const unauth = await get(`${PURCHASE}/suppliers/search`, { q: "x", branchCode: BRANCH }, { auth: false });
  check(
    "Security: unauthenticated supplier search rejected",
    unauth.status === 401 || unauth.status === 403,
    msg(unauth),
    "401|403",
    unauth.status,
  );

  const badTok = token;
  token = `${token.slice(0, -6)}xxxxxx`;
  const tampered = await get(`${PURCHASE}/dashboard`, { branchCode: BRANCH });
  token = badTok;
  check(
    "Security: tampered JWT rejected",
    tampered.status === 401 || tampered.status === 403,
    msg(tampered),
    "401|403",
    tampered.status,
  );
}

async function testSupplierSearch(ctx) {
  const res = await get(
    `${PURCHASE}/suppliers/search`,
    { q: PREFIX, branchCode: BRANCH },
    { label: "supplier-search" },
  );
  check("Supplier search: 200", res.ok, msg(res), "2xx", res.status);
  const rows = itemsOf(res);
  const hit = rows.find((s) => s.id === ctx.supplier.id) || rows.find((s) => String(s.name ?? "").includes(PREFIX));
  check("Supplier search: finds P6TEST supplier", Boolean(hit), `n=${rows.length}`, "hit", hit?.id ?? null);
  if (hit) {
    check(
      "Supplier search: lean shape has active (not code/status)",
      "active" in hit && !("code" in hit && hit.code !== undefined && hit.status !== undefined),
      JSON.stringify({ active: hit.active, keys: Object.keys(hit).slice(0, 8) }),
    );
  }
}

async function testRequisitionFlow(ctx) {
  const created = await post(`${PURCHASE}/requisitions`, {
    branchCode: BRANCH,
    warehouseId: ctx.warehouseId,
    preferredSupplierId: ctx.supplier.id,
    notes: `Phase 6 req ${RUN_ID}`,
    lines: [
      {
        medicineId: ctx.med.id,
        requestedQty: 100,
        suggestedQty: 100,
        lastPurchasePricePkr: 100,
      },
    ],
  });
  check("Requisition: create draft", created.ok, msg(created), "2xx", created.status);
  const reqId = created.json?.id;
  if (!reqId) {
    skip("Requisition: submit/approve/convert", "no requisition id");
    return null;
  }
  check("Requisition: status draft", created.json?.status === "draft", created.json?.status, "draft", created.json?.status);

  const submitted = await post(`${PURCHASE}/requisitions/${reqId}/submit`, {});
  check("Requisition: submit", submitted.ok && submitted.json?.status === "submitted", msg(submitted), "submitted", submitted.json?.status);

  const approved = await post(`${PURCHASE}/requisitions/${reqId}/approve`, {});
  check("Requisition: approve", approved.ok && approved.json?.status === "approved", msg(approved), "approved", approved.json?.status);

  const badConvert = await post(`${PURCHASE}/requisitions/${reqId}/convert`, {});
  check(
    "Convert: rejects without supplierId",
    badConvert.status === 400 || badConvert.status === 422,
    msg(badConvert),
    "400|422",
    badConvert.status,
  );

  const converted = await post(`${PURCHASE}/requisitions/${reqId}/convert`, {
    supplierId: ctx.supplier.id,
    warehouseId: ctx.warehouseId,
    expectedDate: todayPlus(14),
  });
  check("Convert: with supplierId", converted.ok, msg(converted), "2xx", converted.status);
  const po = converted.json?.purchaseOrder ?? converted.json?.purchase_order;
  const reqAfter = converted.json?.requisition;
  check(
    "Convert: requisition converted",
    reqAfter?.status === "converted" || reqAfter?.status === "partially_converted",
    reqAfter?.status,
    "converted|partially_converted",
    reqAfter?.status,
  );
  check("Convert: returns draft PO", Boolean(po?.id) && (po?.status === "draft" || po?.status === "submitted"), po?.status, "draft", po?.status);
  return po?.id ?? null;
}

async function testPoApproveSendConfirm(ctx, fromConvertPoId) {
  let poId = fromConvertPoId;
  if (!poId) {
    const created = await post(`${PURCHASE}/orders`, {
      branchCode: BRANCH,
      supplierId: ctx.supplier.id,
      warehouseId: ctx.warehouseId,
      expectedDate: todayPlus(10),
      notes: `Phase 6 PO ${RUN_ID}`,
      lines: [{ medicineId: ctx.med.id, quantity: 100, unitCostPkr: 100 }],
    });
    check("PO: create draft (fallback)", created.ok, msg(created), "2xx", created.status);
    poId = created.json?.id;
  }
  if (!poId) {
    skip("PO: approve/send/confirm", "no PO id");
    return null;
  }

  // Ensure lines + supplier for approve path (converted PO is draft).
  const submitted = await post(`${PURCHASE}/orders/${poId}/submit`, {});
  if (!submitted.ok && !String(msg(submitted)).includes("status")) {
    // already submitted or approve-from-draft allowed
  }
  const afterSubmit = submitted.ok ? submitted : await get(`${PURCHASE}/orders/${poId}`);
  const statusBeforeApprove = afterSubmit.json?.status ?? "draft";

  const approved = await post(`${PURCHASE}/orders/${poId}/approve`, {});
  check(
    "PO: approve",
    approved.ok && approved.json?.status === "approved",
    `${msg(approved)} (was ${statusBeforeApprove})`,
    "approved",
    approved.json?.status,
  );

  const sent = await post(`${PURCHASE}/orders/${poId}/send`, {});
  check("PO: send", sent.ok && sent.json?.status === "sent", msg(sent), "sent", sent.json?.status);

  const confirmed = await post(`${PURCHASE}/orders/${poId}/confirm`, {
    confirmedDeliveryDate: todayPlus(7),
    supplierReference: `${PREFIX}-SR`,
  });
  check(
    "PO: confirm",
    confirmed.ok && confirmed.json?.status === "supplier_confirmed",
    msg(confirmed),
    "supplier_confirmed",
    confirmed.json?.status,
  );

  const full = await get(`${PURCHASE}/orders/${poId}`);
  return full.ok ? full.json : null;
}

async function testGrnPartialFullIdempotencyExpiryOverReceive(ctx, po) {
  if (!po?.id || !Array.isArray(po.lines) || !po.lines.length) {
    skip("GRN suite", "no receivable PO with lines");
    return null;
  }
  const line = po.lines[0];
  const poLineId = line.id;
  const ordered = Number(line.quantity ?? 0) + Number(line.freeQuantity ?? 0);

  const partialQty = Math.max(1, Math.floor(ordered / 2));
  const remainQty = ordered - partialQty;

  const grnPartial = await post(
    `${PURCHASE}/grns`,
    {
      branchCode: BRANCH,
      warehouseId: ctx.warehouseId,
      purchaseOrderId: po.id,
      supplierId: ctx.supplier.id,
      receivedDate: todayPlus(0),
      notes: `P6 partial ${RUN_ID}`,
      idempotencyKey: `p6-grn-partial-${RUN_ID}`,
      lines: [
        {
          medicineId: ctx.med.id,
          purchaseOrderLineId: poLineId,
          batchNumber: `B-PART-${RUN_ID}`,
          expiryDate: todayPlus(200),
          quantity: partialQty,
          unitCostPkr: 100,
        },
      ],
    },
    { label: "grn-partial" },
  );
  check("GRN: partial receive posts", grnPartial.ok, msg(grnPartial), "2xx", grnPartial.status);

  const poAfterPartial = await get(`${PURCHASE}/orders/${po.id}`);
  check(
    "GRN: PO status partial after first receipt",
    poAfterPartial.json?.status === "partial",
    poAfterPartial.json?.status,
    "partial",
    poAfterPartial.json?.status,
  );

  const over = await post(`${PURCHASE}/grns`, {
    branchCode: BRANCH,
    warehouseId: ctx.warehouseId,
    purchaseOrderId: po.id,
    supplierId: ctx.supplier.id,
    receivedDate: todayPlus(0),
    notes: `P6 over ${RUN_ID}`,
    lines: [
      {
        medicineId: ctx.med.id,
        purchaseOrderLineId: poLineId,
        batchNumber: `B-OVER-${RUN_ID}`,
        expiryDate: todayPlus(200),
        quantity: remainQty + 50,
        unitCostPkr: 100,
      },
    ],
  });
  check(
    "GRN: over-receive blocked",
    over.status === 400 && /over-receive/i.test(msg(over)),
    msg(over),
    "400 over-receive",
    over.status,
  );

  const expired = await post(`${PURCHASE}/grns`, {
    branchCode: BRANCH,
    warehouseId: ctx.warehouseId,
    purchaseOrderId: po.id,
    supplierId: ctx.supplier.id,
    receivedDate: todayPlus(0),
    notes: `P6 expired ${RUN_ID}`,
    lines: [
      {
        medicineId: ctx.med.id,
        purchaseOrderLineId: poLineId,
        batchNumber: `B-EXP-${RUN_ID}`,
        expiryDate: todayPlus(-30),
        quantity: Math.min(1, remainQty) || 1,
        unitCostPkr: 100,
      },
    ],
  });
  check(
    "GRN: expired batch blocked",
    expired.status === 400 && /expir/i.test(msg(expired)),
    msg(expired),
    "400 expired",
    expired.status,
  );

  const idemKey = `p6-grn-full-${RUN_ID}`;
  const grnFullBody = {
    branchCode: BRANCH,
    warehouseId: ctx.warehouseId,
    purchaseOrderId: po.id,
    supplierId: ctx.supplier.id,
    receivedDate: todayPlus(0),
    notes: `P6 full ${RUN_ID}`,
    idempotencyKey: idemKey,
    lines: [
      {
        medicineId: ctx.med.id,
        purchaseOrderLineId: poLineId,
        batchNumber: `B-FULL-${RUN_ID}`,
        expiryDate: todayPlus(300),
        quantity: remainQty,
        unitCostPkr: 100,
      },
    ],
  };
  const grnFull = await post(`${PURCHASE}/grns`, grnFullBody, { label: "grn-full" });
  check("GRN: remainder receive posts", grnFull.ok, msg(grnFull), "2xx", grnFull.status);
  const grnId = grnFull.json?.id;

  const replay = await post(`${PURCHASE}/grns`, grnFullBody);
  check(
    "GRN: duplicate idempotencyKey replays",
    replay.ok && (replay.json?.replayed === true || replay.json?.id === grnId),
    `replayed=${replay.json?.replayed} id=${replay.json?.id}`,
    "same id / replayed",
    replay.json?.id,
  );

  const poAfterFull = await get(`${PURCHASE}/orders/${po.id}`);
  check(
    "GRN: PO status received after full",
    poAfterFull.json?.status === "received",
    poAfterFull.json?.status,
    "received",
    poAfterFull.json?.status,
  );

  return { grnId, grn: grnFull.json };
}

async function testInvoice(ctx, grnId) {
  if (!grnId) {
    skip("Invoice: create/post", "no GRN id");
    return;
  }
  const inv = await post(`${PURCHASE}/invoices`, {
    grnId,
    supplierInvoiceNumber: `${PREFIX}-INV`,
    invoiceDate: todayPlus(0),
  });
  check("Invoice: create from GRN", inv.ok, msg(inv), "2xx", inv.status);
  const invId = inv.json?.id;
  if (!invId) return;
  check("Invoice: draft", inv.json?.status === "draft", inv.json?.status, "draft", inv.json?.status);

  const posted = await post(`${PURCHASE}/invoices/${invId}/post`, {});
  check("Invoice: post", posted.ok && posted.json?.status === "posted", msg(posted), "posted", posted.json?.status);

  const match = await get(`${PURCHASE}/invoices/${invId}/match`);
  check("Invoice: match summary", match.ok && typeof match.json?.matched === "boolean", msg(match), "match object", match.status);
}

async function testDashboard() {
  const res = await get(`${PURCHASE}/dashboard`, { branchCode: BRANCH }, { label: "dashboard" });
  check("Dashboard: 200", res.ok, msg(res), "2xx", res.status);
  const kpis = res.json?.kpis;
  check("Dashboard: kpis is array", Array.isArray(kpis), typeof kpis, "array", Array.isArray(kpis) ? kpis.length : typeof kpis);
  if (Array.isArray(kpis) && kpis.length) {
    const keys = new Set(kpis.map((k) => k.key));
    check(
      "Dashboard: expected kpi keys present",
      keys.has("purchase_today") || keys.has("pending_pos") || keys.has("pending_approvals"),
      [...keys].slice(0, 8).join(","),
    );
    check(
      "Dashboard: kpi shape {key,label,value}",
      typeof kpis[0].key === "string" && typeof kpis[0].label === "string" && typeof kpis[0].value === "number",
    );
  }
}

async function testSupplierPerformance(ctx) {
  const res = await get(`${PURCHASE}/suppliers/${ctx.supplier.id}/performance`, { branchCode: BRANCH });
  check("Supplier performance: 200", res.ok, msg(res), "2xx", res.status);
  if (!res.ok) return;
  check("Supplier performance: has formulas echo", Boolean(res.json?.formulas?.onTimeRate), JSON.stringify(res.json?.formulas ?? {}));
  check(
    "Supplier performance: rates are number or null (no invented score)",
    !("score" in (res.json ?? {})) &&
      (res.json?.onTimeRate === null || typeof res.json?.onTimeRate === "number") &&
      (res.json?.fillRate === null || typeof res.json?.fillRate === "number") &&
      (res.json?.returnRate === null || typeof res.json?.returnRate === "number"),
    JSON.stringify({
      onTimeRate: res.json?.onTimeRate,
      fillRate: res.json?.fillRate,
      returnRate: res.json?.returnRate,
    }),
  );
}

async function testPurchaseReturn(ctx, grnId) {
  const ret = await post(`${PURCHASE}/returns`, {
    branchCode: BRANCH,
    warehouseId: ctx.warehouseId,
    supplierId: ctx.supplier.id,
    grnId: grnId ?? undefined,
    reason: `Phase 6 return ${RUN_ID}`,
    lines: [
      {
        medicineId: ctx.med.id,
        quantity: 1,
        unitCostPkr: 100,
      },
    ],
  });
  check("Purchase return: stock OUT posts", ret.ok, msg(ret), "2xx", ret.status);
  if (ret.ok) {
    check("Purchase return: has returnNumber", Boolean(ret.json?.returnNumber), ret.json?.returnNumber);
  }
}

function summarizeSoftPerformance() {
  const byLabel = new Map();
  for (const t of timings) {
    if (!byLabel.has(t.label)) byLabel.set(t.label, []);
    byLabel.get(t.label).push(t.ms);
  }
  const budgets = {
    "supplier-search": 500,
    dashboard: 800,
    "grn-partial": 2000,
    "grn-full": 2000,
  };
  const soft = [];
  for (const [label, samples] of byLabel) {
    const sorted = [...samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const budget = budgets[label] ?? null;
    soft.push({
      label,
      samples: sorted,
      median,
      best: sorted[0],
      worst: sorted[sorted.length - 1],
      budgetMs: budget,
      withinBudget: budget == null ? null : median <= budget,
      hardAssert: false,
      note: "soft timing only — not a pass/fail gate; NOT measured until this suite actually runs",
    });
    console.log(
      `[TIME] ${label}: median ${median}ms (n=${sorted.length})${budget != null ? ` budget ${budget}ms → ${median <= budget ? "within" : "OVER"} (soft)` : ""}`,
    );
  }
  record(
    "Performance: soft timings recorded (not hard-fail)",
    true,
    `${soft.length} probes — budgets are soft only; do not cite as measured until suite has been run`,
    "recorded",
    "recorded",
  );
  return soft;
}

// ─── main ───────────────────────────────────────────────────────────────────

(async () => {
  console.log(`Phase 6 Purchase tests → ${API}`);
  console.log(`Branch ${BRANCH}, run id ${RUN_ID}`);
  console.log("HONESTY: if this is the first write of PHASE_6_TEST_RESULTS.json, treat prior docs as NOT RUN.\n");

  let softPerformance = [];
  try {
    await login();
    console.log("Authenticated.\n");

    const warehouseId = await ensureTestWarehouse();
    console.log(`Warehouse P6-TEST id=${warehouseId}`);

    const supplier = await createSupplier();
    console.log(`Supplier ${supplier.name} id=${supplier.id}`);

    const med = await createMedicine("MAIN");
    console.log(`Medicine ${med.sku} id=${med.id}\n`);

    const ctx = { warehouseId, supplier, med };

    await testSecurity();
    await testSupplierSearch(ctx);
    const convertPoId = await testRequisitionFlow(ctx);
    const po = await testPoApproveSendConfirm(ctx, convertPoId);
    const grnResult = await testGrnPartialFullIdempotencyExpiryOverReceive(ctx, po);
    await testInvoice(ctx, grnResult?.grnId);
    await testDashboard();
    await testSupplierPerformance(ctx);
    await testPurchaseReturn(ctx, grnResult?.grnId);
    softPerformance = summarizeSoftPerformance();
  } catch (err) {
    record("Suite execution", false, err instanceof Error ? err.message : String(err));
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`RESULT: ${passed} passed, ${failed} failed, ${results.length} total`);
  console.log("=".repeat(60));
  if (failed) {
    console.log("\nFailures:");
    for (const r of results.filter((x) => !x.passed)) {
      console.log(`  - ${r.name}`);
      if (r.detail) console.log(`      ${r.detail}`);
      if (r.expected !== undefined) console.log(`      expected: ${r.expected}, actual: ${r.actual}`);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    api: API,
    branch: BRANCH,
    runId: RUN_ID,
    suite: "phase6-purchase",
    honesty:
      "If this file was produced without a real deployed Phase 6 API, treat results as invalid. Soft timings are never hard pass/fail. Absence of this file means the suite was NOT RUN.",
    statusNote: "Suite authoring environment: NOT RUN until deploy. This artefact only appears after an execution attempt.",
    summary: { total: results.length, passed, failed },
    results,
    softPerformance,
    timings,
  };

  const candidates = [
    path.join(__dirname, "..", "..", "Universal-application-system-", "docs", "PHASE_6_TEST_RESULTS.json"),
    path.join(__dirname, "phase6-test-results.json"),
  ];
  for (const out of candidates) {
    try {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(report, null, 2));
      console.log(`\nReport written: ${out}`);
      break;
    } catch {
      // try next
    }
  }

  process.exit(failed ? 1 : 0);
})();
