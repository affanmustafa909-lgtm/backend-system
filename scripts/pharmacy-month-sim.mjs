/**
 * Pharmacy previous-month simulation (PK distribution + retail).
 *
 * Structure (always):
 *  - 10 companies, 200 medicine brands
 *  - 10 cities; 5 outstation zila areas; 2 instation; 1 in-house HQ area
 *  - Doctors with 20 clinic-attached recommended medicines
 *  - Trade customers across cities/routes
 *
 * Load (30 days = previous calendar month):
 *  - Retail: CUSTOMERS_PER_DAY sales/day (default 200 smoke; FULL=10000)
 *  - Dist: bookings → invoices → deliveries → collections across cities
 *
 * Usage:
 *   node scripts/pharmacy-month-sim.mjs              # smoke 200/day
 *   node scripts/pharmacy-month-sim.mjs --full        # 10,000/day (heavy)
 *   node scripts/pharmacy-month-sim.mjs --per-day=500
 *   node scripts/pharmacy-month-sim.mjs --verify-only
 */
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const dbUrl = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
if (!dbUrl) throw new Error("DATABASE_URL missing");

const args = process.argv.slice(2);
const VERIFY_ONLY = args.includes("--verify-only");
const FULL = args.includes("--full");
const perDayArg = args.find((a) => a.startsWith("--per-day="));
const CUSTOMERS_PER_DAY = perDayArg
  ? Math.max(1, Number(perDayArg.split("=")[1]) || 200)
  : FULL
    ? 10_000
    : 200;

const TAG = "SIM30";
const uuid = () => crypto.randomUUID();

function prevMonthRange(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-based current
  const start = new Date(Date.UTC(y, m - 1, 1, 8, 0, 0));
  const end = new Date(Date.UTC(y, m, 0, 20, 0, 0)); // last day prev month
  const days = end.getUTCDate();
  return { start, end, days, year: start.getUTCFullYear(), month: start.getUTCMonth() + 1 };
}

function dayStamp(year, month, day, hour = 10, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, Math.floor(Math.random() * 50)));
}

const BRANDS = [
  "Panadol", "Augmentin", "Brufen", "Disprin", "Flagyl", "Amoxil", "Zantac", "Risek",
  "Concor", "Norvasc", "Glucophage", "Diamicron", "Ventolin", "Singulair", "Clarityn",
  "Calpol", "Ponstan", "Ciproxin", "Augmentin ES", "Xanax", "Lexotanil", "Inderal",
  "Lasix", "Aldactone", "Aspirin Protect", "Plavix", "Crestor", "Lipitor", "Coversyl",
  "Tavanic", "Zinnat", "Klacid", "Azomax", "Septran", "Fucidin", "Betnovate",
];

function brandName(i) {
  const base = BRANDS[i % BRANDS.length];
  const strength = [250, 500, 625, 1000][i % 4];
  return `${base} ${strength}mg Brand-${String(i + 1).padStart(3, "0")}`;
}

async function main() {
  const range = prevMonthRange();
  console.log(`\n=== Pharmacy ${TAG} month sim ===`);
  console.log(`Period: ${range.year}-${String(range.month).padStart(2, "0")} (${range.days} days)`);
  console.log(`Retail load: ${CUSTOMERS_PER_DAY}/day × ${range.days} ≈ ${CUSTOMERS_PER_DAY * range.days} sales`);
  console.log(VERIFY_ONLY ? "Mode: verify-only\n" : "Mode: inject + verify\n");

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();

  const org = (
    await client.query(
      `SELECT id, name FROM organizations WHERE system_type = 'pharmacy' OR licence_key ILIKE '%PHARMACY%' ORDER BY created_at ASC LIMIT 1`,
    )
  ).rows[0];
  if (!org) throw new Error("No pharmacy organization found");

  const branch = (
    await client.query(
      `SELECT id, code, name FROM pops_branches WHERE organization_id = $1 AND (code = 'PHAR-HQ' OR code ILIKE '%PHAR%') ORDER BY created_at ASC LIMIT 1`,
      [org.id],
    )
  ).rows[0] || (
    await client.query(`SELECT id, code, name FROM pops_branches WHERE organization_id = $1 LIMIT 1`, [org.id])
  ).rows[0];
  if (!branch) throw new Error("No pharmacy branch");

  console.log(`Org=${org.name} (${org.id})`);
  console.log(`Branch=${branch.code} (${branch.id})\n`);

  if (!VERIFY_ONLY) {
    await injectStructure(client, org.id, branch.id, range);
    await injectMonthLoad(client, org.id, branch.id, range);
  }

  await verify(client, org.id, branch.id, range);
  await client.end();
  console.log("\nDone.");
}

