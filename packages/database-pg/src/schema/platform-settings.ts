import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Global key/value settings managed by the Super Admin (affect every installation). */
export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
