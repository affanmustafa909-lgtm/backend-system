import { z } from "zod";

export const mobizonePaymentChannelSchema = z.enum(["cash", "bank", "udhaar"]);
export type MobizonePaymentChannel = z.infer<typeof mobizonePaymentChannelSchema>;

export const mobizoneConditionSchema = z.enum(["new", "used"]);
export type MobizoneCondition = z.infer<typeof mobizoneConditionSchema>;

export const mobizonePartyKindSchema = z.enum(["customer", "shopkeeper"]);
export type MobizonePartyKind = z.infer<typeof mobizonePartyKindSchema>;

export const mobizoneLedgerDirectionSchema = z.enum(["receive", "pay"]);
export type MobizoneLedgerDirection = z.infer<typeof mobizoneLedgerDirectionSchema>;

export const mobizoneBankDetailsSchema = z.object({
  bankAccountId: z.string().uuid().nullable().optional(),
  bankName: z.string().max(120).nullable().optional(),
  accountTitle: z.string().max(160).nullable().optional(),
  accountNumber: z.string().max(64).nullable().optional(),
  iban: z.string().max(64).nullable().optional(),
  txnRef: z.string().max(120).nullable().optional(),
  verified: z.boolean().default(false),
});
export type MobizoneBankDetails = z.infer<typeof mobizoneBankDetailsSchema>;

export const mobizoneSplitPaymentSchema = z.object({
  cashPkr: z.number().nonnegative().default(0),
  bankPkr: z.number().nonnegative().default(0),
  bankLabel: z.string().max(120).nullable().optional(),
  bank: mobizoneBankDetailsSchema.optional(),
});
export type MobizoneSplitPayment = z.infer<typeof mobizoneSplitPaymentSchema>;

export const mobizoneBankAccountSchema = z.object({
  id: z.string().uuid(),
  bankName: z.string().min(1).max(120),
  accountTitle: z.string().min(1).max(160),
  accountNumber: z.string().max(64).nullable().optional(),
  iban: z.string().max(64).nullable().optional(),
  openingBalancePkr: z.number().default(0),
  notes: z.string().max(300).nullable().optional(),
  createdAt: z.string(),
});
export type MobizoneBankAccount = z.infer<typeof mobizoneBankAccountSchema>;

export const mobizoneShopkeeperSchema = z.object({
  id: z.string().uuid(),
  shopNo: z.string().min(1).max(40),
  name: z.string().min(1).max(200),
  phone: z.string().max(32).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  createdAt: z.string(),
});
export type MobizoneShopkeeper = z.infer<typeof mobizoneShopkeeperSchema>;

export const mobizoneCustomerSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  cnic: z.string().max(20).nullable().optional(),
  phone: z.string().max(32).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  photoDataUrl: z.string().nullable().optional(),
  cnicFrontDataUrl: z.string().nullable().optional(),
  cnicBackDataUrl: z.string().nullable().optional(),
  pendingPkr: z.number().default(0),
  createdAt: z.string(),
});
export type MobizoneCustomer = z.infer<typeof mobizoneCustomerSchema>;

