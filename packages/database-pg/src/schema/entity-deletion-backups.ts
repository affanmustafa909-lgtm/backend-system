import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Soft-delete archive: full snapshot of a business or user removed from live lists.
 * Original emails are stored here so login emails can be reused after delete.
 */
export const entityDeletionBackups = pgTable("entity_deletion_backups", {
  id: uuid("id").defaultRandom().primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  originalEmail: text("original_email"),
  label: text("label"),
  payload: jsonb("payload").$type<unknown>().notNull(),
  deletedBy: uuid("deleted_by"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
});
