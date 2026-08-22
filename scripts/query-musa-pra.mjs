import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  ssl: /railway|rlwy\.app|amazonaws|neon/i.test(url) ? { rejectUnauthorized: false } : undefined,
});

await client.connect();

const orgs = await client.query(
  `select id, name, pra_enabled, pra_fake_enabled, pra_real_enabled, pra_fake_invoice_seq
   from organizations
   where name ilike '%musa%'
   order by name`,
);

console.log("=== ORGANIZATIONS (Musa) ===");
console.log(JSON.stringify(orgs.rows, null, 2));

for (const org of orgs.rows) {
  const branches = await client.query(
    `select id, code, name from pops_branches where organization_id = $1 order by code`,
    [org.id],
  );
  console.log(`\n=== BRANCHES · ${org.name} ===`);
  console.log(JSON.stringify(branches.rows, null, 2));

  const profiles = await client.query(
    `select
       company_name,
       ntn,
       strn,
       business_type,
       province,
       branch_name,
       branch_code,
       pra_registration_number as pos_id,
       pra_username,
       pra_password as access_code,
       pra_branch_code,
       pra_environment,
       pra_status,
       pra_access_token as bearer_token,
       pra_token_expires_at,
       pra_connected_at,
       pra_last_token_refresh_at,
       pra_last_invoice_sent_at,
       pra_last_error,
       pra_auto_submit,
       pra_offline_queue,
       updated_at
     from tax_authority_profiles
     where organization_id = $1`,
    [org.id],
  );
  console.log(`\n=== PRA TAX PROFILE · ${org.name} ===`);
  console.log(JSON.stringify(profiles.rows, null, 2));

  const invSummary = await client.query(
    `select invoice_mode, status, count(*)::int as count
     from tax_authority_invoices
     where organization_id = $1 and authority = 'pra'
     group by invoice_mode, status
     order by invoice_mode, status`,
    [org.id],
  );
  console.log(`\n=== PRA INVOICE COUNTS · ${org.name} ===`);
  console.log(JSON.stringify(invSummary.rows, null, 2));

  const recent = await client.query(
    `select authority_invoice_number, invoice_mode, status, source_ref,
            taxable_amount_pkr, tax_amount_pkr, created_at, last_error
     from tax_authority_invoices
     where organization_id = $1 and authority = 'pra'
     order by created_at desc
     limit 8`,
    [org.id],
  );
  console.log(`\n=== RECENT PRA INVOICES · ${org.name} ===`);
  console.log(JSON.stringify(recent.rows, null, 2));
}

if (orgs.rows.length === 0) {
  console.log("\nNo organization matching 'Musa' found in this database.");
}

await client.end();
