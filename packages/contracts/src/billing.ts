import { z } from "zod";

export const PAYMENT_METHOD_VALUES = ["cash", "card", "wallet", "bank"] as const;
export type PaymentMethod = (typeof PAYMENT_METHOD_VALUES)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  wallet: "Wallet",
  bank: "Bank transfer",
};

export const paymentMethodSchema = z.enum(PAYMENT_METHOD_VALUES);

export const billPaymentSchema = z.object({
  method: paymentMethodSchema,
  amount: z.number().int().nonnegative(),
});

export const waiterOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string(),
  branchCode: z.string(),
});

export const createWaiterSchema = z.object({
  branchCode: z.string().min(1),
  name: z.string().min(1).max(80),
  email: z.string().email().min(3).max(320),
  password: z.string().min(8).max(128),
  pin: z.string().regex(/^\d{4}$/).optional(),
});

export const updateWaiterSchema = z.object({
  branchCode: z.string().min(1).optional(),
  email: z.string().email().min(3).max(320).optional(),
  password: z.string().min(8).max(128).optional(),
  pin: z.string().regex(/^\d{4}$/).optional(),
});

export const billLineSchema = z.object({
  label: z.string(),
  qty: z.number().int().positive(),
  unitPrice: z.number().int().nonnegative(),
  // Drop invalid ids instead of 400 — POS may send local/non-uuid menu ids.
  menuItemId: z.preprocess((value) => {
    if (typeof value !== "string") return undefined;
    const id = value.trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
      ? id
      : undefined;
  }, z.string().uuid().optional()),
});

export const billStatusSchema = z.enum(["held", "completed", "void", "open"]);

export const billSchema = z.object({
  id: z.string().uuid(),
  billRef: z.string(),
  orderRef: z.string().nullable(),
  tableLabel: z.string(),
  waiterId: z.string().uuid().nullable(),
  waiterName: z.string(),
  lines: z.array(billLineSchema),
  notes: z.string().nullable(),
  subtotal: z.number(),
  discount: z.number(),
  service: z.number(),
  servicePct: z.number(),
  tax: z.number(),
  taxPct: z.number(),
  total: z.number(),
  payments: z.array(billPaymentSchema),
  splitGroupRef: z.string().nullable(),
  riderId: z.string().uuid().nullable(),
  riderName: z.string().nullable(),
  deliveryChargePkr: z.number(),
  status: billStatusSchema,
  praMode: z.enum(["fake", "real"]).nullable().optional(),
  praInvoiceNumber: z.string().nullable().optional(),
  praInvoiceId: z.string().nullable().optional(),
  praQrPayload: z.string().nullable().optional(),
  praIssuedAt: z.string().nullable().optional(),
  createdAt: z.string(),
});

export const orderListSchema = z.object({
  branchCode: z.string(),
  orders: z.array(billSchema),
});

export const createBillSchema = z.object({
  branchCode: z.string().min(1),
  orderRef: z.string().max(32).optional(),
  tableLabel: z.string().min(1).max(64),
  waiterId: z.string().uuid().optional(),
  waiterName: z.string().max(120).optional(),
  lines: z.array(billLineSchema).min(1),
  notes: z.string().max(500).optional(),
  discountPct: z.number().min(0).max(50).optional(),
  /** Fixed discount in PKR; takes precedence over discountPct when set. */
  discountPkr: z.number().int().min(0).optional(),
  servicePct: z.number().min(0).max(30).optional(),
  taxPct: z.number().min(0).max(30).optional(),
  status: billStatusSchema.optional(),
  payments: z.array(billPaymentSchema).min(1).optional(),
  splitGroupRef: z.string().max(64).optional(),
  riderId: z.string().uuid().optional(),
  deliveryChargePkr: z.number().int().min(0).max(50_000).optional(),
});

export const completeBillSchema = z.object({
  payments: z.array(billPaymentSchema).min(1),
  servicePct: z.number().min(0).max(30).optional(),
  taxPct: z.number().min(0).max(30).optional(),
});

export const updateBillSchema = z.object({
  tableLabel: z.string().min(1).max(64).optional(),
  lines: z.array(billLineSchema).min(1).optional(),
  notes: z.string().max(500).nullable().optional(),
  discountPct: z.number().min(0).max(50).optional(),
  discountPkr: z.number().int().min(0).optional(),
  servicePct: z.number().min(0).max(30).optional(),
  taxPct: z.number().min(0).max(30).optional(),
  riderId: z.string().uuid().nullable().optional(),
  deliveryChargePkr: z.number().int().min(0).max(50_000).optional(),
});

export const voidBillSchema = z.object({
  reason: z.string().max(200).optional(),
});

export type WaiterOption = z.infer<typeof waiterOptionSchema>;
export type CreateWaiter = z.infer<typeof createWaiterSchema>;
export type UpdateWaiter = z.infer<typeof updateWaiterSchema>;
export type BillLine = z.infer<typeof billLineSchema>;
export type BillPayment = z.infer<typeof billPaymentSchema>;
export type Bill = z.infer<typeof billSchema>;
export type BillStatus = z.infer<typeof billStatusSchema>;
export type OrderList = z.infer<typeof orderListSchema>;
export type CreateBill = z.infer<typeof createBillSchema>;
export type CompleteBill = z.infer<typeof completeBillSchema>;
export type UpdateBill = z.infer<typeof updateBillSchema>;
export type VoidBill = z.infer<typeof voidBillSchema>;
