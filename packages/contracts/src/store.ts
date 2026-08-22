import { z } from "zod";

export const STORE_ROLES = [
  "super_admin",
  "inventory_manager",
  "warehouse_manager",
  "purchase_officer",
  "sales_manager",
  "accountant",
  "staff",
] as const;
export const storeRoleSchema = z.enum(STORE_ROLES);

export const STORE_PAYMENT_METHODS = ["Cash", "Card", "Bank Transfer", "Mobile Wallet", "Credit"] as const;
export const storePaymentMethodSchema = z.enum(STORE_PAYMENT_METHODS);

export const STORE_PO_STATUSES = ["Draft", "Pending Approval", "Approved", "Partially Received", "Received", "Cancelled"] as const;
export const storePoStatusSchema = z.enum(STORE_PO_STATUSES);

export const storeCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  parentId: z.string().uuid().nullable(),
  parentName: z.string().nullable(),
  productCount: z.number(),
});

export const storeBrandSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  productCount: z.number(),
});

export const storeUnitSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  abbreviation: z.string(),
});

export const storeProductSchema = z.object({
  id: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  categoryId: z.string().uuid().nullable(),
  categoryName: z.string().nullable(),
  subcategoryId: z.string().uuid().nullable(),
  subcategoryName: z.string().nullable(),
  brandId: z.string().uuid().nullable(),
  brandName: z.string().nullable(),
  unitId: z.string().uuid().nullable(),
  unitName: z.string().nullable(),
  variantOfId: z.string().uuid().nullable(),
  barcode: z.string().nullable(),
  barcodes: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  qrCode: z.string().nullable(),
  imageUrl: z.string().nullable(),
  supplierId: z.string().uuid().nullable().optional(),
  supplierName: z.string().nullable().optional(),
  purchasePrice: z.number(),
  orderCost: z.number().nullish().transform((v) => v ?? 0),
  sellingPrice: z.number(),
  salePrice: z.number().nullish().transform((v) => v ?? 0),
  mrpPrice: z.number().nullish().transform((v) => v ?? 0),
  wholesalePrice: z.number().nullish().transform((v) => v ?? 0),
  customPrice: z.number().nullish().transform((v) => v ?? 0),
  marketSalePrice: z.number().nullish().transform((v) => v ?? 0),
  marginPct: z.number().nullish().transform((v) => v ?? 0),
  markupPct: z.number().nullish().transform((v) => v ?? 0),
  taxPct: z.number(),
  reorderLevel: z.number(),
  availableStock: z.number(),
  reservedStock: z.number(),
  damagedStock: z.number(),
  expiredStock: z.number(),
  inTransitStock: z.number(),
  totalStock: z.number(),
  inventoryValue: z.number(),
  trackBatch: z.boolean(),
  trackSerial: z.boolean(),
  isWeighed: z.boolean().default(false),
  color: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
  serialNumbers: z.array(z.string()).nullish().transform((v) => v ?? []),
  nearestExpiry: z.string().nullable(),
});

export const storeProductBatchSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  productName: z.string(),
  batchNumber: z.string(),
  lotNumber: z.string().nullable(),
  manufacturingDate: z.string().nullable(),
  expiryDate: z.string().nullable(),
  quantity: z.number(),
  status: z.string(),
});

export const storeSupplierSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  contactPerson: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  paymentTerms: z.string().nullable(),
  qualityScore: z.number(),
  avgDeliveryDays: z.number(),
  openingBalancePkr: z.number(),
  totalPurchases: z.number(),
  outstandingBalance: z.number(),
  lastOrderDate: z.string().nullable(),
});

export const storeCustomerSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  creditLimitPkr: z.number(),
  outstandingPkr: z.number(),
  loyaltyPoints: z.number(),
  totalPurchases: z.number(),
  membershipTier: z.enum(["standard", "silver", "gold", "vip"]).default("standard"),
});

