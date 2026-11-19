import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

/**
 * Central media registry for Super Admin File Manager.
 * Files live under data/uploads/platform-media/... and are served at /uploads/platform-media/...
 */
export const platformMediaAssets = pgTable("platform_media_assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  /** image | video | other */
  kind: text("kind").notNull().default("other"),
  mimeType: text("mime_type").notNull(),
  originalName: text("original_name").notNull().default(""),
  byteSize: integer("byte_size").notNull().default(0),
  width: integer("width"),
  height: integer("height"),
  durationSec: integer("duration_sec"),
  /** Relative path under data/uploads, e.g. platform-media/{org}/{user}/{id}.jpg */
  storagePath: text("storage_path").notNull(),
  /** upload | menu_import | mobizone_sync */
  source: text("source").notNull().default("upload"),
  /** none | flagged | approved | rejected */
  flagStatus: text("flag_status").notNull().default("none"),
  flagNote: text("flag_note"),
  flaggedByUserId: uuid("flagged_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  flaggedAt: timestamp("flagged_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
