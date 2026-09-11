import { boolean, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { popsBranches } from "./operations";
import { users } from "./users";
import { pharmacyMedicines, pharmacyMedicineBatches, pharmacyPatients, pharmacySales } from "./pharmacy";
import { popsEmployees } from "./hr";
import { popsSuppliers } from "./inventory";

/**
 * Dashboard secondary indexes (Phase 2):
 * - pharmacy_dist_orders: org+branch+created, org+status, org+salesman+created
 * - pharmacy_dist_invoices: org+branch+created, org+invoiceDate, org+customer
 * - pharmacy_collections / deliveries / wholesale_returns: org+branch(+status|created)
 * - pharmacy_trade_customers: org+branch, org+outstanding
 * - pharmacy_visits: org+visitedAt; pharmacy_assignments: org+date; pharmacy_targets: org+employee+period
 * See also pharmacy.ts batch/medicine indexes; docs/PHASE_2_INDEXES.md
 */

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

/** Active pharmaceutical ingredient / generic master. */
export const pharmacyGenerics = pgTable("pharmacy_generics", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("pharmacy_generics_org_code_uidx").on(t.organizationId, t.code),
]);

/** Brand / trade-name master (optional company link). */
export const pharmacyBrands = pgTable("pharmacy_brands", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  companyId: uuid("company_id").references(() => pharmacyCompanies.id, { onDelete: "set null" }),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("pharmacy_brands_org_code_uidx").on(t.organizationId, t.code),
]);

/** Therapeutic / retail category hierarchy. */
export const pharmacyCategories = pgTable("pharmacy_categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  parentId: uuid("parent_id"),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("pharmacy_categories_org_code_uidx").on(t.organizationId, t.code),
  index("pharmacy_categories_org_parent_idx").on(t.organizationId, t.parentId),
]);

export const pharmacyDosageForms = pgTable("pharmacy_dosage_forms", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("pharmacy_dosage_forms_org_code_uidx").on(t.organizationId, t.code),
]);

export const pharmacyUnits = pgTable("pharmacy_units", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  baseUnit: text("base_unit"),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("pharmacy_units_org_code_uidx").on(t.organizationId, t.code),
]);

export const pharmacyTaxProfiles = pgTable("pharmacy_tax_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  ratePct: integer("rate_pct").notNull().default(0),
  taxType: text("tax_type").notNull().default("percentage"),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("pharmacy_tax_profiles_org_code_uidx").on(t.organizationId, t.code),
]);

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
}, (t) => [
  index("pharmacy_warehouses_org_branch_status_idx").on(t.organizationId, t.branchId, t.status),
]);

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

