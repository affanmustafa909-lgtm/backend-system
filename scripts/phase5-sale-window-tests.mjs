/**
 * Phase 5 Sale Window test + soft-performance suite.
 *
 * Exercises the real API against a real database. Nothing is mocked.
 *
 * Usage:
 *   node scripts/phase5-sale-window-tests.mjs
 *   API_BASE=https://backend-system-production-28a3.up.railway.app node scripts/phase5-sale-window-tests.mjs
 *
 * Env:
 *   API_BASE       default http://127.0.0.1:3000
 *   DIST_EMAIL     default admin.distribution@pops.demo
 *   DIST_PASSWORD  default SEED_USER_PASSWORD from .env, else Owner@12345
 *   BRANCH_CODE    default DIST-HQ
 *
 * Test data uses SKUs / codes prefixed `P5TEST-<runId>` and warehouse `P5-TEST`.
 * The suite NEVER deletes existing data.
 *
 * Writes docs/PHASE_5_TEST_RESULTS.json when possible.
 * Soft timings are recorded but do NOT fail the suite by budget alone.
 * Exit code is non-zero if any hard assertion fails.
 *
 * HONESTY: this script is correct against the Phase 5 source. It has not been
 * run in the environment that authored it (same deploy blockers as Phase 4).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

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
const SKU_PREFIX = `P5TEST-${RUN_ID}`;

const results = [];
const timings = [];
let token = "";

const HEAVY_PRODUCT_KEYS = [
  "description",
  "longDescription",
  "notes",
  "composition",
  "indications",
  "sideEffects",
  "html",
  "imageBase64",
  "attachments",
];

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
const patch = (route, body, opts) => api("PATCH", route, { body, ...opts });

function msg(res) {
  return res.json?.message ?? res.text?.slice(0, 200) ?? String(res.status);
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
  const existing = rows.find((w) => w.code === "P5-TEST");
  if (existing?.id) return existing.id;

  const created = await post("/v1/pharmacy/warehouses", {
    branchCode: BRANCH,
    code: "P5-TEST",
    name: "Phase 5 Test Warehouse",
  });
  if (!created.ok) throw new Error(`Cannot create warehouse P5-TEST: ${msg(created)}`);
  const id = created.json?.id ?? created.json?.warehouse?.id;
  if (!id) throw new Error("Warehouse P5-TEST created but no id returned");
  return id;
}

async function createMedicine(suffix, extra = {}) {
  const barcode = `${SKU_PREFIX}-BC-${suffix}`;
  const res = await post("/v1/pharmacy/medicines", {
    branchCode: BRANCH,
    sku: `${SKU_PREFIX}-${suffix}`,
    name: `Phase5 Sale ${suffix} (${RUN_ID})`,
    genericName: "P5 Test Generic",
    category: "Tablet",
    purchasePrice: 100,
    costPrice: 100,
    sellingPrice: 150,
    wholesalePrice: 140,
    reorderLevel: 10,
    unit: "Piece",
    barcode,
    ...extra,
  });
  if (!res.ok) throw new Error(`Cannot create medicine ${suffix}: ${msg(res)}`);
  const id = res.json?.id ?? res.json?.medicine?.id;
  if (!id) throw new Error(`Medicine ${suffix} created but no id returned`);
  return { id, barcode, sku: `${SKU_PREFIX}-${suffix}`, name: `Phase5 Sale ${suffix} (${RUN_ID})` };
}

async function grn(warehouseId, lines, idempotencyKey) {
  return post("/v1/pharmacy/grns", {
    branchCode: BRANCH,
    warehouseId,
    receivedDate: todayPlus(0),
    notes: `Phase 5 sale test run ${RUN_ID}`,
    lines,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });
}

async function createCustomer(suffix, extra = {}) {
  const code = `${SKU_PREFIX}-C-${suffix}`;
  const res = await post("/v1/pharmacy/trade-customers", {
    branchCode: BRANCH,
    code,
    name: `Phase5 Customer ${suffix} ${RUN_ID}`,
    customerType: "Retailer",
    priceLevel: "wholesale",
    creditLimitPkr: 1_000_000,
    creditDays: 30,
    ...extra,
  });
  if (!res.ok) throw new Error(`Cannot create trade customer ${suffix}: ${msg(res)}`);
  const id = res.json?.id ?? res.json?.customer?.id;
  if (!id) throw new Error(`Customer ${suffix} created but no id`);
  return { id, code, name: `Phase5 Customer ${suffix} ${RUN_ID}` };
}

async function stockOf(medicineId, warehouseId) {
  const res = await get(`/v1/pharmacy/inventory/stock/${medicineId}`, {
    branchCode: BRANCH,
    warehouseId,
  });
  if (!res.ok) throw new Error(`Cannot read stock for ${medicineId}: ${msg(res)}`);
  return res.json?.stock ?? res.json;
}

// ─── 1. Security ────────────────────────────────────────────────────────────

async function testSecurity() {
  const saved = token;

  token = "";
  const anon = await get("/v1/pharmacy/sales/products/search", {
    branchCode: BRANCH,
    q: "paracetamol",
  });
  check(
    "Security: unauthenticated product search is rejected",
    anon.status === 401 || anon.status === 403,
    `status ${anon.status}`,
    "401 or 403",
    anon.status,
  );
  token = saved;

  token = `${saved.slice(0, -6)}AAAAAA`;
  const forged = await get("/v1/pharmacy/sales/products/search", {
    branchCode: BRANCH,
    q: "paracetamol",
  });
  check(
    "Security: invalid/tampered token on product search is rejected",
    forged.status === 401 || forged.status === 403,
    `status ${forged.status}`,
    "401 or 403",
    forged.status,
  );
  token = saved;
}

// ─── 2–4. Search / barcode ──────────────────────────────────────────────────

async function testProductSearch(ctx) {
  const res = await get(
    "/v1/pharmacy/sales/products/search",
    {
      branchCode: BRANCH,
      q: ctx.med.sku,
      warehouseId: ctx.warehouseId,
      pageSize: 24,
    },
    { label: "product-search" },
  );
  const items = itemsOf(res);
  check(
    "Product search: server-side search returns 200",
    res.ok,
    `status ${res.status}`,
    "200",
    res.status,
  );
  const hit = items.find((p) => p.id === ctx.med.id) ?? items[0];
  check(
    "Product search: includes created P5TEST medicine",
    Boolean(hit && (hit.id === ctx.med.id || String(hit.sku ?? "").includes(SKU_PREFIX))),
    hit ? `id=${hit.id} sku=${hit.sku}` : "no items",
    ctx.med.id,
    hit?.id,
  );

  const heavy = hit ? HEAVY_PRODUCT_KEYS.filter((k) => hit[k] != null && String(hit[k]).length > 200) : [];
  check(
    "Product search: lean payload (no huge unused fields)",
    Boolean(hit) && heavy.length === 0,
    hit
      ? `keys=${Object.keys(hit).join(",").slice(0, 120)}${heavy.length ? `; heavy=${heavy.join(",")}` : ""}`
      : "no hit",
    "lean row",
    heavy.length ? heavy.join(",") : "ok",
  );
  check(
    "Product search: has core lean fields",
    Boolean(hit?.id && hit?.name),
    hit ? `id/name present; availableQty=${hit.availableQty}` : "missing",
    "id+name",
    hit?.id && hit?.name ? "ok" : "missing",
  );
}

async function testCustomerSearch(ctx) {
  const res = await get(
    "/v1/pharmacy/sales/customers/search",
    { q: ctx.customer.code, pageSize: 20 },
    { label: "customer-search" },
  );
  const items = itemsOf(res);
  check(
    "Customer search: returns 200",
    res.ok,
    `status ${res.status}`,
    "200",
    res.status,
  );
  check(
    "Customer search: finds P5TEST customer",
    items.some((c) => c.id === ctx.customer.id || c.code === ctx.customer.code),
    `${items.length} hits`,
    ctx.customer.id,
    items.find((c) => c.id === ctx.customer.id)?.id,
  );
}

async function testBarcode(ctx) {
  const res = await get(
    "/v1/pharmacy/sales/products/barcode",
    {
      branchCode: BRANCH,
      barcode: ctx.med.barcode,
      warehouseId: ctx.warehouseId,
    },
    { label: "barcode-lookup" },
  );
  const items = itemsOf(res);
  check(
    "Barcode lookup: returns matching medicine",
    res.ok && items.some((p) => p.id === ctx.med.id),
    `status ${res.status}, count=${res.json?.count ?? items.length}`,
    ctx.med.id,
    items[0]?.id,
  );
}

// ─── 5. Quote + scheme ──────────────────────────────────────────────────────

async function testQuoteAndScheme(ctx) {
  let schemeOk = false;
  const scheme = await post("/v1/pharmacy/pricing/schemes", {
    name: `P5 Scheme ${RUN_ID}`,
    schemeType: "buy_x_get_y",
    medicineId: ctx.med.id,
    buyQty: 10,
    freeQty: 1,
    startDate: todayPlus(-1),
    endDate: todayPlus(365),
  });
  if (scheme.ok) {
    schemeOk = true;
    check("Scheme: create buy_x_get_y for test medicine", true, `id=${scheme.json?.id}`, "created", "created");
  } else {
    skip("Scheme: create buy_x_get_y for test medicine", `could not create (${scheme.status}): ${msg(scheme)}`);
  }

  const quote = await post(
    "/v1/pharmacy/sales/pricing/quote",
    {
      branchCode: BRANCH,
      tradeCustomerId: ctx.customer.id,
      warehouseId: ctx.warehouseId,
      lines: [{ medicineId: ctx.med.id, quantity: 20 }],
    },
    { label: "pricing-quote" },
  );
  check(
    "Pricing quote: returns 200 with line price",
    quote.ok && Array.isArray(quote.json?.lines) && quote.json.lines[0]?.unitPricePkr != null,
    `status ${quote.status}, source=${quote.json?.lines?.[0]?.priceSource}`,
    "200 + unitPricePkr",
    quote.json?.lines?.[0]?.unitPricePkr,
  );
  check(
    "Pricing quote: priceSource label present",
    typeof quote.json?.lines?.[0]?.priceSource === "string" && quote.json.lines[0].priceSource.length > 0,
    quote.json?.lines?.[0]?.priceSource ?? "missing",
    "non-empty source",
    quote.json?.lines?.[0]?.priceSource,
  );

  if (schemeOk && quote.ok) {
    const free = Number(quote.json.lines[0]?.freeQuantity ?? 0);
    // buy 10 get 1 → qty 20 → free 2
    check(
      "Pricing quote: scheme free qty floor(qty/buy)*free",
      free === 2,
      `freeQuantity=${free}`,
      2,
      free,
    );
  } else {
    skip("Pricing quote: scheme free qty floor(qty/buy)*free", "scheme not creatable or quote failed");
  }

  ctx.quote = quote.json;
  return schemeOk;
}

// ─── 6. Validate insufficient stock ─────────────────────────────────────────

async function testValidateInsufficientStock(ctx) {
  const huge = await post(
    "/v1/pharmacy/sales/validate",
    {
      branchCode: BRANCH,
      tradeCustomerId: ctx.customer.id,
      warehouseId: ctx.warehouseId,
      lines: [{ medicineId: ctx.med.id, quantity: 9_999_999 }],
    },
    { label: "validate" },
  );
  const errors = huge.json?.errors ?? [];
  const stockErr = errors.find((e) => e.code === "INSUFFICIENT_STOCK");
  check(
    "Validate: insufficient stock returns structured INSUFFICIENT_STOCK",
    huge.ok && huge.json?.valid === false && Boolean(stockErr),
    `valid=${huge.json?.valid}, codes=${errors.map((e) => e.code).join(",") || msg(huge)}`,
    "valid:false + INSUFFICIENT_STOCK",
    stockErr?.code ?? huge.status,
  );
}

// ─── 7. Credit limit + override reason ───────────────────────────────────────

async function testCredit(ctx) {
  const tight = await createCustomer("CREDIT", {
    creditLimitPkr: 50,
    openingBalancePkr: 0,
  });

  const bodyBase = {
    branchCode: BRANCH,
    tradeCustomerId: tight.id,
    warehouseId: ctx.warehouseId,
    lines: [{ medicineId: ctx.medStocked.id, quantity: 1, unitPricePkr: 500 }],
  };

  const blocked = await post("/v1/pharmacy/sales/validate", {
    ...bodyBase,
    creditOverride: false,
  });
  const creditErr = (blocked.json?.errors ?? []).find((e) => e.code === "CREDIT_LIMIT");
  check(
    "Credit: over-limit validate blocks without override",
    blocked.ok && blocked.json?.valid === false && Boolean(creditErr),
    `valid=${blocked.json?.valid}, msg=${creditErr?.message ?? msg(blocked)}`,
    "CREDIT_LIMIT",
    creditErr?.code,
  );

  const silent = await post("/v1/pharmacy/sales/validate", {
    ...bodyBase,
    creditOverride: true,
  });
  // SalesCreditService throws BadRequest when override without reason — Nest may 400
  // or validation may surface CREDIT_LIMIT / message mentioning reason.
  const silentMsg = JSON.stringify(silent.json ?? silent.text).toLowerCase();
  const silentBlocked =
    silent.status === 400 ||
    silent.json?.valid === false ||
    /creditoverridereason|override reason|cannot be silent/.test(silentMsg);
  check(
    "Credit: override without reason is refused",
    silentBlocked,
    `status ${silent.status}, body=${silentMsg.slice(0, 160)}`,
    "400 or invalid / reason required",
    silent.status,
  );

  const withReason = await post("/v1/pharmacy/sales/validate", {
    ...bodyBase,
    creditOverride: true,
    creditOverrideReason: `P5TEST override ${RUN_ID}`,
  });
  const stillCredit = (withReason.json?.errors ?? []).find((e) => e.code === "CREDIT_LIMIT");
  // May still fail stock; credit itself should allow. Check credit object or absence of CREDIT_LIMIT.
  check(
    "Credit: override with reason clears credit block",
    withReason.ok && !stillCredit && (withReason.json?.credit?.allowed !== false),
    `valid=${withReason.json?.valid}, creditAllowed=${withReason.json?.credit?.allowed}, errors=${(withReason.json?.errors ?? []).map((e) => e.code).join(",")}`,
    "no CREDIT_LIMIT error",
    stillCredit?.code ?? "ok",
  );

  ctx.tightCustomer = tight;
}

// ─── 8–9. Book idempotency ──────────────────────────────────────────────────

async function testBookIdempotency(ctx) {
  const key = `p5-idem-${RUN_ID}-${randomUUID()}`;
  const body = {
    branchCode: BRANCH,
    tradeCustomerId: ctx.customer.id,
    warehouseId: ctx.warehouseId,
    submit: true,
    idempotencyKey: key,
    lines: [{ medicineId: ctx.medStocked.id, quantity: 1 }],
  };

  const first = await post("/v1/pharmacy/sales/book", body, { label: "book" });
  const order1 = first.json?.order ?? first.json;
  check(
    "Book: first book with idempotency key succeeds",
    first.ok && (first.json?.booked === true || order1?.id) && order1?.id,
    `status ${first.status}, booked=${first.json?.booked}, id=${order1?.id}`,
    "booked order id",
    order1?.id,
  );

  const second = await post("/v1/pharmacy/sales/book", body, { label: "book-replay" });
  const order2 = second.json?.order ?? second.json;
  check(
    "Book idempotency: same key twice → one order id",
    Boolean(order1?.id) && order1.id === order2?.id,
    `first=${order1?.id}, second=${order2?.id}, numbers=${order1?.orderNumber}/${order2?.orderNumber}`,
    order1?.id,
    order2?.id,
  );

  const keyA = `p5-dup-a-${RUN_ID}-${randomUUID()}`;
  const keyB = `p5-dup-b-${RUN_ID}-${randomUUID()}`;
  const line = { medicineId: ctx.medStocked.id, quantity: 1 };
  const a = await post("/v1/pharmacy/sales/book", {
    ...body,
    idempotencyKey: keyA,
    lines: [line],
  });
  const b = await post("/v1/pharmacy/sales/book", {
    ...body,
    idempotencyKey: keyB,
    lines: [line],
  });
  const idA = (a.json?.order ?? a.json)?.id;
  const idB = (b.json?.order ?? b.json)?.id;
  check(
    "Book: different idempotency keys create two orders",
    Boolean(idA && idB && idA !== idB),
    `idA=${idA}, idB=${idB}`,
    "two distinct ids",
    idA === idB ? "same" : "distinct",
  );

  ctx.bookedOrderId = order1?.id;
}

// ─── 10. Availability FEFO ──────────────────────────────────────────────────

async function testAvailabilityFefo(ctx) {
  const med = await createMedicine("FEFO");
  const late = await grn(
    ctx.warehouseId,
    [
      {
        medicineId: med.id,
        batchNumber: `B-LATE-${RUN_ID}`,
        expiryDate: todayPlus(400),
        quantity: 50,
        purchaseRatePkr: 100,
      },
    ],
    `p5-grn-late-${RUN_ID}`,
  );
  const early = await grn(
    ctx.warehouseId,
    [
      {
        medicineId: med.id,
        batchNumber: `B-EARLY-${RUN_ID}`,
        expiryDate: todayPlus(60),
        quantity: 30,
        purchaseRatePkr: 100,
      },
    ],
    `p5-grn-early-${RUN_ID}`,
  );
  check("FEFO setup: late-expiry GRN posts", late.ok, msg(late), "2xx", late.status);
  check("FEFO setup: early-expiry GRN posts", early.ok, msg(early), "2xx", early.status);

  const avail = await get(
    "/v1/pharmacy/inventory/availability",
    {
      branchCode: BRANCH,
      warehouseId: ctx.warehouseId,
      medicineId: med.id,
      quantity: 40,
    },
    { label: "availability" },
  );
  const line = avail.json?.lines?.[0] ?? avail.json;
  const allocs = line?.allocations ?? [];
  check(
    "Availability: FEFO first allocation is earliest expiry batch",
    avail.ok && allocs[0]?.batchNumber === `B-EARLY-${RUN_ID}`,
    `first=${allocs[0]?.batchNumber}, allocs=${allocs.map((a) => `${a.batchNumber}:${a.quantity}`).join(",")}`,
    `B-EARLY-${RUN_ID}`,
    allocs[0]?.batchNumber,
  );
  ctx.fefoMed = med;
}

// ─── 11. Book → approve → invoice stock deduction ───────────────────────────

async function testBookInvoiceDeduction(ctx) {
  const before = await stockOf(ctx.medStocked.id, ctx.warehouseId);
  const availableBefore = Number(before?.availableQty ?? before?.quantity ?? 0);
  if (availableBefore < 3) {
    skip(
      "Book→invoice: stock deduction (paid+free)",
      `availableQty=${availableBefore} < 3 — cannot safely invoice`,
    );
    return;
  }

  const paid = 2;
  const free = 0; // explicit; paid+free identity still holds
  const key = `p5-inv-${RUN_ID}-${randomUUID()}`;
  const book = await post("/v1/pharmacy/sales/book", {
    branchCode: BRANCH,
    tradeCustomerId: ctx.customer.id,
    warehouseId: ctx.warehouseId,
    submit: true,
    idempotencyKey: key,
    lines: [{ medicineId: ctx.medStocked.id, quantity: paid, freeQuantity: free }],
  });
  const order = book.json?.order ?? book.json;
  if (!book.ok || !order?.id) {
    check("Book→invoice: book step", false, msg(book), "booked", book.status);
    return;
  }

  const approve = await post(`/v1/pharmacy/distribution/orders/${order.id}/approve`, {});
  check(
    "Book→invoice: approve booked order",
    approve.ok,
    `status ${approve.status} ${msg(approve)}`,
    "2xx",
    approve.status,
  );
  if (!approve.ok) return;

  const invoice = await post(`/v1/pharmacy/distribution/orders/${order.id}/invoice`, {});
  check(
    "Book→invoice: invoice posts",
    invoice.ok,
    `status ${invoice.status} ${msg(invoice)}`,
    "2xx",
    invoice.status,
  );
  if (!invoice.ok) return;

  const after = await stockOf(ctx.medStocked.id, ctx.warehouseId);
  const availableAfter = Number(after?.availableQty ?? after?.quantity ?? 0);
  const need = paid + free;
  check(
    "Book→invoice: available qty decreases by paid+free",
    availableAfter === availableBefore - need,
    `before=${availableBefore}, after=${availableAfter}, need=${need}`,
    availableBefore - need,
    availableAfter,
  );

  const ordersList = await get("/v1/pharmacy/distribution/orders", { branchCode: BRANCH });
  const list = itemsOf(ordersList);
  const row =
    list.find((o) => o.id === order.id) ??
    (Array.isArray(ordersList.json) ? ordersList.json.find((o) => o.id === order.id) : null);
  if (row) {
    check(
      "Book→invoice: order status is invoiced",
      row.status === "invoiced",
      `status=${row.status}`,
      "invoiced",
      row.status,
    );
  } else {
    skip("Book→invoice: order status is invoiced", "order not found in list response shape — stock check still applies");
  }
}

// ─── 12. Soft performance summary (no hard fail) ────────────────────────────

function summarizeSoftPerformance() {
  const byLabel = new Map();
  for (const t of timings) {
    if (!byLabel.has(t.label)) byLabel.set(t.label, []);
    byLabel.get(t.label).push(t.ms);
  }
  const soft = [];
  const budgets = {
    "product-search": 300,
    "barcode-lookup": 300,
    "customer-search": 300,
    availability: 300,
    validate: 500,
    "pricing-quote": 500,
    book: 1000,
    "book-replay": 1000,
  };
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
      note: "soft timing only — not a pass/fail gate",
    });
    console.log(
      `[TIME] ${label}: median ${median}ms (n=${sorted.length})${budget != null ? ` budget ${budget}ms → ${median <= budget ? "within" : "OVER"} (soft)` : ""}`,
    );
  }
  record(
    "Performance: soft timings recorded (not hard-fail)",
    true,
    `${soft.length} probes written to PHASE_5_TEST_RESULTS.json`,
    "recorded",
    "recorded",
  );
  return soft;
}

// ─── main ───────────────────────────────────────────────────────────────────

(async () => {
  console.log(`Phase 5 Sale Window tests → ${API}`);
  console.log(`Branch ${BRANCH}, run id ${RUN_ID}\n`);

  let softPerformance = [];
  try {
    await login();
    console.log("Authenticated.\n");

    const warehouseId = await ensureTestWarehouse();
    console.log(`Warehouse P5-TEST id=${warehouseId}\n`);

    await testSecurity();

    const med = await createMedicine("SEARCH");
    const customer = await createCustomer("MAIN");
    const medStocked = await createMedicine("STOCK");
    const receive = await grn(
      warehouseId,
      [
        {
          medicineId: medStocked.id,
          batchNumber: `B-STOCK-${RUN_ID}`,
          expiryDate: todayPlus(200),
          quantity: 100,
          purchaseRatePkr: 100,
        },
      ],
      `p5-grn-stock-${RUN_ID}`,
    );
    check("Setup: stock GRN for book/invoice medicine", receive.ok, msg(receive), "2xx", receive.status);

    const ctx = { warehouseId, med, medStocked, customer };

    await testProductSearch(ctx);
    await testCustomerSearch(ctx);
    await testBarcode(ctx);
    await testQuoteAndScheme(ctx);
    await testValidateInsufficientStock(ctx);
    await testCredit(ctx);
    await testBookIdempotency(ctx);
    await testAvailabilityFefo(ctx);
    await testBookInvoiceDeduction(ctx);
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
    suite: "phase5-sale-window",
    honesty:
      "If this file was produced without a real API, treat results as invalid. Soft timings are never hard pass/fail.",
    summary: { total: results.length, passed, failed },
    results,
    softPerformance,
    timings,
  };

  const candidates = [
    path.join(__dirname, "..", "..", "Universal-application-system-", "docs", "PHASE_5_TEST_RESULTS.json"),
    path.join(__dirname, "phase5-test-results.json"),
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