export const storeWarehouseSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  isDefault: z.boolean(),
  zoneCount: z.number(),
  totalStock: z.number(),
});

export const storeBinLocationSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  warehouseName: z.string(),
  zoneName: z.string(),
  rackName: z.string(),
  shelfName: z.string(),
});

export const storePurchaseRequisitionSchema = z.object({
  id: z.string().uuid(),
  requisitionNumber: z.string(),
  status: z.string(),
  notes: z.string().nullable(),
  itemCount: z.number(),
  createdAt: z.string(),
});

export const storePurchaseOrderSchema = z.object({
  id: z.string().uuid(),
  poNumber: z.string(),
  supplierId: z.string().uuid().nullable(),
  supplierName: z.string().nullable(),
  status: storePoStatusSchema,
  totalAmount: z.number(),
  expectedDelivery: z.string().nullable(),
  itemCount: z.number(),
  receivedPct: z.number(),
  createdAt: z.string(),
  approvedAt: z.string().nullable(),
});

export const storePurchaseOrderDetailSchema = storePurchaseOrderSchema.extend({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      productId: z.string().uuid(),
      productName: z.string(),
      sku: z.string(),
      qty: z.number(),
      unitPrice: z.number(),
      receivedQty: z.number(),
      lineTotal: z.number(),
    }),
  ),
});

export const storeGrnSchema = z.object({
  id: z.string().uuid(),
  grnNumber: z.string(),
  purchaseOrderId: z.string().uuid().nullable(),
  poNumber: z.string().nullable(),
  supplierName: z.string().nullable(),
  warehouseName: z.string().nullable(),
  status: z.string(),
  totalAmount: z.number(),
  invoiceNumber: z.string().nullable(),
  itemCount: z.number(),
  createdAt: z.string(),
});

export const storeInventoryTransactionSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  productName: z.string(),
  sku: z.string(),
  type: z.string(),
  qty: z.number(),
  reference: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});

export const storeStockTransferSchema = z.object({
  id: z.string().uuid(),
  transferNumber: z.string(),
  fromWarehouseName: z.string().nullable(),
  toWarehouseName: z.string().nullable(),
  status: z.string(),
  itemCount: z.number(),
  createdAt: z.string(),
});

export const storeStockAdjustmentSchema = z.object({
  id: z.string().uuid(),
  adjustmentNumber: z.string(),
  reason: z.string(),
  status: z.string(),
  itemCount: z.number(),
  createdAt: z.string(),
  approvedAt: z.string().nullable(),
});

export const storeStockAuditSchema = z.object({
  id: z.string().uuid(),
  auditNumber: z.string(),
  auditType: z.string(),
  status: z.string(),
  warehouseName: z.string().nullable(),
  itemCount: z.number(),
  varianceCount: z.number(),
  createdAt: z.string(),
  approvedAt: z.string().nullable(),
});

export const STORE_SALE_STATUSES = ["Completed", "Held", "Reserved", "Void"] as const;
export const storeSaleStatusSchema = z.enum(STORE_SALE_STATUSES);

export const storePaymentLineSchema = z.object({
  method: storePaymentMethodSchema,
  amount: z.number().min(0),
});

export const STORE_PROMOTION_TYPES = [
  "percent_off",
  "amount_off",
  "buy_x_get_y",
  "buy_x_percent_off",
  "fixed_bundle",
  "mix_match",
  "cross_sell",
  "category_off",
] as const;
export const storePromotionTypeSchema = z.enum(STORE_PROMOTION_TYPES);

/** Price levels an automatic discount may apply to (Retail Pro–style). */
export const STORE_PROMO_PRICE_LEVELS = ["regular", "sale", "employee", "wholesale", "custom"] as const;
export const storePromoPriceLevelSchema = z.enum(STORE_PROMO_PRICE_LEVELS);

export const STORE_PROMO_SCOPES = ["all", "department", "vendor", "named", "custom"] as const;
export const storePromoScopeSchema = z.enum(STORE_PROMO_SCOPES);

