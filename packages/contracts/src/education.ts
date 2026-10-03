import { z } from "zod";

/** Configurable lookup categories — never hard-code labels in UI business logic. */
export const EDUCATION_LOOKUP_CATEGORIES = [
  "student_status",
  "admission_type",
  "admission_status",
  "attendance_status",
  "fee_type",
  "payment_method",
  "expense_category",
  "exam_type",
  "grade_band",
  "leave_type",
  "document_type",
  "notice_category",
  "book_category",
  "vehicle_type",
  "employment_type",
  "staff_category",
  "relationship",
  "gender",
  "institution_type",
  "salary_component",
  "course_type",
  "audience",
  "discipline_type",
  "discipline_action",
  "severity",
  "scholarship_type",
  "room_type",
  "equipment_category",
  "equipment_condition",
  "enquiry_source",
  "enquiry_status",
  "event_type",
  "alumni_status",
  "hostel_type",
  "complaint_type",
  "leave_status",
] as const;

export const educationLookupCategorySchema = z.enum(EDUCATION_LOOKUP_CATEGORIES);
export type EducationLookupCategory = z.infer<typeof educationLookupCategorySchema>;

export const EDUCATION_MODULES = [
  "dashboard",
  "admissions",
  "students",
  "parents",
  "teachers",
  "staff",
  "academics",
  "classes",
  "sections",
  "departments",
  "programs",
  "courses",
  "batches",
  "timetable",
  "attendance",
  "examinations",
  "results",
  "fees",
  "finance",
  "expenses",
  "payroll",
  "library",
  "transport",
  "communication",
  "documents",
  "reports",
  "users",
  "roles",
  "settings",
  "control_center",
  "leave",
  "discipline",
  "lifecycle",
  "assignments",
  "scholarships",
  "refunds",
  "facilities",
  "labs",
  "equipment",
  "inventory",
  "front_desk",
  "events",
  "alumni",
  "health",
  "hostel",
  "custom_fields",
  "workflows",
  "notification_rules",
  "student_portal",
  "parent_portal",
] as const;

export const educationModuleKeySchema = z.enum(EDUCATION_MODULES);
export type EducationModuleKey = z.infer<typeof educationModuleKeySchema>;

export const educationLookupSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid().nullable().optional(),
  category: educationLookupCategorySchema,
  code: z.string().min(1),
  label: z.string().min(1),
  sortOrder: z.number().int(),
  metaJson: z.string().nullable().optional(),
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type EducationLookup = z.infer<typeof educationLookupSchema>;

export const createEducationLookupSchema = z.object({
  branchCode: z.string().min(1).optional(),
  category: educationLookupCategorySchema,
  code: z.string().min(1).max(64),
  label: z.string().min(1).max(120),
  sortOrder: z.number().int().optional(),
  metaJson: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const updateEducationLookupSchema = createEducationLookupSchema.partial().extend({
  id: z.string().uuid(),
});

export const educationModuleSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  moduleKey: educationModuleKeySchema,
  enabled: z.boolean(),
  sortOrder: z.number().int(),
  updatedAt: z.string(),
});
export type EducationModule = z.infer<typeof educationModuleSchema>;

export const upsertEducationModuleSchema = z.object({
  moduleKey: educationModuleKeySchema,
  enabled: z.boolean(),
  sortOrder: z.number().int().optional(),
});

export const educationSettingSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid().nullable().optional(),
  key: z.string().min(1),
  valueJson: z.string(),
  updatedAt: z.string(),
});
export type EducationSetting = z.infer<typeof educationSettingSchema>;

export const upsertEducationSettingSchema = z.object({
  branchCode: z.string().min(1).optional(),
  key: z.string().min(1).max(120),
  valueJson: z.string().min(1),
});

export const educationAcademicSessionSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  isCurrent: z.boolean(),
  status: z.string(),
  createdAt: z.string(),
});
export type EducationAcademicSession = z.infer<typeof educationAcademicSessionSchema>;

export const createEducationAcademicSessionSchema = z.object({
  branchCode: z.string().min(1),
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(64),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  isCurrent: z.boolean().optional(),
  status: z.string().min(1).max(40).optional(),
});

export const educationClassSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  sessionId: z.string().uuid().nullable().optional(),
  name: z.string(),
  code: z.string(),
  level: z.string().nullable().optional(),
  sortOrder: z.number().int(),
  status: z.string(),
  createdAt: z.string(),
});
export type EducationClass = z.infer<typeof educationClassSchema>;

export const createEducationClassSchema = z.object({
  branchCode: z.string().min(1),
  sessionId: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(64),
  level: z.string().max(64).optional(),
  sortOrder: z.number().int().optional(),
  status: z.string().min(1).max(40).optional(),
});

export const educationSectionSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  classId: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  capacity: z.number().int().nullable().optional(),
  status: z.string(),
  createdAt: z.string(),
});
export type EducationSection = z.infer<typeof educationSectionSchema>;

export const createEducationSectionSchema = z.object({
  branchCode: z.string().min(1),
  classId: z.string().uuid(),
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(64),
  capacity: z.number().int().optional(),
  status: z.string().min(1).max(40).optional(),
});

export const educationSubjectSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  creditHours: z.number().nullable().optional(),
  status: z.string(),
  createdAt: z.string(),
});
export type EducationSubject = z.infer<typeof educationSubjectSchema>;

export const createEducationSubjectSchema = z.object({
  branchCode: z.string().min(1),
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(64),
  creditHours: z.number().optional(),
  status: z.string().min(1).max(40).optional(),
});

export const educationStudentSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  studentNumber: z.string(),
  admissionNumber: z.string().nullable().optional(),
  firstName: z.string(),
  lastName: z.string().nullable().optional(),
  fatherName: z.string().nullable().optional(),
  motherName: z.string().nullable().optional(),
  dateOfBirth: z.string().nullable().optional(),
  genderCode: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  photoUrl: z.string().nullable().optional(),
  admissionDate: z.string().nullable().optional(),
  statusCode: z.string(),
  classId: z.string().uuid().nullable().optional(),
  sectionId: z.string().uuid().nullable().optional(),
  sessionId: z.string().uuid().nullable().optional(),
  customFieldsJson: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EducationStudent = z.infer<typeof educationStudentSchema>;

export const createEducationStudentSchema = z.object({
  branchCode: z.string().min(1),
  studentNumber: z.string().min(1).max(64).optional(),
  admissionNumber: z.string().max(64).optional(),
  firstName: z.string().min(1).max(120),
  lastName: z.string().max(120).optional(),
  fatherName: z.string().max(120).optional(),
  motherName: z.string().max(120).optional(),
  dateOfBirth: z.string().optional(),
  genderCode: z.string().max(40).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().max(500).optional(),
  photoUrl: z.string().max(500).optional(),
  admissionDate: z.string().optional(),
  statusCode: z.string().min(1).max(40).optional(),
  classId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  customFieldsJson: z.string().optional(),
});

export const updateEducationStudentSchema = createEducationStudentSchema.partial().extend({
  id: z.string().uuid(),
});

export const educationFeeStructureSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  name: z.string(),
  feeTypeCode: z.string(),
  amountPkr: z.number().int(),
  frequency: z.string(),
  classId: z.string().uuid().nullable().optional(),
  sessionId: z.string().uuid().nullable().optional(),
  status: z.string(),
  createdAt: z.string(),
});
export type EducationFeeStructure = z.infer<typeof educationFeeStructureSchema>;

export const createEducationFeeStructureSchema = z.object({
  branchCode: z.string().min(1),
  name: z.string().min(1).max(120),
  feeTypeCode: z.string().min(1).max(64),
  amountPkr: z.number().int().min(0),
  frequency: z.string().min(1).max(40).default("monthly"),
  classId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  status: z.string().min(1).max(40).optional(),
});

export const educationFeeInvoiceSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  studentId: z.string().uuid(),
  voucherNumber: z.string(),
  feeTypeCode: z.string(),
  title: z.string(),
  amountPkr: z.number().int(),
  paidPkr: z.number().int(),
  dueDate: z.string().nullable().optional(),
  status: z.string(),
  sessionId: z.string().uuid().nullable().optional(),
  createdAt: z.string(),
});
export type EducationFeeInvoice = z.infer<typeof educationFeeInvoiceSchema>;

export const createEducationFeeInvoiceSchema = z.object({
  branchCode: z.string().min(1),
  studentId: z.string().uuid(),
  feeTypeCode: z.string().min(1).max(64),
  title: z.string().min(1).max(160),
  amountPkr: z.number().int().min(0),
  dueDate: z.string().optional(),
  sessionId: z.string().uuid().optional(),
});

export const educationFeePaymentSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  studentId: z.string().uuid(),
  receiptNumber: z.string(),
  amountPkr: z.number().int(),
  paymentMethodCode: z.string(),
  paidAt: z.string(),
  notes: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type EducationFeePayment = z.infer<typeof educationFeePaymentSchema>;

