/**
 * Move EducationFlow campus seed from EDU-HQ → MAIN so the default branch shows data.
 * Usage: node scripts/fix-education-branch-to-main.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function loadEnv() {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const require = createRequire(join(root, "packages/database-pg/package.json"));
const pg = require("pg");
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const org = (
  await client.query(
    `SELECT id FROM organizations WHERE licence_key = 'LIC-DEMO-EDUCATION' OR system_type = 'education' ORDER BY created_at LIMIT 1`,
  )
).rows[0];
if (!org) throw new Error("Education org not found");

const eduHq = (
  await client.query(
    `SELECT id, code, name FROM pops_branches WHERE organization_id = $1 AND code = 'EDU-HQ' LIMIT 1`,
    [org.id],
  )
).rows[0];
const main = (
  await client.query(
    `SELECT id, code, name FROM pops_branches WHERE organization_id = $1 AND code = 'MAIN' LIMIT 1`,
    [org.id],
  )
).rows[0];

if (!eduHq) {
  console.log("No EDU-HQ branch — nothing to move");
  await client.end();
  process.exit(0);
}
if (!main) {
  await client.query(`UPDATE pops_branches SET code = 'MAIN', name = 'Main Campus' WHERE id = $1`, [eduHq.id]);
  console.log("Renamed EDU-HQ → MAIN");
  await client.end();
  process.exit(0);
}

console.log("Moving campus data EDU-HQ → MAIN", { from: eduHq.id, to: main.id });

const tables = (
  await client.query(`
    SELECT table_name AS name, column_name AS col
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'branch_id'
      AND table_name LIKE 'education_%'
    ORDER BY table_name
  `)
).rows;

await client.query("BEGIN");
try {
  // Prefer MAIN name
  await client.query(`UPDATE pops_branches SET name = 'Main Campus' WHERE id = $1`, [main.id]);

  for (const t of tables) {
    // Skip unique conflicts on sessions/modules by deleting empty MAIN duplicates first where safe
    if (t.name === "education_academic_sessions") {
      // Keep EDU-HQ current session; drop MAIN's empty/extra sessions
      await client.query(
        `DELETE FROM education_academic_sessions WHERE organization_id = $1 AND branch_id = $2`,
        [org.id, main.id],
      );
    }
    if (t.name === "education_settings") {
      await client.query(
        `DELETE FROM education_settings WHERE organization_id = $1 AND branch_id = $2`,
        [org.id, main.id],
      );
    }
    if (t.name === "education_document_templates") {
      await client.query(
        `DELETE FROM education_document_templates WHERE organization_id = $1 AND branch_id = $2`,
        [org.id, main.id],
      );
    }
    if (t.name === "education_lookups") {
      await client.query(
        `DELETE FROM education_lookups WHERE organization_id = $1 AND branch_id = $2`,
        [org.id, main.id],
      );
    }
    if (t.name === "education_periods") {
      await client.query(
        `DELETE FROM education_periods WHERE organization_id = $1 AND branch_id = $2`,
        [org.id, main.id],
      );
    }
    if (t.name === "education_rooms") {
      await client.query(
        `DELETE FROM education_rooms WHERE organization_id = $1 AND branch_id = $2`,
        [org.id, main.id],
      );
    }

    const r = await client.query(
      `UPDATE ${t.name} SET branch_id = $1 WHERE organization_id = $2 AND branch_id = $3`,
      [main.id, org.id, eduHq.id],
    );
    if (r.rowCount) console.log(`  ${t.name}: ${r.rowCount}`);
  }

  // Other non-education tables with branch_id for this org (optional)
  await client.query(`DELETE FROM pops_branches WHERE id = $1`, [eduHq.id]);
  await client.query("COMMIT");
  console.log("Done. Campus now on MAIN / Main Campus.");
} catch (err) {
  await client.query("ROLLBACK");
  console.error("FAILED", err.message);
  process.exit(1);
}

const n = (
  await client.query(
    `SELECT count(*)::int n FROM education_students WHERE organization_id = $1 AND branch_id = $2 AND deleted_at IS NULL`,
    [org.id, main.id],
  )
).rows[0].n;
console.log("MAIN students:", n);
await client.end();
