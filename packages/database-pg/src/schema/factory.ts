import { integer, numeric, pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { popsBranches } from "./operations";
import { embroideryDesigns, embroideryJobs, embroideryMachines } from "./embroidery";

/** Factory parties — customers & vendors (not store_customers). */
export const factoryParties = pgTable("factory_parties", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").references(() => popsBranches.id, { onDelete: "set null" }),
  kind: text("kind").notNull().default("customer"),
  code: text("code").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  address: text("address"),
  notes: text("notes"),
  gstin: text("gstin"),
  ntnCnic: text("ntn_cnic"),
  whatsapp: text("whatsapp"),
  city: text("city"),
  billingAddress: text("billing_address"),
  shippingAddress: text("shipping_address"),
  contactPersons: text("contact_persons"),
  paymentTerms: text("payment_terms"),
  creditLimitPkr: integer("credit_limit_pkr").notNull().default(0),
  openingBalancePkr: integer("opening_balance_pkr").notNull().default(0),
  rateType: text("rate_type").notNull().default("stitch"),
  defaultStitchRatePkr: integer("default_stitch_rate_pkr").notNull().default(0),
  industrySegment: text("industry_segment"),
  bankDetails: text("bank_details"),
  detailsJson: text("details_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const factoryItems = pgTable("factory_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull().default("thread"),
  unit: text("unit").notNull().default("pcs"),
  reorderLevel: integer("reorder_level").notNull().default(0),
  unitCostPkr: integer("unit_cost_pkr").notNull().default(0),
  active: text("active").notNull().default("yes"),
  notes: text("notes"),
  brand: text("brand"),
  colour: text("colour"),
  sizeLabel: text("size_label"),
  location: text("location"),
  supplierPartyId: uuid("supplier_party_id"),
  batchLot: text("batch_lot"),
  detailsJson: text("details_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const factoryStockBalances = pgTable(
  "factory_stock_balances",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => popsBranches.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => factoryItems.id, { onDelete: "cascade" }),
    qtyOnHand: numeric("qty_on_hand", { precision: 18, scale: 3 }).notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("factory_stock_balances_org_branch_item_uidx").on(
      t.organizationId,
      t.branchId,
      t.itemId,
    ),
  }),
);

