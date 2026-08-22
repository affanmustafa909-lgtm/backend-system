import { z } from "zod";

export const branchOverviewRowSchema = z.object({
  branchId: z.string().uuid(),
  branchCode: z.string(),
  branchName: z.string(),
  city: z.string(),
  salesTodayPkr: z.number(),
  salesChangePct: z.number(),
  activeOrders: z.number(),
  kitchenQueue: z.number(),
  inventoryAlerts: z.number(),
  syncStatus: z.enum(["live", "idle"]),
  syncLabel: z.string(),
});

export const multiBranchOverviewSchema = z.object({
  consolidated: z.object({
    branchCount: z.number(),
    salesTodayPkr: z.number(),
    activeOrders: z.number(),
    inventoryAlerts: z.number(),
    pendingTransfers: z.number(),
  }),
  branches: z.array(branchOverviewRowSchema),
});

export const branchTransferSchema = z.object({
  id: z.string().uuid(),
  transferRef: z.string(),
  fromBranchCode: z.string(),
  fromBranchName: z.string(),
  toBranchCode: z.string(),
  toBranchName: z.string(),
  ingredientSku: z.string(),
  ingredientName: z.string(),
  qty: z.number(),
  unit: z.string(),
  status: z.enum(["pending", "dispatched", "received", "cancelled"]),
  notes: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  dispatchedAt: z.string().nullable(),
  receivedAt: z.string().nullable(),
});

export const createBranchTransferSchema = z.object({
  fromBranchCode: z.string().min(1),
  toBranchCode: z.string().min(1),
  ingredientId: z.string().uuid(),
  qty: z.number().int().positive(),
  notes: z.string().max(500).optional(),
});

export const updateBranchTransferSchema = z.object({
  status: z.enum(["dispatched", "received", "cancelled"]),
});

export const manualBranchReceiveSchema = z.object({
  toBranchCode: z.string().min(1),
  fromBranchCode: z.string().min(1),
  ingredientId: z.string().uuid().optional(),
  ingredientName: z.string().min(1).max(120),
  ingredientSku: z.string().min(1).max(32),
  unit: z.string().min(1).max(16),
  qty: z.number().int().positive(),
  notes: z.string().max(500).optional(),
});

export const branchPricingRowSchema = z.object({
  menuItemId: z.string().uuid(),
  itemName: z.string(),
  categoryName: z.string(),
  branchCode: z.string(),
  branchName: z.string(),
  basePricePkr: z.number(),
  overridePricePkr: z.number().nullable(),
  effectivePricePkr: z.number(),
});

export const setBranchPriceOverrideSchema = z.object({
  branchCode: z.string().min(1),
  menuItemId: z.string().uuid(),
  pricePkr: z.number().int().nonnegative(),
  notes: z.string().max(200).optional(),
});

export const copyBranchPricingSchema = z.object({
  fromBranchCode: z.string().min(1),
  toBranchCode: z.string().min(1),
});

export const consolidatedReportSchema = z.object({
  periodLabel: z.string(),
  branches: z.array(
    z.object({
      branchCode: z.string(),
      branchName: z.string(),
      salesPkr: z.number(),
      orderCount: z.number(),
      avgTicketPkr: z.number(),
      activeStaff: z.number(),
    }),
  ),
  totals: z.object({
    salesPkr: z.number(),
    orderCount: z.number(),
  }),
});

export type BranchOverviewRow = z.infer<typeof branchOverviewRowSchema>;
export type MultiBranchOverview = z.infer<typeof multiBranchOverviewSchema>;
export type BranchTransfer = z.infer<typeof branchTransferSchema>;
export type CreateBranchTransfer = z.infer<typeof createBranchTransferSchema>;
export type UpdateBranchTransfer = z.infer<typeof updateBranchTransferSchema>;
export type ManualBranchReceive = z.infer<typeof manualBranchReceiveSchema>;
export type BranchPricingRow = z.infer<typeof branchPricingRowSchema>;
export type SetBranchPriceOverride = z.infer<typeof setBranchPriceOverrideSchema>;
export type CopyBranchPricing = z.infer<typeof copyBranchPricingSchema>;
export type ConsolidatedReport = z.infer<typeof consolidatedReportSchema>;