export const storeSaleLineSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  productName: z.string(),
  sku: z.string(),
  qty: z.number(),
  unitPrice: z.number(),
  lineTotal: z.number(),
  isWeighed: z.boolean().optional(),
  qtyLabel: z.string().optional(),
});

export const storeSaleSchema = z.object({
  id: z.string().uuid(),
  invoiceNumber: z.string(),
  orderNumber: z.string().nullable(),
  customerId: z.string().uuid().nullable(),
  customerName: z.string().nullable(),
  status: storeSaleStatusSchema,
  paymentMethod: storePaymentMethodSchema,
  isCredit: z.boolean(),
  subtotal: z.number(),
  tax: z.number(),
  discount: z.number(),
  promotionDiscount: z.number().default(0),
  loyaltyPointsEarned: z.number().default(0),
  loyaltyPointsRedeemed: z.number().default(0),
  amountPaid: z.number().default(0),
  amountDue: z.number().default(0),
  total: z.number(),
  deliveryStatus: z.string(),
  shiftId: z.string().uuid().nullable().optional(),
  terminalId: z.string().nullable().optional(),
  heldLabel: z.string().nullable().optional(),
  lines: z.array(storeSaleLineSchema),
  createdAt: z.string(),
});

export const storeAlertSchema = z.object({
  type: z.enum([
    "low_stock",
    "out_of_stock",
    "expiring",
    "expired",
    "pending_po",
    "delayed_delivery",
    "payment_due",
  ]),
  severity: z.enum(["info", "warning", "danger"]),
  message: z.string(),
  productId: z.string().uuid().optional(),
  referenceId: z.string().uuid().optional(),
});

export const storeDashboardSchema = z.object({
  totalProducts: z.number(),
  inventoryValue: z.number(),
  availableStock: z.number(),
  lowStockCount: z.number(),
  outOfStockCount: z.number(),
  pendingPurchaseOrders: z.number(),
  totalSalesToday: z.number(),
  revenueMonth: z.number(),
  profitMonth: z.number(),
  transactionCountToday: z.number(),
  customerCount: z.number(),
  supplierCount: z.number(),
  warehouseCount: z.number(),
  expiringCount: z.number(),
  dailySales: z.array(z.object({ date: z.string(), amount: z.number() })),
  monthlyPurchases: z.array(z.object({ month: z.string(), amount: z.number() })),
  monthlySales: z.array(z.object({ month: z.string(), amount: z.number() })),
  topSellingProducts: z.array(z.object({ name: z.string(), sku: z.string(), qty: z.number(), revenue: z.number() })),
  warehouseSummary: z.array(z.object({ name: z.string(), stock: z.number(), value: z.number() })),
  stockHealth: z.array(z.object({ label: z.string(), value: z.number() })),
  categoryStock: z.array(z.object({ label: z.string(), value: z.number() })),
  recentTransactions: z.array(storeInventoryTransactionSchema),
  alerts: z.array(storeAlertSchema),
});

export const createStoreCategorySchema = z.object({
  branchCode: z.string().min(1),
  name: z.string().min(1),
  parentId: z.string().uuid().optional(),
});

export const createStoreBrandSchema = z.object({
  branchCode: z.string().min(1),
  name: z.string().min(1),
});

export const createStoreUnitSchema = z.object({
  branchCode: z.string().min(1),
  name: z.string().min(1),
  abbreviation: z.string().default("pc"),
});

