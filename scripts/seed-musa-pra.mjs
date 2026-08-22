/**
 * Seed Musa Cafe Real PRA credentials into tax_authority_profiles for MAIN branch.
 *
 * Env:
 *   DATABASE_URL (required)
 *   ORG_NAME optional filter (default: Musa)
 *
 * Usage:
 *   node --env-file=.env backend-system/scripts/seed-musa-pra.mjs
 */
import pg from "pg";

const {
  DATABASE_URL,
  ORG_NAME = "Musa",
} = process.env;

const MUSA = {
  companyName: "Musa Cafe and Restaurants",
  ntn: "5272644-3",
  strn: "",
  businessType: "Restaurant",
  province: "Punjab",
  branchName: "Main",
  branchCode: "MAIN",
  /** POS Details from PRA portal */
  posId: "197656",
  accessCode: "851C6C3B",
  token: "ab9b3002-8024-3181-a7b6-427be47603c6",
  username: "3220381740551",
  environment: "production",
};

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: DATABASE_URL,
  ssl: /railway|rlwy\.app|amazonaws|neon\.tech/i.test(DATABASE_URL)
    ? { rejectUnauthorized: false }
    : undefined,
});

async function main() {
  await client.connect();
  const orgs = await client.query(
    `select id, name, pra_real_enabled, pra_fake_enabled, pra_enabled
     from organizations
     where name ilike $1
     order by created_at desc
     limit 5`,
    [`%${ORG_NAME}%`],
  );
  if (orgs.rows.length === 0) {
    console.error(`No organization matching %${ORG_NAME}%. Create the business first.`);
    process.exit(1);
  }
  console.log("Matched orgs:", orgs.rows);

  const org = orgs.rows[0];
  await client.query(
    `update organizations
     set pra_real_enabled = true,
         pra_fake_enabled = false,
         pra_enabled = true,
         fbr_enabled = coalesce(fbr_enabled, false),
         updated_at = now()
     where id = $1`,
    [org.id],
  );

  const branch = await client.query(
    `select id, code, name from pops_branches
     where organization_id = $1
     order by case when code = 'MAIN' then 0 else 1 end, created_at
     limit 1`,
    [org.id],
  );
  if (branch.rows.length === 0) {
    console.error("No branch found for org");
    process.exit(1);
  }
  const b = branch.rows[0];
  console.log("Branch:", b);

  const existing = await client.query(
    `select id from tax_authority_profiles
     where organization_id = $1 and branch_id = $2
     limit 1`,
    [org.id, b.id],
  );

  const now = new Date();
  const expires = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  if (existing.rows.length === 0) {
    await client.query(
      `insert into tax_authority_profiles (
         organization_id, branch_id,
         company_name, ntn, strn, business_type, province, branch_name, branch_code,
         pra_registration_number, pra_username, pra_password, pra_branch_code,
         pra_environment, pra_status, pra_access_token, pra_token_expires_at,
         pra_connected_at, pra_last_token_refresh_at, pra_last_error,
         pra_auto_submit, pra_offline_queue, pra_retry_failed, pra_max_retry_attempts,
         created_at, updated_at
       ) values (
         $1,$2,
         $3,$4,$5,$6,$7,$8,$9,
         $10,$11,$12,$13,
         $14,'connected',$15,$16,
         $17,$17,null,
         true,true,true,3,
         now(), now()
       )`,
      [
        org.id,
        b.id,
        MUSA.companyName,
        MUSA.ntn,
        MUSA.strn,
        MUSA.businessType,
        MUSA.province,
        MUSA.branchName,
        MUSA.branchCode,
        MUSA.posId,
        MUSA.username,
        MUSA.accessCode,
        MUSA.branchCode,
        MUSA.environment,
        MUSA.token,
        expires,
        now,
      ],
    );
    console.log("Inserted PRA profile for", org.name);
  } else {
    await client.query(
      `update tax_authority_profiles set
         company_name = $3,
         ntn = $4,
         strn = $5,
         business_type = $6,
         province = $7,
         branch_name = $8,
         branch_code = $9,
         pra_registration_number = $10,
         pra_username = $11,
         pra_password = $12,
         pra_branch_code = $13,
         pra_environment = $14,
         pra_status = 'connected',
         pra_access_token = $15,
         pra_token_expires_at = $16,
         pra_connected_at = $17,
         pra_last_token_refresh_at = $17,
         pra_last_error = null,
         pra_auto_submit = true,
         pra_offline_queue = true,
         pra_retry_failed = true,
         pra_max_retry_attempts = 3,
         updated_at = now()
       where id = $1`,
      [
        existing.rows[0].id,
        org.id,
        MUSA.companyName,
        MUSA.ntn,
        MUSA.strn,
        MUSA.businessType,
        MUSA.province,
        MUSA.branchName,
        MUSA.branchCode,
        MUSA.posId,
        MUSA.username,
        MUSA.accessCode,
        MUSA.branchCode,
        MUSA.environment,
        MUSA.token,
        expires,
        now,
      ],
    );
    console.log("Updated PRA profile for", org.name);
  }

  console.log("Done. POS ID", MUSA.posId, "env", MUSA.environment);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
