import { z } from "zod";

/** Enterprise printing — branch servers, printers, jobs, discovery, and realtime events. */

export const PRINT_JOB_STATUSES = [
  "pending",
  "printing",
  "completed",
  "failed",
  "cancelled",
  "retrying",
  "paused",
] as const;
export const printJobStatusSchema = z.enum(PRINT_JOB_STATUSES);
export type PrintJobStatus = z.infer<typeof printJobStatusSchema>;

export const PRINT_CONNECTION_TYPES = [
  "usb",
  "network",
  "wifi",
  "bluetooth",
  "windows_shared",
  "ipp",
  "raw_9100",
  "other",
] as const;
export const printConnectionTypeSchema = z.enum(PRINT_CONNECTION_TYPES);
export type PrintConnectionType = z.infer<typeof printConnectionTypeSchema>;

export const PRINT_PRINTER_TYPES = [
  "kitchen",
  "bar",
  "receipt",
  "invoice",
  "pharmacy",
  "delivery",
  "counter",
  "other",
] as const;
export const printPrinterTypeSchema = z.enum(PRINT_PRINTER_TYPES);
export type PrintPrinterType = z.infer<typeof printPrinterTypeSchema>;

export const PRINT_JOB_KINDS = ["receipt", "kot", "invoice", "test", "cash_slip", "salary"] as const;
export const printJobKindSchema = z.enum(PRINT_JOB_KINDS);
export type PrintJobKind = z.infer<typeof printJobKindSchema>;

export const branchPrintServerSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().uuid().optional(),
  branchId: z.string().uuid().nullable().optional(),
  branchCode: z.string().min(1).max(64),
  branchName: z.string().min(1).max(200),
  serverName: z.string().min(1).max(200),
  hostname: z.string().max(200).optional().nullable(),
  localIp: z.string().min(7).max(64),
  port: z.number().int().min(1).max(65535).default(9740),
  status: z.enum(["online", "offline", "degraded"]).default("online"),
  printerCount: z.number().int().nonnegative().default(0),
  lastHeartbeatAt: z.string().datetime().nullable().optional(),
  version: z.string().max(64).optional().nullable(),
  cloudSyncEnabled: z.boolean().default(true),
});
export type BranchPrintServer = z.infer<typeof branchPrintServerSchema>;

export const printerNodeSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().uuid().optional(),
  branchCode: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  printerType: printPrinterTypeSchema.default("receipt"),
  windowsPrinterName: z.string().max(200).nullable().optional(),
  ipAddress: z.string().max(64).nullable().optional(),
  macAddress: z.string().max(64).nullable().optional(),
  hostname: z.string().max(200).nullable().optional(),
  port: z.number().int().min(1).max(65535).nullable().optional(),
  connectionType: printConnectionTypeSchema.default("other"),
  paperSize: z.enum(["58mm", "80mm", "A4", "custom"]).default("80mm"),
  online: z.boolean().default(true),
  reachable: z.boolean().optional(),
  pingMs: z.number().nonnegative().nullable().optional(),
  lastHeartbeatAt: z.string().datetime().nullable().optional(),
  backupPrinterId: z.string().nullable().optional(),
  /** Legacy profile id from pops-printer-routing-v1 */
  legacyProfileId: z.string().nullable().optional(),
});
export type PrinterNode = z.infer<typeof printerNodeSchema>;

export const printJobPayloadSchema = z.object({
  kind: printJobKindSchema,
  html: z.string().optional(),
  plainText: z.string().optional(),
  /** Base64 PNG for image print path */
  imageBase64: z.string().optional(),
  systemPrinterName: z.string().nullable().optional(),
  copies: z.number().int().min(1).max(10).default(1),
  paperSize: z.string().optional(),
  orderId: z.string().nullable().optional(),
  orderRef: z.string().nullable().optional(),
  sectionId: z.string().nullable().optional(),
  meta: z.record(z.unknown()).optional(),
});
export type PrintJobPayload = z.infer<typeof printJobPayloadSchema>;

export const printJobSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().uuid().optional().nullable(),
  branchCode: z.string().min(1).max(64),
  branchServerId: z.string().nullable().optional(),
  userId: z.string().nullable().optional(),
  deviceId: z.string().nullable().optional(),
  deviceLabel: z.string().nullable().optional(),
  printerId: z.string().nullable().optional(),
  printerName: z.string().nullable().optional(),
  orderId: z.string().nullable().optional(),
  priority: z.number().int().default(100),
  status: printJobStatusSchema.default("pending"),
  retryCount: z.number().int().nonnegative().default(0),
  maxRetries: z.number().int().nonnegative().default(3),
  error: z.string().nullable().optional(),
  payload: printJobPayloadSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  printedAt: z.string().nullable().optional(),
  cloudSynced: z.boolean().default(false),
});
export type PrintJob = z.infer<typeof printJobSchema>;

