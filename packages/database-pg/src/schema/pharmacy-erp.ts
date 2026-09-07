import { boolean, date, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { popsBranches } from "./operations";
import { users } from "./users";
import { pharmacyMedicines, pharmacyMedicineBatches, pharmacyPatients, pharmacySales } from "./pharmacy";
import { popsEmployees } from "./hr";
import { popsSuppliers } from "./inventory";

/** Manufacturer / marketing company master. */
export const pharmacyCompanies = pgTable("pharmacy_companies", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  manufacturerName: text("manufacturer_name"),
  contactPerson: text("contact_person"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  city: text("city"),
  country: text("country").default("Pakistan"),
  licenseInfo: text("license_info"),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyWarehouses = pgTable("pharmacy_warehouses", {
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
  city: text("city"),
  area: text("area"),
  managerName: text("manager_name"),
  isDefault: boolean("is_default").notNull().default(false),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyTerritories = pgTable("pharmacy_territories", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  region: text("region"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyCities = pgTable("pharmacy_cities", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  territoryId: uuid("territory_id").references(() => pharmacyTerritories.id, { onDelete: "set null" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyAreas = pgTable("pharmacy_areas", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  cityId: uuid("city_id")
    .notNull()
    .references(() => pharmacyCities.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  sector: text("sector"),
  market: text("market"),
  isOutstation: boolean("is_outstation").notNull().default(false),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyRoutes = pgTable("pharmacy_routes", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  areaId: uuid("area_id")
    .notNull()
    .references(() => pharmacyAreas.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  station: text("station"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyTradeCustomers = pgTable("pharmacy_trade_customers", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").references(() => popsBranches.id, { onDelete: "set null" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  businessName: text("business_name"),
  customerType: text("customer_type").notNull().default("Retailer"),
  phone: text("phone"),
  whatsapp: text("whatsapp"),
  email: text("email"),
  address: text("address"),
  cityId: uuid("city_id").references(() => pharmacyCities.id, { onDelete: "set null" }),
  areaId: uuid("area_id").references(() => pharmacyAreas.id, { onDelete: "set null" }),
  territoryId: uuid("territory_id").references(() => pharmacyTerritories.id, { onDelete: "set null" }),
  routeId: uuid("route_id").references(() => pharmacyRoutes.id, { onDelete: "set null" }),
  salesmanEmployeeId: uuid("salesman_employee_id").references(() => popsEmployees.id, {
    onDelete: "set null",
  }),
  creditLimitPkr: integer("credit_limit_pkr").notNull().default(0),
  creditDays: integer("credit_days").notNull().default(30),
  outstandingPkr: integer("outstanding_pkr").notNull().default(0),
  openingBalancePkr: integer("opening_balance_pkr").notNull().default(0),
  priceLevel: text("price_level").notNull().default("retail"),
  discountPct: integer("discount_pct").notNull().default(0),
  taxInfo: text("tax_info"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacySalesForceProfiles = pgTable("pharmacy_sales_force_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => popsEmployees.id, { onDelete: "cascade" }),
  fieldRole: text("field_role").notNull().default("Salesman"),
  territoryId: uuid("territory_id").references(() => pharmacyTerritories.id, { onDelete: "set null" }),
  cityId: uuid("city_id").references(() => pharmacyCities.id, { onDelete: "set null" }),
  areaId: uuid("area_id").references(() => pharmacyAreas.id, { onDelete: "set null" }),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyStockMovements = pgTable("pharmacy_stock_movements", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  warehouseId: uuid("warehouse_id").references(() => pharmacyWarehouses.id, { onDelete: "set null" }),
  medicineId: uuid("medicine_id")
    .notNull()
    .references(() => pharmacyMedicines.id, { onDelete: "restrict" }),
  batchId: uuid("batch_id").references(() => pharmacyMedicineBatches.id, { onDelete: "set null" }),
  movementType: text("movement_type").notNull(),
  quantityDelta: integer("quantity_delta").notNull(),
  quantityAfter: integer("quantity_after").notNull().default(0),
  referenceType: text("reference_type"),
  referenceId: text("reference_id"),
  notes: text("notes"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyStockTransfers = pgTable("pharmacy_stock_transfers", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  transferNumber: text("transfer_number").notNull(),
  fromWarehouseId: uuid("from_warehouse_id")
    .notNull()
    .references(() => pharmacyWarehouses.id, { onDelete: "restrict" }),
  toWarehouseId: uuid("to_warehouse_id")
    .notNull()
    .references(() => pharmacyWarehouses.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("draft"),
  notes: text("notes"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyStockTransferLines = pgTable("pharmacy_stock_transfer_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  transferId: uuid("transfer_id")
    .notNull()
    .references(() => pharmacyStockTransfers.id, { onDelete: "cascade" }),
  medicineId: uuid("medicine_id")
    .notNull()
    .references(() => pharmacyMedicines.id, { onDelete: "restrict" }),
  batchId: uuid("batch_id").references(() => pharmacyMedicineBatches.id, { onDelete: "set null" }),
  quantity: integer("quantity").notNull(),
});

export const pharmacyPurchaseOrders = pgTable("pharmacy_purchase_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  supplierId: uuid("supplier_id").references(() => popsSuppliers.id, { onDelete: "set null" }),
  poNumber: text("po_number").notNull(),
  status: text("status").notNull().default("draft"),
  orderDate: date("order_date").notNull(),
  expectedDate: date("expected_date"),
  notes: text("notes"),
  subtotalPkr: integer("subtotal_pkr").notNull().default(0),
  taxPkr: integer("tax_pkr").notNull().default(0),
  discountPkr: integer("discount_pkr").notNull().default(0),
  totalPkr: integer("total_pkr").notNull().default(0),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyPurchaseOrderLines = pgTable("pharmacy_purchase_order_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  purchaseOrderId: uuid("purchase_order_id")
    .notNull()
    .references(() => pharmacyPurchaseOrders.id, { onDelete: "cascade" }),
  medicineId: uuid("medicine_id")
    .notNull()
    .references(() => pharmacyMedicines.id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull(),
  freeQuantity: integer("free_quantity").notNull().default(0),
  receivedQty: integer("received_qty").notNull().default(0),
  unitCostPkr: integer("unit_cost_pkr").notNull().default(0),
  lineTotalPkr: integer("line_total_pkr").notNull().default(0),
});

export const pharmacyGrns = pgTable("pharmacy_grns", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  warehouseId: uuid("warehouse_id")
    .notNull()
    .references(() => pharmacyWarehouses.id, { onDelete: "restrict" }),
  purchaseOrderId: uuid("purchase_order_id").references(() => pharmacyPurchaseOrders.id, {
    onDelete: "set null",
  }),
  supplierId: uuid("supplier_id").references(() => popsSuppliers.id, { onDelete: "set null" }),
  grnNumber: text("grn_number").notNull(),
  supplierInvoiceNumber: text("supplier_invoice_number"),
  receivedDate: date("received_date").notNull(),
  status: text("status").notNull().default("posted"),
  totalPkr: integer("total_pkr").notNull().default(0),
  notes: text("notes"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyGrnLines = pgTable("pharmacy_grn_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  grnId: uuid("grn_id")
    .notNull()
    .references(() => pharmacyGrns.id, { onDelete: "cascade" }),
  medicineId: uuid("medicine_id")
    .notNull()
    .references(() => pharmacyMedicines.id, { onDelete: "restrict" }),
  batchId: uuid("batch_id").references(() => pharmacyMedicineBatches.id, { onDelete: "set null" }),
  batchNumber: text("batch_number").notNull(),
  manufacturingDate: date("manufacturing_date"),
  expiryDate: date("expiry_date").notNull(),
  quantity: integer("quantity").notNull(),
  freeQuantity: integer("free_quantity").notNull().default(0),
  unitCostPkr: integer("unit_cost_pkr").notNull().default(0),
  lineTotalPkr: integer("line_total_pkr").notNull().default(0),
});

export const pharmacySaleReturns = pgTable("pharmacy_sale_returns", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  warehouseId: uuid("warehouse_id").references(() => pharmacyWarehouses.id, { onDelete: "set null" }),
  originalSaleId: uuid("original_sale_id")
    .notNull()
    .references(() => pharmacySales.id, { onDelete: "restrict" }),
  returnNumber: text("return_number").notNull(),
  reason: text("reason"),
  refundMethod: text("refund_method").notNull().default("Cash"),
  subtotalPkr: integer("subtotal_pkr").notNull().default(0),
  taxPkr: integer("tax_pkr").notNull().default(0),
  totalPkr: integer("total_pkr").notNull().default(0),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacySaleReturnLines = pgTable("pharmacy_sale_return_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  saleReturnId: uuid("sale_return_id")
    .notNull()
    .references(() => pharmacySaleReturns.id, { onDelete: "cascade" }),
  medicineId: uuid("medicine_id")
    .notNull()
    .references(() => pharmacyMedicines.id, { onDelete: "restrict" }),
  batchId: uuid("batch_id").references(() => pharmacyMedicineBatches.id, { onDelete: "set null" }),
  qty: integer("qty").notNull(),
  tabletsQty: integer("tablets_qty").notNull().default(0),
  unitPricePkr: integer("unit_price_pkr").notNull().default(0),
  lineTotalPkr: integer("line_total_pkr").notNull().default(0),
});

export const pharmacyPurchaseReturns = pgTable("pharmacy_purchase_returns", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  warehouseId: uuid("warehouse_id").references(() => pharmacyWarehouses.id, { onDelete: "set null" }),
  supplierId: uuid("supplier_id").references(() => popsSuppliers.id, { onDelete: "set null" }),
  grnId: uuid("grn_id").references(() => pharmacyGrns.id, { onDelete: "set null" }),
  returnNumber: text("return_number").notNull(),
  reason: text("reason"),
  totalPkr: integer("total_pkr").notNull().default(0),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyPurchaseReturnLines = pgTable("pharmacy_purchase_return_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  purchaseReturnId: uuid("purchase_return_id")
    .notNull()
    .references(() => pharmacyPurchaseReturns.id, { onDelete: "cascade" }),
  medicineId: uuid("medicine_id")
    .notNull()
    .references(() => pharmacyMedicines.id, { onDelete: "restrict" }),
  batchId: uuid("batch_id").references(() => pharmacyMedicineBatches.id, { onDelete: "set null" }),
  quantity: integer("quantity").notNull(),
  unitCostPkr: integer("unit_cost_pkr").notNull().default(0),
  lineTotalPkr: integer("line_total_pkr").notNull().default(0),
});

export const pharmacyDistOrders = pgTable("pharmacy_dist_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  warehouseId: uuid("warehouse_id").references(() => pharmacyWarehouses.id, { onDelete: "set null" }),
  orderNumber: text("order_number").notNull(),
  tradeCustomerId: uuid("trade_customer_id")
    .notNull()
    .references(() => pharmacyTradeCustomers.id, { onDelete: "restrict" }),
  salesmanEmployeeId: uuid("salesman_employee_id").references(() => popsEmployees.id, {
    onDelete: "set null",
  }),
  status: text("status").notNull().default("draft"),
  paymentStatus: text("payment_status").notNull().default("unpaid"),
  deliveryStatus: text("delivery_status").notNull().default("pending"),
  subtotalPkr: integer("subtotal_pkr").notNull().default(0),
  discountPkr: integer("discount_pkr").notNull().default(0),
  taxPkr: integer("tax_pkr").notNull().default(0),
  totalPkr: integer("total_pkr").notNull().default(0),
  creditOverride: boolean("credit_override").notNull().default(false),
  notes: text("notes"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyDistOrderLines = pgTable("pharmacy_dist_order_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => pharmacyDistOrders.id, { onDelete: "cascade" }),
  medicineId: uuid("medicine_id")
    .notNull()
    .references(() => pharmacyMedicines.id, { onDelete: "restrict" }),
  batchId: uuid("batch_id").references(() => pharmacyMedicineBatches.id, { onDelete: "set null" }),
  quantity: integer("quantity").notNull(),
  freeQuantity: integer("free_quantity").notNull().default(0),
  unitPricePkr: integer("unit_price_pkr").notNull().default(0),
  discountPkr: integer("discount_pkr").notNull().default(0),
  lineTotalPkr: integer("line_total_pkr").notNull().default(0),
});

export const pharmacyDistInvoices = pgTable("pharmacy_dist_invoices", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  orderId: uuid("order_id").references(() => pharmacyDistOrders.id, { onDelete: "set null" }),
  tradeCustomerId: uuid("trade_customer_id")
    .notNull()
    .references(() => pharmacyTradeCustomers.id, { onDelete: "restrict" }),
  invoiceNumber: text("invoice_number").notNull(),
  invoiceDate: date("invoice_date").notNull(),
  paymentMethod: text("payment_method").notNull().default("Credit"),
  amountPaidPkr: integer("amount_paid_pkr").notNull().default(0),
  amountDuePkr: integer("amount_due_pkr").notNull().default(0),
  subtotalPkr: integer("subtotal_pkr").notNull().default(0),
  discountPkr: integer("discount_pkr").notNull().default(0),
  taxPkr: integer("tax_pkr").notNull().default(0),
  totalPkr: integer("total_pkr").notNull().default(0),
  status: text("status").notNull().default("posted"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyDistInvoiceLines = pgTable("pharmacy_dist_invoice_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => pharmacyDistInvoices.id, { onDelete: "cascade" }),
  medicineId: uuid("medicine_id")
    .notNull()
    .references(() => pharmacyMedicines.id, { onDelete: "restrict" }),
  batchId: uuid("batch_id").references(() => pharmacyMedicineBatches.id, { onDelete: "set null" }),
  quantity: integer("quantity").notNull(),
  freeQuantity: integer("free_quantity").notNull().default(0),
  unitPricePkr: integer("unit_price_pkr").notNull().default(0),
  lineTotalPkr: integer("line_total_pkr").notNull().default(0),
});

export const pharmacyDeliveries = pgTable("pharmacy_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  deliveryNumber: text("delivery_number").notNull(),
  orderId: uuid("order_id").references(() => pharmacyDistOrders.id, { onDelete: "set null" }),
  invoiceId: uuid("invoice_id").references(() => pharmacyDistInvoices.id, { onDelete: "set null" }),
  tradeCustomerId: uuid("trade_customer_id").references(() => pharmacyTradeCustomers.id, {
    onDelete: "set null",
  }),
  riderName: text("rider_name"),
  routeId: uuid("route_id").references(() => pharmacyRoutes.id, { onDelete: "set null" }),
  status: text("status").notNull().default("pending"),
  failedReason: text("failed_reason"),
  podNotes: text("pod_notes"),
  collectedPkr: integer("collected_pkr").notNull().default(0),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyCollections = pgTable("pharmacy_collections", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  collectionNumber: text("collection_number").notNull(),
  tradeCustomerId: uuid("trade_customer_id")
    .notNull()
    .references(() => pharmacyTradeCustomers.id, { onDelete: "restrict" }),
  invoiceId: uuid("invoice_id").references(() => pharmacyDistInvoices.id, { onDelete: "set null" }),
  patientId: uuid("patient_id").references(() => pharmacyPatients.id, { onDelete: "set null" }),
  amountPkr: integer("amount_pkr").notNull(),
  paymentMethod: text("payment_method").notNull().default("Cash"),
  salesmanEmployeeId: uuid("salesman_employee_id").references(() => popsEmployees.id, {
    onDelete: "set null",
  }),
  notes: text("notes"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyAssignments = pgTable("pharmacy_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").references(() => popsBranches.id, { onDelete: "set null" }),
  assignmentDate: date("assignment_date").notNull(),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => popsEmployees.id, { onDelete: "cascade" }),
  cityId: uuid("city_id").references(() => pharmacyCities.id, { onDelete: "set null" }),
  areaId: uuid("area_id").references(() => pharmacyAreas.id, { onDelete: "set null" }),
  routeId: uuid("route_id").references(() => pharmacyRoutes.id, { onDelete: "set null" }),
  tradeCustomerId: uuid("trade_customer_id").references(() => pharmacyTradeCustomers.id, {
    onDelete: "set null",
  }),
  doctorId: uuid("doctor_id"),
  taskType: text("task_type").notNull().default("visit"),
  targetSalesPkr: integer("target_sales_pkr").notNull().default(0),
  targetCollectionPkr: integer("target_collection_pkr").notNull().default(0),
  status: text("status").notNull().default("assigned"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyVisits = pgTable("pharmacy_visits", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  assignmentId: uuid("assignment_id").references(() => pharmacyAssignments.id, { onDelete: "set null" }),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => popsEmployees.id, { onDelete: "cascade" }),
  tradeCustomerId: uuid("trade_customer_id").references(() => pharmacyTradeCustomers.id, {
    onDelete: "set null",
  }),
  doctorId: uuid("doctor_id"),
  visitedAt: timestamp("visited_at", { withTimezone: true }).notNull().defaultNow(),
  purpose: text("purpose"),
  status: text("status").notNull().default("completed"),
  productive: boolean("productive").notNull().default(false),
  orderId: uuid("order_id").references(() => pharmacyDistOrders.id, { onDelete: "set null" }),
  collectionId: uuid("collection_id").references(() => pharmacyCollections.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyTargets = pgTable("pharmacy_targets", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  periodType: text("period_type").notNull().default("monthly"),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  employeeId: uuid("employee_id").references(() => popsEmployees.id, { onDelete: "set null" }),
  cityId: uuid("city_id").references(() => pharmacyCities.id, { onDelete: "set null" }),
  companyId: uuid("company_id").references(() => pharmacyCompanies.id, { onDelete: "set null" }),
  medicineId: uuid("medicine_id").references(() => pharmacyMedicines.id, { onDelete: "set null" }),
  targetSalesPkr: integer("target_sales_pkr").notNull().default(0),
  targetCollectionPkr: integer("target_collection_pkr").notNull().default(0),
  actualSalesPkr: integer("actual_sales_pkr").notNull().default(0),
  actualCollectionPkr: integer("actual_collection_pkr").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyPriceLists = pgTable("pharmacy_price_lists", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code"),
  priceLevel: text("price_level").notNull().default("wholesale"),
  customerType: text("customer_type"),
  areaId: uuid("area_id").references(() => pharmacyAreas.id, { onDelete: "set null" }),
  tradeCustomerId: uuid("trade_customer_id").references(() => pharmacyTradeCustomers.id, {
    onDelete: "set null",
  }),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyPriceListItems = pgTable("pharmacy_price_list_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  priceListId: uuid("price_list_id")
    .notNull()
    .references(() => pharmacyPriceLists.id, { onDelete: "cascade" }),
  medicineId: uuid("medicine_id")
    .notNull()
    .references(() => pharmacyMedicines.id, { onDelete: "cascade" }),
  unitPricePkr: integer("unit_price_pkr").notNull(),
  minQty: integer("min_qty").notNull().default(1),
});

export const pharmacySchemes = pgTable("pharmacy_schemes", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code"),
  schemeType: text("scheme_type").notNull().default("buy_x_get_y"),
  medicineId: uuid("medicine_id").references(() => pharmacyMedicines.id, { onDelete: "set null" }),
  companyId: uuid("company_id").references(() => pharmacyCompanies.id, { onDelete: "set null" }),
  buyQty: integer("buy_qty").notNull().default(0),
  freeQty: integer("free_qty").notNull().default(0),
  startDate: date("start_date"),
  endDate: date("end_date"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyAuditLogs = pgTable("pharmacy_audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").references(() => popsBranches.id, { onDelete: "set null" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  oldValueJson: text("old_value_json"),
  newValueJson: text("new_value_json"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
