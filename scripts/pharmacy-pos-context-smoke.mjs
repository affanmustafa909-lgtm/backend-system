/**
 * Smoke: pharmacy POS sale context validation + API persist.
 * Usage: node scripts/pharmacy-pos-context-smoke.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envRaw = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const getEnv = (k, fallback = "") =>
  (envRaw.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1] ?? fallback).trim().replace(/^["']|["']$/g, "");

const API = (process.env.API_BASE || "http://127.0.0.1:3000").replace(/\/$/, "");
const EMAIL = "admin.pharmacy@pops.demo";
const PASSWORD = getEnv("SEED_USER_PASSWORD", "Owner@12345");
const BRANCH = "PHAR-HQ";
const stamp = Date.now().toString().slice(-6);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function req(method, urlPath, { token, body, query } = {}) {
  const u = new URL(API + urlPath);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null && v !== "") u.searchParams.set(k, String(v));
  const res = await fetch(u, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) throw new Error(`${method} ${urlPath} ${res.status}: ${typeof json === "string" ? json : JSON.stringify(json)}`);
  return json;
}

function validate(ctx) {
  if (!ctx.channel) return "Select sale channel (Counter / Instation / Outstation).";
  if (ctx.channel !== "counter") {
    if (!ctx.areaId) return "Select an area for this sale.";
    if (!ctx.routeId) return "Select a station / route for this sale.";
  }
  if (!ctx.employeeId) return "Select an employee for this sale.";
  return null;
}

assert(validate({}) === "Select sale channel (Counter / Instation / Outstation).", "empty channel");
assert(validate({ channel: "counter" }) === "Select an employee for this sale.", "counter needs emp");
assert(validate({ channel: "outstation", areaId: "a" }) === "Select a station / route for this sale.", "out needs route");
assert(validate({ channel: "counter", employeeId: "e" }) === null, "counter+emp ok");
assert(validate({ channel: "outstation", areaId: "a", routeId: "r", employeeId: "e" }) === null, "full outstation ok");
console.log("[PASS] validatePharmacyPosContext helpers");

const login = await req("POST", "/v1/auth/login", { body: { email: EMAIL, password: PASSWORD } });
const token = login.accessToken || login.access_token;
assert(token, "login token");
console.log("[PASS] login");

const areas = await req("GET", "/v1/pharmacy/areas", { token });
const routes = await req("GET", "/v1/pharmacy/routes", { token });
const employees = await req("GET", "/v1/pharmacy/employees-picker", { token });
assert(Array.isArray(areas) && areas.length > 0, "need areas");
assert(Array.isArray(routes) && routes.length > 0, "need routes");
assert(Array.isArray(employees) && employees.length > 0, "need employees");

const outArea = areas.find((a) => a.isOutstation) || areas[0];
const route = routes.find((r) => r.areaId === outArea.id) || routes[0];
const emp = employees[0];

const med = await req("POST", "/v1/pharmacy/medicines", {
  token,
  body: {
    branchCode: BRANCH,
    sku: `POSCTX-${stamp}`,
    name: `POS Context Med ${stamp}`,
    category: "Tablet",
    sellingPrice: 50,
    purchasePrice: 30,
    currentStock: 200,
    tabletsPerStrip: 10,
    stripsPerBox: 10,
  },
});
assert(med?.id, "medicine created");
console.log("[PASS] seed medicine", med.sku);

const sale = await req("POST", "/v1/pharmacy/sales", {
  token,
  body: {
    branchCode: BRANCH,
    saleChannel: outArea.isOutstation ? "outstation" : "instation",
    areaId: outArea.id,
    routeId: route.id,
    employeeId: emp.id,
    stationLabel: route.station || route.name,
    paymentMethod: "Cash",
    payments: [{ method: "Cash", amount: 50 }],
    discount: 0,
    lines: [{ medicineId: med.id, qty: 1, saleUnit: "piece" }],
  },
});

assert(sale?.id, "sale created");
assert(sale.saleChannel === (outArea.isOutstation ? "outstation" : "instation"), `channel persisted got ${sale.saleChannel}`);
assert(sale.areaId === outArea.id, "areaId persisted");
assert(sale.routeId === route.id, "routeId persisted");
assert(sale.employeeId === emp.id, "employeeId persisted");
assert(sale.employeeName, "employeeName returned");
assert(sale.stationLabel, "stationLabel persisted");

console.log("[PASS] createSale with POS context", sale.invoiceNumber, sale.saleChannel, sale.stationLabel, sale.employeeName);

const counterSale = await req("POST", "/v1/pharmacy/sales", {
  token,
  body: {
    branchCode: BRANCH,
    saleChannel: "counter",
    employeeId: emp.id,
    stationLabel: "Counter",
    paymentMethod: "Cash",
    payments: [{ method: "Cash", amount: 50 }],
    discount: 0,
    lines: [{ medicineId: med.id, qty: 1, saleUnit: "piece" }],
  },
});
assert(counterSale.saleChannel === "counter", "counter channel");
assert(counterSale.employeeId === emp.id, "counter employee");
console.log("[PASS] counter sale", counterSale.invoiceNumber);
console.log("SMOKE OK");
