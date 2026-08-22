import { pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name"),
  email: varchar("email", { length: 320 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  /**
   * Last password set via Super Admin / org user create-reset.
   * Support desk only — never returned to tenant POS sessions.
   * Null when the user changed password themselves or account predates this field.
   */
  lastSetPassword: text("last_set_password"),
  /** `super_admin` for platform control-plane users; null for tenant users. */
  platformRole: text("platform_role"),
  /** active | inactive | suspended | deleted (soft-deleted; email tombstoned) */
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
