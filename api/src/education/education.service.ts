import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  CreateEducationAcademicSession,
  CreateEducationAdmission,
  UpdateEducationAdmission,
  CreateEducationClass,
  CreateEducationFeeInvoice,
  CreateEducationFeePayment,
  CreateEducationFeeStructure,
  CreateEducationLookup,
  CreateEducationSection,
  CreateEducationStudent,
  CreateEducationSubject,
  EducationLookupCategory,
  UpdateEducationLookup,
  UpdateEducationStudent,
  UpsertEducationModule,
  UpsertEducationSetting,
} from "@platform/contracts";
import { EDUCATION_MODULES } from "@platform/contracts";
import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import {
  educationAcademicSessions,
  educationAdmissions,
  educationClasses,
  educationExams,
  educationFeeInvoices,
  educationFeePayments,
  educationFeeStructures,
  educationLookups,
  educationModules,
  educationPeriods,
  educationRooms,
  educationSections,
  educationSettings,
  educationStaff,
  educationStudents,
  educationSubjects,
  educationTeachers,
  popsBranches,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../drizzle/drizzle.tokens";

const DEFAULT_LOOKUPS: Array<{ category: EducationLookupCategory; code: string; label: string; sortOrder: number }> = [
  { category: "student_status", code: "active", label: "Active", sortOrder: 1 },
  { category: "student_status", code: "inactive", label: "Inactive", sortOrder: 2 },
  { category: "student_status", code: "alumni", label: "Alumni", sortOrder: 3 },
  { category: "student_status", code: "suspended", label: "Suspended", sortOrder: 4 },
  { category: "student_status", code: "transferred", label: "Transferred", sortOrder: 5 },
  { category: "admission_type", code: "new", label: "New Admission", sortOrder: 1 },
  { category: "admission_type", code: "transfer", label: "Transfer", sortOrder: 2 },
  { category: "admission_type", code: "re_admission", label: "Re-admission", sortOrder: 3 },
  { category: "admission_status", code: "application", label: "Application", sortOrder: 1 },
  { category: "admission_status", code: "under_review", label: "Under Review", sortOrder: 2 },
  { category: "admission_status", code: "accepted", label: "Accepted", sortOrder: 3 },
  { category: "admission_status", code: "rejected", label: "Rejected", sortOrder: 4 },
  { category: "admission_status", code: "enrolled", label: "Enrolled", sortOrder: 5 },
  { category: "attendance_status", code: "present", label: "Present", sortOrder: 1 },
  { category: "attendance_status", code: "absent", label: "Absent", sortOrder: 2 },
  { category: "attendance_status", code: "late", label: "Late", sortOrder: 3 },
  { category: "attendance_status", code: "excused", label: "Excused", sortOrder: 4 },
  { category: "attendance_status", code: "leave", label: "On Leave", sortOrder: 5 },
  { category: "fee_type", code: "tuition", label: "Tuition Fee", sortOrder: 1 },
  { category: "fee_type", code: "admission", label: "Admission Fee", sortOrder: 2 },
  { category: "fee_type", code: "transport", label: "Transport Fee", sortOrder: 3 },
  { category: "fee_type", code: "library", label: "Library Fee", sortOrder: 4 },
  { category: "fee_type", code: "exam", label: "Exam Fee", sortOrder: 5 },
  { category: "fee_type", code: "other", label: "Other", sortOrder: 6 },
  { category: "payment_method", code: "cash", label: "Cash", sortOrder: 1 },
  { category: "payment_method", code: "bank_transfer", label: "Bank Transfer", sortOrder: 2 },
  { category: "payment_method", code: "card", label: "Card", sortOrder: 3 },
  { category: "payment_method", code: "cheque", label: "Cheque", sortOrder: 4 },
  { category: "payment_method", code: "online", label: "Online", sortOrder: 5 },
  { category: "expense_category", code: "utilities", label: "Utilities", sortOrder: 1 },
  { category: "expense_category", code: "salaries", label: "Salaries", sortOrder: 2 },
  { category: "expense_category", code: "maintenance", label: "Maintenance", sortOrder: 3 },
  { category: "expense_category", code: "supplies", label: "Supplies", sortOrder: 4 },
  { category: "expense_category", code: "other", label: "Other", sortOrder: 5 },
  { category: "exam_type", code: "midterm", label: "Midterm", sortOrder: 1 },
  { category: "exam_type", code: "final", label: "Final", sortOrder: 2 },
  { category: "exam_type", code: "quiz", label: "Quiz", sortOrder: 3 },
  { category: "exam_type", code: "practical", label: "Practical", sortOrder: 4 },
  { category: "grade_band", code: "A+", label: "A+", sortOrder: 1 },
  { category: "grade_band", code: "A", label: "A", sortOrder: 2 },
  { category: "grade_band", code: "B", label: "B", sortOrder: 3 },
  { category: "grade_band", code: "C", label: "C", sortOrder: 4 },
  { category: "grade_band", code: "D", label: "D", sortOrder: 5 },
  { category: "grade_band", code: "F", label: "F", sortOrder: 6 },
  { category: "leave_type", code: "sick", label: "Sick Leave", sortOrder: 1 },
  { category: "leave_type", code: "casual", label: "Casual Leave", sortOrder: 2 },
  { category: "leave_type", code: "emergency", label: "Emergency Leave", sortOrder: 3 },
  { category: "leave_type", code: "other", label: "Other", sortOrder: 4 },
  { category: "document_type", code: "birth_certificate", label: "Birth Certificate", sortOrder: 1 },
  { category: "document_type", code: "id_card", label: "ID Card", sortOrder: 2 },
  { category: "document_type", code: "transcript", label: "Transcript", sortOrder: 3 },
  { category: "document_type", code: "photo", label: "Photograph", sortOrder: 4 },
  { category: "document_type", code: "other", label: "Other", sortOrder: 5 },
  { category: "notice_category", code: "general", label: "General", sortOrder: 1 },
  { category: "notice_category", code: "academic", label: "Academic", sortOrder: 2 },
  { category: "notice_category", code: "fee", label: "Fee", sortOrder: 3 },
  { category: "notice_category", code: "event", label: "Event", sortOrder: 4 },
  { category: "notice_category", code: "urgent", label: "Urgent", sortOrder: 5 },
  { category: "book_category", code: "textbook", label: "Textbook", sortOrder: 1 },
  { category: "book_category", code: "reference", label: "Reference", sortOrder: 2 },
  { category: "book_category", code: "fiction", label: "Fiction", sortOrder: 3 },
  { category: "book_category", code: "magazine", label: "Magazine", sortOrder: 4 },
  { category: "vehicle_type", code: "bus", label: "Bus", sortOrder: 1 },
  { category: "vehicle_type", code: "van", label: "Van", sortOrder: 2 },
  { category: "vehicle_type", code: "car", label: "Car", sortOrder: 3 },
  { category: "employment_type", code: "full_time", label: "Full Time", sortOrder: 1 },
  { category: "employment_type", code: "part_time", label: "Part Time", sortOrder: 2 },
  { category: "employment_type", code: "contract", label: "Contract", sortOrder: 3 },
  { category: "employment_type", code: "visiting", label: "Visiting", sortOrder: 4 },
  { category: "staff_category", code: "teaching", label: "Teaching", sortOrder: 1 },
  { category: "staff_category", code: "admin", label: "Admin", sortOrder: 2 },
  { category: "staff_category", code: "support", label: "Support", sortOrder: 3 },
  { category: "relationship", code: "father", label: "Father", sortOrder: 1 },
  { category: "relationship", code: "mother", label: "Mother", sortOrder: 2 },
  { category: "relationship", code: "guardian", label: "Guardian", sortOrder: 3 },
  { category: "relationship", code: "other", label: "Other", sortOrder: 4 },
  { category: "gender", code: "male", label: "Male", sortOrder: 1 },
  { category: "gender", code: "female", label: "Female", sortOrder: 2 },
  { category: "gender", code: "other", label: "Other", sortOrder: 3 },
  { category: "institution_type", code: "school", label: "School", sortOrder: 1 },
  { category: "institution_type", code: "college", label: "College", sortOrder: 2 },
  { category: "institution_type", code: "university", label: "University", sortOrder: 3 },
  { category: "institution_type", code: "academy", label: "Academy", sortOrder: 4 },
  { category: "discipline_type", code: "misconduct", label: "Misconduct", sortOrder: 1 },
  { category: "discipline_type", code: "bullying", label: "Bullying", sortOrder: 2 },
  { category: "discipline_type", code: "attendance", label: "Attendance Issue", sortOrder: 3 },
  { category: "discipline_type", code: "other", label: "Other", sortOrder: 4 },
  { category: "discipline_action", code: "warning", label: "Warning", sortOrder: 1 },
  { category: "discipline_action", code: "suspension", label: "Suspension", sortOrder: 2 },
  { category: "discipline_action", code: "counseling", label: "Counseling", sortOrder: 3 },
  { category: "discipline_action", code: "expulsion", label: "Expulsion", sortOrder: 4 },
  { category: "severity", code: "low", label: "Low", sortOrder: 1 },
  { category: "severity", code: "medium", label: "Medium", sortOrder: 2 },
  { category: "severity", code: "high", label: "High", sortOrder: 3 },
  { category: "severity", code: "critical", label: "Critical", sortOrder: 4 },
  { category: "scholarship_type", code: "merit", label: "Merit", sortOrder: 1 },
  { category: "scholarship_type", code: "need", label: "Need-based", sortOrder: 2 },
  { category: "scholarship_type", code: "sports", label: "Sports", sortOrder: 3 },
  { category: "scholarship_type", code: "other", label: "Other", sortOrder: 4 },
  { category: "room_type", code: "classroom", label: "Classroom", sortOrder: 1 },
  { category: "room_type", code: "lab", label: "Lab", sortOrder: 2 },
  { category: "room_type", code: "office", label: "Office", sortOrder: 3 },
  { category: "room_type", code: "hall", label: "Hall", sortOrder: 4 },
  { category: "equipment_category", code: "computer", label: "Computer", sortOrder: 1 },
  { category: "equipment_category", code: "projector", label: "Projector", sortOrder: 2 },
  { category: "equipment_category", code: "lab_instrument", label: "Lab Instrument", sortOrder: 3 },
  { category: "equipment_category", code: "other", label: "Other", sortOrder: 4 },
  { category: "equipment_condition", code: "new", label: "New", sortOrder: 1 },
  { category: "equipment_condition", code: "good", label: "Good", sortOrder: 2 },
  { category: "equipment_condition", code: "fair", label: "Fair", sortOrder: 3 },
  { category: "equipment_condition", code: "poor", label: "Poor", sortOrder: 4 },
  { category: "enquiry_source", code: "walk_in", label: "Walk-in", sortOrder: 1 },
  { category: "enquiry_source", code: "phone", label: "Phone", sortOrder: 2 },
  { category: "enquiry_source", code: "website", label: "Website", sortOrder: 3 },
  { category: "enquiry_source", code: "referral", label: "Referral", sortOrder: 4 },
  { category: "enquiry_status", code: "new", label: "New", sortOrder: 1 },
  { category: "enquiry_status", code: "contacted", label: "Contacted", sortOrder: 2 },
  { category: "enquiry_status", code: "follow_up", label: "Follow-up", sortOrder: 3 },
  { category: "enquiry_status", code: "converted", label: "Converted", sortOrder: 4 },
  { category: "enquiry_status", code: "closed", label: "Closed", sortOrder: 5 },
  { category: "enquiry_status", code: "lost", label: "Lost", sortOrder: 6 },
  { category: "event_type", code: "academic", label: "Academic", sortOrder: 1 },
  { category: "event_type", code: "sports", label: "Sports", sortOrder: 2 },
  { category: "event_type", code: "cultural", label: "Cultural", sortOrder: 3 },
  { category: "event_type", code: "meeting", label: "Meeting", sortOrder: 4 },
  { category: "alumni_status", code: "active", label: "Active", sortOrder: 1 },
  { category: "alumni_status", code: "inactive", label: "Inactive", sortOrder: 2 },
  { category: "alumni_status", code: "deceased", label: "Deceased", sortOrder: 3 },
  { category: "hostel_type", code: "boys", label: "Boys", sortOrder: 1 },
  { category: "hostel_type", code: "girls", label: "Girls", sortOrder: 2 },
  { category: "hostel_type", code: "mixed", label: "Mixed", sortOrder: 3 },
  { category: "leave_status", code: "draft", label: "Draft", sortOrder: 1 },
  { category: "leave_status", code: "pending", label: "Pending", sortOrder: 2 },
  { category: "leave_status", code: "approved", label: "Approved", sortOrder: 3 },
  { category: "leave_status", code: "rejected", label: "Rejected", sortOrder: 4 },
  { category: "leave_status", code: "cancelled", label: "Cancelled", sortOrder: 5 },
];

@Injectable()
export class EducationService {
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

  private mapLookup(row: typeof educationLookups.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      category: row.category as EducationLookupCategory,
      code: row.code,
      label: row.label,
      sortOrder: row.sortOrder,
      metaJson: row.metaJson,
      isActive: row.isActive,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  private mapModule(row: typeof educationModules.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      moduleKey: row.moduleKey,
      enabled: row.enabled,
      sortOrder: row.sortOrder,
      updatedAt: this.iso(row.updatedAt)!,
    };
  }

  private mapSetting(row: typeof educationSettings.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      key: row.key,
      valueJson: row.valueJson,
      updatedAt: this.iso(row.updatedAt)!,
    };
  }

  private mapSession(row: typeof educationAcademicSessions.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      name: row.name,
      code: row.code,
      startDate: row.startDate,
      endDate: row.endDate,
      isCurrent: row.isCurrent,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  private mapClass(row: typeof educationClasses.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      sessionId: row.sessionId,
      name: row.name,
      code: row.code,
      level: row.level,
      sortOrder: row.sortOrder,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  private mapSection(row: typeof educationSections.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      classId: row.classId,
      name: row.name,
      code: row.code,
      capacity: row.capacity,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  private mapSubject(row: typeof educationSubjects.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      name: row.name,
      code: row.code,
      creditHours: row.creditHours,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  private mapStudent(row: typeof educationStudents.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      studentNumber: row.studentNumber,
      admissionNumber: row.admissionNumber,
      firstName: row.firstName,
      lastName: row.lastName,
      fatherName: row.fatherName,
      motherName: row.motherName,
      dateOfBirth: row.dateOfBirth,
      genderCode: row.genderCode,
      phone: row.phone,
      email: row.email,
      address: row.address,
      photoUrl: row.photoUrl,
      admissionDate: row.admissionDate,
      statusCode: row.statusCode,
      classId: row.classId,
      sectionId: row.sectionId,
      sessionId: row.sessionId,
      customFieldsJson: row.customFieldsJson,
      createdAt: this.iso(row.createdAt)!,
      updatedAt: this.iso(row.updatedAt)!,
    };
  }

  private mapAdmission(row: typeof educationAdmissions.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      applicationNumber: row.applicationNumber,
      applicantName: row.applicantName,
      fatherName: row.fatherName,
      phone: row.phone,
      email: row.email,
      admissionTypeCode: row.admissionTypeCode,
      statusCode: row.statusCode,
      classId: row.classId,
      sessionId: row.sessionId,
      notes: row.notes,
      createdAt: this.iso(row.createdAt)!,
      updatedAt: this.iso(row.updatedAt)!,
    };
  }

  private mapFeeStructure(row: typeof educationFeeStructures.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      name: row.name,
      feeTypeCode: row.feeTypeCode,
      amountPkr: row.amountPkr,
      frequency: row.frequency,
      classId: row.classId,
      sessionId: row.sessionId,
      status: row.status,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  private mapFeeInvoice(row: typeof educationFeeInvoices.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      studentId: row.studentId,
      voucherNumber: row.voucherNumber,
      feeTypeCode: row.feeTypeCode,
      title: row.title,
      amountPkr: row.amountPkr,
      paidPkr: row.paidPkr,
      dueDate: row.dueDate,
      status: row.status,
      sessionId: row.sessionId,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  private mapFeePayment(row: typeof educationFeePayments.$inferSelect) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      invoiceId: row.invoiceId,
      studentId: row.studentId,
      receiptNumber: row.receiptNumber,
      amountPkr: row.amountPkr,
      paymentMethodCode: row.paymentMethodCode,
      paidAt: this.iso(row.paidAt)!,
      notes: row.notes,
      createdAt: this.iso(row.createdAt)!,
    };
  }

  async bootstrapDefaults(organizationId: string, branchCode?: string) {
    const branch = branchCode ? await this.resolveBranch(organizationId, branchCode) : null;

    for (const [index, moduleKey] of EDUCATION_MODULES.entries()) {
      const [existing] = await this.db
        .select()
        .from(educationModules)
        .where(and(eq(educationModules.organizationId, organizationId), eq(educationModules.moduleKey, moduleKey)))
        .limit(1);
      if (existing) {
        await this.db
          .update(educationModules)
          .set({ enabled: true, sortOrder: index, updatedAt: new Date() })
          .where(eq(educationModules.id, existing.id));
      } else {
        await this.db.insert(educationModules).values({
          organizationId,
          moduleKey,
          enabled: true,
          sortOrder: index,
        });
      }
    }

    for (const lookup of DEFAULT_LOOKUPS) {
      const conditions = [
        eq(educationLookups.organizationId, organizationId),
        eq(educationLookups.category, lookup.category),
        eq(educationLookups.code, lookup.code),
      ];
      if (branch) {
        conditions.push(eq(educationLookups.branchId, branch.id));
      } else {
        conditions.push(isNull(educationLookups.branchId));
      }
      const [existing] = await this.db
        .select()
        .from(educationLookups)
        .where(and(...conditions))
        .limit(1);
      if (existing) continue;
      await this.db.insert(educationLookups).values({
        organizationId,
        branchId: branch?.id ?? null,
        category: lookup.category,
        code: lookup.code,
        label: lookup.label,
        sortOrder: lookup.sortOrder,
        isActive: true,
      });
    }

    const seedBranch = branch ?? (await this.resolveBranch(organizationId, "MAIN"));

    const [existingSession] = await this.db
      .select()
      .from(educationAcademicSessions)
      .where(
        and(
          eq(educationAcademicSessions.organizationId, organizationId),
          eq(educationAcademicSessions.branchId, seedBranch.id),
        ),
      )
      .limit(1);
    if (!existingSession) {
      const year = new Date().getFullYear();
      await this.db.insert(educationAcademicSessions).values({
        organizationId,
        branchId: seedBranch.id,
        name: `Academic Year ${year}-${year + 1}`,
        code: `AY-${year}`,
        startDate: `${year}-09-01`,
        endDate: `${year + 1}-06-30`,
        isCurrent: true,
        status: "active",
      });
    }

    const [existingPeriod] = await this.db
      .select()
      .from(educationPeriods)
      .where(
        and(eq(educationPeriods.organizationId, organizationId), eq(educationPeriods.branchId, seedBranch.id)),
      )
      .limit(1);
    if (!existingPeriod) {
      await this.db.insert(educationPeriods).values([
        {
          organizationId,
          branchId: seedBranch.id,
          name: "Morning1",
          startTime: "08:00",
          endTime: "08:45",
          sortOrder: 1,
          isBreak: false,
          status: "active",
        },
        {
          organizationId,
          branchId: seedBranch.id,
          name: "Morning2",
          startTime: "08:50",
          endTime: "09:35",
          sortOrder: 2,
          isBreak: false,
          status: "active",
        },
      ]);
    }

    const [existingRoom] = await this.db
      .select()
      .from(educationRooms)
      .where(and(eq(educationRooms.organizationId, organizationId), eq(educationRooms.branchId, seedBranch.id)))
      .limit(1);
    if (!existingRoom) {
      await this.db.insert(educationRooms).values({
        organizationId,
        branchId: seedBranch.id,
        code: "R101",
        name: "Room 101",
        capacity: 40,
        status: "active",
      });
    }

    return {
      modules: await this.listModules(organizationId),
      lookups: await this.listLookups(organizationId, branchCode),
    };
  }

  async getDashboard(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const branchFilter = and(
      eq(educationStudents.organizationId, organizationId),
      eq(educationStudents.branchId, branch.id),
      isNull(educationStudents.deletedAt),
    );

    const [totalStudentsRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(educationStudents)
      .where(branchFilter);
    const [activeStudentsRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(educationStudents)
      .where(and(branchFilter, eq(educationStudents.statusCode, "active")));
    const [teachersRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(educationTeachers)
      .where(
        and(
          eq(educationTeachers.organizationId, organizationId),
          eq(educationTeachers.branchId, branch.id),
          isNull(educationTeachers.deletedAt),
        ),
      );
    const [staffRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(educationStaff)
      .where(
        and(
          eq(educationStaff.organizationId, organizationId),
          eq(educationStaff.branchId, branch.id),
          isNull(educationStaff.deletedAt),
        ),
      );
    const [pendingAdmissionsRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(educationAdmissions)
      .where(
        and(
          eq(educationAdmissions.organizationId, organizationId),
          eq(educationAdmissions.branchId, branch.id),
          eq(educationAdmissions.statusCode, "application"),
        ),
      );
    const [pendingFeesRow] = await this.db
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
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const [collectedTodayRow] = await this.db
      .select({ total: sql<number>`coalesce(sum(${educationFeePayments.amountPkr}), 0)::int` })
      .from(educationFeePayments)
      .where(
        and(
          eq(educationFeePayments.organizationId, organizationId),
          eq(educationFeePayments.branchId, branch.id),
          gte(educationFeePayments.paidAt, todayStart),
          lte(educationFeePayments.paidAt, todayEnd),
        ),
      );
    const [classesRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(educationClasses)
      .where(and(eq(educationClasses.organizationId, organizationId), eq(educationClasses.branchId, branch.id)));
    const todayIso = new Date().toISOString().slice(0, 10);
    const [upcomingExamsRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(educationExams)
      .where(
        and(
          eq(educationExams.organizationId, organizationId),
          eq(educationExams.branchId, branch.id),
          sql`${educationExams.status} in ('scheduled', 'active', 'draft')`,
          sql`(${educationExams.startDate} is null or ${educationExams.startDate} >= ${todayIso})`,
        ),
      );

    return {
      totalStudents: Number(totalStudentsRow?.count ?? 0),
      activeStudents: Number(activeStudentsRow?.count ?? 0),
      totalTeachers: Number(teachersRow?.count ?? 0),
      totalStaff: Number(staffRow?.count ?? 0),
      pendingAdmissions: Number(pendingAdmissionsRow?.count ?? 0),
      pendingFeesPkr: Number(pendingFeesRow?.total ?? 0),
      collectedTodayPkr: Number(collectedTodayRow?.total ?? 0),
      classesCount: Number(classesRow?.count ?? 0),
      upcomingExams: Number(upcomingExamsRow?.count ?? 0),
    };
  }

  async listLookups(organizationId: string, branchCode?: string, category?: string) {
    const branch = await this.resolveOptionalBranch(organizationId, branchCode);
    const conditions = [eq(educationLookups.organizationId, organizationId)];
    if (branch) conditions.push(eq(educationLookups.branchId, branch.id));
    if (category) conditions.push(eq(educationLookups.category, category));
    const rows = await this.db
      .select()
      .from(educationLookups)
      .where(and(...conditions))
      .orderBy(asc(educationLookups.category), asc(educationLookups.sortOrder), asc(educationLookups.label));
    return rows.map((r) => this.mapLookup(r));
  }

  async createLookup(organizationId: string, input: CreateEducationLookup) {
    const branch = await this.resolveOptionalBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationLookups)
      .values({
        organizationId,
        branchId: branch?.id ?? null,
        category: input.category,
        code: input.code,
        label: input.label,
        sortOrder: input.sortOrder ?? 0,
        metaJson: input.metaJson ?? null,
        isActive: input.isActive ?? true,
      })
      .returning();
    return this.mapLookup(row!);
  }

  async updateLookup(organizationId: string, input: UpdateEducationLookup) {
    const [existing] = await this.db
      .select()
      .from(educationLookups)
      .where(and(eq(educationLookups.id, input.id), eq(educationLookups.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Lookup not found");

    const branch =
      input.branchCode !== undefined
        ? await this.resolveOptionalBranch(organizationId, input.branchCode)
        : undefined;

    const [row] = await this.db
      .update(educationLookups)
      .set({
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.metaJson !== undefined ? { metaJson: input.metaJson } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(branch !== undefined ? { branchId: branch?.id ?? null } : {}),
      })
      .where(eq(educationLookups.id, input.id))
      .returning();
    return this.mapLookup(row!);
  }

  async listModules(organizationId: string) {
    const rows = await this.db
      .select()
      .from(educationModules)
      .where(eq(educationModules.organizationId, organizationId))
      .orderBy(asc(educationModules.sortOrder), asc(educationModules.moduleKey));
    return rows.map((r) => this.mapModule(r));
  }

  async upsertModule(organizationId: string, input: UpsertEducationModule) {
    const [existing] = await this.db
      .select()
      .from(educationModules)
      .where(and(eq(educationModules.organizationId, organizationId), eq(educationModules.moduleKey, input.moduleKey)))
      .limit(1);
    if (existing) {
      const [row] = await this.db
        .update(educationModules)
        .set({
          enabled: input.enabled,
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          updatedAt: new Date(),
        })
        .where(eq(educationModules.id, existing.id))
        .returning();
      return this.mapModule(row!);
    }
    const [row] = await this.db
      .insert(educationModules)
      .values({
        organizationId,
        moduleKey: input.moduleKey,
        enabled: input.enabled,
        sortOrder: input.sortOrder ?? 0,
      })
      .returning();
    return this.mapModule(row!);
  }

  async listSettings(organizationId: string, branchCode?: string) {
    const branch = await this.resolveOptionalBranch(organizationId, branchCode);
    const conditions = [eq(educationSettings.organizationId, organizationId)];
    if (branch) conditions.push(eq(educationSettings.branchId, branch.id));
    const rows = await this.db
      .select()
      .from(educationSettings)
      .where(and(...conditions))
      .orderBy(asc(educationSettings.key));
    return rows.map((r) => this.mapSetting(r));
  }

  async upsertSetting(organizationId: string, input: UpsertEducationSetting) {
    const branch = await this.resolveOptionalBranch(organizationId, input.branchCode);
    const conditions = [eq(educationSettings.organizationId, organizationId), eq(educationSettings.key, input.key)];
    if (branch) conditions.push(eq(educationSettings.branchId, branch.id));
    else conditions.push(isNull(educationSettings.branchId));

    const [existing] = await this.db
      .select()
      .from(educationSettings)
      .where(and(...conditions))
      .limit(1);
    if (existing) {
      const [row] = await this.db
        .update(educationSettings)
        .set({ valueJson: input.valueJson, updatedAt: new Date() })
        .where(eq(educationSettings.id, existing.id))
        .returning();
      return this.mapSetting(row!);
    }
    const [row] = await this.db
      .insert(educationSettings)
      .values({
        organizationId,
        branchId: branch?.id ?? null,
        key: input.key,
        valueJson: input.valueJson,
      })
      .returning();
    return this.mapSetting(row!);
  }

  async listSessions(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationAcademicSessions)
      .where(
        and(eq(educationAcademicSessions.organizationId, organizationId), eq(educationAcademicSessions.branchId, branch.id)),
      )
      .orderBy(asc(educationAcademicSessions.code));
    return rows.map((r) => this.mapSession(r));
  }

  async createSession(organizationId: string, input: CreateEducationAcademicSession) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    if (input.isCurrent) {
      await this.db
        .update(educationAcademicSessions)
        .set({ isCurrent: false })
        .where(
          and(
            eq(educationAcademicSessions.organizationId, organizationId),
            eq(educationAcademicSessions.branchId, branch.id),
          ),
        );
    }
    const [row] = await this.db
      .insert(educationAcademicSessions)
      .values({
        organizationId,
        branchId: branch.id,
        name: input.name,
        code: input.code,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        isCurrent: input.isCurrent ?? false,
        status: input.status ?? "active",
      })
      .returning();
    return this.mapSession(row!);
  }

  async listClasses(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationClasses)
      .where(and(eq(educationClasses.organizationId, organizationId), eq(educationClasses.branchId, branch.id)))
      .orderBy(asc(educationClasses.sortOrder), asc(educationClasses.name));
    return rows.map((r) => this.mapClass(r));
  }

  async createClass(organizationId: string, input: CreateEducationClass) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationClasses)
      .values({
        organizationId,
        branchId: branch.id,
        sessionId: input.sessionId ?? null,
        name: input.name,
        code: input.code,
        level: input.level ?? null,
        sortOrder: input.sortOrder ?? 0,
        status: input.status ?? "active",
      })
      .returning();
    return this.mapClass(row!);
  }

  async listSections(organizationId: string, branchCode: string, classId?: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const conditions = [
      eq(educationSections.organizationId, organizationId),
      eq(educationSections.branchId, branch.id),
    ];
    if (classId) conditions.push(eq(educationSections.classId, classId));
    const rows = await this.db
      .select()
      .from(educationSections)
      .where(and(...conditions))
      .orderBy(asc(educationSections.name));
    return rows.map((r) => this.mapSection(r));
  }

  async createSection(organizationId: string, input: CreateEducationSection) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationSections)
      .values({
        organizationId,
        branchId: branch.id,
        classId: input.classId,
        name: input.name,
        code: input.code,
        capacity: input.capacity ?? null,
        status: input.status ?? "active",
      })
      .returning();
    return this.mapSection(row!);
  }

  async listSubjects(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationSubjects)
      .where(and(eq(educationSubjects.organizationId, organizationId), eq(educationSubjects.branchId, branch.id)))
      .orderBy(asc(educationSubjects.name));
    return rows.map((r) => this.mapSubject(r));
  }

  async createSubject(organizationId: string, input: CreateEducationSubject) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationSubjects)
      .values({
        organizationId,
        branchId: branch.id,
        name: input.name,
        code: input.code,
        creditHours: input.creditHours ?? null,
        status: input.status ?? "active",
      })
      .returning();
    return this.mapSubject(row!);
  }

  async listStudents(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationStudents)
      .where(
        and(
          eq(educationStudents.organizationId, organizationId),
          eq(educationStudents.branchId, branch.id),
          isNull(educationStudents.deletedAt),
        ),
      )
      .orderBy(asc(educationStudents.studentNumber));
    return rows.map((r) => this.mapStudent(r));
  }

  async createStudent(organizationId: string, input: CreateEducationStudent) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const studentNumber = input.studentNumber?.trim() || this.nextSeq(branch.id, "STU");
    const [row] = await this.db
      .insert(educationStudents)
      .values({
        organizationId,
        branchId: branch.id,
        studentNumber,
        admissionNumber: input.admissionNumber ?? null,
        firstName: input.firstName,
        lastName: input.lastName ?? null,
        fatherName: input.fatherName ?? null,
        motherName: input.motherName ?? null,
        dateOfBirth: input.dateOfBirth ?? null,
        genderCode: input.genderCode ?? null,
        phone: input.phone ?? null,
        email: input.email || null,
        address: input.address ?? null,
        photoUrl: input.photoUrl ?? null,
        admissionDate: input.admissionDate ?? null,
        statusCode: input.statusCode ?? "active",
        classId: input.classId ?? null,
        sectionId: input.sectionId ?? null,
        sessionId: input.sessionId ?? null,
        customFieldsJson: input.customFieldsJson ?? null,
      })
      .returning();
    return this.mapStudent(row!);
  }

  async updateStudent(organizationId: string, input: UpdateEducationStudent) {
    const [existing] = await this.db
      .select()
      .from(educationStudents)
      .where(
        and(
          eq(educationStudents.id, input.id),
          eq(educationStudents.organizationId, organizationId),
          isNull(educationStudents.deletedAt),
        ),
      )
      .limit(1);
    if (!existing) throw new NotFoundException("Student not found");

    const branch =
      input.branchCode !== undefined ? await this.resolveBranch(organizationId, input.branchCode) : undefined;

    const [row] = await this.db
      .update(educationStudents)
      .set({
        ...(branch ? { branchId: branch.id } : {}),
        ...(input.studentNumber !== undefined ? { studentNumber: input.studentNumber } : {}),
        ...(input.admissionNumber !== undefined ? { admissionNumber: input.admissionNumber } : {}),
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
        ...(input.fatherName !== undefined ? { fatherName: input.fatherName } : {}),
        ...(input.motherName !== undefined ? { motherName: input.motherName } : {}),
        ...(input.dateOfBirth !== undefined ? { dateOfBirth: input.dateOfBirth } : {}),
        ...(input.genderCode !== undefined ? { genderCode: input.genderCode } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.email !== undefined ? { email: input.email || null } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.photoUrl !== undefined ? { photoUrl: input.photoUrl } : {}),
        ...(input.admissionDate !== undefined ? { admissionDate: input.admissionDate } : {}),
        ...(input.statusCode !== undefined ? { statusCode: input.statusCode } : {}),
        ...(input.classId !== undefined ? { classId: input.classId } : {}),
        ...(input.sectionId !== undefined ? { sectionId: input.sectionId } : {}),
        ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
        ...(input.customFieldsJson !== undefined ? { customFieldsJson: input.customFieldsJson } : {}),
        updatedAt: new Date(),
      })
      .where(eq(educationStudents.id, input.id))
      .returning();
    return this.mapStudent(row!);
  }

  async listAdmissions(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationAdmissions)
      .where(and(eq(educationAdmissions.organizationId, organizationId), eq(educationAdmissions.branchId, branch.id)))
      .orderBy(asc(educationAdmissions.applicationNumber));
    return rows.map((r) => this.mapAdmission(r));
  }

  async createAdmission(organizationId: string, input: CreateEducationAdmission) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const applicationNumber = this.nextSeq(branch.id, "ADM");
    const [row] = await this.db
      .insert(educationAdmissions)
      .values({
        organizationId,
        branchId: branch.id,
        applicationNumber,
        applicantName: input.applicantName,
        fatherName: input.fatherName ?? null,
        phone: input.phone ?? null,
        email: input.email || null,
        admissionTypeCode: input.admissionTypeCode,
        statusCode: input.statusCode ?? "application",
        classId: input.classId ?? null,
        sessionId: input.sessionId ?? null,
        notes: input.notes ?? null,
      })
      .returning();
    return this.mapAdmission(row!);
  }

  async updateAdmission(organizationId: string, input: UpdateEducationAdmission) {
    const [existing] = await this.db
      .select()
      .from(educationAdmissions)
      .where(
        and(eq(educationAdmissions.id, input.id), eq(educationAdmissions.organizationId, organizationId)),
      )
      .limit(1);
    if (!existing) throw new NotFoundException("Admission not found");
    const branch =
      input.branchCode !== undefined ? await this.resolveBranch(organizationId, input.branchCode) : undefined;
    const [row] = await this.db
      .update(educationAdmissions)
      .set({
        ...(branch ? { branchId: branch.id } : {}),
        ...(input.applicantName !== undefined ? { applicantName: input.applicantName } : {}),
        ...(input.fatherName !== undefined ? { fatherName: input.fatherName } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.email !== undefined ? { email: input.email || null } : {}),
        ...(input.admissionTypeCode !== undefined ? { admissionTypeCode: input.admissionTypeCode } : {}),
        ...(input.statusCode !== undefined ? { statusCode: input.statusCode } : {}),
        ...(input.classId !== undefined ? { classId: input.classId } : {}),
        ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        updatedAt: new Date(),
      })
      .where(eq(educationAdmissions.id, input.id))
      .returning();
    return this.mapAdmission(row!);
  }

  async convertAdmissionToStudent(organizationId: string, admissionId: string) {
    const [admission] = await this.db
      .select()
      .from(educationAdmissions)
      .where(
        and(eq(educationAdmissions.id, admissionId), eq(educationAdmissions.organizationId, organizationId)),
      )
      .limit(1);
    if (!admission) throw new NotFoundException("Admission not found");
    if (admission.statusCode === "enrolled") {
      throw new BadRequestException("Admission already converted to student");
    }
    const nameParts = admission.applicantName.trim().split(/\s+/);
    const firstName = nameParts[0] || admission.applicantName;
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;
    const [branch] = await this.db
      .select()
      .from(popsBranches)
      .where(eq(popsBranches.id, admission.branchId))
      .limit(1);
    if (!branch) throw new NotFoundException("Branch not found for admission");
    const student = await this.createStudent(organizationId, {
      branchCode: branch.code,
      firstName,
      lastName: lastName ?? undefined,
      fatherName: admission.fatherName ?? undefined,
      phone: admission.phone ?? undefined,
      email: admission.email ?? undefined,
      classId: admission.classId ?? undefined,
      sessionId: admission.sessionId ?? undefined,
      admissionNumber: admission.applicationNumber,
      admissionDate: new Date().toISOString().slice(0, 10),
      statusCode: "active",
    });
    const [updated] = await this.db
      .update(educationAdmissions)
      .set({ statusCode: "enrolled", updatedAt: new Date() })
      .where(eq(educationAdmissions.id, admissionId))
      .returning();
    return { admission: this.mapAdmission(updated!), student };
  }

  async listFeeStructures(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationFeeStructures)
      .where(
        and(eq(educationFeeStructures.organizationId, organizationId), eq(educationFeeStructures.branchId, branch.id)),
      )
      .orderBy(asc(educationFeeStructures.name));
    return rows.map((r) => this.mapFeeStructure(r));
  }

  async createFeeStructure(organizationId: string, input: CreateEducationFeeStructure) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(educationFeeStructures)
      .values({
        organizationId,
        branchId: branch.id,
        name: input.name,
        feeTypeCode: input.feeTypeCode,
        amountPkr: input.amountPkr,
        frequency: input.frequency ?? "monthly",
        classId: input.classId ?? null,
        sessionId: input.sessionId ?? null,
        status: input.status ?? "active",
      })
      .returning();
    return this.mapFeeStructure(row!);
  }

  async listFeeInvoices(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationFeeInvoices)
      .where(and(eq(educationFeeInvoices.organizationId, organizationId), eq(educationFeeInvoices.branchId, branch.id)))
      .orderBy(asc(educationFeeInvoices.voucherNumber));
    return rows.map((r) => this.mapFeeInvoice(r));
  }

  async createFeeInvoice(organizationId: string, input: CreateEducationFeeInvoice) {
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

    const voucherNumber = this.nextSeq(branch.id, "FEE");
    const [row] = await this.db
      .insert(educationFeeInvoices)
      .values({
        organizationId,
        branchId: branch.id,
        studentId: input.studentId,
        voucherNumber,
        feeTypeCode: input.feeTypeCode,
        title: input.title,
        amountPkr: input.amountPkr,
        paidPkr: 0,
        dueDate: input.dueDate ?? null,
        status: "pending",
        sessionId: input.sessionId ?? null,
      })
      .returning();
    return this.mapFeeInvoice(row!);
  }

  async listFeePayments(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(educationFeePayments)
      .where(and(eq(educationFeePayments.organizationId, organizationId), eq(educationFeePayments.branchId, branch.id)))
      .orderBy(asc(educationFeePayments.receiptNumber));
    return rows.map((r) => this.mapFeePayment(r));
  }

  async createFeePayment(organizationId: string, input: CreateEducationFeePayment) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [invoice] = await this.db
      .select()
      .from(educationFeeInvoices)
      .where(
        and(eq(educationFeeInvoices.id, input.invoiceId), eq(educationFeeInvoices.organizationId, organizationId)),
      )
      .limit(1);
    if (!invoice) throw new NotFoundException("Fee invoice not found");

    const paidPkr = invoice.paidPkr + input.amountPkr;
    if (paidPkr > invoice.amountPkr) {
      throw new BadRequestException("Payment exceeds invoice balance");
    }
    const status = paidPkr >= invoice.amountPkr ? "paid" : "partial";
    const receiptNumber = this.nextSeq(branch.id, "RCPT");

    const [payment] = await this.db
      .insert(educationFeePayments)
      .values({
        organizationId,
        branchId: branch.id,
        invoiceId: invoice.id,
        studentId: invoice.studentId,
        receiptNumber,
        amountPkr: input.amountPkr,
        paymentMethodCode: input.paymentMethodCode,
        notes: input.notes ?? null,
      })
      .returning();

    await this.db
      .update(educationFeeInvoices)
      .set({ paidPkr, status })
      .where(eq(educationFeeInvoices.id, invoice.id));

    return this.mapFeePayment(payment!);
  }
}
