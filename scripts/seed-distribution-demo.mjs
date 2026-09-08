import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const dbUrl = (env.match(/^DATABASE_URL=(.+)$/m) || [])[1].trim();
const password = (env.match(/^SEED_USER_PASSWORD=(.+)$/m)?.[1] ?? "Owner@12345")
  .trim()
  .replace(/^["']|["']$/g, "");

const c = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await c.connect();

const orgs = await c.query(
  `SELECT name, system_type, licence_key, status FROM organizations WHERE licence_key LIKE 'LIC-DEMO-%' OR system_type = 'distribution' ORDER BY 1`,
);
console.log("orgs", orgs.rows);

let orgId = (
  await c.query(`SELECT id FROM organizations WHERE licence_key = 'LIC-DEMO-DISTRIBUTION' LIMIT 1`)
).rows[0]?.id;

if (!orgId) {
  try {
    const ins = await c.query(
      `INSERT INTO organizations (name, system_type, status, licence_plan, licence_key)
       VALUES ('POPS Demo Medical Distribution', 'distribution', 'active', 'demo', 'LIC-DEMO-DISTRIBUTION')
       RETURNING id`,
    );
    orgId = ins.rows[0].id;
    console.log("created org", orgId);
  } catch (e) {
    console.error("org insert failed", e.message);
    await c.end();
    process.exit(1);
  }
} else {
  console.log("org exists", orgId);
}

const email = "admin.distribution@pops.demo";
let userId = (await c.query(`SELECT id FROM users WHERE email = $1`, [email])).rows[0]?.id;
const hash = await bcrypt.hash(password, 12);
if (!userId) {
  const ins = await c.query(
    `INSERT INTO users (email, name, password_hash, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
    [email, "Distribution Owner", hash],
  );
  userId = ins.rows[0].id;
  console.log("created user", userId);
} else {
  await c.query(`UPDATE users SET password_hash = $1, status = 'active' WHERE id = $2`, [hash, userId]);
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
    [orgId, userId, JSON.stringify(["pops.read", "pops.users.manage", "pops.inventory.manage", "distribution.masters", "distribution.orders", "distribution.deliveries", "distribution.collections", "distribution.field", "distribution.pricing"])],
  );
  console.log("created membership");
}

const branch = await c.query(
  `SELECT id FROM pops_branches WHERE organization_id = $1 AND code = 'DIST-HQ'`,
  [orgId],
);
if (!branch.rows[0]) {
  await c.query(
    `INSERT INTO pops_branches (organization_id, code, name, city, is_hq)
     VALUES ($1, 'DIST-HQ', 'Distribution HQ', 'Lahore', true)`,
    [orgId],
  );
  console.log("created branch DIST-HQ");
}

await c.end();
console.log("DONE");
