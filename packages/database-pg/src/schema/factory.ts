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
  kind: text("kind").notNull().default("customer"), // customer | vendor | both
  code: text("code").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  address: text("address"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Own consumables / FG — never party cloth. */
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
  category: text("category").notNull().default("thread"), // thread | backing | sequin | fabric | fg | other
  unit: text("unit").notNull().default("pcs"),
  reorderLevel: integer("reorder_level").notNull().default(0),
  unitCostPkr: integer("unit_cost_pkr").notNull().default(0),
  active: text("active").notNull().default("yes"),
  notes: text("notes"),
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
  txnType: text("txn_type").notNull(), // grn | issue | adjust | return
  qtyDelta: numeric("qty_delta", { precision: 18, scale: 3 }).notNull(),
  refType: text("ref_type"),
  refId: uuid("ref_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Party-owned inward challan (CN). */
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
  status: text("status").notNull().default("open"), // open | closed | cancelled
  notes: text("notes"),
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
  shift: text("shift").notNull().default("day"), // day | night
  status: text("status").notNull().default("open"), // open | locked
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
  status: text("status").notNull().default("open"), // open | paid | cancelled
  notes: text("notes"),
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
  accountKind: text("account_kind").notNull(), // party | cash | bank | expense
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
