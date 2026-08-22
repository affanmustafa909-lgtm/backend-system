import { date, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { popsExpenses, popsPayrollRuns } from "./accounting";
import { popsSuppliers } from "./inventory";
import { popsBranches } from "./operations";
import { organizations } from "./organizations";
import { users } from "./users";

export const popsEmployees = pgTable("pops_employees", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  employeeCode: text("employee_code").notNull(),
  displayName: text("display_name").notNull(),
  jobTitle: text("job_title").notNull(),
  department: text("department"),
  shiftLabel: text("shift_label"),
  baseSalaryPkr: integer("base_salary_pkr").notNull().default(0),
  employmentStatus: text("employment_status").notNull().default("active"), // active | on_leave | terminated
  joinDate: date("join_date"),
  phone: text("phone"),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsAttendance = pgTable("pops_attendance", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => popsEmployees.id, { onDelete: "cascade" }),
  attendanceDate: date("attendance_date").notNull(),
  shiftLabel: text("shift_label"),
  clockIn: text("clock_in"),
  clockOut: text("clock_out"),
  status: text("status").notNull().default("present"), // present | late | absent | on_leave
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsLeaveRequests = pgTable("pops_leave_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => popsEmployees.id, { onDelete: "cascade" }),
  leaveType: text("leave_type").notNull(), // annual | sick | unpaid
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  reason: text("reason"),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsPayrollLines = pgTable("pops_payroll_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  payrollRunId: uuid("payroll_run_id")
    .notNull()
    .references(() => popsPayrollRuns.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => popsEmployees.id, { onDelete: "restrict" }),
  grossPkr: integer("gross_pkr").notNull(),
  deductionsPkr: integer("deductions_pkr").notNull().default(0),
  overtimePkr: integer("overtime_pkr").notNull().default(0),
  netPkr: integer("net_pkr").notNull(),
});

/** Staff / guest meals consumed at the restaurant — tracked by admin. */
export const popsStaffFood = pgTable("pops_staff_food", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").references(() => popsEmployees.id, { onDelete: "set null" }),
  /** Optional vendor / catering supplier for the meal cost. */
  supplierId: uuid("supplier_id").references(() => popsSuppliers.id, { onDelete: "set null" }),
  /** Expense category (COA via Staff Meals → 5201, etc.). */
  expenseCategory: text("expense_category").notNull().default("Staff Meals"),
  /** Linked Pending/Approved expense created when amount > 0. */
  expenseId: uuid("expense_id").references(() => popsExpenses.id, { onDelete: "set null" }),
  consumerType: text("consumer_type").notNull(), // staff | guest
  personName: text("person_name").notNull(),
  mealDate: date("meal_date").notNull(),
  itemsOrdered: text("items_ordered").notNull(),
  amountPkr: integer("amount_pkr").notNull().default(0),
  notes: text("notes"),
  recordedBy: text("recorded_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Salary advances paid from cash drawer (POS Pay Out → employee).
 * Open advances auto-deduct on the next payroll run.
 */
export const popsEmployeeAdvances = pgTable("pops_employee_advances", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => popsEmployees.id, { onDelete: "cascade" }),
  amountPkr: integer("amount_pkr").notNull(),
  reason: text("reason"),
  /** Links to cash drawer paid_out row when created from POS. */
  cashMovementId: uuid("cash_movement_id"),
  /** open | reserved (on draft/approved payroll) | settled (after pay) */
  status: text("status").notNull().default("open"),
  payrollRunId: uuid("payroll_run_id").references(() => popsPayrollRuns.id, { onDelete: "set null" }),
  /** Offline/cloud sync idempotency key — prevents duplicate advances on flush. */
  clientRequestId: text("client_request_id"),
  recordedBy: text("recorded_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  settledAt: timestamp("settled_at", { withTimezone: true }),
});