async function injectStructure(db, orgId, branchId, range) {
  console.log("— Structure —");

  // Clean prior SIM30 tagged masters (safe re-run)
  await db.query(`DELETE FROM pharmacy_doctor_commission_entries WHERE notes LIKE $1`, [`${TAG}%`]);
  await db.query(
    `DELETE FROM pharmacy_sale_lines WHERE sale_id IN (SELECT id FROM pharmacy_sales WHERE invoice_number LIKE $1)`,
    [`INV-${TAG}-%`],
  );
  await db.query(`DELETE FROM pharmacy_sales WHERE invoice_number LIKE $1`, [`INV-${TAG}-%`]);
  await db.query(
    `DELETE FROM pharmacy_prescription_items WHERE prescription_id IN (SELECT id FROM pharmacy_prescriptions WHERE prescription_number LIKE $1)`,
    [`RX-${TAG}-%`],
  );
  await db.query(`DELETE FROM pharmacy_prescriptions WHERE prescription_number LIKE $1`, [`RX-${TAG}-%`]);
  await db.query(`DELETE FROM pharmacy_wholesale_return_lines WHERE return_id IN (SELECT id FROM pharmacy_wholesale_returns WHERE return_number LIKE $1)`, [`WRN-${TAG}-%`]);
  await db.query(`DELETE FROM pharmacy_wholesale_returns WHERE return_number LIKE $1`, [`WRN-${TAG}-%`]);
  await db.query(`DELETE FROM pharmacy_collections WHERE collection_number LIKE $1`, [`COL-${TAG}-%`]);
  await db.query(`DELETE FROM pharmacy_deliveries WHERE delivery_number LIKE $1`, [`DLV-${TAG}-%`]);
  await db.query(`DELETE FROM pharmacy_dist_invoice_lines WHERE invoice_id IN (SELECT id FROM pharmacy_dist_invoices WHERE invoice_number LIKE $1)`, [`WINV-${TAG}-%`]);
  await db.query(`DELETE FROM pharmacy_dist_invoices WHERE invoice_number LIKE $1`, [`WINV-${TAG}-%`]);
  await db.query(`DELETE FROM pharmacy_dist_order_lines WHERE order_id IN (SELECT id FROM pharmacy_dist_orders WHERE order_number LIKE $1)`, [`DO-${TAG}-%`]);
  await db.query(`DELETE FROM pharmacy_dist_orders WHERE order_number LIKE $1`, [`DO-${TAG}-%`]);
  await db.query(`DELETE FROM pharmacy_doctor_recommendations WHERE notes LIKE $1`, [`${TAG}%`]);
  await db.query(`DELETE FROM pharmacy_doctor_commission_rules WHERE notes LIKE $1`, [`${TAG}%`]);
  await db.query(`DELETE FROM pharmacy_doctors WHERE code LIKE $1`, [`DOC-${TAG}-%`]);
  await db.query(`DELETE FROM pharmacy_patients WHERE code LIKE $1`, [`PAT-${TAG}-%`]);
  await db.query(`DELETE FROM pharmacy_trade_customers WHERE code LIKE $1`, [`CUS-${TAG}-%`]);
  await db.query(`DELETE FROM pharmacy_medicine_batches WHERE batch_number LIKE $1`, [`BAT-${TAG}-%`]);
  await db.query(`DELETE FROM pharmacy_medicines WHERE sku LIKE $1`, [`MED-${TAG}-%`]);
  await db.query(`DELETE FROM pharmacy_companies WHERE code LIKE $1`, [`COM-${TAG}-%`]);
  await db.query(`DELETE FROM pharmacy_routes WHERE code LIKE $1`, [`RTE-${TAG}-%`]);
  await db.query(`DELETE FROM pharmacy_areas WHERE code LIKE $1`, [`ARA-${TAG}-%`]);
  await db.query(`DELETE FROM pharmacy_cities WHERE code LIKE $1`, [`CTY-${TAG}-%`]);
  await db.query(`DELETE FROM pharmacy_territories WHERE code LIKE $1`, [`TER-${TAG}-%`]);
  await db.query(`DELETE FROM pharmacy_schemes WHERE code LIKE $1 OR name LIKE $1`, [`${TAG}%`]);
  await db.query(`DELETE FROM pharmacy_warehouses WHERE code LIKE $1`, [`WH-${TAG}-%`]);

  // Warehouses: in-house HQ + main
  const whInHouse = uuid();
  const whMain = uuid();
  await db.query(
    `INSERT INTO pharmacy_warehouses (id, organization_id, branch_id, code, name, city, is_default, status)
     VALUES ($1,$2,$3,$4,$5,'Lahore',false,'active'), ($6,$2,$3,$7,$8,'Lahore',true,'active')`,
    [whInHouse, orgId, branchId, `WH-${TAG}-IH`, `${TAG} In-House Store`, whMain, `WH-${TAG}-MAIN`, `${TAG} Main Warehouse`],
  );
  console.log("  warehouses: in-house + main");

  // 10 companies
  const companyIds = [];
  for (let i = 1; i <= 10; i++) {
    const id = uuid();
    companyIds.push(id);
    await db.query(
      `INSERT INTO pharmacy_companies (id, organization_id, code, name, manufacturer_name, city, country, status)
       VALUES ($1,$2,$3,$4,$5,'Lahore','Pakistan','active')`,
      [id, orgId, `COM-${TAG}-${String(i).padStart(2, "0")}`, `${TAG} Pharma Co ${i}`, `Mfg ${i}`],
    );
  }
  console.log("  companies: 10");

  // Territory + 10 cities
  const terId = uuid();
  await db.query(
    `INSERT INTO pharmacy_territories (id, organization_id, code, name, region, status)
     VALUES ($1,$2,$3,$4,'Punjab','active')`,
    [terId, orgId, `TER-${TAG}-01`, `${TAG} Central Punjab`],
  );

  const cityNames = [
    "Lahore", "Kasur", "Sheikhupura", "Nankana", "Okara",
    "Sahiwal", "Pakpattan", "Faisalabad", "Jhang", "Toba Tek Singh",
  ];
  const cityIds = [];
  for (let i = 0; i < 10; i++) {
    const id = uuid();
    cityIds.push(id);
    await db.query(
      `INSERT INTO pharmacy_cities (id, organization_id, territory_id, code, name, status)
       VALUES ($1,$2,$3,$4,$5,'active')`,
      [id, orgId, terId, `CTY-${TAG}-${String(i + 1).padStart(2, "0")}`, `${TAG} ${cityNames[i]}`],
    );
  }

  // Areas: 5 outstation zila, 2 instation, 1 in-house
  const areaDefs = [
    { city: 1, code: "OUT-01", name: "Kasur Zila Outstation", out: true },
    { city: 2, code: "OUT-02", name: "Sheikhupura Zila Outstation", out: true },
    { city: 3, code: "OUT-03", name: "Nankana Zila Outstation", out: true },
    { city: 4, code: "OUT-04", name: "Okara Zila Outstation", out: true },
    { city: 5, code: "OUT-05", name: "Sahiwal Zila Outstation", out: true },
    { city: 0, code: "IN-01", name: "Lahore Gulberg Instation", out: false },
    { city: 0, code: "IN-02", name: "Lahore Model Town Instation", out: false },
    { city: 0, code: "IH-01", name: "In-House HQ Counter", out: false },
  ];
  const areaIds = [];
  for (const a of areaDefs) {
    const id = uuid();
    areaIds.push({ id, ...a });
    await db.query(
      `INSERT INTO pharmacy_areas (id, organization_id, city_id, code, name, is_outstation, status)
       VALUES ($1,$2,$3,$4,$5,$6,'active')`,
      [id, orgId, cityIds[a.city], `ARA-${TAG}-${a.code}`, `${TAG} ${a.name}`, a.out],
    );
  }

  // Routes / PJP beats per area
  const routeIds = [];
  for (let i = 0; i < areaIds.length; i++) {
    const id = uuid();
    routeIds.push(id);
    await db.query(
      `INSERT INTO pharmacy_routes (id, organization_id, area_id, code, name, station, sequence_no, pjp_day_of_week, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')`,
      [
        id,
        orgId,
        areaIds[i].id,
        `RTE-${TAG}-${String(i + 1).padStart(2, "0")}`,
        `${TAG} Beat ${i + 1}`,
        areaIds[i].out ? "Outstation" : areaIds[i].code.startsWith("IH") ? "In-House" : "Instation",
        i + 1,
        i % 7,
      ],
    );
  }
  console.log("  geo: 10 cities, 5 outstation + 2 instation + 1 in-house, routes/PJP");

  // 200 medicines
  const medIds = [];
  const expiry = `${range.year + 1}-12-31`;
  for (let i = 0; i < 200; i++) {
    const id = uuid();
    medIds.push(id);
    const companyId = companyIds[i % 10];
    const sku = `MED-${TAG}-${String(i + 1).padStart(3, "0")}`;
    const name = brandName(i);
    const sell = 40 + (i % 80);
    const buy = Math.max(10, sell - 15);
    await db.query(
      `INSERT INTO pharmacy_medicines (
        id, organization_id, branch_id, sku, name, brand_name, category, manufacturer, company_id,
        purchase_price_pkr, selling_price_pkr, wholesale_price_pkr, dealer_price_pkr, cost_price_pkr,
        current_stock, reorder_level, unit, tablets_per_strip, strips_per_box, status, barcode
      ) VALUES (
        $1,$2,$3,$4,$5,$6,'Tablet',$7,$8,
        $9,$10,$11,$12,$9,
        5000,100,'Tablet',10,10,'active',$13
      )`,
      [
        id, orgId, branchId, sku, name, name.split(" ")[0], `Co ${(i % 10) + 1}`, companyId,
        buy, sell, Math.round(sell * 0.85), Math.round(sell * 0.9), `890${TAG}${String(i).padStart(6, "0")}`,
      ],
    );
    await db.query(
      `INSERT INTO pharmacy_medicine_batches (
        id, medicine_id, warehouse_id, batch_number, expiry_date, quantity, purchase_rate_pkr, sale_rate_pkr, status
      ) VALUES ($1,$2,$3,$4,$5,5000,$6,$7,'active')`,
      [uuid(), id, whMain, `BAT-${TAG}-${String(i + 1).padStart(3, "0")}`, expiry, buy, sell],
    );
  }
  console.log("  medicines/brands: 200 (+ batches)");

  // Scheme
  await db.query(
    `INSERT INTO pharmacy_schemes (id, organization_id, code, name, scheme_type, buy_qty, free_qty, status)
     VALUES ($1,$2,$3,$4,'buy_x_get_y',10,1,'active')`,
    [uuid(), orgId, `SCH-${TAG}-01`, `${TAG} Buy10 Get1`],
  );

  // Doctors (12) + 20 clinic-attached recommended medicines on first 3 doctors collectively
  const doctorIds = [];
  for (let i = 1; i <= 12; i++) {
    const id = uuid();
    doctorIds.push(id);
    await db.query(
      `INSERT INTO pharmacy_doctors (id, organization_id, branch_id, code, name, specialization, clinic, phone, registration_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id, orgId, branchId,
        `DOC-${TAG}-${String(i).padStart(2, "0")}`,
        `Dr ${TAG} ${i}`,
        i % 2 ? "GP" : "Cardiology",
        `${TAG} Clinic ${i}`,
        `0300${String(1000000 + i)}`,
        `PMC-${TAG}-${i}`,
      ],
    );
    await db.query(
      `INSERT INTO pharmacy_doctor_commission_rules (id, organization_id, doctor_id, rule_type, rate_value, active, notes)
       VALUES ($1,$2,$3,'percent',5,true,$4)`,
      [uuid(), orgId, id, `${TAG} 5%`],
    );
  }
  // Attach 20 medicines to clinics (recommendations) — cycle doctors
  for (let i = 0; i < 20; i++) {
    await db.query(
      `INSERT INTO pharmacy_doctor_recommendations (id, organization_id, doctor_id, medicine_id, priority, notes, active)
       VALUES ($1,$2,$3,$4,$5,$6,true)`,
      [uuid(), orgId, doctorIds[i % doctorIds.length], medIds[i], i + 1, `${TAG} clinic attach`],
    );
  }
  console.log("  doctors: 12 + 20 clinic-attached meds + commission rules");

  // Patients pool (for retail) — 500 reusable
  const patientIds = [];
  for (let i = 1; i <= 500; i++) {
    const id = uuid();
    patientIds.push(id);
    await db.query(
      `INSERT INTO pharmacy_patients (id, organization_id, branch_id, code, name, phone)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, orgId, branchId, `PAT-${TAG}-${String(i).padStart(4, "0")}`, `Patient ${TAG} ${i}`, `0311${String(2000000 + i)}`],
    );
  }

  // Trade customers: one per route/area (~8)
  const tradeIds = [];
  for (let i = 0; i < routeIds.length; i++) {
    const id = uuid();
    tradeIds.push(id);
    const area = areaIds[i];
    await db.query(
      `INSERT INTO pharmacy_trade_customers (
        id, organization_id, branch_id, code, name, customer_type, city_id, area_id, route_id,
        credit_limit_pkr, credit_days, outstanding_pkr, price_level, status
      ) VALUES ($1,$2,$3,$4,$5,'Pharmacy',$6,$7,$8,1000000,30,0,'wholesale','active')`,
      [
        id, orgId, branchId,
        `CUS-${TAG}-${String(i + 1).padStart(2, "0")}`,
        `${TAG} Medical Store ${i + 1} (${area.name})`,
        cityIds[area.city],
        area.id,
        routeIds[i],
      ],
    );
  }
  console.log("  patients: 500 pool; trade customers:", tradeIds.length);

  // stash ids on client for load phase
  db.__sim = { whMain, whInHouse, companyIds, cityIds, areaIds, routeIds, medIds, doctorIds, patientIds, tradeIds };
}

