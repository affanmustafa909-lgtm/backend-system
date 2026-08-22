import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { popsBranches } from "./operations";
import { users } from "./users";

export const popsSecurityEvents = pgTable("pops_security_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").references(() => popsBranches.id, { onDelete: "set null" }),
  eventType: text("event_type").notNull(),
  userEmail: text("user_email").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