export const createStoreProductSchema = z.object({
  branchCode: z.string().min(1),
  sku: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  subcategoryId: z.string().uuid().optional(),
  brandId: z.string().uuid().optional(),
  unitId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  barcode: z.string().optional(),
  /** Primary + ALU barcodes (max 12). First entry is treated as primary UPC when barcode is empty. */
  barcodes: z.array(z.string().min(1)).max(12).optional(),
  purchasePrice: z.number().min(0).default(0),
  orderCost: z.number().min(0).default(0),
  sellingPrice: z.number().min(0).default(0),
  salePrice: z.number().min(0).default(0),
  mrpPrice: z.number().min(0).default(0),
  wholesalePrice: z.number().min(0).default(0),
  customPrice: z.number().min(0).default(0),
  marketSalePrice: z.number().min(0).default(0),
  marginPct: z.number().min(0).default(0),
  markupPct: z.number().min(0).default(0),
  taxPct: z.number().min(0).max(100).default(0),
  reorderLevel: z.number().min(0).default(10),
  availableStock: z.number().min(0).default(0),
  trackBatch: z.boolean().default(false),
  trackSerial: z.boolean().default(false),
  isWeighed: z.boolean().default(false),
  color: z.string().optional(),
  size: z.string().optional(),
  /** Optional serial numbers to register (enables trackSerial when non-empty). */
  serialNumbers: z.array(z.string().min(1)).max(50).optional(),
  batchNumber: z.string().optional(),
  expiryDate: z.string().optional(),
});

export const updateStoreProductSchema = createStoreProductSchema
  .omit({ branchCode: true, availableStock: true, batchNumber: true, expiryDate: true })
  .partial()
  .extend({
    name: z.string().min(1).optional(),
  });

export const createStoreSupplierSchema = z.object({
  branchCode: z.string().min(1),
  name: z.string().min(1),
  contactPerson: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  paymentTerms: z.string().optional(),
});

export const createStoreCustomerSchema = z.object({
  branchCode: z.string().min(1),
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  creditLimitPkr: z.number().min(0).default(0),
});

export const createStoreWarehouseSchema = z.object({
  branchCode: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  address: z.string().optional(),
  isDefault: z.boolean().default(false),
});

export const stockMovementSchema = z.object({
  branchCode: z.string().min(1),
  productId: z.string().uuid(),
  type: z.enum(["stock_in", "stock_out", "adjustment", "opening_stock"]),
  qty: z.number().min(1),
  notes: z.string().optional(),
  warehouseId: z.string().uuid().optional(),
  batchNumber: z.string().optional(),
  expiryDate: z.string().optional(),
});

export const createStorePurchaseRequisitionSchema = z.object({
  branchCode: z.string().min(1),
  notes: z.string().optional(),
  items: z.array(z.object({ productId: z.string().uuid(), qty: z.number().min(1) })).min(1),
});

export const createStorePurchaseOrderSchema = z.object({
  branchCode: z.string().min(1),
  supplierId: z.string().uuid(),
  requisitionId: z.string().uuid().optional(),
  expectedDelivery: z.string().optional(),
  items: z.array(
    z.object({ productId: z.string().uuid(), qty: z.number().min(1), unitPrice: z.number().min(0) }),
  ).min(1),
});

export const createStoreGrnSchema = z.object({
  branchCode: z.string().min(1),
  purchaseOrderId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  invoiceNumber: z.string().optional(),
  items: z.array(
    z.object({
      productId: z.string().uuid(),
      qty: z.number().min(1),
      unitPrice: z.number().min(0),
      /** Optional new selling price applied when goods are received. */
      sellingPrice: z.number().min(0).optional(),
      batchNumber: z.string().optional(),
      expiryDate: z.string().optional(),
    }),
  ).min(1),
});

export const createStoreStockTransferSchema = z.object({
  branchCode: z.string().min(1),
  fromWarehouseId: z.string().uuid(),
  toWarehouseId: z.string().uuid(),
  items: z.array(z.object({ productId: z.string().uuid(), qty: z.number().min(1) })).min(1),
});

export const createStoreStockAdjustmentSchema = z.object({
  branchCode: z.string().min(1),
  reason: z.string().min(1),
  items: z.array(
    z.object({
      productId: z.string().uuid(),
      qtyChange: z.number(),
      stockType: z.enum(["available", "damaged", "expired"]).default("available"),
    }),
  ).min(1),
});