/** Province → Division → District sit above cities (district-level ERP geo). */
export const pharmacyProvinces = pgTable("pharmacy_provinces", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyDivisions = pgTable("pharmacy_divisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  provinceId: uuid("province_id")
    .notNull()
    .references(() => pharmacyProvinces.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyDistricts = pgTable("pharmacy_districts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  divisionId: uuid("division_id")
    .notNull()
    .references(() => pharmacyDivisions.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyCities = pgTable("pharmacy_cities", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  /** Legacy sales-region link (kept for backward compatibility). */
  territoryId: uuid("territory_id").references(() => pharmacyTerritories.id, { onDelete: "set null" }),
  districtId: uuid("district_id").references(() => pharmacyDistricts.id, { onDelete: "set null" }),
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

/** Beat territory under an area (Province…City→Area→Territory→Route). */
export const pharmacyGeoTerritories = pgTable("pharmacy_geo_territories", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  areaId: uuid("area_id")
    .notNull()
    .references(() => pharmacyAreas.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  managerEmployeeId: uuid("manager_employee_id").references(() => popsEmployees.id, {
    onDelete: "set null",
  }),
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
  geoTerritoryId: uuid("geo_territory_id").references(() => pharmacyGeoTerritories.id, {
    onDelete: "set null",
  }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  station: text("station"),
  /** Beat sequence within area (1 = first stop). */
  sequenceNo: integer("sequence_no").notNull().default(0),
  /** PJP day: 0=Sun … 6=Sat, or null = every day. */
  pjpDayOfWeek: integer("pjp_day_of_week"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  salesmanEmployeeId: uuid("salesman_employee_id").references(() => popsEmployees.id, {
    onDelete: "set null",
  }),
  branchId: uuid("branch_id").references(() => popsBranches.id, { onDelete: "set null" }),
}, (t) => [
  index("pharmacy_routes_org_status_idx").on(t.organizationId, t.status),
  index("pharmacy_routes_org_salesman_idx").on(t.organizationId, t.salesmanEmployeeId),
]);

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
}, (t) => [
  index("pharmacy_trade_customers_org_branch_idx").on(t.organizationId, t.branchId),
  index("pharmacy_trade_customers_org_outstanding_idx").on(t.organizationId, t.outstandingPkr),
]);

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
  /** Phase 8 — field operating profile (employee remains the identity). */
  branchId: uuid("branch_id").references(() => popsBranches.id, { onDelete: "set null" }),
  managerEmployeeId: uuid("manager_employee_id").references(() => popsEmployees.id, {
    onDelete: "set null",
  }),
  primaryRouteId: uuid("primary_route_id").references(() => pharmacyRoutes.id, { onDelete: "set null" }),
  geoTerritoryId: uuid("geo_territory_id").references(() => pharmacyGeoTerritories.id, {
    onDelete: "set null",
  }),
  dailyVisitTarget: integer("daily_visit_target").notNull().default(0),
  monthlySalesTargetPkr: integer("monthly_sales_target_pkr").notNull().default(0),
  monthlyCollectionTargetPkr: integer("monthly_collection_target_pkr").notNull().default(0),
  visitFrequency: text("visit_frequency"),
  workingDays: text("working_days"),
  notes: text("notes"),
}, (t) => [
  uniqueIndex("pharmacy_sf_org_employee_uq").on(t.organizationId, t.employeeId),
  index("pharmacy_sf_org_status_idx").on(t.organizationId, t.status),
  index("pharmacy_sf_org_territory_idx").on(t.organizationId, t.territoryId),
]);

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
  /**
   * Canonical Phase 4 types: OPENING_STOCK, PURCHASE, GRN, SALE, SALES_RETURN,
   * PURCHASE_RETURN, TRANSFER_OUT, TRANSFER_IN, ADJUSTMENT_IN, ADJUSTMENT_OUT,
   * DAMAGE, EXPIRY, STOCK_COUNT, RESERVATION, RELEASE, REVERSAL.
   * Legacy values (grn_in, sale_out, return_in) still exist in history and are
   * read through a normalisation map. History is never rewritten.
   */
  movementType: text("movement_type").notNull(),
  quantityDelta: integer("quantity_delta").notNull(),
  quantityAfter: integer("quantity_after").notNull().default(0),
  /** Stock state the movement applied to (available/reserved/damaged/quarantine/blocked). */
  stockState: text("stock_state").notNull().default("available"),
  /** Valuation captured at movement time so historical value never drifts. */
  unitCostPkr: integer("unit_cost_pkr").notNull().default(0),
  valuePkr: integer("value_pkr").notNull().default(0),
  referenceType: text("reference_type"),
  referenceId: text("reference_id"),
  /** Set on documents that must post exactly once. Unique per organisation. */
  idempotencyKey: text("idempotency_key"),
  /** Points at the movement this row reverses. Corrections never edit history. */
  reversesMovementId: uuid("reverses_movement_id"),
  notes: text("notes"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("pharmacy_stock_movements_org_branch_created_idx").on(t.organizationId, t.branchId, t.createdAt),
  index("pharmacy_stock_movements_medicine_created_idx").on(t.medicineId, t.createdAt),
  index("pharmacy_stock_movements_wh_created_idx").on(t.warehouseId, t.createdAt),
  index("pharmacy_stock_movements_batch_created_idx").on(t.batchId, t.createdAt),
  index("pharmacy_stock_movements_reference_idx").on(t.referenceType, t.referenceId),
  index("pharmacy_stock_movements_type_created_idx").on(t.movementType, t.createdAt),
  /**
   * Postgres treats NULLs as distinct in unique keys, so rows without an
   * idempotency key are unconstrained while keyed postings can only land once.
   */
  uniqueIndex("pharmacy_stock_movements_idem_uq").on(t.organizationId, t.idempotencyKey),
]);

/**
 * Active stock holds. A reservation subtracts from available without moving
 * physical quantity, so the same units can never be promised twice.
 */
export const pharmacyStockReservations = pgTable("pharmacy_stock_reservations", {
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
  quantity: integer("quantity").notNull(),
  /** active | released | consumed */
  status: text("status").notNull().default("active"),
  referenceType: text("reference_type").notNull(),
  referenceId: text("reference_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("pharmacy_stock_reservations_med_status_idx").on(t.medicineId, t.status),
  index("pharmacy_stock_reservations_batch_status_idx").on(t.batchId, t.status),
  index("pharmacy_stock_reservations_ref_idx").on(t.referenceType, t.referenceId),
  index("pharmacy_stock_reservations_org_branch_status_idx").on(t.organizationId, t.branchId, t.status),
]);

/**
 * Per-branch inventory policy. Branch-null row is the organisation default.
 */
export const pharmacyInventorySettings = pgTable("pharmacy_inventory_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").references(() => popsBranches.id, { onDelete: "cascade" }),
  /** block | warn | allow — defaults to block. */
  negativeStockPolicy: text("negative_stock_policy").notNull().default("block"),
  /** Refuse to allocate batches whose expiry date has passed. */
  blockExpiredSale: boolean("block_expired_sale").notNull().default(true),
  /** Allow an operator with permission to override FEFO (always audit-logged). */
  allowFefoOverride: boolean("allow_fefo_override").notNull().default(true),
  /** Stock adjustments above this absolute value require approval. 0 = always require. */
  adjustmentApprovalThreshold: integer("adjustment_approval_threshold").notNull().default(0),
  requireAdjustmentApproval: boolean("require_adjustment_approval").notNull().default(true),
  /** Expiry ageing buckets in days, ascending. JSON array of integers. */
  expiryBucketsJson: text("expiry_buckets_json").notNull().default("[30,60,90,180]"),
  nearExpiryDays: integer("near_expiry_days").notNull().default(90),
  slowMovingDays: integer("slow_moving_days").notNull().default(90),
  /** batch_purchase_rate | product_cost_price — audited, not silently changed. */
  costingMethod: text("costing_method").notNull().default("batch_purchase_rate"),
  /** min_max | avg_consumption | reorder_level */
  reorderFormula: text("reorder_formula").notNull().default("reorder_level"),
  reorderLeadTimeDays: integer("reorder_lead_time_days").notNull().default(7),
  reorderSafetyDays: integer("reorder_safety_days").notNull().default(7),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("pharmacy_inventory_settings_org_branch_uq").on(t.organizationId, t.branchId),
]);

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
  /** Destination branch for inter-branch transfers. Null = same branch. */
  toBranchId: uuid("to_branch_id").references(() => popsBranches.id, { onDelete: "restrict" }),
  /** draft | submitted | approved | dispatched | received | completed | cancelled */
  status: text("status").notNull().default("draft"),
  transferDate: date("transfer_date"),
  reason: text("reason"),
  notes: text("notes"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  submittedByUserId: uuid("submitted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  dispatchedByUserId: uuid("dispatched_by_user_id").references(() => users.id, { onDelete: "set null" }),
  receivedByUserId: uuid("received_by_user_id").references(() => users.id, { onDelete: "set null" }),
  cancelledByUserId: uuid("cancelled_by_user_id").references(() => users.id, { onDelete: "set null" }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelReason: text("cancel_reason"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("pharmacy_stock_transfers_org_number_uq").on(t.organizationId, t.transferNumber),
  index("pharmacy_stock_transfers_org_branch_status_idx").on(t.organizationId, t.branchId, t.status),
  index("pharmacy_stock_transfers_org_created_idx").on(t.organizationId, t.createdAt),
  index("pharmacy_stock_transfers_from_wh_idx").on(t.fromWarehouseId, t.status),
  index("pharmacy_stock_transfers_to_wh_idx").on(t.toWarehouseId, t.status),
]);

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
  /** Quantity actually received at destination. Shortage = quantity - receivedQuantity. */
  receivedQuantity: integer("received_quantity").notNull().default(0),
  /** Snapshot so the destination batch can be recreated faithfully. */
  batchNumber: text("batch_number"),
  expiryDate: date("expiry_date"),
  unitCostPkr: integer("unit_cost_pkr").notNull().default(0),
  /** Batch created in the destination warehouse on receive. */
  destinationBatchId: uuid("destination_batch_id"),
  notes: text("notes"),
}, (t) => [
  index("pharmacy_stock_transfer_lines_transfer_idx").on(t.transferId),
  index("pharmacy_stock_transfer_lines_medicine_idx").on(t.medicineId),
]);

/** Stock adjustment document. Stock is never silently modified — this is the record. */
export const pharmacyStockAdjustments = pgTable("pharmacy_stock_adjustments", {
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
  adjustmentNumber: text("adjustment_number").notNull(),
  /** increase | decrease | damage | expiry | write_off | quarantine | release */
  adjustmentType: text("adjustment_type").notNull(),
  /** draft | pending_approval | approved | rejected | posted | cancelled */
  status: text("status").notNull().default("draft"),
  reason: text("reason").notNull(),
  notes: text("notes"),
  totalQuantity: integer("total_quantity").notNull().default(0),
  totalValuePkr: integer("total_value_pkr").notNull().default(0),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  rejectedByUserId: uuid("rejected_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectReason: text("reject_reason"),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("pharmacy_stock_adjustments_org_number_uq").on(t.organizationId, t.adjustmentNumber),
  index("pharmacy_stock_adjustments_org_branch_status_idx").on(t.organizationId, t.branchId, t.status),
  index("pharmacy_stock_adjustments_org_created_idx").on(t.organizationId, t.createdAt),
]);

export const pharmacyStockAdjustmentLines = pgTable("pharmacy_stock_adjustment_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  adjustmentId: uuid("adjustment_id")
    .notNull()
    .references(() => pharmacyStockAdjustments.id, { onDelete: "cascade" }),
  medicineId: uuid("medicine_id")
    .notNull()
    .references(() => pharmacyMedicines.id, { onDelete: "restrict" }),
  batchId: uuid("batch_id").references(() => pharmacyMedicineBatches.id, { onDelete: "set null" }),
  /** Signed quantity. Negative decreases stock. */
  quantity: integer("quantity").notNull(),
  /** available | damaged | quarantine | blocked — which bucket the line moves. */
  stockState: text("stock_state").notNull().default("available"),
  unitCostPkr: integer("unit_cost_pkr").notNull().default(0),
  valuePkr: integer("value_pkr").notNull().default(0),
  notes: text("notes"),
}, (t) => [
  index("pharmacy_stock_adjustment_lines_adj_idx").on(t.adjustmentId),
  index("pharmacy_stock_adjustment_lines_medicine_idx").on(t.medicineId),
]);

/** Physical / cycle stock count sheet. */
export const pharmacyStockCounts = pgTable("pharmacy_stock_counts", {
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
  countNumber: text("count_number").notNull(),
  /** full | cycle */
  countType: text("count_type").notNull().default("cycle"),
  /** draft | counting | review | posted | cancelled */
  status: text("status").notNull().default("draft"),
  /** Scope descriptor for cycle counts (company/category/rack filters). */
  scopeJson: text("scope_json"),
  notes: text("notes"),
  lineCount: integer("line_count").notNull().default(0),
  varianceQuantity: integer("variance_quantity").notNull().default(0),
  varianceValuePkr: integer("variance_value_pkr").notNull().default(0),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  postedByUserId: uuid("posted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  /** Adjustment document generated when the count was posted. */
  adjustmentId: uuid("adjustment_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("pharmacy_stock_counts_org_number_uq").on(t.organizationId, t.countNumber),
  index("pharmacy_stock_counts_org_branch_status_idx").on(t.organizationId, t.branchId, t.status),
  index("pharmacy_stock_counts_org_created_idx").on(t.organizationId, t.createdAt),
]);

export const pharmacyStockCountLines = pgTable("pharmacy_stock_count_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  countId: uuid("count_id")
    .notNull()
    .references(() => pharmacyStockCounts.id, { onDelete: "cascade" }),
  medicineId: uuid("medicine_id")
    .notNull()
    .references(() => pharmacyMedicines.id, { onDelete: "restrict" }),
  batchId: uuid("batch_id").references(() => pharmacyMedicineBatches.id, { onDelete: "set null" }),
  batchNumber: text("batch_number"),
  expiryDate: date("expiry_date"),
  /** Snapshot of system quantity when the sheet was generated. */
  systemQuantity: integer("system_quantity").notNull().default(0),
  countedQuantity: integer("counted_quantity"),
  varianceQuantity: integer("variance_quantity").notNull().default(0),
  unitCostPkr: integer("unit_cost_pkr").notNull().default(0),
  counted: boolean("counted").notNull().default(false),
  notes: text("notes"),
}, (t) => [
  index("pharmacy_stock_count_lines_count_idx").on(t.countId),
  index("pharmacy_stock_count_lines_medicine_idx").on(t.medicineId),
]);

/** Purchase requisition — Phase 6 Dist procurement demand document. */
export const pharmacyPurchaseRequisitions = pgTable(
  "pharmacy_purchase_requisitions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => popsBranches.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id").references(() => pharmacyWarehouses.id, { onDelete: "set null" }),
    reqNumber: text("req_number").notNull(),
    /** draft | submitted | approved | rejected | converted | partially_converted | cancelled */
    status: text("status").notNull().default("draft"),
    priority: text("priority").notNull().default("normal"),
    preferredSupplierId: uuid("preferred_supplier_id").references(() => popsSuppliers.id, {
      onDelete: "set null",
    }),
    requestedByUserId: uuid("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
    requiredDate: date("required_date"),
    notes: text("notes"),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectReason: text("reject_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pharmacy_purchase_reqs_org_number_uq").on(t.organizationId, t.reqNumber),
    index("pharmacy_purchase_reqs_org_status_idx").on(t.organizationId, t.status, t.createdAt),
    index("pharmacy_purchase_reqs_org_branch_idx").on(t.organizationId, t.branchId),
  ],
);

export const pharmacyPurchaseRequisitionLines = pgTable(
  "pharmacy_purchase_requisition_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requisitionId: uuid("requisition_id")
      .notNull()
      .references(() => pharmacyPurchaseRequisitions.id, { onDelete: "cascade" }),
    medicineId: uuid("medicine_id")
      .notNull()
      .references(() => pharmacyMedicines.id, { onDelete: "restrict" }),
    requestedQty: integer("requested_qty").notNull(),
    suggestedQty: integer("suggested_qty").notNull().default(0),
    /** Qty already converted onto purchase orders. */
    convertedQty: integer("converted_qty").notNull().default(0),
    preferredSupplierId: uuid("preferred_supplier_id").references(() => popsSuppliers.id, {
      onDelete: "set null",
    }),
    lastPurchasePricePkr: integer("last_purchase_price_pkr"),
    notes: text("notes"),
  },
  (t) => [
    index("pharmacy_purchase_req_lines_req_idx").on(t.requisitionId),
    index("pharmacy_purchase_req_lines_medicine_idx").on(t.medicineId),
  ],
);

export const pharmacyPurchaseOrders = pgTable(
  "pharmacy_purchase_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => popsBranches.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id").references(() => pharmacyWarehouses.id, { onDelete: "set null" }),
    supplierId: uuid("supplier_id").references(() => popsSuppliers.id, { onDelete: "set null" }),
    /** Optional source requisition. */
    requisitionId: uuid("requisition_id").references(() => pharmacyPurchaseRequisitions.id, {
      onDelete: "set null",
    }),
    poNumber: text("po_number").notNull(),
    /**
     * draft | submitted | approved | sent | supplier_confirmed | partial | received | cancelled
     * Legacy rows may still show free-form values.
     */
    status: text("status").notNull().default("draft"),
    orderDate: date("order_date").notNull(),
    expectedDate: date("expected_date"),
    notes: text("notes"),
    subtotalPkr: integer("subtotal_pkr").notNull().default(0),
    taxPkr: integer("tax_pkr").notNull().default(0),
    discountPkr: integer("discount_pkr").notNull().default(0),
    totalPkr: integer("total_pkr").notNull().default(0),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    buyerUserId: uuid("buyer_user_id").references(() => users.id, { onDelete: "set null" }),
    paymentTerms: text("payment_terms"),
    supplierReference: text("supplier_reference"),
    confirmedDeliveryDate: date("confirmed_delivery_date"),
    confirmedQtyNotes: text("confirmed_qty_notes"),
    revision: integer("revision").notNull().default(1),
    parentOrderId: uuid("parent_order_id"),
    idempotencyKey: text("idempotency_key"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pharmacy_purchase_orders_org_number_uq").on(t.organizationId, t.poNumber),
    uniqueIndex("pharmacy_purchase_orders_org_idem_uq").on(t.organizationId, t.idempotencyKey),
    index("pharmacy_purchase_orders_org_status_created_idx").on(
      t.organizationId,
      t.status,
      t.createdAt,
    ),
    index("pharmacy_purchase_orders_org_supplier_idx").on(t.organizationId, t.supplierId),
  ],
);

