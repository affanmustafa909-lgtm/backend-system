import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

/** Idempotent log of licence payment reminder emails (Super Admin automation). */
export const licenceReminders = pgTable(
  "licence_reminders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** e.g. 2026-07 */
    periodKey: text("period_key").notNull(),
    /** month_end | due */
    kind: text("kind").notNull(),
    channel: text("channel").notNull().default("email"),
    toEmail: text("to_email"),
    success: text("success").notNull().default("true"),
    detail: text("detail"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqOrgPeriodKind: uniqueIndex("licence_reminders_org_period_kind_uidx").on(
      t.organizationId,
      t.periodKey,
      t.kind,
    ),
  }),
);
