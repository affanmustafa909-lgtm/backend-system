import { z } from "zod";
import { expenseCategorySchema } from "./accounting";

export const employmentStatusSchema = z.enum(["active", "on_leave", "terminated"]);
export const attendanceStatusSchema = z.enum(["present", "late", "absent", "on_leave"]);
export const leaveTypeSchema = z.enum(["annual", "sick", "unpaid"]);
export const leaveStatusSchema = z.enum(["pending", "approved", "rejected"]);

export const employeeSchema = z.object({
  id: z.string().uuid(),
  employeeCode: z.string(),
  displayName: z.string(),
  jobTitle: z.string(),
  department: z.string().nullable(),
  shiftLabel: z.string().nullable(),
  baseSalaryPkr: z.number().int().nonnegative(),
  employmentStatus: employmentStatusSchema,
  joinDate: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  userId: z.string().uuid().nullable(),
  branchCode: z.string(),
  createdAt: z.string(),
});

export const createEmployeeSchema = z.object({
  branchCode: z.string().min(1),
  employeeCode: z.string().min(1).max(16),
  displayName: z.string().min(1).max(120),
  jobTitle: z.string().min(1).max(64),
  department: z.string().max(64).optional(),
  shiftLabel: z.string().max(32).optional(),
  baseSalaryPkr: z.number().int().nonnegative(),
  joinDate: z.string().optional(),
  phone: z.string().max(32).optional(),
  email: z.string().email().optional(),
  userId: z.string().uuid().optional(),
});

export const updateEmployeeSchema = createEmployeeSchema
  .omit({ branchCode: true, employeeCode: true })
  .partial()
  .extend({
    employmentStatus: employmentStatusSchema.optional(),
    employeeCode: z.string().min(1).max(16).optional(),
  });

export const attendanceRecordSchema = z.object({
  id: z.string().uuid(),
  employeeId: z.string().uuid(),
  employeeCode: z.string(),
  employeeName: z.string(),
  jobTitle: z.string(),
  attendanceDate: z.string(),
  shiftLabel: z.string().nullable(),
  clockIn: z.string().nullable(),
  clockOut: z.string().nullable(),
  status: attendanceStatusSchema,
  notes: z.string().nullable(),
});

export const createAttendanceSchema = z.object({
  branchCode: z.string().min(1),
  employeeId: z.string().uuid(),
  attendanceDate: z.string(),
  shiftLabel: z.string().max(32).optional(),
  clockIn: z.string().max(8).optional(),
  clockOut: z.string().max(8).optional(),
  status: attendanceStatusSchema.optional(),
  notes: z.string().max(500).optional(),
});

export const updateAttendanceSchema = z.object({
  shiftLabel: z.string().max(32).optional(),
  clockIn: z.string().max(8).optional(),
  clockOut: z.string().max(8).optional(),
  status: attendanceStatusSchema.optional(),
  notes: z.string().max(500).optional(),
});

