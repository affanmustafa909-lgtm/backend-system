import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  BulkPromoteEducationStudents,
  CreateEducationAlumni,
  CreateEducationAssignment,
  CreateEducationAssignmentSubmission,
  CreateEducationBuilding,
  CreateEducationCustomFieldDef,
  CreateEducationCustomFieldValue,
  CreateEducationDisciplineIncident,
  CreateEducationEnquiry,
  CreateEducationEquipment,
  CreateEducationEquipmentIssue,
  CreateEducationEvent,
  CreateEducationEventParticipant,
  CreateEducationFeeRefund,
  CreateEducationHealthRecord,
  CreateEducationHealthVisit,
  CreateEducationHostel,
  CreateEducationHostelAllocation,
  CreateEducationHostelBed,
  CreateEducationHostelRoom,
  CreateEducationInventoryItem,
  CreateEducationLab,
  CreateEducationLeaveRequest,
  CreateEducationNotificationRule,
  CreateEducationPurchaseRequest,
  CreateEducationScholarship,
  CreateEducationScholarshipAward,
  CreateEducationStudentLifecycle,
  CreateEducationWorkflowDef,
  UpdateEducationAlumni,
  UpdateEducationAssignment,
  UpdateEducationAssignmentSubmission,
  UpdateEducationBuilding,
  UpdateEducationCustomFieldDef,
  UpdateEducationCustomFieldValue,
  UpdateEducationDisciplineIncident,
  UpdateEducationEnquiry,
  UpdateEducationEquipment,
  UpdateEducationEvent,
  UpdateEducationEventParticipant,
  UpdateEducationHealthRecord,
  UpdateEducationHostel,
  UpdateEducationHostelAllocation,
  UpdateEducationHostelBed,
  UpdateEducationHostelRoom,
  UpdateEducationInventoryItem,
  UpdateEducationLab,
  UpdateEducationLeaveRequest,
  UpdateEducationNotificationRule,
  UpdateEducationPurchaseRequest,
  UpdateEducationScholarship,
  UpdateEducationWorkflowDef,
} from "@platform/contracts";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  educationAdmissions,
  educationAlumni,
  educationAssignmentSubmissions,
  educationAssignments,
  educationAuditLogs,
  educationBooks,
  educationBuildings,
  educationClasses,
  educationCustomFieldDefs,
  educationCustomFieldValues,
  educationDisciplineIncidents,
  educationEnquiries,
  educationEquipment,
  educationEquipmentIssues,
  educationEventParticipants,
  educationEvents,
  educationFeeInvoices,
  educationFeeRefunds,
  educationFeeStructures,
  educationFinanceTxns,
  educationGuardians,
  educationHealthRecords,
  educationHealthVisits,
  educationHostelAllocations,
  educationHostelBeds,
  educationHostelRooms,
  educationHostels,
  educationInventoryItems,
  educationLabs,
  educationLeaveRequests,
  educationNotices,
  educationNotificationRules,
  educationPurchaseRequests,
  educationRooms,
  educationScholarshipAwards,
  educationScholarships,
  educationSections,
  educationStaff,
  educationStudentGuardians,
  educationStudentLifecycle,
  educationStudents,
  educationSubjects,
  educationTeachers,
  educationVehicles,
  educationWorkflowDefs,
  popsBranches,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../drizzle/drizzle.tokens";

type LeaveStatus = "draft" | "pending" | "approved" | "rejected" | "cancelled";

@Injectable()
export class EducationExtraService {
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

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  // ─── Leave Requests ──────────────────────────────────────────────────────

