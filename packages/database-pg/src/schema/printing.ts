import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { popsBranches } from "./operations";
import { organizations } from "./organizations";

/** Cloud registry of branch-local print servers (Tauri). */
export const printBranchServers = pgTable("print_branch_servers", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").references(() => popsBranches.id, { onDelete: "set null" }),
  serverKey: text("server_key").notNull(),
  branchCode: text("branch_code").notNull(),
  branchName: text("branch_name").notNull(),
  serverName: text("server_name").notNull(),
  hostname: text("hostname"),
  localIp: text("local_ip").notNull(),
  port: integer("port").notNull().default(9740),
  status: text("status").notNull().default("offline"),
  printerCount: integer("printer_count").notNull().default(0),
  queuePending: integer("queue_pending").notNull().default(0),
  queueFailed: integer("queue_failed").notNull().default(0),
  version: text("version"),
  cloudSyncEnabled: boolean("cloud_sync_enabled").notNull().default(true),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Logical printer inventory (cloud control plane). */
export const printPrinterNodes = pgTable("print_printer_nodes", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchCode: text("branch_code").notNull(),
  name: text("name").notNull(),
  printerType: text("printer_type").notNull().default("receipt"),
  windowsPrinterName: text("windows_printer_name"),
  ipAddress: text("ip_address"),
  macAddress: text("mac_address"),
  hostname: text("hostname"),
  port: integer("port"),
  connectionType: text("connection_type").notNull().default("other"),
  paperSize: text("paper_size").notNull().default("80mm"),
  online: boolean("online").notNull().default(true),
  reachable: boolean("reachable"),
  pingMs: integer("ping_ms"),
  backupPrinterId: uuid("backup_printer_id"),
  legacyProfileId: text("legacy_profile_id"),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Cloud audit / optional cloud queue metadata for print jobs. */
export const printJobsCloud = pgTable("print_jobs_cloud", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchCode: text("branch_code").notNull(),
  branchServerId: uuid("branch_server_id").references(() => printBranchServers.id, {
    onDelete: "set null",
  }),
  localJobId: text("local_job_id"),
  userId: text("user_id"),
  deviceId: text("device_id"),
  deviceLabel: text("device_label"),
  printerId: uuid("printer_id").references(() => printPrinterNodes.id, { onDelete: "set null" }),
  printerName: text("printer_name"),
  orderId: text("order_id"),
  priority: integer("priority").notNull().default(100),
  status: text("status").notNull().default("pending"),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  error: text("error"),
  payloadJson: jsonb("payload_json").notNull(),
  cloudQueued: boolean("cloud_queued").notNull().default(false),
  printedAt: timestamp("printed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const printAlerts = pgTable("print_alerts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchCode: text("branch_code").notNull(),
  alertType: text("alert_type").notNull(),
  message: text("message").notNull(),
  printerId: uuid("printer_id"),
  jobId: uuid("job_id"),
  dismissed: boolean("dismissed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
