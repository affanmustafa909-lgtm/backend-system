import { z } from "zod";

export const ACCOUNT_TYPES = ["asset", "liability", "income", "expense", "equity"] as const;
export const accountTypeSchema = z.enum(ACCOUNT_TYPES);

export const EXPENSE_CATEGORIES = [
  "Rent",
  "Utilities",
  "Gas",
  "Staff Meals",
  "Marketing",
  "Maintenance",
  "Internet",
  "Transportation",
  "Food Purchases",
  "Salaries",
  "Other",
] as const;
export const expenseCategorySchema = z.enum(EXPENSE_CATEGORIES);

export const EXPENSE_STATUSES = ["Pending", "Approved", "Rejected", "Paid"] as const;
export const expenseStatusSchema = z.enum(EXPENSE_STATUSES);

export const accountSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  type: accountTypeSchema,
  subtype: z.string().nullable(),
  balance: z.number(),
  active: z.boolean(),
});

export const journalLineSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  accountCode: z.string(),
  accountName: z.string(),
  debit: z.number(),
  credit: z.number(),
  memo: z.string().nullable(),
});

export const journalEntrySchema = z.object({
  id: z.string().uuid(),
  entryRef: z.string(),
  entryDate: z.string(),
  source: z.string(),
  sourceRef: z.string().nullable(),
  description: z.string(),
  status: z.string(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  lines: z.array(journalLineSchema),
});

export const accountingDashboardSchema = z.object({
  todaySales: z.number(),
  weeklySales: z.number(),
  monthlyRevenue: z.number(),
  totalExpenses: z.number(),
  profitLoss: z.number(),
  outstandingReceivable: z.number(),
  outstandingPayable: z.number(),
  cashInHand: z.number(),
  bankBalance: z.number(),
  topExpenseCategories: z.array(z.object({ category: z.string(), amount: z.number() })),
  recentEntries: z.array(journalEntrySchema),
});

export const expenseSchema = z.object({
  id: z.string().uuid(),
  expenseRef: z.string(),
  category: z.string(),
  amount: z.number(),
  expenseDate: z.string(),
  vendor: z.string().nullable(),
  description: z.string().nullable(),
  receiptUrl: z.string().nullable(),
  recurring: z.boolean(),
  status: expenseStatusSchema,
  submittedBy: z.string(),
  approvedBy: z.string().nullable(),
  approvedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const bankAccountSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  bankName: z.string(),
  accountNumber: z.string().nullable(),
  balance: z.number(),
  active: z.boolean(),
});

export const bankTransactionSchema = z.object({
  id: z.string().uuid(),
  txnRef: z.string(),
  bankAccountId: z.string().uuid(),
  bankAccountName: z.string(),
  type: z.enum(["deposit", "withdrawal", "transfer"]),
  amount: z.number(),
  txnDate: z.string(),
  memo: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
});

export const POPS_CASH_MOVEMENT_TYPES = ["paid_in", "paid_out"] as const;
export const popsCashMovementTypeSchema = z.enum(POPS_CASH_MOVEMENT_TYPES);

export const cashSessionSchema = z.object({
  id: z.string().uuid(),
  sessionRef: z.string(),
  openedBy: z.string(),
  openedAt: z.string(),
  openingFloat: z.number(),
  closedBy: z.string().nullable(),
  closedAt: z.string().nullable(),
  expectedCash: z.number().nullable(),
  countedCash: z.number().nullable(),
  variance: z.number().nullable(),
  status: z.enum(["open", "closed"]),
  notes: z.string().nullable(),
});

export const cashSessionLiveSchema = cashSessionSchema.extend({
  cashSales: z.number(),
  cashAdjustments: z.number(),
  liveExpectedCash: z.number(),
});

export const popsCashMovementSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  type: popsCashMovementTypeSchema,
  amountPkr: z.number(),
  reason: z.string(),
  recordedBy: z.string().nullable(),
  createdAt: z.string(),
  employeeId: z.string().uuid().nullable().optional(),
  partyKind: z.enum(["supplier", "customer", "employee", "expense"]).nullable().optional(),
  advanceId: z.string().uuid().nullable().optional(),
  supplierId: z.string().uuid().nullable().optional(),
  expenseId: z.string().uuid().nullable().optional(),
});

export const createPopsCashMovementSchema = z.object({
  branchCode: z.string().min(1),
  sessionId: z.string().uuid(),
  type: popsCashMovementTypeSchema,
  amountPkr: z.number().min(1),
  reason: z.string().min(1),
  recordedBy: z.string().optional(),
  /** When paying an employee, link to HR employee and optionally create a salary advance. */
  employeeId: z.string().uuid().optional(),
  partyKind: z.enum(["supplier", "customer", "employee", "expense"]).optional(),
  /** Mark employee paid_out as salary advance (default true when partyKind=employee). */
  asAdvance: z.boolean().optional(),
  /** Supplier pay-out: allocate against open vendor bills (ledger). */
  supplierId: z.string().uuid().optional(),
  /** Expense pay-out: category for auto-created Paid expense + ledger. */
  expenseCategory: expenseCategorySchema.optional(),
  /** Offline/cloud sync idempotency — same id will not create a duplicate movement. */
  clientRequestId: z.string().min(8).max(80).optional(),
});