export const factoryStockLedger = pgTable("factory_stock_ledger", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  itemId: uuid("item_id")
    .notNull()
    .references(() => factoryItems.id, { onDelete: "cascade" }),
  txnType: text("txn_type").notNull(),
  qtyDelta: numeric("qty_delta", { precision: 18, scale: 3 }).notNull(),
  refType: text("ref_type"),
  refId: uuid("ref_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const factoryInwardChallans = pgTable("factory_inward_challans", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  cnNumber: text("cn_number").notNull(),
  partyId: uuid("party_id")
    .notNull()
    .references(() => factoryParties.id, { onDelete: "restrict" }),
  challanDate: text("challan_date").notNull(),
  status: text("status").notNull().default("open"),
  notes: text("notes"),
  partyCnNumber: text("party_cn_number"),
  vehicle: text("vehicle"),
  receivedBy: text("received_by"),
  detailsJson: text("details_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const factoryInwardChallanLines = pgTable("factory_inward_challan_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  challanId: uuid("challan_id")
    .notNull()
    .references(() => factoryInwardChallans.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  designId: uuid("design_id").references(() => embroideryDesigns.id, { onDelete: "set null" }),
  qty: integer("qty").notNull().default(1),
  unit: text("unit").notNull().default("pcs"),
  colour: text("colour"),
  qtyDispatched: integer("qty_dispatched").notNull().default(0),
  fabric: text("fabric"),
  lotNumber: text("lot_number"),
  conditionNote: text("condition_note"),
  detailsJson: text("details_json"),
});

export const factoryOutwardChallans = pgTable("factory_outward_challans", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  cnNumber: text("cn_number").notNull(),
  partyId: uuid("party_id")
    .notNull()
    .references(() => factoryParties.id, { onDelete: "restrict" }),
  inwardChallanId: uuid("inward_challan_id").references(() => factoryInwardChallans.id, {
    onDelete: "set null",
  }),
  jobId: uuid("job_id").references(() => embroideryJobs.id, { onDelete: "set null" }),
  challanDate: text("challan_date").notNull(),
  status: text("status").notNull().default("dispatched"),
  invoiceAmountPkr: integer("invoice_amount_pkr").notNull().default(0),
  notes: text("notes"),
  vehicle: text("vehicle"),
  driverName: text("driver_name"),
  ewayRef: text("eway_ref"),
  detailsJson: text("details_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const factoryOutwardChallanLines = pgTable("factory_outward_challan_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  challanId: uuid("challan_id")
    .notNull()
    .references(() => factoryOutwardChallans.id, { onDelete: "cascade" }),
  inwardLineId: uuid("inward_line_id").references(() => factoryInwardChallanLines.id, {
    onDelete: "set null",
  }),
  description: text("description").notNull(),
  qty: integer("qty").notNull().default(1),
  unit: text("unit").notNull().default("pcs"),
});

export const factoryOperators = pgTable("factory_operators", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  ratePer1kStitchesPkr: integer("rate_per_1k_stitches_pkr").notNull().default(0),
  ratePerPiecePkr: integer("rate_per_piece_pkr").notNull().default(0),
  active: text("active").notNull().default("yes"),
  notes: text("notes"),
  cnic: text("cnic"),
  address: text("address"),
  joinDate: text("join_date"),
  payType: text("pay_type").notNull().default("piece"),
  bankDetails: text("bank_details"),
  photoBase64: text("photo_base64"),
  detailsJson: text("details_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const factoryDailySheets = pgTable("factory_daily_sheets", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  sheetDate: text("sheet_date").notNull(),
  shift: text("shift").notNull().default("day"),
  status: text("status").notNull().default("open"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const factoryDailySheetLines = pgTable("factory_daily_sheet_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  sheetId: uuid("sheet_id")
    .notNull()
    .references(() => factoryDailySheets.id, { onDelete: "cascade" }),
  machineId: uuid("machine_id").references(() => embroideryMachines.id, { onDelete: "set null" }),
  operatorId: uuid("operator_id").references(() => factoryOperators.id, { onDelete: "set null" }),
  jobId: uuid("job_id").references(() => embroideryJobs.id, { onDelete: "set null" }),
  designId: uuid("design_id").references(() => embroideryDesigns.id, { onDelete: "set null" }),
  stitches: integer("stitches").notNull().default(0),
  frames: integer("frames").notNull().default(0),
  pieces: integer("pieces").notNull().default(0),
  downtimeMinutes: integer("downtime_minutes").notNull().default(0),
  bonusPkr: integer("bonus_pkr").notNull().default(0),
  wagePkr: integer("wage_pkr").notNull().default(0),
  notes: text("notes"),
  threadBreaks: integer("thread_breaks").notNull().default(0),
  runMinutes: integer("run_minutes").notNull().default(0),
  stopReason: text("stop_reason"),
  detailsJson: text("details_json"),
});

export const factoryJobBills = pgTable("factory_job_bills", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  billNumber: text("bill_number").notNull(),
  partyId: uuid("party_id")
    .notNull()
    .references(() => factoryParties.id, { onDelete: "restrict" }),
  outwardChallanId: uuid("outward_challan_id").references(() => factoryOutwardChallans.id, {
    onDelete: "set null",
  }),
  billDate: text("bill_date").notNull(),
  amountPkr: integer("amount_pkr").notNull().default(0),
  status: text("status").notNull().default("open"),
  notes: text("notes"),
  taxPkr: integer("tax_pkr").notNull().default(0),
  defectDeductionPkr: integer("defect_deduction_pkr").notNull().default(0),
  discountPkr: integer("discount_pkr").notNull().default(0),
  detailsJson: text("details_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const factoryLedgerEntries = pgTable("factory_ledger_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  entryDate: text("entry_date").notNull(),
  accountKind: text("account_kind").notNull(),
  partyId: uuid("party_id").references(() => factoryParties.id, { onDelete: "set null" }),
  debitPkr: integer("debit_pkr").notNull().default(0),
  creditPkr: integer("credit_pkr").notNull().default(0),
  refType: text("ref_type"),
  refId: uuid("ref_id"),
  narration: text("narration"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const factoryOperatorAdvances = pgTable("factory_operator_advances", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  operatorId: uuid("operator_id")
    .notNull()
    .references(() => factoryOperators.id, { onDelete: "cascade" }),
  advanceDate: text("advance_date").notNull(),
  amountPkr: integer("amount_pkr").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const factoryPrinterProfiles = pgTable("factory_printer_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  printerType: text("printer_type").notNull().default("thermal"),
  paperWidthMm: integer("paper_width_mm").notNull().default(80),
  copies: integer("copies").notNull().default(1),
  defaultFor: text("default_for").notNull().default("cn"),
  margins: text("margins"),
  detailsJson: text("details_json"),
  active: text("active").notNull().default("yes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const factoryPrintJobs = pgTable("factory_print_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  jobNumber: text("job_number").notNull(),
  partyId: uuid("party_id").references(() => factoryParties.id, { onDelete: "set null" }),
  designId: uuid("design_id").references(() => embroideryDesigns.id, { onDelete: "set null" }),
  embroideryJobId: uuid("embroidery_job_id").references(() => embroideryJobs.id, {
    onDelete: "set null",
  }),
  printType: text("print_type").notNull().default("dtf"),
  sizeLabel: text("size_label"),
  qty: integer("qty").notNull().default(1),
  printerProfileId: uuid("printer_profile_id").references(() => factoryPrinterProfiles.id, {
    onDelete: "set null",
  }),
  status: text("status").notNull().default("draft"),
  notes: text("notes"),
  detailsJson: text("details_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const factoryPackingRecords = pgTable("factory_packing_records", {
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
  cartonNumber: text("carton_number").notNull(),
  pieces: integer("pieces").notNull().default(0),
  weightKg: numeric("weight_kg", { precision: 12, scale: 3 }).notNull().default("0"),
  labels: text("labels"),
  sealNumber: text("seal_number"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const factoryPurchaseOrders = pgTable("factory_purchase_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  poNumber: text("po_number").notNull(),
  vendorPartyId: uuid("vendor_party_id").references(() => factoryParties.id, { onDelete: "set null" }),
  poDate: text("po_date").notNull(),
  status: text("status").notNull().default("open"),
  expectedDate: text("expected_date"),
  amountPkr: integer("amount_pkr").notNull().default(0),
  notes: text("notes"),
  detailsJson: text("details_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const factoryPurchaseReceipts = pgTable("factory_purchase_receipts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  receiptNumber: text("receipt_number").notNull(),
  vendorPartyId: uuid("vendor_party_id").references(() => factoryParties.id, { onDelete: "set null" }),
  poId: uuid("po_id").references(() => factoryPurchaseOrders.id, { onDelete: "set null" }),
  receiptDate: text("receipt_date").notNull(),
  status: text("status").notNull().default("received"),
  notes: text("notes"),
  detailsJson: text("details_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const factoryDefectReturns = pgTable("factory_defect_returns", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  returnNumber: text("return_number").notNull(),
  claimSide: text("claim_side").notNull().default("party"),
  partyId: uuid("party_id").references(() => factoryParties.id, { onDelete: "set null" }),
  operatorId: uuid("operator_id").references(() => factoryOperators.id, { onDelete: "set null" }),
  jobId: uuid("job_id").references(() => embroideryJobs.id, { onDelete: "set null" }),
  returnDate: text("return_date").notNull(),
  qty: integer("qty").notNull().default(1),
  defectCode: text("defect_code"),
  amountPkr: integer("amount_pkr").notNull().default(0),
  status: text("status").notNull().default("open"),
  notes: text("notes"),
  detailsJson: text("details_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const factoryHandworkIssues = pgTable("factory_handwork_issues", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  issueNumber: text("issue_number").notNull(),
  karigarPartyId: uuid("karigar_party_id").references(() => factoryParties.id, { onDelete: "set null" }),
  jobId: uuid("job_id").references(() => embroideryJobs.id, { onDelete: "set null" }),
  designId: uuid("design_id").references(() => embroideryDesigns.id, { onDelete: "set null" }),
  issueDate: text("issue_date").notNull(),
  dueDate: text("due_date"),
  qty: integer("qty").notNull().default(1),
  ratePkr: integer("rate_pkr").notNull().default(0),
  status: text("status").notNull().default("issued"),
  notes: text("notes"),
  detailsJson: text("details_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const factoryHandworkReturns = pgTable("factory_handwork_returns", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  returnNumber: text("return_number").notNull(),
  issueId: uuid("issue_id").references(() => factoryHandworkIssues.id, { onDelete: "set null" }),
  returnDate: text("return_date").notNull(),
  qty: integer("qty").notNull().default(1),
  lossQty: integer("loss_qty").notNull().default(0),
  status: text("status").notNull().default("received"),
  notes: text("notes"),
  detailsJson: text("details_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const factoryAttendance = pgTable("factory_attendance", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  operatorId: uuid("operator_id")
    .notNull()
    .references(() => factoryOperators.id, { onDelete: "cascade" }),
  attendDate: text("attend_date").notNull(),
  shift: text("shift").notNull().default("day"),
  status: text("status").notNull().default("present"),
  hours: numeric("hours", { precision: 6, scale: 2 }).notNull().default("8"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const factoryLeave = pgTable("factory_leave", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  operatorId: uuid("operator_id")
    .notNull()
    .references(() => factoryOperators.id, { onDelete: "cascade" }),
  fromDate: text("from_date").notNull(),
  toDate: text("to_date").notNull(),
  leaveType: text("leave_type").notNull().default("casual"),
  status: text("status").notNull().default("approved"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const factoryThreadConsumption = pgTable("factory_thread_consumption", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  entryDate: text("entry_date").notNull(),
  designId: uuid("design_id").references(() => embroideryDesigns.id, { onDelete: "set null" }),
  jobId: uuid("job_id").references(() => embroideryJobs.id, { onDelete: "set null" }),
  itemId: uuid("item_id").references(() => factoryItems.id, { onDelete: "set null" }),
  qty: numeric("qty", { precision: 18, scale: 3 }).notNull().default("0"),
  unit: text("unit").notNull().default("cone"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const factoryStitchRates = pgTable("factory_stitch_rates", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").references(() => popsBranches.id, { onDelete: "set null" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  headArrangement: text("head_arrangement").notNull().default("1-7-11-B"),
  workType: text("work_type").notNull().default("flat"),
  ratePer1kPkr: integer("rate_per_1k_pkr").notNull().default(0),
  notes: text("notes"),
  active: text("active").notNull().default("yes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const factoryJobOut = pgTable("factory_job_out", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  outNumber: text("out_number").notNull(),
  vendorPartyId: uuid("vendor_party_id").references(() => factoryParties.id, { onDelete: "set null" }),
  jobId: uuid("job_id").references(() => embroideryJobs.id, { onDelete: "set null" }),
  outDate: text("out_date").notNull(),
  dueDate: text("due_date"),
  qty: integer("qty").notNull().default(1),
  processName: text("process_name").notNull().default("embroidery"),
  status: text("status").notNull().default("out"),
  notes: text("notes"),
  detailsJson: text("details_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const factoryExpenses = pgTable("factory_expenses", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  expenseDate: text("expense_date").notNull(),
  category: text("category").notNull().default("general"),
  amountPkr: integer("amount_pkr").notNull().default(0),
  payMode: text("pay_mode").notNull().default("cash"),
  vendorName: text("vendor_name"),
  narration: text("narration"),
  status: text("status").notNull().default("posted"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const factoryMaintenanceLogs = pgTable("factory_maintenance_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  machineId: uuid("machine_id").references(() => embroideryMachines.id, { onDelete: "set null" }),
  serviceDate: text("service_date").notNull(),
  serviceType: text("service_type").notNull().default("preventive"),
  costPkr: integer("cost_pkr").notNull().default(0),
  nextDueDate: text("next_due_date"),
  notes: text("notes"),
  status: text("status").notNull().default("done"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const factorySalarySlips = pgTable("factory_salary_slips", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  operatorId: uuid("operator_id")
    .notNull()
    .references(() => factoryOperators.id, { onDelete: "cascade" }),
  periodMonth: text("period_month").notNull(),
  grossPkr: integer("gross_pkr").notNull().default(0),
  advancesPkr: integer("advances_pkr").notNull().default(0),
  bonusPkr: integer("bonus_pkr").notNull().default(0),
  cutsPkr: integer("cuts_pkr").notNull().default(0),
  netPkr: integer("net_pkr").notNull().default(0),
  status: text("status").notNull().default("draft"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const factoryEwayRecords = pgTable("factory_eway_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  ewayNumber: text("eway_number").notNull(),
  docType: text("doc_type").notNull().default("outward_cn"),
  docRef: text("doc_ref"),
  partyId: uuid("party_id").references(() => factoryParties.id, { onDelete: "set null" }),
  ewayDate: text("eway_date").notNull(),
  vehicle: text("vehicle"),
  amountPkr: integer("amount_pkr").notNull().default(0),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const factoryBrokerMasters = pgTable("factory_broker_masters", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").references(() => popsBranches.id, { onDelete: "set null" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  commissionPct: numeric("commission_pct", { precision: 6, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  active: text("active").notNull().default("yes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
