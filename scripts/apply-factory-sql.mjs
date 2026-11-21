import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const requireFromDb = createRequire(join(__dirname, "..", "packages", "database-pg", "package.json"));
const { Client } = requireFromDb("pg");

const envPath = join(__dirname, "..", ".env");
const envRaw = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const url = (envRaw.match(/^DATABASE_URL=(.+)$/m)?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
if (!url) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const sqlPath = join(__dirname, "..", "packages", "database-pg", "sql", "ensure_factory_tables.sql");
const sql = readFileSync(sqlPath, "utf8");

const client = new Client({
  connectionString: url,
  ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
});
await client.connect();
await client.query(sql);
const r = await client.query("select to_regclass('public.factory_parties') as t");
console.log("OK factory_parties =", r.rows[0]?.t);
await client.end();