export const leaveRequestSchema = z.object({
  id: z.string().uuid(),
  employeeId: z.string().uuid(),
  employeeCode: z.string(),
  employeeName: z.string(),
  leaveType: leaveTypeSchema,
  startDate: z.string(),
  endDate: z.string(),
  reason: z.string().nullable(),
  status: leaveStatusSchema,
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const createLeaveRequestSchema = z.object({
  branchCode: z.string().min(1),
  employeeId: z.string().uuid(),
  leaveType: leaveTypeSchema,
  startDate: z.string(),
  endDate: z.string(),
  reason: z.string().max(500).optional(),
});

export const updateLeaveRequestSchema = z.object({
  status: z.enum(["approved", "rejected"]),
});

export const payrollLineSchema = z.object({
  id: z.string().uuid(),
  employeeId: z.string().uuid(),
  employeeCode: z.string(),
  employeeName: z.string(),
  grossPkr: z.number(),
  deductionsPkr: z.number(),
  overtimePkr: z.number(),
  netPkr: z.number(),
  /** Portion of deductions from prior salary advances (cash drawer pay-outs). */
  advancePkr: z.number().int().nonnegative().optional(),
  /** Statutory / other deductions (EOBI etc.) after advances. */
  statutoryPkr: z.number().int().nonnegative().optional(),
  baseSalaryPkr: z.number().int().nonnegative().optional(),
});

export const hrPayrollRunSchema = z.object({
  id: z.string().uuid(),
  payrollRef: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  totalGross: z.number(),
  totalDeductions: z.number(),
  /** Can be negative when advances exceed salary (baqaya / balance). */
  totalNet: z.number(),
  staffCount: z.number(),
  status: z.enum(["draft", "approved", "paid"]),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  /** ISO datetime when Pay was recorded. */
  paidAt: z.string().nullable().optional(),
  paidBy: z.string().nullable().optional(),
  lines: z.array(payrollLineSchema).optional(),
});

/** Body for PATCH .../payroll/:id/pay */
export const payPayrollSchema = z.object({
  /** ISO or local datetime (`YYYY-MM-DDTHH:mm`). Defaults to now. */
  paidAt: z.string().min(1).optional(),
});

export const payrollRunEmployeeInputSchema = z.object({
  employeeId: z.string().uuid(),
  /** Override base salary for this run; defaults to employee base salary. */
  grossPkr: z.number().int().nonnegative().optional(),
  overtimePkr: z.number().int().nonnegative().optional(),
  /**
   * Total deductions for this run (statutory + advances).
   * When omitted, server uses ~7.27% statutory + open advances.
   */
  deductionsPkr: z.number().int().nonnegative().optional(),
  /** Explicit advance amount to deduct (from open cash advances). */
  advancePkr: z.number().int().nonnegative().optional(),
});

export const createHrPayrollRunSchema = z.object({
  branchCode: z.string().min(1),
  periodStart: z.string(),
  periodEnd: z.string(),
  /** Staff to include — admin picks who gets paid this run. */
  employees: z.array(payrollRunEmployeeInputSchema).min(1),
  /** Offline/cloud sync idempotency — same id replays safely. */
  clientRequestId: z.string().min(8).max(80).optional(),
});

export const employeeAdvanceSchema = z.object({
  id: z.string().uuid(),
  employeeId: z.string().uuid(),
  employeeCode: z.string(),
  employeeName: z.string(),
  amountPkr: z.number().int().positive(),
  reason: z.string().nullable(),
  status: z.enum(["open", "reserved", "settled"]),
  cashMovementId: z.string().uuid().nullable(),
  payrollRunId: z.string().uuid().nullable(),
  recordedBy: z.string().nullable(),
  createdAt: z.string(),
  settledAt: z.string().nullable(),
});

export const createEmployeeAdvanceSchema = z.object({
  branchCode: z.string().min(1),
  employeeId: z.string().uuid(),
  amountPkr: z.number().int().positive(),
  reason: z.string().max(500).optional(),
  /** When set, also records a paid_out on this open cash session. */
  sessionId: z.string().uuid().optional(),
  clientRequestId: z.string().min(8).max(80).optional(),
});

export const employeeAdvanceSummarySchema = z.object({
  employeeId: z.string().uuid(),
  employeeCode: z.string(),
  employeeName: z.string(),
  baseSalaryPkr: z.number().int().nonnegative(),
  openAdvancePkr: z.number().int().nonnegative(),
  openAdvanceCount: z.number().int().nonnegative(),
  advances: z.array(employeeAdvanceSchema),
});

export const salarySlipSchema = z.object({
  id: z.string(),
  payrollRunId: z.string().uuid(),
  payrollRef: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  employeeCode: z.string(),
  employeeName: z.string(),
  jobTitle: z.string(),
  grossPkr: z.number(),
  deductionsPkr: z.number(),
  overtimePkr: z.number(),
  netPkr: z.number(),
  payrollStatus: z.enum(["draft", "approved", "paid"]),
  paidAt: z.string().nullable(),
});

export const hrDashboardSchema = z.object({
  branchCode: z.string(),
  activeEmployees: z.number(),
  presentToday: z.number(),
  lateToday: z.number(),
  absentToday: z.number(),
  pendingLeave: z.number(),
  latestPayroll: hrPayrollRunSchema.nullable(),
  todaysAttendance: z.array(attendanceRecordSchema),
  payPeriodSummary: z
    .object({
      periodStart: z.string(),
      periodEnd: z.string(),
      grossPkr: z.number(),
      deductionsPkr: z.number(),
      overtimePkr: z.number(),
      netPkr: z.number(),
      staffCount: z.number(),
    })
    .nullable(),
});

export type Employee = z.infer<typeof employeeSchema>;
export type CreateEmployee = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployee = z.infer<typeof updateEmployeeSchema>;
export type AttendanceRecord = z.infer<typeof attendanceRecordSchema>;
export type CreateAttendance = z.infer<typeof createAttendanceSchema>;
export type UpdateAttendance = z.infer<typeof updateAttendanceSchema>;
export type LeaveRequest = z.infer<typeof leaveRequestSchema>;
export type CreateLeaveRequest = z.infer<typeof createLeaveRequestSchema>;
export type UpdateLeaveRequest = z.infer<typeof updateLeaveRequestSchema>;
export type PayrollLine = z.infer<typeof payrollLineSchema>;
export type HrPayrollRun = z.infer<typeof hrPayrollRunSchema>;
export type PayrollRunEmployeeInput = z.infer<typeof payrollRunEmployeeInputSchema>;
export type CreateHrPayrollRun = z.infer<typeof createHrPayrollRunSchema>;
export type PayPayroll = z.infer<typeof payPayrollSchema>;
export type SalarySlip = z.infer<typeof salarySlipSchema>;
export type HrDashboard = z.infer<typeof hrDashboardSchema>;

export const staffFoodConsumerTypeSchema = z.enum(["staff", "guest"]);

export const staffFoodRecordSchema = z.object({
  id: z.string().uuid(),
  branchCode: z.string(),
  consumerType: staffFoodConsumerTypeSchema,
  employeeId: z.string().uuid().nullable(),
  personName: z.string(),
  employeeCode: z.string().nullable(),
  jobTitle: z.string().nullable(),
  supplierId: z.string().uuid().nullable(),
  supplierName: z.string().nullable(),
  expenseCategory: expenseCategorySchema,
  expenseId: z.string().uuid().nullable(),
  expenseRef: z.string().nullable(),
  mealDate: z.string(),
  itemsOrdered: z.string(),
  amountPkr: z.number().int().nonnegative(),
  notes: z.string().nullable(),
  recordedBy: z.string().nullable(),
  createdAt: z.string(),
});

export const createStaffFoodSchema = z.object({
  branchCode: z.string().min(1),
  consumerType: staffFoodConsumerTypeSchema,
  employeeId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  expenseCategory: expenseCategorySchema.optional().default("Staff Meals"),
  personName: z.string().min(1).max(120),
  mealDate: z.string(),
  itemsOrdered: z.string().min(1).max(1000),
  amountPkr: z.number().int().nonnegative(),
  notes: z.string().max(500).optional(),
});

export const staffFoodListSchema = z.object({
  branchCode: z.string(),
  recordCount: z.number(),
  todayTotalPkr: z.number(),
  monthTotalPkr: z.number(),
  records: z.array(staffFoodRecordSchema),
});

export type StaffFoodRecord = z.infer<typeof staffFoodRecordSchema>;
export type CreateStaffFood = z.infer<typeof createStaffFoodSchema>;
export type StaffFoodList = z.infer<typeof staffFoodListSchema>;
export type EmployeeAdvance = z.infer<typeof employeeAdvanceSchema>;
export type CreateEmployeeAdvance = z.infer<typeof createEmployeeAdvanceSchema>;
export type EmployeeAdvanceSummary = z.infer<typeof employeeAdvanceSummarySchema>;