export const vendorBillSchema = z.object({
  id: z.string().uuid(),
  billRef: z.string(),
  supplierId: z.string().uuid(),
  supplierName: z.string(),
  invoiceNumber: z.string().nullable(),
  amount: z.number(),
  paid: z.number(),
  balance: z.number(),
  dueDate: z.string().nullable(),
  status: z.enum(["open", "partial", "paid"]),
  sourceRef: z.string().nullable(),
  createdAt: z.string(),
});

export const customerInvoiceSchema = z.object({
  id: z.string().uuid(),
  invoiceRef: z.string(),
  customerName: z.string(),
  customerPhone: z.string().nullable(),
  amount: z.number(),
  paid: z.number(),
  balance: z.number(),
  dueDate: z.string().nullable(),
  status: z.enum(["open", "partial", "paid"]),
  description: z.string().nullable(),
  createdAt: z.string(),
});

export const taxSettingsSchema = z.object({
  taxName: z.string(),
  salesTaxPct: z.number(),
  serviceTaxPct: z.number(),
  taxRegistrationNo: z.string().nullable(),
  taxCollected: z.number(),
  taxPaid: z.number(),
  /** Branch POS charges (service / cash-card tax). Synced for desktop + mobile. */
  posCharges: z
    .object({
      servicePct: z.number(),
      taxPct: z.number(),
      taxByPaymentMethod: z.boolean(),
      cashTaxPct: z.number(),
      cardTaxPct: z.number(),
      onlineTaxPct: z.number(),
      taxEnabled: z.boolean(),
      autoDiscountEnabled: z.boolean().optional(),
      autoDiscountPct: z.number().optional(),
      serviceOnDineIn: z.boolean().optional(),
      serviceOnTakeaway: z.boolean(),
      serviceOnDelivery: z.boolean(),
      serviceOnOnline: z.boolean().optional(),
      serviceOnFoodpanda: z.boolean().optional(),
      serviceOnStaffFood: z.boolean().optional(),
      taxOnDineIn: z.boolean().optional(),
      taxOnTakeaway: z.boolean().optional(),
      taxOnDelivery: z.boolean().optional(),
      taxOnOnline: z.boolean().optional(),
      taxOnFoodpanda: z.boolean().optional(),
      taxOnStaffFood: z.boolean().optional(),
    })
    .optional(),
});

export const payrollRunSchema = z.object({
  id: z.string().uuid(),
  payrollRef: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  totalGross: z.number(),
  totalDeductions: z.number(),
  /** Can be negative when advances exceed salary. */
  totalNet: z.number(),
  staffCount: z.number(),
  status: z.enum(["draft", "approved", "paid"]),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  paidAt: z.string().nullable().optional(),
  paidBy: z.string().nullable().optional(),
});

export const inventoryAccountingSchema = z.object({
  stockValuation: z.number(),
  cogsToday: z.number(),
  cogsMonth: z.number(),
  purchaseCostMonth: z.number(),
  wasteCostMonth: z.number(),
  adjustmentImpactMonth: z.number(),
});

export const salesAccountingSchema = z.object({
  dineIn: z.number(),
  takeaway: z.number(),
  delivery: z.number(),
  discounts: z.number(),
  refunds: z.number(),
  voids: z.number(),
  taxCollected: z.number(),
  serviceCharges: z.number(),
  totalSales: z.number(),
  recentSales: z.array(
    z.object({
      billRef: z.string(),
      tableLabel: z.string(),
      total: z.number(),
      status: z.string(),
      createdAt: z.string(),
    }),
  ),
});

export const accountingAuditLogSchema = z.object({
  id: z.string().uuid(),
  entityType: z.string(),
  entityId: z.string(),
  action: z.string(),
  actorEmail: z.string(),
  oldValue: z.record(z.unknown()).nullable(),
  newValue: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
});

export const accountingReportSchema = z.object({
  reportId: z.string(),
  title: z.string(),
  generatedAt: z.string(),
  rows: z.array(
    z.object({
      label: z.string(),
      amount: z.number().optional(),
      debit: z.number().optional(),
      credit: z.number().optional(),
      balance: z.number().optional(),
      indent: z.number().optional(),
    }),
  ),
  totals: z.record(z.number()).optional(),
});

export const createExpenseSchema = z.object({
  branchCode: z.string().min(1),
  category: expenseCategorySchema,
  amount: z.number().positive(),
  expenseDate: z.string(),
  vendor: z.string().optional(),
  description: z.string().optional(),
  receiptUrl: z.string().optional(),
  recurring: z.boolean().default(false),
});

export const createJournalEntrySchema = z.object({
  branchCode: z.string().min(1),
  entryDate: z.string(),
  description: z.string().min(1),
  lines: z
    .array(
      z.object({
        accountId: z.string().uuid(),
        debit: z.number().min(0).default(0),
        credit: z.number().min(0).default(0),
        memo: z.string().optional(),
      }),
    )
    .min(2),
});