export const pharmacyPurchaseOrderLines = pgTable(
  "pharmacy_purchase_order_lines",
  {
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
    discountPkr: integer("discount_pkr").notNull().default(0),
    taxPkr: integer("tax_pkr").notNull().default(0),
    lineTotalPkr: integer("line_total_pkr").notNull().default(0),
    notes: text("notes"),
  },
  (t) => [index("pharmacy_po_lines_po_idx").on(t.purchaseOrderId)],
);

export const pharmacyGrns = pgTable(
  "pharmacy_grns",
  {
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
    idempotencyKey: text("idempotency_key"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    receivedByUserId: uuid("received_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pharmacy_grns_org_number_uq").on(t.organizationId, t.grnNumber),
    uniqueIndex("pharmacy_grns_org_idem_uq").on(t.organizationId, t.idempotencyKey),
    index("pharmacy_grns_org_date_idx").on(t.organizationId, t.receivedDate),
    index("pharmacy_grns_po_idx").on(t.purchaseOrderId),
  ],
);

export const pharmacyGrnLines = pgTable("pharmacy_grn_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  grnId: uuid("grn_id")
    .notNull()
    .references(() => pharmacyGrns.id, { onDelete: "cascade" }),
  medicineId: uuid("medicine_id")
    .notNull()
    .references(() => pharmacyMedicines.id, { onDelete: "restrict" }),
  batchId: uuid("batch_id").references(() => pharmacyMedicineBatches.id, { onDelete: "set null" }),
  purchaseOrderLineId: uuid("purchase_order_line_id"),
  batchNumber: text("batch_number").notNull(),
  manufacturingDate: date("manufacturing_date"),
  expiryDate: date("expiry_date").notNull(),
  quantity: integer("quantity").notNull(),
  freeQuantity: integer("free_quantity").notNull().default(0),
  unitCostPkr: integer("unit_cost_pkr").notNull().default(0),
  lineTotalPkr: integer("line_total_pkr").notNull().default(0),
});

