import { boolean, date, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { popsBranches } from "./operations";
import { popsSuppliers } from "./inventory";

export const popsAccounts = pgTable("pops_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(), // asset | liability | income | expense | equity
  subtype: text("subtype"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsJournalEntries = pgTable("pops_journal_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  entryRef: text("entry_ref").notNull(),
  entryDate: date("entry_date").notNull(),
  source: text("source").notNull(), // sale | purchase | expense | payroll | cash | bank | manual | cogs | waste | adjustment
  sourceRef: text("source_ref"),
  description: text("description").notNull(),
  status: text("status").notNull().default("posted"), // draft | posted | void
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsJournalLines = pgTable("pops_journal_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  entryId: uuid("entry_id")
    .notNull()
    .references(() => popsJournalEntries.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => popsAccounts.id, { onDelete: "restrict" }),
  debitPkr: integer("debit_pkr").notNull().default(0),
  creditPkr: integer("credit_pkr").notNull().default(0),
  memo: text("memo"),
});

export const popsExpenses = pgTable("pops_expenses", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  expenseRef: text("expense_ref").notNull(),
  category: text("category").notNull(),
  amountPkr: integer("amount_pkr").notNull(),
  expenseDate: date("expense_date").notNull(),
  vendor: text("vendor"),
  description: text("description"),
  receiptUrl: text("receipt_url"),
  recurring: boolean("recurring").notNull().default(false),
  status: text("status").notNull().default("Pending"), // Pending | Approved | Rejected | Paid
  submittedBy: text("submitted_by").notNull(),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  journalEntryId: uuid("journal_entry_id").references(() => popsJournalEntries.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsBankAccounts = pgTable("pops_bank_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  bankName: text("bank_name").notNull(),
  accountNumber: text("account_number"),
  balancePkr: integer("balance_pkr").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsBankTransactions = pgTable("pops_bank_transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  bankAccountId: uuid("bank_account_id")
    .notNull()
    .references(() => popsBankAccounts.id, { onDelete: "cascade" }),
  txnRef: text("txn_ref").notNull(),
  type: text("type").notNull(), // deposit | withdrawal | transfer
  amountPkr: integer("amount_pkr").notNull(),
  txnDate: date("txn_date").notNull(),
  memo: text("memo"),
  targetBankAccountId: uuid("target_bank_account_id").references(() => popsBankAccounts.id, {
    onDelete: "set null",
  }),
  journalEntryId: uuid("journal_entry_id").references(() => popsJournalEntries.id, { onDelete: "set null" }),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsCashSessions = pgTable("pops_cash_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  sessionRef: text("session_ref").notNull(),
  openedBy: text("opened_by").notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  openingFloatPkr: integer("opening_float_pkr").notNull().default(0),
  closedBy: text("closed_by"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  expectedCashPkr: integer("expected_cash_pkr"),
  countedCashPkr: integer("counted_cash_pkr"),
  variancePkr: integer("variance_pkr"),
  status: text("status").notNull().default("open"), // open | closed
  notes: text("notes"),
});

export const popsCashMovements = pgTable("pops_cash_movements", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => popsCashSessions.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // paid_in | paid_out
  amountPkr: integer("amount_pkr").notNull(),
  reason: text("reason").notNull(),
  recordedBy: text("recorded_by"),
  /** Optional link when payout is to an employee (salary advance). */
  employeeId: uuid("employee_id"),
  partyKind: text("party_kind"), // supplier | customer | employee
  clientRequestId: text("client_request_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsVendorBills = pgTable("pops_vendor_bills", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  billRef: text("bill_ref").notNull(),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => popsSuppliers.id, { onDelete: "restrict" }),
  invoiceNumber: text("invoice_number"),
  amountPkr: integer("amount_pkr").notNull(),
  paidPkr: integer("paid_pkr").notNull().default(0),
  dueDate: date("due_date"),
  status: text("status").notNull().default("open"), // open | partial | paid
  sourceRef: text("source_ref"),
  journalEntryId: uuid("journal_entry_id").references(() => popsJournalEntries.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsVendorPayments = pgTable("pops_vendor_payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  vendorBillId: uuid("vendor_bill_id")
    .notNull()
    .references(() => popsVendorBills.id, { onDelete: "cascade" }),
  paymentRef: text("payment_ref").notNull(),
  amountPkr: integer("amount_pkr").notNull(),
  paymentDate: date("payment_date").notNull(),
  method: text("method").notNull(), // cash | bank
  journalEntryId: uuid("journal_entry_id").references(() => popsJournalEntries.id, { onDelete: "set null" }),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsCustomerInvoices = pgTable("pops_customer_invoices", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  invoiceRef: text("invoice_ref").notNull(),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone"),
  amountPkr: integer("amount_pkr").notNull(),
  paidPkr: integer("paid_pkr").notNull().default(0),
  dueDate: date("due_date"),
  status: text("status").notNull().default("open"), // open | partial | paid
  description: text("description"),
  journalEntryId: uuid("journal_entry_id").references(() => popsJournalEntries.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsCustomerPayments = pgTable("pops_customer_payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => popsCustomerInvoices.id, { onDelete: "cascade" }),
  paymentRef: text("payment_ref").notNull(),
  amountPkr: integer("amount_pkr").notNull(),
  paymentDate: date("payment_date").notNull(),
  method: text("method").notNull(),
  journalEntryId: uuid("journal_entry_id").references(() => popsJournalEntries.id, { onDelete: "set null" }),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsTaxSettings = pgTable("pops_tax_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  taxName: text("tax_name").notNull().default("GST"),
  salesTaxPct: integer("sales_tax_pct").notNull().default(15),
  serviceTaxPct: integer("service_tax_pct").notNull().default(10),
  taxRegistrationNo: text("tax_registration_no"),
  /** JSON blob for POS service/tax charges (cash/card rates, mode toggles). */
  posChargesJson: text("pos_charges_json"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsPayrollRuns = pgTable("pops_payroll_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  payrollRef: text("payroll_ref").notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  totalGrossPkr: integer("total_gross_pkr").notNull(),
  totalDeductionsPkr: integer("total_deductions_pkr").notNull().default(0),
  totalNetPkr: integer("total_net_pkr").notNull(),
  staffCount: integer("staff_count").notNull(),
  status: text("status").notNull().default("draft"), // draft | approved | paid
  journalEntryId: uuid("journal_entry_id").references(() => popsJournalEntries.id, { onDelete: "set null" }),
  /** When salary was paid (date+time) — used on slips + pay journal. */
  paidAt: timestamp("paid_at", { withTimezone: true }),
  paidBy: text("paid_by"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsAccountingAuditLogs = pgTable("pops_accounting_audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),
  actorEmail: text("actor_email").notNull(),
  oldValueJson: text("old_value_json"),
  newValueJson: text("new_value_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
