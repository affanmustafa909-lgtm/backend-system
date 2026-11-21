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

const sqlDir = join(__dirname, "..", "packages", "database-pg", "sql");
const files = [
  "ensure_factory_tables.sql",
  "ensure_factory_depth.sql",
  "ensure_factory_extra_modules.sql",
];

const client = new Client({
  connectionString: url,
  ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
});
await client.connect();
for (const file of files) {
  const sqlPath = join(sqlDir, file);
  if (!existsSync(sqlPath)) {
    console.warn("Missing", file);
    continue;
  }
  await client.query(readFileSync(sqlPath, "utf8"));
  console.log("Applied", file);
}
const r = await client.query("select to_regclass('public.factory_printer_profiles') as t");
console.log("OK factory_printer_profiles =", r.rows[0]?.t);
await client.end();
