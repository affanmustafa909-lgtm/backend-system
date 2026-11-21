import { integer, numeric, pgTable, text, timestamp, uuid, bigint } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { popsBranches } from "./operations";
import { users } from "./users";

export const embroideryDesigns = pgTable("embroidery_designs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  customerId: uuid("customer_id"),
  stitchCount: integer("stitch_count").notNull().default(0),
  colorways: text("colorways"),
  fileName: text("file_name"),
  /** Base64-encoded DST/EMB (or other machine file). Prefer small digitizer files. */
  fileContentBase64: text("file_content_base64"),
  fileMimeType: text("file_mime_type"),
  notes: text("notes"),
  widthMm: integer("width_mm").notNull().default(0),
  heightMm: integer("height_mm").notNull().default(0),
  hoop: text("hoop"),
  workType: text("work_type").notNull().default("flat"),
  threadBrand: text("thread_brand"),
  ratePer1kPkr: integer("rate_per_1k_pkr").notNull().default(0),
  needleChartJson: text("needle_chart_json"),
  previewBase64: text("preview_base64"),
  previewMimeType: text("preview_mime_type"),
  aiAnalysisJson: text("ai_analysis_json"),
  detailsJson: text("details_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const embroideryMachines = pgTable("embroidery_machines", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  heads: integer("heads").notNull().default(1),
  status: text("status").notNull().default("idle"),
  operatorUserId: uuid("operator_user_id").references(() => users.id, { onDelete: "set null" }),
  notes: text("notes"),
  brand: text("brand"),
  model: text("model"),
  serialNumber: text("serial_number"),
  needlesPerHead: integer("needles_per_head").notNull().default(15),
  maxRpm: integer("max_rpm").notNull().default(0),
  hoopSizes: text("hoop_sizes"),
  attachments: text("attachments"),
  powerStatus: text("power_status").notNull().default("ok"),
  feedStatus: text("feed_status").notNull().default("ok"),
  beamBufferNotes: text("beam_buffer_notes"),
  factoryOperatorId: uuid("factory_operator_id"),
  currentDesignId: uuid("current_design_id"),
  locationBay: text("location_bay"),
  lastServiceDate: text("last_service_date"),
  nextServiceDate: text("next_service_date"),
  runHours: integer("run_hours").notNull().default(0),
  stitchCounter: bigint("stitch_counter", { mode: "number" }).notNull().default(0),
  detailsJson: text("details_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const embroideryCustomerOrders = pgTable("embroidery_customer_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  orderNumber: text("order_number").notNull(),
  customerId: uuid("customer_id").notNull(),
  designId: uuid("design_id").references(() => embroideryDesigns.id, { onDelete: "set null" }),
  status: text("status").notNull().default("draft"),
  dueDate: text("due_date"),
  quantity: integer("quantity").notNull().default(1),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const embroideryJobs = pgTable("embroidery_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  jobNumber: text("job_number").notNull(),
  customerId: uuid("customer_id"),
  customerOrderId: uuid("customer_order_id").references(() => embroideryCustomerOrders.id, {
    onDelete: "set null",
  }),
  designId: uuid("design_id").references(() => embroideryDesigns.id, { onDelete: "set null" }),
  machineId: uuid("machine_id").references(() => embroideryMachines.id, { onDelete: "set null" }),
  operatorUserId: uuid("operator_user_id").references(() => users.id, { onDelete: "set null" }),
  stage: text("stage").notNull().default("draft"),
  dueDate: text("due_date"),
  pieceRatePkr: integer("piece_rate_pkr").notNull().default(0),
  materialCostPkr: integer("material_cost_pkr").notNull().default(0),
  laborCostPkr: integer("labor_cost_pkr").notNull().default(0),
  overheadCostPkr: integer("overhead_cost_pkr").notNull().default(0),
  invoiceAmountPkr: integer("invoice_amount_pkr").notNull().default(0),
  invoiceRef: text("invoice_ref"),
  notes: text("notes"),
  inwardChallanId: uuid("inward_challan_id"),
  factoryOperatorId: uuid("factory_operator_id"),
  priority: text("priority").notNull().default("normal"),
  needleChartJson: text("needle_chart_json"),
  detailsJson: text("details_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const embroideryJobLines = pgTable("embroidery_job_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => embroideryJobs.id, { onDelete: "cascade" }),
  sizeLabel: text("size_label").notNull(),
  colorLabel: text("color_label").notNull().default("Default"),
  quantity: integer("quantity").notNull().default(1),
  completedQty: integer("completed_qty").notNull().default(0),
});

export const embroideryMaterialIssues = pgTable("embroidery_material_issues", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  jobId: uuid("job_id")
    .notNull()
    .references(() => embroideryJobs.id, { onDelete: "cascade" }),
  productId: uuid("product_id"),
  itemName: text("item_name").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
  unit: text("unit").notNull().default("pc"),
  customerOwned: text("customer_owned").notNull().default("no"),
  unitCostPkr: integer("unit_cost_pkr").notNull().default(0),
  notes: text("notes"),
  factoryItemId: uuid("factory_item_id"),
  lotNumber: text("lot_number"),
  purpose: text("purpose"),
  returnable: text("returnable").notNull().default("no"),
  issuedBy: text("issued_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const embroideryQcRecords = pgTable("embroidery_qc_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  jobId: uuid("job_id")
    .notNull()
    .references(() => embroideryJobs.id, { onDelete: "cascade" }),
  result: text("result").notNull(),
  defectCode: text("defect_code"),
  quantity: integer("quantity").notNull().default(1),
  notes: text("notes"),
  claimSide: text("claim_side").notNull().default("operator"),
  disposition: text("disposition").notNull().default("rework"),
  detailsJson: text("details_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const embroideryDeliveries = pgTable("embroidery_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  jobId: uuid("job_id")
    .notNull()
    .references(() => embroideryJobs.id, { onDelete: "cascade" }),
  challanNumber: text("challan_number").notNull(),
  deliveredQty: integer("delivered_qty").notNull().default(1),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }).notNull().defaultNow(),
  invoiceRef: text("invoice_ref"),
  invoiceAmountPkr: integer("invoice_amount_pkr").notNull().default(0),
  notes: text("notes"),
  vehicle: text("vehicle"),
  driverName: text("driver_name"),
  detailsJson: text("details_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const embroideryPieceRateEntries = pgTable("embroidery_piece_rate_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  jobId: uuid("job_id")
    .notNull()
    .references(() => embroideryJobs.id, { onDelete: "cascade" }),
  operatorUserId: uuid("operator_user_id").references(() => users.id, { onDelete: "set null" }),
  pieces: integer("pieces").notNull().default(1),
  ratePkr: integer("rate_pkr").notNull().default(0),
  amountPkr: integer("amount_pkr").notNull().default(0),
  workDate: text("work_date").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const embroideryProductionLogs = pgTable("embroidery_production_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  jobId: uuid("job_id")
    .notNull()
    .references(() => embroideryJobs.id, { onDelete: "cascade" }),
  machineId: uuid("machine_id").references(() => embroideryMachines.id, { onDelete: "set null" }),
  operatorUserId: uuid("operator_user_id").references(() => users.id, { onDelete: "set null" }),
  stage: text("stage").notNull(),
  piecesCompleted: integer("pieces_completed").notNull().default(0),
  hoursWorked: numeric("hours_worked", { precision: 10, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  stitches: integer("stitches").notNull().default(0),
  frames: integer("frames").notNull().default(0),
  threadBreaks: integer("thread_breaks").notNull().default(0),
  runMinutes: integer("run_minutes").notNull().default(0),
  stopMinutes: integer("stop_minutes").notNull().default(0),
  factoryOperatorId: uuid("factory_operator_id"),
  detailsJson: text("details_json"),
  loggedAt: timestamp("logged_at", { withTimezone: true }).notNull().defaultNow(),
});
