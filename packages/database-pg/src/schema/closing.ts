import { boolean, date, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { popsBranches } from "./operations";

export const popsBranchClosingState = pgTable("pops_branch_closing_state", {
  branchId: uuid("branch_id")
    .primaryKey()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  businessDate: date("business_date").notNull(),
  ordersPaused: boolean("orders_paused").notNull().default(false),
  ordersPausedAt: timestamp("orders_paused_at", { withTimezone: true }),
  ordersPausedBy: text("orders_paused_by"),
  lastZReportAt: timestamp("last_z_report_at", { withTimezone: true }),
  lastZReportRef: text("last_z_report_ref"),
  lastZReportJson: text("last_z_report_json"),
  lastBackupAt: timestamp("last_backup_at", { withTimezone: true }),
  lastBackupRef: text("last_backup_ref"),
  lastDayClosedAt: timestamp("last_day_closed_at", { withTimezone: true }),
  lastDayClosedBy: text("last_day_closed_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsDayCloseRecords = pgTable("pops_day_close_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  businessDate: date("business_date").notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
  closedBy: text("closed_by").notNull(),
  zReportRef: text("z_report_ref"),
  salesTotalPkr: integer("sales_total_pkr").notNull().default(0),
  orderCount: integer("order_count").notNull().default(0),
  cashVariancePkr: integer("cash_variance_pkr").notNull().default(0),
  summaryJson: text("summary_json"),
});