async function injectMonthLoad(db, orgId, branchId, range) {
  console.log("\n— 30-day load —");
  const { medIds, doctorIds, patientIds, tradeIds, routeIds, whMain } = db.__sim;
  const salesPerDay = CUSTOMERS_PER_DAY;
  const batchSize = 200;

  for (let day = 1; day <= range.days; day++) {
    const t0 = Date.now();
    // Retail sales in batches
    let remaining = salesPerDay;
    let daySales = 0;
    while (remaining > 0) {
      const n = Math.min(batchSize, remaining);
      const saleRows = [];
      const lineRows = [];
      const commissionRows = [];

      for (let i = 0; i < n; i++) {
        const saleId = uuid();
        const seq = day * 100000 + (salesPerDay - remaining) + i + 1;
        const inv = `INV-${TAG}-${range.year}${String(range.month).padStart(2, "0")}${String(day).padStart(2, "0")}-${String(seq).padStart(6, "0")}`;
        const patientId = patientIds[(seq + i) % patientIds.length];
        const doctorId = doctorIds[seq % doctorIds.length];
        const createdAt = dayStamp(range.year, range.month, day, 9 + (i % 10), i % 60);
        const med = medIds[seq % medIds.length];
        const med2 = medIds[(seq * 3) % medIds.length];
        const unit1 = 50 + (seq % 40);
        const unit2 = 60 + (seq % 30);
        const qty1 = 1 + (seq % 3);
        const qty2 = 1 + (seq % 2);
        const line1 = unit1 * qty1;
        const line2 = unit2 * qty2;
        const total = line1 + line2;

        saleRows.push({
          id: saleId, inv, patientId, createdAt, total, line1, line2,
        });
        lineRows.push({ id: uuid(), saleId, med, qty: qty1, unit: unit1, total: line1 });
        lineRows.push({ id: uuid(), saleId, med: med2, qty: qty2, unit: unit2, total: line2 });
        // ~40% linked to doctor commission via prescription surrogate notes on commission only
        if (seq % 5 !== 0) {
          const c1 = Math.round(line1 * 0.05);
          const c2 = Math.round(line2 * 0.05);
          commissionRows.push({
            id: uuid(), doctorId, saleId, lineId: lineRows[lineRows.length - 2].id, med, base: line1, amount: c1, createdAt,
          });
          commissionRows.push({
            id: uuid(), doctorId, saleId, lineId: lineRows[lineRows.length - 1].id, med: med2, base: line2, amount: c2, createdAt,
          });
        }
      }

      // Bulk insert sales
      const saleValues = [];
      const saleParams = [];
      let p = 1;
      for (const s of saleRows) {
        saleValues.push(
          `($${p++},$${p++},$${p++},$${p++},$${p++},'Cash',$${p++},0,$${p++},0,0,$${p++},$${p++})`,
        );
        saleParams.push(s.id, orgId, branchId, s.inv, s.patientId, s.total, s.total, s.total, s.createdAt);
      }
      await db.query(
        `INSERT INTO pharmacy_sales (
          id, organization_id, branch_id, invoice_number, patient_id, payment_method,
          amount_paid_pkr, amount_due_pkr, subtotal_pkr, tax_pkr, discount_pkr, total_pkr, created_at
        ) VALUES ${saleValues.join(",")}`,
        saleParams,
      );

      const lineValues = [];
      const lineParams = [];
      p = 1;
      for (const l of lineRows) {
        lineValues.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
        lineParams.push(l.id, l.saleId, l.med, l.qty, l.qty * 10, l.unit, l.total);
      }
      await db.query(
        `INSERT INTO pharmacy_sale_lines (id, sale_id, medicine_id, qty, tablets_qty, unit_price_pkr, line_total_pkr)
         VALUES ${lineValues.join(",")}`,
        lineParams,
      );

      if (commissionRows.length) {
        const cValues = [];
        const cParams = [];
        p = 1;
        for (const c of commissionRows) {
          cValues.push(
            `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},5,'percent',$${p++},'accrued',$${p++},$${p++})`,
          );
          cParams.push(
            c.id, orgId, branchId, c.doctorId, c.saleId, c.lineId, c.med, c.base, c.amount, `${TAG} auto`, c.createdAt,
          );
        }
        await db.query(
          `INSERT INTO pharmacy_doctor_commission_entries (
            id, organization_id, branch_id, doctor_id, sale_id, sale_line_id, medicine_id,
            base_pkr, rate_value, rule_type, amount_pkr, status, notes, created_at
          ) VALUES ${cValues.join(",")}`,
          cParams,
        );
      }

      remaining -= n;
      daySales += n;
    }

    // Distribution: ~1 order per trade customer per day (booked→invoiced→delivered→collected)
    for (let t = 0; t < tradeIds.length; t++) {
      const orderId = uuid();
      const invId = uuid();
      const delId = uuid();
      const colId = uuid();
      const med = medIds[(day * 17 + t) % medIds.length];
      const qty = 20 + ((day + t) % 30);
      const free = Math.floor(qty / 10);
      const unit = 45 + (t % 20);
      const lineTotal = qty * unit;
      const createdAt = dayStamp(range.year, range.month, day, 14, t * 3);
      const dateStr = `${range.year}-${String(range.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const on = `DO-${TAG}-${range.month}${String(day).padStart(2, "0")}-${String(t + 1).padStart(2, "0")}`;
      const wn = `WINV-${TAG}-${range.month}${String(day).padStart(2, "0")}-${String(t + 1).padStart(2, "0")}`;
      const dn = `DLV-${TAG}-${range.month}${String(day).padStart(2, "0")}-${String(t + 1).padStart(2, "0")}`;
      const cn = `COL-${TAG}-${range.month}${String(day).padStart(2, "0")}-${String(t + 1).padStart(2, "0")}`;

      await db.query(
        `INSERT INTO pharmacy_dist_orders (
          id, organization_id, branch_id, warehouse_id, order_number, trade_customer_id, status,
          subtotal_pkr, discount_pkr, tax_pkr, total_pkr, created_at, approved_at
        ) VALUES ($1,$2,$3,$4,$5,$6,'invoiced',$7,0,0,$7,$8,$8)`,
        [orderId, orgId, branchId, whMain, on, tradeIds[t], lineTotal, createdAt],
      );
      await db.query(
        `INSERT INTO pharmacy_dist_order_lines (id, order_id, medicine_id, quantity, free_quantity, unit_price_pkr, line_total_pkr)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [uuid(), orderId, med, qty, free, unit, lineTotal],
      );
      await db.query(
        `INSERT INTO pharmacy_dist_invoices (
          id, organization_id, branch_id, order_id, trade_customer_id, invoice_number, invoice_date,
          payment_method, amount_paid_pkr, amount_due_pkr, subtotal_pkr, total_pkr, status, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,'Credit',$8,$9,$10,$10,'posted',$11)`,
        [invId, orgId, branchId, orderId, tradeIds[t], wn, dateStr, Math.round(lineTotal * 0.4), Math.round(lineTotal * 0.6), lineTotal, createdAt],
      );
      await db.query(
        `INSERT INTO pharmacy_dist_invoice_lines (id, invoice_id, medicine_id, quantity, free_quantity, unit_price_pkr, line_total_pkr)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [uuid(), invId, med, qty, free, unit, lineTotal],
      );
      await db.query(
        `INSERT INTO pharmacy_deliveries (
          id, organization_id, branch_id, delivery_number, order_id, invoice_id, trade_customer_id,
          route_id, rider_name, status, collected_pkr, delivered_at, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'delivered',$10,$11,$11)`,
        [delId, orgId, branchId, dn, orderId, invId, tradeIds[t], routeIds[t], `Rider ${t + 1}`, Math.round(lineTotal * 0.4), createdAt],
      );
      await db.query(
        `INSERT INTO pharmacy_collections (
          id, organization_id, branch_id, collection_number, trade_customer_id, invoice_id,
          amount_pkr, payment_method, notes, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,'Cash',$8,$9)`,
        [colId, orgId, branchId, cn, tradeIds[t], invId, Math.round(lineTotal * 0.4), `${TAG} recovery`, createdAt],
      );
      await db.query(
        `UPDATE pharmacy_trade_customers SET outstanding_pkr = outstanding_pkr + $1 WHERE id = $2`,
        [Math.round(lineTotal * 0.6), tradeIds[t]],
      );
    }

    // Occasional Rx for doctors (20/day)
    for (let r = 0; r < 20; r++) {
      const rxId = uuid();
      const rxNo = `RX-${TAG}-${range.month}${String(day).padStart(2, "0")}-${String(r + 1).padStart(3, "0")}`;
      const createdAt = dayStamp(range.year, range.month, day, 11, r);
      await db.query(
        `INSERT INTO pharmacy_prescriptions (
          id, organization_id, branch_id, prescription_number, patient_id, doctor_id, status, notes, created_at, verified_at, dispensed_at
        ) VALUES ($1,$2,$3,$4,$5,$6,'Dispensed',$7,$8,$8,$8)`,
        [rxId, orgId, branchId, rxNo, patientIds[r % patientIds.length], doctorIds[r % doctorIds.length], `${TAG} rx`, createdAt],
      );
      await db.query(
        `INSERT INTO pharmacy_prescription_items (id, prescription_id, medicine_id, dosage, quantity, dispensed_qty)
         VALUES ($1,$2,$3,'1x2',2,2)`,
        [uuid(), rxId, medIds[r % 20]],
      );
    }

    console.log(
      `  day ${String(day).padStart(2, "0")}/${range.days}: retail=${daySales}, dist=${tradeIds.length}, rx=20 (${Date.now() - t0}ms)`,
    );
  }
}

async function verify(db, orgId, branchId, range) {
  console.log("\n— Verify —");
  const q = async (label, sql, params = []) => {
    const r = await db.query(sql, params);
    const v = r.rows[0];
    console.log(`  ${label}:`, Object.values(v).join(" | "));
    return v;
  };

  await q(
    "companies",
    `SELECT count(*)::int AS n FROM pharmacy_companies WHERE organization_id=$1 AND code LIKE $2`,
    [orgId, `COM-${TAG}-%`],
  );
  await q(
    "medicines",
    `SELECT count(*)::int AS n FROM pharmacy_medicines WHERE organization_id=$1 AND sku LIKE $2`,
    [orgId, `MED-${TAG}-%`],
  );
  await q(
    "cities",
    `SELECT count(*)::int AS n FROM pharmacy_cities WHERE organization_id=$1 AND code LIKE $2`,
    [orgId, `CTY-${TAG}-%`],
  );
  await q(
    "areas out/in",
    `SELECT count(*) FILTER (WHERE is_outstation)::int AS outstation,
            count(*) FILTER (WHERE NOT is_outstation)::int AS instation_or_ih
     FROM pharmacy_areas WHERE organization_id=$1 AND code LIKE $2`,
    [orgId, `ARA-${TAG}-%`],
  );
  await q(
    "doctor clinic attaches",
    `SELECT count(*)::int AS n FROM pharmacy_doctor_recommendations WHERE organization_id=$1 AND notes LIKE $2`,
    [orgId, `${TAG}%`],
  );
  await q(
    "retail sales (month)",
    `SELECT count(*)::int AS sales, coalesce(sum(total_pkr),0)::bigint AS gmv
     FROM pharmacy_sales WHERE organization_id=$1 AND invoice_number LIKE $2`,
    [orgId, `INV-${TAG}-%`],
  );
  await q(
    "commission accrued",
    `SELECT count(*)::int AS rows, coalesce(sum(amount_pkr),0)::bigint AS pkr
     FROM pharmacy_doctor_commission_entries WHERE organization_id=$1 AND notes LIKE $2`,
    [orgId, `${TAG}%`],
  );
  await q(
    "dist orders/invoices/deliveries/collections",
    `SELECT
       (SELECT count(*)::int FROM pharmacy_dist_orders WHERE organization_id=$1 AND order_number LIKE $2) AS orders,
       (SELECT count(*)::int FROM pharmacy_dist_invoices WHERE organization_id=$1 AND invoice_number LIKE $3) AS invoices,
       (SELECT count(*)::int FROM pharmacy_deliveries WHERE organization_id=$1 AND delivery_number LIKE $4) AS deliveries,
       (SELECT count(*)::int FROM pharmacy_collections WHERE organization_id=$1 AND collection_number LIKE $5) AS collections`,
    [orgId, `DO-${TAG}-%`, `WINV-${TAG}-%`, `DLV-${TAG}-%`, `COL-${TAG}-%`],
  );
  await q(
    "prescriptions",
    `SELECT count(*)::int AS n FROM pharmacy_prescriptions WHERE organization_id=$1 AND prescription_number LIKE $2`,
    [orgId, `RX-${TAG}-%`],
  );
  await q(
    "trade outstanding",
    `SELECT count(*)::int AS customers, coalesce(sum(outstanding_pkr),0)::bigint AS outstanding
     FROM pharmacy_trade_customers WHERE organization_id=$1 AND code LIKE $2`,
    [orgId, `CUS-${TAG}-%`],
  );

  const expectedSales = CUSTOMERS_PER_DAY * range.days;
  const sales = (
    await db.query(
      `SELECT count(*)::int AS n FROM pharmacy_sales WHERE organization_id=$1 AND invoice_number LIKE $2`,
      [orgId, `INV-${TAG}-%`],
    )
  ).rows[0].n;

  if (!VERIFY_ONLY && sales !== expectedSales) {
    console.warn(`  WARN: expected ${expectedSales} sales, got ${sales}`);
  } else {
    console.log(`  OK sales match target ${expectedSales}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
