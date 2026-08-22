import { pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

export const modules = pgTable(
  "modules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: varchar("slug", { length: 64 }).notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    publisher: text("publisher"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("modules_slug_unique").on(t.slug)],
);

export const moduleVersions = pgTable("module_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  moduleId: uuid("module_id")
    .notNull()
    .references(() => modules.id, { onDelete: "cascade" }),
  semver: varchar("semver", { length: 64 }).notNull(),
  artifactUrl: text("artifact_url").notNull(),
  digestSha256: varchar("digest_sha256", { length: 64 }).notNull(),
  releasedAt: timestamp("released_at", { withTimezone: true }).notNull().defaultNow(),
});