/** Documentary purchase invoice — AP already posts at GRN via JV (Phase 6 match layer). */
export const pharmacyPurchaseInvoices = pgTable(
  "pharmacy_purchase_invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => popsBranches.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => popsSuppliers.id, { onDelete: "restrict" }),
    grnId: uuid("grn_id").references(() => pharmacyGrns.id, { onDelete: "set null" }),
    purchaseOrderId: uuid("purchase_order_id").references(() => pharmacyPurchaseOrders.id, {
      onDelete: "set null",
    }),
    invoiceNumber: text("invoice_number").notNull(),
    supplierInvoiceNumber: text("supplier_invoice_number"),
    invoiceDate: date("invoice_date").notNull(),
    dueDate: date("due_date"),
    /** draft | posted | cancelled */
    status: text("status").notNull().default("draft"),
    subtotalPkr: integer("subtotal_pkr").notNull().default(0),
    discountPkr: integer("discount_pkr").notNull().default(0),
    taxPkr: integer("tax_pkr").notNull().default(0),
    totalPkr: integer("total_pkr").notNull().default(0),
    amountPaidPkr: integer("amount_paid_pkr").notNull().default(0),
    notes: text("notes"),
    /**
     * Pharmacy GRNs already post AP via recordPurchaseFromPharmacyGrn (JV).
     * Posted invoices here are documentary three-way match only unless explicitly
     * wired to a second AP entry (not done by default to avoid double posting).
     */
    accountingNote: text("accounting_note"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pharmacy_purchase_invoices_org_number_uq").on(t.organizationId, t.invoiceNumber),
    index("pharmacy_purchase_invoices_org_status_idx").on(t.organizationId, t.status, t.createdAt),
    index("pharmacy_purchase_invoices_supplier_idx").on(t.organizationId, t.supplierId),
  ],
);