export const createPrintJobSchema = z.object({
  branchCode: z.string().min(1).max(64),
  branchServerId: z.string().optional().nullable(),
  userId: z.string().optional().nullable(),
  deviceId: z.string().optional().nullable(),
  deviceLabel: z.string().optional().nullable(),
  printerId: z.string().optional().nullable(),
  printerName: z.string().optional().nullable(),
  orderId: z.string().optional().nullable(),
  priority: z.number().int().optional(),
  payload: printJobPayloadSchema,
});
export type CreatePrintJob = z.infer<typeof createPrintJobSchema>;

export const printerHeartbeatSchema = z.object({
  serverId: z.string().min(1),
  branchCode: z.string().min(1),
  localIp: z.string().min(7).max(64),
  port: z.number().int().min(1).max(65535),
  printerCount: z.number().int().nonnegative(),
  queuePending: z.number().int().nonnegative().default(0),
  queueFailed: z.number().int().nonnegative().default(0),
  printers: z
    .array(
      z.object({
        id: z.string(),
        online: z.boolean(),
        windowsPrinterName: z.string().nullable().optional(),
        ipAddress: z.string().nullable().optional(),
      }),
    )
    .optional(),
  at: z.string().optional(),
});
export type PrinterHeartbeat = z.infer<typeof printerHeartbeatSchema>;

export const printDiscoveryResultSchema = z.object({
  servers: z.array(branchPrintServerSchema),
  scannedAt: z.string(),
});
export type PrintDiscoveryResult = z.infer<typeof printDiscoveryResultSchema>;

export const printQueueActionSchema = z.object({
  jobId: z.string().min(1),
  action: z.enum(["retry", "pause", "resume", "cancel", "reprint"]),
});
export type PrintQueueAction = z.infer<typeof printQueueActionSchema>;

export const printingStatusSchema = z.object({
  branchCode: z.string().optional(),
  serversOnline: z.number().int().nonnegative(),
  printersOnline: z.number().int().nonnegative(),
  printersOffline: z.number().int().nonnegative(),
  queuePending: z.number().int().nonnegative(),
  queuePrinting: z.number().int().nonnegative(),
  queueFailed: z.number().int().nonnegative(),
  cloudQueueEnabled: z.boolean().default(false),
});
export type PrintingStatus = z.infer<typeof printingStatusSchema>;

/** Socket.IO / realtime event names */
export const PRINT_WS_EVENTS = [
  "printer-online",
  "printer-offline",
  "job-created",
  "job-started",
  "job-completed",
  "job-failed",
  "queue-updated",
  "paper-empty",
  "server-online",
  "server-offline",
] as const;
export type PrintWsEvent = (typeof PRINT_WS_EVENTS)[number];

export const printAlertSchema = z.object({
  id: z.string(),
  type: z.enum([
    "printer_offline",
    "paper_empty",
    "queue_failed",
    "server_offline",
    "job_failed",
  ]),
  branchCode: z.string(),
  message: z.string(),
  printerId: z.string().nullable().optional(),
  jobId: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type PrintAlert = z.infer<typeof printAlertSchema>;

/** Default LAN port for Branch Print Server HTTP API */
export const BRANCH_PRINT_SERVER_DEFAULT_PORT = 9740;

/** UDP discovery magic / service type */
export const BRANCH_PRINT_DISCOVERY_SERVICE = "_pops-print._tcp.local";
export const BRANCH_PRINT_UDP_PORT = 9741;
export const BRANCH_PRINT_UDP_MAGIC = "POPS_PRINT_DISCOVER_v1";

/** Feature flag key in platform settings */
export const PRINTING_ENTERPRISE_ENABLED_KEY = "printing_enterprise_enabled";
export const PRINTING_CLOUD_QUEUE_ENABLED_KEY = "printing_cloud_queue_enabled";

/** Print path priority for failover */
export const PRINT_PATH_PRIORITY = [
  "direct_ip",
  "branch_server",
  "windows_shared",
  "local_usb",
  "cloud_sync",
] as const;
export type PrintPathPriority = (typeof PRINT_PATH_PRIORITY)[number];
