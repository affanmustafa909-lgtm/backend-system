import { z } from "zod";

export const INGREDIENT_UNITS = ["Kg", "Gram", "Liter", "ml", "Piece", "Packet"] as const;
export const ingredientUnitSchema = z.enum(INGREDIENT_UNITS);

export const PO_STATUSES = [
  "Draft",
  "Pending",
  "Approved",
  "Ordered",
  "Partially Received",
  "Received",
  "Cancelled",
] as const;
export const poStatusSchema = z.enum(PO_STATUSES);

export const ADJUSTMENT_TYPES = ["Add", "Remove"] as const;
export const adjustmentTypeSchema = z.enum(ADJUSTMENT_TYPES);

export const APPROVAL_STATUSES = ["Pending", "Approved", "Rejected"] as const;
export const approvalStatusSchema = z.enum(APPROVAL_STATUSES);

export const WASTE_TYPES = ["Expired Items", "Burnt Food", "Kitchen Waste", "Returned Food"] as const;
export const wasteTypeSchema = z.enum(WASTE_TYPES);

export const STOCK_COUNT_TYPES = ["Daily", "Weekly", "Monthly"] as const;
export const stockCountTypeSchema = z.enum(STOCK_COUNT_TYPES);

export const STOCK_COUNT_STATUSES = ["In Progress", "Completed", "Adjusted"] as const;
export const stockCountStatusSchema = z.enum(STOCK_COUNT_STATUSES);

export const inventoryCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  itemCount: z.number(),
});

export const ingredientSchema = z.object({
  id: z.string().uuid(),
  categoryId: z.string().uuid().nullable(),
  categoryName: z.string().nullable(),
  sku: z.string(),
  name: z.string(),
  unit: ingredientUnitSchema,
  currentStock: z.number(),
  minStock: z.number(),
  reorderLevel: z.number(),
  maxStock: z.number(),
  unitCost: z.number(),
});

export const supplierSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  paymentTerms: z.string().nullable(),
  openingBalancePkr: z.number().int(),
  onboardedDate: z.preprocess(
    (val) => (val === undefined || val === null ? null : String(val).slice(0, 10)),
    z.string().nullable(),
  ),
  active: z.boolean(),
  totalPurchases: z.number(),
  lastOrder: z.string().nullable(),
});

export const purchaseOrderLineSchema = z.object({
  id: z.string().uuid(),
  ingredientId: z.string().uuid(),
  ingredientName: z.string(),
  qty: z.number(),
  unit: z.string(),
  unitCost: z.number(),
  receivedQty: z.number(),
});

export const purchaseOrderSchema = z.object({
  id: z.string().uuid(),
  poNumber: z.string(),
  supplierId: z.string().uuid(),
  supplierName: z.string(),
  status: poStatusSchema,
  items: z.number(),
  totalAmount: z.number(),
  createdAt: z.string(),
  expectedDate: z.string().nullable(),
  requestedBy: z.string().nullable(),
  chef: z.string().nullable(),
  lines: z.array(purchaseOrderLineSchema).optional(),
});

export const goodsReceiptLineSchema = z.object({
  id: z.string().uuid(),
  ingredientId: z.string().uuid(),
  name: z.string(),
  qty: z.number(),
  unit: z.string(),
  unitCost: z.number(),
  batch: z.string().nullable(),
  expiry: z.string().nullable(),
});

export const goodsReceiptSchema = z.object({
  id: z.string().uuid(),
  grnNumber: z.string(),
  supplierId: z.string().uuid(),
  supplierName: z.string(),
  invoiceNumber: z.string().nullable(),
  deliveryDate: z.string(),
  poNumber: z.string().nullable(),
  poId: z.string().uuid().nullable(),
  items: z.array(goodsReceiptLineSchema),
  totalCost: z.number(),
  receivedBy: z.string().nullable(),
  createdAt: z.string(),
});

export const stockBatchSchema = z.object({
  id: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  qty: z.number(),
  unit: z.string(),
  batch: z.string().nullable(),
  expiry: z.preprocess(
    (val) => (val === undefined || val === null ? null : String(val).slice(0, 10)),
    z.string().nullable(),
  ),
  receivedDate: z.preprocess(
    (val) => (val === undefined || val === null ? null : String(val).slice(0, 10)),
    z.string().nullable(),
  ),
  location: z.string(),
  unitCost: z.number(),
});

export const recipeLineSchema = z.object({
  id: z.string().uuid(),
  ingredientId: z.string().uuid(),
  ingredient: z.string(),
  qty: z.number(),
  unit: z.string(),
});

