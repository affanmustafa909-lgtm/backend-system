import { z } from "zod";

export const factoryPartyKindSchema = z.enum(["customer", "vendor", "both"]);
export const factoryItemCategorySchema = z.enum([
  "thread",
  "backing",
  "sequin",
  "fabric",
  "fg",
  "other",
]);
export const factoryShiftSchema = z.enum(["day", "night"]);

export const createFactoryPartySchema = z.object({
  branchId: z.string().uuid().optional().nullable(),
  kind: factoryPartyKindSchema.default("customer"),
  code: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(200),
  phone: z.string().max(40).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  gstin: z.string().max(32).optional().nullable(),
  ntnCnic: z.string().max(40).optional().nullable(),
  whatsapp: z.string().max(40).optional().nullable(),
  city: z.string().max(80).optional().nullable(),
  billingAddress: z.string().max(500).optional().nullable(),
  shippingAddress: z.string().max(500).optional().nullable(),
  contactPersons: z.string().max(1000).optional().nullable(),
  paymentTerms: z.string().max(200).optional().nullable(),
  creditLimitPkr: z.number().int().nonnegative().default(0),
  openingBalancePkr: z.number().int().default(0),
  rateType: z.enum(["stitch", "piece"]).default("stitch"),
  defaultStitchRatePkr: z.number().int().nonnegative().default(0),
  industrySegment: z.string().max(80).optional().nullable(),
  bankDetails: z.string().max(1000).optional().nullable(),
  detailsJson: z.string().max(20000).optional().nullable(),
});
export type CreateFactoryParty = z.infer<typeof createFactoryPartySchema>;