export const createEducationFeePaymentSchema = z.object({
  branchCode: z.string().min(1),
  invoiceId: z.string().uuid(),
  amountPkr: z.number().int().min(1),
  paymentMethodCode: z.string().min(1).max(64),
  notes: z.string().max(500).optional(),
});

export const educationAdmissionSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  applicationNumber: z.string(),
  applicantName: z.string(),
  fatherName: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  admissionTypeCode: z.string(),
  statusCode: z.string(),
  classId: z.string().uuid().nullable().optional(),
  sessionId: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EducationAdmission = z.infer<typeof educationAdmissionSchema>;

export const createEducationAdmissionSchema = z.object({
  branchCode: z.string().min(1),
  applicantName: z.string().min(1).max(160),
  fatherName: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().email().optional().or(z.literal("")),
  admissionTypeCode: z.string().min(1).max(64),
  statusCode: z.string().min(1).max(40).optional(),
  classId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  notes: z.string().max(1000).optional(),
});

export const updateEducationAdmissionSchema = createEducationAdmissionSchema.partial().extend({
  id: z.string().uuid(),
});
export type UpdateEducationAdmission = z.infer<typeof updateEducationAdmissionSchema>;

export const educationDashboardSchema = z.object({
  totalStudents: z.number().int(),
  activeStudents: z.number().int(),
  totalTeachers: z.number().int(),
  totalStaff: z.number().int(),
  pendingAdmissions: z.number().int(),
  pendingFeesPkr: z.number().int(),
  collectedTodayPkr: z.number().int(),
  classesCount: z.number().int(),
  upcomingExams: z.number().int(),
});
export type EducationDashboard = z.infer<typeof educationDashboardSchema>;

export const educationGuardianSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  fullName: z.string(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  relationshipCode: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  status: z.string(),
  createdAt: z.string(),
});
export type EducationGuardian = z.infer<typeof educationGuardianSchema>;

export const createEducationGuardianSchema = z.object({
  branchCode: z.string().min(1),
  fullName: z.string().min(1).max(160),
  phone: z.string().max(40).optional(),
  email: z.string().email().optional().or(z.literal("")),
  relationshipCode: z.string().max(40).optional(),
  address: z.string().max(500).optional(),
  status: z.string().min(1).max(40).optional(),
  studentId: z.string().uuid().optional(),
  isPrimary: z.boolean().optional(),
});

export const updateEducationGuardianSchema = createEducationGuardianSchema.partial().extend({
  id: z.string().uuid(),
});

export const linkEducationGuardianStudentSchema = z.object({
  studentId: z.string().uuid(),
  isPrimary: z.boolean().optional(),
});

export const educationTeacherSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  employeeNumber: z.string(),
  firstName: z.string(),
  lastName: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  designation: z.string().nullable().optional(),
  employmentTypeCode: z.string().nullable().optional(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EducationTeacher = z.infer<typeof educationTeacherSchema>;

export const createEducationTeacherSchema = z.object({
  branchCode: z.string().min(1),
  employeeNumber: z.string().min(1).max(64).optional(),
  firstName: z.string().min(1).max(120),
  lastName: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().email().optional().or(z.literal("")),
  departmentId: z.string().uuid().optional(),
  designation: z.string().max(120).optional(),
  employmentTypeCode: z.string().max(40).optional(),
  status: z.string().min(1).max(40).optional(),
});

export const updateEducationTeacherSchema = createEducationTeacherSchema.partial().extend({
  id: z.string().uuid(),
});

export const bulkCreateEducationAttendanceSchema = z
  .object({
    branchCode: z.string().min(1),
    /** Shared date for all records when per-record date is omitted. */
    date: z.string().min(1).optional(),
    records: z
      .array(
        z.object({
          date: z.string().min(1).optional(),
          personType: z.enum(["student", "teacher", "staff"]),
          personId: z.string().uuid(),
          classId: z.string().uuid().optional(),
          sectionId: z.string().uuid().optional(),
          batchId: z.string().uuid().optional(),
          statusCode: z.string().min(1).max(40),
          notes: z.string().max(500).optional(),
          markedBy: z.string().uuid().optional(),
        }),
      )
      .min(1),
  })
  .superRefine((val, ctx) => {
    for (let i = 0; i < val.records.length; i += 1) {
      if (!val.records[i]?.date && !val.date) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "date is required (top-level or per record)",
          path: ["records", i, "date"],
        });
      }
    }
  });

export const educationDepartmentSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  status: z.string(),
  createdAt: z.string(),
});
export type EducationDepartment = z.infer<typeof educationDepartmentSchema>;

export const createEducationDepartmentSchema = z.object({
  branchCode: z.string().min(1),
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(64),
  status: z.string().min(1).max(40).optional(),
});

export const updateEducationDepartmentSchema = createEducationDepartmentSchema.partial().extend({
  id: z.string().uuid(),
});

export const educationProgramSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  departmentId: z.string().uuid().nullable().optional(),
  name: z.string(),
  code: z.string(),
  status: z.string(),
  createdAt: z.string(),
});
export type EducationProgram = z.infer<typeof educationProgramSchema>;

export const createEducationProgramSchema = z.object({
  branchCode: z.string().min(1),
  departmentId: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(64),
  status: z.string().min(1).max(40).optional(),
});

export const updateEducationProgramSchema = createEducationProgramSchema.partial().extend({
  id: z.string().uuid(),
});

export const educationCourseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  programId: z.string().uuid().nullable().optional(),
  name: z.string(),
  code: z.string(),
  durationText: z.string().nullable().optional(),
  feePkr: z.number().int(),
  status: z.string(),
  createdAt: z.string(),
});
export type EducationCourse = z.infer<typeof educationCourseSchema>;

export const createEducationCourseSchema = z.object({
  branchCode: z.string().min(1),
  programId: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(64),
  durationText: z.string().max(120).optional(),
  feePkr: z.number().int().min(0).optional(),
  status: z.string().min(1).max(40).optional(),
});

export const updateEducationCourseSchema = createEducationCourseSchema.partial().extend({
  id: z.string().uuid(),
});

export const educationBatchSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  courseId: z.string().uuid().nullable().optional(),
  name: z.string(),
  code: z.string(),
  timingText: z.string().nullable().optional(),
  daysText: z.string().nullable().optional(),
  capacity: z.number().int().nullable().optional(),
  status: z.string(),
  createdAt: z.string(),
});
export type EducationBatch = z.infer<typeof educationBatchSchema>;

export const createEducationBatchSchema = z.object({
  branchCode: z.string().min(1),
  courseId: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(64),
  timingText: z.string().max(120).optional(),
  daysText: z.string().max(120).optional(),
  /** Optional capacity stored in timing/days meta consumers; checked when present on row. */
  capacity: z.number().int().min(0).optional(),
  status: z.string().min(1).max(40).optional(),
});

export const updateEducationBatchSchema = createEducationBatchSchema.partial().extend({
  id: z.string().uuid(),
});

export const educationBatchStudentSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  batchId: z.string().uuid(),
  studentId: z.string().uuid(),
  status: z.string(),
  enrolledAt: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type EducationBatchStudent = z.infer<typeof educationBatchStudentSchema>;

export const createEducationBatchStudentSchema = z.object({
  branchCode: z.string().min(1),
  batchId: z.string().uuid(),
  studentId: z.string().uuid(),
  status: z.string().min(1).max(40).optional(),
  enrolledAt: z.string().optional(),
});

export const educationStaffSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  employeeNumber: z.string(),
  firstName: z.string(),
  lastName: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  cnic: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  designation: z.string().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  staffCategoryCode: z.string().nullable().optional(),
  employmentTypeCode: z.string().nullable().optional(),
  joiningDate: z.string().nullable().optional(),
  salaryPkr: z.number().int(),
  status: z.string(),
  photoUrl: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EducationStaff = z.infer<typeof educationStaffSchema>;

export const createEducationStaffSchema = z.object({
  branchCode: z.string().min(1),
  employeeNumber: z.string().min(1).max(64).optional(),
  firstName: z.string().min(1).max(120),
  lastName: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().email().optional().or(z.literal("")),
  cnic: z.string().max(40).optional(),
  address: z.string().max(500).optional(),
  designation: z.string().max(120).optional(),
  departmentId: z.string().uuid().optional(),
  staffCategoryCode: z.string().max(40).optional(),
  employmentTypeCode: z.string().max(40).optional(),
  joiningDate: z.string().optional(),
  salaryPkr: z.number().int().min(0).optional(),
  status: z.string().min(1).max(40).optional(),
  photoUrl: z.string().max(500).optional(),
});

export const updateEducationStaffSchema = createEducationStaffSchema.partial().extend({
  id: z.string().uuid(),
});

export const educationPeriodSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  name: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  sortOrder: z.number().int(),
  isBreak: z.boolean(),
  status: z.string(),
  createdAt: z.string(),
});
export type EducationPeriod = z.infer<typeof educationPeriodSchema>;

