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

export const factoryPartySchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid().nullable(),
  kind: factoryPartyKindSchema,
  code: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FactoryParty = z.infer<typeof factoryPartySchema>;

export const createFactoryPartySchema = z.object({
  branchId: z.string().uuid().optional().nullable(),
  kind: factoryPartyKindSchema.default("customer"),
  code: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(200),
  phone: z.string().max(40).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});
export type CreateFactoryParty = z.infer<typeof createFactoryPartySchema>;

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
  qtyOnHand: z.number().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FactoryItem = z.infer<typeof factoryItemSchema>;

export const createFactoryItemSchema = z.object({
  branchId: z.string().uuid(),
  sku: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(200),
  category: factoryItemCategorySchema.default("thread"),
  unit: z.string().min(1).max(32).default("pcs"),
  reorderLevel: z.number().int().nonnegative().default(0),
  unitCostPkr: z.number().int().nonnegative().default(0),
  notes: z.string().max(2000).optional().nullable(),
});
export type CreateFactoryItem = z.infer<typeof createFactoryItemSchema>;

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
});

export const createFactoryInwardChallanSchema = z.object({
  branchId: z.string().uuid(),
  cnNumber: z.string().min(1).max(64).optional(),
  partyId: z.string().uuid(),
  challanDate: z.string().min(8).max(32),
  notes: z.string().max(2000).optional().nullable(),
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