export const createBankAccountSchema = z.object({
  branchCode: z.string().min(1),
  name: z.string().min(1),
  bankName: z.string().min(1),
  accountNumber: z.string().optional(),
  openingBalance: z.number().min(0).default(0),
});

export const createBankTransactionSchema = z.object({
  branchCode: z.string().min(1),
  bankAccountId: z.string().uuid(),
  type: z.enum(["deposit", "withdrawal", "transfer"]),
  amount: z.number().positive(),
  txnDate: z.string(),
  memo: z.string().optional(),
  targetBankAccountId: z.string().uuid().optional(),
});

export const openCashSessionSchema = z.object({
  branchCode: z.string().min(1),
  openingFloat: z.number().min(0).default(0),
});

export const closeCashSessionSchema = z.object({
  countedCash: z.number().min(0),
  notes: z.string().optional(),
});

export const createCustomerInvoiceSchema = z.object({
  branchCode: z.string().min(1),
  customerName: z.string().min(1),
  customerPhone: z.string().optional(),
  amount: z.number().positive(),
  dueDate: z.string().optional(),
  description: z.string().optional(),
});

export const recordPaymentSchema = z.object({
  amount: z.number().positive(),
  paymentDate: z.string(),
  method: z.enum(["cash", "bank", "card"]),
});

export const createPayrollRunSchema = z.object({
  branchCode: z.string().min(1),
  periodStart: z.string(),
  periodEnd: z.string(),
  totalGross: z.number().positive(),
  totalDeductions: z.number().min(0).default(0),
  staffCount: z.number().positive(),
});

export const updateTaxSettingsSchema = z.object({
  branchCode: z.string().min(1),
  taxName: z.string().optional(),
  salesTaxPct: z.number().min(0).max(100).optional(),
  serviceTaxPct: z.number().min(0).max(100).optional(),
  taxRegistrationNo: z.string().optional(),
  posCharges: z
    .object({
      servicePct: z.number().min(0).max(100),
      taxPct: z.number().min(0).max(100),
      taxByPaymentMethod: z.boolean(),
      cashTaxPct: z.number().min(0).max(100),
      cardTaxPct: z.number().min(0).max(100),
      onlineTaxPct: z.number().min(0).max(100),
      taxEnabled: z.boolean(),
      autoDiscountEnabled: z.boolean().optional(),
      autoDiscountPct: z.number().min(0).max(100).optional(),
      serviceOnDineIn: z.boolean().optional(),
      serviceOnTakeaway: z.boolean(),
      serviceOnDelivery: z.boolean(),
      serviceOnOnline: z.boolean().optional(),
      serviceOnFoodpanda: z.boolean().optional(),
      serviceOnStaffFood: z.boolean().optional(),
      taxOnDineIn: z.boolean().optional(),
      taxOnTakeaway: z.boolean().optional(),
      taxOnDelivery: z.boolean().optional(),
      taxOnOnline: z.boolean().optional(),
      taxOnFoodpanda: z.boolean().optional(),
      taxOnStaffFood: z.boolean().optional(),
    })
    .optional(),
});

export type AccountingDashboard = z.infer<typeof accountingDashboardSchema>;
export type Account = z.infer<typeof accountSchema>;
export type JournalEntry = z.infer<typeof journalEntrySchema>;
export type Expense = z.infer<typeof expenseSchema>;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type BankAccount = z.infer<typeof bankAccountSchema>;
export type BankTransaction = z.infer<typeof bankTransactionSchema>;
export type CashSession = z.infer<typeof cashSessionSchema>;
export type CashSessionLive = z.infer<typeof cashSessionLiveSchema>;
export type PopsCashMovement = z.infer<typeof popsCashMovementSchema>;
export type CreatePopsCashMovement = z.infer<typeof createPopsCashMovementSchema>;
export type VendorBill = z.infer<typeof vendorBillSchema>;
export type CustomerInvoice = z.infer<typeof customerInvoiceSchema>;
export type TaxSettings = z.infer<typeof taxSettingsSchema>;
export type PayrollRun = z.infer<typeof payrollRunSchema>;
export type InventoryAccounting = z.infer<typeof inventoryAccountingSchema>;
export type SalesAccounting = z.infer<typeof salesAccountingSchema>;
export type AccountingAuditLog = z.infer<typeof accountingAuditLogSchema>;
export type AccountingReport = z.infer<typeof accountingReportSchema>;
export type CreateExpense = z.infer<typeof createExpenseSchema>;
export type CreateJournalEntry = z.infer<typeof createJournalEntrySchema>;
export type CreateBankAccount = z.infer<typeof createBankAccountSchema>;
export type CreateBankTransaction = z.infer<typeof createBankTransactionSchema>;
export type OpenCashSession = z.infer<typeof openCashSessionSchema>;
export type CloseCashSession = z.infer<typeof closeCashSessionSchema>;
export type CreateCustomerInvoice = z.infer<typeof createCustomerInvoiceSchema>;
export type RecordPayment = z.infer<typeof recordPaymentSchema>;
export type CreatePayrollRun = z.infer<typeof createPayrollRunSchema>;
export type UpdateTaxSettings = z.infer<typeof updateTaxSettingsSchema>;
