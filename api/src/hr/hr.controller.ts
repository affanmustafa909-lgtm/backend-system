import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  createAttendanceSchema,
  createEmployeeAdvanceSchema,
  createEmployeeSchema,
  createHrPayrollRunSchema,
  createLeaveRequestSchema,
  createStaffFoodSchema,
  payPayrollSchema,
  updateAttendanceSchema,
  updateEmployeeSchema,
  updateLeaveRequestSchema,
} from "@platform/contracts";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { PermissionsGuard } from "../users/permissions.guard";
import { RequirePermissions } from "../users/require-permission.decorator";
import { HrService } from "./hr.service";

@Controller("v1/hr")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class HrController {
  constructor(private readonly hr: HrService) {}

  @Get("dashboard")
  @RequirePermissions("pops.read")
  getDashboard(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.hr.getDashboard(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("employees")
  @RequirePermissions("pops.read")
  listEmployees(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.hr.listEmployees(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("employees")
  @RequirePermissions("pops.hr.manage")
  createEmployee(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.hr.createEmployee(user.organizationId, createEmployeeSchema.parse(body));
  }

  @Patch("employees/:employeeId")
  @RequirePermissions("pops.hr.manage")
  updateEmployee(
    @CurrentUser() user: AccessJwtPayload,
    @Param("employeeId") employeeId: string,
    @Body() body: unknown,
  ) {
    return this.hr.updateEmployee(user.organizationId, employeeId, updateEmployeeSchema.parse(body));
  }

  @Post("employees/sync-from-users")
  @RequirePermissions("pops.hr.manage")
  syncEmployees(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.hr.syncEmployeesFromUsers(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("attendance")
  @RequirePermissions("pops.read")
  listAttendance(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("date") date?: string,
  ) {
    return this.hr.listAttendance(user.organizationId, branchCode?.trim() ?? "", date);
  }

  @Post("attendance")
  @RequirePermissions("pops.hr.manage")
  createAttendance(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.hr.createAttendance(user.organizationId, createAttendanceSchema.parse(body));
  }

  @Patch("attendance/:attendanceId")
  @RequirePermissions("pops.hr.manage")
  updateAttendance(
    @CurrentUser() user: AccessJwtPayload,
    @Param("attendanceId") attendanceId: string,
    @Body() body: unknown,
  ) {
    return this.hr.updateAttendance(
      user.organizationId,
      attendanceId,
      updateAttendanceSchema.parse(body),
    );
  }

  @Get("leave")
  @RequirePermissions("pops.read")
  listLeave(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.hr.listLeave(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("leave")
  @RequirePermissions("pops.read")
  createLeave(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.hr.createLeave(user.organizationId, createLeaveRequestSchema.parse(body));
  }

  @Patch("leave/:leaveId")
  @RequirePermissions("pops.hr.manage")
  updateLeave(
    @CurrentUser() user: AccessJwtPayload,
    @Param("leaveId") leaveId: string,
    @Body() body: unknown,
  ) {
    return this.hr.updateLeave(
      user.organizationId,
      leaveId,
      user.sub,
      updateLeaveRequestSchema.parse(body),
    );
  }

  @Get("payroll")
  @RequirePermissions("pops.read")
  listPayroll(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.hr.listPayroll(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("payroll/:payrollId")
  @RequirePermissions("pops.read")
  getPayroll(@CurrentUser() user: AccessJwtPayload, @Param("payrollId") payrollId: string) {
    return this.hr.getPayrollRun(user.organizationId, payrollId);
  }

  @Post("payroll/run")
  @RequirePermissions("pops.hr.manage")
  createPayroll(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.hr.createPayrollRun(
      user.organizationId,
      user.sub,
      createHrPayrollRunSchema.parse(body),
    );
  }

  @Patch("payroll/:payrollId/approve")
  @RequirePermissions("pops.hr.manage", "pops.accounting.manage")
  approvePayroll(
    @CurrentUser() user: AccessJwtPayload,
    @Param("payrollId") payrollId: string,
  ) {
    return this.hr.approvePayroll(user.organizationId, user.sub, payrollId);
  }

  @Patch("payroll/:payrollId/pay")
  @RequirePermissions("pops.hr.manage", "pops.accounting.manage")
  payPayroll(
    @CurrentUser() user: AccessJwtPayload,
    @Param("payrollId") payrollId: string,
    @Body() body: unknown,
  ) {
    const input = payPayrollSchema.parse(body ?? {});
    return this.hr.payPayroll(user.organizationId, user.sub, payrollId, input);
  }

  @Delete("payroll/:payrollId")
  @RequirePermissions("pops.hr.manage")
  deletePayroll(@CurrentUser() user: AccessJwtPayload, @Param("payrollId") payrollId: string) {
    return this.hr.deletePayrollRun(user.organizationId, payrollId);
  }

  @Get("advances")
  @RequirePermissions("pops.read")
  listAdvances(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("status") status?: string,
  ) {
    return this.hr.listEmployeeAdvances(
      user.organizationId,
      branchCode?.trim() ?? "",
      status?.trim(),
    );
  }

  @Post("advances")
  @RequirePermissions("pops.hr.manage")
  createAdvance(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.hr.createEmployeeAdvance(
      user.organizationId,
      user.sub,
      createEmployeeAdvanceSchema.parse(body),
    );
  }

  @Get("salary-slips")
  @RequirePermissions("pops.read")
  listSalarySlips(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("payrollRunId") payrollRunId?: string,
  ) {
    return this.hr.listSalarySlips(user.organizationId, branchCode?.trim() ?? "", payrollRunId);
  }

  @Get("staff-food")
  @RequirePermissions("pops.read")
  listStaffFood(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.hr.listStaffFood(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("staff-food")
  @RequirePermissions("pops.hr.manage")
  createStaffFood(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.hr.createStaffFood(
      user.organizationId,
      user.sub,
      createStaffFoodSchema.parse(body),
    );
  }

  @Delete("staff-food/:recordId")
  @RequirePermissions("pops.hr.manage")
  deleteStaffFood(@CurrentUser() user: AccessJwtPayload, @Param("recordId") recordId: string) {
    return this.hr.deleteStaffFood(user.organizationId, recordId);
  }
}
