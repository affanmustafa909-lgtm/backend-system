import { date, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { popsBranches } from "./operations";

export const storeCategories = pgTable("store_categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  parentId: uuid("parent_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storeBrands = pgTable("store_brands", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storeUnits = pgTable("store_units", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  abbreviation: text("abbreviation").notNull().default("pc"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storeProducts = pgTable("store_products", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  categoryId: uuid("category_id").references(() => storeCategories.id, { onDelete: "set null" }),
  subcategoryId: uuid("subcategory_id").references(() => storeCategories.id, { onDelete: "set null" }),
  brandId: uuid("brand_id").references(() => storeBrands.id, { onDelete: "set null" }),
  unitId: uuid("unit_id").references(() => storeUnits.id, { onDelete: "set null" }),
  variantOfId: uuid("variant_of_id"),
  barcode: text("barcode"),
  qrCode: text("qr_code"),
  imageUrl: text("image_url"),
  purchasePricePkr: integer("purchase_price_pkr").notNull().default(0),
  sellingPricePkr: integer("selling_price_pkr").notNull().default(0),
  taxPct: integer("tax_pct").notNull().default(0),
  reorderLevel: integer("reorder_level").notNull().default(10),
  availableStock: integer("available_stock").notNull().default(0),
  reservedStock: integer("reserved_stock").notNull().default(0),
  damagedStock: integer("damaged_stock").notNull().default(0),
  expiredStock: integer("expired_stock").notNull().default(0),
  inTransitStock: integer("in_transit_stock").notNull().default(0),
  trackBatch: text("track_batch").notNull().default("no"),
  trackSerial: text("track_serial").notNull().default("no"),
  isWeighed: text("is_weighed").notNull().default("no"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storeProductBatches = pgTable("store_product_batches", {
  id: uuid("id").defaultRandom().primaryKey(),
  productId: uuid("product_id")
    .notNull()
    .references(() => storeProducts.id, { onDelete: "cascade" }),
  batchNumber: text("batch_number").notNull(),
  lotNumber: text("lot_number"),
  manufacturingDate: date("manufacturing_date"),
  expiryDate: date("expiry_date"),
  quantity: integer("quantity").notNull().default(0),
  warehouseId: uuid("warehouse_id"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storeProductSerials = pgTable("store_product_serials", {
  id: uuid("id").defaultRandom().primaryKey(),
  productId: uuid("product_id")
    .notNull()
    .references(() => storeProducts.id, { onDelete: "cascade" }),
  serialNumber: text("serial_number").notNull(),
  batchId: uuid("batch_id").references(() => storeProductBatches.id, { onDelete: "set null" }),
  status: text("status").notNull().default("available"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storeSuppliers = pgTable("store_suppliers", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  contactPerson: text("contact_person"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  paymentTerms: text("payment_terms"),
  qualityScore: integer("quality_score").notNull().default(80),
  avgDeliveryDays: integer("avg_delivery_days").notNull().default(7),
  openingBalancePkr: integer("opening_balance_pkr").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storeCustomers = pgTable("store_customers", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  creditLimitPkr: integer("credit_limit_pkr").notNull().default(0),
  outstandingPkr: integer("outstanding_pkr").notNull().default(0),
  loyaltyPoints: integer("loyalty_points").notNull().default(0),
  membershipTier: text("membership_tier").notNull().default("standard"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storeWarehouses = pgTable("store_warehouses", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  address: text("address"),
  isDefault: text("is_default").notNull().default("no"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storeZones = pgTable("store_zones", {
  id: uuid("id").defaultRandom().primaryKey(),
  warehouseId: uuid("warehouse_id")
    .notNull()
    .references(() => storeWarehouses.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storeRacks = pgTable("store_racks", {
  id: uuid("id").defaultRandom().primaryKey(),
  zoneId: uuid("zone_id")
    .notNull()
    .references(() => storeZones.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storeShelves = pgTable("store_shelves", {
  id: uuid("id").defaultRandom().primaryKey(),
  rackId: uuid("rack_id")
    .notNull()
    .references(() => storeRacks.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storeBinLocations = pgTable("store_bin_locations", {
  id: uuid("id").defaultRandom().primaryKey(),
  shelfId: uuid("shelf_id")
    .notNull()
    .references(() => storeShelves.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storePurchaseRequisitions = pgTable("store_purchase_requisitions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  requisitionNumber: text("requisition_number").notNull(),
  status: text("status").notNull().default("Draft"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storePurchaseRequisitionItems = pgTable("store_purchase_requisition_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  requisitionId: uuid("requisition_id")
    .notNull()
    .references(() => storePurchaseRequisitions.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => storeProducts.id, { onDelete: "restrict" }),
  qty: integer("qty").notNull(),
});

export const storePurchaseOrders = pgTable("store_purchase_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  poNumber: text("po_number").notNull(),
  supplierId: uuid("supplier_id").references(() => storeSuppliers.id, { onDelete: "set null" }),
  requisitionId: uuid("requisition_id").references(() => storePurchaseRequisitions.id, { onDelete: "set null" }),
  status: text("status").notNull().default("Draft"),
  totalPkr: integer("total_pkr").notNull().default(0),
  expectedDelivery: date("expected_delivery"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storePurchaseOrderItems = pgTable("store_purchase_order_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  purchaseOrderId: uuid("purchase_order_id")
    .notNull()
    .references(() => storePurchaseOrders.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => storeProducts.id, { onDelete: "restrict" }),
  qty: integer("qty").notNull(),
  unitPricePkr: integer("unit_price_pkr").notNull().default(0),
  receivedQty: integer("received_qty").notNull().default(0),
});

export const storeGrn = pgTable("store_grn", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  grnNumber: text("grn_number").notNull(),
  purchaseOrderId: uuid("purchase_order_id").references(() => storePurchaseOrders.id, { onDelete: "set null" }),
  supplierId: uuid("supplier_id").references(() => storeSuppliers.id, { onDelete: "set null" }),
  warehouseId: uuid("warehouse_id").references(() => storeWarehouses.id, { onDelete: "set null" }),
  status: text("status").notNull().default("Received"),
  totalPkr: integer("total_pkr").notNull().default(0),
  invoiceNumber: text("invoice_number"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storeGrnItems = pgTable("store_grn_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  grnId: uuid("grn_id")
    .notNull()
    .references(() => storeGrn.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => storeProducts.id, { onDelete: "restrict" }),
  qty: integer("qty").notNull(),
  unitPricePkr: integer("unit_price_pkr").notNull().default(0),
  batchNumber: text("batch_number"),
  expiryDate: date("expiry_date"),
});

export const storeInventoryTransactions = pgTable("store_inventory_transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => storeProducts.id, { onDelete: "restrict" }),
  type: text("type").notNull(),
  qty: integer("qty").notNull(),
  reference: text("reference"),
  notes: text("notes"),
  warehouseId: uuid("warehouse_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storeStockTransfers = pgTable("store_stock_transfers", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  transferNumber: text("transfer_number").notNull(),
  fromWarehouseId: uuid("from_warehouse_id").references(() => storeWarehouses.id, { onDelete: "set null" }),
  toWarehouseId: uuid("to_warehouse_id").references(() => storeWarehouses.id, { onDelete: "set null" }),
  status: text("status").notNull().default("Pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storeStockTransferItems = pgTable("store_stock_transfer_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  transferId: uuid("transfer_id")
    .notNull()
    .references(() => storeStockTransfers.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => storeProducts.id, { onDelete: "restrict" }),
  qty: integer("qty").notNull(),
});

export const storeStockAdjustments = pgTable("store_stock_adjustments", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  adjustmentNumber: text("adjustment_number").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("Pending"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storeStockAdjustmentItems = pgTable("store_stock_adjustment_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  adjustmentId: uuid("adjustment_id")
    .notNull()
    .references(() => storeStockAdjustments.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => storeProducts.id, { onDelete: "restrict" }),
  qtyChange: integer("qty_change").notNull(),
  stockType: text("stock_type").notNull().default("available"),
});

export const storeStockAudits = pgTable("store_stock_audits", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  auditNumber: text("audit_number").notNull(),
  auditType: text("audit_type").notNull().default("physical"),
  status: text("status").notNull().default("In Progress"),
  warehouseId: uuid("warehouse_id").references(() => storeWarehouses.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storeStockAuditItems = pgTable("store_stock_audit_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  auditId: uuid("audit_id")
    .notNull()
    .references(() => storeStockAudits.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => storeProducts.id, { onDelete: "restrict" }),
  systemQty: integer("system_qty").notNull(),
  countedQty: integer("counted_qty").notNull(),
  variance: integer("variance").notNull(),
});

export const storeShifts = pgTable("store_shifts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  cashierName: text("cashier_name").notNull(),
  terminalId: text("terminal_id"),
  openingCashPkr: integer("opening_cash_pkr").notNull().default(0),
  closingCashPkr: integer("closing_cash_pkr"),
  expectedCashPkr: integer("expected_cash_pkr"),
  cashDifferencePkr: integer("cash_difference_pkr"),
  totalSalesPkr: integer("total_sales_pkr").notNull().default(0),
  transactionCount: integer("transaction_count").notNull().default(0),
  status: text("status").notNull().default("open"),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

export const storePromotions = pgTable("store_promotions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(),
  productIdsJson: text("product_ids_json").notNull().default("[]"),
  configJson: text("config_json").notNull().default("{}"),
  isActive: text("is_active").notNull().default("yes"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storePosShortcuts = pgTable("store_pos_shortcuts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  hotkey: text("hotkey").notNull(),
  label: text("label").notNull(),
  productId: uuid("product_id")
    .notNull()
    .references(() => storeProducts.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storeSales = pgTable("store_sales", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  invoiceNumber: text("invoice_number").notNull(),
  customerId: uuid("customer_id").references(() => storeCustomers.id, { onDelete: "set null" }),
  orderNumber: text("order_number"),
  status: text("status").notNull().default("Completed"),
  paymentMethod: text("payment_method").notNull().default("Cash"),
  isCredit: text("is_credit").notNull().default("no"),
  subtotalPkr: integer("subtotal_pkr").notNull().default(0),
  taxPkr: integer("tax_pkr").notNull().default(0),
  discountPkr: integer("discount_pkr").notNull().default(0),
  promotionDiscountPkr: integer("promotion_discount_pkr").notNull().default(0),
  loyaltyPointsEarned: integer("loyalty_points_earned").notNull().default(0),
  loyaltyPointsRedeemed: integer("loyalty_points_redeemed").notNull().default(0),
  amountPaidPkr: integer("amount_paid_pkr").notNull().default(0),
  amountDuePkr: integer("amount_due_pkr").notNull().default(0),
  paymentsJson: text("payments_json"),
  shiftId: uuid("shift_id").references(() => storeShifts.id, { onDelete: "set null" }),
  terminalId: text("terminal_id"),
  heldLabel: text("held_label"),
  heldCartJson: text("held_cart_json"),
  couponCode: text("coupon_code"),
  giftCardNumber: text("gift_card_number"),
  totalPkr: integer("total_pkr").notNull().default(0),
  deliveryStatus: text("delivery_status").notNull().default("Delivered"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storeSaleLines = pgTable("store_sale_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  saleId: uuid("sale_id")
    .notNull()
    .references(() => storeSales.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => storeProducts.id, { onDelete: "restrict" }),
  qty: integer("qty").notNull(),
  isWeighed: text("is_weighed").notNull().default("no"),
  unitPricePkr: integer("unit_price_pkr").notNull(),
  lineTotalPkr: integer("line_total_pkr").notNull(),
  batchId: uuid("batch_id"),
});

export const storeCashMovements = pgTable("store_cash_movements", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  shiftId: uuid("shift_id")
    .notNull()
    .references(() => storeShifts.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  amountPkr: integer("amount_pkr").notNull(),
  reason: text("reason").notNull(),
  recordedBy: text("recorded_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storeCoupons = pgTable("store_coupons", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  value: integer("value").notNull(),
  minPurchasePkr: integer("min_purchase_pkr").notNull().default(0),
  isActive: text("is_active").notNull().default("yes"),
  usageCount: integer("usage_count").notNull().default(0),
  maxUses: integer("max_uses"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storeGiftCards = pgTable("store_gift_cards", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  cardNumber: text("card_number").notNull(),
  initialBalancePkr: integer("initial_balance_pkr").notNull(),
  balancePkr: integer("balance_pkr").notNull(),
  status: text("status").notNull().default("active"),
  issuedTo: text("issued_to"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storeSaleReturns = pgTable("store_sale_returns", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  returnNumber: text("return_number").notNull(),
  saleId: uuid("sale_id")
    .notNull()
    .references(() => storeSales.id, { onDelete: "restrict" }),
  reason: text("reason").notNull(),
  refundMethod: text("refund_method").notNull(),
  totalRefundPkr: integer("total_refund_pkr").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storeSaleReturnLines = pgTable("store_sale_return_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  returnId: uuid("return_id")
    .notNull()
    .references(() => storeSaleReturns.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => storeProducts.id, { onDelete: "restrict" }),
  qty: integer("qty").notNull(),
  refundAmountPkr: integer("refund_amount_pkr").notNull(),
});

export const storePurchaseReturns = pgTable("store_purchase_returns", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  returnNumber: text("return_number").notNull(),
  supplierId: uuid("supplier_id").references(() => storeSuppliers.id, { onDelete: "set null" }),
  reason: text("reason").notNull(),
  totalAmountPkr: integer("total_amount_pkr").notNull().default(0),
  status: text("status").notNull().default("Completed"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storePurchaseReturnItems = pgTable("store_purchase_return_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  returnId: uuid("return_id")
    .notNull()
    .references(() => storePurchaseReturns.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => storeProducts.id, { onDelete: "restrict" }),
  qty: integer("qty").notNull(),
  unitPricePkr: integer("unit_price_pkr").notNull(),
});

export const storeProductKits = pgTable("store_product_kits", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  kitProductId: uuid("kit_product_id")
    .notNull()
    .references(() => storeProducts.id, { onDelete: "cascade" }),
  componentProductId: uuid("component_product_id")
    .notNull()
    .references(() => storeProducts.id, { onDelete: "cascade" }),
  qty: integer("qty").notNull().default(1),
});
