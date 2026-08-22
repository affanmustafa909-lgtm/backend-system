import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type {
  CreateAttendance,
  CreateEmployee,
  CreateEmployeeAdvance,
  CreateHrPayrollRun,
  CreateLeaveRequest,
  CreateStaffFood,
  PayPayroll,
  UpdateAttendance,
  UpdateEmployee,
  UpdateLeaveRequest,
} from "@platform/contracts";
import {
  organizationMemberships,
  popsAttendance,
  popsBranches,
  popsEmployeeAdvances,
  popsEmployees,
  popsLeaveRequests,
  popsPayrollLines,
  popsPayrollRuns,
  popsExpenses,
  popsStaffFood,
  popsSuppliers,
  users,
  type PlatformPgDb,
} from "@platform/database-pg";
import { AccountingService, resolvePayrollPaidAt } from "../accounting/accounting.service";
import { DRIZZLE } from "../drizzle/drizzle.tokens";

const DEDUCTION_RATE = 0.0727;

const EMPLOYEE_SEEDS = [
  {
    code: "E102",
    name: "Ayesha Khan",
    title: "Cashier",
    shift: "2pm–10pm",
    salary: 280_000,
    email: "cashier1@platform.local",
  },
  {
    code: "E088",
    name: "Bilal Ahmed",
    title: "Kitchen",
    shift: "12pm–8pm",
    salary: 260_000,
    email: "kitchen1@platform.local",
  },
  {
    code: "E091",
    name: "Sara Malik",
    title: "Waiter",
    shift: "5pm–1am",
    salary: 240_000,
    email: "waiter1@platform.local",
  },
  {
    code: "E094",
    name: "Hassan Raza",
    title: "Waiter",
    shift: "4pm–12am",
    salary: 240_000,
    email: "waiter2@platform.local",
  },
] as const;

@Injectable()
export class HrService implements OnModuleInit {
  private readonly logger = new Logger(HrService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly accounting: AccountingService,
  ) {}

  onModuleInit(): void {
    void (async () => {
      await this.db.execute(sql`
        ALTER TABLE pops_payroll_runs
        ADD COLUMN IF NOT EXISTS paid_at timestamptz
      `);
      await this.db.execute(sql`
        ALTER TABLE pops_payroll_runs
        ADD COLUMN IF NOT EXISTS paid_by text
      `);
      await this.db.execute(sql`
        ALTER TABLE pops_staff_food
        ADD COLUMN IF NOT EXISTS supplier_id uuid
      `);
      await this.db.execute(sql`
        ALTER TABLE pops_staff_food
        ADD COLUMN IF NOT EXISTS expense_category text NOT NULL DEFAULT 'Staff Meals'
      `);
      await this.db.execute(sql`
        ALTER TABLE pops_staff_food
        ADD COLUMN IF NOT EXISTS expense_id uuid
      `);
      await this.seedDefaultBranch();
    })().catch((err) => {
      this.logger.warn(
        `HR bootstrap skipped — run pnpm db:push if the schema changed: ${err instanceof Error ? err.message : err}`,
      );
    });
  }

  async getDashboard(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    await this.seedBranchIfEmpty(branch);

    const today = new Date().toISOString().slice(0, 10);
    const employees = await this.loadEmployees(branch.id);
    const active = employees.filter((e) => e.employmentStatus === "active");

    const attendanceRows = await this.db
      .select()
      .from(popsAttendance)
      .where(
        and(
          eq(popsAttendance.branchId, branch.id),
          eq(popsAttendance.attendanceDate, today),
        ),
      );

    const pendingLeaveRows = await this.db
      .select({ id: popsLeaveRequests.id })
      .from(popsLeaveRequests)
      .where(
        and(
          eq(popsLeaveRequests.branchId, branch.id),
          eq(popsLeaveRequests.status, "pending"),
        ),
      );

    const payrollRows = await this.db
      .select()
      .from(popsPayrollRuns)
      .where(
        and(
          eq(popsPayrollRuns.organizationId, organizationId),
          eq(popsPayrollRuns.branchId, branch.id),
        ),
      )
      .orderBy(desc(popsPayrollRuns.createdAt))
      .limit(1);

    const latestPayrollRow = payrollRows[0]
      ? await this.mapPayrollRun(payrollRows[0], true)
      : null;

    const todaysAttendance = await this.loadAttendance(branch.id, today);
    const payPeriodSummary = latestPayrollRow
      ? {
          periodStart: latestPayrollRow.periodStart,
          periodEnd: latestPayrollRow.periodEnd,
          grossPkr: latestPayrollRow.totalGross,
          deductionsPkr: latestPayrollRow.totalDeductions,
          overtimePkr: 0,
          netPkr: latestPayrollRow.totalNet,
          staffCount: latestPayrollRow.staffCount,
        }
      : this.estimatePayPeriod(active);

    return {
      branchCode: branch.code,
      activeEmployees: active.length,
      presentToday: attendanceRows.filter((a) => a.status === "present").length,
      lateToday: attendanceRows.filter((a) => a.status === "late").length,
      absentToday: attendanceRows.filter((a) => a.status === "absent").length,
      pendingLeave: pendingLeaveRows.length,
      latestPayroll: latestPayrollRow,
      todaysAttendance,
      payPeriodSummary,
    };
  }

  async listEmployees(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    await this.seedBranchIfEmpty(branch);
    const rows = await this.loadEmployees(branch.id);
    return { branchCode: branch.code, employees: rows.map((r) => this.mapEmployee(r, branch.code)) };
  }

  async createEmployee(organizationId: string, input: CreateEmployee) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const code = input.employeeCode.trim().toUpperCase();

    const existing = await this.db
      .select({ id: popsEmployees.id })
      .from(popsEmployees)
      .where(and(eq(popsEmployees.branchId, branch.id), eq(popsEmployees.employeeCode, code)))
      .limit(1);
    if (existing[0]) throw new BadRequestException(`Employee code ${code} already exists`);