export const createEducationPeriodSchema = z.object({
  branchCode: z.string().min(1),
  name: z.string().min(1).max(120),
  startTime: z.string().min(1).max(20),
  endTime: z.string().min(1).max(20),
  sortOrder: z.number().int().optional(),
  isBreak: z.boolean().optional(),
  status: z.string().min(1).max(40).optional(),
});

export const updateEducationPeriodSchema = createEducationPeriodSchema.partial().extend({
  id: z.string().uuid(),
});

export const educationRoomSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  buildingId: z.string().uuid().nullable().optional(),
  code: z.string(),
  name: z.string(),
  roomTypeCode: z.string().nullable().optional(),
  floor: z.number().int().nullable().optional(),
  capacity: z.number().int().nullable().optional(),
  facilitiesJson: z.string().nullable().optional(),
  status: z.string(),
  createdAt: z.string(),
});
export type EducationRoom = z.infer<typeof educationRoomSchema>;

export const createEducationRoomSchema = z.object({
  branchCode: z.string().min(1),
  buildingId: z.string().uuid().optional(),
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  roomTypeCode: z.string().max(64).optional(),
  floor: z.number().int().optional(),
  capacity: z.number().int().optional(),
  facilitiesJson: z.string().optional(),
  status: z.string().min(1).max(40).optional(),
});

export const updateEducationRoomSchema = createEducationRoomSchema.partial().extend({
  id: z.string().uuid(),
});

export const educationTimetableSlotSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  dayOfWeek: z.number().int().min(0).max(6),
  periodId: z.string().uuid(),
  roomId: z.string().uuid().nullable().optional(),
  classId: z.string().uuid().nullable().optional(),
  sectionId: z.string().uuid().nullable().optional(),
  subjectId: z.string().uuid().nullable().optional(),
  teacherId: z.string().uuid().nullable().optional(),
  batchId: z.string().uuid().nullable().optional(),
  status: z.string(),
  createdAt: z.string(),
});
export type EducationTimetableSlot = z.infer<typeof educationTimetableSlotSchema>;

export const createEducationTimetableSlotSchema = z.object({
  branchCode: z.string().min(1),
  dayOfWeek: z.number().int().min(0).max(6),
  periodId: z.string().uuid(),
  roomId: z.string().uuid().optional(),
  classId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
  status: z.string().min(1).max(40).optional(),
});

export const updateEducationTimetableSlotSchema = createEducationTimetableSlotSchema.partial().extend({
  id: z.string().uuid(),
});

export const educationAttendanceSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  date: z.string(),
  personType: z.enum(["student", "teacher", "staff"]),
  personId: z.string().uuid(),
  classId: z.string().uuid().nullable().optional(),
  sectionId: z.string().uuid().nullable().optional(),
  batchId: z.string().uuid().nullable().optional(),
  statusCode: z.string(),
  notes: z.string().nullable().optional(),
  markedBy: z.string().uuid().nullable().optional(),
  createdAt: z.string(),
});
export type EducationAttendance = z.infer<typeof educationAttendanceSchema>;

export const createEducationAttendanceSchema = z.object({
  branchCode: z.string().min(1),
  date: z.string().min(1),
  personType: z.enum(["student", "teacher", "staff"]),
  personId: z.string().uuid(),
  classId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
  statusCode: z.string().min(1).max(40),
  notes: z.string().max(500).optional(),
  markedBy: z.string().uuid().optional(),
});

export const updateEducationAttendanceSchema = createEducationAttendanceSchema.partial().extend({
  id: z.string().uuid(),
});

export const educationExamSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  name: z.string(),
  examTypeCode: z.string(),
  sessionId: z.string().uuid().nullable().optional(),
  classId: z.string().uuid().nullable().optional(),
  programId: z.string().uuid().nullable().optional(),
  batchId: z.string().uuid().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  status: z.enum(["draft", "scheduled", "active", "completed", "finalized", "archived"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EducationExam = z.infer<typeof educationExamSchema>;

export const createEducationExamSchema = z.object({
  branchCode: z.string().min(1),
  name: z.string().min(1).max(160),
  examTypeCode: z.string().min(1).max(64),
  sessionId: z.string().uuid().optional(),
  classId: z.string().uuid().optional(),
  programId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  status: z.enum(["draft", "scheduled", "active", "completed", "finalized", "archived"]).optional(),
});

export const updateEducationExamSchema = createEducationExamSchema.partial().extend({
  id: z.string().uuid(),
});

export const educationExamSubjectSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  examId: z.string().uuid(),
  subjectId: z.string().uuid().nullable().optional(),
  courseId: z.string().uuid().nullable().optional(),
  totalMarks: z.number().int(),
  passingMarks: z.number().int(),
  createdAt: z.string(),
});
export type EducationExamSubject = z.infer<typeof educationExamSubjectSchema>;

export const createEducationExamSubjectSchema = z.object({
  examId: z.string().uuid(),
  subjectId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  totalMarks: z.number().int().min(0),
  passingMarks: z.number().int().min(0),
});

export const updateEducationExamSubjectSchema = createEducationExamSubjectSchema.partial().extend({
  id: z.string().uuid(),
});

export const educationMarkSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  examId: z.string().uuid(),
  examSubjectId: z.string().uuid(),
  studentId: z.string().uuid(),
  obtainedMarks: z.number().int(),
  percentage: z.number().int().nullable().optional(),
  gradeCode: z.string().nullable().optional(),
  gpa: z.string().nullable().optional(),
  passFail: z.string().nullable().optional(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EducationMark = z.infer<typeof educationMarkSchema>;

export const createEducationMarkSchema = z.object({
  branchCode: z.string().min(1),
  examId: z.string().uuid(),
  examSubjectId: z.string().uuid(),
  studentId: z.string().uuid(),
  obtainedMarks: z.number().int().min(0),
  percentage: z.number().int().min(0).max(100).optional(),
  gradeCode: z.string().max(40).optional(),
  gpa: z.string().max(20).optional(),
  passFail: z.string().max(20).optional(),
  status: z.string().min(1).max(40).optional(),
});

export const updateEducationMarkSchema = createEducationMarkSchema.partial().extend({
  id: z.string().uuid(),
});

export const educationExpenseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  title: z.string(),
  categoryCode: z.string(),
  amountPkr: z.number().int(),
  paymentMethodCode: z.string().nullable().optional(),
  status: z.enum(["draft", "pending", "approved", "paid", "cancelled", "rejected"]),
  expenseDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  approvedBy: z.string().uuid().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EducationExpense = z.infer<typeof educationExpenseSchema>;

export const createEducationExpenseSchema = z.object({
  branchCode: z.string().min(1),
  title: z.string().min(1).max(160),
  categoryCode: z.string().min(1).max(64),
  amountPkr: z.number().int().min(0),
  paymentMethodCode: z.string().max(64).optional(),
  status: z.enum(["draft", "pending", "approved", "paid", "cancelled", "rejected"]).optional(),
  expenseDate: z.string().optional(),
  notes: z.string().max(1000).optional(),
  approvedBy: z.string().uuid().optional(),
});

export const updateEducationExpenseSchema = createEducationExpenseSchema.partial().extend({
  id: z.string().uuid(),
});

export const educationFinanceTxnSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  txnType: z.enum(["income", "expense", "refund", "adjustment"]),
  amountPkr: z.number().int(),
  refModule: z.string(),
  refId: z.string().uuid().nullable().optional(),
  title: z.string(),
  txnDate: z.string(),
  status: z.string(),
  createdAt: z.string(),
});
export type EducationFinanceTxn = z.infer<typeof educationFinanceTxnSchema>;

export const createEducationFinanceTxnSchema = z.object({
  branchCode: z.string().min(1),
  txnType: z.enum(["income", "expense", "refund", "adjustment"]),
  amountPkr: z.number().int().min(0),
  refModule: z.string().min(1).max(64),
  refId: z.string().uuid().optional(),
  title: z.string().min(1).max(160),
  txnDate: z.string().min(1),
  status: z.string().min(1).max(40).optional(),
});

export const educationPayrollRunSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  periodLabel: z.string(),
  status: z.enum(["draft", "calculated", "approved", "paid"]),
  totalPkr: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EducationPayrollRun = z.infer<typeof educationPayrollRunSchema>;

export const createEducationPayrollRunSchema = z.object({
  branchCode: z.string().min(1),
  periodLabel: z.string().min(1).max(80),
  status: z.enum(["draft", "calculated", "approved", "paid"]).optional(),
  totalPkr: z.number().int().min(0).optional(),
});

export const updateEducationPayrollRunSchema = createEducationPayrollRunSchema.partial().extend({
  id: z.string().uuid(),
});

export const educationPayslipSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  payrollRunId: z.string().uuid(),
  personType: z.enum(["teacher", "staff"]),
  personId: z.string().uuid(),
  basicPkr: z.number().int(),
  allowancesPkr: z.number().int(),
  deductionsPkr: z.number().int(),
  netPkr: z.number().int(),
  status: z.string(),
  createdAt: z.string(),
});
export type EducationPayslip = z.infer<typeof educationPayslipSchema>;

