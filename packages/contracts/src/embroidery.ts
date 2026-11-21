import { z } from "zod";

export const EMBROIDERY_JOB_STAGES = [
  "draft",
  "digitizing",
  "framing",
  "stitching",
  "qc",
  "finishing",
  "packing",
  "ready",
  "delivered",
  "cancelled",
] as const;
export const embroideryJobStageSchema = z.enum(EMBROIDERY_JOB_STAGES);
export type EmbroideryJobStage = z.infer<typeof embroideryJobStageSchema>;

export const EMBROIDERY_MACHINE_STATUSES = [
  "idle",
  "running",
  "maintenance",
  "offline",
] as const;
export const embroideryMachineStatusSchema = z.enum(EMBROIDERY_MACHINE_STATUSES);
export type EmbroideryMachineStatus = z.infer<typeof embroideryMachineStatusSchema>;

export const EMBROIDERY_QC_RESULTS = ["pass", "fail", "rework"] as const;
export const embroideryQcResultSchema = z.enum(EMBROIDERY_QC_RESULTS);
export type EmbroideryQcResult = z.infer<typeof embroideryQcResultSchema>;

export const EMBROIDERY_CUSTOMER_ORDER_STATUSES = [
  "draft",
  "confirmed",
  "in_production",
  "completed",
  "cancelled",
] as const;
export const embroideryCustomerOrderStatusSchema = z.enum(EMBROIDERY_CUSTOMER_ORDER_STATUSES);
export type EmbroideryCustomerOrderStatus = z.infer<typeof embroideryCustomerOrderStatusSchema>;

export const EMBROIDERY_YES_NO = ["yes", "no"] as const;
export const embroideryYesNoSchema = z.enum(EMBROIDERY_YES_NO);
export type EmbroideryYesNo = z.infer<typeof embroideryYesNoSchema>;

export const embroideryDesignSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  customerId: z.string().uuid().nullable(),
  stitchCount: z.number().int().nonnegative(),
  colorways: z.string().nullable(),
  fileName: z.string().nullable(),
  /** True when a DST/EMB (or other) file blob is stored; content returned via download endpoint. */
  hasFile: z.boolean(),
  fileMimeType: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EmbroideryDesign = z.infer<typeof embroideryDesignSchema>;

/** Max ~2.5MB base64 (~1.8MB binary) — typical DST/EMB digitizer files. */
const designFileBase64Schema = z
  .string()
  .max(3_500_000)
  .regex(/^[A-Za-z0-9+/=\s]*$/, "Invalid base64")
  .optional()
  .nullable();

export const createEmbroideryDesignSchema = z.object({
  branchId: z.string().uuid(),
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  customerId: z.string().uuid().optional().nullable(),
  stitchCount: z.number().int().nonnegative().default(0),
  colorways: z.string().max(2000).optional().nullable(),
  fileName: z.string().max(260).optional().nullable(),
  fileContentBase64: designFileBase64Schema,
  fileMimeType: z.string().max(120).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  widthMm: z.number().int().nonnegative().default(0),
  heightMm: z.number().int().nonnegative().default(0),
  hoop: z.string().max(80).optional().nullable(),
  workType: z.enum(["flat", "sequin", "cording", "mixed"]).default("flat"),
  threadBrand: z.string().max(80).optional().nullable(),
  ratePer1kPkr: z.number().int().nonnegative().default(0),
  needleChartJson: z.string().max(20000).optional().nullable(),
  previewBase64: designFileBase64Schema,
  previewMimeType: z.string().max(120).optional().nullable(),
  aiAnalysisJson: z.string().max(50000).optional().nullable(),
  detailsJson: z.string().max(20000).optional().nullable(),
});
export type CreateEmbroideryDesign = z.infer<typeof createEmbroideryDesignSchema>;

export const updateEmbroideryDesignSchema = createEmbroideryDesignSchema
  .omit({ branchId: true })
  .partial();
export type UpdateEmbroideryDesign = z.infer<typeof updateEmbroideryDesignSchema>;

