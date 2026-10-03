import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = readFileSync(join(root, ".env"), "utf8");
const url = env.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))?.slice(13).trim();
const require = createRequire(join(root, "packages/database-pg/package.json"));
const pg = require("pg");
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const org = await c.query(
  `SELECT id, name, system_type, licence_key FROM organizations WHERE system_type = 'education' ORDER BY created_at`,
);
console.log("orgs", org.rows);
if (org.rows[0]) {
  const id = org.rows[0].id;
  for (const t of [
    "education_students",
    "education_teachers",
    "education_classes",
    "education_sections",
    "education_admissions",
    "education_fee_invoices",
    "education_fee_payments",
    "education_attendance",
    "education_exams",
    "education_staff",
    "education_academic_sessions",
    "education_guardians",
    "education_marks",
  ]) {
    const r = await c.query(`SELECT count(*)::int n FROM ${t} WHERE organization_id = $1`, [id]);
    console.log(t, r.rows[0].n);
  }
  const b = await c.query(`SELECT id, code, name FROM pops_branches WHERE organization_id = $1`, [id]);
  console.log("branches", b.rows);
}
await c.end();