export const createEducationPayslipSchema = z.object({
  payrollRunId: z.string().uuid(),
  personType: z.enum(["teacher", "staff"]),
  personId: z.string().uuid(),
  basicPkr: z.number().int().min(0),
  allowancesPkr: z.number().int().min(0).optional(),
  deductionsPkr: z.number().int().min(0).optional(),
  netPkr: z.number().int().min(0),
  status: z.string().min(1).max(40).optional(),
});

export const updateEducationPayslipSchema = createEducationPayslipSchema.partial().extend({
  id: z.string().uuid(),
});

export const educationBookSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  title: z.string(),
  author: z.string().nullable().optional(),
  publisher: z.string().nullable().optional(),
  categoryCode: z.string().nullable().optional(),
  isbn: z.string().nullable().optional(),
  copiesTotal: z.number().int(),
  copiesAvailable: z.number().int(),
  status: z.string(),
  createdAt: z.string(),
});
export type EducationBook = z.infer<typeof educationBookSchema>;

export const createEducationBookSchema = z.object({
  branchCode: z.string().min(1),
  title: z.string().min(1).max(200),
  author: z.string().max(160).optional(),
  publisher: z.string().max(160).optional(),
  categoryCode: z.string().max(64).optional(),
  isbn: z.string().max(40).optional(),
  copiesTotal: z.number().int().min(0).optional(),
  copiesAvailable: z.number().int().min(0).optional(),
  status: z.string().min(1).max(40).optional(),
});

export const updateEducationBookSchema = createEducationBookSchema.partial().extend({
  id: z.string().uuid(),
});

export const educationBookIssueSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  bookId: z.string().uuid(),
  borrowerType: z.enum(["student", "staff", "teacher"]),
  borrowerId: z.string().uuid(),
  issuedAt: z.string(),
  dueAt: z.string().nullable().optional(),
  returnedAt: z.string().nullable().optional(),
  finePkr: z.number().int(),
  status: z.enum(["issued", "returned", "lost", "damaged"]),
  createdAt: z.string(),
});
export type EducationBookIssue = z.infer<typeof educationBookIssueSchema>;

export const createEducationBookIssueSchema = z.object({
  branchCode: z.string().min(1),
  bookId: z.string().uuid(),
  borrowerType: z.enum(["student", "staff", "teacher"]),
  borrowerId: z.string().uuid(),
  issuedAt: z.string().min(1),
  dueAt: z.string().optional(),
  returnedAt: z.string().optional(),
  finePkr: z.number().int().min(0).optional(),
  status: z.enum(["issued", "returned", "lost", "damaged"]).optional(),
});

export const updateEducationBookIssueSchema = createEducationBookIssueSchema.partial().extend({
  id: z.string().uuid(),
});

export const educationVehicleSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  code: z.string(),
  registration: z.string(),
  vehicleTypeCode: z.string().nullable().optional(),
  capacity: z.number().int().nullable().optional(),
  driverName: z.string().nullable().optional(),
  status: z.string(),
  createdAt: z.string(),
});
export type EducationVehicle = z.infer<typeof educationVehicleSchema>;

export const createEducationVehicleSchema = z.object({
  branchCode: z.string().min(1),
  code: z.string().min(1).max(64),
  registration: z.string().min(1).max(64),
  vehicleTypeCode: z.string().max(64).optional(),
  capacity: z.number().int().optional(),
  driverName: z.string().max(120).optional(),
  status: z.string().min(1).max(40).optional(),
});

export const updateEducationVehicleSchema = createEducationVehicleSchema.partial().extend({
  id: z.string().uuid(),
});

export const educationRouteSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  vehicleId: z.string().uuid().nullable().optional(),
  feePkr: z.number().int(),
  status: z.string(),
  createdAt: z.string(),
});
export type EducationRoute = z.infer<typeof educationRouteSchema>;

export const createEducationRouteSchema = z.object({
  branchCode: z.string().min(1),
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(64),
  vehicleId: z.string().uuid().optional(),
  feePkr: z.number().int().min(0).optional(),
  status: z.string().min(1).max(40).optional(),
});

export const updateEducationRouteSchema = createEducationRouteSchema.partial().extend({
  id: z.string().uuid(),
});

export const educationRouteStopSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  routeId: z.string().uuid(),
  name: z.string(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
});
export type EducationRouteStop = z.infer<typeof educationRouteStopSchema>;

export const createEducationRouteStopSchema = z.object({
  routeId: z.string().uuid(),
  name: z.string().min(1).max(120),
  sortOrder: z.number().int().optional(),
});

export const updateEducationRouteStopSchema = createEducationRouteStopSchema.partial().extend({
  id: z.string().uuid(),
});

export const educationTransportAssignmentSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  routeId: z.string().uuid(),
  studentId: z.string().uuid(),
  stopId: z.string().uuid().nullable().optional(),
  status: z.string(),
  createdAt: z.string(),
});
export type EducationTransportAssignment = z.infer<typeof educationTransportAssignmentSchema>;

export const createEducationTransportAssignmentSchema = z.object({
  branchCode: z.string().min(1),
  routeId: z.string().uuid(),
  studentId: z.string().uuid(),
  stopId: z.string().uuid().optional(),
  status: z.string().min(1).max(40).optional(),
});

export const updateEducationTransportAssignmentSchema = createEducationTransportAssignmentSchema
  .partial()
  .extend({
    id: z.string().uuid(),
  });

export const educationNoticeSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  categoryCode: z.string().nullable().optional(),
  audienceCode: z.string().nullable().optional(),
  status: z.enum(["draft", "scheduled", "published", "archived"]),
  publishAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EducationNotice = z.infer<typeof educationNoticeSchema>;

export const createEducationNoticeSchema = z.object({
  branchCode: z.string().min(1),
  title: z.string().min(1).max(200),
  body: z.string().min(1),
  categoryCode: z.string().max(64).optional(),
  audienceCode: z.string().max(64).optional(),
  status: z.enum(["draft", "scheduled", "published", "archived"]).optional(),
  publishAt: z.string().optional(),
});

export const updateEducationNoticeSchema = createEducationNoticeSchema.partial().extend({
  id: z.string().uuid(),
});

export const educationDocumentTemplateSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid().nullable().optional(),
  name: z.string(),
  documentTypeCode: z.string(),
  bodyHtml: z.string(),
  status: z.enum(["active", "inactive"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EducationDocumentTemplate = z.infer<typeof educationDocumentTemplateSchema>;

export const createEducationDocumentTemplateSchema = z.object({
  branchCode: z.string().min(1).optional(),
  name: z.string().min(1).max(160),
  documentTypeCode: z.string().min(1).max(64),
  bodyHtml: z.string().min(1),
  status: z.enum(["active", "inactive"]).optional(),
});

export const updateEducationDocumentTemplateSchema = createEducationDocumentTemplateSchema
  .partial()
  .extend({
    id: z.string().uuid(),
  });

export const educationGeneratedDocumentSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid().nullable().optional(),
  templateId: z.string().uuid(),
  studentId: z.string().uuid().nullable().optional(),
  personType: z.string().nullable().optional(),
  personId: z.string().uuid().nullable().optional(),
  title: z.string(),
  payloadJson: z.string().nullable().optional(),
  status: z.string(),
  createdAt: z.string(),
  bodyHtml: z.string().optional(),
  documentTypeCode: z.string().optional(),
});
export type EducationGeneratedDocument = z.infer<typeof educationGeneratedDocumentSchema>;

export const createEducationGeneratedDocumentSchema = z.object({
  branchCode: z.string().min(1).optional(),
  templateId: z.string().uuid(),
  studentId: z.string().uuid().optional(),
  personType: z.string().max(40).optional(),
  personId: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  payloadJson: z.string().optional(),
  status: z.string().min(1).max(40).optional(),
});

export const educationLeaveRequestSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  applicantType: z.enum(["student", "teacher", "staff"]),
  applicantId: z.string().uuid(),
  leaveTypeCode: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  days: z.number().int(),
  reason: z.string(),
  attachmentUrl: z.string().nullable().optional(),
  status: z.enum(["draft", "pending", "approved", "rejected", "cancelled"]),
  approvedBy: z.string().uuid().nullable().optional(),
  approvedAt: z.string().nullable().optional(),
  remarks: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EducationLeaveRequest = z.infer<typeof educationLeaveRequestSchema>;

export const createEducationLeaveRequestSchema = z.object({
  branchCode: z.string().min(1),
  applicantType: z.enum(["student", "teacher", "staff"]),
  applicantId: z.string().uuid(),
  leaveTypeCode: z.string().min(1).max(64),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  days: z.number().int().min(1).optional(),
  reason: z.string().min(1).max(2000),
  attachmentUrl: z.string().max(500).optional(),
  status: z.enum(["draft", "pending", "approved", "rejected", "cancelled"]).optional(),
  remarks: z.string().max(1000).optional(),
});

