import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

/** In-app alerts for business admins (desktop app) — e.g. licence payment due. */
export const orgAlerts = pgTable(
  "org_alerts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** licence_month_end | licence_due */
    kind: text("kind").notNull(),
    /** e.g. 2026-07 */
    periodKey: text("period_key").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** When Super Admin recorded payment / extended licence. */
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    /** When org admin dismissed the banner (still resolved by payment separately). */
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  },
  (t) => ({
    uniqOrgPeriodKind: uniqueIndex("org_alerts_org_period_kind_uidx").on(
      t.organizationId,
      t.periodKey,
      t.kind,
    ),
  }),
);
