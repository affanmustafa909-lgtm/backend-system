/**
 * Seed EducationFlow document templates into the live DB (idempotent).
 * Usage: node scripts/seed-education-document-templates.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

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

const enginePath = join(root, "api/src/education/education-document-engine.ts");
const src = readFileSync(enginePath, "utf8");
const cssStart = src.indexOf("const LETTER_CSS");
const tplEnd = src.indexOf("\n/** Replace {{token}}");
if (cssStart < 0 || tplEnd < 0) throw new Error("Could not parse education-document-engine.ts");
let slice = src.slice(cssStart, tplEnd);
slice = slice
  .replace(/: DefaultDocumentTemplate\[\]/g, "")
  .replace(/function wrap\(title: string, inner: string\): string/g, "function wrap(title, inner)")
  .replace(/export const DEFAULT_EDUCATION_DOCUMENT_TEMPLATES/, "const DEFAULT_EDUCATION_DOCUMENT_TEMPLATES");
const fn = new Function(`${slice}\nreturn DEFAULT_EDUCATION_DOCUMENT_TEMPLATES;`);
const DEFAULT_EDUCATION_DOCUMENT_TEMPLATES = fn();

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const org = await client.query(
  `SELECT id FROM organizations WHERE system_type = 'education' ORDER BY created_at ASC LIMIT 1`,
);
if (!org.rows[0]) throw new Error("Education org not found");
const orgId = org.rows[0].id;
const branch = await client.query(
  `SELECT id FROM pops_branches WHERE organization_id = $1 AND code = 'MAIN' LIMIT 1`,
  [orgId],
);
const branchId = branch.rows[0]?.id ?? null;

let created = 0;
let updated = 0;
for (const tpl of DEFAULT_EDUCATION_DOCUMENT_TEMPLATES) {
  const exists = await client.query(
    `SELECT id FROM education_document_templates
     WHERE organization_id = $1 AND document_type_code = $2
       AND (($3::uuid IS NULL AND branch_id IS NULL) OR branch_id = $3)
     LIMIT 1`,
    [orgId, tpl.documentTypeCode, branchId],
  );
  if (exists.rows[0]) {
    await client.query(
      `UPDATE education_document_templates SET body_html = $2, name = $3, status = 'active', updated_at = now()
       WHERE id = $1`,
      [exists.rows[0].id, tpl.bodyHtml, tpl.name],
    );
    updated += 1;
    console.log("~", tpl.documentTypeCode);
    continue;
  }
  await client.query(
    `INSERT INTO education_document_templates
      (organization_id, branch_id, name, document_type_code, body_html, status)
     VALUES ($1, $2, $3, $4, $5, 'active')`,
    [orgId, branchId, tpl.name, tpl.documentTypeCode, tpl.bodyHtml],
  );
  created += 1;
  console.log("+", tpl.documentTypeCode);
}
console.log(`Done. Created ${created}, updated ${updated}, total ${DEFAULT_EDUCATION_DOCUMENT_TEMPLATES.length}`);
await client.end();