export const educationDisciplineIncidentSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  studentId: z.string().uuid(),
  classId: z.string().uuid().nullable().optional(),
  sectionId: z.string().uuid().nullable().optional(),
  incidentDate: z.string(),
  incidentTypeCode: z.string(),
  description: z.string(),
  severityCode: z.string(),
  actionCode: z.string().nullable().optional(),
  warning: z.string().nullable().optional(),
  responsibleStaffId: z.string().uuid().nullable().optional(),
  parentNotified: z.boolean(),
  status: z.string(),
  remarks: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EducationDisciplineIncident = z.infer<typeof educationDisciplineIncidentSchema>;

export const createEducationDisciplineIncidentSchema = z.object({
  branchCode: z.string().min(1),
  studentId: z.string().uuid(),
  classId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
  incidentDate: z.string().min(1),
  incidentTypeCode: z.string().min(1).max(64),
  description: z.string().min(1).max(4000),
  severityCode: z.string().min(1).max(64),
  actionCode: z.string().max(64).optional(),
  warning: z.string().max(1000).optional(),
  responsibleStaffId: z.string().uuid().optional(),
  parentNotified: z.boolean().optional(),
  status: z.string().min(1).max(40).optional(),
  remarks: z.string().max(1000).optional(),
});

export const educationStudentLifecycleSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  studentId: z.string().uuid(),
  actionType: z.enum(["promote", "transfer", "withdraw", "readmit", "graduate", "archive"]),
  fromSessionId: z.string().uuid().nullable().optional(),
  toSessionId: z.string().uuid().nullable().optional(),
  fromClassId: z.string().uuid().nullable().optional(),
  toClassId: z.string().uuid().nullable().optional(),
  fromSectionId: z.string().uuid().nullable().optional(),
  toSectionId: z.string().uuid().nullable().optional(),
  reason: z.string().nullable().optional(),
  status: z.enum(["pending", "completed", "cancelled"]),
  approvedBy: z.string().uuid().nullable().optional(),
  effectiveDate: z.string(),
  notes: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EducationStudentLifecycle = z.infer<typeof educationStudentLifecycleSchema>;

export const createEducationStudentLifecycleSchema = z.object({
  branchCode: z.string().min(1),
  studentId: z.string().uuid(),
  actionType: z.enum(["promote", "transfer", "withdraw", "readmit", "graduate", "archive"]),
  fromSessionId: z.string().uuid().optional(),
  toSessionId: z.string().uuid().optional(),
  fromClassId: z.string().uuid().optional(),
  toClassId: z.string().uuid().optional(),
  fromSectionId: z.string().uuid().optional(),
  toSectionId: z.string().uuid().optional(),
  reason: z.string().max(1000).optional(),
  status: z.enum(["pending", "completed", "cancelled"]).optional(),
  effectiveDate: z.string().min(1),
  notes: z.string().max(2000).optional(),
});

export const educationAssignmentSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable().optional(),
  subjectId: z.string().uuid().nullable().optional(),
  courseId: z.string().uuid().nullable().optional(),
  classId: z.string().uuid().nullable().optional(),
  sectionId: z.string().uuid().nullable().optional(),
  batchId: z.string().uuid().nullable().optional(),
  teacherId: z.string().uuid().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  status: z.enum(["draft", "published", "completed", "archived"]),
  totalMarks: z.number().int().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EducationAssignment = z.infer<typeof educationAssignmentSchema>;

export const createEducationAssignmentSchema = z.object({
  branchCode: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  subjectId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  classId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional(),
  dueDate: z.string().optional(),
  status: z.enum(["draft", "published", "completed", "archived"]).optional(),
  totalMarks: z.number().int().min(0).optional(),
});