export const recipeSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  menuItemId: z.string().uuid().nullable(),
  menuItem: z.string().nullable(),
  version: z.string(),
  portionSize: z.string().nullable(),
  ingredients: z.array(recipeLineSchema),
  totalCost: z.number(),
  active: z.boolean(),
});

export const stockAdjustmentSchema = z.object({
  id: z.string().uuid(),
  date: z.string(),
  ingredientId: z.string().uuid(),
  ingredient: z.string(),
  type: adjustmentTypeSchema,
  qty: z.number(),
  unit: z.string(),
  reason: z.string(),
  status: approvalStatusSchema,
  requestedBy: z.string().nullable(),
});

export const wasteRecordSchema = z.object({
  id: z.string().uuid(),
  date: z.string(),
  ingredientId: z.string().uuid(),
  ingredient: z.string(),
  qty: z.number(),
  unit: z.string(),
  wasteType: wasteTypeSchema,
  reason: z.string().nullable(),
  costImpact: z.number(),
  status: z.enum(["Pending", "Approved"]),
});

export const stockCountSchema = z.object({
  id: z.string().uuid(),
  countNumber: z.string(),
  type: stockCountTypeSchema,
  date: z.preprocess(
    (val) => (val === undefined || val === null ? "" : String(val).slice(0, 10)),
    z.string(),
  ),
  startedDate: z.preprocess(
    (val) => (val === undefined || val === null ? null : String(val).slice(0, 10)),
    z.string().nullable(),
  ),
  status: stockCountStatusSchema,
  itemsCounted: z.number(),
  variances: z.number(),
  conductedBy: z.string().nullable(),
});

export const inventoryAlertSchema = z.object({
  type: z.string(),
  message: z.string(),
  severity: z.enum(["info", "warning", "danger"]),
});

export const inventoryDashboardSchema = z.object({
  branchCode: z.string(),
  totalIngredients: z.number(),
  inventoryValue: z.number(),
  lowStockItems: z.number(),
  outOfStockItems: z.number(),
  expiringItems: z.number(),
  todaysConsumption: z.number(),
  wasteToday: z.number(),
  purchaseCostThisMonth: z.number(),
  alerts: z.array(inventoryAlertSchema),
});

export const inventoryReportSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(["Inventory", "Restaurant", "Purchase", "Supplier"]),
  description: z.string(),
  lastGenerated: z.string().nullable(),
  filterDate: z.string().nullable().optional(),
  dateMode: z.enum(["activity", "expiry", "order"]).nullable().optional(),
  data: z.unknown().optional(),
});

export const INVENTORY_REPORT_DATE_MODES = ["activity", "expiry", "order"] as const;
export const inventoryReportQuerySchema = z.object({
  filterDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateMode: z.enum(INVENTORY_REPORT_DATE_MODES).optional(),
});

export const PRODUCTION_BATCH_STATUSES = ["Draft", "Posted"] as const;
export const productionBatchStatusSchema = z.enum(PRODUCTION_BATCH_STATUSES);

export const productionBatchLineSchema = z.object({
  id: z.string().uuid(),
  ingredientId: z.string().uuid(),
  ingredient: z.string(),
  qty: z.number(),
  unit: z.string(),
  unitCost: z.number(),
  cost: z.number(),
});

export const productionBatchSchema = z.object({
  id: z.string().uuid(),
  batchRef: z.string(),
  recipeId: z.string().uuid().nullable(),
  recipeName: z.string().nullable(),
  outputName: z.string(),
  outputDescription: z.string().nullable(),
  outputIngredientId: z.string().uuid().nullable(),
  outputIngredient: z.string().nullable(),
  outputQty: z.number(),
  wastePct: z.number(),
  totalCost: z.number(),
  unitCost: z.number(),
  status: productionBatchStatusSchema,
  postedAt: z.string().nullable(),
  postedBy: z.string().nullable(),
  createdAt: z.string(),
  lines: z.array(productionBatchLineSchema),
});

export const productionBatchListSchema = z.object({
  branchCode: z.string(),
  batches: z.array(productionBatchSchema),
});

export const inventoryAuditLogSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string(),
  user: z.string(),
  action: z.string(),
  module: z.string(),
  detail: z.string(),
});

export const branchInventorySchema = z.object({
  branchCode: z.string(),
  categories: z.array(inventoryCategorySchema),
  ingredients: z.array(ingredientSchema),
  suppliers: z.array(supplierSchema),
  purchaseOrders: z.array(purchaseOrderSchema),
  goodsReceipts: z.array(goodsReceiptSchema),
  stockBatches: z.array(stockBatchSchema),
  recipes: z.array(recipeSchema),
  adjustments: z.array(stockAdjustmentSchema),
  wasteRecords: z.array(wasteRecordSchema),
  stockCounts: z.array(stockCountSchema),
  auditLogs: z.array(inventoryAuditLogSchema),
});