export const createStoreStockAuditSchema = z.object({
  branchCode: z.string().min(1),
  auditType: z.enum(["physical", "cycle"]).default("physical"),
  warehouseId: z.string().uuid().optional(),
  items: z.array(
    z.object({ productId: z.string().uuid(), systemQty: z.number(), countedQty: z.number() }),
  ).min(1),
});

export const createStoreSaleSchema = z.object({
  branchCode: z.string().min(1),
  customerId: z.string().uuid().optional(),
  paymentMethod: storePaymentMethodSchema,
  discount: z.number().min(0).default(0),
  isCredit: z.boolean().default(false),
  reserveStock: z.boolean().default(false),
  status: z.enum(["Completed", "Held"]).default("Completed"),
  shiftId: z.string().uuid().optional(),
  terminalId: z.string().optional(),
  heldLabel: z.string().optional(),
  loyaltyPointsRedeem: z.number().min(0).default(0),
  couponCode: z.string().optional(),
  giftCardNumber: z.string().optional(),
  payments: z.array(storePaymentLineSchema).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        qty: z.number().min(0.001),
        qtyGrams: z.number().min(1).optional(),
        /** Optional override so POS can sell at Sale / Wholesale / Custom / Market Sale. */
        unitPrice: z.number().min(0).optional(),
        /** Receipt-only name for this sale — does not update product master. */
        productName: z.string().min(1).optional(),
        /** Active price level on the receipt (used by automatic discounts). */
        priceLevel: z.string().optional(),
      }),
    )
    .min(1),
});

export const completeStoreHeldSaleSchema = z.object({
  paymentMethod: storePaymentMethodSchema,
  discount: z.number().min(0).default(0),
  isCredit: z.boolean().default(false),
  loyaltyPointsRedeem: z.number().min(0).default(0),
  payments: z.array(storePaymentLineSchema).optional(),
});

export const storeShiftSchema = z.object({
  id: z.string().uuid(),
  cashierName: z.string(),
  openingCashPkr: z.number(),
  closingCashPkr: z.number().nullable(),
  expectedCashPkr: z.number().nullable(),
  cashDifferencePkr: z.number().nullable(),
  totalSalesPkr: z.number(),
  transactionCount: z.number(),
  status: z.enum(["open", "closed"]),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
});

export const openStoreShiftSchema = z.object({
  branchCode: z.string().min(1),
  cashierName: z.string().min(1),
  openingCashPkr: z.number().min(0).default(0),
  terminalId: z.string().optional(),
});

export const closeStoreShiftSchema = z.object({
  closingCashPkr: z.number().min(0),
});

export type StorePromotionType = z.infer<typeof storePromotionTypeSchema>;

export const storePromotionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: storePromotionTypeSchema,
  isActive: z.boolean(),
  productIds: z.array(z.string().uuid()),
  config: z.record(z.unknown()),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
});

export const createStorePromotionSchema = z.object({
  branchCode: z.string().min(1),
  name: z.string().min(1),
  type: storePromotionTypeSchema,
  productIds: z.array(z.string().uuid()).default([]),
  config: z.record(z.unknown()),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
});

export const storePosShortcutSchema = z.object({
  id: z.string().uuid(),
  hotkey: z.string(),
  label: z.string(),
  productId: z.string().uuid(),
  productName: z.string(),
  sku: z.string(),
});

export const upsertStorePosShortcutSchema = z.object({
  branchCode: z.string().min(1),
  hotkey: z.string().min(1),
  label: z.string().min(1),
  productId: z.string().uuid(),
});

export const storeProfitLossSchema = z.object({
  periodLabel: z.string(),
  from: z.string(),
  to: z.string(),
  revenue: z.number(),
  costOfGoods: z.number(),
  grossProfit: z.number(),
  expenses: z.number(),
  netProfit: z.number(),
  marginPct: z.number(),
  transactionCount: z.number(),
  itemsSold: z.number(),
  topProducts: z.array(
    z.object({ productName: z.string(), qtySold: z.number(), revenue: z.number(), profit: z.number() }),
  ),
});

