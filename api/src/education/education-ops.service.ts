import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  BulkCreateEducationAttendance,
  CreateEducationAttendance,
  CreateEducationBatch,
  CreateEducationBatchStudent,
  CreateEducationBook,
  CreateEducationBookIssue,
  CreateEducationCourse,
  CreateEducationDepartment,
  CreateEducationDocumentTemplate,
  CreateEducationExam,
  CreateEducationExamSubject,
  CreateEducationExpense,
  CreateEducationFinanceTxn,
  CreateEducationGeneratedDocument,
  CreateEducationGuardian,
  CreateEducationMark,
  CreateEducationNotice,
  CreateEducationPayrollRun,
  CreateEducationPeriod,
  CreateEducationProgram,
  CreateEducationRoom,
  CreateEducationRoute,
  CreateEducationRouteStop,
  CreateEducationStaff,
  CreateEducationTeacher,
  CreateEducationTimetableSlot,
  CreateEducationTransportAssignment,
  CreateEducationVehicle,
  LinkEducationGuardianStudent,
  UpdateEducationAttendance,
  UpdateEducationBatch,
  UpdateEducationBook,
  UpdateEducationBookIssue,
  UpdateEducationCourse,
  UpdateEducationDepartment,
  UpdateEducationDocumentTemplate,
  UpdateEducationExam,
  UpdateEducationExamSubject,
  UpdateEducationExpense,
  UpdateEducationGuardian,
  UpdateEducationMark,
  UpdateEducationNotice,
  UpdateEducationPayrollRun,
  UpdateEducationPeriod,
  UpdateEducationProgram,
  UpdateEducationRoom,
  UpdateEducationRoute,
  UpdateEducationRouteStop,
  UpdateEducationStaff,
  UpdateEducationTeacher,
  UpdateEducationTimetableSlot,
  UpdateEducationTransportAssignment,
  UpdateEducationVehicle,
} from "@platform/contracts";
import { and, asc, desc, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";
import {
  educationAcademicSessions,
  educationAdmissions,
  educationAttendance,
  educationAuditLogs,
  educationBatchStudents,
  educationBatches,
  educationBookIssues,
  educationBooks,
  educationClasses,
  educationCourses,
  educationDepartments,
  educationDocumentTemplates,
  educationExamSubjects,
  educationExams,
  educationExpenses,
  educationFeeInvoices,
  educationFeePayments,
  educationFinanceTxns,
  educationGeneratedDocuments,
  educationGuardians,
  educationMarks,
  educationNotices,
  educationPayrollRuns,
  educationPayslips,
  educationPeriods,
  educationPrograms,
  educationRooms,
  educationRouteStops,
  educationRoutes,
  educationSections,
  educationStaff,
  educationStudentGuardians,
  educationStudents,
  educationTeachers,
  educationTimetableSlots,
  educationTransportAssignments,
  educationVehicles,
  organizations,
  popsBranches,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../drizzle/drizzle.tokens";
import {
  DEFAULT_EDUCATION_DOCUMENT_TEMPLATES,
  mergeEducationTemplate,
  parsePayloadJson,
} from "./education-document-engine";

type ExpenseStatus = "draft" | "pending" | "approved" | "paid" | "cancelled" | "rejected";

@Injectable()
export class EducationOpsService {
  private seqCounters = new Map<string, number>();

  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  private async resolveBranch(organizationId: string, branchCode: string) {
    const code = branchCode.trim();
    if (!code) throw new BadRequestException("branchCode is required");
    const [branch] = await this.db
      .select()
      .from(popsBranches)
      .where(and(eq(popsBranches.organizationId, organizationId), eq(popsBranches.code, code)))
      .limit(1);
    if (branch) return branch;

    if (code === "MAIN") {
      const [created] = await this.db
        .insert(popsBranches)
        .values({
          organizationId,
          code: "MAIN",
          name: "Main System",
          city: "Head Office",
        })
        .returning();
      if (created) return created;
    }
    throw new NotFoundException(`Branch not found: ${code}`);
  }

  private async resolveOptionalBranch(organizationId: string, branchCode?: string) {
    if (!branchCode?.trim()) return null;
    return this.resolveBranch(organizationId, branchCode);
  }

  private nextSeq(branchId: string, prefix: string): string {
    const key = `${branchId}:${prefix}`;
    const n = (this.seqCounters.get(key) ?? 0) + 1;
    this.seqCounters.set(key, n);
    const year = new Date().getFullYear();
    return `${prefix}-${year}-${String(n).padStart(4, "0")}`;
  }

  private iso(value: Date | string | null | undefined): string | null {
    if (!value) return null;
    if (typeof value === "string") return value;
    return value.toISOString();
  }

  private async writeAudit(input: {
    organizationId: string;
    branchId?: string | null;
    userId?: string | null;
    action: string;
    moduleKey: string;
    recordId?: string | null;
    detail?: string | null;
    oldValueJson?: string | null;
    newValueJson?: string | null;
  }) {
    await this.db.insert(educationAuditLogs).values({
      organizationId: input.organizationId,
      branchId: input.branchId ?? null,
      userId: input.userId ?? null,
      action: input.action,
      moduleKey: input.moduleKey,
      recordId: input.recordId ?? null,
      detail: input.detail ?? null,
      oldValueJson: input.oldValueJson ?? null,
      newValueJson: input.newValueJson ?? null,
    });
  }

  private calcGrade(percentage: number): string {
    if (percentage >= 90) return "A+";
    if (percentage >= 80) return "A";
    if (percentage >= 70) return "B";
    if (percentage >= 60) return "C";
    if (percentage >= 50) return "D";
    return "F";
  }

  private calcMarkFields(obtainedMarks: number, totalMarks: number, passingMarks: number) {
    const percentage = totalMarks > 0 ? Math.round((obtainedMarks / totalMarks) * 100) : 0;
    const gradeCode = this.calcGrade(percentage);
    const passFail = obtainedMarks >= passingMarks ? "pass" : "fail";
    return { percentage, gradeCode, passFail };
  }

  // ─── Guardians ───────────────────────────────────────────────────────────

  async listGuardians(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationGuardians)
      .where(and(eq(educationGuardians.organizationId, organizationId), eq(educationGuardians.branchId, branch.id)))
      .orderBy(asc(educationGuardians.fullName));
    return rows.map((r) => this.mapGuardian(r));
  }

  async createGuardian(organizationId: string, input: CreateEducationGuardian, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationGuardians)
      .values({
        organizationId,
        branchId: branch.id,
        fullName: input.fullName,
        phone: input.phone ?? null,
        email: input.email || null,
        relationshipCode: input.relationshipCode ?? null,
        address: input.address ?? null,
        status: input.status ?? "active",
      })
      .returning();
    if (input.studentId) {
      await this.db.insert(educationStudentGuardians).values({
        studentId: input.studentId,
        guardianId: row!.id,
        isPrimary: input.isPrimary ?? false,
      });
    }
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "parents",
      recordId: row!.id,
    });
    return this.mapGuardian(row!);
  }

  async updateGuardian(organizationId: string, input: UpdateEducationGuardian, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationGuardians)
      .where(and(eq(educationGuardians.id, input.id), eq(educationGuardians.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Guardian not found");
    const [row] = await this.db
      .update(educationGuardians)
      .set({
        ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
        ...(input.phone !== undefined ? { phone: input.phone ?? null } : {}),
        ...(input.email !== undefined ? { email: input.email || null } : {}),
        ...(input.relationshipCode !== undefined ? { relationshipCode: input.relationshipCode ?? null } : {}),
        ...(input.address !== undefined ? { address: input.address ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      })
      .where(eq(educationGuardians.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "parents",
      recordId: input.id,
    });
    return this.mapGuardian(row!);
  }

  async deactivateGuardian(organizationId: string, id: string, userId?: string) {
    return this.updateGuardian(organizationId, { id, status: "inactive" }, userId);
  }

  async linkGuardianStudent(
    organizationId: string,
    guardianId: string,
    input: LinkEducationGuardianStudent,
    userId?: string,
  ) {
    const [guardian] = await this.db
      .select()
      .from(educationGuardians)
      .where(and(eq(educationGuardians.id, guardianId), eq(educationGuardians.organizationId, organizationId)))
      .limit(1);
    if (!guardian) throw new NotFoundException("Guardian not found");
    const [student] = await this.db
      .select()
      .from(educationStudents)
      .where(and(eq(educationStudents.id, input.studentId), eq(educationStudents.organizationId, organizationId)))
      .limit(1);
    if (!student) throw new NotFoundException("Student not found");
    const [existing] = await this.db
      .select()
      .from(educationStudentGuardians)
      .where(
        and(
          eq(educationStudentGuardians.guardianId, guardianId),
          eq(educationStudentGuardians.studentId, input.studentId),
        ),
      )
      .limit(1);
    if (existing) return { linked: true, id: existing.id };
    const [link] = await this.db
      .insert(educationStudentGuardians)
      .values({
        guardianId,
        studentId: input.studentId,
        isPrimary: input.isPrimary ?? false,
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: guardian.branchId,
      userId,
      action: "link_student",
      moduleKey: "parents",
      recordId: guardianId,
      detail: input.studentId,
    });
    return { linked: true, id: link!.id };
  }

  async unlinkGuardianStudent(organizationId: string, guardianId: string, studentId: string, userId?: string) {
    const [guardian] = await this.db
      .select()
      .from(educationGuardians)
      .where(and(eq(educationGuardians.id, guardianId), eq(educationGuardians.organizationId, organizationId)))
      .limit(1);
    if (!guardian) throw new NotFoundException("Guardian not found");
    await this.db
      .delete(educationStudentGuardians)
      .where(
        and(
          eq(educationStudentGuardians.guardianId, guardianId),
          eq(educationStudentGuardians.studentId, studentId),
        ),
      );
    await this.writeAudit({
      organizationId,
      branchId: guardian.branchId,
      userId,
      action: "unlink_student",
      moduleKey: "parents",
      recordId: guardianId,
      detail: studentId,
    });
    return { unlinked: true };
  }

  private mapGuardian(row: typeof educationGuardians.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      fullName: row.fullName,
      phone: row.phone,
      email: row.email,
      relationshipCode: row.relationshipCode,
      address: row.address,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  // ─── Staff ───────────────────────────────────────────────────────────────

  async listStaff(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationStaff)
      .where(
        and(
          eq(educationStaff.organizationId, organizationId),
          eq(educationStaff.branchId, branch.id),
          isNull(educationStaff.deletedAt),
        ),
      )
      .orderBy(asc(educationStaff.firstName));
    return rows.map((r) => this.mapStaff(r));
  }

  async createStaff(organizationId: string, input: CreateEducationStaff, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const employeeNumber = input.employeeNumber?.trim() || this.nextSeq(branch.id, "STF");
    const [row] = await this.db
      .insert(educationStaff)
      .values({
        organizationId,
        branchId: branch.id,
        employeeNumber,
        firstName: input.firstName,
        lastName: input.lastName ?? null,
        phone: input.phone ?? null,
        email: input.email || null,
        cnic: input.cnic ?? null,
        address: input.address ?? null,
        designation: input.designation ?? null,
        departmentId: input.departmentId ?? null,
        staffCategoryCode: input.staffCategoryCode ?? null,
        employmentTypeCode: input.employmentTypeCode ?? null,
        joiningDate: input.joiningDate ?? null,
        salaryPkr: input.salaryPkr ?? 0,
        status: input.status ?? "active",
        photoUrl: input.photoUrl ?? null,
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "staff",
      recordId: row!.id,
    });
    return this.mapStaff(row!);
  }

  async updateStaff(organizationId: string, input: UpdateEducationStaff, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationStaff)
      .where(and(eq(educationStaff.id, input.id), eq(educationStaff.organizationId, organizationId)))
      .limit(1);
    if (!existing || existing.deletedAt) throw new NotFoundException("Staff not found");
    const [row] = await this.db
      .update(educationStaff)
      .set({
        ...(input.employeeNumber !== undefined ? { employeeNumber: input.employeeNumber } : {}),
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName ?? null } : {}),
        ...(input.phone !== undefined ? { phone: input.phone ?? null } : {}),
        ...(input.email !== undefined ? { email: input.email || null } : {}),
        ...(input.cnic !== undefined ? { cnic: input.cnic ?? null } : {}),
        ...(input.address !== undefined ? { address: input.address ?? null } : {}),
        ...(input.designation !== undefined ? { designation: input.designation ?? null } : {}),
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId ?? null } : {}),
        ...(input.staffCategoryCode !== undefined ? { staffCategoryCode: input.staffCategoryCode ?? null } : {}),
        ...(input.employmentTypeCode !== undefined ? { employmentTypeCode: input.employmentTypeCode ?? null } : {}),
        ...(input.joiningDate !== undefined ? { joiningDate: input.joiningDate ?? null } : {}),
        ...(input.salaryPkr !== undefined ? { salaryPkr: input.salaryPkr } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.photoUrl !== undefined ? { photoUrl: input.photoUrl ?? null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(educationStaff.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "staff",
      recordId: input.id,
    });
    return this.mapStaff(row!);
  }

  async deactivateStaff(organizationId: string, id: string, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationStaff)
      .where(and(eq(educationStaff.id, id), eq(educationStaff.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Staff not found");
    const [row] = await this.db
      .update(educationStaff)
      .set({ status: "inactive", deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(educationStaff.id, id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "deactivate",
      moduleKey: "staff",
      recordId: id,
    });
    return this.mapStaff(row!);
  }

  private mapStaff(row: typeof educationStaff.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      employeeNumber: row.employeeNumber,
      firstName: row.firstName,
      lastName: row.lastName,
      phone: row.phone,
      email: row.email,
      cnic: row.cnic,
      address: row.address,
      designation: row.designation,
      departmentId: row.departmentId,
      staffCategoryCode: row.staffCategoryCode,
      employmentTypeCode: row.employmentTypeCode,
      joiningDate: row.joiningDate,
      salaryPkr: row.salaryPkr,
      status: row.status,
      photoUrl: row.photoUrl,
      createdAt: this.iso(row.createdAt)!,
      updatedAt: this.iso(row.updatedAt)!,
    };
  }

  // ─── Teachers ────────────────────────────────────────────────────────────

  async listTeachers(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationTeachers)
      .where(
        and(
          eq(educationTeachers.organizationId, organizationId),
          eq(educationTeachers.branchId, branch.id),
          isNull(educationTeachers.deletedAt),
        ),
      )
      .orderBy(asc(educationTeachers.firstName));
    return rows.map((r) => this.mapTeacher(r));
  }

  async createTeacher(organizationId: string, input: CreateEducationTeacher, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const employeeNumber = input.employeeNumber?.trim() || this.nextSeq(branch.id, "TCH");
    const [row] = await this.db
      .insert(educationTeachers)
      .values({
        organizationId,
        branchId: branch.id,
        employeeNumber,
        firstName: input.firstName,
        lastName: input.lastName ?? null,
        phone: input.phone ?? null,
        email: input.email || null,
        departmentId: input.departmentId ?? null,
        designation: input.designation ?? null,
        employmentTypeCode: input.employmentTypeCode ?? null,
        status: input.status ?? "active",
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "teachers",
      recordId: row!.id,
    });
    return this.mapTeacher(row!);
  }

  async updateTeacher(organizationId: string, input: UpdateEducationTeacher, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationTeachers)
      .where(and(eq(educationTeachers.id, input.id), eq(educationTeachers.organizationId, organizationId)))
      .limit(1);
    if (!existing || existing.deletedAt) throw new NotFoundException("Teacher not found");
    const [row] = await this.db
      .update(educationTeachers)
      .set({
        ...(input.employeeNumber !== undefined ? { employeeNumber: input.employeeNumber } : {}),
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName ?? null } : {}),
        ...(input.phone !== undefined ? { phone: input.phone ?? null } : {}),
        ...(input.email !== undefined ? { email: input.email || null } : {}),
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId ?? null } : {}),
        ...(input.designation !== undefined ? { designation: input.designation ?? null } : {}),
        ...(input.employmentTypeCode !== undefined ? { employmentTypeCode: input.employmentTypeCode ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedAt: new Date(),
      })
      .where(eq(educationTeachers.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "teachers",
      recordId: input.id,
    });
    return this.mapTeacher(row!);
  }

  async deactivateTeacher(organizationId: string, id: string, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationTeachers)
      .where(and(eq(educationTeachers.id, id), eq(educationTeachers.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Teacher not found");
    const [row] = await this.db
      .update(educationTeachers)
      .set({ status: "inactive", deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(educationTeachers.id, id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "deactivate",
      moduleKey: "teachers",
      recordId: id,
    });
    return this.mapTeacher(row!);
  }

  private mapTeacher(row: typeof educationTeachers.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      employeeNumber: row.employeeNumber,
      firstName: row.firstName,
      lastName: row.lastName,
      phone: row.phone,
      email: row.email,
      departmentId: row.departmentId,
      designation: row.designation,
      employmentTypeCode: row.employmentTypeCode,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
      updatedAt: this.iso(row.updatedAt)!,
    };
  }

  // ─── Departments / Programs / Courses / Batches ──────────────────────────

  async listDepartments(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationDepartments)
      .where(and(eq(educationDepartments.organizationId, organizationId), eq(educationDepartments.branchId, branch.id)))
      .orderBy(asc(educationDepartments.name));
    return rows.map((r) => this.mapDepartment(r));
  }

  async createDepartment(organizationId: string, input: CreateEducationDepartment, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationDepartments)
      .values({
        organizationId,
        branchId: branch.id,
        name: input.name,
        code: input.code,
        status: input.status ?? "active",
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "departments",
      recordId: row!.id,
    });
    return this.mapDepartment(row!);
  }

  async updateDepartment(organizationId: string, input: UpdateEducationDepartment, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationDepartments)
      .where(and(eq(educationDepartments.id, input.id), eq(educationDepartments.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Department not found");
    const [row] = await this.db
      .update(educationDepartments)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      })
      .where(eq(educationDepartments.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "departments",
      recordId: input.id,
    });
    return this.mapDepartment(row!);
  }

  private mapDepartment(row: typeof educationDepartments.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      name: row.name,
      code: row.code,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  async listPrograms(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationPrograms)
      .where(and(eq(educationPrograms.organizationId, organizationId), eq(educationPrograms.branchId, branch.id)))
      .orderBy(asc(educationPrograms.name));
    return rows.map((r) => this.mapProgram(r));
  }

  async createProgram(organizationId: string, input: CreateEducationProgram, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationPrograms)
      .values({
        organizationId,
        branchId: branch.id,
        departmentId: input.departmentId ?? null,
        name: input.name,
        code: input.code,
        status: input.status ?? "active",
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "programs",
      recordId: row!.id,
    });
    return this.mapProgram(row!);
  }

  async updateProgram(organizationId: string, input: UpdateEducationProgram, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationPrograms)
      .where(and(eq(educationPrograms.id, input.id), eq(educationPrograms.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Program not found");
    const [row] = await this.db
      .update(educationPrograms)
      .set({
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId ?? null } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      })
      .where(eq(educationPrograms.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "programs",
      recordId: input.id,
    });
    return this.mapProgram(row!);
  }

  private mapProgram(row: typeof educationPrograms.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      departmentId: row.departmentId,
      name: row.name,
      code: row.code,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  async listCourses(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationCourses)
      .where(and(eq(educationCourses.organizationId, organizationId), eq(educationCourses.branchId, branch.id)))
      .orderBy(asc(educationCourses.name));
    return rows.map((r) => this.mapCourse(r));
  }

  async createCourse(organizationId: string, input: CreateEducationCourse, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationCourses)
      .values({
        organizationId,
        branchId: branch.id,
        programId: input.programId ?? null,
        name: input.name,
        code: input.code,
        durationText: input.durationText ?? null,
        feePkr: input.feePkr ?? 0,
        status: input.status ?? "active",
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "courses",
      recordId: row!.id,
    });
    return this.mapCourse(row!);
  }

  async updateCourse(organizationId: string, input: UpdateEducationCourse, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationCourses)
      .where(and(eq(educationCourses.id, input.id), eq(educationCourses.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Course not found");
    const [row] = await this.db
      .update(educationCourses)
      .set({
        ...(input.programId !== undefined ? { programId: input.programId ?? null } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.durationText !== undefined ? { durationText: input.durationText ?? null } : {}),
        ...(input.feePkr !== undefined ? { feePkr: input.feePkr } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      })
      .where(eq(educationCourses.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "courses",
      recordId: input.id,
    });
    return this.mapCourse(row!);
  }

  private mapCourse(row: typeof educationCourses.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      programId: row.programId,
      name: row.name,
      code: row.code,
      durationText: row.durationText,
      feePkr: row.feePkr,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  async listBatches(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationBatches)
      .where(and(eq(educationBatches.organizationId, organizationId), eq(educationBatches.branchId, branch.id)))
      .orderBy(asc(educationBatches.name));
    return rows.map((r) => this.mapBatch(r));
  }

  async createBatch(organizationId: string, input: CreateEducationBatch, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationBatches)
      .values({
        organizationId,
        branchId: branch.id,
        courseId: input.courseId ?? null,
        name: input.name,
        code: input.code,
        timingText: input.timingText ?? null,
        daysText: input.daysText ?? null,
        capacity: input.capacity ?? null,
        status: input.status ?? "active",
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "batches",
      recordId: row!.id,
    });
    return this.mapBatch(row!);
  }

  async updateBatch(organizationId: string, input: UpdateEducationBatch, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationBatches)
      .where(and(eq(educationBatches.id, input.id), eq(educationBatches.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Batch not found");
    const [row] = await this.db
      .update(educationBatches)
      .set({
        ...(input.courseId !== undefined ? { courseId: input.courseId ?? null } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.timingText !== undefined ? { timingText: input.timingText ?? null } : {}),
        ...(input.daysText !== undefined ? { daysText: input.daysText ?? null } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      })
      .where(eq(educationBatches.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "batches",
      recordId: input.id,
    });
    return this.mapBatch(row!);
  }

  private mapBatch(row: typeof educationBatches.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      courseId: row.courseId,
      name: row.name,
      code: row.code,
      timingText: row.timingText,
      daysText: row.daysText,
      capacity: row.capacity,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  async enrollBatchStudent(organizationId: string, input: CreateEducationBatchStudent, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [batch] = await this.db
      .select()
      .from(educationBatches)
      .where(and(eq(educationBatches.id, input.batchId), eq(educationBatches.organizationId, organizationId)))
      .limit(1);
    if (!batch) throw new NotFoundException("Batch not found");

    if (batch.capacity != null && batch.capacity > 0) {
      const [enrolled] = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(educationBatchStudents)
        .where(
          and(
            eq(educationBatchStudents.batchId, batch.id),
            eq(educationBatchStudents.status, "active"),
          ),
        );
      if (Number(enrolled?.count ?? 0) >= batch.capacity) {
        throw new BadRequestException("Batch capacity exceeded");
      }
    }

    const [existing] = await this.db
      .select()
      .from(educationBatchStudents)
      .where(
        and(
          eq(educationBatchStudents.batchId, input.batchId),
          eq(educationBatchStudents.studentId, input.studentId),
        ),
      )
      .limit(1);
    if (existing) throw new BadRequestException("Student already enrolled in batch");

    const [row] = await this.db
      .insert(educationBatchStudents)
      .values({
        organizationId,
        branchId: branch.id,
        batchId: input.batchId,
        studentId: input.studentId,
        status: input.status ?? "active",
        enrolledAt: input.enrolledAt ?? new Date().toISOString().slice(0, 10),
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "enroll",
      moduleKey: "batches",
      recordId: row!.id,
      detail: input.studentId,
    });
    return this.mapBatchStudent(row!);
  }

  async listBatchStudents(organizationId: string, branchCode: string, batchId?: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const conditions = [
      eq(educationBatchStudents.organizationId, organizationId),
      eq(educationBatchStudents.branchId, branch.id),
    ];
    if (batchId) conditions.push(eq(educationBatchStudents.batchId, batchId));
    const rows = await this.db
      .select()
      .from(educationBatchStudents)
      .where(and(...conditions))
      .orderBy(desc(educationBatchStudents.createdAt));
    return rows.map((r) => this.mapBatchStudent(r));
  }

  private mapBatchStudent(row: typeof educationBatchStudents.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      batchId: row.batchId,
      studentId: row.studentId,
      status: row.status,
      enrolledAt: row.enrolledAt,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  // ─── Periods / Rooms / Timetable ─────────────────────────────────────────

  async listPeriods(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationPeriods)
      .where(and(eq(educationPeriods.organizationId, organizationId), eq(educationPeriods.branchId, branch.id)))
      .orderBy(asc(educationPeriods.sortOrder), asc(educationPeriods.name));
    return rows.map((r) => this.mapPeriod(r));
  }

  async createPeriod(organizationId: string, input: CreateEducationPeriod, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationPeriods)
      .values({
        organizationId,
        branchId: branch.id,
        name: input.name,
        startTime: input.startTime,
        endTime: input.endTime,
        sortOrder: input.sortOrder ?? 0,
        isBreak: input.isBreak ?? false,
        status: input.status ?? "active",
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "timetable",
      recordId: row!.id,
    });
    return this.mapPeriod(row!);
  }

  async updatePeriod(organizationId: string, input: UpdateEducationPeriod, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationPeriods)
      .where(and(eq(educationPeriods.id, input.id), eq(educationPeriods.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Period not found");
    const [row] = await this.db
      .update(educationPeriods)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.startTime !== undefined ? { startTime: input.startTime } : {}),
        ...(input.endTime !== undefined ? { endTime: input.endTime } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isBreak !== undefined ? { isBreak: input.isBreak } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      })
      .where(eq(educationPeriods.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "timetable",
      recordId: input.id,
    });
    return this.mapPeriod(row!);
  }

  private mapPeriod(row: typeof educationPeriods.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      name: row.name,
      startTime: row.startTime,
      endTime: row.endTime,
      sortOrder: row.sortOrder,
      isBreak: row.isBreak,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  async listRooms(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationRooms)
      .where(and(eq(educationRooms.organizationId, organizationId), eq(educationRooms.branchId, branch.id)))
      .orderBy(asc(educationRooms.code));
    return rows.map((r) => this.mapRoom(r));
  }

  async createRoom(organizationId: string, input: CreateEducationRoom, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationRooms)
      .values({
        organizationId,
        branchId: branch.id,
        code: input.code,
        name: input.name,
        capacity: input.capacity ?? null,
        status: input.status ?? "active",
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "timetable",
      recordId: row!.id,
    });
    return this.mapRoom(row!);
  }

  async updateRoom(organizationId: string, input: UpdateEducationRoom, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationRooms)
      .where(and(eq(educationRooms.id, input.id), eq(educationRooms.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Room not found");
    const [row] = await this.db
      .update(educationRooms)
      .set({
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      })
      .where(eq(educationRooms.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "timetable",
      recordId: input.id,
    });
    return this.mapRoom(row!);
  }

  private mapRoom(row: typeof educationRooms.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      code: row.code,
      name: row.name,
      capacity: row.capacity,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  async listTimetableSlots(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationTimetableSlots)
      .where(
        and(eq(educationTimetableSlots.organizationId, organizationId), eq(educationTimetableSlots.branchId, branch.id)),
      )
      .orderBy(asc(educationTimetableSlots.dayOfWeek));
    return rows.map((r) => this.mapTimetableSlot(r));
  }

  private async assertNoTimetableConflict(
    organizationId: string,
    branchId: string,
    input: {
      dayOfWeek: number;
      periodId: string;
      teacherId?: string | null;
      roomId?: string | null;
      classId?: string | null;
      batchId?: string | null;
      excludeId?: string;
    },
  ) {
    const base = and(
      eq(educationTimetableSlots.organizationId, organizationId),
      eq(educationTimetableSlots.branchId, branchId),
      eq(educationTimetableSlots.dayOfWeek, input.dayOfWeek),
      eq(educationTimetableSlots.periodId, input.periodId),
      eq(educationTimetableSlots.status, "active"),
      ...(input.excludeId ? [ne(educationTimetableSlots.id, input.excludeId)] : []),
    );

    if (input.teacherId) {
      const [conflict] = await this.db
        .select()
        .from(educationTimetableSlots)
        .where(and(base, eq(educationTimetableSlots.teacherId, input.teacherId)))
        .limit(1);
      if (conflict) throw new BadRequestException("Teacher already assigned for this day/period");
    }
    if (input.roomId) {
      const [conflict] = await this.db
        .select()
        .from(educationTimetableSlots)
        .where(and(base, eq(educationTimetableSlots.roomId, input.roomId)))
        .limit(1);
      if (conflict) throw new BadRequestException("Room already booked for this day/period");
    }
    if (input.classId) {
      const [conflict] = await this.db
        .select()
        .from(educationTimetableSlots)
        .where(and(base, eq(educationTimetableSlots.classId, input.classId)))
        .limit(1);
      if (conflict) throw new BadRequestException("Class already has a slot for this day/period");
    }
    if (input.batchId) {
      const [conflict] = await this.db
        .select()
        .from(educationTimetableSlots)
        .where(and(base, eq(educationTimetableSlots.batchId, input.batchId)))
        .limit(1);
      if (conflict) throw new BadRequestException("Batch already has a slot for this day/period");
    }
  }

  async createTimetableSlot(organizationId: string, input: CreateEducationTimetableSlot, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    await this.assertNoTimetableConflict(organizationId, branch.id, {
      dayOfWeek: input.dayOfWeek,
      periodId: input.periodId,
      teacherId: input.teacherId,
      roomId: input.roomId,
      classId: input.classId,
      batchId: input.batchId,
    });
    const [row] = await this.db
      .insert(educationTimetableSlots)
      .values({
        organizationId,
        branchId: branch.id,
        dayOfWeek: input.dayOfWeek,
        periodId: input.periodId,
        roomId: input.roomId ?? null,
        classId: input.classId ?? null,
        sectionId: input.sectionId ?? null,
        subjectId: input.subjectId ?? null,
        teacherId: input.teacherId ?? null,
        batchId: input.batchId ?? null,
        status: input.status ?? "active",
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "timetable",
      recordId: row!.id,
    });
    return this.mapTimetableSlot(row!);
  }

  async updateTimetableSlot(organizationId: string, input: UpdateEducationTimetableSlot, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationTimetableSlots)
      .where(and(eq(educationTimetableSlots.id, input.id), eq(educationTimetableSlots.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Timetable slot not found");
    const dayOfWeek = input.dayOfWeek ?? existing.dayOfWeek;
    const periodId = input.periodId ?? existing.periodId;
    await this.assertNoTimetableConflict(organizationId, existing.branchId, {
      dayOfWeek,
      periodId,
      teacherId: input.teacherId !== undefined ? input.teacherId : existing.teacherId,
      roomId: input.roomId !== undefined ? input.roomId : existing.roomId,
      classId: input.classId !== undefined ? input.classId : existing.classId,
      batchId: input.batchId !== undefined ? input.batchId : existing.batchId,
      excludeId: input.id,
    });
    const [row] = await this.db
      .update(educationTimetableSlots)
      .set({
        ...(input.dayOfWeek !== undefined ? { dayOfWeek: input.dayOfWeek } : {}),
        ...(input.periodId !== undefined ? { periodId: input.periodId } : {}),
        ...(input.roomId !== undefined ? { roomId: input.roomId ?? null } : {}),
        ...(input.classId !== undefined ? { classId: input.classId ?? null } : {}),
        ...(input.sectionId !== undefined ? { sectionId: input.sectionId ?? null } : {}),
        ...(input.subjectId !== undefined ? { subjectId: input.subjectId ?? null } : {}),
        ...(input.teacherId !== undefined ? { teacherId: input.teacherId ?? null } : {}),
        ...(input.batchId !== undefined ? { batchId: input.batchId ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      })
      .where(eq(educationTimetableSlots.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "timetable",
      recordId: input.id,
    });
    return this.mapTimetableSlot(row!);
  }

  private mapTimetableSlot(row: typeof educationTimetableSlots.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      dayOfWeek: row.dayOfWeek,
      periodId: row.periodId,
      roomId: row.roomId,
      classId: row.classId,
      sectionId: row.sectionId,
      subjectId: row.subjectId,
      teacherId: row.teacherId,
      batchId: row.batchId,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  // ─── Attendance ──────────────────────────────────────────────────────────

  async listAttendance(
    organizationId: string,
    branchCode: string,
    filters?: { date?: string; personType?: string; classId?: string; sectionId?: string; batchId?: string },
  ) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const conditions = [
      eq(educationAttendance.organizationId, organizationId),
      eq(educationAttendance.branchId, branch.id),
    ];
    if (filters?.date) conditions.push(eq(educationAttendance.date, filters.date));
    if (filters?.personType) conditions.push(eq(educationAttendance.personType, filters.personType));
    if (filters?.classId) conditions.push(eq(educationAttendance.classId, filters.classId));
    if (filters?.sectionId) conditions.push(eq(educationAttendance.sectionId, filters.sectionId));
    if (filters?.batchId) conditions.push(eq(educationAttendance.batchId, filters.batchId));
    const rows = await this.db
      .select()
      .from(educationAttendance)
      .where(and(...conditions))
      .orderBy(desc(educationAttendance.date), asc(educationAttendance.personType));
    return rows.map((r) => this.mapAttendance(r));
  }

  async createAttendance(organizationId: string, input: CreateEducationAttendance, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationAttendance)
      .values({
        organizationId,
        branchId: branch.id,
        date: input.date,
        personType: input.personType,
        personId: input.personId,
        classId: input.classId ?? null,
        sectionId: input.sectionId ?? null,
        batchId: input.batchId ?? null,
        statusCode: input.statusCode,
        notes: input.notes ?? null,
        markedBy: input.markedBy ?? userId ?? null,
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "attendance",
      recordId: row!.id,
    });
    return this.mapAttendance(row!);
  }

  async bulkCreateAttendance(organizationId: string, input: BulkCreateEducationAttendance, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const created = [];
    for (const record of input.records) {
      const date = record.date ?? input.date;
      if (!date) continue;
      const [existing] = await this.db
        .select()
        .from(educationAttendance)
        .where(
          and(
            eq(educationAttendance.organizationId, organizationId),
            eq(educationAttendance.branchId, branch.id),
            eq(educationAttendance.date, date),
            eq(educationAttendance.personType, record.personType),
            eq(educationAttendance.personId, record.personId),
          ),
        )
        .limit(1);
      if (existing) {
        const [row] = await this.db
          .update(educationAttendance)
          .set({
            classId: record.classId ?? existing.classId,
            sectionId: record.sectionId ?? existing.sectionId,
            batchId: record.batchId ?? existing.batchId,
            statusCode: record.statusCode,
            notes: record.notes ?? existing.notes,
            markedBy: record.markedBy ?? userId ?? existing.markedBy,
          })
          .where(eq(educationAttendance.id, existing.id))
          .returning();
        created.push(this.mapAttendance(row!));
        continue;
      }
      const [row] = await this.db
        .insert(educationAttendance)
        .values({
          organizationId,
          branchId: branch.id,
          date,
          personType: record.personType,
          personId: record.personId,
          classId: record.classId ?? null,
          sectionId: record.sectionId ?? null,
          batchId: record.batchId ?? null,
          statusCode: record.statusCode,
          notes: record.notes ?? null,
          markedBy: record.markedBy ?? userId ?? null,
        })
        .returning();
      created.push(this.mapAttendance(row!));
    }
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "bulk_create",
      moduleKey: "attendance",
      detail: `${created.length} records`,
    });
    return created;
  }

  async updateAttendance(organizationId: string, input: UpdateEducationAttendance, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationAttendance)
      .where(and(eq(educationAttendance.id, input.id), eq(educationAttendance.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Attendance not found");
    const [row] = await this.db
      .update(educationAttendance)
      .set({
        ...(input.date !== undefined ? { date: input.date } : {}),
        ...(input.personType !== undefined ? { personType: input.personType } : {}),
        ...(input.personId !== undefined ? { personId: input.personId } : {}),
        ...(input.classId !== undefined ? { classId: input.classId ?? null } : {}),
        ...(input.sectionId !== undefined ? { sectionId: input.sectionId ?? null } : {}),
        ...(input.batchId !== undefined ? { batchId: input.batchId ?? null } : {}),
        ...(input.statusCode !== undefined ? { statusCode: input.statusCode } : {}),
        ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
        ...(input.markedBy !== undefined ? { markedBy: input.markedBy ?? null } : {}),
      })
      .where(eq(educationAttendance.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "attendance",
      recordId: input.id,
    });
    return this.mapAttendance(row!);
  }

  private mapAttendance(row: typeof educationAttendance.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      date: row.date,
      personType: row.personType as "student" | "teacher" | "staff",
      personId: row.personId,
      classId: row.classId,
      sectionId: row.sectionId,
      batchId: row.batchId,
      statusCode: row.statusCode,
      notes: row.notes,
      markedBy: row.markedBy,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  // ─── Exams / Marks ───────────────────────────────────────────────────────

  async listExams(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationExams)
      .where(and(eq(educationExams.organizationId, organizationId), eq(educationExams.branchId, branch.id)))
      .orderBy(desc(educationExams.createdAt));
    return rows.map((r) => this.mapExam(r));
  }

  async createExam(organizationId: string, input: CreateEducationExam, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationExams)
      .values({
        organizationId,
        branchId: branch.id,
        name: input.name,
        examTypeCode: input.examTypeCode,
        sessionId: input.sessionId ?? null,
        classId: input.classId ?? null,
        programId: input.programId ?? null,
        batchId: input.batchId ?? null,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        status: input.status ?? "draft",
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "examinations",
      recordId: row!.id,
    });
    return this.mapExam(row!);
  }

  async updateExam(organizationId: string, input: UpdateEducationExam, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationExams)
      .where(and(eq(educationExams.id, input.id), eq(educationExams.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Exam not found");
    if (existing.status === "finalized" && input.status && input.status !== "finalized") {
      throw new BadRequestException("Finalized exam cannot change status");
    }
    const [row] = await this.db
      .update(educationExams)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.examTypeCode !== undefined ? { examTypeCode: input.examTypeCode } : {}),
        ...(input.sessionId !== undefined ? { sessionId: input.sessionId ?? null } : {}),
        ...(input.classId !== undefined ? { classId: input.classId ?? null } : {}),
        ...(input.programId !== undefined ? { programId: input.programId ?? null } : {}),
        ...(input.batchId !== undefined ? { batchId: input.batchId ?? null } : {}),
        ...(input.startDate !== undefined ? { startDate: input.startDate ?? null } : {}),
        ...(input.endDate !== undefined ? { endDate: input.endDate ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedAt: new Date(),
      })
      .where(eq(educationExams.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "examinations",
      recordId: input.id,
    });
    return this.mapExam(row!);
  }

  async finalizeExam(organizationId: string, examId: string, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationExams)
      .where(and(eq(educationExams.id, examId), eq(educationExams.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Exam not found");
    if (existing.status === "finalized") throw new BadRequestException("Exam already finalized");
    const [row] = await this.db
      .update(educationExams)
      .set({ status: "finalized", updatedAt: new Date() })
      .where(eq(educationExams.id, examId))
      .returning();
    await this.db
      .update(educationMarks)
      .set({ status: "locked", updatedAt: new Date() })
      .where(eq(educationMarks.examId, examId));
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "finalize",
      moduleKey: "examinations",
      recordId: examId,
    });
    return this.mapExam(row!);
  }

  private mapExam(row: typeof educationExams.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      name: row.name,
      examTypeCode: row.examTypeCode,
      sessionId: row.sessionId,
      classId: row.classId,
      programId: row.programId,
      batchId: row.batchId,
      startDate: row.startDate,
      endDate: row.endDate,
      status: row.status as "draft" | "scheduled" | "active" | "completed" | "finalized" | "archived",
      createdAt: this.iso(row.createdAt)!,
      updatedAt: this.iso(row.updatedAt)!,
    };
  }

  async listExamSubjects(organizationId: string, examId: string) {
    const rows = await this.db
      .select()
      .from(educationExamSubjects)
      .where(and(eq(educationExamSubjects.organizationId, organizationId), eq(educationExamSubjects.examId, examId)))
      .orderBy(asc(educationExamSubjects.createdAt));
    return rows.map((r) => this.mapExamSubject(r));
  }

  async createExamSubject(organizationId: string, input: CreateEducationExamSubject, userId?: string) {
    const [exam] = await this.db
      .select()
      .from(educationExams)
      .where(and(eq(educationExams.id, input.examId), eq(educationExams.organizationId, organizationId)))
      .limit(1);
    if (!exam) throw new NotFoundException("Exam not found");
    if (exam.status === "finalized") throw new BadRequestException("Cannot modify finalized exam");
    const [row] = await this.db
      .insert(educationExamSubjects)
      .values({
        organizationId,
        examId: input.examId,
        subjectId: input.subjectId ?? null,
        courseId: input.courseId ?? null,
        totalMarks: input.totalMarks,
        passingMarks: input.passingMarks,
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: exam.branchId,
      userId,
      action: "create",
      moduleKey: "examinations",
      recordId: row!.id,
    });
    return this.mapExamSubject(row!);
  }

  async updateExamSubject(organizationId: string, input: UpdateEducationExamSubject, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationExamSubjects)
      .where(and(eq(educationExamSubjects.id, input.id), eq(educationExamSubjects.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Exam subject not found");
    const [exam] = await this.db
      .select()
      .from(educationExams)
      .where(eq(educationExams.id, existing.examId))
      .limit(1);
    if (exam?.status === "finalized") throw new BadRequestException("Cannot modify finalized exam");
    const [row] = await this.db
      .update(educationExamSubjects)
      .set({
        ...(input.subjectId !== undefined ? { subjectId: input.subjectId ?? null } : {}),
        ...(input.courseId !== undefined ? { courseId: input.courseId ?? null } : {}),
        ...(input.totalMarks !== undefined ? { totalMarks: input.totalMarks } : {}),
        ...(input.passingMarks !== undefined ? { passingMarks: input.passingMarks } : {}),
      })
      .where(eq(educationExamSubjects.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: exam?.branchId,
      userId,
      action: "update",
      moduleKey: "examinations",
      recordId: input.id,
    });
    return this.mapExamSubject(row!);
  }

  private mapExamSubject(row: typeof educationExamSubjects.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      examId: row.examId,
      subjectId: row.subjectId,
      courseId: row.courseId,
      totalMarks: row.totalMarks,
      passingMarks: row.passingMarks,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  async listMarks(organizationId: string, branchCode: string, examId?: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const conditions = [
      eq(educationMarks.organizationId, organizationId),
      eq(educationMarks.branchId, branch.id),
    ];
    if (examId) conditions.push(eq(educationMarks.examId, examId));
    const rows = await this.db
      .select()
      .from(educationMarks)
      .where(and(...conditions))
      .orderBy(desc(educationMarks.createdAt));
    return rows.map((r) => this.mapMark(r));
  }

  async createMark(organizationId: string, input: CreateEducationMark, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [exam] = await this.db
      .select()
      .from(educationExams)
      .where(and(eq(educationExams.id, input.examId), eq(educationExams.organizationId, organizationId)))
      .limit(1);
    if (!exam) throw new NotFoundException("Exam not found");
    if (exam.status === "finalized") throw new BadRequestException("Exam is finalized; marks are locked");
    const [examSubject] = await this.db
      .select()
      .from(educationExamSubjects)
      .where(eq(educationExamSubjects.id, input.examSubjectId))
      .limit(1);
    if (!examSubject) throw new NotFoundException("Exam subject not found");
    const computed = this.calcMarkFields(input.obtainedMarks, examSubject.totalMarks, examSubject.passingMarks);
    const [row] = await this.db
      .insert(educationMarks)
      .values({
        organizationId,
        branchId: branch.id,
        examId: input.examId,
        examSubjectId: input.examSubjectId,
        studentId: input.studentId,
        obtainedMarks: input.obtainedMarks,
        percentage: input.percentage ?? computed.percentage,
        gradeCode: input.gradeCode ?? computed.gradeCode,
        gpa: input.gpa ?? null,
        passFail: input.passFail ?? computed.passFail,
        status: input.status ?? "draft",
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "results",
      recordId: row!.id,
    });
    return this.mapMark(row!);
  }

  async updateMark(organizationId: string, input: UpdateEducationMark, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationMarks)
      .where(and(eq(educationMarks.id, input.id), eq(educationMarks.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Mark not found");
    if (existing.status === "locked") throw new BadRequestException("Marks are locked");
    const [exam] = await this.db
      .select()
      .from(educationExams)
      .where(eq(educationExams.id, existing.examId))
      .limit(1);
    if (exam?.status === "finalized") throw new BadRequestException("Exam is finalized; marks are locked");
    const examSubjectId = input.examSubjectId ?? existing.examSubjectId;
    const obtainedMarks = input.obtainedMarks ?? existing.obtainedMarks;
    const [examSubject] = await this.db
      .select()
      .from(educationExamSubjects)
      .where(eq(educationExamSubjects.id, examSubjectId))
      .limit(1);
    const computed = examSubject
      ? this.calcMarkFields(obtainedMarks, examSubject.totalMarks, examSubject.passingMarks)
      : { percentage: existing.percentage, gradeCode: existing.gradeCode, passFail: existing.passFail };
    const [row] = await this.db
      .update(educationMarks)
      .set({
        ...(input.examId !== undefined ? { examId: input.examId } : {}),
        ...(input.examSubjectId !== undefined ? { examSubjectId: input.examSubjectId } : {}),
        ...(input.studentId !== undefined ? { studentId: input.studentId } : {}),
        ...(input.obtainedMarks !== undefined ? { obtainedMarks: input.obtainedMarks } : {}),
        percentage: input.percentage ?? computed.percentage,
        gradeCode: input.gradeCode ?? computed.gradeCode ?? null,
        ...(input.gpa !== undefined ? { gpa: input.gpa ?? null } : {}),
        passFail: input.passFail ?? computed.passFail ?? null,
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedAt: new Date(),
      })
      .where(eq(educationMarks.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "results",
      recordId: input.id,
    });
    return this.mapMark(row!);
  }

  private mapMark(row: typeof educationMarks.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      examId: row.examId,
      examSubjectId: row.examSubjectId,
      studentId: row.studentId,
      obtainedMarks: row.obtainedMarks,
      percentage: row.percentage,
      gradeCode: row.gradeCode,
      gpa: row.gpa,
      passFail: row.passFail,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
      updatedAt: this.iso(row.updatedAt)!,
    };
  }

  // ─── Expenses ────────────────────────────────────────────────────────────

  private assertExpenseTransition(from: ExpenseStatus, to: ExpenseStatus) {
    const allowed: Record<ExpenseStatus, ExpenseStatus[]> = {
      draft: ["pending", "cancelled"],
      pending: ["approved", "rejected", "cancelled"],
      approved: ["paid", "cancelled"],
      paid: [],
      cancelled: [],
      rejected: [],
    };
    if (!allowed[from]?.includes(to)) {
      throw new BadRequestException(`Invalid expense status transition: ${from} → ${to}`);
    }
  }

  async listExpenses(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationExpenses)
      .where(and(eq(educationExpenses.organizationId, organizationId), eq(educationExpenses.branchId, branch.id)))
      .orderBy(desc(educationExpenses.createdAt));
    return rows.map((r) => this.mapExpense(r));
  }

  async createExpense(organizationId: string, input: CreateEducationExpense, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationExpenses)
      .values({
        organizationId,
        branchId: branch.id,
        title: input.title,
        categoryCode: input.categoryCode,
        amountPkr: input.amountPkr,
        paymentMethodCode: input.paymentMethodCode ?? null,
        status: input.status ?? "draft",
        expenseDate: input.expenseDate ?? null,
        notes: input.notes ?? null,
        approvedBy: input.approvedBy ?? null,
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "expenses",
      recordId: row!.id,
    });
    return this.mapExpense(row!);
  }

  async updateExpense(organizationId: string, input: UpdateEducationExpense, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationExpenses)
      .where(and(eq(educationExpenses.id, input.id), eq(educationExpenses.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Expense not found");
    if (existing.status === "paid" || existing.status === "cancelled" || existing.status === "rejected") {
      throw new BadRequestException("Cannot update expense in terminal status");
    }
    if (input.status && input.status !== existing.status) {
      this.assertExpenseTransition(existing.status as ExpenseStatus, input.status as ExpenseStatus);
    }
    const [row] = await this.db
      .update(educationExpenses)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.categoryCode !== undefined ? { categoryCode: input.categoryCode } : {}),
        ...(input.amountPkr !== undefined ? { amountPkr: input.amountPkr } : {}),
        ...(input.paymentMethodCode !== undefined ? { paymentMethodCode: input.paymentMethodCode ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.expenseDate !== undefined ? { expenseDate: input.expenseDate ?? null } : {}),
        ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
        ...(input.approvedBy !== undefined ? { approvedBy: input.approvedBy ?? null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(educationExpenses.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "expenses",
      recordId: input.id,
    });
    return this.mapExpense(row!);
  }

  async transitionExpense(
    organizationId: string,
    id: string,
    to: ExpenseStatus,
    userId?: string,
  ) {
    const [existing] = await this.db
      .select()
      .from(educationExpenses)
      .where(and(eq(educationExpenses.id, id), eq(educationExpenses.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Expense not found");
    this.assertExpenseTransition(existing.status as ExpenseStatus, to);
    const [row] = await this.db
      .update(educationExpenses)
      .set({
        status: to,
        ...(to === "approved" ? { approvedBy: userId ?? existing.approvedBy } : {}),
        updatedAt: new Date(),
      })
      .where(eq(educationExpenses.id, id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: to,
      moduleKey: "expenses",
      recordId: id,
    });
    return this.mapExpense(row!);
  }

  private mapExpense(row: typeof educationExpenses.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      title: row.title,
      categoryCode: row.categoryCode,
      amountPkr: row.amountPkr,
      paymentMethodCode: row.paymentMethodCode,
      status: row.status as ExpenseStatus,
      expenseDate: row.expenseDate,
      notes: row.notes,
      approvedBy: row.approvedBy,
      createdAt: this.iso(row.createdAt)!,
      updatedAt: this.iso(row.updatedAt)!,
    };
  }

  // ─── Finance ─────────────────────────────────────────────────────────────

  async listFinanceTxns(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationFinanceTxns)
      .where(and(eq(educationFinanceTxns.organizationId, organizationId), eq(educationFinanceTxns.branchId, branch.id)))
      .orderBy(desc(educationFinanceTxns.txnDate));
    return rows.map((r) => this.mapFinanceTxn(r));
  }

  async createFinanceTxn(organizationId: string, input: CreateEducationFinanceTxn, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationFinanceTxns)
      .values({
        organizationId,
        branchId: branch.id,
        txnType: input.txnType,
        amountPkr: input.amountPkr,
        refModule: input.refModule,
        refId: input.refId ?? null,
        title: input.title,
        txnDate: input.txnDate,
        status: input.status ?? "posted",
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "finance",
      recordId: row!.id,
    });
    return this.mapFinanceTxn(row!);
  }

  async getFinanceSummary(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const [income] = await this.db
      .select({ total: sql<number>`coalesce(sum(${educationFinanceTxns.amountPkr}), 0)::int` })
      .from(educationFinanceTxns)
      .where(
        and(
          eq(educationFinanceTxns.organizationId, organizationId),
          eq(educationFinanceTxns.branchId, branch.id),
          eq(educationFinanceTxns.txnType, "income"),
        ),
      );
    const [expense] = await this.db
      .select({ total: sql<number>`coalesce(sum(${educationFinanceTxns.amountPkr}), 0)::int` })
      .from(educationFinanceTxns)
      .where(
        and(
          eq(educationFinanceTxns.organizationId, organizationId),
          eq(educationFinanceTxns.branchId, branch.id),
          eq(educationFinanceTxns.txnType, "expense"),
        ),
      );
    const [feeCollected] = await this.db
      .select({ total: sql<number>`coalesce(sum(${educationFeePayments.amountPkr}), 0)::int` })
      .from(educationFeePayments)
      .where(
        and(eq(educationFeePayments.organizationId, organizationId), eq(educationFeePayments.branchId, branch.id)),
      );
    const incomeTotal = Number(income?.total ?? 0);
    const expenseTotal = Number(expense?.total ?? 0);
    return {
      incomePkr: incomeTotal,
      expensePkr: expenseTotal,
      netPkr: incomeTotal - expenseTotal,
      feeCollectedPkr: Number(feeCollected?.total ?? 0),
    };
  }

  private mapFinanceTxn(row: typeof educationFinanceTxns.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      txnType: row.txnType as "income" | "expense" | "refund" | "adjustment",
      amountPkr: row.amountPkr,
      refModule: row.refModule,
      refId: row.refId,
      title: row.title,
      txnDate: row.txnDate,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  // ─── Payroll ─────────────────────────────────────────────────────────────

  async listPayrollRuns(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationPayrollRuns)
      .where(and(eq(educationPayrollRuns.organizationId, organizationId), eq(educationPayrollRuns.branchId, branch.id)))
      .orderBy(desc(educationPayrollRuns.createdAt));
    return rows.map((r) => this.mapPayrollRun(r));
  }

  async createPayrollRun(organizationId: string, input: CreateEducationPayrollRun, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationPayrollRuns)
      .values({
        organizationId,
        branchId: branch.id,
        periodLabel: input.periodLabel,
        status: input.status ?? "draft",
        totalPkr: input.totalPkr ?? 0,
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "payroll",
      recordId: row!.id,
    });
    return this.mapPayrollRun(row!);
  }

  async updatePayrollRun(organizationId: string, input: UpdateEducationPayrollRun, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationPayrollRuns)
      .where(and(eq(educationPayrollRuns.id, input.id), eq(educationPayrollRuns.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Payroll run not found");
    const [row] = await this.db
      .update(educationPayrollRuns)
      .set({
        ...(input.periodLabel !== undefined ? { periodLabel: input.periodLabel } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.totalPkr !== undefined ? { totalPkr: input.totalPkr } : {}),
        updatedAt: new Date(),
      })
      .where(eq(educationPayrollRuns.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "payroll",
      recordId: input.id,
    });
    return this.mapPayrollRun(row!);
  }

  async generatePayslips(organizationId: string, payrollRunId: string, userId?: string) {
    const [run] = await this.db
      .select()
      .from(educationPayrollRuns)
      .where(and(eq(educationPayrollRuns.id, payrollRunId), eq(educationPayrollRuns.organizationId, organizationId)))
      .limit(1);
    if (!run) throw new NotFoundException("Payroll run not found");

    const staffRows = await this.db
      .select()
      .from(educationStaff)
      .where(
        and(
          eq(educationStaff.organizationId, organizationId),
          eq(educationStaff.branchId, run.branchId),
          eq(educationStaff.status, "active"),
          isNull(educationStaff.deletedAt),
        ),
      );
    const teacherRows = await this.db
      .select()
      .from(educationTeachers)
      .where(
        and(
          eq(educationTeachers.organizationId, organizationId),
          eq(educationTeachers.branchId, run.branchId),
          eq(educationTeachers.status, "active"),
          isNull(educationTeachers.deletedAt),
        ),
      );

    const created = [];
    let totalPkr = 0;

    for (const staff of staffRows) {
      const basic = staff.salaryPkr ?? 0;
      const [slip] = await this.db
        .insert(educationPayslips)
        .values({
          organizationId,
          payrollRunId,
          personType: "staff",
          personId: staff.id,
          basicPkr: basic,
          allowancesPkr: 0,
          deductionsPkr: 0,
          netPkr: basic,
          status: "calculated",
        })
        .returning();
      created.push(this.mapPayslip(slip!));
      totalPkr += basic;
    }

    for (const teacher of teacherRows) {
      const basic = 0;
      const [slip] = await this.db
        .insert(educationPayslips)
        .values({
          organizationId,
          payrollRunId,
          personType: "teacher",
          personId: teacher.id,
          basicPkr: basic,
          allowancesPkr: 0,
          deductionsPkr: 0,
          netPkr: basic,
          status: "calculated",
        })
        .returning();
      created.push(this.mapPayslip(slip!));
      totalPkr += basic;
    }

    await this.db
      .update(educationPayrollRuns)
      .set({ status: "calculated", totalPkr, updatedAt: new Date() })
      .where(eq(educationPayrollRuns.id, payrollRunId));

    await this.writeAudit({
      organizationId,
      branchId: run.branchId,
      userId,
      action: "generate_payslips",
      moduleKey: "payroll",
      recordId: payrollRunId,
      detail: `${created.length} payslips`,
    });
    return { payslips: created, totalPkr };
  }

  async listPayslips(organizationId: string, payrollRunId: string) {
    const filters = [eq(educationPayslips.organizationId, organizationId)];
    if (payrollRunId) filters.push(eq(educationPayslips.payrollRunId, payrollRunId));
    const rows = await this.db
      .select()
      .from(educationPayslips)
      .where(and(...filters))
      .orderBy(asc(educationPayslips.personType));
    return rows.map((r) => this.mapPayslip(r));
  }

  private mapPayrollRun(row: typeof educationPayrollRuns.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      periodLabel: row.periodLabel,
      status: row.status as "draft" | "calculated" | "approved" | "paid",
      totalPkr: row.totalPkr,
      createdAt: this.iso(row.createdAt)!,
      updatedAt: this.iso(row.updatedAt)!,
    };
  }

  private mapPayslip(row: typeof educationPayslips.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      payrollRunId: row.payrollRunId,
      personType: row.personType as "teacher" | "staff",
      personId: row.personId,
      basicPkr: row.basicPkr,
      allowancesPkr: row.allowancesPkr,
      deductionsPkr: row.deductionsPkr,
      netPkr: row.netPkr,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  // ─── Library ─────────────────────────────────────────────────────────────

  async listBooks(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationBooks)
      .where(and(eq(educationBooks.organizationId, organizationId), eq(educationBooks.branchId, branch.id)))
      .orderBy(asc(educationBooks.title));
    return rows.map((r) => this.mapBook(r));
  }

  async createBook(organizationId: string, input: CreateEducationBook, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const copiesTotal = input.copiesTotal ?? 1;
    const copiesAvailable = input.copiesAvailable ?? copiesTotal;
    const [row] = await this.db
      .insert(educationBooks)
      .values({
        organizationId,
        branchId: branch.id,
        title: input.title,
        author: input.author ?? null,
        publisher: input.publisher ?? null,
        categoryCode: input.categoryCode ?? null,
        isbn: input.isbn ?? null,
        copiesTotal,
        copiesAvailable,
        status: input.status ?? "active",
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "library",
      recordId: row!.id,
    });
    return this.mapBook(row!);
  }

  async updateBook(organizationId: string, input: UpdateEducationBook, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationBooks)
      .where(and(eq(educationBooks.id, input.id), eq(educationBooks.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Book not found");
    const [row] = await this.db
      .update(educationBooks)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.author !== undefined ? { author: input.author ?? null } : {}),
        ...(input.publisher !== undefined ? { publisher: input.publisher ?? null } : {}),
        ...(input.categoryCode !== undefined ? { categoryCode: input.categoryCode ?? null } : {}),
        ...(input.isbn !== undefined ? { isbn: input.isbn ?? null } : {}),
        ...(input.copiesTotal !== undefined ? { copiesTotal: input.copiesTotal } : {}),
        ...(input.copiesAvailable !== undefined ? { copiesAvailable: input.copiesAvailable } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      })
      .where(eq(educationBooks.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "library",
      recordId: input.id,
    });
    return this.mapBook(row!);
  }

  private mapBook(row: typeof educationBooks.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      title: row.title,
      author: row.author,
      publisher: row.publisher,
      categoryCode: row.categoryCode,
      isbn: row.isbn,
      copiesTotal: row.copiesTotal,
      copiesAvailable: row.copiesAvailable,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  async listBookIssues(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationBookIssues)
      .where(and(eq(educationBookIssues.organizationId, organizationId), eq(educationBookIssues.branchId, branch.id)))
      .orderBy(desc(educationBookIssues.createdAt));
    return rows.map((r) => this.mapBookIssue(r));
  }

  async createBookIssue(organizationId: string, input: CreateEducationBookIssue, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [book] = await this.db
      .select()
      .from(educationBooks)
      .where(and(eq(educationBooks.id, input.bookId), eq(educationBooks.organizationId, organizationId)))
      .limit(1);
    if (!book) throw new NotFoundException("Book not found");
    if (book.copiesAvailable <= 0) throw new BadRequestException("No copies available");
    const [row] = await this.db
      .insert(educationBookIssues)
      .values({
        organizationId,
        branchId: branch.id,
        bookId: input.bookId,
        borrowerType: input.borrowerType,
        borrowerId: input.borrowerId,
        issuedAt: input.issuedAt,
        dueAt: input.dueAt ?? null,
        returnedAt: input.returnedAt ?? null,
        finePkr: input.finePkr ?? 0,
        status: input.status ?? "issued",
      })
      .returning();
    await this.db
      .update(educationBooks)
      .set({ copiesAvailable: book.copiesAvailable - 1 })
      .where(eq(educationBooks.id, book.id));
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "issue",
      moduleKey: "library",
      recordId: row!.id,
    });
    return this.mapBookIssue(row!);
  }

  async returnBookIssue(
    organizationId: string,
    id: string,
    body?: { finePkr?: number; returnedAt?: string },
    userId?: string,
  ) {
    const [existing] = await this.db
      .select()
      .from(educationBookIssues)
      .where(and(eq(educationBookIssues.id, id), eq(educationBookIssues.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Book issue not found");
    if (existing.status === "returned") throw new BadRequestException("Already returned");

    const returnedAt = body?.returnedAt ?? new Date().toISOString().slice(0, 10);
    let finePkr = body?.finePkr ?? existing.finePkr;
    if (body?.finePkr === undefined && existing.dueAt && returnedAt > existing.dueAt) {
      const due = new Date(existing.dueAt);
      const ret = new Date(returnedAt);
      const daysLate = Math.max(0, Math.ceil((ret.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
      finePkr = daysLate * 50;
    }

    const [row] = await this.db
      .update(educationBookIssues)
      .set({ status: "returned", returnedAt, finePkr })
      .where(eq(educationBookIssues.id, id))
      .returning();

    const [book] = await this.db
      .select()
      .from(educationBooks)
      .where(eq(educationBooks.id, existing.bookId))
      .limit(1);
    if (book) {
      await this.db
        .update(educationBooks)
        .set({ copiesAvailable: book.copiesAvailable + 1 })
        .where(eq(educationBooks.id, book.id));
    }

    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "return",
      moduleKey: "library",
      recordId: id,
    });
    return this.mapBookIssue(row!);
  }

  async updateBookIssue(organizationId: string, input: UpdateEducationBookIssue, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationBookIssues)
      .where(and(eq(educationBookIssues.id, input.id), eq(educationBookIssues.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Book issue not found");
    const [row] = await this.db
      .update(educationBookIssues)
      .set({
        ...(input.dueAt !== undefined ? { dueAt: input.dueAt ?? null } : {}),
        ...(input.returnedAt !== undefined ? { returnedAt: input.returnedAt ?? null } : {}),
        ...(input.finePkr !== undefined ? { finePkr: input.finePkr } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      })
      .where(eq(educationBookIssues.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "library",
      recordId: input.id,
    });
    return this.mapBookIssue(row!);
  }

  private mapBookIssue(row: typeof educationBookIssues.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      bookId: row.bookId,
      borrowerType: row.borrowerType as "student" | "staff" | "teacher",
      borrowerId: row.borrowerId,
      issuedAt: row.issuedAt,
      dueAt: row.dueAt,
      returnedAt: row.returnedAt,
      finePkr: row.finePkr,
      status: row.status as "issued" | "returned" | "lost" | "damaged",
      createdAt: this.iso(row.createdAt)!,
    };
  }

  // ─── Transport ───────────────────────────────────────────────────────────

  async listVehicles(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationVehicles)
      .where(and(eq(educationVehicles.organizationId, organizationId), eq(educationVehicles.branchId, branch.id)))
      .orderBy(asc(educationVehicles.code));
    return rows.map((r) => this.mapVehicle(r));
  }

  async createVehicle(organizationId: string, input: CreateEducationVehicle, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationVehicles)
      .values({
        organizationId,
        branchId: branch.id,
        code: input.code,
        registration: input.registration,
        vehicleTypeCode: input.vehicleTypeCode ?? null,
        capacity: input.capacity ?? null,
        driverName: input.driverName ?? null,
        status: input.status ?? "active",
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "transport",
      recordId: row!.id,
    });
    return this.mapVehicle(row!);
  }

  async updateVehicle(organizationId: string, input: UpdateEducationVehicle, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationVehicles)
      .where(and(eq(educationVehicles.id, input.id), eq(educationVehicles.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Vehicle not found");
    const [row] = await this.db
      .update(educationVehicles)
      .set({
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.registration !== undefined ? { registration: input.registration } : {}),
        ...(input.vehicleTypeCode !== undefined ? { vehicleTypeCode: input.vehicleTypeCode ?? null } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity ?? null } : {}),
        ...(input.driverName !== undefined ? { driverName: input.driverName ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      })
      .where(eq(educationVehicles.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "transport",
      recordId: input.id,
    });
    return this.mapVehicle(row!);
  }

  private mapVehicle(row: typeof educationVehicles.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      code: row.code,
      registration: row.registration,
      vehicleTypeCode: row.vehicleTypeCode,
      capacity: row.capacity,
      driverName: row.driverName,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  async listRoutes(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationRoutes)
      .where(and(eq(educationRoutes.organizationId, organizationId), eq(educationRoutes.branchId, branch.id)))
      .orderBy(asc(educationRoutes.name));
    return rows.map((r) => this.mapRoute(r));
  }

  async createRoute(organizationId: string, input: CreateEducationRoute, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationRoutes)
      .values({
        organizationId,
        branchId: branch.id,
        name: input.name,
        code: input.code,
        vehicleId: input.vehicleId ?? null,
        feePkr: input.feePkr ?? 0,
        status: input.status ?? "active",
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "transport",
      recordId: row!.id,
    });
    return this.mapRoute(row!);
  }

  async updateRoute(organizationId: string, input: UpdateEducationRoute, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationRoutes)
      .where(and(eq(educationRoutes.id, input.id), eq(educationRoutes.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Route not found");
    const [row] = await this.db
      .update(educationRoutes)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.vehicleId !== undefined ? { vehicleId: input.vehicleId ?? null } : {}),
        ...(input.feePkr !== undefined ? { feePkr: input.feePkr } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      })
      .where(eq(educationRoutes.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "transport",
      recordId: input.id,
    });
    return this.mapRoute(row!);
  }

  private mapRoute(row: typeof educationRoutes.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      name: row.name,
      code: row.code,
      vehicleId: row.vehicleId,
      feePkr: row.feePkr,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  async listRouteStops(organizationId: string, routeId: string) {
    const rows = await this.db
      .select()
      .from(educationRouteStops)
      .where(and(eq(educationRouteStops.organizationId, organizationId), eq(educationRouteStops.routeId, routeId)))
      .orderBy(asc(educationRouteStops.sortOrder));
    return rows.map((r) => this.mapRouteStop(r));
  }

  async createRouteStop(organizationId: string, input: CreateEducationRouteStop, userId?: string) {
    const [route] = await this.db
      .select()
      .from(educationRoutes)
      .where(and(eq(educationRoutes.id, input.routeId), eq(educationRoutes.organizationId, organizationId)))
      .limit(1);
    if (!route) throw new NotFoundException("Route not found");
    const [row] = await this.db
      .insert(educationRouteStops)
      .values({
        organizationId,
        routeId: input.routeId,
        name: input.name,
        sortOrder: input.sortOrder ?? 0,
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: route.branchId,
      userId,
      action: "create",
      moduleKey: "transport",
      recordId: row!.id,
    });
    return this.mapRouteStop(row!);
  }

  async updateRouteStop(organizationId: string, input: UpdateEducationRouteStop, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationRouteStops)
      .where(and(eq(educationRouteStops.id, input.id), eq(educationRouteStops.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Route stop not found");
    const [row] = await this.db
      .update(educationRouteStops)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.routeId !== undefined ? { routeId: input.routeId } : {}),
      })
      .where(eq(educationRouteStops.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      userId,
      action: "update",
      moduleKey: "transport",
      recordId: input.id,
    });
    return this.mapRouteStop(row!);
  }

  private mapRouteStop(row: typeof educationRouteStops.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      routeId: row.routeId,
      name: row.name,
      sortOrder: row.sortOrder,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  async listTransportAssignments(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationTransportAssignments)
      .where(
        and(
          eq(educationTransportAssignments.organizationId, organizationId),
          eq(educationTransportAssignments.branchId, branch.id),
        ),
      )
      .orderBy(desc(educationTransportAssignments.createdAt));
    return rows.map((r) => this.mapTransportAssignment(r));
  }

  async createTransportAssignment(
    organizationId: string,
    input: CreateEducationTransportAssignment,
    userId?: string,
  ) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [route] = await this.db
      .select()
      .from(educationRoutes)
      .where(and(eq(educationRoutes.id, input.routeId), eq(educationRoutes.organizationId, organizationId)))
      .limit(1);
    if (!route) throw new NotFoundException("Route not found");

    if (route.vehicleId) {
      const [vehicle] = await this.db
        .select()
        .from(educationVehicles)
        .where(eq(educationVehicles.id, route.vehicleId))
        .limit(1);
      if (vehicle?.capacity != null && vehicle.capacity > 0) {
        const [assigned] = await this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(educationTransportAssignments)
          .where(
            and(
              eq(educationTransportAssignments.routeId, route.id),
              eq(educationTransportAssignments.status, "active"),
            ),
          );
        if (Number(assigned?.count ?? 0) >= vehicle.capacity) {
          throw new BadRequestException("Vehicle capacity exceeded for this route");
        }
      }
    }

    const [row] = await this.db
      .insert(educationTransportAssignments)
      .values({
        organizationId,
        branchId: branch.id,
        routeId: input.routeId,
        studentId: input.studentId,
        stopId: input.stopId ?? null,
        status: input.status ?? "active",
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "transport",
      recordId: row!.id,
    });
    return this.mapTransportAssignment(row!);
  }

  async updateTransportAssignment(
    organizationId: string,
    input: UpdateEducationTransportAssignment,
    userId?: string,
  ) {
    const [existing] = await this.db
      .select()
      .from(educationTransportAssignments)
      .where(
        and(
          eq(educationTransportAssignments.id, input.id),
          eq(educationTransportAssignments.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!existing) throw new NotFoundException("Transport assignment not found");
    const [row] = await this.db
      .update(educationTransportAssignments)
      .set({
        ...(input.routeId !== undefined ? { routeId: input.routeId } : {}),
        ...(input.studentId !== undefined ? { studentId: input.studentId } : {}),
        ...(input.stopId !== undefined ? { stopId: input.stopId ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      })
      .where(eq(educationTransportAssignments.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "transport",
      recordId: input.id,
    });
    return this.mapTransportAssignment(row!);
  }

  private mapTransportAssignment(row: typeof educationTransportAssignments.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      routeId: row.routeId,
      studentId: row.studentId,
      stopId: row.stopId,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  // ─── Notices ─────────────────────────────────────────────────────────────

  async listNotices(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationNotices)
      .where(and(eq(educationNotices.organizationId, organizationId), eq(educationNotices.branchId, branch.id)))
      .orderBy(desc(educationNotices.createdAt));
    return rows.map((r) => this.mapNotice(r));
  }

  async createNotice(organizationId: string, input: CreateEducationNotice, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationNotices)
      .values({
        organizationId,
        branchId: branch.id,
        title: input.title,
        body: input.body,
        categoryCode: input.categoryCode ?? null,
        audienceCode: input.audienceCode ?? null,
        status: input.status ?? "draft",
        publishAt: input.publishAt ?? null,
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "communication",
      recordId: row!.id,
    });
    return this.mapNotice(row!);
  }

  async updateNotice(organizationId: string, input: UpdateEducationNotice, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationNotices)
      .where(and(eq(educationNotices.id, input.id), eq(educationNotices.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Notice not found");
    const [row] = await this.db
      .update(educationNotices)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.categoryCode !== undefined ? { categoryCode: input.categoryCode ?? null } : {}),
        ...(input.audienceCode !== undefined ? { audienceCode: input.audienceCode ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.publishAt !== undefined ? { publishAt: input.publishAt ?? null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(educationNotices.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "communication",
      recordId: input.id,
    });
    return this.mapNotice(row!);
  }

  async publishNotice(organizationId: string, id: string, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationNotices)
      .where(and(eq(educationNotices.id, id), eq(educationNotices.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Notice not found");
    const [row] = await this.db
      .update(educationNotices)
      .set({
        status: "published",
        publishAt: existing.publishAt ?? new Date().toISOString(),
        updatedAt: new Date(),
      })
      .where(eq(educationNotices.id, id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "publish",
      moduleKey: "communication",
      recordId: id,
    });
    return this.mapNotice(row!);
  }

  private mapNotice(row: typeof educationNotices.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      title: row.title,
      body: row.body,
      categoryCode: row.categoryCode,
      audienceCode: row.audienceCode,
      status: row.status as "draft" | "scheduled" | "published" | "archived",
      publishAt: row.publishAt,
      createdAt: this.iso(row.createdAt)!,
      updatedAt: this.iso(row.updatedAt)!,
    };
  }

  // ─── Documents ───────────────────────────────────────────────────────────

  async listDocumentTemplates(organizationId: string, branchCode?: string) {
    const branch = await this.resolveOptionalBranch(organizationId, branchCode);
    const conditions = [eq(educationDocumentTemplates.organizationId, organizationId)];
    if (branch) conditions.push(eq(educationDocumentTemplates.branchId, branch.id));
    const rows = await this.db
      .select()
      .from(educationDocumentTemplates)
      .where(and(...conditions))
      .orderBy(asc(educationDocumentTemplates.name));
    return rows.map((r) => this.mapDocumentTemplate(r));
  }

  async createDocumentTemplate(organizationId: string, input: CreateEducationDocumentTemplate, userId?: string) {
    const branch = await this.resolveOptionalBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationDocumentTemplates)
      .values({
        organizationId,
        branchId: branch?.id ?? null,
        name: input.name,
        documentTypeCode: input.documentTypeCode,
        bodyHtml: input.bodyHtml,
        status: input.status ?? "active",
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch?.id,
      userId,
      action: "create",
      moduleKey: "documents",
      recordId: row!.id,
    });
    return this.mapDocumentTemplate(row!);
  }

  async updateDocumentTemplate(
    organizationId: string,
    input: UpdateEducationDocumentTemplate,
    userId?: string,
  ) {
    const [existing] = await this.db
      .select()
      .from(educationDocumentTemplates)
      .where(
        and(eq(educationDocumentTemplates.id, input.id), eq(educationDocumentTemplates.organizationId, organizationId)),
      )
      .limit(1);
    if (!existing) throw new NotFoundException("Document template not found");
    const [row] = await this.db
      .update(educationDocumentTemplates)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.documentTypeCode !== undefined ? { documentTypeCode: input.documentTypeCode } : {}),
        ...(input.bodyHtml !== undefined ? { bodyHtml: input.bodyHtml } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedAt: new Date(),
      })
      .where(eq(educationDocumentTemplates.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "documents",
      recordId: input.id,
    });
    return this.mapDocumentTemplate(row!);
  }

  private mapDocumentTemplate(row: typeof educationDocumentTemplates.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      name: row.name,
      documentTypeCode: row.documentTypeCode,
      bodyHtml: row.bodyHtml,
      status: row.status as "active" | "inactive",
      createdAt: this.iso(row.createdAt)!,
      updatedAt: this.iso(row.updatedAt)!,
    };
  }

  async seedDocumentTemplates(organizationId: string, branchCode?: string) {
    const branch = branchCode ? await this.resolveBranch(organizationId, branchCode) : null;
    let created = 0;
    for (const tpl of DEFAULT_EDUCATION_DOCUMENT_TEMPLATES) {
      const conditions = [
        eq(educationDocumentTemplates.organizationId, organizationId),
        eq(educationDocumentTemplates.documentTypeCode, tpl.documentTypeCode),
      ];
      if (branch) conditions.push(eq(educationDocumentTemplates.branchId, branch.id));
      const [existing] = await this.db
        .select()
        .from(educationDocumentTemplates)
        .where(and(...conditions))
        .limit(1);
      if (existing) continue;
      await this.db.insert(educationDocumentTemplates).values({
        organizationId,
        branchId: branch?.id ?? null,
        name: tpl.name,
        documentTypeCode: tpl.documentTypeCode,
        bodyHtml: tpl.bodyHtml,
        status: "active",
      });
      created += 1;
    }
    return { created, total: DEFAULT_EDUCATION_DOCUMENT_TEMPLATES.length };
  }

  private async buildDocumentTokens(
    organizationId: string,
    input: {
      branchId?: string | null;
      studentId?: string | null;
      payloadJson?: string | null;
    },
  ): Promise<Record<string, string | number | null | undefined>> {
    const tokens: Record<string, string | number | null | undefined> = {
      ...parsePayloadJson(input.payloadJson),
      generatedAt: new Date().toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" }),
      issueDate: new Date().toISOString().slice(0, 10),
      documentNumber: `DOC-${Date.now().toString(36).toUpperCase()}`,
    };

    const [org] = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    tokens.institutionName = tokens.institutionName || org?.name || "EducationFlow Institution";
    tokens.institutionAddress = tokens.institutionAddress || "";
    tokens.institutionPhone = tokens.institutionPhone || "";
    tokens.institutionEmail = tokens.institutionEmail || "";

    if (input.branchId) {
      const [branch] = await this.db
        .select()
        .from(popsBranches)
        .where(eq(popsBranches.id, input.branchId))
        .limit(1);
      tokens.branchName = tokens.branchName || branch?.name || branch?.code || "";
    } else {
      tokens.branchName = tokens.branchName || "Main";
    }

    if (input.studentId) {
      const [student] = await this.db
        .select()
        .from(educationStudents)
        .where(
          and(
            eq(educationStudents.id, input.studentId),
            eq(educationStudents.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (student) {
        tokens.studentName =
          tokens.studentName ||
          [student.firstName, student.lastName].filter(Boolean).join(" ").trim();
        tokens.studentNumber = tokens.studentNumber || student.studentNumber;
        tokens.fatherName = tokens.fatherName || student.fatherName || "";
        tokens.motherName = tokens.motherName || student.motherName || "";
        tokens.phone = tokens.phone || student.phone || "";
        tokens.email = tokens.email || student.email || "";
        tokens.address = tokens.address || student.address || "";
        if (student.classId) {
          const [klass] = await this.db
            .select()
            .from(educationClasses)
            .where(eq(educationClasses.id, student.classId))
            .limit(1);
          tokens.className = tokens.className || klass?.name || "";
        }
        if (student.sectionId) {
          const [section] = await this.db
            .select()
            .from(educationSections)
            .where(eq(educationSections.id, student.sectionId))
            .limit(1);
          tokens.sectionName = tokens.sectionName || section?.name || "";
        }
        if (student.sessionId) {
          const [session] = await this.db
            .select()
            .from(educationAcademicSessions)
            .where(eq(educationAcademicSessions.id, student.sessionId))
            .limit(1);
          tokens.sessionName = tokens.sessionName || session?.name || "";
        }
      }
    }

    tokens.className = tokens.className || "—";
    tokens.sectionName = tokens.sectionName || "—";
    tokens.sessionName = tokens.sessionName || "—";
    tokens.studentName = tokens.studentName || "—";
    tokens.studentNumber = tokens.studentNumber || "—";
    tokens.fatherName = tokens.fatherName || "—";
    tokens.purpose = tokens.purpose || "official use";
    tokens.reason = tokens.reason || "as requested";
    tokens.effectiveDate = tokens.effectiveDate || tokens.issueDate;
    tokens.marksTableHtml =
      tokens.marksTableHtml ||
      `<table class="table"><thead><tr><th>Subject</th><th>Obtained</th><th>Total</th><th>Grade</th></tr></thead><tbody><tr><td colspan="4">No marks provided</td></tr></tbody></table>`;
    return tokens;
  }

  async generateDocument(organizationId: string, input: CreateEducationGeneratedDocument, userId?: string) {
    const branch = await this.resolveOptionalBranch(organizationId, input.branchCode);
    const [template] = await this.db
      .select()
      .from(educationDocumentTemplates)
      .where(
        and(
          eq(educationDocumentTemplates.id, input.templateId),
          eq(educationDocumentTemplates.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!template) throw new NotFoundException("Document template not found");

    const tokens = await this.buildDocumentTokens(organizationId, {
      branchId: branch?.id ?? template.branchId,
      studentId: input.studentId,
      payloadJson: input.payloadJson,
    });
    const mergedHtml = mergeEducationTemplate(template.bodyHtml, tokens);
    const storedPayload = JSON.stringify({
      ...tokens,
      mergedHtml,
      documentTypeCode: template.documentTypeCode,
    });

    const [row] = await this.db
      .insert(educationGeneratedDocuments)
      .values({
        organizationId,
        branchId: branch?.id ?? template.branchId,
        templateId: input.templateId,
        studentId: input.studentId ?? null,
        personType: input.personType ?? null,
        personId: input.personId ?? null,
        title: input.title,
        payloadJson: storedPayload,
        status: input.status ?? "generated",
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch?.id ?? template.branchId,
      userId,
      action: "generate",
      moduleKey: "documents",
      recordId: row!.id,
    });
    return {
      id: row!.id,
      organizationId: row!.organizationId,
      branchId: row!.branchId,
      templateId: row!.templateId,
      studentId: row!.studentId,
      personType: row!.personType,
      personId: row!.personId,
      title: row!.title,
      payloadJson: row!.payloadJson,
      status: row!.status,
      createdAt: this.iso(row!.createdAt)!,
      bodyHtml: mergedHtml,
      documentTypeCode: template.documentTypeCode,
    };
  }

  async listGeneratedDocuments(organizationId: string, branchCode?: string) {
    const branch = await this.resolveOptionalBranch(organizationId, branchCode);
    const conditions = [eq(educationGeneratedDocuments.organizationId, organizationId)];
    if (branch) conditions.push(eq(educationGeneratedDocuments.branchId, branch.id));
    const rows = await this.db
      .select()
      .from(educationGeneratedDocuments)
      .where(and(...conditions))
      .orderBy(desc(educationGeneratedDocuments.createdAt));
    return rows.map((r) => {
      const payload = parsePayloadJson(r.payloadJson);
      return {
        id: r.id,
        organizationId: r.organizationId,
        branchId: r.branchId,
        templateId: r.templateId,
        studentId: r.studentId,
        personType: r.personType,
        personId: r.personId,
        title: r.title,
        payloadJson: r.payloadJson,
        status: r.status,
        createdAt: this.iso(r.createdAt)!,
        bodyHtml: typeof payload.mergedHtml === "string" ? payload.mergedHtml : undefined,
        documentTypeCode:
          typeof payload.documentTypeCode === "string" ? payload.documentTypeCode : undefined,
      };
    });
  }

  async getGeneratedDocument(organizationId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(educationGeneratedDocuments)
      .where(
        and(
          eq(educationGeneratedDocuments.id, id),
          eq(educationGeneratedDocuments.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException("Generated document not found");
    const payload = parsePayloadJson(row.payloadJson);
    let bodyHtml = typeof payload.mergedHtml === "string" ? payload.mergedHtml : "";
    if (!bodyHtml) {
      const [template] = await this.db
        .select()
        .from(educationDocumentTemplates)
        .where(eq(educationDocumentTemplates.id, row.templateId))
        .limit(1);
      if (template) {
        const tokens = await this.buildDocumentTokens(organizationId, {
          branchId: row.branchId,
          studentId: row.studentId,
          payloadJson: row.payloadJson,
        });
        bodyHtml = mergeEducationTemplate(template.bodyHtml, tokens);
      }
    }
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      templateId: row.templateId,
      studentId: row.studentId,
      personType: row.personType,
      personId: row.personId,
      title: row.title,
      payloadJson: row.payloadJson,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
      bodyHtml,
      documentTypeCode:
        typeof payload.documentTypeCode === "string" ? payload.documentTypeCode : undefined,
    };
  }

  // ─── Reports ─────────────────────────────────────────────────────────────

  async reportAttendanceSummary(organizationId: string, branchCode: string, fromDate?: string, toDate?: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const conditions = [
      eq(educationAttendance.organizationId, organizationId),
      eq(educationAttendance.branchId, branch.id),
    ];
    if (fromDate) conditions.push(gte(educationAttendance.date, fromDate));
    if (toDate) conditions.push(lte(educationAttendance.date, toDate));
    const rows = await this.db
      .select({
        statusCode: educationAttendance.statusCode,
        count: sql<number>`count(*)::int`,
      })
      .from(educationAttendance)
      .where(and(...conditions))
      .groupBy(educationAttendance.statusCode);
    return {
      byStatus: rows.map((r) => ({ statusCode: r.statusCode, count: Number(r.count) })),
      total: rows.reduce((sum, r) => sum + Number(r.count), 0),
    };
  }

  async reportFeeCollection(organizationId: string, branchCode: string, fromDate?: string, toDate?: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const conditions = [
      eq(educationFeePayments.organizationId, organizationId),
      eq(educationFeePayments.branchId, branch.id),
    ];
    if (fromDate) conditions.push(gte(educationFeePayments.paidAt, new Date(fromDate)));
    if (toDate) {
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(educationFeePayments.paidAt, end));
    }
    const [row] = await this.db
      .select({
        total: sql<number>`coalesce(sum(${educationFeePayments.amountPkr}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(educationFeePayments)
      .where(and(...conditions));
    const [pending] = await this.db
      .select({
        total: sql<number>`coalesce(sum(${educationFeeInvoices.amountPkr} - ${educationFeeInvoices.paidPkr}), 0)::int`,
      })
      .from(educationFeeInvoices)
      .where(
        and(
          eq(educationFeeInvoices.organizationId, organizationId),
          eq(educationFeeInvoices.branchId, branch.id),
          sql`${educationFeeInvoices.status} in ('pending', 'partial')`,
        ),
      );
    return {
      collectedPkr: Number(row?.total ?? 0),
      paymentCount: Number(row?.count ?? 0),
      pendingPkr: Number(pending?.total ?? 0),
    };
  }

  async reportAdmissionsCount(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select({
        statusCode: educationAdmissions.statusCode,
        count: sql<number>`count(*)::int`,
      })
      .from(educationAdmissions)
      .where(
        and(eq(educationAdmissions.organizationId, organizationId), eq(educationAdmissions.branchId, branch.id)),
      )
      .groupBy(educationAdmissions.statusCode);
    return {
      byStatus: rows.map((r) => ({ statusCode: r.statusCode, count: Number(r.count) })),
      total: rows.reduce((sum, r) => sum + Number(r.count), 0),
    };
  }

  async reportExpenseSummary(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const byStatus = await this.db
      .select({
        status: educationExpenses.status,
        total: sql<number>`coalesce(sum(${educationExpenses.amountPkr}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(educationExpenses)
      .where(and(eq(educationExpenses.organizationId, organizationId), eq(educationExpenses.branchId, branch.id)))
      .groupBy(educationExpenses.status);
    const byCategory = await this.db
      .select({
        categoryCode: educationExpenses.categoryCode,
        total: sql<number>`coalesce(sum(${educationExpenses.amountPkr}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(educationExpenses)
      .where(and(eq(educationExpenses.organizationId, organizationId), eq(educationExpenses.branchId, branch.id)))
      .groupBy(educationExpenses.categoryCode);
    return {
      byStatus: byStatus.map((r) => ({
        status: r.status,
        totalPkr: Number(r.total),
        count: Number(r.count),
      })),
      byCategory: byCategory.map((r) => ({
        categoryCode: r.categoryCode,
        totalPkr: Number(r.total),
        count: Number(r.count),
      })),
    };
  }

  async reportStudents(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const byStatus = await this.db
      .select({
        statusCode: educationStudents.statusCode,
        count: sql<number>`count(*)::int`,
      })
      .from(educationStudents)
      .where(
        and(
          eq(educationStudents.organizationId, organizationId),
          eq(educationStudents.branchId, branch.id),
          isNull(educationStudents.deletedAt),
        ),
      )
      .groupBy(educationStudents.statusCode);
    const [totalRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(educationStudents)
      .where(
        and(
          eq(educationStudents.organizationId, organizationId),
          eq(educationStudents.branchId, branch.id),
          isNull(educationStudents.deletedAt),
        ),
      );
    return {
      report: "students",
      total: Number(totalRow?.count ?? 0),
      byStatus: byStatus.map((r) => ({ statusCode: r.statusCode, count: Number(r.count) })),
    };
  }

  async reportExams(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const byStatus = await this.db
      .select({
        status: educationExams.status,
        count: sql<number>`count(*)::int`,
      })
      .from(educationExams)
      .where(and(eq(educationExams.organizationId, organizationId), eq(educationExams.branchId, branch.id)))
      .groupBy(educationExams.status);
    const [marksRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(educationMarks)
      .where(and(eq(educationMarks.organizationId, organizationId), eq(educationMarks.branchId, branch.id)));
    return {
      report: "exams",
      byStatus: byStatus.map((r) => ({ status: r.status, count: Number(r.count) })),
      marksCount: Number(marksRow?.count ?? 0),
    };
  }

  async reportFinance(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const fees = await this.reportFeeCollection(organizationId, branchCode);
    const expenses = await this.reportExpenseSummary(organizationId, branchCode);
    const [txnRow] = await this.db
      .select({
        count: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${educationFinanceTxns.amountPkr}), 0)::int`,
      })
      .from(educationFinanceTxns)
      .where(
        and(
          eq(educationFinanceTxns.organizationId, organizationId),
          eq(educationFinanceTxns.branchId, branch.id),
        ),
      );
    return {
      report: "finance",
      fees,
      expenses,
      transactions: { count: Number(txnRow?.count ?? 0), totalPkr: Number(txnRow?.total ?? 0) },
    };
  }

  async reportPayroll(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const runs = await this.db
      .select({
        status: educationPayrollRuns.status,
        count: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${educationPayrollRuns.totalPkr}), 0)::int`,
      })
      .from(educationPayrollRuns)
      .where(
        and(eq(educationPayrollRuns.organizationId, organizationId), eq(educationPayrollRuns.branchId, branch.id)),
      )
      .groupBy(educationPayrollRuns.status);
    const [slips] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(educationPayslips)
      .where(eq(educationPayslips.organizationId, organizationId));
    return {
      report: "payroll",
      byStatus: runs.map((r) => ({
        status: r.status,
        count: Number(r.count),
        totalPkr: Number(r.total),
      })),
      payslipCount: Number(slips?.count ?? 0),
    };
  }

  // ─── Audit logs ──────────────────────────────────────────────────────────

  async listAuditLogs(organizationId: string, branchCode?: string, moduleKey?: string) {
    const branch = await this.resolveOptionalBranch(organizationId, branchCode);
    const conditions = [eq(educationAuditLogs.organizationId, organizationId)];
    if (branch) conditions.push(eq(educationAuditLogs.branchId, branch.id));
    if (moduleKey) conditions.push(eq(educationAuditLogs.moduleKey, moduleKey));
    const rows = await this.db
      .select()
      .from(educationAuditLogs)
      .where(and(...conditions))
      .orderBy(desc(educationAuditLogs.createdAt))
      .limit(500);
    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      branchId: r.branchId,
      userId: r.userId,
      action: r.action,
      moduleKey: r.moduleKey,
      recordId: r.recordId,
      detail: r.detail,
      oldValueJson: r.oldValueJson,
      newValueJson: r.newValueJson,
      createdAt: this.iso(r.createdAt)!,
    }));
  }
}