    const [row] = await this.db
      .insert(popsEmployees)
      .values({
        organizationId,
        branchId: branch.id,
        userId: input.userId ?? null,
        employeeCode: code,
        displayName: input.displayName.trim(),
        jobTitle: input.jobTitle.trim(),
        department: input.department?.trim() || null,
        shiftLabel: input.shiftLabel?.trim() || null,
        baseSalaryPkr: input.baseSalaryPkr,
        joinDate: input.joinDate ?? new Date().toISOString().slice(0, 10),
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
      })
      .returning();

    if (!row) throw new BadRequestException("Failed to create employee");
    return this.mapEmployee(row, branch.code);
  }

  async updateEmployee(organizationId: string, employeeId: string, input: UpdateEmployee) {
    const row = await this.getEmployee(organizationId, employeeId);
    const branch = await this.getBranchById(row.branchId);

    const [updated] = await this.db
      .update(popsEmployees)
      .set({
        ...(input.displayName !== undefined ? { displayName: input.displayName.trim() } : {}),
        ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle.trim() } : {}),
        ...(input.department !== undefined ? { department: input.department?.trim() || null } : {}),
        ...(input.shiftLabel !== undefined ? { shiftLabel: input.shiftLabel?.trim() || null } : {}),
        ...(input.baseSalaryPkr !== undefined ? { baseSalaryPkr: input.baseSalaryPkr } : {}),
        ...(input.employmentStatus !== undefined ? { employmentStatus: input.employmentStatus } : {}),
        ...(input.joinDate !== undefined ? { joinDate: input.joinDate } : {}),
        ...(input.phone !== undefined ? { phone: input.phone?.trim() || null } : {}),
        ...(input.email !== undefined ? { email: input.email?.trim() || null } : {}),
        ...(input.userId !== undefined ? { userId: input.userId ?? null } : {}),
        ...(input.employeeCode !== undefined
          ? { employeeCode: input.employeeCode.trim().toUpperCase() }
          : {}),
      })
      .where(eq(popsEmployees.id, employeeId))
      .returning();

    if (!updated) throw new NotFoundException("Employee not found");
    return this.mapEmployee(updated, branch.code);
  }

  async syncEmployeesFromUsers(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const memberships = await this.db
      .select({
        userId: users.id,
        email: users.email,
        role: organizationMemberships.role,
      })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(eq(organizationMemberships.organizationId, organizationId));

    const existing = await this.loadEmployees(branch.id);
    const linkedUserIds = new Set(existing.map((e) => e.userId).filter(Boolean));
    let created = 0;

    for (const m of memberships) {
      if (linkedUserIds.has(m.userId)) continue;
      const scope = await this.db
        .select({ branchScope: organizationMemberships.branchScope })
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.userId, m.userId),
            eq(organizationMemberships.organizationId, organizationId),
          ),
        )
        .limit(1);
      const branchScope = scope[0]?.branchScope;
      if (branchScope && branchScope !== branch.code && branchScope !== "*") continue;

      const code = `E${Date.now().toString().slice(-4)}${created}`;
      await this.db.insert(popsEmployees).values({
        organizationId,
        branchId: branch.id,
        userId: m.userId,
        employeeCode: code,
        displayName: m.email.split("@")[0].replace(/\./g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        jobTitle: m.role.charAt(0).toUpperCase() + m.role.slice(1),
        // No fake default — set real salary via Edit employee after sync.
        baseSalaryPkr: 0,
        joinDate: new Date().toISOString().slice(0, 10),
        email: m.email,
      });
      created++;
    }

    return this.listEmployees(organizationId, branchCode);
  }

  async listAttendance(organizationId: string, branchCode: string, date?: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    await this.seedBranchIfEmpty(branch);
    const targetDate = date?.trim() || new Date().toISOString().slice(0, 10);
    const records = await this.loadAttendance(branch.id, targetDate);
    return { branchCode: branch.code, date: targetDate, records };
  }

  async createAttendance(organizationId: string, input: CreateAttendance) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    await this.getEmployee(organizationId, input.employeeId);

    const existing = await this.db
      .select({ id: popsAttendance.id })
      .from(popsAttendance)
      .where(
        and(
          eq(popsAttendance.employeeId, input.employeeId),
          eq(popsAttendance.attendanceDate, input.attendanceDate),
        ),
      )
      .limit(1);
    if (existing[0]) throw new BadRequestException("Attendance already recorded for this date");

    const [row] = await this.db
      .insert(popsAttendance)
      .values({
        organizationId,
        branchId: branch.id,
        employeeId: input.employeeId,
        attendanceDate: input.attendanceDate,
        shiftLabel: input.shiftLabel?.trim() || null,
        clockIn: input.clockIn?.trim() || null,
        clockOut: input.clockOut?.trim() || null,
        status: input.status ?? "present",
        notes: input.notes?.trim() || null,
      })
      .returning();

    if (!row) throw new BadRequestException("Failed to record attendance");
    const records = await this.loadAttendance(branch.id, input.attendanceDate);
    return records.find((r) => r.id === row.id)!;
  }

  async updateAttendance(organizationId: string, attendanceId: string, input: UpdateAttendance) {
    const rows = await this.db
      .select()
      .from(popsAttendance)
      .where(eq(popsAttendance.id, attendanceId))
      .limit(1);
    const row = rows[0];
    if (!row || row.organizationId !== organizationId) {
      throw new NotFoundException("Attendance record not found");
    }

    await this.db
      .update(popsAttendance)
      .set({
        ...(input.shiftLabel !== undefined ? { shiftLabel: input.shiftLabel?.trim() || null } : {}),
        ...(input.clockIn !== undefined ? { clockIn: input.clockIn?.trim() || null } : {}),
        ...(input.clockOut !== undefined ? { clockOut: input.clockOut?.trim() || null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      })
      .where(eq(popsAttendance.id, attendanceId));

    const records = await this.loadAttendance(row.branchId, row.attendanceDate);
    return records.find((r) => r.id === attendanceId)!;
  }

  async listLeave(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    await this.seedBranchIfEmpty(branch);

    const rows = await this.db
      .select({
        leave: popsLeaveRequests,
        employee: popsEmployees,
      })
      .from(popsLeaveRequests)
      .innerJoin(popsEmployees, eq(popsEmployees.id, popsLeaveRequests.employeeId))
      .where(eq(popsLeaveRequests.branchId, branch.id))
      .orderBy(desc(popsLeaveRequests.createdAt));

    return {
      branchCode: branch.code,
      requests: rows.map(({ leave, employee }) => this.mapLeave(leave, employee)),
    };
  }

  async createLeave(organizationId: string, input: CreateLeaveRequest) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    await this.getEmployee(organizationId, input.employeeId);

    const [row] = await this.db
      .insert(popsLeaveRequests)
      .values({
        organizationId,
        branchId: branch.id,
        employeeId: input.employeeId,
        leaveType: input.leaveType,
        startDate: input.startDate,
        endDate: input.endDate,
        reason: input.reason?.trim() || null,
      })
      .returning();

    if (!row) throw new BadRequestException("Failed to create leave request");
    const employee = await this.getEmployee(organizationId, input.employeeId);
    return this.mapLeave(row, employee);
  }

  async updateLeave(
    organizationId: string,
    leaveId: string,
    userEmail: string,
    input: UpdateLeaveRequest,
  ) {
    const rows = await this.db
      .select({
        leave: popsLeaveRequests,
        employee: popsEmployees,
      })
      .from(popsLeaveRequests)
      .innerJoin(popsEmployees, eq(popsEmployees.id, popsLeaveRequests.employeeId))
      .where(eq(popsLeaveRequests.id, leaveId))
      .limit(1);

    const found = rows[0];
    if (!found || found.leave.organizationId !== organizationId) {
      throw new NotFoundException("Leave request not found");
    }
    if (found.leave.status !== "pending") {
      throw new BadRequestException("Leave request already reviewed");
    }

    const [updated] = await this.db
      .update(popsLeaveRequests)
      .set({
        status: input.status,
        reviewedBy: userEmail,
        reviewedAt: new Date(),
      })
      .where(eq(popsLeaveRequests.id, leaveId))
      .returning();

    if (!updated) throw new NotFoundException("Leave request not found");

    if (input.status === "approved") {
      await this.db
        .update(popsEmployees)
        .set({ employmentStatus: "on_leave" })
        .where(eq(popsEmployees.id, found.employee.id));
    }

    return this.mapLeave(updated, found.employee);
  }

  async listPayroll(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(popsPayrollRuns)
      .where(
        and(
          eq(popsPayrollRuns.organizationId, organizationId),
          eq(popsPayrollRuns.branchId, branch.id),
        ),
      )
      .orderBy(desc(popsPayrollRuns.createdAt));

    const runs = await Promise.all(rows.map((r) => this.mapPayrollRun(r, false)));
    return { branchCode: branch.code, runs };
  }

  async getPayrollRun(organizationId: string, payrollId: string) {
    const rows = await this.db
      .select()
      .from(popsPayrollRuns)
      .where(eq(popsPayrollRuns.id, payrollId))
      .limit(1);
    const row = rows[0];
    if (!row || row.organizationId !== organizationId) {
      throw new NotFoundException("Payroll run not found");
    }
    return this.mapPayrollRun(row, true);
  }

  async createPayrollRun(organizationId: string, userEmail: string, input: CreateHrPayrollRun) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    await this.seedBranchIfEmpty(branch);

    // Idempotent replay for offline → cloud sync
    const syncRef = input.clientRequestId?.trim()
      ? `OFF-${input.clientRequestId.trim().replace(/[^a-zA-Z0-9]/g, "").slice(0, 20).toUpperCase()}`
      : null;
    if (syncRef) {
      const [existing] = await this.db
        .select()
        .from(popsPayrollRuns)
        .where(
          and(
            eq(popsPayrollRuns.organizationId, organizationId),
            eq(popsPayrollRuns.branchId, branch.id),
            eq(popsPayrollRuns.payrollRef, syncRef),
          ),
        )
        .limit(1);
      if (existing) return this.mapPayrollRun(existing, true);
    }

    const allEmployees = await this.loadEmployees(branch.id);
    const employeeMap = new Map(allEmployees.map((e) => [e.id, e]));

    const openAdvances = await this.db
      .select()
      .from(popsEmployeeAdvances)
      .where(
        and(
          eq(popsEmployeeAdvances.organizationId, organizationId),
          eq(popsEmployeeAdvances.branchId, branch.id),
          eq(popsEmployeeAdvances.status, "open"),
        ),
      );

    const advancesByEmployee = new Map<string, typeof openAdvances>();
    for (const adv of openAdvances) {
      const list = advancesByEmployee.get(adv.employeeId) ?? [];
      list.push(adv);
      advancesByEmployee.set(adv.employeeId, list);
    }

    const lines: {
      employeeId: string;
      gross: number;
      deductions: number;
      overtime: number;
      net: number;
      advance: number;
      statutory: number;
      advanceIds: string[];
    }[] = [];

    for (const pick of input.employees) {
      const emp = employeeMap.get(pick.employeeId);
      if (!emp) {
        throw new BadRequestException(`Employee not found: ${pick.employeeId}`);
      }
      if (emp.employmentStatus === "terminated") {
        throw new BadRequestException(`${emp.displayName} is terminated and cannot be paid`);
      }
      if (emp.branchId !== branch.id) {
        throw new BadRequestException(`${emp.displayName} belongs to another branch`);
      }

      const gross = Number(pick.grossPkr ?? emp.baseSalaryPkr);
      const overtime = Number(pick.overtimePkr ?? 0);
      const empAdvances = advancesByEmployee.get(emp.id) ?? [];
      const openAdvanceTotal = empAdvances.reduce((s, a) => s + a.amountPkr, 0);
      const advance =
        pick.advancePkr !== undefined ? Number(pick.advancePkr) : openAdvanceTotal;
      const statutoryDefault = Math.round(gross * DEDUCTION_RATE);
      let statutory: number;
      let deductions: number;
      if (pick.deductionsPkr !== undefined) {
        deductions = Number(pick.deductionsPkr);
        // Preserve advance portion inside total deductions when client sent a total.
        statutory = Math.max(0, deductions - advance);
      } else {
        statutory = statutoryDefault;
        deductions = statutory + advance;
      }
      // Negative baqaya when advances exceed salary — show minus balance.
      const net = gross + overtime - deductions;
      lines.push({
        employeeId: emp.id,
        gross,
        deductions,
        overtime,
        net,
        advance,
        statutory,
        advanceIds: empAdvances.map((a) => a.id),
      });
    }

    if (lines.length === 0) {
      throw new BadRequestException("Select at least one employee for payroll");
    }

    const totalGross = lines.reduce((s, l) => s + l.gross + l.overtime, 0);
    const totalDeductions = lines.reduce((s, l) => s + l.deductions, 0);
    const totalNet = lines.reduce((s, l) => s + l.net, 0);

    const payroll = await this.accounting.createPayrollRun(organizationId, userEmail, {
      branchCode: branch.code,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      totalGross,
      totalDeductions,
      staffCount: lines.length,
    });

    if (syncRef) {
      await this.db
        .update(popsPayrollRuns)
        .set({ payrollRef: syncRef })
        .where(eq(popsPayrollRuns.id, payroll.id));
    }

    await this.db.insert(popsPayrollLines).values(
      lines.map((l) => ({
        payrollRunId: payroll.id,
        employeeId: l.employeeId,
        grossPkr: l.gross,
        deductionsPkr: l.deductions,
        overtimePkr: l.overtime,
        netPkr: l.net,
      })),
    );

    // Reserve open advances so they are not double-applied on another run.
    for (const line of lines) {
      if (line.advanceIds.length === 0) continue;
      await this.db
        .update(popsEmployeeAdvances)
        .set({ status: "reserved", payrollRunId: payroll.id })
        .where(
          and(
            eq(popsEmployeeAdvances.organizationId, organizationId),
            inArray(popsEmployeeAdvances.id, line.advanceIds),
          ),
        );
    }

    const runRows = await this.db
      .select()
      .from(popsPayrollRuns)
      .where(eq(popsPayrollRuns.id, payroll.id))
      .limit(1);
    const run = runRows[0];
    if (!run) throw new BadRequestException("Payroll run creation failed");

    return this.mapPayrollRun(run, true);
  }

  async deletePayrollRun(organizationId: string, payrollId: string) {
    const rows = await this.db
      .select()
      .from(popsPayrollRuns)
      .where(eq(popsPayrollRuns.id, payrollId))
      .limit(1);
    const run = rows[0];
    if (!run || run.organizationId !== organizationId) {
      throw new NotFoundException("Payroll run not found");
    }
    if (run.status !== "draft") {
      throw new BadRequestException("Only draft payroll runs can be deleted");
    }

    // Re-open advances that were reserved for this draft.
    await this.db
      .update(popsEmployeeAdvances)
      .set({ status: "open", payrollRunId: null })
      .where(
        and(
          eq(popsEmployeeAdvances.organizationId, organizationId),
          eq(popsEmployeeAdvances.payrollRunId, payrollId),
          eq(popsEmployeeAdvances.status, "reserved"),
        ),
      );

    await this.db.delete(popsPayrollLines).where(eq(popsPayrollLines.payrollRunId, payrollId));
    await this.db.delete(popsPayrollRuns).where(eq(popsPayrollRuns.id, payrollId));
    return { ok: true, payrollRef: run.payrollRef };
  }

  async approvePayroll(organizationId: string, userEmail: string, payrollId: string) {
    await this.accounting.approvePayroll(organizationId, userEmail, payrollId);
    return this.getPayrollRun(organizationId, payrollId);
  }

  async payPayroll(
    organizationId: string,
    userEmail: string,
    payrollId: string,
    input?: PayPayroll,
  ) {
    const paidAt = resolvePayrollPaidAt(input?.paidAt);
    await this.accounting.payPayroll(organizationId, userEmail, payrollId, {
      paidAt: paidAt.toISOString(),
    });
    await this.settleAdvancesForPayroll(organizationId, payrollId, paidAt);
    return this.getPayrollRun(organizationId, payrollId);
  }

  /**
   * Settle advances up to each employee's earnable salary this run.
   * Excess (advance > salary) stays open so next period still shows outstanding.
   */
  private async settleAdvancesForPayroll(
    organizationId: string,
    payrollId: string,
    paidAt: Date,
  ): Promise<void> {
    const lineRows = await this.db
      .select()
      .from(popsPayrollLines)
      .where(eq(popsPayrollLines.payrollRunId, payrollId));

    const reserved = await this.db
      .select()
      .from(popsEmployeeAdvances)
      .where(
        and(
          eq(popsEmployeeAdvances.organizationId, organizationId),
          eq(popsEmployeeAdvances.payrollRunId, payrollId),
          eq(popsEmployeeAdvances.status, "reserved"),
        ),
      )
      .orderBy(asc(popsEmployeeAdvances.createdAt));

    const byEmployee = new Map<string, typeof reserved>();
    for (const adv of reserved) {
      const list = byEmployee.get(adv.employeeId) ?? [];
      list.push(adv);
      byEmployee.set(adv.employeeId, list);
    }

    for (const line of lineRows) {
      const advances = byEmployee.get(line.employeeId) ?? [];
      if (advances.length === 0) continue;
      const advanceTotal = advances.reduce((s, a) => s + a.amountPkr, 0);
      const statutory = Math.max(0, line.deductionsPkr - advanceTotal);
      // Max advance this salary can clear.
      const earnable = Math.max(0, line.grossPkr + line.overtimePkr - statutory);
      let remaining = earnable;
      for (const adv of advances) {
        if (remaining <= 0) {
          await this.db
            .update(popsEmployeeAdvances)
            .set({ status: "open", payrollRunId: null })
            .where(eq(popsEmployeeAdvances.id, adv.id));
          continue;
        }
        if (adv.amountPkr <= remaining) {
          await this.db
            .update(popsEmployeeAdvances)
            .set({ status: "settled", settledAt: paidAt })
            .where(eq(popsEmployeeAdvances.id, adv.id));
          remaining -= adv.amountPkr;
        } else {
          // Partial: keep full advance open (simpler than splitting rows).
          await this.db
            .update(popsEmployeeAdvances)
            .set({ status: "open", payrollRunId: null })
            .where(eq(popsEmployeeAdvances.id, adv.id));
        }
      }
    }
  }

  /**
   * Record a salary advance from HR (payroll UI +).
   * Optional sessionId also posts a cash drawer paid_out; otherwise ledger-only.
   */
  async createEmployeeAdvance(
    organizationId: string,
    userEmail: string,
    input: CreateEmployeeAdvance,
  ) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [emp] = await this.db
      .select()
      .from(popsEmployees)
      .where(
        and(
          eq(popsEmployees.id, input.employeeId),
          eq(popsEmployees.organizationId, organizationId),
          eq(popsEmployees.branchId, branch.id),
        ),
      )
      .limit(1);
    if (!emp) throw new NotFoundException("Employee not found on this branch");
    if (emp.employmentStatus === "terminated") {
      throw new BadRequestException("Cannot advance a terminated employee");
    }

    const reason = (input.reason?.trim() || `Employee advance: ${emp.displayName}`).slice(0, 500);
    const amountPkr = Math.round(input.amountPkr);
    if (amountPkr <= 0) throw new BadRequestException("Advance amount must be positive");
    // Advances may exceed base salary — payroll baqaya goes negative.

    if (input.sessionId) {
      const movement = await this.accounting.recordCashMovement(organizationId, userEmail, {
        branchCode: input.branchCode,
        sessionId: input.sessionId,
        type: "paid_out",
        amountPkr,
        reason: `Employee advance: ${emp.displayName} — ${reason}`,
        partyKind: "employee",
        employeeId: emp.id,
        asAdvance: true,
        clientRequestId: input.clientRequestId,
      });
      if (movement.advanceId) {
        const [advance] = await this.db
          .select()
          .from(popsEmployeeAdvances)
          .where(eq(popsEmployeeAdvances.id, movement.advanceId))
          .limit(1);
        if (advance) return this.mapAdvance(advance, emp);
      }
    }

    if (input.clientRequestId) {
      const [existing] = await this.db
        .select()
        .from(popsEmployeeAdvances)
        .where(
          and(
            eq(popsEmployeeAdvances.organizationId, organizationId),
            eq(popsEmployeeAdvances.clientRequestId, input.clientRequestId),
          ),
        )
        .limit(1);
      if (existing) return this.mapAdvance(existing, emp);
    }

    const [advance] = await this.db
      .insert(popsEmployeeAdvances)
      .values({
        organizationId,
        branchId: branch.id,
        employeeId: emp.id,
        amountPkr,
        reason,
        cashMovementId: null,
        status: "open",
        clientRequestId: input.clientRequestId ?? null,
        recordedBy: userEmail,
      })
      .returning();
    if (!advance) throw new BadRequestException("Failed to record advance");
    return this.mapAdvance(advance, emp);
  }

  /** Open (and optionally reserved) salary advances for payroll planning. */
  async listEmployeeAdvances(organizationId: string, branchCode: string, status?: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    await this.seedBranchIfEmpty(branch);

    const conditions = [
      eq(popsEmployeeAdvances.organizationId, organizationId),
      eq(popsEmployeeAdvances.branchId, branch.id),
    ];
    if (status === "open" || status === "reserved" || status === "settled") {
      conditions.push(eq(popsEmployeeAdvances.status, status));
    }

    const rows = await this.db
      .select({
        advance: popsEmployeeAdvances,
        employee: popsEmployees,
      })
      .from(popsEmployeeAdvances)
      .innerJoin(popsEmployees, eq(popsEmployees.id, popsEmployeeAdvances.employeeId))
      .where(and(...conditions))
      .orderBy(desc(popsEmployeeAdvances.createdAt));

    const byEmployee = new Map<
      string,
      {
        employeeId: string;
        employeeCode: string;
        employeeName: string;
        baseSalaryPkr: number;
        openAdvancePkr: number;
        openAdvanceCount: number;
        advances: ReturnType<HrService["mapAdvance"]>[];
      }
    >();

    for (const { advance, employee } of rows) {
      const mapped = this.mapAdvance(advance, employee);
      let summary = byEmployee.get(employee.id);
      if (!summary) {
        summary = {
          employeeId: employee.id,
          employeeCode: employee.employeeCode,
          employeeName: employee.displayName,
          baseSalaryPkr: employee.baseSalaryPkr,
          openAdvancePkr: 0,
          openAdvanceCount: 0,
          advances: [],
        };
        byEmployee.set(employee.id, summary);
      }
      summary.advances.push(mapped);
      if (advance.status === "open") {
        summary.openAdvancePkr += advance.amountPkr;
        summary.openAdvanceCount += 1;
      }
    }

    // Ensure active employees appear even with zero advances (helps payroll UI).
    const employees = await this.loadEmployees(branch.id);
    for (const emp of employees) {
      if (emp.employmentStatus === "terminated") continue;
      if (byEmployee.has(emp.id)) continue;
      byEmployee.set(emp.id, {
        employeeId: emp.id,
        employeeCode: emp.employeeCode,
        employeeName: emp.displayName,
        baseSalaryPkr: emp.baseSalaryPkr,
        openAdvancePkr: 0,
        openAdvanceCount: 0,
        advances: [],
      });
    }

    return [...byEmployee.values()].sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
  }

  private mapAdvance(
    advance: typeof popsEmployeeAdvances.$inferSelect,
    employee: typeof popsEmployees.$inferSelect,
  ) {
    return {
      id: advance.id,
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      employeeName: employee.displayName,
      amountPkr: advance.amountPkr,
      reason: advance.reason,
      status: advance.status as "open" | "reserved" | "settled",
      cashMovementId: advance.cashMovementId,
      payrollRunId: advance.payrollRunId,
      recordedBy: advance.recordedBy,
      createdAt: advance.createdAt.toISOString(),
      settledAt: advance.settledAt?.toISOString() ?? null,
    };
  }

  async listSalarySlips(organizationId: string, branchCode: string, payrollRunId?: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    await this.seedBranchIfEmpty(branch);

    const runConditions = [
      eq(popsPayrollRuns.organizationId, organizationId),
      eq(popsPayrollRuns.branchId, branch.id),
    ];
    if (payrollRunId) {
      runConditions.push(eq(popsPayrollRuns.id, payrollRunId));
    }

    const runs = await this.db
      .select()
      .from(popsPayrollRuns)
      .where(and(...runConditions))
      .orderBy(desc(popsPayrollRuns.createdAt));

    const slips: Array<{
      id: string;
      payrollRunId: string;
      payrollRef: string;
      periodStart: string;
      periodEnd: string;
      employeeCode: string;
      employeeName: string;
      jobTitle: string;
      grossPkr: number;
      deductionsPkr: number;
      overtimePkr: number;
      netPkr: number;
      payrollStatus: "draft" | "approved" | "paid";
      paidAt: string | null;
    }> = [];

    for (const run of runs) {
      const lineRows = await this.db
        .select({
          line: popsPayrollLines,
          employee: popsEmployees,
        })
        .from(popsPayrollLines)
        .innerJoin(popsEmployees, eq(popsEmployees.id, popsPayrollLines.employeeId))
        .where(eq(popsPayrollLines.payrollRunId, run.id));

      const status = run.status as "draft" | "approved" | "paid";
      const paidAt =
        status === "paid"
          ? (run.paidAt?.toISOString() ?? run.createdAt.toISOString())
          : null;

      if (lineRows.length > 0) {
        for (const { line, employee } of lineRows) {
          slips.push({
            id: line.id,
            payrollRunId: run.id,
            payrollRef: run.payrollRef,
            periodStart: run.periodStart,
            periodEnd: run.periodEnd,
            employeeCode: employee.employeeCode,
            employeeName: employee.displayName,
            jobTitle: employee.jobTitle,
            grossPkr: line.grossPkr,
            deductionsPkr: line.deductionsPkr,
            overtimePkr: line.overtimePkr,
            netPkr: line.netPkr,
            payrollStatus: status,
            paidAt,
          });
        }
      } else {
        slips.push(...(await this.syntheticSlipsForRun(run, status, paidAt)));
      }
    }

    return { branchCode: branch.code, slips };
  }

  async listStaffFood(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select({
        record: popsStaffFood,
        employee: popsEmployees,
        supplier: popsSuppliers,
      })
      .from(popsStaffFood)
      .leftJoin(popsEmployees, eq(popsEmployees.id, popsStaffFood.employeeId))
      .leftJoin(popsSuppliers, eq(popsSuppliers.id, popsStaffFood.supplierId))
      .where(
        and(
          eq(popsStaffFood.organizationId, organizationId),
          eq(popsStaffFood.branchId, branch.id),
        ),
      )
      .orderBy(desc(popsStaffFood.mealDate), desc(popsStaffFood.createdAt));

    const expenseIds = [
      ...new Set(rows.map((r) => r.record.expenseId).filter((id): id is string => Boolean(id))),
    ];
    const expenseRefById = new Map<string, string>();
    if (expenseIds.length > 0) {
      const expenseRows = await this.db
        .select({ id: popsExpenses.id, expenseRef: popsExpenses.expenseRef })
        .from(popsExpenses)
        .where(inArray(popsExpenses.id, expenseIds));
      for (const e of expenseRows) expenseRefById.set(e.id, e.expenseRef);
    }

    const records = rows.map(({ record, employee, supplier }) =>
      this.mapStaffFood(
        record,
        branch.code,
        employee,
        supplier,
        expenseRefById.get(record.expenseId ?? "") ?? null,
      ),
    );
    const today = new Date().toISOString().slice(0, 10);
    const monthPrefix = today.slice(0, 7);

    return {
      branchCode: branch.code,
      recordCount: records.length,
      todayTotalPkr: records
        .filter((r) => r.mealDate === today)
        .reduce((sum, r) => sum + r.amountPkr, 0),
      monthTotalPkr: records
        .filter((r) => r.mealDate.startsWith(monthPrefix))
        .reduce((sum, r) => sum + r.amountPkr, 0),
      records,
    };
  }

  async createStaffFood(organizationId: string, userId: string, input: CreateStaffFood) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    let personName = input.personName.trim();
    let employeeId: string | null = input.employeeId ?? null;
    let supplierId: string | null = input.supplierId ?? null;
    let supplierName: string | null = null;
    const expenseCategory = input.expenseCategory ?? "Staff Meals";

    if (input.consumerType === "staff") {
      if (!employeeId) {
        throw new BadRequestException("Select a staff member for staff meals.");
      }
      const employee = await this.getEmployee(organizationId, employeeId);
      if (employee.branchId !== branch.id) {
        throw new BadRequestException("Employee does not belong to this branch.");
      }
      personName = employee.displayName;
    } else {
      employeeId = null;
      if (!personName) {
        throw new BadRequestException("Enter the guest name.");
      }
    }

    if (supplierId) {
      const supplierRows = await this.db
        .select()
        .from(popsSuppliers)
        .where(
          and(
            eq(popsSuppliers.id, supplierId),
            eq(popsSuppliers.organizationId, organizationId),
            eq(popsSuppliers.branchId, branch.id),
          ),
        )
        .limit(1);
      const supplier = supplierRows[0];
      if (!supplier) {
        throw new BadRequestException("Supplier not found for this branch.");
      }
      supplierName = supplier.name;
    }

    const recordedBy = await this.resolveRecordedBy(userId);
    const [row] = await this.db
      .insert(popsStaffFood)
      .values({
        organizationId,
        branchId: branch.id,
        employeeId,
        supplierId,
        expenseCategory,
        consumerType: input.consumerType,
        personName,
        mealDate: input.mealDate,
        itemsOrdered: input.itemsOrdered.trim(),
        amountPkr: input.amountPkr,
        notes: input.notes?.trim() || null,
        recordedBy,
      })
      .returning();

    let expenseId: string | null = null;
    let expenseRef: string | null = null;
    if (row && input.amountPkr > 0) {
      try {
        const expense = await this.accounting.createExpense(organizationId, recordedBy, {
          branchCode: branch.code,
          category: expenseCategory,
          amount: input.amountPkr,
          expenseDate: input.mealDate,
          vendor: supplierName ?? personName,
          description: `Staff food · ${personName} · ${input.itemsOrdered.trim()}`.slice(0, 500),
          recurring: false,
        });
        expenseId = expense.id;
        expenseRef = expense.expenseRef;
        await this.db
          .update(popsStaffFood)
          .set({ expenseId })
          .where(eq(popsStaffFood.id, row.id));
      } catch (err) {
        this.logger.warn(
          `Staff food expense link skipped: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    const employee = employeeId ? await this.getEmployee(organizationId, employeeId) : null;
    const supplier =
      supplierId != null
        ? (
            await this.db
              .select()
              .from(popsSuppliers)
              .where(eq(popsSuppliers.id, supplierId))
              .limit(1)
          )[0] ?? null
        : null;
    const linked = expenseId && row ? { ...row, expenseId } : row;
    return this.mapStaffFood(linked, branch.code, employee, supplier, expenseRef);
  }

  async deleteStaffFood(organizationId: string, recordId: string) {
    const rows = await this.db
      .select()
      .from(popsStaffFood)
      .where(and(eq(popsStaffFood.id, recordId), eq(popsStaffFood.organizationId, organizationId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException("Staff food record not found");
    await this.db.delete(popsStaffFood).where(eq(popsStaffFood.id, recordId));
    return { ok: true };
  }

  /** Build per-employee slips when payroll lines were not stored (e.g. accounting-only run). */
  private async syntheticSlipsForRun(
    run: typeof popsPayrollRuns.$inferSelect,
    status: "draft" | "approved" | "paid",
    paidAt: string | null,
  ) {
    const employees = (await this.loadEmployees(run.branchId)).filter(
      (e) => e.employmentStatus === "active" || e.employmentStatus === "on_leave",
    );
    const count =
      run.staffCount > 0 ? Math.min(run.staffCount, employees.length) : employees.length;
    const slice = employees.slice(0, count);
    if (slice.length === 0) return [];

    const totalBase = slice.reduce((s, e) => s + e.baseSalaryPkr, 0) || slice.length;

    return slice.map((emp) => {
      const share = totalBase > 0 ? emp.baseSalaryPkr / totalBase : 1 / slice.length;
      const gross = Math.round(run.totalGrossPkr * share);
      const deductions = Math.round(run.totalDeductionsPkr * share);
      const net = gross - deductions;
      return {
        id: `${run.id}:${emp.id}`,
        payrollRunId: run.id,
        payrollRef: run.payrollRef,
        periodStart: run.periodStart,
        periodEnd: run.periodEnd,
        employeeCode: emp.employeeCode,
        employeeName: emp.displayName,
        jobTitle: emp.jobTitle,
        grossPkr: gross,
        deductionsPkr: deductions,
        overtimePkr: 0,
        netPkr: net,
        payrollStatus: status,
        paidAt,
      };
    });
  }

  private estimatePayPeriod(active: (typeof popsEmployees.$inferSelect)[]) {
    const gross = active.reduce((s, e) => s + e.baseSalaryPkr, 0);
    const deductions = Math.round(gross * DEDUCTION_RATE);
    const now = new Date();
    const periodStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const periodEnd = now.toISOString().slice(0, 10);
    return {
      periodStart,
      periodEnd,
      grossPkr: gross,
      deductionsPkr: deductions,
      overtimePkr: 0,
      netPkr: gross - deductions,
      staffCount: active.length,
    };
  }

  private async mapPayrollRun(row: typeof popsPayrollRuns.$inferSelect, withLines = false) {
    const base = {
      id: row.id,
      payrollRef: row.payrollRef,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      totalGross: row.totalGrossPkr,
      totalDeductions: row.totalDeductionsPkr,
      totalNet: row.totalNetPkr,
      staffCount: row.staffCount,
      status: row.status as "draft" | "approved" | "paid",
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      paidAt: row.paidAt ? row.paidAt.toISOString() : null,
      paidBy: row.paidBy ?? null,
    };

    if (!withLines) return base;

    const lineRows = await this.db
      .select({
        line: popsPayrollLines,
        employee: popsEmployees,
      })
      .from(popsPayrollLines)
      .innerJoin(popsEmployees, eq(popsEmployees.id, popsPayrollLines.employeeId))
      .where(eq(popsPayrollLines.payrollRunId, row.id));

    const reservedAdvances = await this.db
      .select()
      .from(popsEmployeeAdvances)
      .where(
        and(
          eq(popsEmployeeAdvances.organizationId, row.organizationId),
          eq(popsEmployeeAdvances.payrollRunId, row.id),
        ),
      );
    const advanceByEmployee = new Map<string, number>();
    for (const adv of reservedAdvances) {
      advanceByEmployee.set(adv.employeeId, (advanceByEmployee.get(adv.employeeId) ?? 0) + adv.amountPkr);
    }

    return {
      ...base,
      lines: lineRows.map(({ line, employee }) => {
        const advancePkr = advanceByEmployee.get(employee.id) ?? 0;
        const statutoryPkr = Math.max(0, line.deductionsPkr - advancePkr);
        return {
          id: line.id,
          employeeId: employee.id,
          employeeCode: employee.employeeCode,
          employeeName: employee.displayName,
          grossPkr: line.grossPkr,
          deductionsPkr: line.deductionsPkr,
          overtimePkr: line.overtimePkr,
          netPkr: line.netPkr,
          advancePkr,
          statutoryPkr,
          baseSalaryPkr: employee.baseSalaryPkr,
        };
      }),
    };
  }

  private mapEmployee(row: typeof popsEmployees.$inferSelect, branchCode: string) {
    return {
      id: row.id,
      employeeCode: row.employeeCode,
      displayName: row.displayName,
      jobTitle: row.jobTitle,
      department: row.department,
      shiftLabel: row.shiftLabel,
      baseSalaryPkr: row.baseSalaryPkr,
      employmentStatus: row.employmentStatus as "active" | "on_leave" | "terminated",
      joinDate: row.joinDate,
      phone: row.phone,
      email: row.email,
      userId: row.userId,
      branchCode,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapLeave(
    leave: typeof popsLeaveRequests.$inferSelect,
    employee: typeof popsEmployees.$inferSelect,
  ) {
    return {
      id: leave.id,
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      employeeName: employee.displayName,
      leaveType: leave.leaveType as "annual" | "sick" | "unpaid",
      startDate: leave.startDate,
      endDate: leave.endDate,
      reason: leave.reason,
      status: leave.status as "pending" | "approved" | "rejected",
      reviewedBy: leave.reviewedBy,
      reviewedAt: leave.reviewedAt?.toISOString() ?? null,
      createdAt: leave.createdAt.toISOString(),
    };
  }

  private mapStaffFood(
    record: typeof popsStaffFood.$inferSelect,
    branchCode: string,
    employee: typeof popsEmployees.$inferSelect | null,
    supplier: typeof popsSuppliers.$inferSelect | null = null,
    expenseRef: string | null = null,
  ) {
    const category = (record.expenseCategory || "Staff Meals") as
      | "Rent"
      | "Utilities"
      | "Gas"
      | "Staff Meals"
      | "Marketing"
      | "Maintenance"
      | "Internet"
      | "Transportation"
      | "Food Purchases"
      | "Salaries"
      | "Other";
    return {
      id: record.id,
      branchCode,
      consumerType: record.consumerType as "staff" | "guest",
      employeeId: record.employeeId,
      personName: record.personName,
      employeeCode: employee?.employeeCode ?? null,
      jobTitle: employee?.jobTitle ?? null,
      supplierId: record.supplierId ?? null,
      supplierName: supplier?.name ?? null,
      expenseCategory: category,
      expenseId: record.expenseId ?? null,
      expenseRef,
      mealDate: record.mealDate,
      itemsOrdered: record.itemsOrdered,
      amountPkr: record.amountPkr,
      notes: record.notes,
      recordedBy: record.recordedBy,
      createdAt: record.createdAt.toISOString(),
    };
  }

  private async resolveRecordedBy(userId: string): Promise<string> {
    const rows = await this.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return rows[0]?.email ?? userId;
  }

  private async loadEmployees(branchId: string) {
    return this.db
      .select()
      .from(popsEmployees)
      .where(eq(popsEmployees.branchId, branchId))
      .orderBy(popsEmployees.employeeCode);
  }

  private async loadAttendance(branchId: string, date: string) {
    const rows = await this.db
      .select({
        attendance: popsAttendance,
        employee: popsEmployees,
      })
      .from(popsAttendance)
      .innerJoin(popsEmployees, eq(popsEmployees.id, popsAttendance.employeeId))
      .where(
        and(eq(popsAttendance.branchId, branchId), eq(popsAttendance.attendanceDate, date)),
      )
      .orderBy(popsEmployees.employeeCode);

    return rows.map(({ attendance, employee }) => ({
      id: attendance.id,
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      employeeName: employee.displayName,
      jobTitle: employee.jobTitle,
      attendanceDate: attendance.attendanceDate,
      shiftLabel: attendance.shiftLabel,
      clockIn: attendance.clockIn,
      clockOut: attendance.clockOut,
      status: attendance.status as "present" | "late" | "absent" | "on_leave",
      notes: attendance.notes,
    }));
  }

  private async getEmployee(organizationId: string, employeeId: string) {
    const rows = await this.db
      .select()
      .from(popsEmployees)
      .where(eq(popsEmployees.id, employeeId))
      .limit(1);
    const row = rows[0];
    if (!row || row.organizationId !== organizationId) {
      throw new NotFoundException("Employee not found");
    }
    return row;
  }

  private async resolveBranch(organizationId: string, branchCode: string) {
    const code = branchCode.trim();
    const rows = await this.db
      .select()
      .from(popsBranches)
      .where(and(eq(popsBranches.organizationId, organizationId), eq(popsBranches.code, code)))
      .limit(1);
    const branch = rows[0];
    if (!branch) throw new NotFoundException(`Branch not found: ${code}`);
    return branch;
  }

  private async getBranchById(branchId: string) {
    const rows = await this.db
      .select()
      .from(popsBranches)
      .where(eq(popsBranches.id, branchId))
      .limit(1);
    const branch = rows[0];
    if (!branch) throw new NotFoundException("Branch not found");
    return branch;
  }

  private async seedDefaultBranch(): Promise<void> {
    const branches = await this.db.select().from(popsBranches).limit(1);
    const branch = branches[0];
    if (branch) await this.seedBranchIfEmpty(branch);
  }

  private async seedBranchIfEmpty(branch: typeof popsBranches.$inferSelect): Promise<void> {
    const existing = await this.db
      .select({ id: popsEmployees.id })
      .from(popsEmployees)
      .where(eq(popsEmployees.branchId, branch.id))
      .limit(1);
    if (existing[0]) return;

    for (const seed of EMPLOYEE_SEEDS) {
      const userRows = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, seed.email))
        .limit(1);

      await this.db.insert(popsEmployees).values({
        organizationId: branch.organizationId,
        branchId: branch.id,
        userId: userRows[0]?.id ?? null,
        employeeCode: seed.code,
        displayName: seed.name,
        jobTitle: seed.title,
        department: "Operations",
        shiftLabel: seed.shift,
        baseSalaryPkr: seed.salary,
        joinDate: "2024-01-15",
        email: seed.email,
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const employees = await this.loadEmployees(branch.id);
    const statuses: Array<"present" | "late" | "present" | "present"> = [
      "present",
      "present",
      "late",
      "present",
    ];

    for (let i = 0; i < employees.length; i++) {
      const emp = employees[i];
      await this.db.insert(popsAttendance).values({
        organizationId: branch.organizationId,
        branchId: branch.id,
        employeeId: emp.id,
        attendanceDate: today,
        shiftLabel: emp.shiftLabel,
        clockIn: statuses[i] === "late" ? "14:35" : "14:00",
        status: statuses[i] ?? "present",
      });
    }
  }
}
