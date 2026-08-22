import { boolean, date, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { popsBranches } from "./operations";
import { popsMenuItems } from "./menu";

export const popsInventoryCategories = pgTable("pops_inventory_categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsIngredients = pgTable("pops_ingredients", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  categoryId: uuid("category_id").references(() => popsInventoryCategories.id, { onDelete: "set null" }),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  unit: text("unit").notNull(),
  currentStock: integer("current_stock").notNull().default(0),
  minStock: integer("min_stock").notNull().default(0),
  reorderLevel: integer("reorder_level").notNull().default(0),
  maxStock: integer("max_stock").notNull().default(0),
  unitCostPkr: integer("unit_cost_pkr").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsSuppliers = pgTable("pops_suppliers", {
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
  paymentTerms: text("payment_terms"),
  openingBalancePkr: integer("opening_balance_pkr").notNull().default(0),
  onboardedDate: date("onboarded_date"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsPurchaseOrders = pgTable("pops_purchase_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  poNumber: text("po_number").notNull(),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => popsSuppliers.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("Draft"),
  totalAmountPkr: integer("total_amount_pkr").notNull().default(0),
  expectedDate: date("expected_date"),
  requestedBy: text("requested_by"),
  chef: text("chef"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsPurchaseOrderLines = pgTable("pops_purchase_order_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  purchaseOrderId: uuid("purchase_order_id")
    .notNull()
    .references(() => popsPurchaseOrders.id, { onDelete: "cascade" }),
  ingredientId: uuid("ingredient_id")
    .notNull()
    .references(() => popsIngredients.id, { onDelete: "restrict" }),
  qty: integer("qty").notNull(),
  unit: text("unit").notNull(),
  unitCostPkr: integer("unit_cost_pkr").notNull().default(0),
  receivedQty: integer("received_qty").notNull().default(0),
});

export const popsGoodsReceipts = pgTable("pops_goods_receipts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  grnNumber: text("grn_number").notNull(),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => popsSuppliers.id, { onDelete: "restrict" }),
  purchaseOrderId: uuid("purchase_order_id").references(() => popsPurchaseOrders.id, {
    onDelete: "set null",
  }),
  invoiceNumber: text("invoice_number"),
  deliveryDate: date("delivery_date").notNull(),
  totalCostPkr: integer("total_cost_pkr").notNull().default(0),
  receivedBy: text("received_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsGoodsReceiptLines = pgTable("pops_goods_receipt_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  goodsReceiptId: uuid("goods_receipt_id")
    .notNull()
    .references(() => popsGoodsReceipts.id, { onDelete: "cascade" }),
  ingredientId: uuid("ingredient_id")
    .notNull()
    .references(() => popsIngredients.id, { onDelete: "restrict" }),
  qty: integer("qty").notNull(),
  unit: text("unit").notNull(),
  unitCostPkr: integer("unit_cost_pkr").notNull().default(0),
  batchNumber: text("batch_number"),
  expiryDate: date("expiry_date"),
});

export const popsStockBatches = pgTable("pops_stock_batches", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  ingredientId: uuid("ingredient_id")
    .notNull()
    .references(() => popsIngredients.id, { onDelete: "cascade" }),
  qty: integer("qty").notNull(),
  batchNumber: text("batch_number"),
  expiryDate: date("expiry_date"),
  location: text("location").notNull().default("Main store"),
  unitCostPkr: integer("unit_cost_pkr").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsRecipes = pgTable("pops_recipes", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  menuItemId: uuid("menu_item_id").references(() => popsMenuItems.id, { onDelete: "set null" }),
  version: text("version").notNull().default("v1.0"),
  portionSize: text("portion_size"),
  totalCostPkr: integer("total_cost_pkr").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsRecipeLines = pgTable("pops_recipe_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  recipeId: uuid("recipe_id")
    .notNull()
    .references(() => popsRecipes.id, { onDelete: "cascade" }),
  ingredientId: uuid("ingredient_id")
    .notNull()
    .references(() => popsIngredients.id, { onDelete: "restrict" }),
  qty: integer("qty").notNull(),
  unit: text("unit").notNull(),
});

export const popsStockAdjustments = pgTable("pops_stock_adjustments", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  ingredientId: uuid("ingredient_id")
    .notNull()
    .references(() => popsIngredients.id, { onDelete: "restrict" }),
  type: text("type").notNull(),
  qty: integer("qty").notNull(),
  unit: text("unit").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("Pending"),
  requestedBy: text("requested_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsWasteRecords = pgTable("pops_waste_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  ingredientId: uuid("ingredient_id")
    .notNull()
    .references(() => popsIngredients.id, { onDelete: "restrict" }),
  qty: integer("qty").notNull(),
  unit: text("unit").notNull(),
  wasteType: text("waste_type").notNull(),
  reason: text("reason"),
  costImpactPkr: integer("cost_impact_pkr").notNull().default(0),
  status: text("status").notNull().default("Pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsStockCounts = pgTable("pops_stock_counts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  countNumber: text("count_number").notNull(),
  type: text("type").notNull(),
  countDate: date("count_date").notNull(),
  status: text("status").notNull().default("In Progress"),
  itemsCounted: integer("items_counted").notNull().default(0),
  variances: integer("variances").notNull().default(0),
  conductedBy: text("conducted_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsStockCountLines = pgTable("pops_stock_count_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  stockCountId: uuid("stock_count_id")
    .notNull()
    .references(() => popsStockCounts.id, { onDelete: "cascade" }),
  ingredientId: uuid("ingredient_id")
    .notNull()
    .references(() => popsIngredients.id, { onDelete: "restrict" }),
  systemQty: integer("system_qty").notNull(),
  physicalQty: integer("physical_qty").notNull(),
});

export const popsProductionBatches = pgTable("pops_production_batches", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  batchRef: text("batch_ref").notNull(),
  recipeId: uuid("recipe_id").references(() => popsRecipes.id, { onDelete: "set null" }),
  outputName: text("output_name").notNull(),
  outputDescription: text("output_description"),
  outputIngredientId: uuid("output_ingredient_id").references(() => popsIngredients.id, {
    onDelete: "set null",
  }),
  outputQty: integer("output_qty").notNull().default(1),
  wastePct: integer("waste_pct").notNull().default(0),
  totalCostPkr: integer("total_cost_pkr").notNull().default(0),
  unitCostPkr: integer("unit_cost_pkr").notNull().default(0),
  status: text("status").notNull().default("Draft"),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  postedBy: text("posted_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsProductionBatchLines = pgTable("pops_production_batch_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  batchId: uuid("batch_id")
    .notNull()
    .references(() => popsProductionBatches.id, { onDelete: "cascade" }),
  ingredientId: uuid("ingredient_id")
    .notNull()
    .references(() => popsIngredients.id, { onDelete: "restrict" }),
  qty: integer("qty").notNull(),
  unit: text("unit").notNull(),
  unitCostPkr: integer("unit_cost_pkr").notNull().default(0),
  costPkr: integer("cost_pkr").notNull().default(0),
});

export const popsInventoryAuditLogs = pgTable("pops_inventory_audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  userEmail: text("user_email").notNull(),
  action: text("action").notNull(),
  module: text("module").notNull(),
  detail: text("detail").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
