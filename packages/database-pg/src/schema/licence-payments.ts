import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

/** Manual ledger of software subscription payments (Super Admin recorded). */
export const licencePayments = pgTable("licence_payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  /** 5 = trial/short, 30 = monthly, etc. */
  periodDays: integer("period_days").notNull(),
  /** Amount in whole currency units (e.g. PKR). */
  amount: integer("amount").notNull().default(0),
  currency: text("currency").notNull().default("PKR"),
  /** Who paid (customer email / name). */
  paidByLabel: text("paid_by_label"),
  note: text("note"),
  paidAt: timestamp("paid_at", { withTimezone: true }).notNull().defaultNow(),
  recordedBy: uuid("recorded_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