export const embroideryDesignFileSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string().nullable(),
  fileMimeType: z.string().nullable(),
  fileContentBase64: z.string(),
});
export type EmbroideryDesignFile = z.infer<typeof embroideryDesignFileSchema>;

export const embroideryMachineSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  heads: z.number().int().positive(),
  status: embroideryMachineStatusSchema,
  operatorUserId: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EmbroideryMachine = z.infer<typeof embroideryMachineSchema>;

export const createEmbroideryMachineSchema = z.object({
  branchId: z.string().uuid(),
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  heads: z.number().int().positive().default(1),
  status: embroideryMachineStatusSchema.default("idle"),
  operatorUserId: z.string().uuid().optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  brand: z.string().max(80).optional().nullable(),
  model: z.string().max(80).optional().nullable(),
  serialNumber: z.string().max(80).optional().nullable(),
  needlesPerHead: z.number().int().positive().default(15),
  maxRpm: z.number().int().nonnegative().default(0),
  hoopSizes: z.string().max(200).optional().nullable(),
  attachments: z.string().max(200).optional().nullable(),
  powerStatus: z.enum(["ok", "fault", "off"]).default("ok"),
  feedStatus: z.enum(["ok", "low", "jam", "off"]).default("ok"),
  beamBufferNotes: z.string().max(1000).optional().nullable(),
  factoryOperatorId: z.string().uuid().optional().nullable(),
  currentDesignId: z.string().uuid().optional().nullable(),
  locationBay: z.string().max(80).optional().nullable(),
  lastServiceDate: z.string().max(32).optional().nullable(),
  nextServiceDate: z.string().max(32).optional().nullable(),
  runHours: z.number().int().nonnegative().default(0),
  stitchCounter: z.number().int().nonnegative().default(0),
  detailsJson: z.string().max(20000).optional().nullable(),
});
export type CreateEmbroideryMachine = z.infer<typeof createEmbroideryMachineSchema>;

export const updateEmbroideryMachineSchema = createEmbroideryMachineSchema
  .omit({ branchId: true })
  .partial();
export type UpdateEmbroideryMachine = z.infer<typeof updateEmbroideryMachineSchema>;

export const embroideryCustomerOrderSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  orderNumber: z.string(),
  customerId: z.string().uuid(),
  designId: z.string().uuid().nullable(),
  status: embroideryCustomerOrderStatusSchema,
  dueDate: z.string().nullable(),
  quantity: z.number().int().positive(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EmbroideryCustomerOrder = z.infer<typeof embroideryCustomerOrderSchema>;

export const createEmbroideryCustomerOrderSchema = z.object({
  branchId: z.string().uuid(),
  orderNumber: z.string().min(1).max(64).optional(),
  customerId: z.string().uuid(),
  designId: z.string().uuid().optional().nullable(),
  status: embroideryCustomerOrderStatusSchema.default("draft"),
  dueDate: z.string().optional().nullable(),
  quantity: z.number().int().positive().default(1),
  notes: z.string().max(4000).optional().nullable(),
});
export type CreateEmbroideryCustomerOrder = z.infer<typeof createEmbroideryCustomerOrderSchema>;

export const updateEmbroideryCustomerOrderSchema = z.object({
  customerId: z.string().uuid().optional(),
  designId: z.string().uuid().optional().nullable(),
  status: embroideryCustomerOrderStatusSchema.optional(),
  dueDate: z.string().optional().nullable(),
  quantity: z.number().int().positive().optional(),
  notes: z.string().max(4000).optional().nullable(),
});
export type UpdateEmbroideryCustomerOrder = z.infer<typeof updateEmbroideryCustomerOrderSchema>;

export const listEmbroideryCustomerOrdersQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  status: embroideryCustomerOrderStatusSchema.optional(),
  customerId: z.string().uuid().optional(),
});
export type ListEmbroideryCustomerOrdersQuery = z.infer<
  typeof listEmbroideryCustomerOrdersQuerySchema