export const pharmacyPurchaseInvoiceLines = pgTable(
  "pharmacy_purchase_invoice_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => pharmacyPurchaseInvoices.id, { onDelete: "cascade" }),
    medicineId: uuid("medicine_id")
      .notNull()
      .references(() => pharmacyMedicines.id, { onDelete: "restrict" }),
    grnLineId: uuid("grn_line_id"),
    quantity: integer("quantity").notNull(),
    unitCostPkr: integer("unit_cost_pkr").notNull().default(0),
    discountPkr: integer("discount_pkr").notNull().default(0),
    taxPkr: integer("tax_pkr").notNull().default(0),
    lineTotalPkr: integer("line_total_pkr").notNull().default(0),
  },
  (t) => [index("pharmacy_purchase_invoice_lines_inv_idx").on(t.invoiceId)],
);

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

export const pharmacyPurchaseReturns = pgTable(
  "pharmacy_purchase_returns",
  {
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
  },
  (t) => [
    uniqueIndex("pharmacy_purchase_returns_org_number_uq").on(t.organizationId, t.returnNumber),
    index("pharmacy_purchase_returns_org_created_idx").on(t.organizationId, t.createdAt),
  ],
);

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
  creditOverrideReason: text("credit_override_reason"),
  creditOverrideByUserId: uuid("credit_override_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  creditOverrideAt: timestamp("credit_override_at", { withTimezone: true }),
  /** Client book idempotency; Postgres NULLs are distinct so unset keys do not collide. */
  idempotencyKey: text("idempotency_key"),
  notes: text("notes"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  bookedAt: timestamp("booked_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  stockReservedAt: timestamp("stock_reserved_at", { withTimezone: true }),
  invoicedAt: timestamp("invoiced_at", { withTimezone: true }),
  pickingAt: timestamp("picking_at", { withTimezone: true }),
  packedAt: timestamp("packed_at", { withTimezone: true }),
  readyAt: timestamp("ready_at", { withTimezone: true }),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("pharmacy_dist_orders_org_branch_created_idx").on(t.organizationId, t.branchId, t.createdAt),
  index("pharmacy_dist_orders_org_status_idx").on(t.organizationId, t.status),
  index("pharmacy_dist_orders_org_salesman_created_idx").on(
    t.organizationId,
    t.salesmanEmployeeId,
    t.createdAt,
  ),
  uniqueIndex("pharmacy_dist_orders_org_idem_uq").on(t.organizationId, t.idempotencyKey),
]);

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
}, (t) => [
  index("pharmacy_dist_invoices_org_branch_created_idx").on(t.organizationId, t.branchId, t.createdAt),
  index("pharmacy_dist_invoices_org_invoice_date_idx").on(t.organizationId, t.invoiceDate),
  index("pharmacy_dist_invoices_org_customer_idx").on(t.organizationId, t.tradeCustomerId),
]);

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

/**
 * Fleet masters (Phase 7). Defined before deliveries so delivery FKs can reference them.
 * Vehicles have no driver FK to avoid circular references; drivers may point at a vehicle.
 */
