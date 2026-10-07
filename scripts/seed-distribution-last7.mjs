/**
 * Distribution demo — last 7 days activity seed (identity + registrations + O2C + field).
 *
 * Fills dashboard "Last 7" with backdated created_at / assignment_date, plus staggered
 * new user + employee registrations.
 *
 * Idempotent for transactional rows tagged L7SEED-*. Masters upserted by code.
 *
 * Usage:
 *   node scripts/seed-distribution-last7.mjs
 *   DAYS=7 node scripts/seed-distribution-last7.mjs
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const requireDb = createRequire(path.join(root, "packages", "database-pg", "package.json"));
const requireApi = createRequire(path.join(root, "api", "package.json"));
const pg = requireDb("pg");
const bcrypt = requireApi("bcryptjs");

const env = fs.readFileSync(path.join(root, ".env"), "utf8");
const dbUrl = (env.match(/^DATABASE_URL=(.+)$/m) || [])[1]?.trim();
const password = (env.match(/^SEED_USER_PASSWORD=(.+)$/m)?.[1] ?? "Owner@12345")
  .trim()
  .replace(/^["']|["']$/g, "");

if (!dbUrl) {
  console.error("DATABASE_URL missing in backend-system/.env");
  process.exit(1);
}

const DAYS = Math.max(1, Math.min(14, Number(process.env.DAYS || 7)));
const TAG = "L7SEED";
const OWNER_EMAIL = "admin.distribution@pops.demo";
const BRANCH_CODE = "DIST-HQ";
const OWNER_PERMS = [
  "pops.read",
  "pops.users.manage",
  "pops.inventory.manage",
  "distribution.masters",
  "distribution.orders",
  "distribution.deliveries",
  "distribution.collections",
  "distribution.field",
  "distribution.pricing",
];

function dayAt(daysAgo, hour = 10, minute = 0) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function ymdCompact(d) {
  return isoDate(d).replace(/-/g, "");
}

async function upsertByCode(c, table, orgId, code, insertSql, insertParams, idCol = "id") {
  const existing = await c.query(
    `SELECT ${idCol} AS id FROM ${table} WHERE organization_id = $1 AND code = $2 LIMIT 1`,
    [orgId, code],
  );
  if (existing.rows[0]?.id) return existing.rows[0].id;
  const ins = await c.query(insertSql, insertParams);
  return ins.rows[0].id;
}

async function main() {
  const c = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log(`\n=== Distribution last-${DAYS}-days seed (${TAG}) ===\n`);

  // --- org / owner / branch ---
  let orgId = (
    await c.query(`SELECT id FROM organizations WHERE licence_key = 'LIC-DEMO-DISTRIBUTION' LIMIT 1`)
  ).rows[0]?.id;

  if (!orgId) {
    const ins = await c.query(
      `INSERT INTO organizations (name, system_type, status, licence_plan, licence_key)
       VALUES ('POPS Demo Medical Distribution', 'distribution', 'active', 'demo', 'LIC-DEMO-DISTRIBUTION')
       RETURNING id`,
    );
    orgId = ins.rows[0].id;
    console.log("created org", orgId);
  } else {
    console.log("org", orgId);
  }

  const hash = await bcrypt.hash(password, 12);
  let ownerId = (await c.query(`SELECT id FROM users WHERE email = $1`, [OWNER_EMAIL])).rows[0]?.id;
  if (!ownerId) {
    const ins = await c.query(
      `INSERT INTO users (email, name, password_hash, status, created_at)
       VALUES ($1, $2, $3, 'active', $4) RETURNING id`,
      [OWNER_EMAIL, "Distribution Owner", hash, dayAt(DAYS, 9)],
    );
    ownerId = ins.rows[0].id;
    console.log("created owner", ownerId);
  } else {
    await c.query(`UPDATE users SET password_hash = $1, status = 'active' WHERE id = $2`, [hash, ownerId]);
    console.log("owner", ownerId);
  }

  const mem = await c.query(
    `SELECT user_id FROM organization_memberships WHERE organization_id = $1 AND user_id = $2`,
    [orgId, ownerId],
  );
  if (!mem.rows[0]) {
    await c.query(
      `INSERT INTO organization_memberships
         (organization_id, user_id, role, permissions, branch_scope, pin_required, active, created_at)
       VALUES ($1, $2, 'owner', $3::jsonb, 'all', false, true, $4)`,
      [orgId, ownerId, JSON.stringify(OWNER_PERMS), dayAt(DAYS, 9, 5)],
    );
  }

  let branchId = (
    await c.query(`SELECT id FROM pops_branches WHERE organization_id = $1 AND code = $2`, [
      orgId,
      BRANCH_CODE,
    ])
  ).rows[0]?.id;
  if (!branchId) {
    const ins = await c.query(
      `INSERT INTO pops_branches (organization_id, code, name, city, is_hq, created_at)
       VALUES ($1, $2, 'Distribution HQ', 'Lahore', true, $3) RETURNING id`,
      [orgId, BRANCH_CODE, dayAt(DAYS, 9)],
    );
    branchId = ins.rows[0].id;
  }
  console.log("branch", branchId);

  // --- wipe prior L7SEED transactional / registration rows ---
  console.log("wiping prior L7SEED transactional rows…");
  await c.query("BEGIN");
  try {
    await c.query(
      `DELETE FROM pharmacy_collection_allocations WHERE collection_id IN (
         SELECT id FROM pharmacy_collections
         WHERE organization_id = $1 AND collection_number LIKE $2)`,
      [orgId, `COL-${TAG}-%`],
    );
    await c.query(
      `DELETE FROM pharmacy_collections
       WHERE organization_id = $1 AND collection_number LIKE $2`,
      [orgId, `COL-${TAG}-%`],
    );
    await c.query(
      `DELETE FROM pharmacy_delivery_lines WHERE delivery_id IN (
         SELECT id FROM pharmacy_deliveries
         WHERE organization_id = $1 AND delivery_number LIKE $2)`,
      [orgId, `DEL-${TAG}-%`],
    );
    await c.query(
      `DELETE FROM pharmacy_deliveries
       WHERE organization_id = $1 AND delivery_number LIKE $2`,
      [orgId, `DEL-${TAG}-%`],
    );
    await c.query(
      `DELETE FROM pharmacy_wholesale_return_lines WHERE return_id IN (
         SELECT id FROM pharmacy_wholesale_returns
         WHERE organization_id = $1 AND return_number LIKE $2)`,
      [orgId, `WRN-${TAG}-%`],
    );
    await c.query(
      `DELETE FROM pharmacy_wholesale_returns
       WHERE organization_id = $1 AND return_number LIKE $2`,
      [orgId, `WRN-${TAG}-%`],
    );
    await c.query(
      `DELETE FROM pharmacy_visits
       WHERE organization_id = $1 AND (visit_number LIKE $2 OR notes LIKE $3)`,
      [orgId, `VIS-${TAG}-%`, `%${TAG}%`],
    );
    await c.query(
      `DELETE FROM pharmacy_assignments
       WHERE organization_id = $1 AND notes LIKE $2`,
      [orgId, `%${TAG}%`],
    );
    await c.query(
      `DELETE FROM pharmacy_promises_to_pay
       WHERE organization_id = $1 AND promise_number LIKE $2`,
      [orgId, `PTP-${TAG}-%`],
    );
    await c.query(
      `DELETE FROM pharmacy_dist_invoice_lines WHERE invoice_id IN (
         SELECT id FROM pharmacy_dist_invoices
         WHERE organization_id = $1 AND invoice_number LIKE $2)`,
      [orgId, `INV-${TAG}-%`],
    );
    await c.query(
      `DELETE FROM pharmacy_dist_invoices
       WHERE organization_id = $1 AND invoice_number LIKE $2`,
      [orgId, `INV-${TAG}-%`],
    );
    await c.query(
      `DELETE FROM pharmacy_dist_order_lines WHERE order_id IN (
         SELECT id FROM pharmacy_dist_orders
         WHERE organization_id = $1 AND order_number LIKE $2)`,
      [orgId, `ORD-${TAG}-%`],
    );
    await c.query(
      `DELETE FROM pharmacy_dist_orders
       WHERE organization_id = $1 AND order_number LIKE $2`,
      [orgId, `ORD-${TAG}-%`],
    );
    await c.query(
      `DELETE FROM pharmacy_route_customers WHERE organization_id = $1 AND route_id IN (
         SELECT id FROM pharmacy_routes WHERE organization_id = $1 AND code LIKE $2)`,
      [orgId, `${TAG}-%`],
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }

  // --- masters ---
  const companyId = await upsertByCode(
    c,
    "pharmacy_companies",
    orgId,
    `${TAG}-LAMOS`,
    `INSERT INTO pharmacy_companies (organization_id, code, name, manufacturer_name, city, status, created_at)
     VALUES ($1, $2, 'Lamos Pharma Seed', 'Lamos', 'Lahore', 'active', $3) RETURNING id`,
    [orgId, `${TAG}-LAMOS`, dayAt(DAYS, 9)],
  );

  const warehouseId = await upsertByCode(
    c,
    "pharmacy_warehouses",
    orgId,
    `${TAG}-WH`,
    `INSERT INTO pharmacy_warehouses
       (organization_id, branch_id, code, name, city, is_default, status, created_at)
     VALUES ($1, $2, $3, 'Seed Main Warehouse', 'Lahore', true, 'active', $4) RETURNING id`,
    [orgId, branchId, `${TAG}-WH`, dayAt(DAYS, 9)],
  );

  const provinceId = await upsertByCode(
    c,
    "pharmacy_provinces",
    orgId,
    `${TAG}-PB`,
    `INSERT INTO pharmacy_provinces (organization_id, code, name, status, created_at)
     VALUES ($1, $2, 'Punjab', 'active', $3) RETURNING id`,
    [orgId, `${TAG}-PB`, dayAt(DAYS, 9)],
  );

  let divisionId = (
    await c.query(
      `SELECT id FROM pharmacy_divisions WHERE organization_id = $1 AND code = $2 LIMIT 1`,
      [orgId, `${TAG}-LHR-DIV`],
    )
  ).rows[0]?.id;
  if (!divisionId) {
    divisionId = (
      await c.query(
        `INSERT INTO pharmacy_divisions (organization_id, province_id, code, name, status, created_at)
         VALUES ($1, $2, $3, 'Lahore Division', 'active', $4) RETURNING id`,
        [orgId, provinceId, `${TAG}-LHR-DIV`, dayAt(DAYS, 9)],
      )
    ).rows[0].id;
  }

  let districtId = (
    await c.query(
      `SELECT id FROM pharmacy_districts WHERE organization_id = $1 AND code = $2 LIMIT 1`,
      [orgId, `${TAG}-LHR-DST`],
    )
  ).rows[0]?.id;
  if (!districtId) {
    districtId = (
      await c.query(
        `INSERT INTO pharmacy_districts (organization_id, division_id, code, name, status, created_at)
         VALUES ($1, $2, $3, 'Lahore District', 'active', $4) RETURNING id`,
        [orgId, divisionId, `${TAG}-LHR-DST`, dayAt(DAYS, 9)],
      )
    ).rows[0].id;
  }

  const cityId = await upsertByCode(
    c,
    "pharmacy_cities",
    orgId,
    `${TAG}-LHR`,
    `INSERT INTO pharmacy_cities (organization_id, district_id, code, name, status, created_at)
     VALUES ($1, $2, $3, 'Lahore', 'active', $4) RETURNING id`,
    [orgId, districtId, `${TAG}-LHR`, dayAt(DAYS, 9)],
  );

  let areaId = (
    await c.query(
      `SELECT id FROM pharmacy_areas WHERE organization_id = $1 AND code = $2 LIMIT 1`,
      [orgId, `${TAG}-GUL`],
    )
  ).rows[0]?.id;
  if (!areaId) {
    areaId = (
      await c.query(
        `INSERT INTO pharmacy_areas (organization_id, city_id, code, name, sector, status, created_at)
         VALUES ($1, $2, $3, 'Gulberg', 'Central', 'active', $4) RETURNING id`,
        [orgId, cityId, `${TAG}-GUL`, dayAt(DAYS, 9)],
      )
    ).rows[0].id;
  }

  let geoTerritoryId = (
    await c.query(
      `SELECT id FROM pharmacy_geo_territories WHERE organization_id = $1 AND code = $2 LIMIT 1`,
      [orgId, `${TAG}-T1`],
    )
  ).rows[0]?.id;
  if (!geoTerritoryId) {
    geoTerritoryId = (
      await c.query(
        `INSERT INTO pharmacy_geo_territories (organization_id, area_id, code, name, status, created_at)
         VALUES ($1, $2, $3, 'Gulberg Beat 1', 'active', $4) RETURNING id`,
        [orgId, areaId, `${TAG}-T1`, dayAt(DAYS, 9)],
      )
    ).rows[0].id;
  }

  let routeId = (
    await c.query(
      `SELECT id FROM pharmacy_routes WHERE organization_id = $1 AND code = $2 LIMIT 1`,
      [orgId, `${TAG}-R1`],
    )
  ).rows[0]?.id;
  if (!routeId) {
    routeId = (
      await c.query(
        `INSERT INTO pharmacy_routes
           (organization_id, area_id, code, name, status, branch_id, created_at)
         VALUES ($1, $2, $3, 'Gulberg Route A', 'active', $4, $5) RETURNING id`,
        [orgId, areaId, `${TAG}-R1`, branchId, dayAt(DAYS, 9)],
      )
    ).rows[0].id;
  }

  const vehicleId = await upsertByCode(
    c,
    "pharmacy_vehicles",
    orgId,
    `${TAG}-VH1`,
    `INSERT INTO pharmacy_vehicles
       (organization_id, branch_id, code, registration_no, vehicle_type, status, created_at)
     VALUES ($1, $2, $3, 'LES-SEED-01', 'van', 'available', $4) RETURNING id`,
    [orgId, branchId, `${TAG}-VH1`, dayAt(DAYS, 9)],
  );

  const driverId = await upsertByCode(
    c,
    "pharmacy_drivers",
    orgId,
    `${TAG}-DR1`,
    `INSERT INTO pharmacy_drivers
       (organization_id, branch_id, code, name, phone, status, vehicle_id, created_at)
     VALUES ($1, $2, $3, 'Seed Driver Ali', '03001234567', 'active', $4, $5) RETURNING id`,
    [orgId, branchId, `${TAG}-DR1`, vehicleId, dayAt(DAYS, 9)],
  );

  // medicines
  async function upsertMedicine(sku, name, sell, buy, stock, createdAt) {
    const ex = await c.query(
      `SELECT id FROM pharmacy_medicines
       WHERE organization_id = $1 AND branch_id = $2 AND sku = $3 LIMIT 1`,
      [orgId, branchId, sku],
    );
    if (ex.rows[0]?.id) return ex.rows[0].id;
    const ins = await c.query(
      `INSERT INTO pharmacy_medicines (
         organization_id, branch_id, sku, name, category, company_id,
         selling_price_pkr, wholesale_price_pkr, purchase_price_pkr, cost_price_pkr,
         current_stock, tablets_per_strip, strips_per_box, status, created_at
       ) VALUES ($1,$2,$3,$4,'Tablet',$5,$6,$6,$7,$7,$8,10,10,'active',$9)
       RETURNING id`,
      [orgId, branchId, sku, name, companyId, sell, buy, stock, createdAt],
    );
    const medicineId = ins.rows[0].id;
    await c.query(
      `INSERT INTO pharmacy_medicine_batches (
         medicine_id, warehouse_id, batch_number, expiry_date, quantity,
         purchase_rate_pkr, sale_rate_pkr, status, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8)`,
      [
        medicineId,
        warehouseId,
        `B-${sku}`,
        isoDate(dayAt(-400, 12)),
        stock,
        buy,
        sell,
        createdAt,
      ],
    );
    return medicineId;
  }

  const medA = await upsertMedicine(`${TAG}-MED-A`, "Lamos 500mg Seed", 120, 80, 5000, dayAt(DAYS, 10));
  const medB = await upsertMedicine(`${TAG}-MED-B`, "Flagyl Dist Seed", 80, 45, 4000, dayAt(DAYS, 10));
  const medicines = [medA, medB];
  console.log("masters ready", { companyId, warehouseId, routeId, medA, medB });

  // --- per-day users, employees, customers, O2C, field ---
  const staffPerms = JSON.stringify([
    "pops.read",
    "distribution.orders",
    "distribution.deliveries",
    "distribution.collections",
    "distribution.field",
  ]);

  const counts = {
    users: 0,
    employees: 0,
    customers: 0,
    orders: 0,
    invoices: 0,
    deliveries: 0,
    collections: 0,
    assignments: 0,
    visits: 0,
    returns: 0,
  };

  const employeeIds = [];
  const customerIds = [];

  for (let ago = DAYS - 1; ago >= 0; ago--) {
    const d = dayAt(ago, 11);
    const dateStr = isoDate(d);
    const stamp = ymdCompact(d);
    const dayIdx = DAYS - 1 - ago;

    // new user registration (1–2 / day)
    for (let u = 0; u < (ago % 2 === 0 ? 2 : 1); u++) {
      const email = `dist.${TAG.toLowerCase()}.d${dayIdx}u${u}@pops.demo`.toLowerCase();
      const createdAt = dayAt(ago, 9 + u, 15);
      let userId = (await c.query(`SELECT id FROM users WHERE email = $1`, [email])).rows[0]?.id;
      if (!userId) {
        userId = (
          await c.query(
            `INSERT INTO users (email, name, password_hash, status, created_at)
             VALUES ($1, $2, $3, 'active', $4) RETURNING id`,
            [email, `Dist User D${dayIdx}-${u + 1}`, hash, createdAt],
          )
        ).rows[0].id;
        counts.users += 1;
      } else {
        await c.query(`UPDATE users SET created_at = $1, status = 'active', password_hash = $2 WHERE id = $3`, [
          createdAt,
          hash,
          userId,
        ]);
      }
      const m = await c.query(
        `SELECT user_id FROM organization_memberships WHERE organization_id = $1 AND user_id = $2`,
        [orgId, userId],
      );
      if (!m.rows[0]) {
        await c.query(
          `INSERT INTO organization_memberships
             (organization_id, user_id, role, permissions, branch_scope, pin_required, active, created_at)
           VALUES ($1, $2, 'member', $3::jsonb, $4, false, true, $5)`,
          [orgId, userId, staffPerms, BRANCH_CODE, createdAt],
        );
      } else {
        await c.query(
          `UPDATE organization_memberships SET created_at = $1, active = true
           WHERE organization_id = $2 AND user_id = $3`,
          [createdAt, orgId, userId],
        );
      }
    }

    // employee registration (1 / day)
    const empCode = `EMP-${TAG}-${String(dayIdx + 1).padStart(2, "0")}`;
    const empCreated = dayAt(ago, 10, 20);
    let empId = (
      await c.query(
        `SELECT id FROM pops_employees WHERE organization_id = $1 AND employee_code = $2 LIMIT 1`,
        [orgId, empCode],
      )
    ).rows[0]?.id;
    if (!empId) {
      empId = (
        await c.query(
          `INSERT INTO pops_employees (
             organization_id, branch_id, employee_code, display_name, job_title, department,
             base_salary_pkr, employment_status, join_date, phone, email, created_at
           ) VALUES ($1,$2,$3,$4,$5,'Sales',45000,'active',$6,$7,$8,$9) RETURNING id`,
          [
            orgId,
            branchId,
            empCode,
            `Salesman ${TAG} ${dayIdx + 1}`,
            dayIdx === 0 ? "Sales Manager" : "Sales Officer",
            dateStr,
            `0301${String(1000000 + dayIdx).slice(-7)}`,
            `emp.${TAG.toLowerCase()}.${dayIdx + 1}@pops.demo`.toLowerCase(),
            empCreated,
          ],
        )
      ).rows[0].id;
      counts.employees += 1;
    } else {
      await c.query(
        `UPDATE pops_employees SET created_at = $1, join_date = $2, employment_status = 'active'
         WHERE id = $3`,
        [empCreated, dateStr, empId],
      );
    }
    employeeIds.push(empId);

    // link first employee to route
    if (dayIdx === 0) {
      await c.query(`UPDATE pharmacy_routes SET salesman_employee_id = $1 WHERE id = $2`, [
        empId,
        routeId,
      ]);
    }

    // trade customers (2 / day)
    for (let ci = 0; ci < 2; ci++) {
      const code = `TC-${TAG}-${stamp}-${ci + 1}`;
      const custCreated = dayAt(ago, 11, 10 + ci * 5);
      let tradeId = (
        await c.query(
          `SELECT id FROM pharmacy_trade_customers WHERE organization_id = $1 AND code = $2 LIMIT 1`,
          [orgId, code],
        )
      ).rows[0]?.id;
      if (!tradeId) {
        tradeId = (
          await c.query(
            `INSERT INTO pharmacy_trade_customers (
               organization_id, branch_id, code, name, business_name, customer_type,
               phone, address, city_id, area_id, route_id, salesman_employee_id,
               credit_limit_pkr, credit_days, outstanding_pkr, city_name, reg_date, status, created_at
             ) VALUES (
               $1,$2,$3,$4,$5,'Retailer',$6,$7,$8,$9,$10,$11,
               200000,30,0,'Lahore',$12,'active',$13
             ) RETURNING id`,
            [
              orgId,
              branchId,
              code,
              `Pharmacy ${stamp}-${ci + 1}`,
              `Seed Retail ${stamp}-${ci + 1}`,
              `0423${String(5000000 + dayIdx * 10 + ci).slice(-7)}`,
              `Shop ${ci + 1}, Gulberg, Lahore`,
              cityId,
              areaId,
              routeId,
              empId,
              dateStr,
              custCreated,
            ],
          )
        ).rows[0].id;
        counts.customers += 1;
        const rc = await c.query(
          `SELECT id FROM pharmacy_route_customers
           WHERE organization_id = $1 AND route_id = $2 AND trade_customer_id = $3`,
          [orgId, routeId, tradeId],
        );
        if (!rc.rows[0]) {
          await c.query(
            `INSERT INTO pharmacy_route_customers
               (organization_id, route_id, trade_customer_id, sequence_no)
             VALUES ($1,$2,$3,$4)`,
            [orgId, routeId, tradeId, customerIds.length + 1],
          );
        }
      } else {
        await c.query(
          `UPDATE pharmacy_trade_customers
           SET created_at = $1, reg_date = $2, salesman_employee_id = $3, status = 'active'
           WHERE id = $4`,
          [custCreated, dateStr, empId, tradeId],
        );
      }
      customerIds.push(tradeId);
    }

    const dayCustomers = customerIds.slice(-2);
    const salesmanId = empId;

    // 2 orders + invoices + delivery + collection per day
    for (let oi = 0; oi < 2; oi++) {
      const tradeId = dayCustomers[oi % dayCustomers.length];
      const medId = medicines[oi % medicines.length];
      const qty = 20 + dayIdx * 3 + oi * 5;
      const unit = oi % 2 === 0 ? 120 : 80;
      const lineTotal = qty * unit;
      const discount = oi === 0 ? 200 : 0;
      const total = lineTotal - discount;
      const paid = oi === 0 ? Math.round(total * 0.6) : Math.round(total * 0.4);
      const due = Math.max(0, total - paid);
      const createdAt = dayAt(ago, 12 + oi, 30);
      const orderNumber = `ORD-${TAG}-${stamp}-${oi + 1}`;
      const invoiceNumber = `INV-${TAG}-${stamp}-${oi + 1}`;
      const deliveryNumber = `DEL-${TAG}-${stamp}-${oi + 1}`;
      const collectionNumber = `COL-${TAG}-${stamp}-${oi + 1}`;
      const idemOrder = `${TAG}-ORD-${stamp}-${oi + 1}`;
      const idemDel = `${TAG}-DEL-${stamp}-${oi + 1}`;
      const idemCol = `${TAG}-COL-${stamp}-${oi + 1}`;

      const orderId = (
        await c.query(
          `INSERT INTO pharmacy_dist_orders (
             organization_id, branch_id, warehouse_id, order_number, trade_customer_id,
             salesman_employee_id, status, payment_status, delivery_status,
             subtotal_pkr, discount_pkr, tax_pkr, total_pkr,
             notes, created_by_user_id, booked_at, approved_at, invoiced_at,
             delivered_at, idempotency_key, created_at
           ) VALUES (
             $1,$2,$3,$4,$5,$6,'delivered',$7,'delivered',
             $8,$9,0,$10,$11,$12,$13,$13,$13,$13,$14,$13
           ) RETURNING id`,
          [
            orgId,
            branchId,
            warehouseId,
            orderNumber,
            tradeId,
            salesmanId,
            due > 0 ? "partial" : "paid",
            lineTotal,
            discount,
            total,
            `${TAG} day seed`,
            ownerId,
            createdAt,
            idemOrder,
          ],
        )
      ).rows[0].id;
      counts.orders += 1;

      await c.query(
        `INSERT INTO pharmacy_dist_order_lines
           (order_id, medicine_id, quantity, free_quantity, unit_price_pkr, discount_pkr, line_total_pkr)
         VALUES ($1,$2,$3,0,$4,$5,$6)`,
        [orderId, medId, qty, unit, discount, lineTotal - discount],
      );

      const invoiceId = (
        await c.query(
          `INSERT INTO pharmacy_dist_invoices (
             organization_id, branch_id, order_id, trade_customer_id, invoice_number, invoice_date,
             payment_method, amount_paid_pkr, amount_due_pkr,
             subtotal_pkr, discount_pkr, tax_pkr, total_pkr, status, created_at
           ) VALUES (
             $1,$2,$3,$4,$5,$6,'Credit',$7,$8,$9,$10,0,$11,'posted',$12
           ) RETURNING id`,
          [
            orgId,
            branchId,
            orderId,
            tradeId,
            invoiceNumber,
            dateStr,
            paid,
            due,
            lineTotal,
            discount,
            total,
            createdAt,
          ],
        )
      ).rows[0].id;
      counts.invoices += 1;

      await c.query(
        `INSERT INTO pharmacy_dist_invoice_lines
           (invoice_id, medicine_id, quantity, free_quantity, unit_price_pkr, line_total_pkr)
         VALUES ($1,$2,$3,0,$4,$5)`,
        [invoiceId, medId, qty, unit, lineTotal],
      );

      await c.query(
        `UPDATE pharmacy_trade_customers
         SET outstanding_pkr = GREATEST(0, outstanding_pkr + $1)
         WHERE id = $2`,
        [due, tradeId],
      );

      const deliveryId = (
        await c.query(
          `INSERT INTO pharmacy_deliveries (
             organization_id, branch_id, delivery_number, order_id, invoice_id, trade_customer_id,
             rider_name, driver_id, vehicle_id, warehouse_id, route_id, address,
             status, collected_pkr, idempotency_key, dispatched_at, out_for_delivery_at,
             delivered_at, created_at
           ) VALUES (
             $1,$2,$3,$4,$5,$6,'Seed Rider',$7,$8,$9,$10,'Gulberg Lahore',
             'delivered',$11,$12,$13,$13,$13,$13
           ) RETURNING id`,
          [
            orgId,
            branchId,
            deliveryNumber,
            orderId,
            invoiceId,
            tradeId,
            driverId,
            vehicleId,
            warehouseId,
            routeId,
            paid,
            idemDel,
            createdAt,
          ],
        )
      ).rows[0].id;
      counts.deliveries += 1;

      await c.query(
        `INSERT INTO pharmacy_delivery_lines
           (delivery_id, medicine_id, product_label, quantity, delivered_qty, returned_qty)
         VALUES ($1,$2,$3,$4,$4,0)`,
        [deliveryId, medId, oi % 2 === 0 ? "Lamos 500mg Seed" : "Flagyl Dist Seed", qty],
      );

      if (paid > 0) {
        const collectionId = (
          await c.query(
            `INSERT INTO pharmacy_collections (
               organization_id, branch_id, collection_number, trade_customer_id, invoice_id,
               amount_pkr, payment_method, unallocated_pkr, salesman_employee_id,
               notes, idempotency_key, created_by_user_id, created_at
             ) VALUES (
               $1,$2,$3,$4,$5,$6,'Cash',0,$7,$8,$9,$10,$11
             ) RETURNING id`,
            [
              orgId,
              branchId,
              collectionNumber,
              tradeId,
              invoiceId,
              paid,
              salesmanId,
              `${TAG} recovery`,
              idemCol,
              ownerId,
              dayAt(ago, 16 + oi, 10),
            ],
          )
        ).rows[0].id;
        counts.collections += 1;
        await c.query(
          `INSERT INTO pharmacy_collection_allocations (collection_id, invoice_id, amount_pkr, created_at)
           VALUES ($1,$2,$3,$4)`,
          [collectionId, invoiceId, paid, dayAt(ago, 16 + oi, 12)],
        );
      }

      // one return every other day on first order
      if (oi === 0 && ago % 2 === 0) {
        const retQty = 2;
        const retTotal = retQty * unit;
        const returnNumber = `WRN-${TAG}-${stamp}-1`;
        const returnId = (
          await c.query(
            `INSERT INTO pharmacy_wholesale_returns (
               organization_id, branch_id, return_number, invoice_id, trade_customer_id,
               warehouse_id, reason, total_pkr, status, created_by_user_id, created_at
             ) VALUES ($1,$2,$3,$4,$5,$6,'Damaged / near expiry seed',$7,'posted',$8,$9)
             RETURNING id`,
            [
              orgId,
              branchId,
              returnNumber,
              invoiceId,
              tradeId,
              warehouseId,
              retTotal,
              ownerId,
              dayAt(ago, 17, 0),
            ],
          )
        ).rows[0].id;
        await c.query(
          `INSERT INTO pharmacy_wholesale_return_lines
             (return_id, medicine_id, quantity, unit_price_pkr, line_total_pkr)
           VALUES ($1,$2,$3,$4,$5)`,
          [returnId, medId, retQty, unit, retTotal],
        );
        counts.returns += 1;
      }
    }

    // field assignment + visit
    const assignTrade = dayCustomers[0];
    const assignmentId = (
      await c.query(
        `INSERT INTO pharmacy_assignments (
           organization_id, branch_id, assignment_date, employee_id, city_id, area_id, route_id,
           trade_customer_id, task_type, target_sales_pkr, target_collection_pkr, status, notes, created_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,'visit',50000,20000,'completed',$9,$10
         ) RETURNING id`,
        [
          orgId,
          branchId,
          dateStr,
          salesmanId,
          cityId,
          areaId,
          routeId,
          assignTrade,
          `${TAG} PJP`,
          dayAt(ago, 8, 30),
        ],
      )
    ).rows[0].id;
    counts.assignments += 1;

    await c.query(
      `INSERT INTO pharmacy_visits (
         organization_id, assignment_id, employee_id, trade_customer_id, visited_at, purpose,
         status, productive, notes, visit_number, planned_date, completed_at, outcome,
         route_id, branch_id, created_by_user_id, created_at
       ) VALUES (
         $1,$2,$3,$4,$5,'Order booking','completed',true,$6,$7,$8,$5,'order_booked',
         $9,$10,$11,$5
       )`,
      [
        orgId,
        assignmentId,
        salesmanId,
        assignTrade,
        dayAt(ago, 14, 45),
        `${TAG} field visit`,
        `VIS-${TAG}-${stamp}-1`,
        dateStr,
        routeId,
        branchId,
        ownerId,
      ],
    );
    counts.visits += 1;

    // promise-to-pay on odd days
    if (ago % 2 === 1 && dayCustomers[1]) {
      await c.query(
        `INSERT INTO pharmacy_promises_to_pay (
           organization_id, branch_id, promise_number, trade_customer_id,
           promised_amount_pkr, promise_date, status, notes, created_by_user_id, created_at
         ) VALUES ($1,$2,$3,$4,15000,$5,'open',$6,$7,$8)`,
        [
          orgId,
          branchId,
          `PTP-${TAG}-${stamp}-1`,
          dayCustomers[1],
          isoDate(dayAt(Math.max(0, ago - 2), 12)),
          `${TAG} recovery promise`,
          ownerId,
          dayAt(ago, 15, 0),
        ],
      );
    }

    console.log(`day ${dateStr}: users/employees/customers + O2C + field`);
  }

  // summary counts from DB for Last 7 window
  const from = dayAt(DAYS - 1, 0);
  const summary = await c.query(
    `SELECT
       (SELECT count(*)::int FROM users u
          JOIN organization_memberships m ON m.user_id = u.id
         WHERE m.organization_id = $1 AND u.created_at >= $2 AND u.email LIKE $3) AS new_users,
       (SELECT count(*)::int FROM pops_employees
         WHERE organization_id = $1 AND created_at >= $2 AND employee_code LIKE $4) AS new_employees,
       (SELECT count(*)::int FROM pharmacy_trade_customers
         WHERE organization_id = $1 AND created_at >= $2 AND code LIKE $5) AS new_customers,
       (SELECT count(*)::int FROM pharmacy_dist_orders
         WHERE organization_id = $1 AND created_at >= $2 AND order_number LIKE $6) AS orders,
       (SELECT count(*)::int FROM pharmacy_dist_invoices
         WHERE organization_id = $1 AND created_at >= $2 AND invoice_number LIKE $7) AS invoices,
       (SELECT count(*)::int FROM pharmacy_collections
         WHERE organization_id = $1 AND created_at >= $2 AND collection_number LIKE $8) AS collections,
       (SELECT count(*)::int FROM pharmacy_deliveries
         WHERE organization_id = $1 AND created_at >= $2 AND delivery_number LIKE $9) AS deliveries,
       (SELECT coalesce(sum(total_pkr),0)::int FROM pharmacy_dist_invoices
         WHERE organization_id = $1 AND created_at >= $2 AND invoice_number LIKE $7) AS invoice_total
    `,
    [
      orgId,
      from,
      `%${TAG.toLowerCase()}%`,
      `EMP-${TAG}-%`,
      `TC-${TAG}-%`,
      `ORD-${TAG}-%`,
      `INV-${TAG}-%`,
      `COL-${TAG}-%`,
      `DEL-${TAG}-%`,
    ],
  );

  await c.end();

  console.log("\n=== DONE ===");
  console.log("login:", OWNER_EMAIL, "/", password);
  console.log("branch:", BRANCH_CODE);
  console.log("inserted/updated this run:", counts);
  console.log(`last-${DAYS}-days DB snapshot:`, summary.rows[0]);
  console.log(`Open Distribution PS Window → filter Last ${DAYS === 7 ? "7" : DAYS}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