>;

export const embroideryJobLineSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  sizeLabel: z.string(),
  colorLabel: z.string(),
  quantity: z.number().int().positive(),
  completedQty: z.number().int().nonnegative(),
});
export type EmbroideryJobLine = z.infer<typeof embroideryJobLineSchema>;

export const embroideryJobSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  jobNumber: z.string(),
  customerId: z.string().uuid().nullable(),
  customerOrderId: z.string().uuid().nullable(),
  designId: z.string().uuid().nullable(),
  machineId: z.string().uuid().nullable(),
  operatorUserId: z.string().uuid().nullable(),
  stage: embroideryJobStageSchema,
  dueDate: z.string().nullable(),
  pieceRatePkr: z.number().int().nonnegative(),
  materialCostPkr: z.number().int().nonnegative(),
  laborCostPkr: z.number().int().nonnegative(),
  overheadCostPkr: z.number().int().nonnegative(),
  invoiceAmountPkr: z.number().int().nonnegative(),
  invoiceRef: z.string().nullable(),
  notes: z.string().nullable(),
  inwardChallanId: z.string().uuid().nullable().optional(),
  factoryOperatorId: z.string().uuid().nullable().optional(),
  priority: z.enum(["low", "normal", "high", "rush"]).optional(),
  needleChartJson: z.string().nullable().optional(),
  detailsJson: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lines: z.array(embroideryJobLineSchema).default([]),
});
export type EmbroideryJob = z.infer<typeof embroideryJobSchema>;

export const createEmbroideryJobLineSchema = z.object({
  sizeLabel: z.string().min(1).max(64),
  colorLabel: z.string().min(1).max(64).default("Default"),
  quantity: z.number().int().positive(),
});

export const createEmbroideryJobSchema = z.object({
  branchId: z.string().uuid(),
  jobNumber: z.string().min(1).max(64).optional(),
  customerId: z.string().uuid().optional().nullable(),
  customerOrderId: z.string().uuid().optional().nullable(),
  designId: z.string().uuid().optional().nullable(),
  machineId: z.string().uuid().optional().nullable(),
  operatorUserId: z.string().uuid().optional().nullable(),
  stage: embroideryJobStageSchema.default("draft"),
  dueDate: z.string().optional().nullable(),
  pieceRatePkr: z.number().int().nonnegative().default(0),
  materialCostPkr: z.number().int().nonnegative().default(0),
  laborCostPkr: z.number().int().nonnegative().default(0),
  overheadCostPkr: z.number().int().nonnegative().default(0),
  invoiceAmountPkr: z.number().int().nonnegative().default(0),
  invoiceRef: z.string().max(128).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  inwardChallanId: z.string().uuid().optional().nullable(),
  factoryOperatorId: z.string().uuid().optional().nullable(),
  priority: z.enum(["low", "normal", "high", "rush"]).default("normal"),
  needleChartJson: z.string().max(20000).optional().nullable(),
  detailsJson: z.string().max(20000).optional().nullable(),
  lines: z.array(createEmbroideryJobLineSchema).min(1),
});
export type CreateEmbroideryJob = z.infer<typeof createEmbroideryJobSchema>;

export const updateEmbroideryJobSchema = z.object({
  customerId: z.string().uuid().optional().nullable(),
  customerOrderId: z.string().uuid().optional().nullable(),
  designId: z.string().uuid().optional().nullable(),
  machineId: z.string().uuid().optional().nullable(),
  operatorUserId: z.string().uuid().optional().nullable(),
  stage: embroideryJobStageSchema.optional(),
  dueDate: z.string().optional().nullable(),
  pieceRatePkr: z.number().int().nonnegative().optional(),
  materialCostPkr: z.number().int().nonnegative().optional(),
  laborCostPkr: z.number().int().nonnegative().optional(),
  overheadCostPkr: z.number().int().nonnegative().optional(),
  invoiceAmountPkr: z.number().int().nonnegative().optional(),
  invoiceRef: z.string().max(128).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  inwardChallanId: z.string().uuid().optional().nullable(),
  factoryOperatorId: z.string().uuid().optional().nullable(),
  priority: z.enum(["low", "normal", "high", "rush"]).optional(),
  needleChartJson: z.string().max(20000).optional().nullable(),
  detailsJson: z.string().max(20000).optional().nullable(),
});
export type UpdateEmbroideryJob = z.infer<typeof updateEmbroideryJobSchema>;

