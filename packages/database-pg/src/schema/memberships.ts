import { sql } from "drizzle-orm";
import { boolean, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    permissions: jsonb("permissions").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    branchScope: text("branch_scope").notNull().default("all"),
    pinRequired: boolean("pin_required").notNull().default(false),
    /** When false, membership cannot authenticate. */
    active: boolean("active").notNull().default(true),
    /** Allowed nav paths; null = all paths permitted by permissions. */
    navAllowlist: jsonb("nav_allowlist").$type<string[] | null>(),
    /** bcrypt hash of 4-digit staff PIN for mobile / quick login */
    staffPinHash: text("staff_pin_hash"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId] })],
);
