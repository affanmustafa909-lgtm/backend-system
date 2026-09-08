/**
 * Phase 1 Distribution ERP geo + order stage columns.
 * Usage: node scripts/dist-erp-phase1-schema.mjs
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
  `CREATE TABLE IF NOT EXISTS pharmacy_provinces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code text NOT NULL,
    name text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_divisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    province_id uuid NOT NULL REFERENCES pharmacy_provinces(id) ON DELETE CASCADE,
    code text NOT NULL,
    name text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_districts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    division_id uuid NOT NULL REFERENCES pharmacy_divisions(id) ON DELETE CASCADE,
    code text NOT NULL,
    name text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE pharmacy_cities ADD COLUMN IF NOT EXISTS district_id uuid REFERENCES pharmacy_districts(id) ON DELETE SET NULL`,
  `CREATE TABLE IF NOT EXISTS pharmacy_geo_territories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    area_id uuid NOT NULL REFERENCES pharmacy_areas(id) ON DELETE CASCADE,
    code text NOT NULL,
    name text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    manager_employee_id uuid REFERENCES pops_employees(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE pharmacy_routes ADD COLUMN IF NOT EXISTS geo_territory_id uuid REFERENCES pharmacy_geo_territories(id) ON DELETE SET NULL`,
  `ALTER TABLE pharmacy_dist_orders ADD COLUMN IF NOT EXISTS booked_at timestamptz`,
  `ALTER TABLE pharmacy_dist_orders ADD COLUMN IF NOT EXISTS stock_reserved_at timestamptz`,
  `ALTER TABLE pharmacy_dist_orders ADD COLUMN IF NOT EXISTS invoiced_at timestamptz`,
  `ALTER TABLE pharmacy_dist_orders ADD COLUMN IF NOT EXISTS picking_at timestamptz`,
  `ALTER TABLE pharmacy_dist_orders ADD COLUMN IF NOT EXISTS packed_at timestamptz`,
  `ALTER TABLE pharmacy_dist_orders ADD COLUMN IF NOT EXISTS ready_at timestamptz`,
  `ALTER TABLE pharmacy_dist_orders ADD COLUMN IF NOT EXISTS dispatched_at timestamptz`,
  `ALTER TABLE pharmacy_dist_orders ADD COLUMN IF NOT EXISTS delivered_at timestamptz`,
  `ALTER TABLE pharmacy_dist_orders ADD COLUMN IF NOT EXISTS cancelled_at timestamptz`,
];

const client = new pg.Client({
  connectionString: dbUrl,
  ssl: dbUrl.includes("railway") ? { rejectUnauthorized: false } : undefined,
});
await client.connect();
try {
  for (const sql of stmts) {
    process.stdout.write(`→ ${sql.slice(0, 72).replace(/\s+/g, " ")}… `);
    await client.query(sql);
    console.log("ok");
  }
  console.log("dist ERP phase-1 schema ready");
} finally {
  await client.end();
}