export const pharmacyVehicles = pgTable("pharmacy_vehicles", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").references(() => popsBranches.id, { onDelete: "set null" }),
  code: text("code").notNull(),
  registrationNo: text("registration_no").notNull(),
  vehicleType: text("vehicle_type"),
  /** available | assigned | on_route | maintenance | inactive */
  status: text("status").notNull().default("available"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("pharmacy_vehicles_org_code_uq").on(t.organizationId, t.code),
  index("pharmacy_vehicles_org_status_idx").on(t.organizationId, t.status),
]);

export const pharmacyDrivers = pgTable("pharmacy_drivers", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").references(() => popsBranches.id, { onDelete: "set null" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  /** active | inactive */
  status: text("status").notNull().default("active"),
  vehicleId: uuid("vehicle_id").references(() => pharmacyVehicles.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("pharmacy_drivers_org_code_uq").on(t.organizationId, t.code),
  index("pharmacy_drivers_org_status_idx").on(t.organizationId, t.status),
]);

/**
 * Delivery tickets (Phase 7 hardened). Evolves existing pharmacy_deliveries —
 * not a second sales/invoice system. Legacy riderName kept for backwards compat.
 */
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
  /** Legacy free-text rider; prefer driverId when set. */
  riderName: text("rider_name"),
  driverId: uuid("driver_id").references(() => pharmacyDrivers.id, { onDelete: "set null" }),
  vehicleId: uuid("vehicle_id").references(() => pharmacyVehicles.id, { onDelete: "set null" }),
  warehouseId: uuid("warehouse_id").references(() => pharmacyWarehouses.id, { onDelete: "set null" }),
  routeId: uuid("route_id").references(() => pharmacyRoutes.id, { onDelete: "set null" }),
  priority: text("priority").default("normal"),
  address: text("address"),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  receiverName: text("receiver_name"),
  signatureRef: text("signature_ref"),
  photoRef: text("photo_ref"),
  refusalReason: text("refusal_reason"),
  /** pending | ready | dispatched | out_for_delivery | delivered | partial | failed | refused | cancelled */
  status: text("status").notNull().default("pending"),
  failedReason: text("failed_reason"),
  podNotes: text("pod_notes"),
  /** Informational only — real AR posting goes through pharmacy_collections. */
  collectedPkr: integer("collected_pkr").notNull().default(0),
  idempotencyKey: text("idempotency_key"),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  outForDeliveryAt: timestamp("out_for_delivery_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("pharmacy_deliveries_org_number_uq").on(t.organizationId, t.deliveryNumber),
  uniqueIndex("pharmacy_deliveries_org_idem_uq").on(t.organizationId, t.idempotencyKey),
  index("pharmacy_deliveries_org_branch_status_idx").on(t.organizationId, t.branchId, t.status),
  index("pharmacy_deliveries_org_created_idx").on(t.organizationId, t.createdAt),
  index("pharmacy_deliveries_org_customer_idx").on(t.organizationId, t.tradeCustomerId),
  index("pharmacy_deliveries_org_driver_idx").on(t.organizationId, t.driverId),
]);

export const pharmacyDeliveryLines = pgTable("pharmacy_delivery_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  deliveryId: uuid("delivery_id")
    .notNull()
    .references(() => pharmacyDeliveries.id, { onDelete: "cascade" }),
  medicineId: uuid("medicine_id").references(() => pharmacyMedicines.id, { onDelete: "set null" }),
  productLabel: text("product_label"),
  batchId: uuid("batch_id").references(() => pharmacyMedicineBatches.id, { onDelete: "set null" }),
  batchNumber: text("batch_number"),
  quantity: integer("quantity").notNull().default(0),
  deliveredQty: integer("delivered_qty").notNull().default(0),
  returnedQty: integer("returned_qty").notNull().default(0),
  notes: text("notes"),
}, (t) => [
  index("pharmacy_delivery_lines_delivery_idx").on(t.deliveryId),
]);

/**
 * Collections (Phase 7 hardened). Optional legacy invoiceId kept for single-invoice
 * posts; multi-invoice posting uses pharmacy_collection_allocations.
 * Advance collections: advance=true → unallocatedPkr=amount, outstanding NOT reduced
 * until allocate endpoint runs.
 */
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
  /** Legacy single-invoice FK; prefer allocations table for multi-invoice. */
  invoiceId: uuid("invoice_id").references(() => pharmacyDistInvoices.id, { onDelete: "set null" }),
  patientId: uuid("patient_id").references(() => pharmacyPatients.id, { onDelete: "set null" }),
  amountPkr: integer("amount_pkr").notNull(),
  paymentMethod: text("payment_method").notNull().default("Cash"),
  chequeNumber: text("cheque_number"),
  chequeBank: text("cheque_bank"),
  chequeDate: date("cheque_date"),
  /** pending | deposited | cleared | bounced | cancelled */
  chequeStatus: text("cheque_status"),
  /** Portion not yet allocated to invoices (advances). */
  unallocatedPkr: integer("unallocated_pkr").notNull().default(0),
  salesmanEmployeeId: uuid("salesman_employee_id").references(() => popsEmployees.id, {
    onDelete: "set null",
  }),
  notes: text("notes"),
  idempotencyKey: text("idempotency_key"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("pharmacy_collections_org_number_uq").on(t.organizationId, t.collectionNumber),
  uniqueIndex("pharmacy_collections_org_idem_uq").on(t.organizationId, t.idempotencyKey),
  index("pharmacy_collections_org_branch_created_idx").on(t.organizationId, t.branchId, t.createdAt),
  index("pharmacy_collections_org_customer_idx").on(t.organizationId, t.tradeCustomerId),
  index("pharmacy_collections_org_cheque_status_idx").on(t.organizationId, t.chequeStatus),
]);