export const embroideryJobCostingSchema = z.object({
  material: z.number().int().nonnegative(),
  labor: z.number().int().nonnegative(),
  overhead: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  invoiceAmount: z.number().int().nonnegative(),
});
export type EmbroideryJobCosting = z.infer<typeof embroideryJobCostingSchema>;

export const embroideryMaterialIssueSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  jobId: z.string().uuid(),
  productId: z.string().uuid().nullable(),
  itemName: z.string(),
  quantity: z.number().positive(),
  unit: z.string(),
  customerOwned: embroideryYesNoSchema,
  unitCostPkr: z.number().int().nonnegative(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});
export type EmbroideryMaterialIssue = z.infer<typeof embroideryMaterialIssueSchema>;

export const createEmbroideryMaterialIssueSchema = z.object({
  branchId: z.string().uuid(),
  jobId: z.string().uuid(),
  productId: z.string().uuid().optional().nullable(),
  itemName: z.string().min(1).max(200),
  quantity: z.number().positive(),
  unit: z.string().min(1).max(32).default("pc"),
  customerOwned: embroideryYesNoSchema.default("no"),
  unitCostPkr: z.number().int().nonnegative().default(0),
  notes: z.string().max(2000).optional().nullable(),
  factoryItemId: z.string().uuid().optional().nullable(),
  lotNumber: z.string().max(80).optional().nullable(),
  purpose: z.string().max(200).optional().nullable(),
  returnable: embroideryYesNoSchema.default("no"),
  issuedBy: z.string().max(120).optional().nullable(),
});
export type CreateEmbroideryMaterialIssue = z.infer<typeof createEmbroideryMaterialIssueSchema>;

export const embroideryQcRecordSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  jobId: z.string().uuid(),
  result: embroideryQcResultSchema,
  defectCode: z.string().nullable(),
  quantity: z.number().int().positive(),
  notes: z.string().nullable(),
  claimSide: z.string().optional(),
  disposition: z.string().optional(),
  detailsJson: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type EmbroideryQcRecord = z.infer<typeof embroideryQcRecordSchema>;

export const createEmbroideryQcRecordSchema = z.object({
  branchId: z.string().uuid(),
  jobId: z.string().uuid(),
  result: embroideryQcResultSchema,
  defectCode: z.string().max(64).optional().nullable(),
  quantity: z.number().int().positive().default(1),
  notes: z.string().max(2000).optional().nullable(),
  claimSide: z.enum(["party", "operator", "other"]).default("operator"),
  disposition: z.enum(["rework", "scrap", "return", "pass"]).default("rework"),
  detailsJson: z.string().max(20000).optional().nullable(),
});
export type CreateEmbroideryQcRecord = z.infer<typeof createEmbroideryQcRecordSchema>;

export const embroideryDeliverySchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  jobId: z.string().uuid(),
  challanNumber: z.string(),
  deliveredQty: z.number().int().positive(),
  deliveredAt: z.string(),
  invoiceRef: z.string().nullable(),
  invoiceAmountPkr: z.number().int().nonnegative(),
  notes: z.string().nullable(),
  vehicle: z.string().nullable().optional(),
  driverName: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type EmbroideryDelivery = z.infer<typeof embroideryDeliverySchema>;