export const educationAssignmentSubmissionSchema = z.object({
  id: z.string().uuid(),
  assignmentId: z.string().uuid(),
  studentId: z.string().uuid(),
  submittedAt: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  attachmentUrl: z.string().nullable().optional(),
  marks: z.number().int().nullable().optional(),
  remarks: z.string().nullable().optional(),
  status: z.enum(["pending", "submitted", "reviewed", "late"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EducationAssignmentSubmission = z.infer<typeof educationAssignmentSubmissionSchema>;

export const createEducationAssignmentSubmissionSchema = z.object({
  assignmentId: z.string().uuid(),
  studentId: z.string().uuid(),
  content: z.string().max(8000).optional(),
  attachmentUrl: z.string().max(500).optional(),
  marks: z.number().int().min(0).optional(),
  remarks: z.string().max(1000).optional(),
  status: z.enum(["pending", "submitted", "reviewed", "late"]).optional(),
});

export const educationScholarshipSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  name: z.string(),
  scholarshipTypeCode: z.string(),
  discountType: z.enum(["percent", "fixed", "full_waiver"]),
  discountValue: z.number().int(),
  status: z.enum(["draft", "pending", "approved", "rejected", "active", "expired"]),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EducationScholarship = z.infer<typeof educationScholarshipSchema>;

export const createEducationScholarshipSchema = z.object({
  branchCode: z.string().min(1),
  name: z.string().min(1).max(160),
  scholarshipTypeCode: z.string().min(1).max(64),
  discountType: z.enum(["percent", "fixed", "full_waiver"]),
  discountValue: z.number().int().min(0),
  status: z.enum(["draft", "pending", "approved", "rejected", "active", "expired"]).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const educationScholarshipAwardSchema = z.object({
  id: z.string().uuid(),
  scholarshipId: z.string().uuid(),
  studentId: z.string().uuid(),
  invoiceId: z.string().uuid().nullable().optional(),
  amountPkr: z.number().int(),
  status: z.enum(["active", "expired", "cancelled"]),
  awardedAt: z.string(),
  createdAt: z.string(),
});
export type EducationScholarshipAward = z.infer<typeof educationScholarshipAwardSchema>;

export const createEducationScholarshipAwardSchema = z.object({
  scholarshipId: z.string().uuid(),
  studentId: z.string().uuid(),
  invoiceId: z.string().uuid().optional(),
  amountPkr: z.number().int().min(0),
  status: z.enum(["active", "expired", "cancelled"]).optional(),
});

export const educationFeeRefundSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  studentId: z.string().uuid(),
  invoiceId: z.string().uuid().nullable().optional(),
  paymentId: z.string().uuid().nullable().optional(),
  amountPkr: z.number().int(),
  reason: z.string(),
  paymentMethodCode: z.string().nullable().optional(),
  status: z.enum(["requested", "approved", "processed", "completed", "rejected"]),
  approvedBy: z.string().uuid().nullable().optional(),
  processedBy: z.string().uuid().nullable().optional(),
  remarks: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EducationFeeRefund = z.infer<typeof educationFeeRefundSchema>;

export const createEducationFeeRefundSchema = z.object({
  branchCode: z.string().min(1),
  studentId: z.string().uuid(),
  invoiceId: z.string().uuid().optional(),
  paymentId: z.string().uuid().optional(),
  amountPkr: z.number().int().min(1),
  reason: z.string().min(1).max(2000),
  paymentMethodCode: z.string().max(64).optional(),
  status: z.enum(["requested", "approved", "processed", "completed", "rejected"]).optional(),
  remarks: z.string().max(1000).optional(),
});

export const educationEnquirySchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  name: z.string(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  interestedProgram: z.string().nullable().optional(),
  interestedClassId: z.string().uuid().nullable().optional(),
  sourceCode: z.string().nullable().optional(),
  status: z.enum(["new", "contacted", "follow_up", "converted", "closed", "lost"]),
  assignedStaffId: z.string().uuid().nullable().optional(),
  followUpDate: z.string().nullable().optional(),
  remarks: z.string().nullable().optional(),
  convertedAdmissionId: z.string().uuid().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EducationEnquiry = z.infer<typeof educationEnquirySchema>;

export const createEducationEnquirySchema = z.object({
  branchCode: z.string().min(1),
  name: z.string().min(1).max(160),
  phone: z.string().max(40).optional(),
  email: z.string().email().optional().or(z.literal("")),
  interestedProgram: z.string().max(160).optional(),
  interestedClassId: z.string().uuid().optional(),
  sourceCode: z.string().max(64).optional(),
  status: z.enum(["new", "contacted", "follow_up", "converted", "closed", "lost"]).optional(),
  assignedStaffId: z.string().uuid().optional(),
  followUpDate: z.string().optional(),
  remarks: z.string().max(2000).optional(),
});

export const educationEventSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  title: z.string(),
  eventTypeCode: z.string(),
  startDate: z.string(),
  endDate: z.string().nullable().optional(),
  audienceCode: z.string().nullable().optional(),
  status: z.enum(["draft", "published", "completed", "cancelled"]),
  description: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EducationEvent = z.infer<typeof educationEventSchema>;

export const createEducationEventSchema = z.object({
  branchCode: z.string().min(1),
  title: z.string().min(1).max(200),
  eventTypeCode: z.string().min(1).max(64),
  startDate: z.string().min(1),
  endDate: z.string().optional(),
  audienceCode: z.string().max(64).optional(),
  status: z.enum(["draft", "published", "completed", "cancelled"]).optional(),
  description: z.string().max(4000).optional(),
});

export const educationAlumniSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  studentId: z.string().uuid().nullable().optional(),
  fullName: z.string(),
  graduationYear: z.number().int().nullable().optional(),
  programOrClass: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  position: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  achievements: z.string().nullable().optional(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EducationAlumni = z.infer<typeof educationAlumniSchema>;

export const createEducationAlumniSchema = z.object({
  branchCode: z.string().min(1),
  studentId: z.string().uuid().optional(),
  fullName: z.string().min(1).max(160),
  graduationYear: z.number().int().min(1900).max(2100).optional(),
  programOrClass: z.string().max(160).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().email().optional().or(z.literal("")),
  company: z.string().max(160).optional(),
  position: z.string().max(120).optional(),
  location: z.string().max(200).optional(),
  achievements: z.string().max(4000).optional(),
  status: z.string().min(1).max(40).optional(),
});

export const educationHealthRecordSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  studentId: z.string().uuid(),
  allergies: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  emergencyContact: z.string().nullable().optional(),
  lastVisitDate: z.string().nullable().optional(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EducationHealthRecord = z.infer<typeof educationHealthRecordSchema>;

export const createEducationHealthRecordSchema = z.object({
  branchCode: z.string().min(1),
  studentId: z.string().uuid(),
  allergies: z.string().max(2000).optional(),
  notes: z.string().max(4000).optional(),
  emergencyContact: z.string().max(200).optional(),
  lastVisitDate: z.string().optional(),
  status: z.string().min(1).max(40).optional(),
});

export const educationHealthVisitSchema = z.object({
  id: z.string().uuid(),
  healthRecordId: z.string().uuid(),
  visitDate: z.string(),
  reason: z.string().nullable().optional(),
  treatment: z.string().nullable().optional(),
  recordedBy: z.string().uuid().nullable().optional(),
  createdAt: z.string(),
});
export type EducationHealthVisit = z.infer<typeof educationHealthVisitSchema>;

export const createEducationHealthVisitSchema = z.object({
  healthRecordId: z.string().uuid(),
  visitDate: z.string().min(1),
  reason: z.string().max(2000).optional(),
  treatment: z.string().max(2000).optional(),
  recordedBy: z.string().uuid().optional(),
});

export const educationHostelSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  genderPolicy: z.string().nullable().optional(),
  status: z.string(),
  createdAt: z.string(),
});
export type EducationHostel = z.infer<typeof educationHostelSchema>;

export const createEducationHostelSchema = z.object({
  branchCode: z.string().min(1),
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(64),
  genderPolicy: z.string().max(40).optional(),
  status: z.string().min(1).max(40).optional(),
});

export const educationHostelRoomSchema = z.object({
  id: z.string().uuid(),
  hostelId: z.string().uuid(),
  roomNumber: z.string(),
  capacity: z.number().int(),
  status: z.string(),
  createdAt: z.string(),
});
export type EducationHostelRoom = z.infer<typeof educationHostelRoomSchema>;

export const createEducationHostelRoomSchema = z.object({
  hostelId: z.string().uuid(),
  roomNumber: z.string().min(1).max(40),
  capacity: z.number().int().min(1),
  status: z.string().min(1).max(40).optional(),
});

export const educationHostelBedSchema = z.object({
  id: z.string().uuid(),
  hostelRoomId: z.string().uuid(),
  bedCode: z.string(),
  status: z.enum(["available", "occupied", "maintenance"]),
  createdAt: z.string(),
});
export type EducationHostelBed = z.infer<typeof educationHostelBedSchema>;

export const createEducationHostelBedSchema = z.object({
  hostelRoomId: z.string().uuid(),
  bedCode: z.string().min(1).max(40),
  status: z.enum(["available", "occupied", "maintenance"]).optional(),
});

export const educationHostelAllocationSchema = z.object({
  id: z.string().uuid(),
  bedId: z.string().uuid(),
  studentId: z.string().uuid(),
  checkInDate: z.string(),
  checkOutDate: z.string().nullable().optional(),
  status: z.enum(["active", "checked_out"]),
  createdAt: z.string(),
});
export type EducationHostelAllocation = z.infer<typeof educationHostelAllocationSchema>;

export const createEducationHostelAllocationSchema = z.object({
  bedId: z.string().uuid(),
  studentId: z.string().uuid(),
  checkInDate: z.string().min(1),
  checkOutDate: z.string().optional(),
  status: z.enum(["active", "checked_out"]).optional(),
});

export const educationCustomFieldDefSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  entityType: z.string(),
  fieldKey: z.string(),
  label: z.string(),
  fieldType: z.enum([
    "text",
    "number",
    "email",
    "phone",
    "date",
    "dropdown",
    "multiselect",
    "checkbox",
    "textarea",
    "file",
    "boolean",
  ]),
  required: z.boolean(),
  optionsJson: z.string().nullable().optional(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type EducationCustomFieldDef = z.infer<typeof educationCustomFieldDefSchema>;

export const createEducationCustomFieldDefSchema = z.object({
  entityType: z.string().min(1).max(64),
  fieldKey: z.string().min(1).max(64),
  label: z.string().min(1).max(120),
  fieldType: z.enum([
    "text",
    "number",
    "email",
    "phone",
    "date",
    "dropdown",
    "multiselect",
    "checkbox",
    "textarea",
    "file",
    "boolean",
  ]),
  required: z.boolean().optional(),
  optionsJson: z.string().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export const educationCustomFieldValueSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  entityType: z.string(),
  entityId: z.string().uuid(),
  fieldKey: z.string(),
  valueText: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EducationCustomFieldValue = z.infer<typeof educationCustomFieldValueSchema>;

export const createEducationCustomFieldValueSchema = z.object({
  entityType: z.string().min(1).max(64),
  entityId: z.string().uuid(),
  fieldKey: z.string().min(1).max(64),
  valueText: z.string().min(1),
});

export type CreateEducationLookup = z.infer<typeof createEducationLookupSchema>;
export type UpdateEducationLookup = z.infer<typeof updateEducationLookupSchema>;
export type UpsertEducationModule = z.infer<typeof upsertEducationModuleSchema>;
export type UpsertEducationSetting = z.infer<typeof upsertEducationSettingSchema>;
export type CreateEducationAcademicSession = z.infer<typeof createEducationAcademicSessionSchema>;
export type CreateEducationClass = z.infer<typeof createEducationClassSchema>;
export type CreateEducationSection = z.infer<typeof createEducationSectionSchema>;
export type CreateEducationSubject = z.infer<typeof createEducationSubjectSchema>;
export type CreateEducationStudent = z.infer<typeof createEducationStudentSchema>;
export type UpdateEducationStudent = z.infer<typeof updateEducationStudentSchema>;
export type CreateEducationFeeStructure = z.infer<typeof createEducationFeeStructureSchema>;
export type CreateEducationFeeInvoice = z.infer<typeof createEducationFeeInvoiceSchema>;
export type CreateEducationFeePayment = z.infer<typeof createEducationFeePaymentSchema>;
export type CreateEducationAdmission = z.infer<typeof createEducationAdmissionSchema>;
export type CreateEducationGuardian = z.infer<typeof createEducationGuardianSchema>;
export type UpdateEducationGuardian = z.infer<typeof updateEducationGuardianSchema>;
export type LinkEducationGuardianStudent = z.infer<typeof linkEducationGuardianStudentSchema>;
export type CreateEducationTeacher = z.infer<typeof createEducationTeacherSchema>;
export type UpdateEducationTeacher = z.infer<typeof updateEducationTeacherSchema>;
export type BulkCreateEducationAttendance = z.infer<typeof bulkCreateEducationAttendanceSchema>;
export type CreateEducationDepartment = z.infer<typeof createEducationDepartmentSchema>;
export type UpdateEducationDepartment = z.infer<typeof updateEducationDepartmentSchema>;
export type CreateEducationProgram = z.infer<typeof createEducationProgramSchema>;
export type UpdateEducationProgram = z.infer<typeof updateEducationProgramSchema>;
export type CreateEducationCourse = z.infer<typeof createEducationCourseSchema>;
export type UpdateEducationCourse = z.infer<typeof updateEducationCourseSchema>;
export type CreateEducationBatch = z.infer<typeof createEducationBatchSchema>;
export type UpdateEducationBatch = z.infer<typeof updateEducationBatchSchema>;
export type CreateEducationBatchStudent = z.infer<typeof createEducationBatchStudentSchema>;
export type CreateEducationStaff = z.infer<typeof createEducationStaffSchema>;
export type UpdateEducationStaff = z.infer<typeof updateEducationStaffSchema>;
export type CreateEducationPeriod = z.infer<typeof createEducationPeriodSchema>;
export type UpdateEducationPeriod = z.infer<typeof updateEducationPeriodSchema>;
export type CreateEducationRoom = z.infer<typeof createEducationRoomSchema>;
export type UpdateEducationRoom = z.infer<typeof updateEducationRoomSchema>;
export type CreateEducationTimetableSlot = z.infer<typeof createEducationTimetableSlotSchema>;
export type UpdateEducationTimetableSlot = z.infer<typeof updateEducationTimetableSlotSchema>;
export type CreateEducationAttendance = z.infer<typeof createEducationAttendanceSchema>;
export type UpdateEducationAttendance = z.infer<typeof updateEducationAttendanceSchema>;
export type CreateEducationExam = z.infer<typeof createEducationExamSchema>;
export type UpdateEducationExam = z.infer<typeof updateEducationExamSchema>;
export type CreateEducationExamSubject = z.infer<typeof createEducationExamSubjectSchema>;
export type UpdateEducationExamSubject = z.infer<typeof updateEducationExamSubjectSchema>;
export type CreateEducationMark = z.infer<typeof createEducationMarkSchema>;
export type UpdateEducationMark = z.infer<typeof updateEducationMarkSchema>;
export type CreateEducationExpense = z.infer<typeof createEducationExpenseSchema>;
export type UpdateEducationExpense = z.infer<typeof updateEducationExpenseSchema>;
export type CreateEducationFinanceTxn = z.infer<typeof createEducationFinanceTxnSchema>;
export type CreateEducationPayrollRun = z.infer<typeof createEducationPayrollRunSchema>;
export type UpdateEducationPayrollRun = z.infer<typeof updateEducationPayrollRunSchema>;
export type CreateEducationPayslip = z.infer<typeof createEducationPayslipSchema>;
export type UpdateEducationPayslip = z.infer<typeof updateEducationPayslipSchema>;
export type CreateEducationBook = z.infer<typeof createEducationBookSchema>;
export type UpdateEducationBook = z.infer<typeof updateEducationBookSchema>;
export type CreateEducationBookIssue = z.infer<typeof createEducationBookIssueSchema>;
export type UpdateEducationBookIssue = z.infer<typeof updateEducationBookIssueSchema>;
export type CreateEducationVehicle = z.infer<typeof createEducationVehicleSchema>;
export type UpdateEducationVehicle = z.infer<typeof updateEducationVehicleSchema>;
export type CreateEducationRoute = z.infer<typeof createEducationRouteSchema>;
export type UpdateEducationRoute = z.infer<typeof updateEducationRouteSchema>;
export type CreateEducationRouteStop = z.infer<typeof createEducationRouteStopSchema>;
export type UpdateEducationRouteStop = z.infer<typeof updateEducationRouteStopSchema>;
export type CreateEducationTransportAssignment = z.infer<
  typeof createEducationTransportAssignmentSchema
>;
export type UpdateEducationTransportAssignment = z.infer<
  typeof updateEducationTransportAssignmentSchema
>;
export type CreateEducationNotice = z.infer<typeof createEducationNoticeSchema>;
export type UpdateEducationNotice = z.infer<typeof updateEducationNoticeSchema>;
export type CreateEducationDocumentTemplate = z.infer<typeof createEducationDocumentTemplateSchema>;
export type UpdateEducationDocumentTemplate = z.infer<typeof updateEducationDocumentTemplateSchema>;
export type CreateEducationGeneratedDocument = z.infer<
  typeof createEducationGeneratedDocumentSchema
>;
export const updateEducationLeaveRequestSchema = createEducationLeaveRequestSchema.partial().extend({
  id: z.string().uuid(),
});

export const updateEducationDisciplineIncidentSchema = createEducationDisciplineIncidentSchema
  .partial()
  .extend({
    id: z.string().uuid(),
  });

export const updateEducationAssignmentSchema = createEducationAssignmentSchema.partial().extend({
  id: z.string().uuid(),
});

export const updateEducationAssignmentSubmissionSchema = createEducationAssignmentSubmissionSchema
  .partial()
  .extend({
    id: z.string().uuid(),
  });

export const updateEducationScholarshipSchema = createEducationScholarshipSchema.partial().extend({
  id: z.string().uuid(),
});

export const updateEducationFeeRefundSchema = createEducationFeeRefundSchema.partial().extend({
  id: z.string().uuid(),
});

export const updateEducationEnquirySchema = createEducationEnquirySchema.partial().extend({
  id: z.string().uuid(),
});

export const updateEducationEventSchema = createEducationEventSchema.partial().extend({
  id: z.string().uuid(),
});

export const updateEducationAlumniSchema = createEducationAlumniSchema.partial().extend({
  id: z.string().uuid(),
});

export const updateEducationHealthRecordSchema = createEducationHealthRecordSchema.partial().extend({
  id: z.string().uuid(),
});

export const updateEducationHostelSchema = createEducationHostelSchema.partial().extend({
  id: z.string().uuid(),
});

export const updateEducationHostelRoomSchema = createEducationHostelRoomSchema.partial().extend({
  id: z.string().uuid(),
});

export const updateEducationHostelBedSchema = createEducationHostelBedSchema.partial().extend({
  id: z.string().uuid(),
});

export const updateEducationHostelAllocationSchema = createEducationHostelAllocationSchema
  .partial()
  .extend({
    id: z.string().uuid(),
  });

export const updateEducationCustomFieldDefSchema = createEducationCustomFieldDefSchema
  .partial()
  .extend({
    id: z.string().uuid(),
  });

export const updateEducationCustomFieldValueSchema = createEducationCustomFieldValueSchema
  .partial()
  .extend({
    id: z.string().uuid(),
  });

export const bulkPromoteEducationStudentsSchema = z.object({
  branchCode: z.string().min(1),
  studentIds: z.array(z.string().uuid()).min(1),
  toSessionId: z.string().uuid().optional(),
  toClassId: z.string().uuid(),
  toSectionId: z.string().uuid().optional(),
  effectiveDate: z.string().min(1),
  reason: z.string().max(1000).optional(),
  notes: z.string().max(2000).optional(),
});

export const educationBuildingSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  floors: z.number().int().nullable().optional(),
  status: z.string(),
  createdAt: z.string(),
});
export type EducationBuilding = z.infer<typeof educationBuildingSchema>;

export const createEducationBuildingSchema = z.object({
  branchCode: z.string().min(1),
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  floors: z.number().int().optional(),
  status: z.string().min(1).max(40).optional(),
});

export const updateEducationBuildingSchema = createEducationBuildingSchema.partial().extend({
  id: z.string().uuid(),
});

export const educationLabSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  roomId: z.string().uuid().nullable().optional(),
  status: z.string(),
  createdAt: z.string(),
});
export type EducationLab = z.infer<typeof educationLabSchema>;

export const createEducationLabSchema = z.object({
  branchCode: z.string().min(1),
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(64),
  roomId: z.string().uuid().optional(),
  status: z.string().min(1).max(40).optional(),
});

export const updateEducationLabSchema = createEducationLabSchema.partial().extend({
  id: z.string().uuid(),
});

export const educationEquipmentSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  labId: z.string().uuid().nullable().optional(),
  equipmentNumber: z.string(),
  name: z.string(),
  categoryCode: z.string(),
  serialNumber: z.string().nullable().optional(),
  purchaseDate: z.string().nullable().optional(),
  purchaseCostPkr: z.number().int().nullable().optional(),
  conditionCode: z.string().nullable().optional(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EducationEquipment = z.infer<typeof educationEquipmentSchema>;

export const createEducationEquipmentSchema = z.object({
  branchCode: z.string().min(1),
  labId: z.string().uuid().optional(),
  equipmentNumber: z.string().min(1).max(64),
  name: z.string().min(1).max(160),
  categoryCode: z.string().min(1).max(64),
  serialNumber: z.string().max(120).optional(),
  purchaseDate: z.string().optional(),
  purchaseCostPkr: z.number().int().min(0).optional(),
  conditionCode: z.string().max(64).optional(),
  status: z.string().min(1).max(40).optional(),
});

export const updateEducationEquipmentSchema = createEducationEquipmentSchema.partial().extend({
  id: z.string().uuid(),
});

export const educationEquipmentIssueSchema = z.object({
  id: z.string().uuid(),
  equipmentId: z.string().uuid(),
  issuedToType: z.enum(["student", "teacher", "staff"]),
  issuedToId: z.string().uuid(),
  issuedAt: z.string(),
  returnedAt: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: z.enum(["issued", "returned"]),
  createdAt: z.string(),
});
export type EducationEquipmentIssue = z.infer<typeof educationEquipmentIssueSchema>;

export const createEducationEquipmentIssueSchema = z.object({
  equipmentId: z.string().uuid(),
  issuedToType: z.enum(["student", "teacher", "staff"]),
  issuedToId: z.string().uuid(),
  notes: z.string().max(2000).optional(),
});

export const educationInventoryItemSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  categoryCode: z.string(),
  qtyOnHand: z.number().int(),
  reorderLevel: z.number().int(),
  unit: z.string(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EducationInventoryItem = z.infer<typeof educationInventoryItemSchema>;

export const createEducationInventoryItemSchema = z.object({
  branchCode: z.string().min(1),
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(160),
  categoryCode: z.string().min(1).max(64),
  qtyOnHand: z.number().int().min(0).optional(),
  reorderLevel: z.number().int().min(0).optional(),
  unit: z.string().min(1).max(40),
  status: z.string().min(1).max(40).optional(),
});

export const updateEducationInventoryItemSchema = createEducationInventoryItemSchema.partial().extend({
  id: z.string().uuid(),
});

export const educationPurchaseRequestSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  title: z.string(),
  status: z.enum(["requested", "approved", "ordered", "received", "cancelled", "rejected"]),
  totalPkr: z.number().int(),
  notes: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EducationPurchaseRequest = z.infer<typeof educationPurchaseRequestSchema>;

export const createEducationPurchaseRequestSchema = z.object({
  branchCode: z.string().min(1),
  title: z.string().min(1).max(200),
  status: z
    .enum(["requested", "approved", "ordered", "received", "cancelled", "rejected"])
    .optional(),
  totalPkr: z.number().int().min(0).optional(),
  notes: z.string().max(2000).optional(),
});

export const updateEducationPurchaseRequestSchema = createEducationPurchaseRequestSchema
  .partial()
  .extend({
    id: z.string().uuid(),
  });

export const educationEventParticipantSchema = z.object({
  id: z.string().uuid(),
  eventId: z.string().uuid(),
  personType: z.enum(["student", "teacher", "staff", "alumni", "guest"]),
  personId: z.string().uuid(),
  status: z.enum(["registered", "attended", "cancelled", "no_show"]),
  createdAt: z.string(),
});
export type EducationEventParticipant = z.infer<typeof educationEventParticipantSchema>;

export const createEducationEventParticipantSchema = z.object({
  eventId: z.string().uuid(),
  personType: z.enum(["student", "teacher", "staff", "alumni", "guest"]),
  personId: z.string().uuid(),
  status: z.enum(["registered", "attended", "cancelled", "no_show"]).optional(),
});

export const updateEducationEventParticipantSchema = createEducationEventParticipantSchema
  .partial()
  .extend({
    id: z.string().uuid(),
  });

export const educationWorkflowDefSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  workflowKey: z.string(),
  name: z.string(),
  statesJson: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EducationWorkflowDef = z.infer<typeof educationWorkflowDefSchema>;

export const createEducationWorkflowDefSchema = z.object({
  workflowKey: z.string().min(1).max(64),
  name: z.string().min(1).max(160),
  statesJson: z.string().min(1),
  isActive: z.boolean().optional(),
});

export const updateEducationWorkflowDefSchema = createEducationWorkflowDefSchema.partial().extend({
  id: z.string().uuid(),
});

export const educationNotificationRuleSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  ruleKey: z.string(),
  triggerKey: z.string(),
  audienceCode: z.string(),
  messageTemplate: z.string(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EducationNotificationRule = z.infer<typeof educationNotificationRuleSchema>;

export const createEducationNotificationRuleSchema = z.object({
  ruleKey: z.string().min(1).max(64),
  triggerKey: z.string().min(1).max(64),
  audienceCode: z.string().min(1).max(64),
  messageTemplate: z.string().min(1),
  enabled: z.boolean().optional(),
});

export const updateEducationNotificationRuleSchema = createEducationNotificationRuleSchema
  .partial()
  .extend({
    id: z.string().uuid(),
  });

export type CreateEducationLeaveRequest = z.infer<typeof createEducationLeaveRequestSchema>;
export type UpdateEducationLeaveRequest = z.infer<typeof updateEducationLeaveRequestSchema>;
export type CreateEducationDisciplineIncident = z.infer<
  typeof createEducationDisciplineIncidentSchema
>;
export type UpdateEducationDisciplineIncident = z.infer<
  typeof updateEducationDisciplineIncidentSchema
>;
export type CreateEducationStudentLifecycle = z.infer<typeof createEducationStudentLifecycleSchema>;
export type BulkPromoteEducationStudents = z.infer<typeof bulkPromoteEducationStudentsSchema>;
export type CreateEducationAssignment = z.infer<typeof createEducationAssignmentSchema>;
export type UpdateEducationAssignment = z.infer<typeof updateEducationAssignmentSchema>;
export type CreateEducationAssignmentSubmission = z.infer<
  typeof createEducationAssignmentSubmissionSchema
>;
export type UpdateEducationAssignmentSubmission = z.infer<
  typeof updateEducationAssignmentSubmissionSchema
>;
export type CreateEducationScholarship = z.infer<typeof createEducationScholarshipSchema>;
export type UpdateEducationScholarship = z.infer<typeof updateEducationScholarshipSchema>;
export type CreateEducationScholarshipAward = z.infer<typeof createEducationScholarshipAwardSchema>;
export type CreateEducationFeeRefund = z.infer<typeof createEducationFeeRefundSchema>;
export type UpdateEducationFeeRefund = z.infer<typeof updateEducationFeeRefundSchema>;
export type CreateEducationEnquiry = z.infer<typeof createEducationEnquirySchema>;
export type UpdateEducationEnquiry = z.infer<typeof updateEducationEnquirySchema>;
export type CreateEducationEvent = z.infer<typeof createEducationEventSchema>;
export type UpdateEducationEvent = z.infer<typeof updateEducationEventSchema>;
export type CreateEducationAlumni = z.infer<typeof createEducationAlumniSchema>;
export type UpdateEducationAlumni = z.infer<typeof updateEducationAlumniSchema>;
export type CreateEducationHealthRecord = z.infer<typeof createEducationHealthRecordSchema>;
export type UpdateEducationHealthRecord = z.infer<typeof updateEducationHealthRecordSchema>;
export type CreateEducationHealthVisit = z.infer<typeof createEducationHealthVisitSchema>;
export type CreateEducationHostel = z.infer<typeof createEducationHostelSchema>;
export type UpdateEducationHostel = z.infer<typeof updateEducationHostelSchema>;
export type CreateEducationHostelRoom = z.infer<typeof createEducationHostelRoomSchema>;
export type UpdateEducationHostelRoom = z.infer<typeof updateEducationHostelRoomSchema>;
export type CreateEducationHostelBed = z.infer<typeof createEducationHostelBedSchema>;
export type UpdateEducationHostelBed = z.infer<typeof updateEducationHostelBedSchema>;
export type CreateEducationHostelAllocation = z.infer<typeof createEducationHostelAllocationSchema>;
export type UpdateEducationHostelAllocation = z.infer<typeof updateEducationHostelAllocationSchema>;
export type CreateEducationCustomFieldDef = z.infer<typeof createEducationCustomFieldDefSchema>;
export type UpdateEducationCustomFieldDef = z.infer<typeof updateEducationCustomFieldDefSchema>;
export type CreateEducationCustomFieldValue = z.infer<typeof createEducationCustomFieldValueSchema>;
export type UpdateEducationCustomFieldValue = z.infer<typeof updateEducationCustomFieldValueSchema>;
export type CreateEducationBuilding = z.infer<typeof createEducationBuildingSchema>;
export type UpdateEducationBuilding = z.infer<typeof updateEducationBuildingSchema>;
export type CreateEducationLab = z.infer<typeof createEducationLabSchema>;
export type UpdateEducationLab = z.infer<typeof updateEducationLabSchema>;
export type CreateEducationEquipment = z.infer<typeof createEducationEquipmentSchema>;
export type UpdateEducationEquipment = z.infer<typeof updateEducationEquipmentSchema>;
export type CreateEducationEquipmentIssue = z.infer<typeof createEducationEquipmentIssueSchema>;
export type CreateEducationInventoryItem = z.infer<typeof createEducationInventoryItemSchema>;
export type UpdateEducationInventoryItem = z.infer<typeof updateEducationInventoryItemSchema>;
export type CreateEducationPurchaseRequest = z.infer<typeof createEducationPurchaseRequestSchema>;
export type UpdateEducationPurchaseRequest = z.infer<typeof updateEducationPurchaseRequestSchema>;
export type CreateEducationEventParticipant = z.infer<typeof createEducationEventParticipantSchema>;
export type UpdateEducationEventParticipant = z.infer<typeof updateEducationEventParticipantSchema>;
export type CreateEducationWorkflowDef = z.infer<typeof createEducationWorkflowDefSchema>;
export type UpdateEducationWorkflowDef = z.infer<typeof updateEducationWorkflowDefSchema>;
export type CreateEducationNotificationRule = z.infer<typeof createEducationNotificationRuleSchema>;
export type UpdateEducationNotificationRule = z.infer<typeof updateEducationNotificationRuleSchema>;
