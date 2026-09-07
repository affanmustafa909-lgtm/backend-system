/**
 * Apply Wave-2 pharmacy schema (doctor CRM, PJP, wholesale returns) to Postgres.
 * Usage: node scripts/pharmacy-schema-wave2.mjs
 */
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
const envRaw = fs.readFileSync(envPath, "utf8");
const dbUrl = (envRaw.match(/^DATABASE_URL=(.+)$/m) || [])[1]?.trim();
if (!dbUrl) {
  console.error("DATABASE_URL missing in backend-system/.env");
  process.exit(1);
}

const stmts = [
  `ALTER TABLE pharmacy_patients ADD COLUMN IF NOT EXISTS code text`,
  `ALTER TABLE pharmacy_doctors ADD COLUMN IF NOT EXISTS code text`,
  `ALTER TABLE pharmacy_routes ADD COLUMN IF NOT EXISTS sequence_no integer NOT NULL DEFAULT 0`,
  `ALTER TABLE pharmacy_routes ADD COLUMN IF NOT EXISTS pjp_day_of_week integer`,
  `ALTER TABLE pharmacy_visits ADD COLUMN IF NOT EXISTS is_outstation boolean NOT NULL DEFAULT false`,
  `ALTER TABLE pharmacy_price_lists ADD COLUMN IF NOT EXISTS code text`,
  `ALTER TABLE pharmacy_schemes ADD COLUMN IF NOT EXISTS code text`,
  `CREATE TABLE IF NOT EXISTS pharmacy_doctor_recommendations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    doctor_id uuid NOT NULL,
    medicine_id uuid NOT NULL,
    priority integer NOT NULL DEFAULT 1,
    notes text,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_doctor_commission_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    doctor_id uuid NOT NULL,
    medicine_id uuid,
    company_id uuid,
    rule_type text NOT NULL DEFAULT 'percent',
    rate_value integer NOT NULL DEFAULT 0,
    active boolean NOT NULL DEFAULT true,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_doctor_commission_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    doctor_id uuid NOT NULL,
    sale_id uuid NOT NULL,
    sale_line_id uuid,
    medicine_id uuid,
    base_pkr integer NOT NULL DEFAULT 0,
    rate_value integer NOT NULL DEFAULT 0,
    rule_type text NOT NULL DEFAULT 'percent',
    amount_pkr integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'accrued',
    notes text,
    paid_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_wholesale_returns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    return_number text NOT NULL,
    invoice_id uuid,
    trade_customer_id uuid NOT NULL,
    warehouse_id uuid,
    reason text,
    total_pkr integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'posted',
    created_by_user_id uuid,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_wholesale_return_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id uuid NOT NULL,
    medicine_id uuid NOT NULL,
    batch_id uuid,
    quantity integer NOT NULL,
    unit_price_pkr integer NOT NULL DEFAULT 0,
    line_total_pkr integer NOT NULL DEFAULT 0
  )`,
];

const client = new pg.Client({ connectionString: dbUrl });
await client.connect();
let ok = 0;
let fail = 0;
for (const sql of stmts) {
  try {
    await client.query(sql);
    console.log("OK:", sql.slice(0, 72).replace(/\s+/g, " "));
    ok++;
  } catch (e) {
    console.error("FAIL:", e.message, "|", sql.slice(0, 60));
    fail++;
  }
}
const tables = await client.query(
  `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'pharmacy%' ORDER BY 1`,
);
console.log(`\nDone. ok=${ok} fail=${fail}`);
console.log("pharmacy tables:", tables.rows.length);
console.log(tables.rows.map((r) => r.tablename).join("\n"));
await client.end();
process.exit(fail ? 1 : 0);
