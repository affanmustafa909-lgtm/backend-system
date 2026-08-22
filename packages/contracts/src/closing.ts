import { z } from "zod";

export const closingChecklistItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  done: z.boolean(),
  hint: z.string().optional(),
});

export const closingCashSessionSchema = z.object({
  id: z.string().uuid(),
  sessionRef: z.string(),
  openingFloat: z.number(),
  expectedCash: z.number().nullable(),
  countedCash: z.number().nullable(),
  variance: z.number().nullable(),
  status: z.enum(["open", "closed"]),
  closedAt: z.string().nullable(),
});

export const closingShiftSummarySchema = z.object({
  todaySales: z.number(),
  cashInHand: z.number(),
  profitLoss: z.number(),
  netProfit: z.number(),
  orderCount: z.number(),
});

export const closingZReportSchema = z.object({
  reportRef: z.string(),
  generatedAt: z.string(),
  businessDate: z.string(),
  totalSales: z.number(),
  orderCount: z.number(),
  cashSales: z.number(),
  cardSales: z.number(),
  taxCollected: z.number(),
  cashSessionRef: z.string().nullable(),
  cashVariance: z.number().nullable(),
});

export const closingStatusSchema = z.object({
  branchCode: z.string(),
  businessDate: z.string(),
  ordersPaused: z.boolean(),
  shiftSummary: closingShiftSummarySchema,
  checklist: z.array(closingChecklistItemSchema),
  openCashSession: closingCashSessionSchema.nullable(),
  closedSessionsToday: z.array(closingCashSessionSchema),
  blockers: z.array(z.string()),
  canCloseDay: z.boolean(),
  lastZReport: closingZReportSchema.nullable(),
  lastBackupAt: z.string().nullable(),
  lastBackupRef: z.string().nullable(),
  lastDayClosedAt: z.string().nullable(),
});

export const closeDayResultSchema = z.object({
  businessDate: z.string(),
  closedAt: z.string(),
  nextBusinessDate: z.string(),
  zReportRef: z.string(),
  recordId: z.string().uuid(),
});

export const branchCodeBodySchema = z.object({
  branchCode: z.string().min(1),
  /** When true, pause-orders acts as resume (compat for older clients / missing resume route). */
  resume: z.boolean().optional(),
});

export type ClosingStatus = z.infer<typeof closingStatusSchema>;
export type ClosingZReport = z.infer<typeof closingZReportSchema>;
export type CloseDayResult = z.infer<typeof closeDayResultSchema>;