// Create / update schemas
export const branchCodeSchema = z.object({ branchCode: z.string().min(1) });

export const createInventoryCategorySchema = branchCodeSchema.extend({
  name: z.string().min(1).max(64),
  description: z.string().max(256).optional(),
});

export const updateInventoryCategorySchema = z.object({
  name: z.string().min(1).max(64).optional(),
  description: z.string().max(256).nullable().optional(),
});

export const createIngredientSchema = branchCodeSchema.extend({
  categoryId: z.string().uuid().optional(),
  sku: z.string().min(1).max(32),
  name: z.string().min(1).max(120),
  unit: ingredientUnitSchema,
  currentStock: z.number().int().min(0).optional(),
  minStock: z.number().int().min(0).optional(),
  reorderLevel: z.number().int().min(0).optional(),
  maxStock: z.number().int().min(0).optional(),
  unitCost: z.number().int().min(0).optional(),
});

export const updateIngredientSchema = z.object({
  categoryId: z.string().uuid().nullable().optional(),
  sku: z.string().min(1).max(32).optional(),
  name: z.string().min(1).max(120).optional(),
  unit: ingredientUnitSchema.optional(),
  currentStock: z.number().int().min(0).optional(),
  minStock: z.number().int().min(0).optional(),
  reorderLevel: z.number().int().min(0).optional(),
  maxStock: z.number().int().min(0).optional(),
  unitCost: z.number().int().min(0).optional(),
});

export const createSupplierSchema = branchCodeSchema.extend({
  name: z.string().min(1).max(120),
  phone: z.string().max(32).optional(),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().max(256).optional(),
  paymentTerms: z.string().max(64).optional(),
  openingBalancePkr: z.number().int().min(0).optional(),
  onboardedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  active: z.boolean().optional(),
});

export const updateSupplierSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  phone: z.string().max(32).nullable().optional(),
  email: z.string().email().nullable().optional(),
  address: z.string().max(256).nullable().optional(),
  paymentTerms: z.string().max(64).nullable().optional(),
  openingBalancePkr: z.number().int().min(0).optional(),
  onboardedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  active: z.boolean().optional(),
});

export const createPoLineSchema = z.object({
  ingredientId: z.string().uuid(),
  qty: z.number().int().positive(),
  unit: z.string().min(1),
  unitCost: z.number().int().min(0),
});

export const createPurchaseOrderSchema = branchCodeSchema.extend({
  supplierId: z.string().uuid(),
  expectedDate: z.string().optional(),
  requestedBy: z.string().max(120).optional(),
  chef: z.string().max(120).optional(),
  lines: z.array(createPoLineSchema).min(1),
});

export const updatePurchaseOrderStatusSchema = z.object({
  status: poStatusSchema,
});

/** Edit draft/pending kitchen demand lines + meta (status stays Draft/Pending). */
export const updatePurchaseOrderSchema = z.object({
  supplierId: z.string().uuid().optional(),
  expectedDate: z.string().nullable().optional(),
  requestedBy: z.string().max(120).nullable().optional(),
  chef: z.string().max(120).nullable().optional(),
  lines: z.array(createPoLineSchema).min(1).optional(),
});

export const createGrnLineSchema = z.object({
  ingredientId: z.string().uuid(),
  qty: z.number().int().positive(),
  unit: z.string().min(1),
  unitCost: z.number().int().min(0),
  batchNumber: z.string().max(32).optional(),
  expiryDate: z.string().optional(),
});

export const createGoodsReceiptSchema = branchCodeSchema.extend({
  supplierId: z.string().uuid(),
  purchaseOrderId: z.string().uuid().optional(),
  invoiceNumber: z.string().max(64).optional(),
  deliveryDate: z.string(),
  receivedBy: z.string().max(120).optional(),
  lines: z.array(createGrnLineSchema).min(1),
});

export const createRecipeLineSchema = z.object({
  ingredientId: z.string().uuid(),
  qty: z.number().int().positive(),
  unit: z.string().min(1),
});

export const createRecipeSchema = branchCodeSchema.extend({
  name: z.string().min(1).max(120),
  menuItemId: z.string().uuid().optional(),
  version: z.string().max(16).optional(),
  portionSize: z.string().max(64).optional(),
  active: z.boolean().optional(),
  lines: z.array(createRecipeLineSchema).min(1),
});

export const updateRecipeSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  menuItemId: z.string().uuid().nullable().optional(),
  version: z.string().max(16).optional(),
  portionSize: z.string().max(64).nullable().optional(),
  active: z.boolean().optional(),
  lines: z.array(createRecipeLineSchema).min(1).optional(),
});

