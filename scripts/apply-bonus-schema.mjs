/**
 * Apply bonus / scheme schema columns required by Dist bonus reports.
 * Usage: node scripts/apply-bonus-schema.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
const envRaw = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
const getEnv = (k, fallback = "") => {
  const m = envRaw.match(new RegExp(`^${k}=(.+)$`, "m"));
  return (m?.[1] ?? process.env[k] ?? fallback).trim().replace(/^["']|["']$/g, "");
};

const DATABASE_URL = getEnv("DATABASE_URL");
if (!DATABASE_URL) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const sqls = [
  `ALTER TABLE pharmacy_schemes ADD COLUMN IF NOT EXISTS code text`,
  `ALTER TABLE pharmacy_schemes ADD COLUMN IF NOT EXISTS trade_customer_id uuid REFERENCES pharmacy_trade_customers(id) ON DELETE CASCADE`,
  `CREATE INDEX IF NOT EXISTS pharmacy_schemes_trade_customer_idx ON pharmacy_schemes (organization_id, trade_customer_id)`,
  `ALTER TABLE pharmacy_schemes ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0`,
  `ALTER TABLE pharmacy_dist_orders ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES pharmacy_warehouses(id) ON DELETE SET NULL`,
  `ALTER TABLE pharmacy_dist_order_lines ADD COLUMN IF NOT EXISTS free_quantity integer NOT NULL DEFAULT 0`,
  `ALTER TABLE pharmacy_dist_order_lines ADD COLUMN IF NOT EXISTS unit_price_pkr integer NOT NULL DEFAULT 0`,
  `ALTER TABLE pharmacy_trade_customers ADD COLUMN IF NOT EXISTS bonus_policy_json text`,
];

const client = new pg.Client({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("localhost") ? undefined : { rejectUnauthorized: false },
});

await client.connect();
for (const s of sqls) {
  try {
    await client.query(s);
    console.log("OK", s.slice(0, 90));
  } catch (e) {
    console.log("FAIL", s.slice(0, 70), "—", e.message);
  }
}
const cols = await client.query(
  `select column_name from information_schema.columns where table_name='pharmacy_schemes' order by ordinal_position`,
);
console.log("pharmacy_schemes columns:", cols.rows.map((r) => r.column_name).join(", "));
await client.end();
console.log("Done.");