export const pharmacyCollectionAllocations = pgTable("pharmacy_collection_allocations", {
  id: uuid("id").defaultRandom().primaryKey(),
  collectionId: uuid("collection_id")
    .notNull()
    .references(() => pharmacyCollections.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => pharmacyDistInvoices.id, { onDelete: "restrict" }),
  amountPkr: integer("amount_pkr").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("pharmacy_collection_alloc_collection_idx").on(t.collectionId),
  index("pharmacy_collection_alloc_invoice_idx").on(t.invoiceId),
]);

/** Optional promise-to-pay for recovery queue follow-up. */
export const pharmacyPromisesToPay = pgTable("pharmacy_promises_to_pay", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").references(() => popsBranches.id, { onDelete: "set null" }),
  promiseNumber: text("promise_number").notNull(),
  tradeCustomerId: uuid("trade_customer_id")
    .notNull()
    .references(() => pharmacyTradeCustomers.id, { onDelete: "restrict" }),
  invoiceId: uuid("invoice_id").references(() => pharmacyDistInvoices.id, { onDelete: "set null" }),
  promisedAmountPkr: integer("promised_amount_pkr").notNull(),
  promiseDate: date("promise_date").notNull(),
  /** open | kept | broken | cancelled */
  status: text("status").notNull().default("open"),
  notes: text("notes"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("pharmacy_promises_org_number_uq").on(t.organizationId, t.promiseNumber),
  index("pharmacy_promises_org_customer_idx").on(t.organizationId, t.tradeCustomerId),
  index("pharmacy_promises_org_status_date_idx").on(t.organizationId, t.status, t.promiseDate),
]);

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
}, (t) => [
  index("pharmacy_assignments_org_date_idx").on(t.organizationId, t.assignmentDate),
]);

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
  isOutstation: boolean("is_outstation").notNull().default(false),
  orderId: uuid("order_id").references(() => pharmacyDistOrders.id, { onDelete: "set null" }),
  collectionId: uuid("collection_id").references(() => pharmacyCollections.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  visitNumber: text("visit_number"),
  plannedDate: date("planned_date"),
  plannedSequence: integer("planned_sequence").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  outcome: text("outcome"),
  contactPerson: text("contact_person"),
  customerFeedback: text("customer_feedback"),
  followUpRequired: boolean("follow_up_required").notNull().default(false),
  followUpDate: date("follow_up_date"),
  followUpAction: text("follow_up_action"),
  nextVisitDate: date("next_visit_date"),
  pjpId: uuid("pjp_id"),
  pjpVersion: integer("pjp_version"),
  routeId: uuid("route_id").references(() => pharmacyRoutes.id, { onDelete: "set null" }),
  territoryId: uuid("territory_id").references(() => pharmacyTerritories.id, { onDelete: "set null" }),
  branchId: uuid("branch_id").references(() => popsBranches.id, { onDelete: "set null" }),
  rescheduledFromId: uuid("rescheduled_from_id"),
  reason: text("reason"),
  latitude: text("latitude"),
  longitude: text("longitude"),
  locationAccuracy: text("location_accuracy"),
  locationCapturedAt: timestamp("location_captured_at", { withTimezone: true }),
  idempotencyKey: text("idempotency_key"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
}, (t) => [
  index("pharmacy_visits_org_visited_idx").on(t.organizationId, t.visitedAt),
  uniqueIndex("pharmacy_visits_org_number_uq").on(t.organizationId, t.visitNumber),
  uniqueIndex("pharmacy_visits_org_idem_uq").on(t.organizationId, t.idempotencyKey),
  uniqueIndex("pharmacy_visits_plan_uq").on(
    t.organizationId,
    t.employeeId,
    t.tradeCustomerId,
    t.plannedDate,
  ),
  index("pharmacy_visits_org_emp_date_idx").on(t.organizationId, t.employeeId, t.plannedDate),
  index("pharmacy_visits_org_status_date_idx").on(t.organizationId, t.status, t.plannedDate),
  index("pharmacy_visits_org_customer_idx").on(t.organizationId, t.tradeCustomerId),
]);

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
  targetNumber: text("target_number"),
  territoryId: uuid("territory_id").references(() => pharmacyTerritories.id, { onDelete: "set null" }),
  routeId: uuid("route_id").references(() => pharmacyRoutes.id, { onDelete: "set null" }),
  branchId: uuid("branch_id").references(() => popsBranches.id, { onDelete: "set null" }),
  targetVisits: integer("target_visits").notNull().default(0),
  scopeType: text("scope_type").notNull().default("salesman"),
  version: integer("version").notNull().default(1),
  previousTargetId: uuid("previous_target_id"),
  changeReason: text("change_reason"),
  status: text("status").notNull().default("active"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
}, (t) => [
  index("pharmacy_targets_org_employee_period_idx").on(
    t.organizationId,
    t.employeeId,
    t.periodStart,
    t.periodEnd,
  ),
  uniqueIndex("pharmacy_targets_org_number_uq").on(t.organizationId, t.targetNumber),
  index("pharmacy_targets_org_scope_period_idx").on(
    t.organizationId,
    t.scopeType,
    t.periodStart,
    t.periodEnd,
  ),
]);

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
  priority: integer("priority").notNull().default(0),
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