export const factoryPartySchema = createFactoryPartySchema.extend({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid().nullable(),
  code: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FactoryParty = z.infer<typeof factoryPartySchema>;

export const createFactoryItemSchema = z.object({
  branchId: z.string().uuid(),
  sku: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(200),
  category: factoryItemCategorySchema.default("thread"),
  unit: z.string().min(1).max(32).default("pcs"),
  reorderLevel: z.number().int().nonnegative().default(0),
  unitCostPkr: z.number().int().nonnegative().default(0),
  notes: z.string().max(2000).optional().nullable(),
  brand: z.string().max(80).optional().nullable(),
  colour: z.string().max(80).optional().nullable(),
  sizeLabel: z.string().max(80).optional().nullable(),
  location: z.string().max(120).optional().nullable(),
  supplierPartyId: z.string().uuid().optional().nullable(),
  batchLot: z.string().max(80).optional().nullable(),
  detailsJson: z.string().max(20000).optional().nullable(),
});
export type CreateFactoryItem = z.infer<typeof createFactoryItemSchema>;

export const factoryItemSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  category: factoryItemCategorySchema,
  unit: z.string(),
  reorderLevel: z.number().int(),
  unitCostPkr: z.number().int(),
  active: z.string(),
  notes: z.string().nullable(),
  brand: z.string().nullable().optional(),
  colour: z.string().nullable().optional(),
  sizeLabel: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  supplierPartyId: z.string().uuid().nullable().optional(),
  batchLot: z.string().nullable().optional(),
  qtyOnHand: z.number().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FactoryItem = z.infer<typeof factoryItemSchema>;

export const factoryStockTxnSchema = z.object({
  branchId: z.string().uuid(),
  itemId: z.string().uuid(),
  txnType: z.enum(["grn", "issue", "adjust", "return"]),
  qtyDelta: z.number(),
  notes: z.string().max(2000).optional().nullable(),
  refType: z.string().optional().nullable(),
  refId: z.string().uuid().optional().nullable(),
});
export type FactoryStockTxn = z.infer<typeof factoryStockTxnSchema>;

export const factoryInwardLineInputSchema = z.object({
  description: z.string().min(1).max(300),
  designId: z.string().uuid().optional().nullable(),
  qty: z.number().int().positive().default(1),
  unit: z.string().default("pcs"),
  colour: z.string().max(80).optional().nullable(),
  fabric: z.string().max(120).optional().nullable(),
  lotNumber: z.string().max(80).optional().nullable(),
  conditionNote: z.string().max(500).optional().nullable(),
});

export const createFactoryInwardChallanSchema = z.object({
  branchId: z.string().uuid(),
  cnNumber: z.string().min(1).max(64).optional(),
  partyId: z.string().uuid(),
  challanDate: z.string().min(8).max(32),
  notes: z.string().max(2000).optional().nullable(),
  partyCnNumber: z.string().max(64).optional().nullable(),
  vehicle: z.string().max(120).optional().nullable(),
  receivedBy: z.string().max(120).optional().nullable(),
  lines: z.array(factoryInwardLineInputSchema).min(1),
});
export type CreateFactoryInwardChallan = z.infer<typeof createFactoryInwardChallanSchema>;

export const factoryInwardChallanSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  cnNumber: z.string(),
  partyId: z.string(),
  partyName: z.string().optional(),
  challanDate: z.string(),
  status: z.string(),
  notes: z.string().nullable(),
  partyCnNumber: z.string().nullable().optional(),
  vehicle: z.string().nullable().optional(),
  receivedBy: z.string().nullable().optional(),
  lines: z
    .array(
      z.object({
        id: z.string().uuid(),
        description: z.string(),
        designId: z.string().uuid().nullable(),
        qty: z.number().int(),
        unit: z.string(),
        colour: z.string().nullable(),
        qtyDispatched: z.number().int(),
        fabric: z.string().nullable().optional(),
        lotNumber: z.string().nullable().optional(),
        conditionNote: z.string().nullable().optional(),
      }),
    )
    .default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FactoryInwardChallan = z.infer<typeof factoryInwardChallanSchema>;

export const createFactoryOutwardChallanSchema = z.object({
  branchId: z.string().uuid(),
  cnNumber: z.string().min(1).max(64).optional(),
  partyId: z.string().uuid(),
  inwardChallanId: z.string().uuid().optional().nullable(),
  jobId: z.string().uuid().optional().nullable(),
  challanDate: z.string().min(8).max(32),
  invoiceAmountPkr: z.number().int().nonnegative().default(0),
  notes: z.string().max(2000).optional().nullable(),
  vehicle: z.string().max(120).optional().nullable(),
  driverName: z.string().max(120).optional().nullable(),
  ewayRef: z.string().max(120).optional().nullable(),
  lines: z
    .array(
      z.object({
        inwardLineId: z.string().uuid().optional().nullable(),
        description: z.string().min(1).max(300),
        qty: z.number().int().positive().default(1),
        unit: z.string().default("pcs"),
      }),
    )
    .min(1),
});
export type CreateFactoryOutwardChallan = z.infer<typeof createFactoryOutwardChallanSchema>;

export const factoryOutwardChallanSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  cnNumber: z.string(),
  partyId: z.string(),
  partyName: z.string().optional(),
  inwardChallanId: z.string().uuid().nullable(),
  jobId: z.string().uuid().nullable(),
  challanDate: z.string(),
  status: z.string(),
  invoiceAmountPkr: z.number().int(),
  notes: z.string().nullable(),
  vehicle: z.string().nullable().optional(),
  driverName: z.string().nullable().optional(),
  ewayRef: z.string().nullable().optional(),
  lines: z
    .array(
      z.object({
        id: z.string().uuid(),
        inwardLineId: z.string().uuid().nullable(),
        description: z.string(),
        qty: z.number().int(),
        unit: z.string(),
      }),
    )
    .default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FactoryOutwardChallan = z.infer<typeof factoryOutwardChallanSchema>;

export const createFactoryOperatorSchema = z.object({
  branchId: z.string().uuid(),
  code: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(200),
  phone: z.string().max(40).optional().nullable(),
  ratePer1kStitchesPkr: z.number().int().nonnegative().default(0),
  ratePerPiecePkr: z.number().int().nonnegative().default(0),
  notes: z.string().max(2000).optional().nullable(),
  cnic: z.string().max(40).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  joinDate: z.string().max(32).optional().nullable(),
  payType: z.enum(["piece", "fixed"]).default("piece"),
  bankDetails: z.string().max(1000).optional().nullable(),
  photoBase64: z.string().max(500_000).optional().nullable(),
  detailsJson: z.string().max(20000).optional().nullable(),
});
export type CreateFactoryOperator = z.infer<typeof createFactoryOperatorSchema>;

export const factoryOperatorSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  ratePer1kStitchesPkr: z.number().int(),
  ratePerPiecePkr: z.number().int(),
  active: z.string(),
  notes: z.string().nullable(),
  cnic: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  joinDate: z.string().nullable().optional(),
  payType: z.string().optional(),
  bankDetails: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FactoryOperator = z.infer<typeof factoryOperatorSchema>;

export const factoryDailyLineInputSchema = z.object({
  machineId: z.string().uuid().optional().nullable(),
  operatorId: z.string().uuid().optional().nullable(),
  jobId: z.string().uuid().optional().nullable(),
  designId: z.string().uuid().optional().nullable(),
  stitches: z.number().int().nonnegative().default(0),
  frames: z.number().int().nonnegative().default(0),
  pieces: z.number().int().nonnegative().default(0),
  downtimeMinutes: z.number().int().nonnegative().default(0),
  bonusPkr: z.number().int().nonnegative().default(0),
  threadBreaks: z.number().int().nonnegative().default(0),
  runMinutes: z.number().int().nonnegative().default(0),
  stopReason: z.string().max(200).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

export const createFactoryDailySheetSchema = z.object({
  branchId: z.string().uuid(),
  sheetDate: z.string().min(8).max(32),
  shift: factoryShiftSchema.default("day"),
  notes: z.string().max(2000).optional().nullable(),
  lines: z.array(factoryDailyLineInputSchema).default([]),
});
export type CreateFactoryDailySheet = z.infer<typeof createFactoryDailySheetSchema>;

export const factoryDailySheetSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  sheetDate: z.string(),
  shift: z.string(),
  status: z.string(),
  notes: z.string().nullable(),
  totalStitches: z.number().int().optional(),
  totalWagePkr: z.number().int().optional(),
  lines: z
    .array(
      z.object({
        id: z.string().uuid(),
        machineId: z.string().uuid().nullable(),
        operatorId: z.string().uuid().nullable(),
        jobId: z.string().uuid().nullable(),
        designId: z.string().uuid().nullable(),
        stitches: z.number().int(),
        frames: z.number().int(),
        pieces: z.number().int(),
        downtimeMinutes: z.number().int(),
        bonusPkr: z.number().int(),
        wagePkr: z.number().int(),
        threadBreaks: z.number().int().optional(),
        runMinutes: z.number().int().optional(),
        stopReason: z.string().nullable().optional(),
        notes: z.string().nullable(),
      }),
    )
    .default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FactoryDailySheet = z.infer<typeof factoryDailySheetSchema>;

export const createFactoryJobBillSchema = z.object({
  branchId: z.string().uuid(),
  billNumber: z.string().min(1).max(64).optional(),
  partyId: z.string().uuid(),
  outwardChallanId: z.string().uuid().optional().nullable(),
  billDate: z.string().min(8).max(32),
  amountPkr: z.number().int().nonnegative(),
  taxPkr: z.number().int().nonnegative().default(0),
  defectDeductionPkr: z.number().int().nonnegative().default(0),
  discountPkr: z.number().int().nonnegative().default(0),
  notes: z.string().max(2000).optional().nullable(),
});
export type CreateFactoryJobBill = z.infer<typeof createFactoryJobBillSchema>;

export const factoryJobBillSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  billNumber: z.string(),
  partyId: z.string(),
  partyName: z.string().optional(),
  outwardChallanId: z.string().uuid().nullable(),
  billDate: z.string(),
  amountPkr: z.number().int(),
  taxPkr: z.number().int().optional(),
  defectDeductionPkr: z.number().int().optional(),
  discountPkr: z.number().int().optional(),
  status: z.string(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FactoryJobBill = z.infer<typeof factoryJobBillSchema>;

export const createFactoryLedgerEntrySchema = z.object({
  branchId: z.string().uuid(),
  entryDate: z.string().min(8).max(32),
  accountKind: z.enum(["party", "cash", "bank", "expense"]),
  partyId: z.string().uuid().optional().nullable(),
  debitPkr: z.number().int().nonnegative().default(0),
  creditPkr: z.number().int().nonnegative().default(0),
  narration: z.string().max(2000).optional().nullable(),
  refType: z.string().optional().nullable(),
  refId: z.string().uuid().optional().nullable(),
});
export type CreateFactoryLedgerEntry = z.infer<typeof createFactoryLedgerEntrySchema>;

export const factoryLedgerEntrySchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  entryDate: z.string(),
  accountKind: z.string(),
  partyId: z.string().uuid().nullable(),
  partyName: z.string().optional().nullable(),
  debitPkr: z.number().int(),
  creditPkr: z.number().int(),
  narration: z.string().nullable(),
  refType: z.string().nullable(),
  refId: z.string().uuid().nullable(),
  createdAt: z.string(),
});
export type FactoryLedgerEntry = z.infer<typeof factoryLedgerEntrySchema>;

export const createFactoryOperatorAdvanceSchema = z.object({
  branchId: z.string().uuid(),
  operatorId: z.string().uuid(),
  advanceDate: z.string().min(8).max(32),
  amountPkr: z.number().int().positive(),
  notes: z.string().max(2000).optional().nullable(),
});
export type CreateFactoryOperatorAdvance = z.infer<typeof createFactoryOperatorAdvanceSchema>;

export const createFactoryPrinterProfileSchema = z.object({
  branchId: z.string().uuid(),
  name: z.string().min(1).max(120),
  printerType: z.enum(["thermal", "a4", "plotter"]).default("thermal"),
  paperWidthMm: z.number().int().positive().default(80),
  copies: z.number().int().positive().default(1),
  defaultFor: z.enum(["cn", "receipt", "label", "bill"]).default("cn"),
  margins: z.string().max(120).optional().nullable(),
  detailsJson: z.string().max(5000).optional().nullable(),
});
export type CreateFactoryPrinterProfile = z.infer<typeof createFactoryPrinterProfileSchema>;

export const createFactoryPrintJobSchema = z.object({
  branchId: z.string().uuid(),
  jobNumber: z.string().min(1).max(64).optional(),
  partyId: z.string().uuid().optional().nullable(),
  designId: z.string().uuid().optional().nullable(),
  embroideryJobId: z.string().uuid().optional().nullable(),
  printType: z.enum(["dtf", "screen", "heat", "plotter"]).default("dtf"),
  sizeLabel: z.string().max(80).optional().nullable(),
  qty: z.number().int().positive().default(1),
  printerProfileId: z.string().uuid().optional().nullable(),
  status: z.enum(["draft", "queued", "printing", "done", "cancelled"]).default("draft"),
  notes: z.string().max(2000).optional().nullable(),
});
export type CreateFactoryPrintJob = z.infer<typeof createFactoryPrintJobSchema>;

export const createFactoryPackingRecordSchema = z.object({
  branchId: z.string().uuid(),
  jobId: z.string().uuid(),
  cartonNumber: z.string().min(1).max(64),
  pieces: z.number().int().nonnegative().default(0),
  weightKg: z.number().nonnegative().default(0),
  labels: z.string().max(500).optional().nullable(),
  sealNumber: z.string().max(80).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});
export type CreateFactoryPackingRecord = z.infer<typeof createFactoryPackingRecordSchema>;

export const factoryDesignAiAnalyzeSchema = z.object({
  branchId: z.string().uuid(),
  fileName: z.string().max(260).optional().nullable(),
  fileMimeType: z.string().max(120).optional().nullable(),
  fileContentBase64: z.string().min(16).max(3_500_000),
  hint: z.string().max(500).optional().nullable(),
});
export type FactoryDesignAiAnalyze = z.infer<typeof factoryDesignAiAnalyzeSchema>;

export const factoryExtraModuleKindSchema = z.enum([
  "purchase-orders",
  "purchase-receipts",
  "defect-returns",
  "handwork-issue",
  "handwork-return",
  "attendance",
  "leave",
  "thread-consumption",
  "stitch-rates",
  "job-out",
  "expenses",
  "maintenance-logs",
  "salary-slips",
  "eway-records",
  "brokers",
]);
export type FactoryExtraModuleKind = z.infer<typeof factoryExtraModuleKindSchema>;

export const createFactoryExtraRecordSchema = z.object({
  branchId: z.string().uuid().optional().nullable(),
  payload: z.record(z.unknown()),
});
export type CreateFactoryExtraRecord = z.infer<typeof createFactoryExtraRecordSchema>;