export const createEmbroideryDeliverySchema = z.object({
  branchId: z.string().uuid(),
  jobId: z.string().uuid(),
  challanNumber: z.string().min(1).max(64).optional(),
  deliveredQty: z.number().int().positive(),
  deliveredAt: z.string().optional(),
  invoiceRef: z.string().max(128).optional().nullable(),
  invoiceAmountPkr: z.number().int().nonnegative().default(0),
  /** Legacy flag — factory books use job bills / party ledger; restaurant AR posting is disabled. */
  postInvoiceToAccounting: z.boolean().optional().default(false),
  notes: z.string().max(2000).optional().nullable(),
  vehicle: z.string().max(120).optional().nullable(),
  driverName: z.string().max(120).optional().nullable(),
});
export type CreateEmbroideryDelivery = z.infer<typeof createEmbroideryDeliverySchema>;

export const embroideryPieceRateEntrySchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  jobId: z.string().uuid(),
  operatorUserId: z.string().uuid().nullable(),
  pieces: z.number().int().positive(),
  ratePkr: z.number().int().nonnegative(),
  amountPkr: z.number().int().nonnegative(),
  workDate: z.string(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});
export type EmbroideryPieceRateEntry = z.infer<typeof embroideryPieceRateEntrySchema>;

export const createEmbroideryPieceRateEntrySchema = z.object({
  branchId: z.string().uuid(),
  jobId: z.string().uuid(),
  operatorUserId: z.string().uuid().optional().nullable(),
  pieces: z.number().int().positive(),
  ratePkr: z.number().int().nonnegative(),
  workDate: z.string().optional(),
  notes: z.string().max(2000).optional().nullable(),
});
export type CreateEmbroideryPieceRateEntry = z.infer<typeof createEmbroideryPieceRateEntrySchema>;

export const embroideryProductionLogSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  jobId: z.string().uuid(),
  machineId: z.string().uuid().nullable(),
  operatorUserId: z.string().uuid().nullable(),
  stage: embroideryJobStageSchema,
  piecesCompleted: z.number().int().nonnegative(),
  hoursWorked: z.number().nonnegative(),
  notes: z.string().nullable(),
  loggedAt: z.string(),
});
export type EmbroideryProductionLog = z.infer<typeof embroideryProductionLogSchema>;

export const createEmbroideryProductionLogSchema = z.object({
  branchId: z.string().uuid(),
  jobId: z.string().uuid(),
  machineId: z.string().uuid().optional().nullable(),
  operatorUserId: z.string().uuid().optional().nullable(),
  stage: embroideryJobStageSchema,
  piecesCompleted: z.number().int().nonnegative().default(0),
  hoursWorked: z.number().nonnegative().default(0),
  notes: z.string().max(2000).optional().nullable(),
  loggedAt: z.string().optional(),
  stitches: z.number().int().nonnegative().default(0),
  frames: z.number().int().nonnegative().default(0),
  threadBreaks: z.number().int().nonnegative().default(0),
  runMinutes: z.number().int().nonnegative().default(0),
  stopMinutes: z.number().int().nonnegative().default(0),
  factoryOperatorId: z.string().uuid().optional().nullable(),
});
export type CreateEmbroideryProductionLog = z.infer<typeof createEmbroideryProductionLogSchema>;

export const listEmbroideryProductionLogsQuerySchema = z.object({
  jobId: z.string().uuid().optional(),
  machineId: z.string().uuid().optional(),
});
export type ListEmbroideryProductionLogsQuery = z.infer<
  typeof listEmbroideryProductionLogsQuerySchema
>;

export const embroideryProductionBoardSchema = z.object({
  stages: z.array(
    z.object({
      stage: embroideryJobStageSchema,
      count: z.number().int().nonnegative(),
      jobs: z.array(embroideryJobSchema),
    }),
  ),
  machines: z.array(embroideryMachineSchema),
});
export type EmbroideryProductionBoard = z.infer<typeof embroideryProductionBoardSchema>;

export const EMBROIDERY_PERMISSIONS = [
  "embroidery.read",
  "embroidery.manage",
  "embroidery.production",
  "embroidery.qc",
  "embroidery.delivery",
] as const;