/** Wholesale / distribution invoice returns (RTV from retailer). */
export const pharmacyWholesaleReturns = pgTable("pharmacy_wholesale_returns", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  returnNumber: text("return_number").notNull(),
  invoiceId: uuid("invoice_id").references(() => pharmacyDistInvoices.id, { onDelete: "set null" }),
  tradeCustomerId: uuid("trade_customer_id")
    .notNull()
    .references(() => pharmacyTradeCustomers.id, { onDelete: "restrict" }),
  warehouseId: uuid("warehouse_id").references(() => pharmacyWarehouses.id, { onDelete: "set null" }),
  reason: text("reason"),
  totalPkr: integer("total_pkr").notNull().default(0),
  status: text("status").notNull().default("posted"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("pharmacy_wholesale_returns_org_branch_created_idx").on(
    t.organizationId,
    t.branchId,
    t.createdAt,
  ),
]);

export const pharmacyWholesaleReturnLines = pgTable("pharmacy_wholesale_return_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  returnId: uuid("return_id")
    .notNull()
    .references(() => pharmacyWholesaleReturns.id, { onDelete: "cascade" }),
  medicineId: uuid("medicine_id")
    .notNull()
    .references(() => pharmacyMedicines.id, { onDelete: "restrict" }),
  batchId: uuid("batch_id").references(() => pharmacyMedicineBatches.id, { onDelete: "set null" }),
  quantity: integer("quantity").notNull(),
  unitPricePkr: integer("unit_price_pkr").notNull().default(0),
  lineTotalPkr: integer("line_total_pkr").notNull().default(0),
});

/** Phase 8 — extra routes beyond the salesman's primary route. */
export const pharmacySalesmanRoutes = pgTable("pharmacy_salesman_routes", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => popsEmployees.id, { onDelete: "cascade" }),
  routeId: uuid("route_id")
    .notNull()
    .references(() => pharmacyRoutes.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("pharmacy_salesman_routes_uq").on(t.organizationId, t.employeeId, t.routeId),
]);

/** Ordered customers on a route (practical visit sequence — not GPS-optimized). */
export const pharmacyRouteCustomers = pgTable("pharmacy_route_customers", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  routeId: uuid("route_id")
    .notNull()
    .references(() => pharmacyRoutes.id, { onDelete: "cascade" }),
  tradeCustomerId: uuid("trade_customer_id")
    .notNull()
    .references(() => pharmacyTradeCustomers.id, { onDelete: "cascade" }),
  sequenceNo: integer("sequence_no").notNull().default(0),
  preferredVisitDay: integer("preferred_visit_day"),
  visitFrequency: text("visit_frequency").notNull().default("weekly"),
  priority: text("priority").notNull().default("normal"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("pharmacy_route_customers_uq").on(t.organizationId, t.routeId, t.tradeCustomerId),
  index("pharmacy_route_customers_route_seq_idx").on(t.routeId, t.sequenceNo),
]);

export const pharmacyPjps = pgTable("pharmacy_pjps", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").references(() => popsBranches.id, { onDelete: "set null" }),
  pjpNumber: text("pjp_number").notNull(),
  name: text("name").notNull(),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => popsEmployees.id, { onDelete: "restrict" }),
  territoryId: uuid("territory_id").references(() => pharmacyTerritories.id, { onDelete: "set null" }),
  routeId: uuid("route_id").references(() => pharmacyRoutes.id, { onDelete: "set null" }),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  status: text("status").notNull().default("active"),
  frequency: text("frequency").notNull().default("weekly"),
  workingDays: text("working_days"),
  version: integer("version").notNull().default(1),
  previousPjpId: uuid("previous_pjp_id"),
  changeReason: text("change_reason"),
  notes: text("notes"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("pharmacy_pjps_org_number_uq").on(t.organizationId, t.pjpNumber),
  index("pharmacy_pjps_org_emp_status_idx").on(t.organizationId, t.employeeId, t.status),
  index("pharmacy_pjps_org_effective_idx").on(t.organizationId, t.effectiveFrom, t.effectiveTo),
]);

export const pharmacyPjpLines = pgTable("pharmacy_pjp_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  pjpId: uuid("pjp_id")
    .notNull()
    .references(() => pharmacyPjps.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week"),
  tradeCustomerId: uuid("trade_customer_id")
    .notNull()
    .references(() => pharmacyTradeCustomers.id, { onDelete: "restrict" }),
  routeId: uuid("route_id").references(() => pharmacyRoutes.id, { onDelete: "set null" }),
  sequenceNo: integer("sequence_no").notNull().default(0),
  visitType: text("visit_type").notNull().default("regular"),
  priority: text("priority").notNull().default("normal"),
  plannedDurationMin: integer("planned_duration_min"),
  notes: text("notes"),
}, (t) => [
  index("pharmacy_pjp_lines_pjp_day_idx").on(t.pjpId, t.dayOfWeek, t.sequenceNo),
]);

/** Shared Dist import/export jobs. No second import engine per module. */
export const pharmacyIoJobs = pgTable(
  "pharmacy_io_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references(() => popsBranches.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    kind: text("kind").notNull(), // import | export
    module: text("module").notNull(),
    fileName: text("file_name"),
    status: text("status").notNull().default("queued"),
    totalRows: integer("total_rows").notNull().default(0),
    importedRows: integer("imported_rows").notNull().default(0),
    failedRows: integer("failed_rows").notNull().default(0),
    duplicateRows: integer("duplicate_rows").notNull().default(0),
    skippedRows: integer("skipped_rows").notNull().default(0),
    mappingJson: text("mapping_json"),
    errorJson: text("error_json"),
    filtersJson: text("filters_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("pharmacy_io_jobs_org_created_idx").on(t.organizationId, t.createdAt)],
);

export const pharmacyFieldForceAudits = pgTable("pharmacy_field_force_audits", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  action: text("action").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  reason: text("reason"),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("pharmacy_ff_audits_org_entity_idx").on(t.organizationId, t.entityType, t.entityId),
]);
