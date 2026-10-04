/**
 * Seed / reset Pharmacy demo login.
 * Run from packages/database-pg:
 *   node scripts/seed-pharmacy-demo.mjs
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFromApi = createRequire(path.join(__dirname, "..", "..", "..", "api", "package.json"));
const bcrypt = requireFromApi("bcryptjs");

const envPath = path.join(__dirname, "..", "..", "..", ".env");
const env = fs.readFileSync(envPath, "utf8");
const dbUrl = (env.match(/^DATABASE_URL=(.+)$/m) || [])[1]?.trim();
if (!dbUrl) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}
const password = (env.match(/^SEED_USER_PASSWORD=(.+)$/m)?.[1] ?? "Owner@12345")
  .trim()
  .replace(/^["']|["']$/g, "");

const PHARMACY_PERMS = [
  "pops.read",
  "pops.users.manage",
  "pops.inventory.manage",
  "pharmacy.view",
  "pharmacy.pos",
  "pharmacy.sale.create",
  "pharmacy.sale.return",
  "pharmacy.purchase.view",
  "pharmacy.purchase.manage",
  "pharmacy.inventory.view",
  "pharmacy.inventory.manage",
  "pharmacy.batch.manage",
  "pharmacy.prescription.view",
  "pharmacy.prescription.manage",
  "pharmacy.controlled.approve",
  "pharmacy.khata.view",
  "pharmacy.khata.manage",
  "pharmacy.report.view",
];

console.log("Connecting…");
const c = new pg.Client({
  connectionString: dbUrl,
  ssl: dbUrl.includes("localhost") ? undefined : { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
});
await c.connect();
console.log("Connected");

let orgId = (
  await c.query(`SELECT id FROM organizations WHERE licence_key = 'LIC-DEMO-PHARMACY' LIMIT 1`)
).rows[0]?.id;

if (!orgId) {
  const ins = await c.query(
    `INSERT INTO organizations (name, system_type, status, licence_plan, licence_key)
     VALUES ('POPS Demo Pharmacy', 'pharmacy', 'active', 'demo', 'LIC-DEMO-PHARMACY')
     RETURNING id`,
  );
  orgId = ins.rows[0].id;
  console.log("created org", orgId);
} else {
  await c.query(
    `UPDATE organizations
     SET name = 'POPS Demo Pharmacy', status = 'active', licence_plan = 'demo', updated_at = now()
     WHERE id = $1 AND COALESCE(status, '') <> 'deleted'`,
    [orgId],
  );
  console.log("org exists", orgId);
}

const email = "admin.pharmacy@pops.demo";
let userId = (await c.query(`SELECT id FROM users WHERE email = $1`, [email])).rows[0]?.id;
const hash = await bcrypt.hash(password, 12);
if (!userId) {
  const ins = await c.query(
    `INSERT INTO users (email, name, password_hash, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
    [email, "Pharmacy Owner", hash],
  );
  userId = ins.rows[0].id;
  console.log("created user", userId);
} else {
  await c.query(`UPDATE users SET password_hash = $1, name = $2, status = 'active' WHERE id = $3`, [
    hash,
    "Pharmacy Owner",
    userId,
  ]);
  console.log("updated user password", userId);
}

const mem = await c.query(
  `SELECT user_id FROM organization_memberships WHERE organization_id = $1 AND user_id = $2`,
  [orgId, userId],
);
if (!mem.rows[0]) {
  await c.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, permissions, branch_scope, pin_required, active)
     VALUES ($1, $2, 'owner', $3::jsonb, 'all', false, true)`,
    [orgId, userId, JSON.stringify(PHARMACY_PERMS)],
  );
  console.log("created membership");
} else {
  await c.query(
    `UPDATE organization_memberships
     SET role = 'owner', permissions = $3::jsonb, branch_scope = 'all', pin_required = false, active = true
     WHERE organization_id = $1 AND user_id = $2`,
    [orgId, userId, JSON.stringify(PHARMACY_PERMS)],
  );
  console.log("updated membership");
}

const branch = await c.query(
  `SELECT id FROM pops_branches WHERE organization_id = $1 AND code = 'PHAR-HQ'`,
  [orgId],
);
if (!branch.rows[0]) {
  await c.query(
    `INSERT INTO pops_branches (organization_id, code, name, city, is_hq)
     VALUES ($1, 'PHAR-HQ', 'Pharmacy HQ', 'Lahore', true)`,
    [orgId],
  );
  console.log("created branch PHAR-HQ");
} else {
  console.log("branch PHAR-HQ exists");
}

await c.end();
console.log("\nDONE — Pharmacy login:");
console.log(`  email:    ${email}`);
console.log(`  password: ${password}`);
console.log(`  branch:   PHAR-HQ`);
