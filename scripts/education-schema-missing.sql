-- EducationFlow extension: CREATE IF NOT EXISTS for new tables + room column ALTERs.
-- Safe to re-run. Does not drop or rebuild existing modules.

-- Rooms: optional facilities columns
ALTER TABLE education_rooms ADD COLUMN IF NOT EXISTS building_id uuid;
ALTER TABLE education_rooms ADD COLUMN IF NOT EXISTS room_type_code text;
ALTER TABLE education_rooms ADD COLUMN IF NOT EXISTS floor integer;
ALTER TABLE education_rooms ADD COLUMN IF NOT EXISTS facilities_json text;

CREATE TABLE IF NOT EXISTS education_leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  applicant_type text NOT NULL,
  applicant_id uuid NOT NULL,
  leave_type_code text NOT NULL,
  start_date text NOT NULL,
  end_date text NOT NULL,
  days integer NOT NULL DEFAULT 1,
  reason text NOT NULL,
  attachment_url text,
  status text NOT NULL DEFAULT 'draft',
  approved_by uuid,
  approved_at timestamptz,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_discipline_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES education_students(id) ON DELETE CASCADE,
  class_id uuid REFERENCES education_classes(id) ON DELETE SET NULL,
  section_id uuid REFERENCES education_sections(id) ON DELETE SET NULL,
  incident_date text NOT NULL,
  incident_type_code text NOT NULL,
  description text NOT NULL,
  severity_code text NOT NULL,
  action_code text,
  warning text,
  responsible_staff_id uuid,
  parent_notified boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open',
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_student_lifecycle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES education_students(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  from_session_id uuid REFERENCES education_academic_sessions(id) ON DELETE SET NULL,
  to_session_id uuid REFERENCES education_academic_sessions(id) ON DELETE SET NULL,
  from_class_id uuid REFERENCES education_classes(id) ON DELETE SET NULL,
  to_class_id uuid REFERENCES education_classes(id) ON DELETE SET NULL,
  from_section_id uuid REFERENCES education_sections(id) ON DELETE SET NULL,
  to_section_id uuid REFERENCES education_sections(id) ON DELETE SET NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending',
  approved_by uuid,
  effective_date text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  subject_id uuid REFERENCES education_subjects(id) ON DELETE SET NULL,
  course_id uuid REFERENCES education_courses(id) ON DELETE SET NULL,
  class_id uuid REFERENCES education_classes(id) ON DELETE SET NULL,
  section_id uuid REFERENCES education_sections(id) ON DELETE SET NULL,
  batch_id uuid REFERENCES education_batches(id) ON DELETE SET NULL,
  teacher_id uuid REFERENCES education_teachers(id) ON DELETE SET NULL,
  due_date text,
  status text NOT NULL DEFAULT 'draft',
  total_marks integer,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_assignment_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES education_assignments(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES education_students(id) ON DELETE CASCADE,
  submitted_at timestamptz,
  content text,
  attachment_url text,
  marks integer,
  remarks text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_scholarships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  scholarship_type_code text NOT NULL,
  discount_type text NOT NULL,
  discount_value integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  start_date text,
  end_date text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_scholarship_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scholarship_id uuid NOT NULL REFERENCES education_scholarships(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES education_students(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES education_fee_invoices(id) ON DELETE SET NULL,
  amount_pkr integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  awarded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_fee_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES education_students(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES education_fee_invoices(id) ON DELETE SET NULL,
  payment_id uuid REFERENCES education_fee_payments(id) ON DELETE SET NULL,
  amount_pkr integer NOT NULL DEFAULT 0,
  reason text NOT NULL,
  payment_method_code text,
  status text NOT NULL DEFAULT 'requested',
  approved_by uuid,
  processed_by uuid,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_buildings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  floors integer,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_labs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  room_id uuid REFERENCES education_rooms(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  lab_id uuid REFERENCES education_labs(id) ON DELETE SET NULL,
  equipment_number text NOT NULL,
  name text NOT NULL,
  category_code text NOT NULL,
  serial_number text,
  purchase_date text,
  purchase_cost_pkr integer,
  condition_code text,
  status text NOT NULL DEFAULT 'available',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_equipment_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid NOT NULL REFERENCES education_equipment(id) ON DELETE CASCADE,
  issued_to_type text NOT NULL,
  issued_to_id uuid NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  returned_at timestamptz,
  notes text,
  status text NOT NULL DEFAULT 'issued',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  sku text NOT NULL,
  name text NOT NULL,
  category_code text NOT NULL,
  qty_on_hand integer NOT NULL DEFAULT 0,
  reorder_level integer NOT NULL DEFAULT 0,
  unit text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_purchase_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'requested',
  total_pkr integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_enquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  email text,
  interested_program text,
  interested_class_id uuid REFERENCES education_classes(id) ON DELETE SET NULL,
  source_code text,
  status text NOT NULL DEFAULT 'new',
  assigned_staff_id uuid,
  follow_up_date text,
  remarks text,
  converted_admission_id uuid REFERENCES education_admissions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  title text NOT NULL,
  event_type_code text NOT NULL,
  start_date text NOT NULL,
  end_date text,
  audience_code text,
  status text NOT NULL DEFAULT 'draft',
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_event_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES education_events(id) ON DELETE CASCADE,
  person_type text NOT NULL,
  person_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'registered',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_alumni (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  student_id uuid REFERENCES education_students(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  graduation_year integer,
  program_or_class text,
  phone text,
  email text,
  company text,
  position text,
  location text,
  achievements text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_health_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES education_students(id) ON DELETE CASCADE,
  allergies text,
  notes text,
  emergency_contact text,
  last_visit_date text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_health_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  health_record_id uuid NOT NULL REFERENCES education_health_records(id) ON DELETE CASCADE,
  visit_date text NOT NULL,
  reason text,
  treatment text,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_hostels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  gender_policy text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_hostel_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostel_id uuid NOT NULL REFERENCES education_hostels(id) ON DELETE CASCADE,
  room_number text NOT NULL,
  capacity integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_hostel_beds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostel_room_id uuid NOT NULL REFERENCES education_hostel_rooms(id) ON DELETE CASCADE,
  bed_code text NOT NULL,
  status text NOT NULL DEFAULT 'available',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_hostel_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bed_id uuid NOT NULL REFERENCES education_hostel_beds(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES education_students(id) ON DELETE CASCADE,
  check_in_date text NOT NULL,
  check_out_date text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_custom_field_defs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  field_key text NOT NULL,
  label text NOT NULL,
  field_type text NOT NULL,
  required boolean NOT NULL DEFAULT false,
  options_json text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_custom_field_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  field_key text NOT NULL,
  value_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_workflow_defs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workflow_key text NOT NULL,
  name text NOT NULL,
  states_json text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS education_notification_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_key text NOT NULL,
  trigger_key text NOT NULL,
  audience_code text NOT NULL,
  message_template text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
