/**
 * Idempotent Mobizone demo org + admin on hosted Postgres (Railway).
 *
 *   node scripts/seed-mobizone-demo.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const requireFromApi = createRequire(join(__dirname, "..", "api", "package.json"));
const requireFromDb = createRequire(join(__dirname, "..", "packages", "database-pg", "package.json"));
const pg = requireFromDb("pg");
const bcrypt = requireFromApi("bcryptjs");
const { Client } = pg;

const envPath = join(__dirname, "..", ".env");
const envRaw = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const getEnv = (k, fallback = "") => {
  const m = envRaw.match(new RegExp(`^${k}=(.+)$`, "m"));
  return (process.env[k] || m?.[1] || fallback).trim().replace(/^["']|["']$/g, "");
};

const DATABASE_URL = getEnv("DATABASE_URL");
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const EMAIL = (process.env.MOBIZONE_ADMIN_EMAIL || "admin.mobizone@pops.demo").toLowerCase();
const PASSWORD = process.env.SEED_USER_PASSWORD || getEnv("SEED_USER_PASSWORD", "Owner@12345");
const ORG_NAME = "POPS Demo MobiZone";
const LICENCE_KEY = "LIC-DEMO-MOBIZONE";
const BRANCH_CODE = "MOBI-HQ";

const ADMIN_PERMS = [
  "pops.read",
  "pops.menu.manage",
  "pops.users.manage",
  "pops.inventory.manage",
  "pops.billing.manage",
  "pops.kitchen.manage",
  "pops.hr.manage",
  "pops.accounting.manage",
];

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? undefined : { rejectUnauthorized: false },
  });
  await client.connect();
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const now = new Date().toISOString();

  try {
    await client.query("BEGIN");

    let orgId;
    const byKey = await client.query(
      `select id, status from organizations where licence_key = $1 limit 1`,
      [LICENCE_KEY],
    );
    if (byKey.rows[0]) {
      orgId = byKey.rows[0].id;
      if (byKey.rows[0].status === "deleted") {
        await client.query(
          `update organizations set status='active', name=$2, system_type='mobizone', licence_plan='demo', updated_at=$3 where id=$1`,
          [orgId, ORG_NAME, now],
        );
      } else {
        await client.query(
          `update organizations set name=$2, system_type='mobizone', licence_plan='demo', updated_at=$3 where id=$1`,
          [orgId, ORG_NAME, now],
        );
      }
      console.log("Updated org", orgId);
    } else {
      orgId = randomUUID();
      await client.query(
        `insert into organizations (
          id, name, system_type, status, licence_key, licence_plan, licence_expires_at, created_at, updated_at
        ) values (
          $1, $2, 'mobizone', 'active', $3, 'demo', now() + interval '365 days', $4, $4
        )`,
        [orgId, ORG_NAME, LICENCE_KEY, now],
      );
      console.log("Created org", orgId);
    }

    let userId;
    const byEmail = await client.query(
      `select id from users where lower(email)=lower($1) limit 1`,
      [EMAIL],
    );
    if (byEmail.rows[0]) {
      userId = byEmail.rows[0].id;
      await client.query(
        `update users set
          name=$2,
          password_hash=$3,
          last_set_password=$4,
          status='active',
          platform_role=null
         where id=$1`,
        [userId, "MobiZone Owner", passwordHash, PASSWORD],
      );
      console.log("Updated user", userId);
    } else {
      userId = randomUUID();
      await client.query(
        `insert into users (
          id, email, name, password_hash, last_set_password, platform_role, status, created_at
        ) values ($1,$2,$3,$4,$5,null,'active',$6)`,
        [userId, EMAIL, "MobiZone Owner", passwordHash, PASSWORD, now],
      );
      console.log("Created user", userId);
    }

    const membership = await client.query(
      `select user_id from organization_memberships where user_id=$1 and organization_id=$2 limit 1`,
      [userId, orgId],
    );
    if (membership.rows[0]) {
      await client.query(
        `update organization_memberships set
          role='owner',
          permissions=$3::jsonb,
          branch_scope='all',
          pin_required=false,
          active=true,
          last_activity_at=$4
         where user_id=$1 and organization_id=$2`,
        [userId, orgId, JSON.stringify(ADMIN_PERMS), now],
      );
    } else {
      await client.query(
        `insert into organization_memberships (
          organization_id, user_id, role, permissions, branch_scope, pin_required, active, last_activity_at, created_at
        ) values ($1,$2,'owner',$3::jsonb,'all',false,true,$4,$4)`,
        [orgId, userId, JSON.stringify(ADMIN_PERMS), now],
      );
    }

    await client.query(`update organizations set created_by=$2 where id=$1`, [orgId, userId]);

    const branch = await client.query(
      `select id from pops_branches where organization_id=$1 and code=$2 limit 1`,
      [orgId, BRANCH_CODE],
    );
    if (!branch.rows[0]) {
      await client.query(
        `insert into pops_branches (
          id, organization_id, code, name, city, created_at
        ) values ($1,$2,$3,$4,$5,$6)`,
        [randomUUID(), orgId, BRANCH_CODE, "MobiZone HQ", "Islamabad", now],
      );
      console.log("Created branch", BRANCH_CODE);
    } else {
      console.log("Branch exists", BRANCH_CODE);
    }

    await client.query("COMMIT");
    console.log("\nMobiZone demo ready:");
    console.log(`  email:    ${EMAIL}`);
    console.log(`  password: ${PASSWORD}`);
    console.log(`  branch:   ${BRANCH_CODE}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
