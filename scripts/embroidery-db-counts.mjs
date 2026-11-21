import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const requireFromDb = createRequire(join(__dirname, "..", "packages", "database-pg", "package.json"));
const { Client } = requireFromDb("pg");

const envPath = join(__dirname, "..", ".env");
const envRaw = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const url = (process.env.DATABASE_URL || (envRaw.match(/^DATABASE_URL=(.+)$/m)?.[1] ?? ""))
  .trim()
  .replace(/^["']|["']$/g, "");
if (!url) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const ORG = "55426b61-2eea-43e9-bf63-6776978eb10a";
const tables = [
  "factory_parties",
  "factory_operators",
  "factory_items",
  "embroidery_designs",
  "embroidery_machines",
  "embroidery_jobs",
  "factory_purchase_orders",
  "factory_expenses",
  "factory_stitch_rates",
  "factory_broker_masters",
  "factory_attendance",
  "factory_salary_slips",
  "factory_thread_consumption",
];

const client = new Client({
  connectionString: url,
  ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
});
await client.connect();
for (const t of tables) {
  const r = await client.query(`select count(*)::int as n from ${t} where organization_id=$1`, [ORG]);
  console.log(`${t}: ${r.rows[0].n}`);
}
await client.end();
