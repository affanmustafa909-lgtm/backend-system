-- EducationFlow extended tables (idempotent) - NEW tables only
CREATE TABLE IF NOT EXISTS education_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  employee_number text NOT NULL,
  first_name text NOT NULL,
  last_name text,
  phone text,
  email text,
  cnic text,
  address text,
  designation text,
  department_id uuid REFERENCES education_departments(id) ON DELETE SET NULL,
  staff_category_code text,
  employment_type_code text,
  joining_date text,
  salary_pkr integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  photo_url text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_batch_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES education_batches(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES education_students(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  enrolled_at text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_break boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  capacity integer,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_timetable_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL,
  period_id uuid NOT NULL REFERENCES education_periods(id) ON DELETE CASCADE,
  room_id uuid REFERENCES education_rooms(id) ON DELETE SET NULL,
  class_id uuid REFERENCES education_classes(id) ON DELETE SET NULL,
  section_id uuid REFERENCES education_sections(id) ON DELETE SET NULL,
  subject_id uuid REFERENCES education_subjects(id) ON DELETE SET NULL,
  teacher_id uuid REFERENCES education_teachers(id) ON DELETE SET NULL,
  batch_id uuid REFERENCES education_batches(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  date text NOT NULL,
  person_type text NOT NULL,
  person_id uuid NOT NULL,
  class_id uuid REFERENCES education_classes(id) ON DELETE SET NULL,
  section_id uuid REFERENCES education_sections(id) ON DELETE SET NULL,
  batch_id uuid REFERENCES education_batches(id) ON DELETE SET NULL,
  status_code text NOT NULL,
  notes text,
  marked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  exam_type_code text NOT NULL,
  session_id uuid REFERENCES education_academic_sessions(id) ON DELETE SET NULL,
  class_id uuid REFERENCES education_classes(id) ON DELETE SET NULL,
  program_id uuid REFERENCES education_programs(id) ON DELETE SET NULL,
  batch_id uuid REFERENCES education_batches(id) ON DELETE SET NULL,
  start_date text,
  end_date text,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_exam_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES education_exams(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES education_subjects(id) ON DELETE SET NULL,
  course_id uuid REFERENCES education_courses(id) ON DELETE SET NULL,
  total_marks integer NOT NULL DEFAULT 0,
  passing_marks integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES education_exams(id) ON DELETE CASCADE,
  exam_subject_id uuid NOT NULL REFERENCES education_exam_subjects(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES education_students(id) ON DELETE CASCADE,
  obtained_marks integer NOT NULL DEFAULT 0,
  percentage integer,
  grade_code text,
  gpa text,
  pass_fail text,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  title text NOT NULL,
  category_code text NOT NULL,
  amount_pkr integer NOT NULL DEFAULT 0,
  payment_method_code text,
  status text NOT NULL DEFAULT 'draft',
  expense_date text,
  notes text,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_finance_txns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  txn_type text NOT NULL,
  amount_pkr integer NOT NULL DEFAULT 0,
  ref_module text NOT NULL,
  ref_id uuid,
  title text NOT NULL,
  txn_date text NOT NULL,
  status text NOT NULL DEFAULT 'posted',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  period_label text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  total_pkr integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_payslips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payroll_run_id uuid NOT NULL REFERENCES education_payroll_runs(id) ON DELETE CASCADE,
  person_type text NOT NULL,
  person_id uuid NOT NULL,
  basic_pkr integer NOT NULL DEFAULT 0,
  allowances_pkr integer NOT NULL DEFAULT 0,
  deductions_pkr integer NOT NULL DEFAULT 0,
  net_pkr integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  title text NOT NULL,
  author text,
  publisher text,
  category_code text,
  isbn text,
  copies_total integer NOT NULL DEFAULT 0,
  copies_available integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_book_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES education_books(id) ON DELETE CASCADE,
  borrower_type text NOT NULL,
  borrower_id uuid NOT NULL,
  issued_at text NOT NULL,
  due_at text,
  returned_at text,
  fine_pkr integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'issued',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  code text NOT NULL,
  registration text NOT NULL,
  vehicle_type_code text,
  capacity integer,
  driver_name text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  vehicle_id uuid REFERENCES education_vehicles(id) ON DELETE SET NULL,
  fee_pkr integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_route_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  route_id uuid NOT NULL REFERENCES education_routes(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_transport_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  route_id uuid NOT NULL REFERENCES education_routes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES education_students(id) ON DELETE CASCADE,
  stop_id uuid REFERENCES education_route_stops(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  category_code text,
  audience_code text,
  status text NOT NULL DEFAULT 'draft',
  publish_at text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_document_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES pops_branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  document_type_code text NOT NULL,
  body_html text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_generated_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES pops_branches(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES education_document_templates(id) ON DELETE CASCADE,
  student_id uuid REFERENCES education_students(id) ON DELETE SET NULL,
  person_type text,
  person_id uuid,
  title text NOT NULL,
  payload_json text,
  status text NOT NULL DEFAULT 'generated',
  created_at timestamptz NOT NULL DEFAULT now()
);
