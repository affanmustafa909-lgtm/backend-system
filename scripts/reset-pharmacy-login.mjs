/** Reset pharmacy password via running API DB config — uses pg from database-pg. */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireDb = createRequire(path.join(__dirname, "..", "packages", "database-pg", "package.json"));
const requireApi = createRequire(path.join(__dirname, "..", "api", "package.json"));
const pg = requireDb("pg");
const bcrypt = requireApi("bcryptjs");

const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const dbUrl = (env.match(/^DATABASE_URL=(.+)$/m) || [])[1]?.trim();
const password = (env.match(/^SEED_USER_PASSWORD=(.+)$/m)?.[1] ?? "Owner@12345")
  .trim()
  .replace(/^["']|["']$/g, "");
const email = "admin.pharmacy@pops.demo";

const perms = [
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

console.log("Connecting to DB…");
const c = new pg.Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 45000,
  query_timeout: 45000,
});
await c.connect();
console.log("OK");

let orgId = (await c.query(`SELECT id FROM organizations WHERE licence_key='LIC-DEMO-PHARMACY' LIMIT 1`))
  .rows[0]?.id;
if (!orgId) {
  orgId = (
    await c.query(
      `INSERT INTO organizations (name, system_type, status, licence_plan, licence_key)
       VALUES ('POPS Demo Pharmacy','pharmacy','active','demo','LIC-DEMO-PHARMACY') RETURNING id`,
    )
  ).rows[0].id;
  console.log("org created");
} else {
  await c.query(
    `UPDATE organizations SET status='active', name='POPS Demo Pharmacy', licence_plan='demo' WHERE id=$1`,
    [orgId],
  );
  console.log("org ok", orgId);
}

const hash = await bcrypt.hash(password, 12);
let userId = (await c.query(`SELECT id FROM users WHERE email=$1`, [email])).rows[0]?.id;
if (!userId) {
  userId = (
    await c.query(
      `INSERT INTO users (email, name, password_hash, status) VALUES ($1,$2,$3,'active') RETURNING id`,
      [email, "Pharmacy Owner", hash],
    )
  ).rows[0].id;
  console.log("user created");
} else {
  await c.query(`UPDATE users SET password_hash=$1, name='Pharmacy Owner', status='active' WHERE id=$2`, [
    hash,
    userId,
  ]);
  console.log("user password reset");
}

const mem = await c.query(
  `SELECT 1 FROM organization_memberships WHERE organization_id=$1 AND user_id=$2`,
  [orgId, userId],
);
if (!mem.rows[0]) {
  await c.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, permissions, branch_scope, pin_required, active)
     VALUES ($1,$2,'owner',$3::jsonb,'all',false,true)`,
    [orgId, userId, JSON.stringify(perms)],
  );
  console.log("membership created");
} else {
  await c.query(
    `UPDATE organization_memberships SET role='owner', permissions=$3::jsonb, active=true, branch_scope='all'
     WHERE organization_id=$1 AND user_id=$2`,
    [orgId, userId, JSON.stringify(perms)],
  );
  console.log("membership updated");
}

const br = await c.query(`SELECT 1 FROM pops_branches WHERE organization_id=$1 AND code='PHAR-HQ'`, [orgId]);
if (!br.rows[0]) {
  await c.query(
    `INSERT INTO pops_branches (organization_id, code, name, city, is_hq) VALUES ($1,'PHAR-HQ','Pharmacy HQ','Lahore',true)`,
    [orgId],
  );
  console.log("branch created");
}

await c.end();
console.log(`\nPharmacy login ready:\n  ${email}\n  ${password}\n  branch PHAR-HQ`);
