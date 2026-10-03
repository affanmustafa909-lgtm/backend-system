import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { popsBranches } from "./operations";

/** Configurable labels/statuses/types — admin-managed, never hard-coded in UI. */
export const educationLookups = pgTable("education_lookups", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").references(() => popsBranches.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  code: text("code").notNull(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  metaJson: text("meta_json"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationModules = pgTable("education_modules", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  moduleKey: text("module_key").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationSettings = pgTable("education_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").references(() => popsBranches.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  valueJson: text("value_json").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationAcademicSessions = pgTable("education_academic_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  startDate: text("start_date"),
  endDate: text("end_date"),
  isCurrent: boolean("is_current").notNull().default(false),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationClasses = pgTable("education_classes", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").references(() => educationAcademicSessions.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  level: text("level"),
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationSections = pgTable("education_sections", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  classId: uuid("class_id")
    .notNull()
    .references(() => educationClasses.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  capacity: integer("capacity"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationSubjects = pgTable("education_subjects", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  creditHours: integer("credit_hours"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationDepartments = pgTable("education_departments", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationPrograms = pgTable("education_programs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  departmentId: uuid("department_id").references(() => educationDepartments.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationCourses = pgTable("education_courses", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  programId: uuid("program_id").references(() => educationPrograms.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  durationText: text("duration_text"),
  feePkr: integer("fee_pkr").notNull().default(0),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationBatches = pgTable("education_batches", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").references(() => educationCourses.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  timingText: text("timing_text"),
  daysText: text("days_text"),
  capacity: integer("capacity"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationStudents = pgTable("education_students", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  studentNumber: text("student_number").notNull(),
  admissionNumber: text("admission_number"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  fatherName: text("father_name"),
  motherName: text("mother_name"),
  dateOfBirth: text("date_of_birth"),
  genderCode: text("gender_code"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  photoUrl: text("photo_url"),
  admissionDate: text("admission_date"),
  statusCode: text("status_code").notNull().default("active"),
  classId: uuid("class_id").references(() => educationClasses.id, { onDelete: "set null" }),
  sectionId: uuid("section_id").references(() => educationSections.id, { onDelete: "set null" }),
  sessionId: uuid("session_id").references(() => educationAcademicSessions.id, { onDelete: "set null" }),
  customFieldsJson: text("custom_fields_json"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationGuardians = pgTable("education_guardians", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  phone: text("phone"),
  email: text("email"),
  relationshipCode: text("relationship_code"),
  address: text("address"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationStudentGuardians = pgTable("education_student_guardians", {
  id: uuid("id").defaultRandom().primaryKey(),
  studentId: uuid("student_id")
    .notNull()
    .references(() => educationStudents.id, { onDelete: "cascade" }),
  guardianId: uuid("guardian_id")
    .notNull()
    .references(() => educationGuardians.id, { onDelete: "cascade" }),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationTeachers = pgTable("education_teachers", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  employeeNumber: text("employee_number").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  phone: text("phone"),
  email: text("email"),
  departmentId: uuid("department_id").references(() => educationDepartments.id, { onDelete: "set null" }),
  designation: text("designation"),
  employmentTypeCode: text("employment_type_code"),
  status: text("status").notNull().default("active"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationAdmissions = pgTable("education_admissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  applicationNumber: text("application_number").notNull(),
  applicantName: text("applicant_name").notNull(),
  fatherName: text("father_name"),
  phone: text("phone"),
  email: text("email"),
  admissionTypeCode: text("admission_type_code").notNull(),
  statusCode: text("status_code").notNull().default("application"),
  classId: uuid("class_id").references(() => educationClasses.id, { onDelete: "set null" }),
  sessionId: uuid("session_id").references(() => educationAcademicSessions.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationFeeStructures = pgTable("education_fee_structures", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  feeTypeCode: text("fee_type_code").notNull(),
  amountPkr: integer("amount_pkr").notNull().default(0),
  frequency: text("frequency").notNull().default("monthly"),
  classId: uuid("class_id").references(() => educationClasses.id, { onDelete: "set null" }),
  sessionId: uuid("session_id").references(() => educationAcademicSessions.id, { onDelete: "set null" }),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationFeeInvoices = pgTable("education_fee_invoices", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  studentId: uuid("student_id")
    .notNull()
    .references(() => educationStudents.id, { onDelete: "cascade" }),
  voucherNumber: text("voucher_number").notNull(),
  feeTypeCode: text("fee_type_code").notNull(),
  title: text("title").notNull(),
  amountPkr: integer("amount_pkr").notNull().default(0),
  paidPkr: integer("paid_pkr").notNull().default(0),
  dueDate: text("due_date"),
  status: text("status").notNull().default("pending"),
  sessionId: uuid("session_id").references(() => educationAcademicSessions.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationFeePayments = pgTable("education_fee_payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => educationFeeInvoices.id, { onDelete: "cascade" }),
  studentId: uuid("student_id")
    .notNull()
    .references(() => educationStudents.id, { onDelete: "cascade" }),
  receiptNumber: text("receipt_number").notNull(),
  amountPkr: integer("amount_pkr").notNull(),
  paymentMethodCode: text("payment_method_code").notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }).notNull().defaultNow(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationAuditLogs = pgTable("education_audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").references(() => popsBranches.id, { onDelete: "set null" }),
  userId: uuid("user_id"),
  action: text("action").notNull(),
  moduleKey: text("module_key").notNull(),
  recordId: text("record_id"),
  detail: text("detail"),
  oldValueJson: text("old_value_json"),
  newValueJson: text("new_value_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationStaff = pgTable("education_staff", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  employeeNumber: text("employee_number").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  phone: text("phone"),
  email: text("email"),
  cnic: text("cnic"),
  address: text("address"),
  designation: text("designation"),
  departmentId: uuid("department_id").references(() => educationDepartments.id, { onDelete: "set null" }),
  staffCategoryCode: text("staff_category_code"),
  employmentTypeCode: text("employment_type_code"),
  joiningDate: text("joining_date"),
  salaryPkr: integer("salary_pkr").notNull().default(0),
  status: text("status").notNull().default("active"),
  photoUrl: text("photo_url"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationBatchStudents = pgTable("education_batch_students", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  batchId: uuid("batch_id")
    .notNull()
    .references(() => educationBatches.id, { onDelete: "cascade" }),
  studentId: uuid("student_id")
    .notNull()
    .references(() => educationStudents.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("active"),
  enrolledAt: text("enrolled_at"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationPeriods = pgTable("education_periods", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isBreak: boolean("is_break").notNull().default(false),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationRooms = pgTable("education_rooms", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  buildingId: uuid("building_id"),
  code: text("code").notNull(),
  name: text("name").notNull(),
  roomTypeCode: text("room_type_code"),
  floor: integer("floor"),
  capacity: integer("capacity"),
  facilitiesJson: text("facilities_json"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationTimetableSlots = pgTable("education_timetable_slots", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week").notNull(),
  periodId: uuid("period_id")
    .notNull()
    .references(() => educationPeriods.id, { onDelete: "cascade" }),
  roomId: uuid("room_id").references(() => educationRooms.id, { onDelete: "set null" }),
  classId: uuid("class_id").references(() => educationClasses.id, { onDelete: "set null" }),
  sectionId: uuid("section_id").references(() => educationSections.id, { onDelete: "set null" }),
  subjectId: uuid("subject_id").references(() => educationSubjects.id, { onDelete: "set null" }),
  teacherId: uuid("teacher_id").references(() => educationTeachers.id, { onDelete: "set null" }),
  batchId: uuid("batch_id").references(() => educationBatches.id, { onDelete: "set null" }),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationAttendance = pgTable("education_attendance", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  personType: text("person_type").notNull(),
  personId: uuid("person_id").notNull(),
  classId: uuid("class_id").references(() => educationClasses.id, { onDelete: "set null" }),
  sectionId: uuid("section_id").references(() => educationSections.id, { onDelete: "set null" }),
  batchId: uuid("batch_id").references(() => educationBatches.id, { onDelete: "set null" }),
  statusCode: text("status_code").notNull(),
  notes: text("notes"),
  markedBy: uuid("marked_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationExams = pgTable("education_exams", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  examTypeCode: text("exam_type_code").notNull(),
  sessionId: uuid("session_id").references(() => educationAcademicSessions.id, { onDelete: "set null" }),
  classId: uuid("class_id").references(() => educationClasses.id, { onDelete: "set null" }),
  programId: uuid("program_id").references(() => educationPrograms.id, { onDelete: "set null" }),
  batchId: uuid("batch_id").references(() => educationBatches.id, { onDelete: "set null" }),
  startDate: text("start_date"),
  endDate: text("end_date"),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationExamSubjects = pgTable("education_exam_subjects", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  examId: uuid("exam_id")
    .notNull()
    .references(() => educationExams.id, { onDelete: "cascade" }),
  subjectId: uuid("subject_id").references(() => educationSubjects.id, { onDelete: "set null" }),
  courseId: uuid("course_id").references(() => educationCourses.id, { onDelete: "set null" }),
  totalMarks: integer("total_marks").notNull().default(0),
  passingMarks: integer("passing_marks").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationMarks = pgTable("education_marks", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  examId: uuid("exam_id")
    .notNull()
    .references(() => educationExams.id, { onDelete: "cascade" }),
  examSubjectId: uuid("exam_subject_id")
    .notNull()
    .references(() => educationExamSubjects.id, { onDelete: "cascade" }),
  studentId: uuid("student_id")
    .notNull()
    .references(() => educationStudents.id, { onDelete: "cascade" }),
  obtainedMarks: integer("obtained_marks").notNull().default(0),
  percentage: integer("percentage"),
  gradeCode: text("grade_code"),
  gpa: text("gpa"),
  passFail: text("pass_fail"),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationExpenses = pgTable("education_expenses", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  categoryCode: text("category_code").notNull(),
  amountPkr: integer("amount_pkr").notNull().default(0),
  paymentMethodCode: text("payment_method_code"),
  status: text("status").notNull().default("draft"),
  expenseDate: text("expense_date"),
  notes: text("notes"),
  approvedBy: uuid("approved_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationFinanceTxns = pgTable("education_finance_txns", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  txnType: text("txn_type").notNull(),
  amountPkr: integer("amount_pkr").notNull().default(0),
  refModule: text("ref_module").notNull(),
  refId: uuid("ref_id"),
  title: text("title").notNull(),
  txnDate: text("txn_date").notNull(),
  status: text("status").notNull().default("posted"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationPayrollRuns = pgTable("education_payroll_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  periodLabel: text("period_label").notNull(),
  status: text("status").notNull().default("draft"),
  totalPkr: integer("total_pkr").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationPayslips = pgTable("education_payslips", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  payrollRunId: uuid("payroll_run_id")
    .notNull()
    .references(() => educationPayrollRuns.id, { onDelete: "cascade" }),
  personType: text("person_type").notNull(),
  personId: uuid("person_id").notNull(),
  basicPkr: integer("basic_pkr").notNull().default(0),
  allowancesPkr: integer("allowances_pkr").notNull().default(0),
  deductionsPkr: integer("deductions_pkr").notNull().default(0),
  netPkr: integer("net_pkr").notNull().default(0),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationBooks = pgTable("education_books", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  author: text("author"),
  publisher: text("publisher"),
  categoryCode: text("category_code"),
  isbn: text("isbn"),
  copiesTotal: integer("copies_total").notNull().default(0),
  copiesAvailable: integer("copies_available").notNull().default(0),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationBookIssues = pgTable("education_book_issues", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  bookId: uuid("book_id")
    .notNull()
    .references(() => educationBooks.id, { onDelete: "cascade" }),
  borrowerType: text("borrower_type").notNull(),
  borrowerId: uuid("borrower_id").notNull(),
  issuedAt: text("issued_at").notNull(),
  dueAt: text("due_at"),
  returnedAt: text("returned_at"),
  finePkr: integer("fine_pkr").notNull().default(0),
  status: text("status").notNull().default("issued"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationVehicles = pgTable("education_vehicles", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  registration: text("registration").notNull(),
  vehicleTypeCode: text("vehicle_type_code"),
  capacity: integer("capacity"),
  driverName: text("driver_name"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationRoutes = pgTable("education_routes", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  vehicleId: uuid("vehicle_id").references(() => educationVehicles.id, { onDelete: "set null" }),
  feePkr: integer("fee_pkr").notNull().default(0),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationRouteStops = pgTable("education_route_stops", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  routeId: uuid("route_id")
    .notNull()
    .references(() => educationRoutes.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationTransportAssignments = pgTable("education_transport_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  routeId: uuid("route_id")
    .notNull()
    .references(() => educationRoutes.id, { onDelete: "cascade" }),
  studentId: uuid("student_id")
    .notNull()
    .references(() => educationStudents.id, { onDelete: "cascade" }),
  stopId: uuid("stop_id").references(() => educationRouteStops.id, { onDelete: "set null" }),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationNotices = pgTable("education_notices", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  categoryCode: text("category_code"),
  audienceCode: text("audience_code"),
  status: text("status").notNull().default("draft"),
  publishAt: text("publish_at"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationDocumentTemplates = pgTable("education_document_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").references(() => popsBranches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  documentTypeCode: text("document_type_code").notNull(),
  bodyHtml: text("body_html").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationGeneratedDocuments = pgTable("education_generated_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").references(() => popsBranches.id, { onDelete: "cascade" }),
  templateId: uuid("template_id")
    .notNull()
    .references(() => educationDocumentTemplates.id, { onDelete: "cascade" }),
  studentId: uuid("student_id").references(() => educationStudents.id, { onDelete: "set null" }),
  personType: text("person_type"),
  personId: uuid("person_id"),
  title: text("title").notNull(),
  payloadJson: text("payload_json"),
  status: text("status").notNull().default("generated"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationLeaveRequests = pgTable("education_leave_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  applicantType: text("applicant_type").notNull(),
  applicantId: uuid("applicant_id").notNull(),
  leaveTypeCode: text("leave_type_code").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  days: integer("days").notNull().default(1),
  reason: text("reason").notNull(),
  attachmentUrl: text("attachment_url"),
  status: text("status").notNull().default("draft"),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  remarks: text("remarks"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationDisciplineIncidents = pgTable("education_discipline_incidents", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  studentId: uuid("student_id")
    .notNull()
    .references(() => educationStudents.id, { onDelete: "cascade" }),
  classId: uuid("class_id").references(() => educationClasses.id, { onDelete: "set null" }),
  sectionId: uuid("section_id").references(() => educationSections.id, { onDelete: "set null" }),
  incidentDate: text("incident_date").notNull(),
  incidentTypeCode: text("incident_type_code").notNull(),
  description: text("description").notNull(),
  severityCode: text("severity_code").notNull(),
  actionCode: text("action_code"),
  warning: text("warning"),
  responsibleStaffId: uuid("responsible_staff_id"),
  parentNotified: boolean("parent_notified").notNull().default(false),
  status: text("status").notNull().default("open"),
  remarks: text("remarks"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationStudentLifecycle = pgTable("education_student_lifecycle", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  studentId: uuid("student_id")
    .notNull()
    .references(() => educationStudents.id, { onDelete: "cascade" }),
  actionType: text("action_type").notNull(),
  fromSessionId: uuid("from_session_id").references(() => educationAcademicSessions.id, {
    onDelete: "set null",
  }),
  toSessionId: uuid("to_session_id").references(() => educationAcademicSessions.id, {
    onDelete: "set null",
  }),
  fromClassId: uuid("from_class_id").references(() => educationClasses.id, { onDelete: "set null" }),
  toClassId: uuid("to_class_id").references(() => educationClasses.id, { onDelete: "set null" }),
  fromSectionId: uuid("from_section_id").references(() => educationSections.id, {
    onDelete: "set null",
  }),
  toSectionId: uuid("to_section_id").references(() => educationSections.id, { onDelete: "set null" }),
  reason: text("reason"),
  status: text("status").notNull().default("pending"),
  approvedBy: uuid("approved_by"),
  effectiveDate: text("effective_date").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationAssignments = pgTable("education_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  subjectId: uuid("subject_id").references(() => educationSubjects.id, { onDelete: "set null" }),
  courseId: uuid("course_id").references(() => educationCourses.id, { onDelete: "set null" }),
  classId: uuid("class_id").references(() => educationClasses.id, { onDelete: "set null" }),
  sectionId: uuid("section_id").references(() => educationSections.id, { onDelete: "set null" }),
  batchId: uuid("batch_id").references(() => educationBatches.id, { onDelete: "set null" }),
  teacherId: uuid("teacher_id").references(() => educationTeachers.id, { onDelete: "set null" }),
  dueDate: text("due_date"),
  status: text("status").notNull().default("draft"),
  totalMarks: integer("total_marks"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationAssignmentSubmissions = pgTable("education_assignment_submissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  assignmentId: uuid("assignment_id")
    .notNull()
    .references(() => educationAssignments.id, { onDelete: "cascade" }),
  studentId: uuid("student_id")
    .notNull()
    .references(() => educationStudents.id, { onDelete: "cascade" }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  content: text("content"),
  attachmentUrl: text("attachment_url"),
  marks: integer("marks"),
  remarks: text("remarks"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationScholarships = pgTable("education_scholarships", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  scholarshipTypeCode: text("scholarship_type_code").notNull(),
  discountType: text("discount_type").notNull(),
  discountValue: integer("discount_value").notNull().default(0),
  status: text("status").notNull().default("draft"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationScholarshipAwards = pgTable("education_scholarship_awards", {
  id: uuid("id").defaultRandom().primaryKey(),
  scholarshipId: uuid("scholarship_id")
    .notNull()
    .references(() => educationScholarships.id, { onDelete: "cascade" }),
  studentId: uuid("student_id")
    .notNull()
    .references(() => educationStudents.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").references(() => educationFeeInvoices.id, { onDelete: "set null" }),
  amountPkr: integer("amount_pkr").notNull().default(0),
  status: text("status").notNull().default("active"),
  awardedAt: timestamp("awarded_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationFeeRefunds = pgTable("education_fee_refunds", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  studentId: uuid("student_id")
    .notNull()
    .references(() => educationStudents.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").references(() => educationFeeInvoices.id, { onDelete: "set null" }),
  paymentId: uuid("payment_id").references(() => educationFeePayments.id, { onDelete: "set null" }),
  amountPkr: integer("amount_pkr").notNull().default(0),
  reason: text("reason").notNull(),
  paymentMethodCode: text("payment_method_code"),
  status: text("status").notNull().default("requested"),
  approvedBy: uuid("approved_by"),
  processedBy: uuid("processed_by"),
  remarks: text("remarks"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationBuildings = pgTable("education_buildings", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  floors: integer("floors"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationLabs = pgTable("education_labs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  roomId: uuid("room_id").references(() => educationRooms.id, { onDelete: "set null" }),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationEquipment = pgTable("education_equipment", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  labId: uuid("lab_id").references(() => educationLabs.id, { onDelete: "set null" }),
  equipmentNumber: text("equipment_number").notNull(),
  name: text("name").notNull(),
  categoryCode: text("category_code").notNull(),
  serialNumber: text("serial_number"),
  purchaseDate: text("purchase_date"),
  purchaseCostPkr: integer("purchase_cost_pkr"),
  conditionCode: text("condition_code"),
  status: text("status").notNull().default("available"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationEquipmentIssues = pgTable("education_equipment_issues", {
  id: uuid("id").defaultRandom().primaryKey(),
  equipmentId: uuid("equipment_id")
    .notNull()
    .references(() => educationEquipment.id, { onDelete: "cascade" }),
  issuedToType: text("issued_to_type").notNull(),
  issuedToId: uuid("issued_to_id").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  returnedAt: timestamp("returned_at", { withTimezone: true }),
  notes: text("notes"),
  status: text("status").notNull().default("issued"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationInventoryItems = pgTable("education_inventory_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  categoryCode: text("category_code").notNull(),
  qtyOnHand: integer("qty_on_hand").notNull().default(0),
  reorderLevel: integer("reorder_level").notNull().default(0),
  unit: text("unit").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationPurchaseRequests = pgTable("education_purchase_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  status: text("status").notNull().default("requested"),
  totalPkr: integer("total_pkr").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationEnquiries = pgTable("education_enquiries", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  interestedProgram: text("interested_program"),
  interestedClassId: uuid("interested_class_id").references(() => educationClasses.id, {
    onDelete: "set null",
  }),
  sourceCode: text("source_code"),
  status: text("status").notNull().default("new"),
  assignedStaffId: uuid("assigned_staff_id"),
  followUpDate: text("follow_up_date"),
  remarks: text("remarks"),
  convertedAdmissionId: uuid("converted_admission_id").references(() => educationAdmissions.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationEvents = pgTable("education_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  eventTypeCode: text("event_type_code").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  audienceCode: text("audience_code"),
  status: text("status").notNull().default("draft"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationEventParticipants = pgTable("education_event_participants", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => educationEvents.id, { onDelete: "cascade" }),
  personType: text("person_type").notNull(),
  personId: uuid("person_id").notNull(),
  status: text("status").notNull().default("registered"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationAlumni = pgTable("education_alumni", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  studentId: uuid("student_id").references(() => educationStudents.id, { onDelete: "set null" }),
  fullName: text("full_name").notNull(),
  graduationYear: integer("graduation_year"),
  programOrClass: text("program_or_class"),
  phone: text("phone"),
  email: text("email"),
  company: text("company"),
  position: text("position"),
  location: text("location"),
  achievements: text("achievements"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationHealthRecords = pgTable("education_health_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  studentId: uuid("student_id")
    .notNull()
    .references(() => educationStudents.id, { onDelete: "cascade" }),
  allergies: text("allergies"),
  notes: text("notes"),
  emergencyContact: text("emergency_contact"),
  lastVisitDate: text("last_visit_date"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationHealthVisits = pgTable("education_health_visits", {
  id: uuid("id").defaultRandom().primaryKey(),
  healthRecordId: uuid("health_record_id")
    .notNull()
    .references(() => educationHealthRecords.id, { onDelete: "cascade" }),
  visitDate: text("visit_date").notNull(),
  reason: text("reason"),
  treatment: text("treatment"),
  recordedBy: uuid("recorded_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationHostels = pgTable("education_hostels", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  genderPolicy: text("gender_policy"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationHostelRooms = pgTable("education_hostel_rooms", {
  id: uuid("id").defaultRandom().primaryKey(),
  hostelId: uuid("hostel_id")
    .notNull()
    .references(() => educationHostels.id, { onDelete: "cascade" }),
  roomNumber: text("room_number").notNull(),
  capacity: integer("capacity").notNull().default(1),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationHostelBeds = pgTable("education_hostel_beds", {
  id: uuid("id").defaultRandom().primaryKey(),
  hostelRoomId: uuid("hostel_room_id")
    .notNull()
    .references(() => educationHostelRooms.id, { onDelete: "cascade" }),
  bedCode: text("bed_code").notNull(),
  status: text("status").notNull().default("available"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationHostelAllocations = pgTable("education_hostel_allocations", {
  id: uuid("id").defaultRandom().primaryKey(),
  bedId: uuid("bed_id")
    .notNull()
    .references(() => educationHostelBeds.id, { onDelete: "cascade" }),
  studentId: uuid("student_id")
    .notNull()
    .references(() => educationStudents.id, { onDelete: "cascade" }),
  checkInDate: text("check_in_date").notNull(),
  checkOutDate: text("check_out_date"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationCustomFieldDefs = pgTable("education_custom_field_defs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  fieldKey: text("field_key").notNull(),
  label: text("label").notNull(),
  fieldType: text("field_type").notNull(),
  required: boolean("required").notNull().default(false),
  optionsJson: text("options_json"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationCustomFieldValues = pgTable("education_custom_field_values", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  fieldKey: text("field_key").notNull(),
  valueText: text("value_text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationWorkflowDefs = pgTable("education_workflow_defs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  workflowKey: text("workflow_key").notNull(),
  name: text("name").notNull(),
  statesJson: text("states_json").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const educationNotificationRules = pgTable("education_notification_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  ruleKey: text("rule_key").notNull(),
  triggerKey: text("trigger_key").notNull(),
  audienceCode: text("audience_code").notNull(),
  messageTemplate: text("message_template").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
