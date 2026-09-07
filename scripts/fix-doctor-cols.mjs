import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const dbUrl = env.match(/^DATABASE_URL=(.+)$/m)[1].trim();
const client = new pg.Client({ connectionString: dbUrl });
await client.connect();
const stmts = [
  `ALTER TABLE pharmacy_doctors ADD COLUMN IF NOT EXISTS registration_number text`,
  `ALTER TABLE pharmacy_doctors ADD COLUMN IF NOT EXISTS code text`,
  `ALTER TABLE pharmacy_patients ADD COLUMN IF NOT EXISTS code text`,
];
for (const s of stmts) {
  await client.query(s);
  console.log("OK", s);
}
const cols = await client.query(
  `SELECT column_name FROM information_schema.columns WHERE table_name='pharmacy_doctors' ORDER BY 1`,
);
console.log(cols.rows.map((r) => r.column_name).join(", "));
await client.end();