export const mobizoneDeviceSchema = z.object({
  id: z.string().uuid(),
  imei: z.string().min(5).max(32),
  imei2: z.string().max(32).nullable().optional(),
  brand: z.string().min(1).max(80),
  model: z.string().min(1).max(120),
  colour: z.string().max(60).nullable().optional(),
  storage: z.string().max(40).nullable().optional(),
  batteryHealth: z.string().max(40).nullable().optional(),
  /** Extra tags e.g. JV, Non PTA — shows on bill / barcode sticker. */
  etc: z.string().max(120).nullable().optional(),
  condition: mobizoneConditionSchema.default("used"),
  purchasePricePkr: z.number().nonnegative(),
  salePricePkr: z.number().nonnegative().nullable().optional(),
  barcode: z.string().max(64).nullable().optional(),
  status: z.enum(["in_stock", "sold", "reserved"]).default("in_stock"),
  shopkeeperId: z.string().uuid().nullable().optional(),
  notes: z.string().max(800).nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MobizoneDevice = z.infer<typeof mobizoneDeviceSchema>;

export const mobizoneSaleSchema = z.object({
  id: z.string().uuid(),
  deviceId: z.string().uuid(),
  customerId: z.string().uuid().nullable().optional(),
  shopkeeperId: z.string().uuid().nullable().optional(),
  customerName: z.string(),
  customerPhone: z.string().nullable().optional(),
  customerAddress: z.string().nullable().optional(),
  customerCnic: z.string().nullable().optional(),
  customerPhotoDataUrl: z.string().nullable().optional(),
  cnicFrontDataUrl: z.string().nullable().optional(),
  cnicBackDataUrl: z.string().nullable().optional(),
  otherPhotoDataUrl: z.string().nullable().optional(),
  note: z.string().max(800).nullable().optional(),
  batteryHealth: z.string().max(40).nullable().optional(),
  etc: z.string().max(120).nullable().optional(),
  imei: z.string(),
  brand: z.string(),
  model: z.string(),
  colour: z.string().max(60).nullable().optional(),
  storage: z.string().max(40).nullable().optional(),
  pricePkr: z.number().nonnegative(),
  receivedPkr: z.number().nonnegative(),
  remainingPkr: z.number().nonnegative(),
  dueDate: z.string().nullable().optional(),
  warrantyDays: z.number().int().nonnegative().default(0),
  returnedAt: z.string().nullable().optional(),
  /** Soft-delete (mistake entry) — kept in history/backup, excluded from live totals. */
  deletedAt: z.string().nullable().optional(),
  deletedReason: z.string().max(400).nullable().optional(),
  payment: mobizoneSplitPaymentSchema,
  costPkr: z.number().nonnegative(),
  profitPkr: z.number(),
  createdAt: z.string(),
});
export type MobizoneSale = z.infer<typeof mobizoneSaleSchema>;

export const mobizoneExpenseAccountSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  notes: z.string().max(400).nullable().optional(),
  createdAt: z.string(),
});
export type MobizoneExpenseAccount = z.infer<typeof mobizoneExpenseAccountSchema>;

export const mobizoneExpenseSchema = z.object({
  id: z.string().uuid(),
  /** Display name — usually the expense account name (e.g. Rent). */
  title: z.string().min(1).max(200),
  /** Category account (Rent, Electricity, Food…). */
  accountId: z.string().uuid().nullable().optional(),
  amountPkr: z.number().positive(),
  method: z.enum(["cash", "bank"]),
  bankAccountId: z.string().uuid().nullable().optional(),
  note: z.string().max(400).nullable().optional(),
  createdAt: z.string(),
});
export type MobizoneExpense = z.infer<typeof mobizoneExpenseSchema>;

/** Account kinds that can appear on Contra / General vouchers. */
export const mobizoneVoucherAccountKindSchema = z.enum([
  "cash",
  "bank",
  "customer",
  "shopkeeper",
  "expense",
]);
export type MobizoneVoucherAccountKind = z.infer<typeof mobizoneVoucherAccountKindSchema>;

export const mobizoneVoucherLineSchema = z.object({
  accountKind: mobizoneVoucherAccountKindSchema,
  /** Null for cash; bank / customer / shopkeeper / expense account id otherwise. */
  accountId: z.string().uuid().nullable().optional(),
  accountName: z.string().min(1).max(200),
  side: z.enum(["debit", "credit"]),
  amountPkr: z.number().positive(),
});
export type MobizoneVoucherLine = z.infer<typeof mobizoneVoucherLineSchema>;

/** Uploaded reference file (PDF, Word, PPT, image, or any other type). */
export const mobizoneDocumentAttachmentSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string().min(1).max(260),
  mimeType: z.string().max(160).nullable().optional(),
  sizeBytes: z.number().int().nonnegative(),
  dataUrl: z.string().min(1),
  uploadedAt: z.string(),
});
export type MobizoneDocumentAttachment = z.infer<typeof mobizoneDocumentAttachmentSchema>;

export const mobizoneVoucherSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["contra", "general"]),
  /** Transfer / entry date as ISO timestamp. */
  createdAt: z.string(),
  reference: z.string().max(120).nullable().optional(),
  note: z.string().max(400).nullable().optional(),
  amountPkr: z.number().positive(),
  lines: z.array(mobizoneVoucherLineSchema).min(2),
  /** Optional reference documents of any type (PDF, Word, PPT, etc.). */
  attachments: z.array(mobizoneDocumentAttachmentSchema).max(8).optional().default([]),
});
export type MobizoneVoucher = z.infer<typeof mobizoneVoucherSchema>;