export const createStockAdjustmentSchema = branchCodeSchema.extend({
  ingredientId: z.string().uuid(),
  type: adjustmentTypeSchema,
  qty: z.number().int().positive(),
  reason: z.string().min(1).max(256),
  requestedBy: z.string().max(120).optional(),
});

export const updateAdjustmentStatusSchema = z.object({
  status: approvalStatusSchema,
});

export const createWasteRecordSchema = branchCodeSchema.extend({
  ingredientId: z.string().uuid(),
  qty: z.number().int().positive(),
  wasteType: wasteTypeSchema,
  reason: z.string().max(256).optional(),
});

export const updateWasteStatusSchema = z.object({
  status: z.enum(["Pending", "Approved"]),
});

export const createStockCountSchema = branchCodeSchema.extend({
  type: stockCountTypeSchema,
  conductedBy: z.string().max(120).optional(),
});

export const updateStockCountLineSchema = z.object({
  ingredientId: z.string().uuid(),
  physicalQty: z.number().int().min(0),
});

export const completeStockCountSchema = z.object({
  applyAdjustments: z.boolean().optional(),
});

export const createProductionBatchSchema = branchCodeSchema.extend({
  recipeId: z.string().uuid(),
  outputQty: z.number().int().min(1).max(10_000),
  wastePct: z.number().int().min(0).max(50).optional(),
  outputIngredientId: z.string().uuid().optional(),
  outputName: z.string().min(1).max(120).optional(),
  outputDescription: z.string().max(256).optional(),
});

export type PoStatus = z.infer<typeof poStatusSchema>;
export type IngredientUnit = z.infer<typeof ingredientUnitSchema>;
export type InventoryCategory = z.infer<typeof inventoryCategorySchema>;
export type Ingredient = z.infer<typeof ingredientSchema>;
export type Supplier = z.infer<typeof supplierSchema>;
export type PurchaseOrder = z.infer<typeof purchaseOrderSchema>;
export type GoodsReceipt = z.infer<typeof goodsReceiptSchema>;
export type StockBatch = z.infer<typeof stockBatchSchema>;
export type Recipe = z.infer<typeof recipeSchema>;
export type StockAdjustment = z.infer<typeof stockAdjustmentSchema>;
export type WasteRecord = z.infer<typeof wasteRecordSchema>;
export type StockCount = z.infer<typeof stockCountSchema>;
export type InventoryDashboard = z.infer<typeof inventoryDashboardSchema>;
export type InventoryReport = z.infer<typeof inventoryReportSchema>;
export type InventoryReportQuery = z.infer<typeof inventoryReportQuerySchema>;
export type InventoryReportDateMode = (typeof INVENTORY_REPORT_DATE_MODES)[number];
export type InventoryAuditLog = z.infer<typeof inventoryAuditLogSchema>;
export type BranchInventory = z.infer<typeof branchInventorySchema>;
export type CompleteStockCount = z.infer<typeof completeStockCountSchema>;
export type CreateInventoryCategory = z.infer<typeof createInventoryCategorySchema>;
export type UpdateInventoryCategory = z.infer<typeof updateInventoryCategorySchema>;
export type CreateIngredient = z.infer<typeof createIngredientSchema>;
export type UpdateIngredient = z.infer<typeof updateIngredientSchema>;
export type CreateSupplier = z.infer<typeof createSupplierSchema>;
export type UpdateSupplier = z.infer<typeof updateSupplierSchema>;
export type CreatePurchaseOrder = z.infer<typeof createPurchaseOrderSchema>;
export type UpdatePurchaseOrderStatus = z.infer<typeof updatePurchaseOrderStatusSchema>;
export type UpdatePurchaseOrder = z.infer<typeof updatePurchaseOrderSchema>;
export type CreateGoodsReceipt = z.infer<typeof createGoodsReceiptSchema>;
export type CreateRecipe = z.infer<typeof createRecipeSchema>;
export type UpdateRecipe = z.infer<typeof updateRecipeSchema>;
export type CreateStockAdjustment = z.infer<typeof createStockAdjustmentSchema>;
export type UpdateAdjustmentStatus = z.infer<typeof updateAdjustmentStatusSchema>;
export type CreateWasteRecord = z.infer<typeof createWasteRecordSchema>;
export type UpdateWasteStatus = z.infer<typeof updateWasteStatusSchema>;
export type CreateStockCount = z.infer<typeof createStockCountSchema>;
export type UpdateStockCountLine = z.infer<typeof updateStockCountLineSchema>;
export type ProductionBatch = z.infer<typeof productionBatchSchema>;
export type ProductionBatchLine = z.infer<typeof productionBatchLineSchema>;
export type CreateProductionBatch = z.infer<typeof createProductionBatchSchema>;
