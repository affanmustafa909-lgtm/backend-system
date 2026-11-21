/**
 * Idempotent Embroidery Factory demo org + admin on hosted Postgres (Railway).
 *
 *   node scripts/seed-embroidery-demo.mjs
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

const EMAIL = (process.env.EMBROIDERY_ADMIN_EMAIL || "admin.embroidery@factory.demo").toLowerCase();
const PASSWORD = process.env.SEED_USER_PASSWORD || getEnv("SEED_USER_PASSWORD", "Owner@12345");
const ORG_NAME = "Embroidery Factory Demo";
const LICENCE_KEY = "LIC-DEMO-EMBROIDERY";
const BRANCH_CODE = "EMB-HQ";

const ADMIN_PERMS = [
  "*",
  "pops.read",
  "pops.users.manage",
  "pops.inventory.manage",
  "pops.hr.manage",
  "pops.accounting.manage",
  "embroidery.read",
  "embroidery.manage",
  "embroidery.production",
  "embroidery.qc",
  "embroidery.delivery",
];

async function ensureEmbroideryTables(client) {
  const sqlDir = join(__dirname, "..", "packages", "database-pg", "sql");
  for (const file of [
    "ensure_embroidery_tables.sql",
    "ensure_embroidery_design_file_columns.sql",
    "ensure_factory_tables.sql",
    "ensure_factory_depth.sql",
    "ensure_factory_extra_modules.sql",
  ]) {
    const path = join(sqlDir, file);
    if (!existsSync(path)) {
      console.warn("Missing SQL:", path);
      continue;
    }
    await client.query(readFileSync(path, "utf8"));
    console.log("Applied", file);
  }
}

async function seedFactoryDemo(client, orgId, branchId) {
  const today = new Date().toISOString().slice(0, 10);

  let partyId;
  const party = await client.query(
    `select id from factory_parties where organization_id=$1 and code=$2 limit 1`,
    [orgId, "P-0001"],
  );
  if (party.rows[0]) {
    partyId = party.rows[0].id;
  } else {
    partyId = randomUUID();
    await client.query(
      `insert into factory_parties (
        id, organization_id, branch_id, kind, code, name, phone, notes
      ) values ($1,$2,$3,'customer','P-0001','Demo Garments','0300-0000000','Seed party')`,
      [partyId, orgId, branchId],
    );
    console.log("Seeded factory party P-0001");
  }

  let itemId;
  const item = await client.query(
    `select id from factory_items where organization_id=$1 and sku=$2 limit 1`,
    [orgId, "THR-0001"],
  );
  if (item.rows[0]) {
    itemId = item.rows[0].id;
  } else {
    itemId = randomUUID();
    await client.query(
      `insert into factory_items (
        id, organization_id, branch_id, sku, name, category, unit, reorder_level, unit_cost_pkr
      ) values ($1,$2,$3,'THR-0001','Polyester thread 120','thread','cone',5,450)`,
      [itemId, orgId, branchId],
    );
    await client.query(
      `insert into factory_stock_balances (id, organization_id, branch_id, item_id, qty_on_hand)
       values ($1,$2,$3,$4,25)
       on conflict (organization_id, branch_id, item_id) do update set qty_on_hand = excluded.qty_on_hand`,
      [randomUUID(), orgId, branchId, itemId],
    );
    console.log("Seeded factory item THR-0001");
  }

  let operatorId;
  const op = await client.query(
    `select id from factory_operators where organization_id=$1 and code=$2 limit 1`,
    [orgId, "OP-0001"],
  );
  if (op.rows[0]) {
    operatorId = op.rows[0].id;
  } else {
    operatorId = randomUUID();
    await client.query(
      `insert into factory_operators (
        id, organization_id, branch_id, code, name, rate_per_1k_stitches_pkr, rate_per_piece_pkr
      ) values ($1,$2,$3,'OP-0001','Ali Operator',50,10)`,
      [operatorId, orgId, branchId],
    );
    console.log("Seeded factory operator OP-0001");
  }

  const inward = await client.query(
    `select id from factory_inward_challans where organization_id=$1 and cn_number=$2 limit 1`,
    [orgId, "IN-0001"],
  );
  if (!inward.rows[0]) {
    const cnId = randomUUID();
    await client.query(
      `insert into factory_inward_challans (
        id, organization_id, branch_id, cn_number, party_id, challan_date, status, notes
      ) values ($1,$2,$3,'IN-0001',$4,$5,'open','Seed inward lot')`,
      [cnId, orgId, branchId, partyId, today],
    );
    await client.query(
      `insert into factory_inward_challan_lines (
        id, challan_id, description, qty, unit, colour, qty_dispatched
      ) values ($1,$2,'Saree lot A',20,'pcs','Maroon',0)`,
      [randomUUID(), cnId],
    );
    console.log("Seeded inward CN IN-0001");
  }

  void itemId;
  void operatorId;
}

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? undefined : { rejectUnauthorized: false },
  });
  await client.connect();
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const now = new Date().toISOString();

  try {
    await ensureEmbroideryTables(client);
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
          `update organizations set status='active', name=$2, system_type='embroidery', licence_plan='demo', updated_at=$3 where id=$1`,
          [orgId, ORG_NAME, now],
        );
      } else {
        await client.query(
          `update organizations set name=$2, system_type='embroidery', licence_plan='demo', updated_at=$3 where id=$1`,
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
          $1, $2, 'embroidery', 'active', $3, 'demo', now() + interval '365 days', $4, $4
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
        [userId, "Embroidery Admin", passwordHash, PASSWORD],
      );
      console.log("Updated user", userId);
    } else {
      userId = randomUUID();
      await client.query(
        `insert into users (
          id, email, name, password_hash, last_set_password, platform_role, status, created_at
        ) values ($1,$2,$3,$4,$5,null,'active',$6)`,
        [userId, EMAIL, "Embroidery Admin", passwordHash, PASSWORD, now],
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

    let branchId;
    const branch = await client.query(
      `select id from pops_branches where organization_id=$1 and code=$2 limit 1`,
      [orgId, BRANCH_CODE],
    );
    if (!branch.rows[0]) {
      branchId = randomUUID();
      await client.query(
        `insert into pops_branches (
          id, organization_id, code, name, city, created_at
        ) values ($1,$2,$3,$4,$5,$6)`,
        [branchId, orgId, BRANCH_CODE, "Factory Floor", "Faisalabad", now],
      );
      console.log("Created branch", BRANCH_CODE);
    } else {
      branchId = branch.rows[0].id;
      console.log("Branch exists", BRANCH_CODE);
    }

    await seedFactoryDemo(client, orgId, branchId);

    await client.query("COMMIT");
    console.log("\nEmbroidery factory demo ready:");
    console.log(`  email:    ${EMAIL}`);
    console.log(`  password: ${PASSWORD}`);
    console.log(`  branch:   ${BRANCH_CODE}`);
    console.log("  modules:  parties, inventory, inward CN, operators (seeded)");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
