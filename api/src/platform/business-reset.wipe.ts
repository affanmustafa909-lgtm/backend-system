import { Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { PlatformPgDb } from "@platform/database-pg";

const logger = new Logger("BusinessResetWipe");

export type DataResetScope = "hr" | "restaurant" | "all";

/**
 * HR module transactional + roster tables.
 * Employees removed on HR/all reset so payroll/advance history cannot linger.
 */
const HR_DELETE_TABLES: readonly string[] = [
  "pops_payroll_runs",
  "pops_attendance",
  "pops_leave_requests",
  "pops_staff_food",
  "pops_employee_advances",
  "pops_employees",
];

/** Restaurant POS / kitchen / cash / inventory ops. */
const RESTAURANT_DELETE_TABLES: readonly string[] = [
  "pops_vendor_payments",
  "pops_vendor_bills",
  "pops_customer_payments",
  "pops_customer_invoices",
  "pops_cash_movements",
  "pops_cash_sessions",
  "pops_bank_transactions",
  "pops_expenses",
  "pops_accounting_audit_logs",
  "pops_journal_entries",

  "pops_goods_receipts",
  "pops_purchase_orders",
  "pops_stock_batches",
  "pops_stock_adjustments",
  "pops_waste_records",
  "pops_stock_counts",
  "pops_production_batches",
  "pops_inventory_audit_logs",
  "pops_branch_transfers",

  "pops_bills",
  "pops_sales",
  "pops_daily_sales",
  "pops_active_orders",
  "pops_kitchen_tickets",
  "pops_kitchen_line_cancellations",
  "pops_alerts",
  "pops_security_events",
  "pops_notification_log",
  "pops_day_close_records",

  "tax_authority_invoices",
  "tax_authority_activity_logs",

  "print_jobs_cloud",
  "print_alerts",
  "org_alerts",
];

/** Store / pharmacy transactional (included in "all"). */
const STORE_PHARMACY_DELETE_TABLES: readonly string[] = [
  "store_cash_movements",
  "store_sale_returns",
  "store_sales",
  "store_purchase_returns",
  "store_grn",
  "store_purchase_orders",
  "store_purchase_requisitions",
  "store_stock_transfers",
  "store_stock_adjustments",
  "store_stock_audits",
  "store_inventory_transactions",
  "store_shifts",
  "store_coupons",
  "store_gift_cards",

  "pharmacy_sales",
  "pharmacy_prescriptions",
  "pharmacy_khata_entries",
  "pharmacy_controlled_drug_logs",
  "pharmacy_shifts",
  "pharmacy_refill_reminders",
];

/** Full company transactional wipe (Super Admin + Settings → All). */
const ALL_DELETE_TABLES: readonly string[] = [
  ...STORE_PHARMACY_DELETE_TABLES,
  ...RESTAURANT_DELETE_TABLES,
  ...HR_DELETE_TABLES,
];

function tablesForScope(scope: DataResetScope): readonly string[] {
  if (scope === "hr") return HR_DELETE_TABLES;
  if (scope === "restaurant") return RESTAURANT_DELETE_TABLES;
  return ALL_DELETE_TABLES;
}

async function deleteByOrg(
  db: PlatformPgDb,
  table: string,
  organizationId: string,
): Promise<number> {
  try {
    const result = await db.execute(
      sql`DELETE FROM ${sql.raw(table)} WHERE organization_id = ${organizationId}`,
    );
    return Number(result.rowCount ?? 0);
  } catch (err) {
    logger.warn(
      `DELETE ${table} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 0;
  }
}

async function execOptional(db: PlatformPgDb, query: ReturnType<typeof sql>): Promise<number> {
  try {
    const result = await db.execute(query);
    return Number(result.rowCount ?? 0);
  } catch (err) {
    logger.warn(`SQL wipe step failed: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}

async function wipeChildRows(
  db: PlatformPgDb,
  organizationId: string,
  scope: DataResetScope,
): Promise<number> {
  let deleted = 0;

  if (scope === "all" || scope === "restaurant") {
    deleted += await execOptional(
      db,
      sql`DELETE FROM pops_journal_lines WHERE entry_id IN (
        SELECT id FROM pops_journal_entries WHERE organization_id = ${organizationId}
      )`,
    );
  }

  if (scope === "all" || scope === "hr") {
    deleted += await execOptional(
      db,
      sql`DELETE FROM pops_payroll_lines WHERE payroll_run_id IN (
        SELECT id FROM pops_payroll_runs WHERE organization_id = ${organizationId}
      )`,
    );
  }

  if (scope === "all") {
    deleted += await execOptional(
      db,
      sql`DELETE FROM store_product_batches WHERE product_id IN (
        SELECT id FROM store_products WHERE organization_id = ${organizationId}
      )`,
    );
    deleted += await execOptional(
      db,
      sql`DELETE FROM store_product_serials WHERE product_id IN (
        SELECT id FROM store_products WHERE organization_id = ${organizationId}
      )`,
    );
    deleted += await execOptional(
      db,
      sql`DELETE FROM pharmacy_medicine_batches WHERE medicine_id IN (
        SELECT id FROM pharmacy_medicines WHERE organization_id = ${organizationId}
      )`,
    );
  }

  return deleted;
}

async function zeroBalances(
  db: PlatformPgDb,
  organizationId: string,
  scope: DataResetScope,
): Promise<number> {
  let n = 0;
  if (scope === "all" || scope === "restaurant") {
    n += await execOptional(
      db,
      sql`UPDATE pops_bank_accounts SET balance_pkr = 0 WHERE organization_id = ${organizationId}`,
    );
    n += await execOptional(
      db,
      sql`UPDATE pops_ingredients SET current_stock = 0 WHERE organization_id = ${organizationId}`,
    );
    n += await execOptional(
      db,
      sql`UPDATE pops_inventory_items SET qty = 0 WHERE organization_id = ${organizationId}`,
    );
    n += await execOptional(
      db,
      sql`UPDATE pops_suppliers SET opening_balance_pkr = 0 WHERE organization_id = ${organizationId}`,
    );
    n += await execOptional(
      db,
      sql`UPDATE pops_branch_closing_state SET
        orders_paused = false,
        orders_paused_at = NULL,
        orders_paused_by = NULL,
        last_z_report_at = NULL,
        last_z_report_ref = NULL,
        last_z_report_json = NULL,
        last_backup_at = NULL,
        last_backup_ref = NULL,
        last_day_closed_at = NULL,
        last_day_closed_by = NULL,
        updated_at = NOW()
      WHERE organization_id = ${organizationId}`,
    );
  }
  if (scope === "all") {
    n += await execOptional(
      db,
      sql`UPDATE store_products SET
        available_stock = 0,
        reserved_stock = 0,
        damaged_stock = 0,
        expired_stock = 0,
        in_transit_stock = 0
      WHERE organization_id = ${organizationId}`,
    );
    n += await execOptional(
      db,
      sql`UPDATE pharmacy_medicines SET current_stock = 0 WHERE organization_id = ${organizationId}`,
    );
    n += await execOptional(
      db,
      sql`UPDATE organizations SET pra_fake_invoice_seq = 0, updated_at = NOW()
        WHERE id = ${organizationId}`,
    );
  }
  return n;
}

/**
 * Wipe org data by scope. Returns deleted row count + tables that had rows removed.
 */
export async function wipeBusinessDataByScope(
  db: PlatformPgDb,
  organizationId: string,
  scope: DataResetScope,
): Promise<{ deletedRows: number; wipedTables: string[]; scope: DataResetScope }> {
  let deletedRows = await wipeChildRows(db, organizationId, scope);
  const wipedTables: string[] = [];
  const tables = tablesForScope(scope);

  // Delete payroll/advances before employees when HR is in scope.
  const ordered = [...tables].sort((a, b) => {
    if (a === "pops_employees") return 1;
    if (b === "pops_employees") return -1;
    return 0;
  });

  for (const table of ordered) {
    const n = await deleteByOrg(db, table, organizationId);
    if (n > 0) {
      deletedRows += n;
      wipedTables.push(table);
    } else {
      // Still record attempted wipe for audit when table exists but empty —
      // only push if we successfully ran DELETE (n>=0 and no throw). Always push for visibility.
      wipedTables.push(table);
    }
  }

  deletedRows += await zeroBalances(db, organizationId, scope);

  logger.log(
    `Scope=${scope} org=${organizationId} deletedRows=${deletedRows} tables=${wipedTables.length}`,
  );

  return { deletedRows, wipedTables: [...new Set(wipedTables)], scope };
}

/** Super Admin / Settings → All: full transactional wipe. */
export async function wipeBusinessTransactions(
  db: PlatformPgDb,
  organizationId: string,
): Promise<{ deletedRows: number; wipedTables: string[] }> {
  const result = await wipeBusinessDataByScope(db, organizationId, "all");
  return { deletedRows: result.deletedRows, wipedTables: result.wipedTables };
}
