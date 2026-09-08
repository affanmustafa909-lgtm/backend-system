/**
 * Add pharmacy POS sale context columns (channel / area / route / employee).
 * Usage: node scripts/pharmacy-sale-context-schema.mjs
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
  `ALTER TABLE pharmacy_sales ADD COLUMN IF NOT EXISTS sale_channel text`,
  `ALTER TABLE pharmacy_sales ADD COLUMN IF NOT EXISTS area_id uuid`,
  `ALTER TABLE pharmacy_sales ADD COLUMN IF NOT EXISTS route_id uuid`,
  `ALTER TABLE pharmacy_sales ADD COLUMN IF NOT EXISTS employee_id uuid`,
  `ALTER TABLE pharmacy_sales ADD COLUMN IF NOT EXISTS station_label text`,
];

const client = new pg.Client({ connectionString: dbUrl, ssl: dbUrl.includes("railway") ? { rejectUnauthorized: false } : undefined });
await client.connect();
try {
  for (const sql of stmts) {
    process.stdout.write(`→ ${sql.slice(0, 80)}… `);
    await client.query(sql);
    console.log("ok");
  }
  console.log("pharmacy sale context columns ready");
} finally {
  await client.end();
}
