import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { popsBranches } from "./operations";
import { organizations } from "./organizations";

export const popsNotificationSettings = pgTable("pops_notification_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  smsEnabled: boolean("sms_enabled").notNull().default(true),
  whatsappEnabled: boolean("whatsapp_enabled").notNull().default(true),
  printerAlertsEnabled: boolean("printer_alerts_enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsNotificationTemplates = pgTable("pops_notification_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  templateKey: text("template_key").notNull(),
  name: text("name").notNull(),
  channel: text("channel").notNull(), // sms | whatsapp | app
  body: text("body").notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsNotificationLog = pgTable("pops_notification_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").references(() => popsBranches.id, { onDelete: "set null" }),
  channel: text("channel").notNull(),
  recipientLabel: text("recipient_label").notNull(),
  templateKey: text("template_key"),
  templateName: text("template_name").notNull(),
  bodyPreview: text("body_preview"),
  status: text("status").notNull().default("sent"), // queued | sent | failed | skipped
  source: text("source").notNull(), // delivery | crm | kitchen | manual | system
  sourceRef: text("source_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