export const mobizonePurchaseSchema = z.object({
  id: z.string().uuid(),
  deviceId: z.string().uuid(),
  customerId: z.string().uuid().nullable().optional(),
  shopkeeperId: z.string().uuid().nullable().optional(),
  sellerName: z.string(),
  sellerCnic: z.string().nullable().optional(),
  sellerPhone: z.string().nullable().optional(),
  sellerAddress: z.string().nullable().optional(),
  sellerPhotoDataUrl: z.string().nullable().optional(),
  cnicFrontDataUrl: z.string().nullable().optional(),
  cnicBackDataUrl: z.string().nullable().optional(),
  otherPhotoDataUrl: z.string().nullable().optional(),
  note: z.string().max(800).nullable().optional(),
  imei: z.string(),
  brand: z.string(),
  model: z.string(),
  colour: z.string().nullable().optional(),
  storage: z.string().nullable().optional(),
  batteryHealth: z.string().max(40).nullable().optional(),
  etc: z.string().max(120).nullable().optional(),
  condition: mobizoneConditionSchema,
  purchasePricePkr: z.number().nonnegative(),
  paidPkr: z.number().nonnegative().default(0),
  remainingPkr: z.number().nonnegative().default(0),
  dueDate: z.string().nullable().optional(),
  returnedAt: z.string().nullable().optional(),
  /** Soft-delete (mistake entry) — kept in history/backup, excluded from live totals. */
  deletedAt: z.string().nullable().optional(),
  deletedReason: z.string().max(400).nullable().optional(),
  payment: mobizoneSplitPaymentSchema,
  createdAt: z.string(),
});
export type MobizonePurchase = z.infer<typeof mobizonePurchaseSchema>;

export const mobizoneLedgerEntrySchema = z.object({
  id: z.string().uuid(),
  partyKind: mobizonePartyKindSchema,
  partyId: z.string().uuid(),
  partyName: z.string(),
  direction: mobizoneLedgerDirectionSchema,
  amountPkr: z.number().positive(),
  method: z.enum(["cash", "bank"]),
  bankAccountId: z.string().uuid().nullable().optional(),
  bankName: z.string().nullable().optional(),
  txnRef: z.string().nullable().optional(),
  note: z.string().max(400).nullable().optional(),
  relatedSaleId: z.string().uuid().nullable().optional(),
  relatedPurchaseId: z.string().uuid().nullable().optional(),
  createdAt: z.string(),
});
export type MobizoneLedgerEntry = z.infer<typeof mobizoneLedgerEntrySchema>;

export const mobizoneDashboardSchema = z.object({
  inStock: z.number().int().nonnegative(),
  /** Sum of purchase cost of phones still in stock (maal value). */
  stockValuePkr: z.number(),
  todaySalesPkr: z.number(),
  todayPurchasesPkr: z.number(),
  /** Gross phone profit minus today's shop expenses. */
  todayProfitPkr: z.number(),
  pendingReceivablesPkr: z.number(),
  pendingPayablesPkr: z.number(),
  cashBalancePkr: z.number(),
  bankBalancePkr: z.number(),
});
export type MobizoneDashboard = z.infer<typeof mobizoneDashboardSchema>;

export const mobizoneBusinessReportSchema = z.object({
  from: z.string(),
  to: z.string(),
  purchaseCount: z.number().int(),
  saleCount: z.number().int(),
  purchaseAmountPkr: z.number(),
  saleAmountPkr: z.number(),
  /** Sale − purchase cost before expenses. */
  grossProfitPkr: z.number(),
  /** Shop expenses in the date range (salary, food, rent, etc.). */
  expenseTotalPkr: z.number(),
  /** Gross profit minus expenses. */
  profitPkr: z.number(),
  /** Current in-stock inventory at purchase cost. */
  stockValuePkr: z.number(),
  receivablesPkr: z.number(),
  payablesPkr: z.number(),
  cashBalancePkr: z.number(),
  bankBalancePkr: z.number(),
});
export type MobizoneBusinessReport = z.infer<typeof mobizoneBusinessReportSchema>;
