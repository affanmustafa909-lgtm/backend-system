import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  bulkCreateEducationAttendanceSchema,
  createEducationAcademicSessionSchema,
  createEducationAdmissionSchema,
  createEducationAttendanceSchema,
  createEducationBatchSchema,
  createEducationBatchStudentSchema,
  createEducationBookIssueSchema,
  createEducationBookSchema,
  createEducationClassSchema,
  createEducationCourseSchema,
  createEducationDepartmentSchema,
  createEducationDocumentTemplateSchema,
  createEducationExamSchema,
  createEducationExamSubjectSchema,
  createEducationExpenseSchema,
  createEducationFeeInvoiceSchema,
  createEducationFeePaymentSchema,
  createEducationFeeStructureSchema,
  createEducationFinanceTxnSchema,
  createEducationGeneratedDocumentSchema,
  createEducationGuardianSchema,
  createEducationLookupSchema,
  createEducationMarkSchema,
  createEducationNoticeSchema,
  createEducationPayrollRunSchema,
  createEducationPeriodSchema,
  createEducationProgramSchema,
  createEducationRoomSchema,
  createEducationRouteSchema,
  createEducationRouteStopSchema,
  createEducationSectionSchema,
  createEducationStaffSchema,
  createEducationStudentSchema,
  createEducationSubjectSchema,
  createEducationTeacherSchema,
  createEducationTimetableSlotSchema,
  createEducationTransportAssignmentSchema,
  createEducationVehicleSchema,
  linkEducationGuardianStudentSchema,
  updateEducationAttendanceSchema,
  updateEducationBatchSchema,
  updateEducationBookIssueSchema,
  updateEducationBookSchema,
  updateEducationCourseSchema,
  updateEducationDepartmentSchema,
  updateEducationDocumentTemplateSchema,
  updateEducationExamSchema,
  updateEducationExamSubjectSchema,
  updateEducationExpenseSchema,
  updateEducationGuardianSchema,
  updateEducationLookupSchema,
  updateEducationMarkSchema,
  updateEducationNoticeSchema,
  updateEducationPayrollRunSchema,
  updateEducationPeriodSchema,
  updateEducationProgramSchema,
  updateEducationRoomSchema,
  updateEducationRouteSchema,
  updateEducationRouteStopSchema,
  updateEducationStaffSchema,
  updateEducationStudentSchema,
  updateEducationTeacherSchema,
  updateEducationTimetableSlotSchema,
  updateEducationTransportAssignmentSchema,
  updateEducationVehicleSchema,
  upsertEducationModuleSchema,
  upsertEducationSettingSchema,
  createEducationLeaveRequestSchema,
  updateEducationLeaveRequestSchema,
  createEducationDisciplineIncidentSchema,
  updateEducationDisciplineIncidentSchema,
  createEducationStudentLifecycleSchema,
  bulkPromoteEducationStudentsSchema,
  createEducationAssignmentSchema,
  updateEducationAssignmentSchema,
  createEducationAssignmentSubmissionSchema,
  updateEducationAssignmentSubmissionSchema,
  createEducationScholarshipSchema,
  updateEducationScholarshipSchema,
  createEducationScholarshipAwardSchema,
  createEducationFeeRefundSchema,
  createEducationBuildingSchema,
  updateEducationBuildingSchema,
  createEducationLabSchema,
  updateEducationLabSchema,
  createEducationEquipmentSchema,
  updateEducationEquipmentSchema,
  createEducationEquipmentIssueSchema,
  createEducationInventoryItemSchema,
  updateEducationInventoryItemSchema,
  createEducationPurchaseRequestSchema,
  updateEducationPurchaseRequestSchema,
  createEducationEnquirySchema,
  updateEducationEnquirySchema,
  createEducationEventSchema,
  updateEducationEventSchema,
  createEducationEventParticipantSchema,
  updateEducationEventParticipantSchema,
  createEducationAlumniSchema,
  updateEducationAlumniSchema,
  createEducationHealthRecordSchema,
  updateEducationHealthRecordSchema,
  createEducationHealthVisitSchema,
  createEducationHostelSchema,
  updateEducationHostelSchema,
  createEducationHostelRoomSchema,
  updateEducationHostelRoomSchema,
  createEducationHostelBedSchema,
  updateEducationHostelBedSchema,
  createEducationHostelAllocationSchema,
  updateEducationHostelAllocationSchema,
  createEducationCustomFieldDefSchema,
  updateEducationCustomFieldDefSchema,
  createEducationCustomFieldValueSchema,
  updateEducationCustomFieldValueSchema,
  createEducationWorkflowDefSchema,
  updateEducationWorkflowDefSchema,
  createEducationNotificationRuleSchema,
  updateEducationNotificationRuleSchema,
} from "@platform/contracts";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { PermissionsGuard } from "../users/permissions.guard";
import { RequirePermissions } from "../users/require-permission.decorator";
import { SystemTypeGuard } from "../users/system-type.guard";
import { RequireSystemType } from "../users/require-system-type.decorator";
import { EducationExtraService } from "./education-extra.service";
import { EducationOpsService } from "./education-ops.service";
import { EducationService } from "./education.service";

@Controller("v1/education")
@UseGuards(JwtAuthGuard, PermissionsGuard, SystemTypeGuard)
@RequireSystemType("education")
export class EducationController {
  constructor(
    private readonly education: EducationService,
    private readonly ops: EducationOpsService,
    private readonly extra: EducationExtraService,
  ) {}