  async listLeaveRequests(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationLeaveRequests)
      .where(
        and(
          eq(educationLeaveRequests.organizationId, organizationId),
          eq(educationLeaveRequests.branchId, branch.id),
        ),
      )
      .orderBy(desc(educationLeaveRequests.createdAt));
    return rows.map((r) => this.mapLeave(r));
  }

  async createLeaveRequest(
    organizationId: string,
    input: CreateEducationLeaveRequest,
    userId?: string,
  ) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationLeaveRequests)
      .values({
        organizationId,
        branchId: branch.id,
        applicantType: input.applicantType,
        applicantId: input.applicantId,
        leaveTypeCode: input.leaveTypeCode,
        startDate: input.startDate,
        endDate: input.endDate,
        days: input.days ?? 1,
        reason: input.reason,
        attachmentUrl: input.attachmentUrl ?? null,
        status: input.status ?? "draft",
        remarks: input.remarks ?? null,
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "leave",
      recordId: row!.id,
    });
    return this.mapLeave(row!);
  }

  async updateLeaveRequest(
    organizationId: string,
    input: UpdateEducationLeaveRequest,
    userId?: string,
  ) {
    const [existing] = await this.db
      .select()
      .from(educationLeaveRequests)
      .where(
        and(
          eq(educationLeaveRequests.id, input.id),
          eq(educationLeaveRequests.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!existing) throw new NotFoundException("Leave request not found");
    if (existing.status !== "draft" && existing.status !== "pending") {
      throw new BadRequestException("Only draft/pending leave can be updated");
    }
    const [row] = await this.db
      .update(educationLeaveRequests)
      .set({
        ...(input.applicantType !== undefined ? { applicantType: input.applicantType } : {}),
        ...(input.applicantId !== undefined ? { applicantId: input.applicantId } : {}),
        ...(input.leaveTypeCode !== undefined ? { leaveTypeCode: input.leaveTypeCode } : {}),
        ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
        ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
        ...(input.days !== undefined ? { days: input.days } : {}),
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.attachmentUrl !== undefined ? { attachmentUrl: input.attachmentUrl ?? null } : {}),
        ...(input.remarks !== undefined ? { remarks: input.remarks ?? null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(educationLeaveRequests.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "leave",
      recordId: input.id,
    });
    return this.mapLeave(row!);
  }

  async submitLeaveRequest(organizationId: string, id: string, userId?: string) {
    return this.transitionLeave(organizationId, id, "pending", userId, ["draft"]);
  }

  async approveLeaveRequest(organizationId: string, id: string, userId?: string) {
    return this.transitionLeave(organizationId, id, "approved", userId, ["pending"]);
  }

  async rejectLeaveRequest(organizationId: string, id: string, userId?: string) {
    return this.transitionLeave(organizationId, id, "rejected", userId, ["pending"]);
  }

  async cancelLeaveRequest(organizationId: string, id: string, userId?: string) {
    return this.transitionLeave(organizationId, id, "cancelled", userId, ["draft", "pending"]);
  }

  private async transitionLeave(
    organizationId: string,
    id: string,
    to: LeaveStatus,
    userId: string | undefined,
    from: LeaveStatus[],
  ) {
    const [existing] = await this.db
      .select()
      .from(educationLeaveRequests)
      .where(
        and(eq(educationLeaveRequests.id, id), eq(educationLeaveRequests.organizationId, organizationId)),
      )
      .limit(1);
    if (!existing) throw new NotFoundException("Leave request not found");
    if (!from.includes(existing.status as LeaveStatus)) {
      throw new BadRequestException(`Cannot transition leave from ${existing.status} to ${to}`);
    }
    const [row] = await this.db
      .update(educationLeaveRequests)
      .set({
        status: to,
        ...(to === "approved" || to === "rejected"
          ? { approvedBy: userId ?? null, approvedAt: new Date() }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(educationLeaveRequests.id, id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: to,
      moduleKey: "leave",
      recordId: id,
    });
    return this.mapLeave(row!);
  }

  private mapLeave(row: typeof educationLeaveRequests.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      applicantType: row.applicantType,
      applicantId: row.applicantId,
      leaveTypeCode: row.leaveTypeCode,
      startDate: row.startDate,
      endDate: row.endDate,
      days: row.days,
      reason: row.reason,
      attachmentUrl: row.attachmentUrl,
      status: row.status,
      approvedBy: row.approvedBy,
      approvedAt: this.iso(row.approvedAt),
      remarks: row.remarks,
      createdAt: this.iso(row.createdAt)!,
      updatedAt: this.iso(row.updatedAt)!,
    };
  }

  // ─── Discipline ──────────────────────────────────────────────────────────

  async listDisciplineIncidents(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationDisciplineIncidents)
      .where(
        and(
          eq(educationDisciplineIncidents.organizationId, organizationId),
          eq(educationDisciplineIncidents.branchId, branch.id),
        ),
      )
      .orderBy(desc(educationDisciplineIncidents.createdAt));
    return rows.map((r) => this.mapDiscipline(r));
  }

  async createDisciplineIncident(
    organizationId: string,
    input: CreateEducationDisciplineIncident,
    userId?: string,
  ) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationDisciplineIncidents)
      .values({
        organizationId,
        branchId: branch.id,
        studentId: input.studentId,
        classId: input.classId ?? null,
        sectionId: input.sectionId ?? null,
        incidentDate: input.incidentDate,
        incidentTypeCode: input.incidentTypeCode,
        description: input.description,
        severityCode: input.severityCode,
        actionCode: input.actionCode ?? null,
        warning: input.warning ?? null,
        responsibleStaffId: input.responsibleStaffId ?? null,
        parentNotified: input.parentNotified ?? false,
        status: input.status ?? "open",
        remarks: input.remarks ?? null,
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "discipline",
      recordId: row!.id,
    });
    return this.mapDiscipline(row!);
  }

  async updateDisciplineIncident(
    organizationId: string,
    input: UpdateEducationDisciplineIncident,
    userId?: string,
  ) {
    const [existing] = await this.db
      .select()
      .from(educationDisciplineIncidents)
      .where(
        and(
          eq(educationDisciplineIncidents.id, input.id),
          eq(educationDisciplineIncidents.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!existing) throw new NotFoundException("Discipline incident not found");
    const [row] = await this.db
      .update(educationDisciplineIncidents)
      .set({
        ...(input.studentId !== undefined ? { studentId: input.studentId } : {}),
        ...(input.classId !== undefined ? { classId: input.classId ?? null } : {}),
        ...(input.sectionId !== undefined ? { sectionId: input.sectionId ?? null } : {}),
        ...(input.incidentDate !== undefined ? { incidentDate: input.incidentDate } : {}),
        ...(input.incidentTypeCode !== undefined ? { incidentTypeCode: input.incidentTypeCode } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.severityCode !== undefined ? { severityCode: input.severityCode } : {}),
        ...(input.actionCode !== undefined ? { actionCode: input.actionCode ?? null } : {}),
        ...(input.warning !== undefined ? { warning: input.warning ?? null } : {}),
        ...(input.responsibleStaffId !== undefined
          ? { responsibleStaffId: input.responsibleStaffId ?? null }
          : {}),
        ...(input.parentNotified !== undefined ? { parentNotified: input.parentNotified } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.remarks !== undefined ? { remarks: input.remarks ?? null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(educationDisciplineIncidents.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "discipline",
      recordId: input.id,
    });
    return this.mapDiscipline(row!);
  }

  private mapDiscipline(row: typeof educationDisciplineIncidents.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      studentId: row.studentId,
      classId: row.classId,
      sectionId: row.sectionId,
      incidentDate: row.incidentDate,
      incidentTypeCode: row.incidentTypeCode,
      description: row.description,
      severityCode: row.severityCode,
      actionCode: row.actionCode,
      warning: row.warning,
      responsibleStaffId: row.responsibleStaffId,
      parentNotified: row.parentNotified,
      status: row.status,
      remarks: row.remarks,
      createdAt: this.iso(row.createdAt)!,
      updatedAt: this.iso(row.updatedAt)!,
    };
  }

  // ─── Student Lifecycle ───────────────────────────────────────────────────

  async listLifecycle(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationStudentLifecycle)
      .where(
        and(
          eq(educationStudentLifecycle.organizationId, organizationId),
          eq(educationStudentLifecycle.branchId, branch.id),
        ),
      )
      .orderBy(desc(educationStudentLifecycle.createdAt));
    return rows.map((r) => this.mapLifecycle(r));
  }

  async promoteStudent(
    organizationId: string,
    input: CreateEducationStudentLifecycle,
    userId?: string,
  ) {
    return this.applyLifecycle(organizationId, { ...input, actionType: "promote" }, userId);
  }

  async bulkPromoteStudents(
    organizationId: string,
    input: BulkPromoteEducationStudents,
    userId?: string,
  ) {
    const results = [];
    for (const studentId of input.studentIds) {
      results.push(
        await this.applyLifecycle(
          organizationId,
          {
            branchCode: input.branchCode,
            studentId,
            actionType: "promote",
            toSessionId: input.toSessionId,
            toClassId: input.toClassId,
            toSectionId: input.toSectionId,
            effectiveDate: input.effectiveDate,
            reason: input.reason,
            notes: input.notes,
            status: "completed",
          },
          userId,
        ),
      );
    }
    return { promoted: results.length, records: results };
  }

  async transferStudent(
    organizationId: string,
    input: CreateEducationStudentLifecycle,
    userId?: string,
  ) {
    return this.applyLifecycle(organizationId, { ...input, actionType: "transfer" }, userId);
  }

  async withdrawStudent(
    organizationId: string,
    input: CreateEducationStudentLifecycle,
    userId?: string,
  ) {
    return this.applyLifecycle(organizationId, { ...input, actionType: "withdraw" }, userId);
  }

  async graduateStudent(
    organizationId: string,
    input: CreateEducationStudentLifecycle,
    userId?: string,
  ) {
    return this.applyLifecycle(organizationId, { ...input, actionType: "graduate" }, userId);
  }

  async archiveStudent(
    organizationId: string,
    input: CreateEducationStudentLifecycle,
    userId?: string,
  ) {
    return this.applyLifecycle(organizationId, { ...input, actionType: "archive" }, userId);
  }

  private async applyLifecycle(
    organizationId: string,
    input: CreateEducationStudentLifecycle,
    userId?: string,
  ) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [student] = await this.db
      .select()
      .from(educationStudents)
      .where(
        and(
          eq(educationStudents.id, input.studentId),
          eq(educationStudents.organizationId, organizationId),
          isNull(educationStudents.deletedAt),
        ),
      )
      .limit(1);
    if (!student) throw new NotFoundException("Student not found");

    const status = input.status ?? "completed";
    const [row] = await this.db
      .insert(educationStudentLifecycle)
      .values({
        organizationId,
        branchId: branch.id,
        studentId: student.id,
        actionType: input.actionType,
        fromSessionId: input.fromSessionId ?? student.sessionId,
        toSessionId: input.toSessionId ?? null,
        fromClassId: input.fromClassId ?? student.classId,
        toClassId: input.toClassId ?? null,
        fromSectionId: input.fromSectionId ?? student.sectionId,
        toSectionId: input.toSectionId ?? null,
        reason: input.reason ?? null,
        status,
        approvedBy: userId ?? null,
        effectiveDate: input.effectiveDate,
        notes: input.notes ?? null,
      })
      .returning();

    if (status === "completed") {
      const patch: Partial<typeof educationStudents.$inferInsert> = { updatedAt: new Date() };
      if (input.actionType === "promote" || input.actionType === "transfer" || input.actionType === "readmit") {
        if (input.toClassId) patch.classId = input.toClassId;
        if (input.toSectionId !== undefined) patch.sectionId = input.toSectionId ?? null;
        if (input.toSessionId) patch.sessionId = input.toSessionId;
        if (input.actionType === "transfer") patch.statusCode = "transferred";
        if (input.actionType === "readmit") patch.statusCode = "active";
      } else if (input.actionType === "withdraw") {
        patch.statusCode = "inactive";
      } else if (input.actionType === "graduate") {
        patch.statusCode = "alumni";
      } else if (input.actionType === "archive") {
        patch.statusCode = "inactive";
        patch.deletedAt = new Date();
      }
      await this.db.update(educationStudents).set(patch).where(eq(educationStudents.id, student.id));
    }

    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: input.actionType,
      moduleKey: "lifecycle",
      recordId: row!.id,
      detail: student.id,
    });
    return this.mapLifecycle(row!);
  }

  private mapLifecycle(row: typeof educationStudentLifecycle.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      studentId: row.studentId,
      actionType: row.actionType,
      fromSessionId: row.fromSessionId,
      toSessionId: row.toSessionId,
      fromClassId: row.fromClassId,
      toClassId: row.toClassId,
      fromSectionId: row.fromSectionId,
      toSectionId: row.toSectionId,
      reason: row.reason,
      status: row.status,
      approvedBy: row.approvedBy,
      effectiveDate: row.effectiveDate,
      notes: row.notes,
      createdAt: this.iso(row.createdAt)!,
      updatedAt: this.iso(row.updatedAt)!,
    };
  }

  // ─── Assignments ─────────────────────────────────────────────────────────

  async listAssignments(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationAssignments)
      .where(
        and(eq(educationAssignments.organizationId, organizationId), eq(educationAssignments.branchId, branch.id)),
      )
      .orderBy(desc(educationAssignments.createdAt));
    return rows.map((r) => this.mapAssignment(r));
  }

  async createAssignment(organizationId: string, input: CreateEducationAssignment, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationAssignments)
      .values({
        organizationId,
        branchId: branch.id,
        title: input.title,
        description: input.description ?? null,
        subjectId: input.subjectId ?? null,
        courseId: input.courseId ?? null,
        classId: input.classId ?? null,
        sectionId: input.sectionId ?? null,
        batchId: input.batchId ?? null,
        teacherId: input.teacherId ?? null,
        dueDate: input.dueDate ?? null,
        status: input.status ?? "draft",
        totalMarks: input.totalMarks ?? null,
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "assignments",
      recordId: row!.id,
    });
    return this.mapAssignment(row!);
  }

  async updateAssignment(organizationId: string, input: UpdateEducationAssignment, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationAssignments)
      .where(and(eq(educationAssignments.id, input.id), eq(educationAssignments.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Assignment not found");
    const [row] = await this.db
      .update(educationAssignments)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.subjectId !== undefined ? { subjectId: input.subjectId ?? null } : {}),
        ...(input.courseId !== undefined ? { courseId: input.courseId ?? null } : {}),
        ...(input.classId !== undefined ? { classId: input.classId ?? null } : {}),
        ...(input.sectionId !== undefined ? { sectionId: input.sectionId ?? null } : {}),
        ...(input.batchId !== undefined ? { batchId: input.batchId ?? null } : {}),
        ...(input.teacherId !== undefined ? { teacherId: input.teacherId ?? null } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.totalMarks !== undefined ? { totalMarks: input.totalMarks ?? null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(educationAssignments.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "assignments",
      recordId: input.id,
    });
    return this.mapAssignment(row!);
  }

  async publishAssignment(organizationId: string, id: string, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationAssignments)
      .where(and(eq(educationAssignments.id, id), eq(educationAssignments.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Assignment not found");
    if (existing.status === "published") return this.mapAssignment(existing);
    const [row] = await this.db
      .update(educationAssignments)
      .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(educationAssignments.id, id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "publish",
      moduleKey: "assignments",
      recordId: id,
    });
    return this.mapAssignment(row!);
  }

  private mapAssignment(row: typeof educationAssignments.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      title: row.title,
      description: row.description,
      subjectId: row.subjectId,
      courseId: row.courseId,
      classId: row.classId,
      sectionId: row.sectionId,
      batchId: row.batchId,
      teacherId: row.teacherId,
      dueDate: row.dueDate,
      status: row.status,
      totalMarks: row.totalMarks,
      publishedAt: this.iso(row.publishedAt),
      createdAt: this.iso(row.createdAt)!,
      updatedAt: this.iso(row.updatedAt)!,
    };
  }

  // ─── Assignment Submissions ──────────────────────────────────────────────

  async listAssignmentSubmissions(organizationId: string, assignmentId?: string, branchCode?: string) {
    if (assignmentId) {
      const [assignment] = await this.db
        .select()
        .from(educationAssignments)
        .where(
          and(eq(educationAssignments.id, assignmentId), eq(educationAssignments.organizationId, organizationId)),
        )
        .limit(1);
      if (!assignment) throw new NotFoundException("Assignment not found");
      const rows = await this.db
        .select()
        .from(educationAssignmentSubmissions)
        .where(eq(educationAssignmentSubmissions.assignmentId, assignmentId))
        .orderBy(desc(educationAssignmentSubmissions.createdAt));
      return rows.map((r) => this.mapSubmission(r));
    }
    if (!branchCode) throw new BadRequestException("assignmentId or branchCode is required");
    const branch = await this.resolveBranch(organizationId, branchCode);
    const assignments = await this.db
      .select({ id: educationAssignments.id })
      .from(educationAssignments)
      .where(
        and(eq(educationAssignments.organizationId, organizationId), eq(educationAssignments.branchId, branch.id)),
      );
    const ids = assignments.map((a) => a.id);
    if (!ids.length) return [];
    const rows = await this.db
      .select()
      .from(educationAssignmentSubmissions)
      .where(inArray(educationAssignmentSubmissions.assignmentId, ids))
      .orderBy(desc(educationAssignmentSubmissions.createdAt));
    return rows.map((r) => this.mapSubmission(r));
  }

  async createAssignmentSubmission(
    organizationId: string,
    input: CreateEducationAssignmentSubmission,
    userId?: string,
  ) {
    const [assignment] = await this.db
      .select()
      .from(educationAssignments)
      .where(
        and(eq(educationAssignments.id, input.assignmentId), eq(educationAssignments.organizationId, organizationId)),
      )
      .limit(1);
    if (!assignment) throw new NotFoundException("Assignment not found");
    const [row] = await this.db
      .insert(educationAssignmentSubmissions)
      .values({
        assignmentId: input.assignmentId,
        studentId: input.studentId,
        content: input.content ?? null,
        attachmentUrl: input.attachmentUrl ?? null,
        marks: input.marks ?? null,
        remarks: input.remarks ?? null,
        status: input.status ?? "pending",
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: assignment.branchId,
      userId,
      action: "create",
      moduleKey: "assignments",
      recordId: row!.id,
      detail: `submission:${input.assignmentId}`,
    });
    return this.mapSubmission(row!);
  }

  async updateAssignmentSubmission(
    organizationId: string,
    input: UpdateEducationAssignmentSubmission,
    userId?: string,
  ) {
    const [existing] = await this.db
      .select()
      .from(educationAssignmentSubmissions)
      .where(eq(educationAssignmentSubmissions.id, input.id))
      .limit(1);
    if (!existing) throw new NotFoundException("Submission not found");
    const [assignment] = await this.db
      .select()
      .from(educationAssignments)
      .where(
        and(
          eq(educationAssignments.id, existing.assignmentId),
          eq(educationAssignments.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!assignment) throw new NotFoundException("Assignment not found");
    const [row] = await this.db
      .update(educationAssignmentSubmissions)
      .set({
        ...(input.content !== undefined ? { content: input.content ?? null } : {}),
        ...(input.attachmentUrl !== undefined ? { attachmentUrl: input.attachmentUrl ?? null } : {}),
        ...(input.marks !== undefined ? { marks: input.marks ?? null } : {}),
        ...(input.remarks !== undefined ? { remarks: input.remarks ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedAt: new Date(),
      })
      .where(eq(educationAssignmentSubmissions.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: assignment.branchId,
      userId,
      action: "update",
      moduleKey: "assignments",
      recordId: input.id,
    });
    return this.mapSubmission(row!);
  }

  async submitAssignmentSubmission(organizationId: string, id: string, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationAssignmentSubmissions)
      .where(eq(educationAssignmentSubmissions.id, id))
      .limit(1);
    if (!existing) throw new NotFoundException("Submission not found");
    const [assignment] = await this.db
      .select()
      .from(educationAssignments)
      .where(
        and(
          eq(educationAssignments.id, existing.assignmentId),
          eq(educationAssignments.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!assignment) throw new NotFoundException("Assignment not found");
    const late =
      assignment.dueDate && assignment.dueDate < this.today() ? ("late" as const) : ("submitted" as const);
    const [row] = await this.db
      .update(educationAssignmentSubmissions)
      .set({ status: late, submittedAt: new Date(), updatedAt: new Date() })
      .where(eq(educationAssignmentSubmissions.id, id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: assignment.branchId,
      userId,
      action: "submit",
      moduleKey: "assignments",
      recordId: id,
    });
    return this.mapSubmission(row!);
  }

  async reviewAssignmentSubmission(
    organizationId: string,
    id: string,
    body: { marks?: number; remarks?: string },
    userId?: string,
  ) {
    const [existing] = await this.db
      .select()
      .from(educationAssignmentSubmissions)
      .where(eq(educationAssignmentSubmissions.id, id))
      .limit(1);
    if (!existing) throw new NotFoundException("Submission not found");
    const [assignment] = await this.db
      .select()
      .from(educationAssignments)
      .where(
        and(
          eq(educationAssignments.id, existing.assignmentId),
          eq(educationAssignments.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!assignment) throw new NotFoundException("Assignment not found");
    const [row] = await this.db
      .update(educationAssignmentSubmissions)
      .set({
        status: "reviewed",
        ...(body.marks !== undefined ? { marks: body.marks } : {}),
        ...(body.remarks !== undefined ? { remarks: body.remarks } : {}),
        updatedAt: new Date(),
      })
      .where(eq(educationAssignmentSubmissions.id, id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: assignment.branchId,
      userId,
      action: "review",
      moduleKey: "assignments",
      recordId: id,
    });
    return this.mapSubmission(row!);
  }

  private mapSubmission(row: typeof educationAssignmentSubmissions.$inferSelect) {
    return {
      id: row.id,
      assignmentId: row.assignmentId,
      studentId: row.studentId,
      submittedAt: this.iso(row.submittedAt),
      content: row.content,
      attachmentUrl: row.attachmentUrl,
      marks: row.marks,
      remarks: row.remarks,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
      updatedAt: this.iso(row.updatedAt)!,
    };
  }

  // ─── Scholarships ────────────────────────────────────────────────────────

  async listScholarships(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationScholarships)
      .where(
        and(eq(educationScholarships.organizationId, organizationId), eq(educationScholarships.branchId, branch.id)),
      )
      .orderBy(desc(educationScholarships.createdAt));
    return rows.map((r) => this.mapScholarship(r));
  }

  async createScholarship(organizationId: string, input: CreateEducationScholarship, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationScholarships)
      .values({
        organizationId,
        branchId: branch.id,
        name: input.name,
        scholarshipTypeCode: input.scholarshipTypeCode,
        discountType: input.discountType,
        discountValue: input.discountValue,
        status: input.status ?? "draft",
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "scholarships",
      recordId: row!.id,
    });
    return this.mapScholarship(row!);
  }

  async updateScholarship(organizationId: string, input: UpdateEducationScholarship, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationScholarships)
      .where(and(eq(educationScholarships.id, input.id), eq(educationScholarships.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Scholarship not found");
    const [row] = await this.db
      .update(educationScholarships)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.scholarshipTypeCode !== undefined
          ? { scholarshipTypeCode: input.scholarshipTypeCode }
          : {}),
        ...(input.discountType !== undefined ? { discountType: input.discountType } : {}),
        ...(input.discountValue !== undefined ? { discountValue: input.discountValue } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.startDate !== undefined ? { startDate: input.startDate ?? null } : {}),
        ...(input.endDate !== undefined ? { endDate: input.endDate ?? null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(educationScholarships.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "scholarships",
      recordId: input.id,
    });
    return this.mapScholarship(row!);
  }

  async approveScholarship(organizationId: string, id: string, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationScholarships)
      .where(and(eq(educationScholarships.id, id), eq(educationScholarships.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Scholarship not found");
    const [row] = await this.db
      .update(educationScholarships)
      .set({ status: "approved", updatedAt: new Date() })
      .where(eq(educationScholarships.id, id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "approve",
      moduleKey: "scholarships",
      recordId: id,
    });
    return this.mapScholarship(row!);
  }

  private mapScholarship(row: typeof educationScholarships.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      name: row.name,
      scholarshipTypeCode: row.scholarshipTypeCode,
      discountType: row.discountType,
      discountValue: row.discountValue,
      status: row.status,
      startDate: row.startDate,
      endDate: row.endDate,
      createdAt: this.iso(row.createdAt)!,
      updatedAt: this.iso(row.updatedAt)!,
    };
  }

  // ─── Scholarship Awards ──────────────────────────────────────────────────

  async listScholarshipAwards(organizationId: string, scholarshipId?: string, branchCode?: string) {
    if (scholarshipId) {
      const [sch] = await this.db
        .select()
        .from(educationScholarships)
        .where(
          and(eq(educationScholarships.id, scholarshipId), eq(educationScholarships.organizationId, organizationId)),
        )
        .limit(1);
      if (!sch) throw new NotFoundException("Scholarship not found");
      const rows = await this.db
        .select()
        .from(educationScholarshipAwards)
        .where(eq(educationScholarshipAwards.scholarshipId, scholarshipId))
        .orderBy(desc(educationScholarshipAwards.createdAt));
      return rows.map((r) => this.mapAward(r));
    }
    if (!branchCode) throw new BadRequestException("scholarshipId or branchCode is required");
    const branch = await this.resolveBranch(organizationId, branchCode);
    const scholarships = await this.db
      .select({ id: educationScholarships.id })
      .from(educationScholarships)
      .where(
        and(eq(educationScholarships.organizationId, organizationId), eq(educationScholarships.branchId, branch.id)),
      );
    const ids = scholarships.map((s) => s.id);
    if (!ids.length) return [];
    const rows = await this.db
      .select()
      .from(educationScholarshipAwards)
      .where(inArray(educationScholarshipAwards.scholarshipId, ids))
      .orderBy(desc(educationScholarshipAwards.createdAt));
    return rows.map((r) => this.mapAward(r));
  }

  async assignScholarshipAward(
    organizationId: string,
    input: CreateEducationScholarshipAward,
    userId?: string,
  ) {
    const [sch] = await this.db
      .select()
      .from(educationScholarships)
      .where(
        and(eq(educationScholarships.id, input.scholarshipId), eq(educationScholarships.organizationId, organizationId)),
      )
      .limit(1);
    if (!sch) throw new NotFoundException("Scholarship not found");

    let amountPkr = input.amountPkr;
    if (input.invoiceId) {
      const [invoice] = await this.db
        .select()
        .from(educationFeeInvoices)
        .where(
          and(
            eq(educationFeeInvoices.id, input.invoiceId),
            eq(educationFeeInvoices.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!invoice) throw new NotFoundException("Invoice not found");
      let discount = amountPkr;
      if (sch.discountType === "percent") {
        discount = Math.round((invoice.amountPkr * sch.discountValue) / 100);
      } else if (sch.discountType === "full_waiver") {
        discount = Math.max(0, invoice.amountPkr - invoice.paidPkr);
      } else if (sch.discountType === "fixed") {
        discount = sch.discountValue;
      }
      amountPkr = discount;
      const newAmount = Math.max(0, invoice.amountPkr - discount);
      const newStatus =
        invoice.paidPkr >= newAmount ? "paid" : invoice.paidPkr > 0 ? "partial" : invoice.status;
      await this.db
        .update(educationFeeInvoices)
        .set({ amountPkr: newAmount, status: newStatus })
        .where(eq(educationFeeInvoices.id, invoice.id));
    }

    const [row] = await this.db
      .insert(educationScholarshipAwards)
      .values({
        scholarshipId: input.scholarshipId,
        studentId: input.studentId,
        invoiceId: input.invoiceId ?? null,
        amountPkr,
        status: input.status ?? "active",
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: sch.branchId,
      userId,
      action: "award",
      moduleKey: "scholarships",
      recordId: row!.id,
      detail: input.studentId,
    });
    return this.mapAward(row!);
  }

  private mapAward(row: typeof educationScholarshipAwards.$inferSelect) {
    return {
      id: row.id,
      scholarshipId: row.scholarshipId,
      studentId: row.studentId,
      invoiceId: row.invoiceId,
      amountPkr: row.amountPkr,
      status: row.status,
      awardedAt: this.iso(row.awardedAt)!,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  // ─── Fee Refunds ─────────────────────────────────────────────────────────

  async listFeeRefunds(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationFeeRefunds)
      .where(
        and(eq(educationFeeRefunds.organizationId, organizationId), eq(educationFeeRefunds.branchId, branch.id)),
      )
      .orderBy(desc(educationFeeRefunds.createdAt));
    return rows.map((r) => this.mapRefund(r));
  }

  async requestFeeRefund(organizationId: string, input: CreateEducationFeeRefund, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationFeeRefunds)
      .values({
        organizationId,
        branchId: branch.id,
        studentId: input.studentId,
        invoiceId: input.invoiceId ?? null,
        paymentId: input.paymentId ?? null,
        amountPkr: input.amountPkr,
        reason: input.reason,
        paymentMethodCode: input.paymentMethodCode ?? null,
        status: input.status ?? "requested",
        remarks: input.remarks ?? null,
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "request",
      moduleKey: "refunds",
      recordId: row!.id,
    });
    return this.mapRefund(row!);
  }

  async approveFeeRefund(organizationId: string, id: string, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationFeeRefunds)
      .where(and(eq(educationFeeRefunds.id, id), eq(educationFeeRefunds.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Fee refund not found");
    if (existing.status !== "requested") {
      throw new BadRequestException("Only requested refunds can be approved");
    }
    const [row] = await this.db
      .update(educationFeeRefunds)
      .set({ status: "approved", approvedBy: userId ?? null, updatedAt: new Date() })
      .where(eq(educationFeeRefunds.id, id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "approve",
      moduleKey: "refunds",
      recordId: id,
    });
    return this.mapRefund(row!);
  }

  async processFeeRefund(organizationId: string, id: string, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationFeeRefunds)
      .where(and(eq(educationFeeRefunds.id, id), eq(educationFeeRefunds.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Fee refund not found");
    if (existing.status !== "approved") {
      throw new BadRequestException("Only approved refunds can be processed");
    }
    const [txn] = await this.db
      .insert(educationFinanceTxns)
      .values({
        organizationId,
        branchId: existing.branchId,
        txnType: "refund",
        amountPkr: existing.amountPkr,
        refModule: "refunds",
        refId: existing.id,
        title: `Fee refund ${existing.id.slice(0, 8)}`,
        txnDate: this.today(),
        status: "posted",
      })
      .returning();
    const [row] = await this.db
      .update(educationFeeRefunds)
      .set({
        status: "processed",
        processedBy: userId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(educationFeeRefunds.id, id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "process",
      moduleKey: "refunds",
      recordId: id,
      detail: txn!.id,
    });
    return this.mapRefund(row!);
  }

  private mapRefund(row: typeof educationFeeRefunds.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      studentId: row.studentId,
      invoiceId: row.invoiceId,
      paymentId: row.paymentId,
      amountPkr: row.amountPkr,
      reason: row.reason,
      paymentMethodCode: row.paymentMethodCode,
      status: row.status,
      approvedBy: row.approvedBy,
      processedBy: row.processedBy,
      remarks: row.remarks,
      createdAt: this.iso(row.createdAt)!,
      updatedAt: this.iso(row.updatedAt)!,
    };
  }

  // ─── Buildings ───────────────────────────────────────────────────────────

  async listBuildings(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationBuildings)
      .where(and(eq(educationBuildings.organizationId, organizationId), eq(educationBuildings.branchId, branch.id)))
      .orderBy(asc(educationBuildings.name));
    return rows.map((r) => this.mapBuilding(r));
  }

  async createBuilding(organizationId: string, input: CreateEducationBuilding, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationBuildings)
      .values({
        organizationId,
        branchId: branch.id,
        code: input.code,
        name: input.name,
        floors: input.floors ?? null,
        status: input.status ?? "active",
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "facilities",
      recordId: row!.id,
    });
    return this.mapBuilding(row!);
  }

  async updateBuilding(organizationId: string, input: UpdateEducationBuilding, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationBuildings)
      .where(and(eq(educationBuildings.id, input.id), eq(educationBuildings.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Building not found");
    const [row] = await this.db
      .update(educationBuildings)
      .set({
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.floors !== undefined ? { floors: input.floors ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      })
      .where(eq(educationBuildings.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "facilities",
      recordId: input.id,
    });
    return this.mapBuilding(row!);
  }

  private mapBuilding(row: typeof educationBuildings.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      code: row.code,
      name: row.name,
      floors: row.floors,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  // ─── Labs ────────────────────────────────────────────────────────────────

  async listLabs(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationLabs)
      .where(and(eq(educationLabs.organizationId, organizationId), eq(educationLabs.branchId, branch.id)))
      .orderBy(asc(educationLabs.name));
    return rows.map((r) => this.mapLab(r));
  }

  async createLab(organizationId: string, input: CreateEducationLab, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationLabs)
      .values({
        organizationId,
        branchId: branch.id,
        name: input.name,
        code: input.code,
        roomId: input.roomId ?? null,
        status: input.status ?? "active",
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "labs",
      recordId: row!.id,
    });
    return this.mapLab(row!);
  }

  async updateLab(organizationId: string, input: UpdateEducationLab, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationLabs)
      .where(and(eq(educationLabs.id, input.id), eq(educationLabs.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Lab not found");
    const [row] = await this.db
      .update(educationLabs)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.roomId !== undefined ? { roomId: input.roomId ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      })
      .where(eq(educationLabs.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "labs",
      recordId: input.id,
    });
    return this.mapLab(row!);
  }

  private mapLab(row: typeof educationLabs.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      name: row.name,
      code: row.code,
      roomId: row.roomId,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  // ─── Equipment ───────────────────────────────────────────────────────────

  async listEquipment(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationEquipment)
      .where(and(eq(educationEquipment.organizationId, organizationId), eq(educationEquipment.branchId, branch.id)))
      .orderBy(asc(educationEquipment.name));
    return rows.map((r) => this.mapEquipment(r));
  }

  async createEquipment(organizationId: string, input: CreateEducationEquipment, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationEquipment)
      .values({
        organizationId,
        branchId: branch.id,
        labId: input.labId ?? null,
        equipmentNumber: input.equipmentNumber,
        name: input.name,
        categoryCode: input.categoryCode,
        serialNumber: input.serialNumber ?? null,
        purchaseDate: input.purchaseDate ?? null,
        purchaseCostPkr: input.purchaseCostPkr ?? null,
        conditionCode: input.conditionCode ?? null,
        status: input.status ?? "available",
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "equipment",
      recordId: row!.id,
    });
    return this.mapEquipment(row!);
  }

  async updateEquipment(organizationId: string, input: UpdateEducationEquipment, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationEquipment)
      .where(and(eq(educationEquipment.id, input.id), eq(educationEquipment.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Equipment not found");
    const [row] = await this.db
      .update(educationEquipment)
      .set({
        ...(input.labId !== undefined ? { labId: input.labId ?? null } : {}),
        ...(input.equipmentNumber !== undefined ? { equipmentNumber: input.equipmentNumber } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.categoryCode !== undefined ? { categoryCode: input.categoryCode } : {}),
        ...(input.serialNumber !== undefined ? { serialNumber: input.serialNumber ?? null } : {}),
        ...(input.purchaseDate !== undefined ? { purchaseDate: input.purchaseDate ?? null } : {}),
        ...(input.purchaseCostPkr !== undefined ? { purchaseCostPkr: input.purchaseCostPkr ?? null } : {}),
        ...(input.conditionCode !== undefined ? { conditionCode: input.conditionCode ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedAt: new Date(),
      })
      .where(eq(educationEquipment.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "equipment",
      recordId: input.id,
    });
    return this.mapEquipment(row!);
  }

  private mapEquipment(row: typeof educationEquipment.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      labId: row.labId,
      equipmentNumber: row.equipmentNumber,
      name: row.name,
      categoryCode: row.categoryCode,
      serialNumber: row.serialNumber,
      purchaseDate: row.purchaseDate,
      purchaseCostPkr: row.purchaseCostPkr,
      conditionCode: row.conditionCode,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
      updatedAt: this.iso(row.updatedAt)!,
    };
  }

  // ─── Equipment Issues ────────────────────────────────────────────────────

  async listEquipmentIssues(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const equipment = await this.db
      .select({ id: educationEquipment.id })
      .from(educationEquipment)
      .where(and(eq(educationEquipment.organizationId, organizationId), eq(educationEquipment.branchId, branch.id)));
    const ids = equipment.map((e) => e.id);
    if (!ids.length) return [];
    const rows = await this.db
      .select()
      .from(educationEquipmentIssues)
      .where(inArray(educationEquipmentIssues.equipmentId, ids))
      .orderBy(desc(educationEquipmentIssues.createdAt));
    return rows.map((r) => this.mapEquipmentIssue(r));
  }

  async issueEquipment(organizationId: string, input: CreateEducationEquipmentIssue, userId?: string) {
    const [eqRow] = await this.db
      .select()
      .from(educationEquipment)
      .where(and(eq(educationEquipment.id, input.equipmentId), eq(educationEquipment.organizationId, organizationId)))
      .limit(1);
    if (!eqRow) throw new NotFoundException("Equipment not found");
    if (eqRow.status !== "available") throw new BadRequestException("Equipment is not available");
    const [row] = await this.db
      .insert(educationEquipmentIssues)
      .values({
        equipmentId: input.equipmentId,
        issuedToType: input.issuedToType,
        issuedToId: input.issuedToId,
        notes: input.notes ?? null,
        status: "issued",
      })
      .returning();
    await this.db
      .update(educationEquipment)
      .set({ status: "issued", updatedAt: new Date() })
      .where(eq(educationEquipment.id, input.equipmentId));
    await this.writeAudit({
      organizationId,
      branchId: eqRow.branchId,
      userId,
      action: "issue",
      moduleKey: "equipment",
      recordId: row!.id,
    });
    return this.mapEquipmentIssue(row!);
  }

  async returnEquipment(organizationId: string, issueId: string, userId?: string) {
    const [issue] = await this.db
      .select()
      .from(educationEquipmentIssues)
      .where(eq(educationEquipmentIssues.id, issueId))
      .limit(1);
    if (!issue) throw new NotFoundException("Equipment issue not found");
    if (issue.status !== "issued") throw new BadRequestException("Issue is not active");
    const [eqRow] = await this.db
      .select()
      .from(educationEquipment)
      .where(
        and(eq(educationEquipment.id, issue.equipmentId), eq(educationEquipment.organizationId, organizationId)),
      )
      .limit(1);
    if (!eqRow) throw new NotFoundException("Equipment not found");
    const [row] = await this.db
      .update(educationEquipmentIssues)
      .set({ status: "returned", returnedAt: new Date() })
      .where(eq(educationEquipmentIssues.id, issueId))
      .returning();
    await this.db
      .update(educationEquipment)
      .set({ status: "available", updatedAt: new Date() })
      .where(eq(educationEquipment.id, issue.equipmentId));
    await this.writeAudit({
      organizationId,
      branchId: eqRow.branchId,
      userId,
      action: "return",
      moduleKey: "equipment",
      recordId: issueId,
    });
    return this.mapEquipmentIssue(row!);
  }

  private mapEquipmentIssue(row: typeof educationEquipmentIssues.$inferSelect) {
    return {
      id: row.id,
      equipmentId: row.equipmentId,
      issuedToType: row.issuedToType,
      issuedToId: row.issuedToId,
      issuedAt: this.iso(row.issuedAt)!,
      returnedAt: this.iso(row.returnedAt),
      notes: row.notes,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  // ─── Inventory Items ─────────────────────────────────────────────────────

  async listInventoryItems(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationInventoryItems)
      .where(
        and(
          eq(educationInventoryItems.organizationId, organizationId),
          eq(educationInventoryItems.branchId, branch.id),
        ),
      )
      .orderBy(asc(educationInventoryItems.name));
    return rows.map((r) => this.mapInventoryItem(r));
  }

  async createInventoryItem(
    organizationId: string,
    input: CreateEducationInventoryItem,
    userId?: string,
  ) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationInventoryItems)
      .values({
        organizationId,
        branchId: branch.id,
        sku: input.sku,
        name: input.name,
        categoryCode: input.categoryCode,
        qtyOnHand: input.qtyOnHand ?? 0,
        reorderLevel: input.reorderLevel ?? 0,
        unit: input.unit,
        status: input.status ?? "active",
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "inventory",
      recordId: row!.id,
    });
    return this.mapInventoryItem(row!);
  }

  async updateInventoryItem(
    organizationId: string,
    input: UpdateEducationInventoryItem,
    userId?: string,
  ) {
    const [existing] = await this.db
      .select()
      .from(educationInventoryItems)
      .where(
        and(eq(educationInventoryItems.id, input.id), eq(educationInventoryItems.organizationId, organizationId)),
      )
      .limit(1);
    if (!existing) throw new NotFoundException("Inventory item not found");
    const [row] = await this.db
      .update(educationInventoryItems)
      .set({
        ...(input.sku !== undefined ? { sku: input.sku } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.categoryCode !== undefined ? { categoryCode: input.categoryCode } : {}),
        ...(input.qtyOnHand !== undefined ? { qtyOnHand: input.qtyOnHand } : {}),
        ...(input.reorderLevel !== undefined ? { reorderLevel: input.reorderLevel } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedAt: new Date(),
      })
      .where(eq(educationInventoryItems.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "inventory",
      recordId: input.id,
    });
    return this.mapInventoryItem(row!);
  }

  private mapInventoryItem(row: typeof educationInventoryItems.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      sku: row.sku,
      name: row.name,
      categoryCode: row.categoryCode,
      qtyOnHand: row.qtyOnHand,
      reorderLevel: row.reorderLevel,
      unit: row.unit,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
      updatedAt: this.iso(row.updatedAt)!,
    };
  }

  // ─── Purchase Requests ───────────────────────────────────────────────────

  async listPurchaseRequests(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationPurchaseRequests)
      .where(
        and(
          eq(educationPurchaseRequests.organizationId, organizationId),
          eq(educationPurchaseRequests.branchId, branch.id),
        ),
      )
      .orderBy(desc(educationPurchaseRequests.createdAt));
    return rows.map((r) => this.mapPurchaseRequest(r));
  }

  async createPurchaseRequest(
    organizationId: string,
    input: CreateEducationPurchaseRequest,
    userId?: string,
  ) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationPurchaseRequests)
      .values({
        organizationId,
        branchId: branch.id,
        title: input.title,
        status: input.status ?? "requested",
        totalPkr: input.totalPkr ?? 0,
        notes: input.notes ?? null,
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "inventory",
      recordId: row!.id,
    });
    return this.mapPurchaseRequest(row!);
  }

  async updatePurchaseRequest(
    organizationId: string,
    input: UpdateEducationPurchaseRequest,
    userId?: string,
  ) {
    const [existing] = await this.db
      .select()
      .from(educationPurchaseRequests)
      .where(
        and(
          eq(educationPurchaseRequests.id, input.id),
          eq(educationPurchaseRequests.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!existing) throw new NotFoundException("Purchase request not found");
    const [row] = await this.db
      .update(educationPurchaseRequests)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.totalPkr !== undefined ? { totalPkr: input.totalPkr } : {}),
        ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(educationPurchaseRequests.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "inventory",
      recordId: input.id,
    });
    return this.mapPurchaseRequest(row!);
  }

  private mapPurchaseRequest(row: typeof educationPurchaseRequests.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      title: row.title,
      status: row.status,
      totalPkr: row.totalPkr,
      notes: row.notes,
      createdAt: this.iso(row.createdAt)!,
      updatedAt: this.iso(row.updatedAt)!,
    };
  }

  // ─── Enquiries ───────────────────────────────────────────────────────────

  async listEnquiries(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationEnquiries)
      .where(and(eq(educationEnquiries.organizationId, organizationId), eq(educationEnquiries.branchId, branch.id)))
      .orderBy(desc(educationEnquiries.createdAt));
    return rows.map((r) => this.mapEnquiry(r));
  }

  async createEnquiry(organizationId: string, input: CreateEducationEnquiry, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationEnquiries)
      .values({
        organizationId,
        branchId: branch.id,
        name: input.name,
        phone: input.phone ?? null,
        email: input.email || null,
        interestedProgram: input.interestedProgram ?? null,
        interestedClassId: input.interestedClassId ?? null,
        sourceCode: input.sourceCode ?? null,
        status: input.status ?? "new",
        assignedStaffId: input.assignedStaffId ?? null,
        followUpDate: input.followUpDate ?? null,
        remarks: input.remarks ?? null,
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "crm",
      recordId: row!.id,
    });
    return this.mapEnquiry(row!);
  }

  async updateEnquiry(organizationId: string, input: UpdateEducationEnquiry, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationEnquiries)
      .where(and(eq(educationEnquiries.id, input.id), eq(educationEnquiries.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Enquiry not found");
    const [row] = await this.db
      .update(educationEnquiries)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.phone !== undefined ? { phone: input.phone ?? null } : {}),
        ...(input.email !== undefined ? { email: input.email || null } : {}),
        ...(input.interestedProgram !== undefined
          ? { interestedProgram: input.interestedProgram ?? null }
          : {}),
        ...(input.interestedClassId !== undefined
          ? { interestedClassId: input.interestedClassId ?? null }
          : {}),
        ...(input.sourceCode !== undefined ? { sourceCode: input.sourceCode ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.assignedStaffId !== undefined ? { assignedStaffId: input.assignedStaffId ?? null } : {}),
        ...(input.followUpDate !== undefined ? { followUpDate: input.followUpDate ?? null } : {}),
        ...(input.remarks !== undefined ? { remarks: input.remarks ?? null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(educationEnquiries.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "crm",
      recordId: input.id,
    });
    return this.mapEnquiry(row!);
  }

  async convertEnquiryToAdmission(organizationId: string, id: string, userId?: string) {
    const [enquiry] = await this.db
      .select()
      .from(educationEnquiries)
      .where(and(eq(educationEnquiries.id, id), eq(educationEnquiries.organizationId, organizationId)))
      .limit(1);
    if (!enquiry) throw new NotFoundException("Enquiry not found");
    if (enquiry.convertedAdmissionId) {
      throw new BadRequestException("Enquiry already converted");
    }
    const applicationNumber = this.nextSeq(enquiry.branchId, "ADM");
    const [admission] = await this.db
      .insert(educationAdmissions)
      .values({
        organizationId,
        branchId: enquiry.branchId,
        applicationNumber,
        applicantName: enquiry.name,
        phone: enquiry.phone,
        email: enquiry.email,
        admissionTypeCode: "new",
        statusCode: "application",
        classId: enquiry.interestedClassId,
        notes: enquiry.remarks,
      })
      .returning();
    const [row] = await this.db
      .update(educationEnquiries)
      .set({
        status: "converted",
        convertedAdmissionId: admission!.id,
        updatedAt: new Date(),
      })
      .where(eq(educationEnquiries.id, id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: enquiry.branchId,
      userId,
      action: "convert",
      moduleKey: "crm",
      recordId: id,
      detail: admission!.id,
    });
    return { enquiry: this.mapEnquiry(row!), admission };
  }

  private mapEnquiry(row: typeof educationEnquiries.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      name: row.name,
      phone: row.phone,
      email: row.email,
      interestedProgram: row.interestedProgram,
      interestedClassId: row.interestedClassId,
      sourceCode: row.sourceCode,
      status: row.status,
      assignedStaffId: row.assignedStaffId,
      followUpDate: row.followUpDate,
      remarks: row.remarks,
      convertedAdmissionId: row.convertedAdmissionId,
      createdAt: this.iso(row.createdAt)!,
      updatedAt: this.iso(row.updatedAt)!,
    };
  }

  // ─── Events ──────────────────────────────────────────────────────────────

  async listEvents(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationEvents)
      .where(and(eq(educationEvents.organizationId, organizationId), eq(educationEvents.branchId, branch.id)))
      .orderBy(desc(educationEvents.startDate));
    return rows.map((r) => this.mapEvent(r));
  }

  async createEvent(organizationId: string, input: CreateEducationEvent, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationEvents)
      .values({
        organizationId,
        branchId: branch.id,
        title: input.title,
        eventTypeCode: input.eventTypeCode,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        audienceCode: input.audienceCode ?? null,
        status: input.status ?? "draft",
        description: input.description ?? null,
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "events",
      recordId: row!.id,
    });
    return this.mapEvent(row!);
  }

  async updateEvent(organizationId: string, input: UpdateEducationEvent, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationEvents)
      .where(and(eq(educationEvents.id, input.id), eq(educationEvents.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Event not found");
    const [row] = await this.db
      .update(educationEvents)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.eventTypeCode !== undefined ? { eventTypeCode: input.eventTypeCode } : {}),
        ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
        ...(input.endDate !== undefined ? { endDate: input.endDate ?? null } : {}),
        ...(input.audienceCode !== undefined ? { audienceCode: input.audienceCode ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(educationEvents.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "events",
      recordId: input.id,
    });
    return this.mapEvent(row!);
  }

  private mapEvent(row: typeof educationEvents.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      title: row.title,
      eventTypeCode: row.eventTypeCode,
      startDate: row.startDate,
      endDate: row.endDate,
      audienceCode: row.audienceCode,
      status: row.status,
      description: row.description,
      createdAt: this.iso(row.createdAt)!,
      updatedAt: this.iso(row.updatedAt)!,
    };
  }

  // ─── Event Participants ──────────────────────────────────────────────────

  async listEventParticipants(organizationId: string, eventId: string) {
    const [event] = await this.db
      .select()
      .from(educationEvents)
      .where(and(eq(educationEvents.id, eventId), eq(educationEvents.organizationId, organizationId)))
      .limit(1);
    if (!event) throw new NotFoundException("Event not found");
    const rows = await this.db
      .select()
      .from(educationEventParticipants)
      .where(eq(educationEventParticipants.eventId, eventId))
      .orderBy(desc(educationEventParticipants.createdAt));
    return rows.map((r) => this.mapEventParticipant(r));
  }

  async createEventParticipant(
    organizationId: string,
    input: CreateEducationEventParticipant,
    userId?: string,
  ) {
    const [event] = await this.db
      .select()
      .from(educationEvents)
      .where(and(eq(educationEvents.id, input.eventId), eq(educationEvents.organizationId, organizationId)))
      .limit(1);
    if (!event) throw new NotFoundException("Event not found");
    const [row] = await this.db
      .insert(educationEventParticipants)
      .values({
        eventId: input.eventId,
        personType: input.personType,
        personId: input.personId,
        status: input.status ?? "registered",
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: event.branchId,
      userId,
      action: "add_participant",
      moduleKey: "events",
      recordId: row!.id,
    });
    return this.mapEventParticipant(row!);
  }

  async updateEventParticipant(
    organizationId: string,
    input: UpdateEducationEventParticipant,
    userId?: string,
  ) {
    const [existing] = await this.db
      .select()
      .from(educationEventParticipants)
      .where(eq(educationEventParticipants.id, input.id))
      .limit(1);
    if (!existing) throw new NotFoundException("Event participant not found");
    const [event] = await this.db
      .select()
      .from(educationEvents)
      .where(
        and(eq(educationEvents.id, existing.eventId), eq(educationEvents.organizationId, organizationId)),
      )
      .limit(1);
    if (!event) throw new NotFoundException("Event not found");
    const [row] = await this.db
      .update(educationEventParticipants)
      .set({
        ...(input.personType !== undefined ? { personType: input.personType } : {}),
        ...(input.personId !== undefined ? { personId: input.personId } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      })
      .where(eq(educationEventParticipants.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: event.branchId,
      userId,
      action: "update_participant",
      moduleKey: "events",
      recordId: input.id,
    });
    return this.mapEventParticipant(row!);
  }

  private mapEventParticipant(row: typeof educationEventParticipants.$inferSelect) {
    return {
      id: row.id,
      eventId: row.eventId,
      personType: row.personType,
      personId: row.personId,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  // ─── Alumni ──────────────────────────────────────────────────────────────

  async listAlumni(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationAlumni)
      .where(and(eq(educationAlumni.organizationId, organizationId), eq(educationAlumni.branchId, branch.id)))
      .orderBy(desc(educationAlumni.createdAt));
    return rows.map((r) => this.mapAlumni(r));
  }

  async createAlumni(organizationId: string, input: CreateEducationAlumni, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationAlumni)
      .values({
        organizationId,
        branchId: branch.id,
        studentId: input.studentId ?? null,
        fullName: input.fullName,
        graduationYear: input.graduationYear ?? null,
        programOrClass: input.programOrClass ?? null,
        phone: input.phone ?? null,
        email: input.email || null,
        company: input.company ?? null,
        position: input.position ?? null,
        location: input.location ?? null,
        achievements: input.achievements ?? null,
        status: input.status ?? "active",
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "alumni",
      recordId: row!.id,
    });
    return this.mapAlumni(row!);
  }

  async updateAlumni(organizationId: string, input: UpdateEducationAlumni, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationAlumni)
      .where(and(eq(educationAlumni.id, input.id), eq(educationAlumni.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Alumni not found");
    const [row] = await this.db
      .update(educationAlumni)
      .set({
        ...(input.studentId !== undefined ? { studentId: input.studentId ?? null } : {}),
        ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
        ...(input.graduationYear !== undefined ? { graduationYear: input.graduationYear ?? null } : {}),
        ...(input.programOrClass !== undefined ? { programOrClass: input.programOrClass ?? null } : {}),
        ...(input.phone !== undefined ? { phone: input.phone ?? null } : {}),
        ...(input.email !== undefined ? { email: input.email || null } : {}),
        ...(input.company !== undefined ? { company: input.company ?? null } : {}),
        ...(input.position !== undefined ? { position: input.position ?? null } : {}),
        ...(input.location !== undefined ? { location: input.location ?? null } : {}),
        ...(input.achievements !== undefined ? { achievements: input.achievements ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedAt: new Date(),
      })
      .where(eq(educationAlumni.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "alumni",
      recordId: input.id,
    });
    return this.mapAlumni(row!);
  }

  async convertStudentToAlumni(
    organizationId: string,
    studentId: string,
    body: { branchCode: string; graduationYear?: number },
    userId?: string,
  ) {
    const branch = await this.resolveBranch(organizationId, body.branchCode);
    const [student] = await this.db
      .select()
      .from(educationStudents)
      .where(
        and(eq(educationStudents.id, studentId), eq(educationStudents.organizationId, organizationId)),
      )
      .limit(1);
    if (!student) throw new NotFoundException("Student not found");
    const [existing] = await this.db
      .select()
      .from(educationAlumni)
      .where(and(eq(educationAlumni.studentId, studentId), eq(educationAlumni.organizationId, organizationId)))
      .limit(1);
    if (existing) return this.mapAlumni(existing);

    let programOrClass: string | null = null;
    if (student.classId) {
      const [cls] = await this.db
        .select()
        .from(educationClasses)
        .where(eq(educationClasses.id, student.classId))
        .limit(1);
      programOrClass = cls?.name ?? null;
    }

    const [row] = await this.db
      .insert(educationAlumni)
      .values({
        organizationId,
        branchId: branch.id,
        studentId: student.id,
        fullName: [student.firstName, student.lastName].filter(Boolean).join(" "),
        graduationYear: body.graduationYear ?? new Date().getFullYear(),
        programOrClass,
        phone: student.phone,
        email: student.email,
        status: "active",
      })
      .returning();
    await this.db
      .update(educationStudents)
      .set({ statusCode: "alumni", updatedAt: new Date() })
      .where(eq(educationStudents.id, student.id));
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "convert_from_student",
      moduleKey: "alumni",
      recordId: row!.id,
      detail: studentId,
    });
    return this.mapAlumni(row!);
  }

  private mapAlumni(row: typeof educationAlumni.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      studentId: row.studentId,
      fullName: row.fullName,
      graduationYear: row.graduationYear,
      programOrClass: row.programOrClass,
      phone: row.phone,
      email: row.email,
      company: row.company,
      position: row.position,
      location: row.location,
      achievements: row.achievements,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
      updatedAt: this.iso(row.updatedAt)!,
    };
  }

  // ─── Health Records / Visits ─────────────────────────────────────────────

  async listHealthRecords(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationHealthRecords)
      .where(
        and(eq(educationHealthRecords.organizationId, organizationId), eq(educationHealthRecords.branchId, branch.id)),
      )
      .orderBy(desc(educationHealthRecords.createdAt));
    return rows.map((r) => this.mapHealthRecord(r));
  }

  async createHealthRecord(
    organizationId: string,
    input: CreateEducationHealthRecord,
    userId?: string,
  ) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationHealthRecords)
      .values({
        organizationId,
        branchId: branch.id,
        studentId: input.studentId,
        allergies: input.allergies ?? null,
        notes: input.notes ?? null,
        emergencyContact: input.emergencyContact ?? null,
        lastVisitDate: input.lastVisitDate ?? null,
        status: input.status ?? "active",
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "health",
      recordId: row!.id,
    });
    return this.mapHealthRecord(row!);
  }

  async updateHealthRecord(
    organizationId: string,
    input: UpdateEducationHealthRecord,
    userId?: string,
  ) {
    const [existing] = await this.db
      .select()
      .from(educationHealthRecords)
      .where(
        and(eq(educationHealthRecords.id, input.id), eq(educationHealthRecords.organizationId, organizationId)),
      )
      .limit(1);
    if (!existing) throw new NotFoundException("Health record not found");
    const [row] = await this.db
      .update(educationHealthRecords)
      .set({
        ...(input.studentId !== undefined ? { studentId: input.studentId } : {}),
        ...(input.allergies !== undefined ? { allergies: input.allergies ?? null } : {}),
        ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
        ...(input.emergencyContact !== undefined
          ? { emergencyContact: input.emergencyContact ?? null }
          : {}),
        ...(input.lastVisitDate !== undefined ? { lastVisitDate: input.lastVisitDate ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedAt: new Date(),
      })
      .where(eq(educationHealthRecords.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "health",
      recordId: input.id,
    });
    return this.mapHealthRecord(row!);
  }

  private mapHealthRecord(row: typeof educationHealthRecords.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      studentId: row.studentId,
      allergies: row.allergies,
      notes: row.notes,
      emergencyContact: row.emergencyContact,
      lastVisitDate: row.lastVisitDate,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
      updatedAt: this.iso(row.updatedAt)!,
    };
  }

  async listHealthVisits(organizationId: string, healthRecordId: string) {
    const [record] = await this.db
      .select()
      .from(educationHealthRecords)
      .where(
        and(
          eq(educationHealthRecords.id, healthRecordId),
          eq(educationHealthRecords.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!record) throw new NotFoundException("Health record not found");
    const rows = await this.db
      .select()
      .from(educationHealthVisits)
      .where(eq(educationHealthVisits.healthRecordId, healthRecordId))
      .orderBy(desc(educationHealthVisits.createdAt));
    return rows.map((r) => this.mapHealthVisit(r));
  }

  async createHealthVisit(organizationId: string, input: CreateEducationHealthVisit, userId?: string) {
    const [record] = await this.db
      .select()
      .from(educationHealthRecords)
      .where(
        and(
          eq(educationHealthRecords.id, input.healthRecordId),
          eq(educationHealthRecords.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!record) throw new NotFoundException("Health record not found");
    const [row] = await this.db
      .insert(educationHealthVisits)
      .values({
        healthRecordId: input.healthRecordId,
        visitDate: input.visitDate,
        reason: input.reason ?? null,
        treatment: input.treatment ?? null,
        recordedBy: input.recordedBy ?? userId ?? null,
      })
      .returning();
    await this.db
      .update(educationHealthRecords)
      .set({ lastVisitDate: input.visitDate, updatedAt: new Date() })
      .where(eq(educationHealthRecords.id, input.healthRecordId));
    await this.writeAudit({
      organizationId,
      branchId: record.branchId,
      userId,
      action: "create_visit",
      moduleKey: "health",
      recordId: row!.id,
    });
    return this.mapHealthVisit(row!);
  }

  private mapHealthVisit(row: typeof educationHealthVisits.$inferSelect) {
    return {
      id: row.id,
      healthRecordId: row.healthRecordId,
      visitDate: row.visitDate,
      reason: row.reason,
      treatment: row.treatment,
      recordedBy: row.recordedBy,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  // ─── Hostels ─────────────────────────────────────────────────────────────

  async listHostels(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationHostels)
      .where(and(eq(educationHostels.organizationId, organizationId), eq(educationHostels.branchId, branch.id)))
      .orderBy(asc(educationHostels.name));
    return rows.map((r) => this.mapHostel(r));
  }

  async createHostel(organizationId: string, input: CreateEducationHostel, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationHostels)
      .values({
        organizationId,
        branchId: branch.id,
        name: input.name,
        code: input.code,
        genderPolicy: input.genderPolicy ?? null,
        status: input.status ?? "active",
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      userId,
      action: "create",
      moduleKey: "hostel",
      recordId: row!.id,
    });
    return this.mapHostel(row!);
  }

  async updateHostel(organizationId: string, input: UpdateEducationHostel, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationHostels)
      .where(and(eq(educationHostels.id, input.id), eq(educationHostels.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Hostel not found");
    const [row] = await this.db
      .update(educationHostels)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.genderPolicy !== undefined ? { genderPolicy: input.genderPolicy ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      })
      .where(eq(educationHostels.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      moduleKey: "hostel",
      recordId: input.id,
    });
    return this.mapHostel(row!);
  }

  private mapHostel(row: typeof educationHostels.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      name: row.name,
      code: row.code,
      genderPolicy: row.genderPolicy,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  async listHostelRooms(organizationId: string, hostelId: string) {
    if (hostelId) {
      const [hostel] = await this.db
        .select()
        .from(educationHostels)
        .where(and(eq(educationHostels.id, hostelId), eq(educationHostels.organizationId, organizationId)))
        .limit(1);
      if (!hostel) throw new NotFoundException("Hostel not found");
      const rows = await this.db
        .select()
        .from(educationHostelRooms)
        .where(eq(educationHostelRooms.hostelId, hostelId))
        .orderBy(asc(educationHostelRooms.roomNumber));
      return rows.map((r) => this.mapHostelRoom(r));
    }
    const hostels = await this.db
      .select({ id: educationHostels.id })
      .from(educationHostels)
      .where(eq(educationHostels.organizationId, organizationId));
    const hostelIds = hostels.map((h) => h.id);
    if (hostelIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(educationHostelRooms)
      .where(inArray(educationHostelRooms.hostelId, hostelIds))
      .orderBy(asc(educationHostelRooms.roomNumber));
    return rows.map((r) => this.mapHostelRoom(r));
  }

  async createHostelRoom(organizationId: string, input: CreateEducationHostelRoom, userId?: string) {
    const [hostel] = await this.db
      .select()
      .from(educationHostels)
      .where(and(eq(educationHostels.id, input.hostelId), eq(educationHostels.organizationId, organizationId)))
      .limit(1);
    if (!hostel) throw new NotFoundException("Hostel not found");
    const [row] = await this.db
      .insert(educationHostelRooms)
      .values({
        hostelId: input.hostelId,
        roomNumber: input.roomNumber,
        capacity: input.capacity,
        status: input.status ?? "active",
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: hostel.branchId,
      userId,
      action: "create_room",
      moduleKey: "hostel",
      recordId: row!.id,
    });
    return this.mapHostelRoom(row!);
  }

  async updateHostelRoom(organizationId: string, input: UpdateEducationHostelRoom, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationHostelRooms)
      .where(eq(educationHostelRooms.id, input.id))
      .limit(1);
    if (!existing) throw new NotFoundException("Hostel room not found");
    const [hostel] = await this.db
      .select()
      .from(educationHostels)
      .where(
        and(eq(educationHostels.id, existing.hostelId), eq(educationHostels.organizationId, organizationId)),
      )
      .limit(1);
    if (!hostel) throw new NotFoundException("Hostel not found");
    const [row] = await this.db
      .update(educationHostelRooms)
      .set({
        ...(input.roomNumber !== undefined ? { roomNumber: input.roomNumber } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      })
      .where(eq(educationHostelRooms.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: hostel.branchId,
      userId,
      action: "update_room",
      moduleKey: "hostel",
      recordId: input.id,
    });
    return this.mapHostelRoom(row!);
  }

  private mapHostelRoom(row: typeof educationHostelRooms.$inferSelect) {
    return {
      id: row.id,
      hostelId: row.hostelId,
      roomNumber: row.roomNumber,
      capacity: row.capacity,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  async listHostelBeds(organizationId: string, hostelRoomId: string) {
    if (hostelRoomId) {
      const [room] = await this.db
        .select()
        .from(educationHostelRooms)
        .where(eq(educationHostelRooms.id, hostelRoomId))
        .limit(1);
      if (!room) throw new NotFoundException("Hostel room not found");
      const [hostel] = await this.db
        .select()
        .from(educationHostels)
        .where(and(eq(educationHostels.id, room.hostelId), eq(educationHostels.organizationId, organizationId)))
        .limit(1);
      if (!hostel) throw new NotFoundException("Hostel not found");
      const rows = await this.db
        .select()
        .from(educationHostelBeds)
        .where(eq(educationHostelBeds.hostelRoomId, hostelRoomId))
        .orderBy(asc(educationHostelBeds.bedCode));
      return rows.map((r) => this.mapHostelBed(r));
    }
    const hostels = await this.db
      .select({ id: educationHostels.id })
      .from(educationHostels)
      .where(eq(educationHostels.organizationId, organizationId));
    const hostelIds = hostels.map((h) => h.id);
    if (hostelIds.length === 0) return [];
    const rooms = await this.db
      .select({ id: educationHostelRooms.id })
      .from(educationHostelRooms)
      .where(inArray(educationHostelRooms.hostelId, hostelIds));
    const roomIds = rooms.map((r) => r.id);
    if (roomIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(educationHostelBeds)
      .where(inArray(educationHostelBeds.hostelRoomId, roomIds))
      .orderBy(asc(educationHostelBeds.bedCode));
    return rows.map((r) => this.mapHostelBed(r));
  }

  async createHostelBed(organizationId: string, input: CreateEducationHostelBed, userId?: string) {
    const [room] = await this.db
      .select()
      .from(educationHostelRooms)
      .where(eq(educationHostelRooms.id, input.hostelRoomId))
      .limit(1);
    if (!room) throw new NotFoundException("Hostel room not found");
    const [hostel] = await this.db
      .select()
      .from(educationHostels)
      .where(and(eq(educationHostels.id, room.hostelId), eq(educationHostels.organizationId, organizationId)))
      .limit(1);
    if (!hostel) throw new NotFoundException("Hostel not found");
    const [row] = await this.db
      .insert(educationHostelBeds)
      .values({
        hostelRoomId: input.hostelRoomId,
        bedCode: input.bedCode,
        status: input.status ?? "available",
      })
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: hostel.branchId,
      userId,
      action: "create_bed",
      moduleKey: "hostel",
      recordId: row!.id,
    });
    return this.mapHostelBed(row!);
  }

  async updateHostelBed(organizationId: string, input: UpdateEducationHostelBed, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationHostelBeds)
      .where(eq(educationHostelBeds.id, input.id))
      .limit(1);
    if (!existing) throw new NotFoundException("Hostel bed not found");
    const [room] = await this.db
      .select()
      .from(educationHostelRooms)
      .where(eq(educationHostelRooms.id, existing.hostelRoomId))
      .limit(1);
    if (!room) throw new NotFoundException("Hostel room not found");
    const [hostel] = await this.db
      .select()
      .from(educationHostels)
      .where(and(eq(educationHostels.id, room.hostelId), eq(educationHostels.organizationId, organizationId)))
      .limit(1);
    if (!hostel) throw new NotFoundException("Hostel not found");
    const [row] = await this.db
      .update(educationHostelBeds)
      .set({
        ...(input.bedCode !== undefined ? { bedCode: input.bedCode } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      })
      .where(eq(educationHostelBeds.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      branchId: hostel.branchId,
      userId,
      action: "update_bed",
      moduleKey: "hostel",
      recordId: input.id,
    });
    return this.mapHostelBed(row!);
  }

  private mapHostelBed(row: typeof educationHostelBeds.$inferSelect) {
    return {
      id: row.id,
      hostelRoomId: row.hostelRoomId,
      bedCode: row.bedCode,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  async listHostelAllocations(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const hostels = await this.db
      .select({ id: educationHostels.id })
      .from(educationHostels)
      .where(and(eq(educationHostels.organizationId, organizationId), eq(educationHostels.branchId, branch.id)));
    if (!hostels.length) return [];
    const rooms = await this.db
      .select({ id: educationHostelRooms.id })
      .from(educationHostelRooms)
      .where(
        inArray(
          educationHostelRooms.hostelId,
          hostels.map((h) => h.id),
        ),
      );
    if (!rooms.length) return [];
    const beds = await this.db
      .select({ id: educationHostelBeds.id })
      .from(educationHostelBeds)
      .where(
        inArray(
          educationHostelBeds.hostelRoomId,
          rooms.map((r) => r.id),
        ),
      );
    if (!beds.length) return [];
    const rows = await this.db
      .select()
      .from(educationHostelAllocations)
      .where(
        inArray(
          educationHostelAllocations.bedId,
          beds.map((b) => b.id),
        ),
      )
      .orderBy(desc(educationHostelAllocations.createdAt));
    return rows.map((r) => this.mapHostelAllocation(r));
  }

  async createHostelAllocation(
    organizationId: string,
    input: CreateEducationHostelAllocation,
    userId?: string,
  ) {
    const [bed] = await this.db
      .select()
      .from(educationHostelBeds)
      .where(eq(educationHostelBeds.id, input.bedId))
      .limit(1);
    if (!bed) throw new NotFoundException("Hostel bed not found");
    if (bed.status !== "available") throw new BadRequestException("Bed is not available");

    const [active] = await this.db
      .select()
      .from(educationHostelAllocations)
      .where(
        and(eq(educationHostelAllocations.bedId, input.bedId), eq(educationHostelAllocations.status, "active")),
      )
      .limit(1);
    if (active) throw new BadRequestException("Bed is already allocated");

    const [room] = await this.db
      .select()
      .from(educationHostelRooms)
      .where(eq(educationHostelRooms.id, bed.hostelRoomId))
      .limit(1);
    if (!room) throw new NotFoundException("Hostel room not found");
    const [hostel] = await this.db
      .select()
      .from(educationHostels)
      .where(and(eq(educationHostels.id, room.hostelId), eq(educationHostels.organizationId, organizationId)))
      .limit(1);
    if (!hostel) throw new NotFoundException("Hostel not found");

    const [row] = await this.db
      .insert(educationHostelAllocations)
      .values({
        bedId: input.bedId,
        studentId: input.studentId,
        checkInDate: input.checkInDate,
        checkOutDate: input.checkOutDate ?? null,
        status: input.status ?? "active",
      })
      .returning();
    await this.db
      .update(educationHostelBeds)
      .set({ status: "occupied" })
      .where(eq(educationHostelBeds.id, input.bedId));
    await this.writeAudit({
      organizationId,
      branchId: hostel.branchId,
      userId,
      action: "allocate",
      moduleKey: "hostel",
      recordId: row!.id,
    });
    return this.mapHostelAllocation(row!);
  }

  async updateHostelAllocation(
    organizationId: string,
    input: UpdateEducationHostelAllocation,
    userId?: string,
  ) {
    const [existing] = await this.db
      .select()
      .from(educationHostelAllocations)
      .where(eq(educationHostelAllocations.id, input.id))
      .limit(1);
    if (!existing) throw new NotFoundException("Hostel allocation not found");
    const [bed] = await this.db
      .select()
      .from(educationHostelBeds)
      .where(eq(educationHostelBeds.id, existing.bedId))
      .limit(1);
    if (!bed) throw new NotFoundException("Hostel bed not found");
    const [room] = await this.db
      .select()
      .from(educationHostelRooms)
      .where(eq(educationHostelRooms.id, bed.hostelRoomId))
      .limit(1);
    if (!room) throw new NotFoundException("Hostel room not found");
    const [hostel] = await this.db
      .select()
      .from(educationHostels)
      .where(and(eq(educationHostels.id, room.hostelId), eq(educationHostels.organizationId, organizationId)))
      .limit(1);
    if (!hostel) throw new NotFoundException("Hostel not found");

    const nextStatus = input.status ?? existing.status;
    const [row] = await this.db
      .update(educationHostelAllocations)
      .set({
        ...(input.checkInDate !== undefined ? { checkInDate: input.checkInDate } : {}),
        ...(input.checkOutDate !== undefined ? { checkOutDate: input.checkOutDate ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.studentId !== undefined ? { studentId: input.studentId } : {}),
        ...(input.bedId !== undefined ? { bedId: input.bedId } : {}),
      })
      .where(eq(educationHostelAllocations.id, input.id))
      .returning();

    if (existing.status === "active" && nextStatus === "checked_out") {
      await this.db
        .update(educationHostelBeds)
        .set({ status: "available" })
        .where(eq(educationHostelBeds.id, existing.bedId));
    }

    await this.writeAudit({
      organizationId,
      branchId: hostel.branchId,
      userId,
      action: "update_allocation",
      moduleKey: "hostel",
      recordId: input.id,
    });
    return this.mapHostelAllocation(row!);
  }

  private mapHostelAllocation(row: typeof educationHostelAllocations.$inferSelect) {
    return {
      id: row.id,
      bedId: row.bedId,
      studentId: row.studentId,
      checkInDate: row.checkInDate,
      checkOutDate: row.checkOutDate,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  // ─── Custom Fields ───────────────────────────────────────────────────────

  async listCustomFieldDefs(organizationId: string, entityType?: string) {
    const conditions = [eq(educationCustomFieldDefs.organizationId, organizationId)];
    if (entityType) conditions.push(eq(educationCustomFieldDefs.entityType, entityType));
    const rows = await this.db
      .select()
      .from(educationCustomFieldDefs)
      .where(and(...conditions))
      .orderBy(asc(educationCustomFieldDefs.sortOrder), asc(educationCustomFieldDefs.label));
    return rows.map((r) => this.mapCustomFieldDef(r));
  }

  async createCustomFieldDef(
    organizationId: string,
    input: CreateEducationCustomFieldDef,
    userId?: string,
  ) {
    const [row] = await this.db
      .insert(educationCustomFieldDefs)
      .values({
        organizationId,
        entityType: input.entityType,
        fieldKey: input.fieldKey,
        label: input.label,
        fieldType: input.fieldType,
        required: input.required ?? false,
        optionsJson: input.optionsJson ?? null,
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive ?? true,
      })
      .returning();
    await this.writeAudit({
      organizationId,
      userId,
      action: "create",
      moduleKey: "custom_fields",
      recordId: row!.id,
    });
    return this.mapCustomFieldDef(row!);
  }

  async updateCustomFieldDef(
    organizationId: string,
    input: UpdateEducationCustomFieldDef,
    userId?: string,
  ) {
    const [existing] = await this.db
      .select()
      .from(educationCustomFieldDefs)
      .where(
        and(eq(educationCustomFieldDefs.id, input.id), eq(educationCustomFieldDefs.organizationId, organizationId)),
      )
      .limit(1);
    if (!existing) throw new NotFoundException("Custom field def not found");
    const [row] = await this.db
      .update(educationCustomFieldDefs)
      .set({
        ...(input.entityType !== undefined ? { entityType: input.entityType } : {}),
        ...(input.fieldKey !== undefined ? { fieldKey: input.fieldKey } : {}),
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.fieldType !== undefined ? { fieldType: input.fieldType } : {}),
        ...(input.required !== undefined ? { required: input.required } : {}),
        ...(input.optionsJson !== undefined ? { optionsJson: input.optionsJson ?? null } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      })
      .where(eq(educationCustomFieldDefs.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      userId,
      action: "update",
      moduleKey: "custom_fields",
      recordId: input.id,
    });
    return this.mapCustomFieldDef(row!);
  }

  private mapCustomFieldDef(row: typeof educationCustomFieldDefs.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      entityType: row.entityType,
      fieldKey: row.fieldKey,
      label: row.label,
      fieldType: row.fieldType,
      required: row.required,
      optionsJson: row.optionsJson,
      sortOrder: row.sortOrder,
      isActive: row.isActive,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  async listCustomFieldValues(organizationId: string, entityType?: string, entityId?: string) {
    const conditions = [eq(educationCustomFieldValues.organizationId, organizationId)];
    if (entityType) conditions.push(eq(educationCustomFieldValues.entityType, entityType));
    if (entityId) conditions.push(eq(educationCustomFieldValues.entityId, entityId));
    const rows = await this.db
      .select()
      .from(educationCustomFieldValues)
      .where(and(...conditions))
      .orderBy(desc(educationCustomFieldValues.updatedAt));
    return rows.map((r) => this.mapCustomFieldValue(r));
  }

  async upsertCustomFieldValue(
    organizationId: string,
    input: CreateEducationCustomFieldValue,
    userId?: string,
  ) {
    const [existing] = await this.db
      .select()
      .from(educationCustomFieldValues)
      .where(
        and(
          eq(educationCustomFieldValues.organizationId, organizationId),
          eq(educationCustomFieldValues.entityType, input.entityType),
          eq(educationCustomFieldValues.entityId, input.entityId),
          eq(educationCustomFieldValues.fieldKey, input.fieldKey),
        ),
      )
      .limit(1);
    if (existing) {
      const [row] = await this.db
        .update(educationCustomFieldValues)
        .set({ valueText: input.valueText, updatedAt: new Date() })
        .where(eq(educationCustomFieldValues.id, existing.id))
        .returning();
      await this.writeAudit({
        organizationId,
        userId,
        action: "update_value",
        moduleKey: "custom_fields",
        recordId: row!.id,
      });
      return this.mapCustomFieldValue(row!);
    }
    const [row] = await this.db
      .insert(educationCustomFieldValues)
      .values({
        organizationId,
        entityType: input.entityType,
        entityId: input.entityId,
        fieldKey: input.fieldKey,
        valueText: input.valueText,
      })
      .returning();
    await this.writeAudit({
      organizationId,
      userId,
      action: "create_value",
      moduleKey: "custom_fields",
      recordId: row!.id,
    });
    return this.mapCustomFieldValue(row!);
  }

  async updateCustomFieldValue(
    organizationId: string,
    input: UpdateEducationCustomFieldValue,
    userId?: string,
  ) {
    const [existing] = await this.db
      .select()
      .from(educationCustomFieldValues)
      .where(
        and(
          eq(educationCustomFieldValues.id, input.id),
          eq(educationCustomFieldValues.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!existing) throw new NotFoundException("Custom field value not found");
    const [row] = await this.db
      .update(educationCustomFieldValues)
      .set({
        ...(input.valueText !== undefined ? { valueText: input.valueText } : {}),
        ...(input.entityType !== undefined ? { entityType: input.entityType } : {}),
        ...(input.entityId !== undefined ? { entityId: input.entityId } : {}),
        ...(input.fieldKey !== undefined ? { fieldKey: input.fieldKey } : {}),
        updatedAt: new Date(),
      })
      .where(eq(educationCustomFieldValues.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      userId,
      action: "update_value",
      moduleKey: "custom_fields",
      recordId: input.id,
    });
    return this.mapCustomFieldValue(row!);
  }

  private mapCustomFieldValue(row: typeof educationCustomFieldValues.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      entityType: row.entityType,
      entityId: row.entityId,
      fieldKey: row.fieldKey,
      valueText: row.valueText,
      createdAt: this.iso(row.createdAt)!,
      updatedAt: this.iso(row.updatedAt)!,
    };
  }

  // ─── Workflows ───────────────────────────────────────────────────────────

  async listWorkflows(organizationId: string) {
    const rows = await this.db
      .select()
      .from(educationWorkflowDefs)
      .where(eq(educationWorkflowDefs.organizationId, organizationId))
      .orderBy(asc(educationWorkflowDefs.name));
    return rows.map((r) => this.mapWorkflow(r));
  }

  async createWorkflow(organizationId: string, input: CreateEducationWorkflowDef, userId?: string) {
    const [row] = await this.db
      .insert(educationWorkflowDefs)
      .values({
        organizationId,
        workflowKey: input.workflowKey,
        name: input.name,
        statesJson: input.statesJson,
        isActive: input.isActive ?? true,
      })
      .returning();
    await this.writeAudit({
      organizationId,
      userId,
      action: "create",
      moduleKey: "workflows",
      recordId: row!.id,
    });
    return this.mapWorkflow(row!);
  }

  async updateWorkflow(organizationId: string, input: UpdateEducationWorkflowDef, userId?: string) {
    const [existing] = await this.db
      .select()
      .from(educationWorkflowDefs)
      .where(and(eq(educationWorkflowDefs.id, input.id), eq(educationWorkflowDefs.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Workflow not found");
    const [row] = await this.db
      .update(educationWorkflowDefs)
      .set({
        ...(input.workflowKey !== undefined ? { workflowKey: input.workflowKey } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.statesJson !== undefined ? { statesJson: input.statesJson } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        updatedAt: new Date(),
      })
      .where(eq(educationWorkflowDefs.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      userId,
      action: "update",
      moduleKey: "workflows",
      recordId: input.id,
    });
    return this.mapWorkflow(row!);
  }

  private mapWorkflow(row: typeof educationWorkflowDefs.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      workflowKey: row.workflowKey,
      name: row.name,
      statesJson: row.statesJson,
      isActive: row.isActive,
      createdAt: this.iso(row.createdAt)!,
      updatedAt: this.iso(row.updatedAt)!,
    };
  }

  // ─── Notification Rules ──────────────────────────────────────────────────

  async listNotificationRules(organizationId: string) {
    const rows = await this.db
      .select()
      .from(educationNotificationRules)
      .where(eq(educationNotificationRules.organizationId, organizationId))
      .orderBy(asc(educationNotificationRules.ruleKey));
    return rows.map((r) => this.mapNotificationRule(r));
  }

  async createNotificationRule(
    organizationId: string,
    input: CreateEducationNotificationRule,
    userId?: string,
  ) {
    const [row] = await this.db
      .insert(educationNotificationRules)
      .values({
        organizationId,
        ruleKey: input.ruleKey,
        triggerKey: input.triggerKey,
        audienceCode: input.audienceCode,
        messageTemplate: input.messageTemplate,
        enabled: input.enabled ?? true,
      })
      .returning();
    await this.writeAudit({
      organizationId,
      userId,
      action: "create",
      moduleKey: "notification_rules",
      recordId: row!.id,
    });
    return this.mapNotificationRule(row!);
  }

  async updateNotificationRule(
    organizationId: string,
    input: UpdateEducationNotificationRule,
    userId?: string,
  ) {
    const [existing] = await this.db
      .select()
      .from(educationNotificationRules)
      .where(
        and(
          eq(educationNotificationRules.id, input.id),
          eq(educationNotificationRules.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!existing) throw new NotFoundException("Notification rule not found");
    const [row] = await this.db
      .update(educationNotificationRules)
      .set({
        ...(input.ruleKey !== undefined ? { ruleKey: input.ruleKey } : {}),
        ...(input.triggerKey !== undefined ? { triggerKey: input.triggerKey } : {}),
        ...(input.audienceCode !== undefined ? { audienceCode: input.audienceCode } : {}),
        ...(input.messageTemplate !== undefined ? { messageTemplate: input.messageTemplate } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        updatedAt: new Date(),
      })
      .where(eq(educationNotificationRules.id, input.id))
      .returning();
    await this.writeAudit({
      organizationId,
      userId,
      action: "update",
      moduleKey: "notification_rules",
      recordId: input.id,
    });
    return this.mapNotificationRule(row!);
  }

  private mapNotificationRule(row: typeof educationNotificationRules.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      ruleKey: row.ruleKey,
      triggerKey: row.triggerKey,
      audienceCode: row.audienceCode,
      messageTemplate: row.messageTemplate,
      enabled: row.enabled,
      createdAt: this.iso(row.createdAt)!,
      updatedAt: this.iso(row.updatedAt)!,
    };
  }

  // ─── Seed Demo Data ──────────────────────────────────────────────────────

  async seedDemoData(organizationId: string, branchCode = "EDU-HQ") {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const created: string[] = [];

    const [existingClass] = await this.db
      .select()
      .from(educationClasses)
      .where(and(eq(educationClasses.organizationId, organizationId), eq(educationClasses.branchId, branch.id)))
      .limit(1);

    let classId = existingClass?.id;
    if (!existingClass) {
      const [cls] = await this.db
        .insert(educationClasses)
        .values({
          organizationId,
          branchId: branch.id,
          name: "Demo Class 1",
          code: "DEMO-C1",
          level: "1",
          status: "active",
        })
        .returning();
      classId = cls!.id;
      created.push("class");
    }

    const [existingSection] = await this.db
      .select()
      .from(educationSections)
      .where(and(eq(educationSections.organizationId, organizationId), eq(educationSections.branchId, branch.id)))
      .limit(1);
    let sectionId = existingSection?.id;
    if (!existingSection && classId) {
      const [sec] = await this.db
        .insert(educationSections)
        .values({
          organizationId,
          branchId: branch.id,
          classId,
          name: "A",
          code: "A",
          capacity: 40,
          status: "active",
        })
        .returning();
      sectionId = sec!.id;
      created.push("section");
    }

    const [existingSubject] = await this.db
      .select()
      .from(educationSubjects)
      .where(and(eq(educationSubjects.organizationId, organizationId), eq(educationSubjects.branchId, branch.id)))
      .limit(1);
    if (!existingSubject) {
      await this.db.insert(educationSubjects).values({
        organizationId,
        branchId: branch.id,
        name: "Mathematics",
        code: "MATH",
        creditHours: 3,
        status: "active",
      });
      created.push("subject");
    }

    const [existingStudent] = await this.db
      .select()
      .from(educationStudents)
      .where(
        and(
          eq(educationStudents.organizationId, organizationId),
          eq(educationStudents.branchId, branch.id),
          isNull(educationStudents.deletedAt),
        ),
      )
      .limit(1);
    let studentId = existingStudent?.id;
    if (!existingStudent) {
      const [stu] = await this.db
        .insert(educationStudents)
        .values({
          organizationId,
          branchId: branch.id,
          studentNumber: this.nextSeq(branch.id, "STU"),
          firstName: "Demo",
          lastName: "Student",
          genderCode: "male",
          statusCode: "active",
          classId: classId ?? null,
          sectionId: sectionId ?? null,
          admissionDate: this.today(),
        })
        .returning();
      studentId = stu!.id;
      created.push("student");
    }

    const [existingTeacher] = await this.db
      .select()
      .from(educationTeachers)
      .where(
        and(
          eq(educationTeachers.organizationId, organizationId),
          eq(educationTeachers.branchId, branch.id),
          isNull(educationTeachers.deletedAt),
        ),
      )
      .limit(1);
    if (!existingTeacher) {
      await this.db.insert(educationTeachers).values({
        organizationId,
        branchId: branch.id,
        employeeNumber: this.nextSeq(branch.id, "TCH"),
        firstName: "Demo",
        lastName: "Teacher",
        designation: "Teacher",
        employmentTypeCode: "full_time",
        status: "active",
      });
      created.push("teacher");
    }

    const [existingStaff] = await this.db
      .select()
      .from(educationStaff)
      .where(
        and(
          eq(educationStaff.organizationId, organizationId),
          eq(educationStaff.branchId, branch.id),
          isNull(educationStaff.deletedAt),
        ),
      )
      .limit(1);
    if (!existingStaff) {
      await this.db.insert(educationStaff).values({
        organizationId,
        branchId: branch.id,
        employeeNumber: this.nextSeq(branch.id, "STF"),
        firstName: "Demo",
        lastName: "Staff",
        designation: "Clerk",
        staffCategoryCode: "admin",
        employmentTypeCode: "full_time",
        status: "active",
      });
      created.push("staff");
    }

    const [existingGuardian] = await this.db
      .select()
      .from(educationGuardians)
      .where(and(eq(educationGuardians.organizationId, organizationId), eq(educationGuardians.branchId, branch.id)))
      .limit(1);
    if (!existingGuardian && studentId) {
      const [g] = await this.db
        .insert(educationGuardians)
        .values({
          organizationId,
          branchId: branch.id,
          fullName: "Demo Guardian",
          phone: "03001234567",
          relationshipCode: "father",
          status: "active",
        })
        .returning();
      await this.db.insert(educationStudentGuardians).values({
        studentId,
        guardianId: g!.id,
        isPrimary: true,
      });
      created.push("guardian");
    }

    const [existingFee] = await this.db
      .select()
      .from(educationFeeStructures)
      .where(
        and(eq(educationFeeStructures.organizationId, organizationId), eq(educationFeeStructures.branchId, branch.id)),
      )
      .limit(1);
    if (!existingFee) {
      await this.db.insert(educationFeeStructures).values({
        organizationId,
        branchId: branch.id,
        name: "Demo Tuition",
        feeTypeCode: "tuition",
        amountPkr: 5000,
        frequency: "monthly",
        classId: classId ?? null,
        status: "active",
      });
      created.push("fee_structure");
    }

    const [existingLeave] = await this.db
      .select()
      .from(educationLeaveRequests)
      .where(
        and(
          eq(educationLeaveRequests.organizationId, organizationId),
          eq(educationLeaveRequests.branchId, branch.id),
        ),
      )
      .limit(1);
    if (!existingLeave && studentId) {
      await this.db.insert(educationLeaveRequests).values({
        organizationId,
        branchId: branch.id,
        applicantType: "student",
        applicantId: studentId,
        leaveTypeCode: "sick",
        startDate: this.today(),
        endDate: this.today(),
        days: 1,
        reason: "Demo leave request",
        status: "draft",
      });
      created.push("leave");
    }

    const [existingEnquiry] = await this.db
      .select()
      .from(educationEnquiries)
      .where(and(eq(educationEnquiries.organizationId, organizationId), eq(educationEnquiries.branchId, branch.id)))
      .limit(1);
    if (!existingEnquiry) {
      await this.db.insert(educationEnquiries).values({
        organizationId,
        branchId: branch.id,
        name: "Demo Enquiry",
        phone: "03007654321",
        interestedProgram: "General",
        interestedClassId: classId ?? null,
        sourceCode: "walk_in",
        status: "new",
      });
      created.push("enquiry");
    }

    const [existingNotice] = await this.db
      .select()
      .from(educationNotices)
      .where(and(eq(educationNotices.organizationId, organizationId), eq(educationNotices.branchId, branch.id)))
      .limit(1);
    if (!existingNotice) {
      await this.db.insert(educationNotices).values({
        organizationId,
        branchId: branch.id,
        title: "Welcome Notice",
        body: "Welcome to EducationFlow demo branch.",
        categoryCode: "general",
        audienceCode: "all",
        status: "published",
        publishAt: this.today(),
      });
      created.push("notice");
    }

    const [existingBook] = await this.db
      .select()
      .from(educationBooks)
      .where(and(eq(educationBooks.organizationId, organizationId), eq(educationBooks.branchId, branch.id)))
      .limit(1);
    if (!existingBook) {
      await this.db.insert(educationBooks).values({
        organizationId,
        branchId: branch.id,
        title: "Demo Textbook",
        author: "Demo Author",
        categoryCode: "textbook",
        copiesTotal: 5,
        copiesAvailable: 5,
        status: "active",
      });
      created.push("book");
    }

    const [existingVehicle] = await this.db
      .select()
      .from(educationVehicles)
      .where(and(eq(educationVehicles.organizationId, organizationId), eq(educationVehicles.branchId, branch.id)))
      .limit(1);
    if (!existingVehicle) {
      await this.db.insert(educationVehicles).values({
        organizationId,
        branchId: branch.id,
        code: "BUS-1",
        registration: "ABC-123",
        vehicleTypeCode: "bus",
        capacity: 40,
        driverName: "Demo Driver",
        status: "active",
      });
      created.push("vehicle");
    }

    // Ensure a room with facilities for demo building linkage
    const [existingRoom] = await this.db
      .select()
      .from(educationRooms)
      .where(and(eq(educationRooms.organizationId, organizationId), eq(educationRooms.branchId, branch.id)))
      .limit(1);
    if (!existingRoom) {
      await this.db.insert(educationRooms).values({
        organizationId,
        branchId: branch.id,
        code: "DEMO-R1",
        name: "Demo Room",
        roomTypeCode: "classroom",
        capacity: 40,
        facilitiesJson: JSON.stringify(["projector", "ac", "whiteboard"]),
        status: "active",
      });
      created.push("room");
    }

    await this.writeAudit({
      organizationId,
      branchId: branch.id,
      action: "seed_demo_data",
      moduleKey: "dashboard",
      detail: created.join(",") || "noop",
    });

    return {
      branchCode,
      branchId: branch.id,
      created,
      idempotent: created.length === 0,
    };
  }
}
