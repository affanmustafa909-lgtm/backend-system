import { z } from "zod";
import { storePaymentMethodSchema } from "./store";

export const STORE_MEMBERSHIP_TIERS = ["standard", "silver", "gold", "vip"] as const;
export const storeMembershipTierSchema = z.enum(STORE_MEMBERSHIP_TIERS);

export const STORE_CASH_MOVEMENT_TYPES = ["paid_in", "paid_out"] as const;
export const storeCashMovementTypeSchema = z.enum(STORE_CASH_MOVEMENT_TYPES);

export const STORE_WASTAGE_REASONS = ["expired", "damaged", "lost", "theft", "spoilage"] as const;
export const storeWastageReasonSchema = z.enum(STORE_WASTAGE_REASONS);

export const STORE_COUPON_TYPES = ["percent", "fixed"] as const;
export const storeCouponTypeSchema = z.enum(STORE_COUPON_TYPES);

export const storeCashMovementSchema = z.object({
  id: z.string().uuid(),
  shiftId: z.string().uuid(),
  type: storeCashMovementTypeSchema,
  amountPkr: z.number(),
  reason: z.string(),
  recordedBy: z.string().nullable(),
  createdAt: z.string(),
});

export const createStoreCashMovementSchema = z.object({
  branchCode: z.string().min(1),
  shiftId: z.string().uuid(),
  type: storeCashMovementTypeSchema,
  amountPkr: z.number().min(1),
  reason: z.string().min(1),
  recordedBy: z.string().optional(),
});

export const storeCouponSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  type: storeCouponTypeSchema,
  value: z.number(),
  minPurchasePkr: z.number(),
  isActive: z.boolean(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  usageCount: z.number(),
  maxUses: z.number().nullable(),
});

export const createStoreCouponSchema = z.object({
  branchCode: z.string().min(1),
  code: z.string().min(3),
  name: z.string().min(1),
  type: storeCouponTypeSchema,
  value: z.number().min(1),
  minPurchasePkr: z.number().min(0).default(0),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  maxUses: z.number().min(1).optional(),
});

export const storeGiftCardSchema = z.object({
  id: z.string().uuid(),
  cardNumber: z.string(),
  initialBalancePkr: z.number(),
  balancePkr: z.number(),
  status: z.enum(["active", "depleted", "void"]),
  issuedTo: z.string().nullable(),
  createdAt: z.string(),
});

export const createStoreGiftCardSchema = z.object({
  branchCode: z.string().min(1),
  cardNumber: z.string().min(4),
  initialBalancePkr: z.number().min(100),
  issuedTo: z.string().optional(),
});

export const storeSaleReturnLineSchema = z.object({
  productId: z.string().uuid(),
  productName: z.string(),
  qty: z.number(),
  refundAmount: z.number(),
});

export const storeSaleReturnSchema = z.object({
  id: z.string().uuid(),
  returnNumber: z.string(),
  saleId: z.string().uuid(),
  invoiceNumber: z.string(),
  reason: z.string(),
  refundMethod: storePaymentMethodSchema,
  totalRefund: z.number(),
  lines: z.array(storeSaleReturnLineSchema),
  createdAt: z.string(),
});

export const createStoreSaleReturnSchema = z.object({
  branchCode: z.string().min(1),
  saleId: z.string().uuid(),
  reason: z.string().min(1),
  refundMethod: storePaymentMethodSchema,
  lines: z.array(z.object({ productId: z.string().uuid(), qty: z.number().min(1) })).min(1),
});

export const storePurchaseReturnSchema = z.object({
  id: z.string().uuid(),
  returnNumber: z.string(),
  supplierId: z.string().uuid().nullable(),
  supplierName: z.string().nullable(),
  reason: z.string(),
  totalAmount: z.number(),
  status: z.string(),
  createdAt: z.string(),
});

export const createStorePurchaseReturnSchema = z.object({
  branchCode: z.string().min(1),
  supplierId: z.string().uuid(),
  reason: z.string().min(1),
  items: z.array(z.object({ productId: z.string().uuid(), qty: z.number().min(1), unitPrice: z.number().min(0) })).min(1),
});

export const storePeakHoursReportSchema = z.object({
  periodLabel: z.string(),
  hourlySales: z.array(z.object({ hour: z.number(), label: z.string(), amount: z.number(), transactions: z.number() })),
  peakHours: z.array(z.object({ hour: z.number(), label: z.string(), amount: z.number() })),
  slowHours: z.array(z.object({ hour: z.number(), label: z.string(), amount: z.number() })),
});

export const storeEmployeeReportSchema = z.object({
  periodLabel: z.string(),
  cashiers: z.array(
    z.object({
      cashierName: z.string(),
      shiftCount: z.number(),
      totalSalesPkr: z.number(),
      transactionCount: z.number(),
      avgTicketPkr: z.number(),
    }),
  ),
});

export const storeWastageReportSchema = z.object({
  periodLabel: z.string(),
  items: z.array(
    z.object({
      reason: z.string(),
      productName: z.string(),
      sku: z.string(),
      qty: z.number(),
      valuePkr: z.number(),
      createdAt: z.string(),
    }),
  ),
  totalValuePkr: z.number(),
});

export const storeCustomerDetailSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  membershipTier: storeMembershipTierSchema,
  loyaltyPoints: z.number(),
  creditLimitPkr: z.number(),
  outstandingPkr: z.number(),
  totalPurchases: z.number(),
  recentSales: z.array(
    z.object({
      id: z.string().uuid(),
      invoiceNumber: z.string(),
      total: z.number(),
      createdAt: z.string(),
      lineCount: z.number(),
    }),
  ),
});

export const updateStoreCustomerTierSchema = z.object({
  membershipTier: storeMembershipTierSchema,
});

export const validateStoreCouponSchema = z.object({
  branchCode: z.string().min(1),
  code: z.string().min(1),
  cartTotal: z.number().min(0),
});

export const validateStoreGiftCardSchema = z.object({
  branchCode: z.string().min(1),
  cardNumber: z.string().min(1),
});

export type StoreCashMovement = z.infer<typeof storeCashMovementSchema>;
export type StoreCoupon = z.infer<typeof storeCouponSchema>;
export type StoreGiftCard = z.infer<typeof storeGiftCardSchema>;
export type StoreSaleReturn = z.infer<typeof storeSaleReturnSchema>;
export type StorePurchaseReturn = z.infer<typeof storePurchaseReturnSchema>;
export type StorePeakHoursReport = z.infer<typeof storePeakHoursReportSchema>;
export type StoreEmployeeReport = z.infer<typeof storeEmployeeReportSchema>;
export type StoreWastageReport = z.infer<typeof storeWastageReportSchema>;
export type StoreCustomerDetail = z.infer<typeof storeCustomerDetailSchema>;
export type CreateStoreCashMovement = z.infer<typeof createStoreCashMovementSchema>;
export type CreateStoreCoupon = z.infer<typeof createStoreCouponSchema>;
export type CreateStoreGiftCard = z.infer<typeof createStoreGiftCardSchema>;
export type CreateStoreSaleReturn = z.infer<typeof createStoreSaleReturnSchema>;
export type CreateStorePurchaseReturn = z.infer<typeof createStorePurchaseReturnSchema>;

/** Loyalty earn multiplier by tier */
export const LOYALTY_TIER_MULTIPLIERS: Record<z.infer<typeof storeMembershipTierSchema>, number> = {
  standard: 1,
  silver: 1.25,
  gold: 1.5,
  vip: 2,
};