  @Get("dashboard")
  @RequirePermissions("pops.read")
  getDashboard(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.education.getDashboard(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("bootstrap-defaults")
  @RequirePermissions("pops.inventory.manage")
  bootstrapDefaults(@CurrentUser() user: AccessJwtPayload, @Body() body: { branchCode?: string }) {
    return this.education.bootstrapDefaults(user.organizationId, body?.branchCode?.trim());
  }

  @Get("lookups")
  @RequirePermissions("pops.read")
  listLookups(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode?: string,
    @Query("category") category?: string,
  ) {
    return this.education.listLookups(user.organizationId, branchCode?.trim(), category?.trim());
  }

  @Post("lookups")
  @RequirePermissions("pops.inventory.manage")
  createLookup(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.education.createLookup(user.organizationId, createEducationLookupSchema.parse(body));
  }

  @Patch("lookups/:id")
  @RequirePermissions("pops.inventory.manage")
  updateLookup(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.education.updateLookup(
      user.organizationId,
      updateEducationLookupSchema.parse({ ...(body as object), id }),
    );
  }

  @Get("modules")
  @RequirePermissions("pops.read")
  listModules(@CurrentUser() user: AccessJwtPayload) {
    return this.education.listModules(user.organizationId);
  }

  @Post("modules")
  @RequirePermissions("pops.inventory.manage")
  upsertModule(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.education.upsertModule(user.organizationId, upsertEducationModuleSchema.parse(body));
  }

  @Get("settings")
  @RequirePermissions("pops.read")
  listSettings(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode?: string) {
    return this.education.listSettings(user.organizationId, branchCode?.trim());
  }

  @Post("settings")
  @RequirePermissions("pops.inventory.manage")
  upsertSetting(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.education.upsertSetting(user.organizationId, upsertEducationSettingSchema.parse(body));
  }

  @Get("sessions")
  @RequirePermissions("pops.read")
  listSessions(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.education.listSessions(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("sessions")
  @RequirePermissions("pops.inventory.manage")
  createSession(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.education.createSession(user.organizationId, createEducationAcademicSessionSchema.parse(body));
  }

  @Get("classes")
  @RequirePermissions("pops.read")
  listClasses(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.education.listClasses(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("classes")
  @RequirePermissions("pops.inventory.manage")
  createClass(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.education.createClass(user.organizationId, createEducationClassSchema.parse(body));
  }

  @Get("sections")
  @RequirePermissions("pops.read")
  listSections(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("classId") classId?: string,
  ) {
    return this.education.listSections(user.organizationId, branchCode?.trim() ?? "", classId?.trim());
  }

  @Post("sections")
  @RequirePermissions("pops.inventory.manage")
  createSection(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.education.createSection(user.organizationId, createEducationSectionSchema.parse(body));
  }

  @Get("subjects")
  @RequirePermissions("pops.read")
  listSubjects(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.education.listSubjects(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("subjects")
  @RequirePermissions("pops.inventory.manage")
  createSubject(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.education.createSubject(user.organizationId, createEducationSubjectSchema.parse(body));
  }

  @Get("students")
  @RequirePermissions("pops.read")
  listStudents(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.education.listStudents(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("students")
  @RequirePermissions("pops.inventory.manage")
  createStudent(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.education.createStudent(user.organizationId, createEducationStudentSchema.parse(body));
  }

  @Patch("students/:id")
  @RequirePermissions("pops.inventory.manage")
  updateStudent(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.education.updateStudent(
      user.organizationId,
      updateEducationStudentSchema.parse({ ...(body as object), id }),
    );
  }

  @Get("admissions")
  @RequirePermissions("pops.read")
  listAdmissions(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.education.listAdmissions(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("admissions")
  @RequirePermissions("pops.inventory.manage")
  createAdmission(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.education.createAdmission(user.organizationId, createEducationAdmissionSchema.parse(body));
  }

  @Get("fee-structures")
  @RequirePermissions("pops.read")
  listFeeStructures(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.education.listFeeStructures(user.organizationId, branchCode?.trim() ?? "");
  }

  /** Alias for older clients */
  @Get("fees/structures")
  @RequirePermissions("pops.read")
  listFeeStructuresAlias(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.education.listFeeStructures(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("fee-structures")
  @RequirePermissions("pops.inventory.manage")
  createFeeStructure(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.education.createFeeStructure(user.organizationId, createEducationFeeStructureSchema.parse(body));
  }

  @Post("fees/structures")
  @RequirePermissions("pops.inventory.manage")
  createFeeStructureAlias(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.education.createFeeStructure(user.organizationId, createEducationFeeStructureSchema.parse(body));
  }

  @Get("fee-invoices")
  @RequirePermissions("pops.read")
  listFeeInvoices(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.education.listFeeInvoices(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("fees/invoices")
  @RequirePermissions("pops.read")
  listFeeInvoicesAlias(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.education.listFeeInvoices(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("fee-invoices")
  @RequirePermissions("pops.inventory.manage")
  createFeeInvoice(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.education.createFeeInvoice(user.organizationId, createEducationFeeInvoiceSchema.parse(body));
  }

  @Post("fees/invoices")
  @RequirePermissions("pops.inventory.manage")
  createFeeInvoiceAlias(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.education.createFeeInvoice(user.organizationId, createEducationFeeInvoiceSchema.parse(body));
  }

  @Get("fee-payments")
  @RequirePermissions("pops.read")
  listFeePayments(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.education.listFeePayments(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("fees/payments")
  @RequirePermissions("pops.read")
  listFeePaymentsAlias(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.education.listFeePayments(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("fee-payments")
  @RequirePermissions("pops.inventory.manage")
  createFeePayment(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.education.createFeePayment(user.organizationId, createEducationFeePaymentSchema.parse(body));
  }

  @Post("fees/payments")
  @RequirePermissions("pops.inventory.manage")
  createFeePaymentAlias(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.education.createFeePayment(user.organizationId, createEducationFeePaymentSchema.parse(body));
  }

  // ─── Guardians ─────────────────────────────────────────────────────────

  @Get("guardians")
  @RequirePermissions("pops.read")
  listGuardians(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.ops.listGuardians(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("guardians")
  @RequirePermissions("pops.inventory.manage")
  createGuardian(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.createGuardian(user.organizationId, createEducationGuardianSchema.parse(body), user.sub);
  }

  @Patch("guardians/:id")
  @RequirePermissions("pops.inventory.manage")
  updateGuardian(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.ops.updateGuardian(
      user.organizationId,
      updateEducationGuardianSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Post("guardians/:id/deactivate")
  @RequirePermissions("pops.inventory.manage")
  deactivateGuardian(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.ops.deactivateGuardian(user.organizationId, id, user.sub);
  }

  @Post("guardians/:id/link-student")
  @RequirePermissions("pops.inventory.manage")
  linkGuardianStudent(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.ops.linkGuardianStudent(
      user.organizationId,
      id,
      linkEducationGuardianStudentSchema.parse(body),
      user.sub,
    );
  }

  @Post("guardians/:id/unlink-student")
  @RequirePermissions("pops.inventory.manage")
  unlinkGuardianStudent(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: { studentId: string },
  ) {
    return this.ops.unlinkGuardianStudent(user.organizationId, id, body.studentId, user.sub);
  }

  // ─── Staff ─────────────────────────────────────────────────────────────

  @Get("staff")
  @RequirePermissions("pops.read")
  listStaff(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.ops.listStaff(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("staff")
  @RequirePermissions("pops.inventory.manage")
  createStaff(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.createStaff(user.organizationId, createEducationStaffSchema.parse(body), user.sub);
  }

  @Patch("staff/:id")
  @RequirePermissions("pops.inventory.manage")
  updateStaff(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.ops.updateStaff(
      user.organizationId,
      updateEducationStaffSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Post("staff/:id/deactivate")
  @RequirePermissions("pops.inventory.manage")
  deactivateStaff(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.ops.deactivateStaff(user.organizationId, id, user.sub);
  }

  // ─── Teachers ──────────────────────────────────────────────────────────

  @Get("teachers")
  @RequirePermissions("pops.read")
  listTeachers(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.ops.listTeachers(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("teachers")
  @RequirePermissions("pops.inventory.manage")
  createTeacher(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.createTeacher(user.organizationId, createEducationTeacherSchema.parse(body), user.sub);
  }

  @Patch("teachers/:id")
  @RequirePermissions("pops.inventory.manage")
  updateTeacher(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.ops.updateTeacher(
      user.organizationId,
      updateEducationTeacherSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Post("teachers/:id/deactivate")
  @RequirePermissions("pops.inventory.manage")
  deactivateTeacher(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.ops.deactivateTeacher(user.organizationId, id, user.sub);
  }

  // ─── Departments / Programs / Courses / Batches ────────────────────────

  @Get("departments")
  @RequirePermissions("pops.read")
  listDepartments(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.ops.listDepartments(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("departments")
  @RequirePermissions("pops.inventory.manage")
  createDepartment(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.createDepartment(user.organizationId, createEducationDepartmentSchema.parse(body), user.sub);
  }

  @Patch("departments/:id")
  @RequirePermissions("pops.inventory.manage")
  updateDepartment(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.ops.updateDepartment(
      user.organizationId,
      updateEducationDepartmentSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Get("programs")
  @RequirePermissions("pops.read")
  listPrograms(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.ops.listPrograms(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("programs")
  @RequirePermissions("pops.inventory.manage")
  createProgram(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.createProgram(user.organizationId, createEducationProgramSchema.parse(body), user.sub);
  }

  @Patch("programs/:id")
  @RequirePermissions("pops.inventory.manage")
  updateProgram(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.ops.updateProgram(
      user.organizationId,
      updateEducationProgramSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Get("courses")
  @RequirePermissions("pops.read")
  listCourses(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.ops.listCourses(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("courses")
  @RequirePermissions("pops.inventory.manage")
  createCourse(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.createCourse(user.organizationId, createEducationCourseSchema.parse(body), user.sub);
  }

  @Patch("courses/:id")
  @RequirePermissions("pops.inventory.manage")
  updateCourse(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.ops.updateCourse(
      user.organizationId,
      updateEducationCourseSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Get("batches")
  @RequirePermissions("pops.read")
  listBatches(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.ops.listBatches(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("batches")
  @RequirePermissions("pops.inventory.manage")
  createBatch(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.createBatch(user.organizationId, createEducationBatchSchema.parse(body), user.sub);
  }

  @Patch("batches/:id")
  @RequirePermissions("pops.inventory.manage")
  updateBatch(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.ops.updateBatch(
      user.organizationId,
      updateEducationBatchSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Get("batch-students")
  @RequirePermissions("pops.read")
  listBatchStudents(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("batchId") batchId?: string,
  ) {
    return this.ops.listBatchStudents(user.organizationId, branchCode?.trim() ?? "", batchId?.trim());
  }

  @Post("batch-students")
  @RequirePermissions("pops.inventory.manage")
  enrollBatchStudent(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.enrollBatchStudent(user.organizationId, createEducationBatchStudentSchema.parse(body), user.sub);
  }

  // ─── Periods / Rooms / Timetable ───────────────────────────────────────

  @Get("periods")
  @RequirePermissions("pops.read")
  listPeriods(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.ops.listPeriods(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("periods")
  @RequirePermissions("pops.inventory.manage")
  createPeriod(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.createPeriod(user.organizationId, createEducationPeriodSchema.parse(body), user.sub);
  }

  @Patch("periods/:id")
  @RequirePermissions("pops.inventory.manage")
  updatePeriod(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.ops.updatePeriod(
      user.organizationId,
      updateEducationPeriodSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Get("rooms")
  @RequirePermissions("pops.read")
  listRooms(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.ops.listRooms(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("rooms")
  @RequirePermissions("pops.inventory.manage")
  createRoom(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.createRoom(user.organizationId, createEducationRoomSchema.parse(body), user.sub);
  }

  @Patch("rooms/:id")
  @RequirePermissions("pops.inventory.manage")
  updateRoom(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.ops.updateRoom(
      user.organizationId,
      updateEducationRoomSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Get("timetable-slots")
  @RequirePermissions("pops.read")
  listTimetableSlots(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.ops.listTimetableSlots(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("timetable")
  @RequirePermissions("pops.read")
  listTimetableAlias(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.ops.listTimetableSlots(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("timetable-slots")
  @RequirePermissions("pops.inventory.manage")
  createTimetableSlot(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.createTimetableSlot(
      user.organizationId,
      createEducationTimetableSlotSchema.parse(body),
      user.sub,
    );
  }

  @Post("timetable")
  @RequirePermissions("pops.inventory.manage")
  createTimetableAlias(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.createTimetableSlot(
      user.organizationId,
      createEducationTimetableSlotSchema.parse(body),
      user.sub,
    );
  }

  @Patch("timetable-slots/:id")
  @RequirePermissions("pops.inventory.manage")
  updateTimetableSlot(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.ops.updateTimetableSlot(
      user.organizationId,
      updateEducationTimetableSlotSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Patch("timetable/:id")
  @RequirePermissions("pops.inventory.manage")
  updateTimetableAlias(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.ops.updateTimetableSlot(
      user.organizationId,
      updateEducationTimetableSlotSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  // ─── Attendance ────────────────────────────────────────────────────────

  @Get("attendance")
  @RequirePermissions("pops.read")
  listAttendance(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("date") date?: string,
    @Query("personType") personType?: string,
    @Query("classId") classId?: string,
    @Query("sectionId") sectionId?: string,
    @Query("batchId") batchId?: string,
  ) {
    return this.ops.listAttendance(user.organizationId, branchCode?.trim() ?? "", {
      date: date?.trim(),
      personType: personType?.trim(),
      classId: classId?.trim(),
      sectionId: sectionId?.trim(),
      batchId: batchId?.trim(),
    });
  }

  @Post("attendance")
  @RequirePermissions("pops.inventory.manage")
  createAttendance(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.createAttendance(user.organizationId, createEducationAttendanceSchema.parse(body), user.sub);
  }

  @Post("attendance/bulk")
  @RequirePermissions("pops.inventory.manage")
  bulkCreateAttendance(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.bulkCreateAttendance(
      user.organizationId,
      bulkCreateEducationAttendanceSchema.parse(body),
      user.sub,
    );
  }

  @Patch("attendance/:id")
  @RequirePermissions("pops.inventory.manage")
  updateAttendance(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.ops.updateAttendance(
      user.organizationId,
      updateEducationAttendanceSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  // ─── Exams / Marks ─────────────────────────────────────────────────────

  @Get("exams")
  @RequirePermissions("pops.read")
  listExams(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.ops.listExams(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("exams")
  @RequirePermissions("pops.inventory.manage")
  createExam(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.createExam(user.organizationId, createEducationExamSchema.parse(body), user.sub);
  }

  @Patch("exams/:id")
  @RequirePermissions("pops.inventory.manage")
  updateExam(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.ops.updateExam(
      user.organizationId,
      updateEducationExamSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Post("exams/:id/finalize")
  @RequirePermissions("pops.inventory.manage")
  finalizeExam(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.ops.finalizeExam(user.organizationId, id, user.sub);
  }

  @Get("exam-subjects")
  @RequirePermissions("pops.read")
  listExamSubjects(@CurrentUser() user: AccessJwtPayload, @Query("examId") examId: string) {
    return this.ops.listExamSubjects(user.organizationId, examId?.trim() ?? "");
  }

  @Post("exam-subjects")
  @RequirePermissions("pops.inventory.manage")
  createExamSubject(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.createExamSubject(user.organizationId, createEducationExamSubjectSchema.parse(body), user.sub);
  }

  @Patch("exam-subjects/:id")
  @RequirePermissions("pops.inventory.manage")
  updateExamSubject(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.ops.updateExamSubject(
      user.organizationId,
      updateEducationExamSubjectSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Get("marks")
  @RequirePermissions("pops.read")
  listMarks(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("examId") examId?: string,
  ) {
    return this.ops.listMarks(user.organizationId, branchCode?.trim() ?? "", examId?.trim());
  }

  @Post("marks")
  @RequirePermissions("pops.inventory.manage")
  createMark(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.createMark(user.organizationId, createEducationMarkSchema.parse(body), user.sub);
  }

  @Patch("marks/:id")
  @RequirePermissions("pops.inventory.manage")
  updateMark(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.ops.updateMark(
      user.organizationId,
      updateEducationMarkSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  // ─── Expenses ──────────────────────────────────────────────────────────

  @Get("expenses")
  @RequirePermissions("pops.read")
  listExpenses(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.ops.listExpenses(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("expenses")
  @RequirePermissions("pops.inventory.manage")
  createExpense(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.createExpense(user.organizationId, createEducationExpenseSchema.parse(body), user.sub);
  }

  @Patch("expenses/:id")
  @RequirePermissions("pops.inventory.manage")
  updateExpense(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.ops.updateExpense(
      user.organizationId,
      updateEducationExpenseSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Post("expenses/:id/submit")
  @RequirePermissions("pops.inventory.manage")
  submitExpense(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.ops.transitionExpense(user.organizationId, id, "pending", user.sub);
  }

  @Post("expenses/:id/approve")
  @RequirePermissions("pops.inventory.manage")
  approveExpense(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.ops.transitionExpense(user.organizationId, id, "approved", user.sub);
  }

  @Post("expenses/:id/pay")
  @RequirePermissions("pops.inventory.manage")
  payExpense(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.ops.transitionExpense(user.organizationId, id, "paid", user.sub);
  }

  @Post("expenses/:id/reject")
  @RequirePermissions("pops.inventory.manage")
  rejectExpense(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.ops.transitionExpense(user.organizationId, id, "rejected", user.sub);
  }

  @Post("expenses/:id/cancel")
  @RequirePermissions("pops.inventory.manage")
  cancelExpense(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.ops.transitionExpense(user.organizationId, id, "cancelled", user.sub);
  }

  // ─── Finance ───────────────────────────────────────────────────────────

  @Get("finance-txns")
  @RequirePermissions("pops.read")
  listFinanceTxns(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.ops.listFinanceTxns(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("finance/txns")
  @RequirePermissions("pops.read")
  listFinanceTxnsAlias(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.ops.listFinanceTxns(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("finance-txns")
  @RequirePermissions("pops.inventory.manage")
  createFinanceTxn(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.createFinanceTxn(user.organizationId, createEducationFinanceTxnSchema.parse(body), user.sub);
  }

  @Post("finance/txns")
  @RequirePermissions("pops.inventory.manage")
  createFinanceTxnAlias(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.createFinanceTxn(user.organizationId, createEducationFinanceTxnSchema.parse(body), user.sub);
  }

  @Get("finance/summary")
  @RequirePermissions("pops.read")
  getFinanceSummary(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.ops.getFinanceSummary(user.organizationId, branchCode?.trim() ?? "");
  }

  // ─── Payroll ───────────────────────────────────────────────────────────

  @Get("payroll-runs")
  @RequirePermissions("pops.read")
  listPayrollRuns(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.ops.listPayrollRuns(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("payroll/runs")
  @RequirePermissions("pops.read")
  listPayrollRunsAlias(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.ops.listPayrollRuns(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("payroll-runs")
  @RequirePermissions("pops.inventory.manage")
  createPayrollRun(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.createPayrollRun(user.organizationId, createEducationPayrollRunSchema.parse(body), user.sub);
  }

  @Post("payroll/runs")
  @RequirePermissions("pops.inventory.manage")
  createPayrollRunAlias(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.createPayrollRun(user.organizationId, createEducationPayrollRunSchema.parse(body), user.sub);
  }

  @Patch("payroll-runs/:id")
  @RequirePermissions("pops.inventory.manage")
  updatePayrollRun(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.ops.updatePayrollRun(
      user.organizationId,
      updateEducationPayrollRunSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Patch("payroll/runs/:id")
  @RequirePermissions("pops.inventory.manage")
  updatePayrollRunAlias(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.ops.updatePayrollRun(
      user.organizationId,
      updateEducationPayrollRunSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Post("payroll-runs/:id/generate-payslips")
  @RequirePermissions("pops.inventory.manage")
  generatePayslips(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.ops.generatePayslips(user.organizationId, id, user.sub);
  }

  @Get("payslips")
  @RequirePermissions("pops.read")
  listPayslips(@CurrentUser() user: AccessJwtPayload, @Query("payrollRunId") payrollRunId: string) {
    return this.ops.listPayslips(user.organizationId, payrollRunId?.trim() ?? "");
  }

  // ─── Library ───────────────────────────────────────────────────────────

  @Get("books")
  @RequirePermissions("pops.read")
  listBooks(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.ops.listBooks(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("books")
  @RequirePermissions("pops.inventory.manage")
  createBook(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.createBook(user.organizationId, createEducationBookSchema.parse(body), user.sub);
  }

  @Patch("books/:id")
  @RequirePermissions("pops.inventory.manage")
  updateBook(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.ops.updateBook(
      user.organizationId,
      updateEducationBookSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Get("book-issues")
  @RequirePermissions("pops.read")
  listBookIssues(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.ops.listBookIssues(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("book-issues")
  @RequirePermissions("pops.inventory.manage")
  createBookIssue(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.createBookIssue(user.organizationId, createEducationBookIssueSchema.parse(body), user.sub);
  }

  @Patch("book-issues/:id")
  @RequirePermissions("pops.inventory.manage")
  updateBookIssue(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.ops.updateBookIssue(
      user.organizationId,
      updateEducationBookIssueSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Post("book-issues/:id/return")
  @RequirePermissions("pops.inventory.manage")
  returnBookIssue(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body?: { finePkr?: number; returnedAt?: string },
  ) {
    return this.ops.returnBookIssue(user.organizationId, id, body, user.sub);
  }

  // ─── Transport ─────────────────────────────────────────────────────────

  @Get("vehicles")
  @RequirePermissions("pops.read")
  listVehicles(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.ops.listVehicles(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("vehicles")
  @RequirePermissions("pops.inventory.manage")
  createVehicle(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.createVehicle(user.organizationId, createEducationVehicleSchema.parse(body), user.sub);
  }

  @Patch("vehicles/:id")
  @RequirePermissions("pops.inventory.manage")
  updateVehicle(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.ops.updateVehicle(
      user.organizationId,
      updateEducationVehicleSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Get("routes")
  @RequirePermissions("pops.read")
  listRoutes(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.ops.listRoutes(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("routes")
  @RequirePermissions("pops.inventory.manage")
  createRoute(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.createRoute(user.organizationId, createEducationRouteSchema.parse(body), user.sub);
  }

  @Patch("routes/:id")
  @RequirePermissions("pops.inventory.manage")
  updateRoute(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.ops.updateRoute(
      user.organizationId,
      updateEducationRouteSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Get("route-stops")
  @RequirePermissions("pops.read")
  listRouteStops(@CurrentUser() user: AccessJwtPayload, @Query("routeId") routeId: string) {
    return this.ops.listRouteStops(user.organizationId, routeId?.trim() ?? "");
  }

  @Post("route-stops")
  @RequirePermissions("pops.inventory.manage")
  createRouteStop(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.createRouteStop(user.organizationId, createEducationRouteStopSchema.parse(body), user.sub);
  }

  @Patch("route-stops/:id")
  @RequirePermissions("pops.inventory.manage")
  updateRouteStop(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.ops.updateRouteStop(
      user.organizationId,
      updateEducationRouteStopSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Get("transport-assignments")
  @RequirePermissions("pops.read")
  listTransportAssignments(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.ops.listTransportAssignments(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("transport-assignments")
  @RequirePermissions("pops.inventory.manage")
  createTransportAssignment(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.createTransportAssignment(
      user.organizationId,
      createEducationTransportAssignmentSchema.parse(body),
      user.sub,
    );
  }

  @Patch("transport-assignments/:id")
  @RequirePermissions("pops.inventory.manage")
  updateTransportAssignment(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.ops.updateTransportAssignment(
      user.organizationId,
      updateEducationTransportAssignmentSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  // ─── Notices ───────────────────────────────────────────────────────────

  @Get("notices")
  @RequirePermissions("pops.read")
  listNotices(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.ops.listNotices(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("notices")
  @RequirePermissions("pops.inventory.manage")
  createNotice(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.createNotice(user.organizationId, createEducationNoticeSchema.parse(body), user.sub);
  }

  @Patch("notices/:id")
  @RequirePermissions("pops.inventory.manage")
  updateNotice(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.ops.updateNotice(
      user.organizationId,
      updateEducationNoticeSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Post("notices/:id/publish")
  @RequirePermissions("pops.inventory.manage")
  publishNotice(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.ops.publishNotice(user.organizationId, id, user.sub);
  }

  // ─── Documents ─────────────────────────────────────────────────────────

  @Get("document-templates")
  @RequirePermissions("pops.read")
  listDocumentTemplates(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode?: string) {
    return this.ops.listDocumentTemplates(user.organizationId, branchCode?.trim());
  }

  @Post("document-templates")
  @RequirePermissions("pops.inventory.manage")
  createDocumentTemplate(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.createDocumentTemplate(
      user.organizationId,
      createEducationDocumentTemplateSchema.parse(body),
      user.sub,
    );
  }

  @Patch("document-templates/:id")
  @RequirePermissions("pops.inventory.manage")
  updateDocumentTemplate(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.ops.updateDocumentTemplate(
      user.organizationId,
      updateEducationDocumentTemplateSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Post("documents/generate")
  @RequirePermissions("pops.inventory.manage")
  generateDocument(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.ops.generateDocument(
      user.organizationId,
      createEducationGeneratedDocumentSchema.parse(body),
      user.sub,
    );
  }

  @Get("generated-documents")
  @RequirePermissions("pops.read")
  listGeneratedDocuments(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode?: string) {
    return this.ops.listGeneratedDocuments(user.organizationId, branchCode?.trim());
  }

  // ─── Reports ───────────────────────────────────────────────────────────

  @Get("reports/attendance-summary")
  @RequirePermissions("pops.read")
  reportAttendanceSummary(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("fromDate") fromDate?: string,
    @Query("toDate") toDate?: string,
  ) {
    return this.ops.reportAttendanceSummary(
      user.organizationId,
      branchCode?.trim() ?? "",
      fromDate?.trim(),
      toDate?.trim(),
    );
  }

  @Get("reports/fee-collection")
  @RequirePermissions("pops.read")
  reportFeeCollection(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("fromDate") fromDate?: string,
    @Query("toDate") toDate?: string,
  ) {
    return this.ops.reportFeeCollection(
      user.organizationId,
      branchCode?.trim() ?? "",
      fromDate?.trim(),
      toDate?.trim(),
    );
  }

  @Get("reports/admissions-count")
  @RequirePermissions("pops.read")
  reportAdmissionsCount(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.ops.reportAdmissionsCount(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("reports/expense-summary")
  @RequirePermissions("pops.read")
  reportExpenseSummary(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.ops.reportExpenseSummary(user.organizationId, branchCode?.trim() ?? "");
  }

  // ─── Audit logs ────────────────────────────────────────────────────────

  @Get("audit-logs")
  @RequirePermissions("pops.read")
  listAuditLogs(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode?: string,
    @Query("moduleKey") moduleKey?: string,
  ) {
    return this.ops.listAuditLogs(user.organizationId, branchCode?.trim(), moduleKey?.trim());
  }

  // ─── Seed demo data ──────────────────────────────────────────────────────

  @Post("seed-demo-data")
  @RequirePermissions("pops.inventory.manage")
  seedDemoData(@CurrentUser() user: AccessJwtPayload, @Body() body: { branchCode?: string }) {
    return this.extra.seedDemoData(user.organizationId, body?.branchCode?.trim() || "EDU-HQ");
  }

  // ─── Leave Requests ──────────────────────────────────────────────────────

  @Get("leave-requests")
  @RequirePermissions("pops.read")
  listLeaveRequests(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.extra.listLeaveRequests(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("leave-requests")
  @RequirePermissions("pops.inventory.manage")
  createLeaveRequest(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.createLeaveRequest(
      user.organizationId,
      createEducationLeaveRequestSchema.parse(body),
      user.sub,
    );
  }

  @Patch("leave-requests/:id")
  @RequirePermissions("pops.inventory.manage")
  updateLeaveRequest(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.extra.updateLeaveRequest(
      user.organizationId,
      updateEducationLeaveRequestSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Post("leave-requests/:id/submit")
  @RequirePermissions("pops.inventory.manage")
  submitLeaveRequest(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.extra.submitLeaveRequest(user.organizationId, id, user.sub);
  }

  @Post("leave-requests/:id/approve")
  @RequirePermissions("pops.inventory.manage")
  approveLeaveRequest(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.extra.approveLeaveRequest(user.organizationId, id, user.sub);
  }

  @Post("leave-requests/:id/reject")
  @RequirePermissions("pops.inventory.manage")
  rejectLeaveRequest(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.extra.rejectLeaveRequest(user.organizationId, id, user.sub);
  }

  @Post("leave-requests/:id/cancel")
  @RequirePermissions("pops.inventory.manage")
  cancelLeaveRequest(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.extra.cancelLeaveRequest(user.organizationId, id, user.sub);
  }

  // ─── Discipline ──────────────────────────────────────────────────────────

  @Get("discipline")
  @RequirePermissions("pops.read")
  listDiscipline(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.extra.listDisciplineIncidents(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("discipline-incidents")
  @RequirePermissions("pops.read")
  listDisciplineAlias(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.extra.listDisciplineIncidents(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("discipline")
  @RequirePermissions("pops.inventory.manage")
  createDiscipline(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.createDisciplineIncident(
      user.organizationId,
      createEducationDisciplineIncidentSchema.parse(body),
      user.sub,
    );
  }

  @Post("discipline-incidents")
  @RequirePermissions("pops.inventory.manage")
  createDisciplineAlias(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.createDisciplineIncident(
      user.organizationId,
      createEducationDisciplineIncidentSchema.parse(body),
      user.sub,
    );
  }

  @Patch("discipline/:id")
  @RequirePermissions("pops.inventory.manage")
  updateDiscipline(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.extra.updateDisciplineIncident(
      user.organizationId,
      updateEducationDisciplineIncidentSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Patch("discipline-incidents/:id")
  @RequirePermissions("pops.inventory.manage")
  updateDisciplineAlias(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.extra.updateDisciplineIncident(
      user.organizationId,
      updateEducationDisciplineIncidentSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  @Get("lifecycle")
  @RequirePermissions("pops.read")
  listLifecycle(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.extra.listLifecycle(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("student-lifecycle")
  @RequirePermissions("pops.read")
  listLifecycleAlias(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.extra.listLifecycle(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("lifecycle/promote")
  @RequirePermissions("pops.inventory.manage")
  promoteStudent(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.promoteStudent(
      user.organizationId,
      createEducationStudentLifecycleSchema.parse(body),
      user.sub,
    );
  }

  @Post("lifecycle/promotions/bulk")
  @RequirePermissions("pops.inventory.manage")
  bulkPromote(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.bulkPromoteStudents(
      user.organizationId,
      bulkPromoteEducationStudentsSchema.parse(body),
      user.sub,
    );
  }

  @Post("promotions/bulk")
  @RequirePermissions("pops.inventory.manage")
  bulkPromoteAlias(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.bulkPromoteStudents(
      user.organizationId,
      bulkPromoteEducationStudentsSchema.parse(body),
      user.sub,
    );
  }

  @Post("lifecycle/transfer")
  @RequirePermissions("pops.inventory.manage")
  transferStudent(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.transferStudent(
      user.organizationId,
      createEducationStudentLifecycleSchema.parse(body),
      user.sub,
    );
  }

  @Post("lifecycle/withdraw")
  @RequirePermissions("pops.inventory.manage")
  withdrawStudent(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.withdrawStudent(
      user.organizationId,
      createEducationStudentLifecycleSchema.parse(body),
      user.sub,
    );
  }

  @Post("lifecycle/graduate")
  @RequirePermissions("pops.inventory.manage")
  graduateStudent(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.graduateStudent(
      user.organizationId,
      createEducationStudentLifecycleSchema.parse(body),
      user.sub,
    );
  }

  @Post("lifecycle/archive")
  @RequirePermissions("pops.inventory.manage")
  archiveStudent(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.archiveStudent(
      user.organizationId,
      createEducationStudentLifecycleSchema.parse(body),
      user.sub,
    );
  }

  // ─── Assignments ─────────────────────────────────────────────────────────

  @Get("assignments")
  @RequirePermissions("pops.read")
  listAssignments(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.extra.listAssignments(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("assignments")
  @RequirePermissions("pops.inventory.manage")
  createAssignment(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.createAssignment(
      user.organizationId,
      createEducationAssignmentSchema.parse(body),
      user.sub,
    );
  }

  @Patch("assignments/:id")
  @RequirePermissions("pops.inventory.manage")
  updateAssignment(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.extra.updateAssignment(
      user.organizationId,
      updateEducationAssignmentSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Post("assignments/:id/publish")
  @RequirePermissions("pops.inventory.manage")
  publishAssignment(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.extra.publishAssignment(user.organizationId, id, user.sub);
  }

  @Get("assignment-submissions")
  @RequirePermissions("pops.read")
  listAssignmentSubmissions(
    @CurrentUser() user: AccessJwtPayload,
    @Query("assignmentId") assignmentId?: string,
    @Query("branchCode") branchCode?: string,
  ) {
    return this.extra.listAssignmentSubmissions(
      user.organizationId,
      assignmentId?.trim(),
      branchCode?.trim(),
    );
  }

  @Post("assignment-submissions")
  @RequirePermissions("pops.inventory.manage")
  createAssignmentSubmission(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.createAssignmentSubmission(
      user.organizationId,
      createEducationAssignmentSubmissionSchema.parse(body),
      user.sub,
    );
  }

  @Patch("assignment-submissions/:id")
  @RequirePermissions("pops.inventory.manage")
  updateAssignmentSubmission(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.extra.updateAssignmentSubmission(
      user.organizationId,
      updateEducationAssignmentSubmissionSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Post("assignment-submissions/:id/submit")
  @RequirePermissions("pops.inventory.manage")
  submitAssignmentSubmission(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.extra.submitAssignmentSubmission(user.organizationId, id, user.sub);
  }

  @Post("assignment-submissions/:id/review")
  @RequirePermissions("pops.inventory.manage")
  reviewAssignmentSubmission(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: { marks?: number; remarks?: string },
  ) {
    return this.extra.reviewAssignmentSubmission(user.organizationId, id, body ?? {}, user.sub);
  }

  // ─── Scholarships ────────────────────────────────────────────────────────

  @Get("scholarships")
  @RequirePermissions("pops.read")
  listScholarships(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.extra.listScholarships(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("scholarships")
  @RequirePermissions("pops.inventory.manage")
  createScholarship(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.createScholarship(
      user.organizationId,
      createEducationScholarshipSchema.parse(body),
      user.sub,
    );
  }

  @Patch("scholarships/:id")
  @RequirePermissions("pops.inventory.manage")
  updateScholarship(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.extra.updateScholarship(
      user.organizationId,
      updateEducationScholarshipSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Post("scholarships/:id/approve")
  @RequirePermissions("pops.inventory.manage")
  approveScholarship(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.extra.approveScholarship(user.organizationId, id, user.sub);
  }

  @Get("scholarship-awards")
  @RequirePermissions("pops.read")
  listScholarshipAwards(
    @CurrentUser() user: AccessJwtPayload,
    @Query("scholarshipId") scholarshipId?: string,
    @Query("branchCode") branchCode?: string,
  ) {
    return this.extra.listScholarshipAwards(
      user.organizationId,
      scholarshipId?.trim(),
      branchCode?.trim(),
    );
  }

  @Post("scholarship-awards")
  @RequirePermissions("pops.inventory.manage")
  createScholarshipAward(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.assignScholarshipAward(
      user.organizationId,
      createEducationScholarshipAwardSchema.parse(body),
      user.sub,
    );
  }

  // ─── Fee Refunds ─────────────────────────────────────────────────────────

  @Get("fee-refunds")
  @RequirePermissions("pops.read")
  listFeeRefunds(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.extra.listFeeRefunds(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("fee-refunds")
  @RequirePermissions("pops.inventory.manage")
  requestFeeRefund(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.requestFeeRefund(
      user.organizationId,
      createEducationFeeRefundSchema.parse(body),
      user.sub,
    );
  }

  @Post("fee-refunds/:id/approve")
  @RequirePermissions("pops.inventory.manage")
  approveFeeRefund(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.extra.approveFeeRefund(user.organizationId, id, user.sub);
  }

  @Post("fee-refunds/:id/process")
  @RequirePermissions("pops.inventory.manage")
  processFeeRefund(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.extra.processFeeRefund(user.organizationId, id, user.sub);
  }

  // ─── Buildings ───────────────────────────────────────────────────────────

  @Get("buildings")
  @RequirePermissions("pops.read")
  listBuildings(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.extra.listBuildings(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("buildings")
  @RequirePermissions("pops.inventory.manage")
  createBuilding(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.createBuilding(
      user.organizationId,
      createEducationBuildingSchema.parse(body),
      user.sub,
    );
  }

  @Patch("buildings/:id")
  @RequirePermissions("pops.inventory.manage")
  updateBuilding(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.extra.updateBuilding(
      user.organizationId,
      updateEducationBuildingSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  // ─── Labs / Equipment ────────────────────────────────────────────────────

  @Get("labs")
  @RequirePermissions("pops.read")
  listLabs(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.extra.listLabs(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("labs")
  @RequirePermissions("pops.inventory.manage")
  createLab(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.createLab(user.organizationId, createEducationLabSchema.parse(body), user.sub);
  }

  @Patch("labs/:id")
  @RequirePermissions("pops.inventory.manage")
  updateLab(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.extra.updateLab(
      user.organizationId,
      updateEducationLabSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Get("equipment")
  @RequirePermissions("pops.read")
  listEquipment(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.extra.listEquipment(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("equipment")
  @RequirePermissions("pops.inventory.manage")
  createEquipment(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.createEquipment(
      user.organizationId,
      createEducationEquipmentSchema.parse(body),
      user.sub,
    );
  }

  @Patch("equipment/:id")
  @RequirePermissions("pops.inventory.manage")
  updateEquipment(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.extra.updateEquipment(
      user.organizationId,
      updateEducationEquipmentSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Get("equipment-issues")
  @RequirePermissions("pops.read")
  listEquipmentIssues(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.extra.listEquipmentIssues(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("equipment-issues")
  @RequirePermissions("pops.inventory.manage")
  issueEquipment(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.issueEquipment(
      user.organizationId,
      createEducationEquipmentIssueSchema.parse(body),
      user.sub,
    );
  }

  @Post("equipment-issues/:id/return")
  @RequirePermissions("pops.inventory.manage")
  returnEquipment(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.extra.returnEquipment(user.organizationId, id, user.sub);
  }

  // ─── Inventory / Purchase Requests ───────────────────────────────────────

  @Get("inventory-items")
  @RequirePermissions("pops.read")
  listInventoryItems(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.extra.listInventoryItems(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("inventory-items")
  @RequirePermissions("pops.inventory.manage")
  createInventoryItem(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.createInventoryItem(
      user.organizationId,
      createEducationInventoryItemSchema.parse(body),
      user.sub,
    );
  }

  @Patch("inventory-items/:id")
  @RequirePermissions("pops.inventory.manage")
  updateInventoryItem(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.extra.updateInventoryItem(
      user.organizationId,
      updateEducationInventoryItemSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Get("purchase-requests")
  @RequirePermissions("pops.read")
  listPurchaseRequests(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.extra.listPurchaseRequests(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("purchase-requests")
  @RequirePermissions("pops.inventory.manage")
  createPurchaseRequest(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.createPurchaseRequest(
      user.organizationId,
      createEducationPurchaseRequestSchema.parse(body),
      user.sub,
    );
  }

  @Patch("purchase-requests/:id")
  @RequirePermissions("pops.inventory.manage")
  updatePurchaseRequest(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.extra.updatePurchaseRequest(
      user.organizationId,
      updateEducationPurchaseRequestSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  // ─── Enquiries ───────────────────────────────────────────────────────────

  @Get("enquiries")
  @RequirePermissions("pops.read")
  listEnquiries(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.extra.listEnquiries(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("enquiries")
  @RequirePermissions("pops.inventory.manage")
  createEnquiry(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.createEnquiry(
      user.organizationId,
      createEducationEnquirySchema.parse(body),
      user.sub,
    );
  }

  @Patch("enquiries/:id")
  @RequirePermissions("pops.inventory.manage")
  updateEnquiry(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.extra.updateEnquiry(
      user.organizationId,
      updateEducationEnquirySchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Post("enquiries/:id/convert")
  @RequirePermissions("pops.inventory.manage")
  convertEnquiry(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string) {
    return this.extra.convertEnquiryToAdmission(user.organizationId, id, user.sub);
  }

  // ─── Events ──────────────────────────────────────────────────────────────

  @Get("events")
  @RequirePermissions("pops.read")
  listEvents(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.extra.listEvents(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("events")
  @RequirePermissions("pops.inventory.manage")
  createEvent(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.createEvent(user.organizationId, createEducationEventSchema.parse(body), user.sub);
  }

  @Patch("events/:id")
  @RequirePermissions("pops.inventory.manage")
  updateEvent(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.extra.updateEvent(
      user.organizationId,
      updateEducationEventSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Get("event-participants")
  @RequirePermissions("pops.read")
  listEventParticipants(@CurrentUser() user: AccessJwtPayload, @Query("eventId") eventId: string) {
    return this.extra.listEventParticipants(user.organizationId, eventId?.trim() ?? "");
  }

  @Post("event-participants")
  @RequirePermissions("pops.inventory.manage")
  createEventParticipant(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.createEventParticipant(
      user.organizationId,
      createEducationEventParticipantSchema.parse(body),
      user.sub,
    );
  }

  @Patch("event-participants/:id")
  @RequirePermissions("pops.inventory.manage")
  updateEventParticipant(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.extra.updateEventParticipant(
      user.organizationId,
      updateEducationEventParticipantSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  // ─── Alumni ──────────────────────────────────────────────────────────────

  @Get("alumni")
  @RequirePermissions("pops.read")
  listAlumni(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.extra.listAlumni(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("alumni")
  @RequirePermissions("pops.inventory.manage")
  createAlumni(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.createAlumni(
      user.organizationId,
      createEducationAlumniSchema.parse(body),
      user.sub,
    );
  }

  @Patch("alumni/:id")
  @RequirePermissions("pops.inventory.manage")
  updateAlumni(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.extra.updateAlumni(
      user.organizationId,
      updateEducationAlumniSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Post("alumni/convert-from-student")
  @RequirePermissions("pops.inventory.manage")
  convertAlumniFromStudent(
    @CurrentUser() user: AccessJwtPayload,
    @Body() body: { studentId: string; branchCode: string; graduationYear?: number },
  ) {
    return this.extra.convertStudentToAlumni(
      user.organizationId,
      body.studentId,
      { branchCode: body.branchCode, graduationYear: body.graduationYear },
      user.sub,
    );
  }

  // ─── Health ──────────────────────────────────────────────────────────────

  @Get("health-records")
  @RequirePermissions("pops.read")
  listHealthRecords(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.extra.listHealthRecords(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("health-records")
  @RequirePermissions("pops.inventory.manage")
  createHealthRecord(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.createHealthRecord(
      user.organizationId,
      createEducationHealthRecordSchema.parse(body),
      user.sub,
    );
  }

  @Patch("health-records/:id")
  @RequirePermissions("pops.inventory.manage")
  updateHealthRecord(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.extra.updateHealthRecord(
      user.organizationId,
      updateEducationHealthRecordSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Get("health-visits")
  @RequirePermissions("pops.read")
  listHealthVisits(@CurrentUser() user: AccessJwtPayload, @Query("healthRecordId") healthRecordId: string) {
    return this.extra.listHealthVisits(user.organizationId, healthRecordId?.trim() ?? "");
  }

  @Post("health-visits")
  @RequirePermissions("pops.inventory.manage")
  createHealthVisit(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.createHealthVisit(
      user.organizationId,
      createEducationHealthVisitSchema.parse(body),
      user.sub,
    );
  }

  // ─── Hostels ─────────────────────────────────────────────────────────────

  @Get("hostels")
  @RequirePermissions("pops.read")
  listHostels(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.extra.listHostels(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("hostels")
  @RequirePermissions("pops.inventory.manage")
  createHostel(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.createHostel(
      user.organizationId,
      createEducationHostelSchema.parse(body),
      user.sub,
    );
  }

  @Patch("hostels/:id")
  @RequirePermissions("pops.inventory.manage")
  updateHostel(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.extra.updateHostel(
      user.organizationId,
      updateEducationHostelSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Get("hostel-rooms")
  @RequirePermissions("pops.read")
  listHostelRooms(@CurrentUser() user: AccessJwtPayload, @Query("hostelId") hostelId: string) {
    return this.extra.listHostelRooms(user.organizationId, hostelId?.trim() ?? "");
  }

  @Post("hostel-rooms")
  @RequirePermissions("pops.inventory.manage")
  createHostelRoom(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.createHostelRoom(
      user.organizationId,
      createEducationHostelRoomSchema.parse(body),
      user.sub,
    );
  }

  @Patch("hostel-rooms/:id")
  @RequirePermissions("pops.inventory.manage")
  updateHostelRoom(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.extra.updateHostelRoom(
      user.organizationId,
      updateEducationHostelRoomSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Get("hostel-beds")
  @RequirePermissions("pops.read")
  listHostelBeds(@CurrentUser() user: AccessJwtPayload, @Query("hostelRoomId") hostelRoomId: string) {
    return this.extra.listHostelBeds(user.organizationId, hostelRoomId?.trim() ?? "");
  }

  @Post("hostel-beds")
  @RequirePermissions("pops.inventory.manage")
  createHostelBed(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.createHostelBed(
      user.organizationId,
      createEducationHostelBedSchema.parse(body),
      user.sub,
    );
  }

  @Patch("hostel-beds/:id")
  @RequirePermissions("pops.inventory.manage")
  updateHostelBed(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.extra.updateHostelBed(
      user.organizationId,
      updateEducationHostelBedSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Get("hostel-allocations")
  @RequirePermissions("pops.read")
  listHostelAllocations(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.extra.listHostelAllocations(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("hostel-allocations")
  @RequirePermissions("pops.inventory.manage")
  createHostelAllocation(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.createHostelAllocation(
      user.organizationId,
      createEducationHostelAllocationSchema.parse(body),
      user.sub,
    );
  }

  @Patch("hostel-allocations/:id")
  @RequirePermissions("pops.inventory.manage")
  updateHostelAllocation(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.extra.updateHostelAllocation(
      user.organizationId,
      updateEducationHostelAllocationSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  // ─── Custom Fields ───────────────────────────────────────────────────────

  @Get("custom-fields")
  @RequirePermissions("pops.read")
  listCustomFields(@CurrentUser() user: AccessJwtPayload, @Query("entityType") entityType?: string) {
    return this.extra.listCustomFieldDefs(user.organizationId, entityType?.trim());
  }

  @Get("custom-field-defs")
  @RequirePermissions("pops.read")
  listCustomFieldsAlias(@CurrentUser() user: AccessJwtPayload, @Query("entityType") entityType?: string) {
    return this.extra.listCustomFieldDefs(user.organizationId, entityType?.trim());
  }

  @Post("custom-fields")
  @RequirePermissions("pops.inventory.manage")
  createCustomField(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.createCustomFieldDef(
      user.organizationId,
      createEducationCustomFieldDefSchema.parse(body),
      user.sub,
    );
  }

  @Post("custom-field-defs")
  @RequirePermissions("pops.inventory.manage")
  createCustomFieldAlias(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.createCustomFieldDef(
      user.organizationId,
      createEducationCustomFieldDefSchema.parse(body),
      user.sub,
    );
  }

  @Patch("custom-fields/:id")
  @RequirePermissions("pops.inventory.manage")
  updateCustomField(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.extra.updateCustomFieldDef(
      user.organizationId,
      updateEducationCustomFieldDefSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Patch("custom-field-defs/:id")
  @RequirePermissions("pops.inventory.manage")
  updateCustomFieldAlias(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.extra.updateCustomFieldDef(
      user.organizationId,
      updateEducationCustomFieldDefSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Get("custom-field-values")
  @RequirePermissions("pops.read")
  listCustomFieldValues(
    @CurrentUser() user: AccessJwtPayload,
    @Query("entityType") entityType?: string,
    @Query("entityId") entityId?: string,
  ) {
    return this.extra.listCustomFieldValues(user.organizationId, entityType?.trim(), entityId?.trim());
  }

  @Post("custom-field-values")
  @RequirePermissions("pops.inventory.manage")
  upsertCustomFieldValue(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.upsertCustomFieldValue(
      user.organizationId,
      createEducationCustomFieldValueSchema.parse(body),
      user.sub,
    );
  }

  @Patch("custom-field-values/:id")
  @RequirePermissions("pops.inventory.manage")
  updateCustomFieldValue(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.extra.updateCustomFieldValue(
      user.organizationId,
      updateEducationCustomFieldValueSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  // ─── Workflows / Notification Rules ──────────────────────────────────────

  @Get("workflows")
  @RequirePermissions("pops.read")
  listWorkflows(@CurrentUser() user: AccessJwtPayload) {
    return this.extra.listWorkflows(user.organizationId);
  }

  @Get("workflow-defs")
  @RequirePermissions("pops.read")
  listWorkflowsAlias(@CurrentUser() user: AccessJwtPayload) {
    return this.extra.listWorkflows(user.organizationId);
  }

  @Post("workflows")
  @RequirePermissions("pops.inventory.manage")
  createWorkflow(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.createWorkflow(
      user.organizationId,
      createEducationWorkflowDefSchema.parse(body),
      user.sub,
    );
  }

  @Post("workflow-defs")
  @RequirePermissions("pops.inventory.manage")
  createWorkflowAlias(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.createWorkflow(
      user.organizationId,
      createEducationWorkflowDefSchema.parse(body),
      user.sub,
    );
  }

  @Patch("workflows/:id")
  @RequirePermissions("pops.inventory.manage")
  updateWorkflow(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.extra.updateWorkflow(
      user.organizationId,
      updateEducationWorkflowDefSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Patch("workflow-defs/:id")
  @RequirePermissions("pops.inventory.manage")
  updateWorkflowAlias(@CurrentUser() user: AccessJwtPayload, @Param("id") id: string, @Body() body: unknown) {
    return this.extra.updateWorkflow(
      user.organizationId,
      updateEducationWorkflowDefSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }

  @Get("notification-rules")
  @RequirePermissions("pops.read")
  listNotificationRules(@CurrentUser() user: AccessJwtPayload) {
    return this.extra.listNotificationRules(user.organizationId);
  }

  @Post("notification-rules")
  @RequirePermissions("pops.inventory.manage")
  createNotificationRule(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.extra.createNotificationRule(
      user.organizationId,
      createEducationNotificationRuleSchema.parse(body),
      user.sub,
    );
  }

  @Patch("notification-rules/:id")
  @RequirePermissions("pops.inventory.manage")
  updateNotificationRule(
    @CurrentUser() user: AccessJwtPayload,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.extra.updateNotificationRule(
      user.organizationId,
      updateEducationNotificationRuleSchema.parse({ ...(body as object), id }),
      user.sub,
    );
  }
}