export const storeStockReportSchema = z.object({
  periodLabel: z.string(),
  from: z.string(),
  to: z.string(),
  products: z.array(
    z.object({
      sku: z.string(),
      name: z.string(),
      category: z.string().nullable(),
      availableStock: z.number(),
      reorderLevel: z.number(),
      status: z.enum(["ok", "low", "out"]),
      value: z.number(),
      movement30d: z.number(),
    }),
  ),
  deadStock: z.array(z.object({ name: z.string(), sku: z.string(), daysIdle: z.number(), value: z.number() })),
  fastMoving: z.array(z.object({ name: z.string(), sku: z.string(), qtySold: z.number() })),
  slowMoving: z.array(z.object({ name: z.string(), sku: z.string(), qtySold: z.number() })),
});

export type StoreProduct = z.infer<typeof storeProductSchema>;
export type StoreCategory = z.infer<typeof storeCategorySchema>;
export type StoreBrand = z.infer<typeof storeBrandSchema>;
export type StoreUnit = z.infer<typeof storeUnitSchema>;
export type StoreSupplier = z.infer<typeof storeSupplierSchema>;
export type StoreCustomer = z.infer<typeof storeCustomerSchema>;
export type StoreWarehouse = z.infer<typeof storeWarehouseSchema>;
export type StoreSale = z.infer<typeof storeSaleSchema>;
export type StoreDashboard = z.infer<typeof storeDashboardSchema>;
export type StorePurchaseOrder = z.infer<typeof storePurchaseOrderSchema>;
export type StoreGrn = z.infer<typeof storeGrnSchema>;
export type CreateStoreProduct = z.infer<typeof createStoreProductSchema>;
export type UpdateStoreProduct = z.infer<typeof updateStoreProductSchema>;
export type CreateStoreCategory = z.infer<typeof createStoreCategorySchema>;
export type CreateStoreBrand = z.infer<typeof createStoreBrandSchema>;
export type CreateStoreUnit = z.infer<typeof createStoreUnitSchema>;
export type CreateStoreSupplier = z.infer<typeof createStoreSupplierSchema>;
export type CreateStoreCustomer = z.infer<typeof createStoreCustomerSchema>;
export type CreateStoreWarehouse = z.infer<typeof createStoreWarehouseSchema>;
export type CreateStoreGrn = z.infer<typeof createStoreGrnSchema>;
export type CreateStorePurchaseOrder = z.infer<typeof createStorePurchaseOrderSchema>;
export type CreateStorePurchaseRequisition = z.infer<typeof createStorePurchaseRequisitionSchema>;
export type CreateStoreStockTransfer = z.infer<typeof createStoreStockTransferSchema>;
export type CreateStoreStockAdjustment = z.infer<typeof createStoreStockAdjustmentSchema>;
export type CreateStoreStockAudit = z.infer<typeof createStoreStockAuditSchema>;
export type CreateStoreSale = z.infer<typeof createStoreSaleSchema>;
export type CompleteStoreHeldSale = z.infer<typeof completeStoreHeldSaleSchema>;
export type StoreShift = z.infer<typeof storeShiftSchema>;
export type OpenStoreShift = z.infer<typeof openStoreShiftSchema>;
export type CloseStoreShift = z.infer<typeof closeStoreShiftSchema>;
export type CreateStorePromotion = z.infer<typeof createStorePromotionSchema>;
export type UpsertStorePosShortcut = z.infer<typeof upsertStorePosShortcutSchema>;
export type StorePromotion = z.infer<typeof storePromotionSchema>;
export type StorePosShortcut = z.infer<typeof storePosShortcutSchema>;
export type StorePaymentLine = z.infer<typeof storePaymentLineSchema>;
export type StorePaymentMethod = z.infer<typeof storePaymentMethodSchema>;
export type StockMovement = z.infer<typeof stockMovementSchema>;
