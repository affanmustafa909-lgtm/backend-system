import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { popsBranches } from "./operations";
import { users } from "./users";

export const popsBills = pgTable("pops_bills", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  billRef: text("bill_ref").notNull(),
  orderRef: text("order_ref"),
  tableLabel: text("table_label").notNull(),
  waiterId: uuid("waiter_id").references(() => users.id, { onDelete: "set null" }),
  waiterName: text("waiter_name").notNull(),
  linesJson: text("lines_json").notNull(),
  notes: text("notes"),
  subtotalPkr: integer("subtotal_pkr").notNull(),
  discountPkr: integer("discount_pkr").notNull().default(0),
  servicePkr: integer("service_pkr").notNull().default(0),
  taxPkr: integer("tax_pkr").notNull().default(0),
  totalPkr: integer("total_pkr").notNull(),
  servicePct: integer("service_pct").notNull().default(0),
  taxPct: integer("tax_pct").notNull().default(0),
  /** JSON array of { method, amount } for split / multi-method payments. */
  paymentsJson: text("payments_json"),
  /** Links split bills from the same order, e.g. ORD-1234-S1 */
  splitGroupRef: text("split_group_ref"),
  riderId: uuid("rider_id"),
  deliveryChargePkr: integer("delivery_charge_pkr").notNull().default(0),
  status: text("status").notNull().default("open"),
  inventoryDeductedAt: timestamp("inventory_deducted_at", { withTimezone: true }),
  /** fake | real — which PRA path was issued for this bill. */
  praMode: text("pra_mode"),
  praInvoiceNumber: text("pra_invoice_number"),
  /** Internal / fiscal reference id shown on the PRA slip. */
  praInvoiceId: text("pra_invoice_id"),
  praQrPayload: text("pra_qr_payload"),
  praIssuedAt: timestamp("pra_issued_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
