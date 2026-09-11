import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

/** Prevents duplicate cloud writes when a push is retried. */
export const syncAppliedMutations = pgTable(
  "sync_applied_mutations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    clientMutationId: text("client_mutation_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    resultJson: text("result_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("sync_applied_org_idem_uidx").on(t.organizationId, t.idempotencyKey),
    unique("sync_applied_org_mutation_uidx").on(t.organizationId, t.clientMutationId),
    index("sync_applied_org_created_idx").on(t.organizationId, t.createdAt),
  ],
);

export const syncDevices = pgTable(
  "sync_devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    deviceId: text("device_id").notNull(),
    deviceName: text("device_name"),
    appVersion: text("app_version"),
    platform: text("platform"),
    status: text("status").notNull().default("active"),
    lastCursor: text("last_cursor"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    unique("sync_devices_org_device_uidx").on(t.organizationId, t.deviceId),
    index("sync_devices_org_user_idx").on(t.organizationId, t.userId),
  ],
);
