-- 15 extra factory modules. Idempotent.

CREATE TABLE IF NOT EXISTS factory_purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  po_number text NOT NULL,
  vendor_party_id uuid REFERENCES factory_parties(id) ON DELETE SET NULL,
  po_date text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  expected_date text,
  amount_pkr integer NOT NULL DEFAULT 0,
  notes text,
  details_json text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS factory_purchase_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  receipt_number text NOT NULL,
  vendor_party_id uuid REFERENCES factory_parties(id) ON DELETE SET NULL,
  po_id uuid REFERENCES factory_purchase_orders(id) ON DELETE SET NULL,
  receipt_date text NOT NULL,
  status text NOT NULL DEFAULT 'received',
  notes text,
  details_json text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS factory_defect_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  return_number text NOT NULL,
  claim_side text NOT NULL DEFAULT 'party',
  party_id uuid REFERENCES factory_parties(id) ON DELETE SET NULL,
  operator_id uuid REFERENCES factory_operators(id) ON DELETE SET NULL,
  job_id uuid REFERENCES embroidery_jobs(id) ON DELETE SET NULL,
  return_date text NOT NULL,
  qty integer NOT NULL DEFAULT 1,
  defect_code text,
  amount_pkr integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  notes text,
  details_json text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS factory_handwork_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  issue_number text NOT NULL,
  karigar_party_id uuid REFERENCES factory_parties(id) ON DELETE SET NULL,
  job_id uuid REFERENCES embroidery_jobs(id) ON DELETE SET NULL,
  design_id uuid REFERENCES embroidery_designs(id) ON DELETE SET NULL,
  issue_date text NOT NULL,
  due_date text,
  qty integer NOT NULL DEFAULT 1,
  rate_pkr integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'issued',
  notes text,
  details_json text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS factory_handwork_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  return_number text NOT NULL,
  issue_id uuid REFERENCES factory_handwork_issues(id) ON DELETE SET NULL,
  return_date text NOT NULL,
  qty integer NOT NULL DEFAULT 1,
  loss_qty integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'received',
  notes text,
  details_json text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS factory_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  operator_id uuid NOT NULL REFERENCES factory_operators(id) ON DELETE CASCADE,
  attend_date text NOT NULL,
  shift text NOT NULL DEFAULT 'day',
  status text NOT NULL DEFAULT 'present',
  hours numeric(6,2) NOT NULL DEFAULT 8,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS factory_leave (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  operator_id uuid NOT NULL REFERENCES factory_operators(id) ON DELETE CASCADE,
  from_date text NOT NULL,
  to_date text NOT NULL,
  leave_type text NOT NULL DEFAULT 'casual',
  status text NOT NULL DEFAULT 'approved',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS factory_thread_consumption (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  entry_date text NOT NULL,
  design_id uuid REFERENCES embroidery_designs(id) ON DELETE SET NULL,
  job_id uuid REFERENCES embroidery_jobs(id) ON DELETE SET NULL,
  item_id uuid REFERENCES factory_items(id) ON DELETE SET NULL,
  qty numeric(18,3) NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'cone',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS factory_stitch_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES pops_branches(id) ON DELETE SET NULL,
  code text NOT NULL,
  name text NOT NULL,
  head_arrangement text NOT NULL DEFAULT '1-7-11-B',
  work_type text NOT NULL DEFAULT 'flat',
  rate_per_1k_pkr integer NOT NULL DEFAULT 0,
  notes text,
  active text NOT NULL DEFAULT 'yes',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS factory_job_out (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  out_number text NOT NULL,
  vendor_party_id uuid REFERENCES factory_parties(id) ON DELETE SET NULL,
  job_id uuid REFERENCES embroidery_jobs(id) ON DELETE SET NULL,
  out_date text NOT NULL,
  due_date text,
  qty integer NOT NULL DEFAULT 1,
  process_name text NOT NULL DEFAULT 'embroidery',
  status text NOT NULL DEFAULT 'out',
  notes text,
  details_json text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS factory_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  expense_date text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  amount_pkr integer NOT NULL DEFAULT 0,
  pay_mode text NOT NULL DEFAULT 'cash',
  vendor_name text,
  narration text,
  status text NOT NULL DEFAULT 'posted',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS factory_maintenance_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  machine_id uuid REFERENCES embroidery_machines(id) ON DELETE SET NULL,
  service_date text NOT NULL,
  service_type text NOT NULL DEFAULT 'preventive',
  cost_pkr integer NOT NULL DEFAULT 0,
  next_due_date text,
  notes text,
  status text NOT NULL DEFAULT 'done',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS factory_salary_slips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  operator_id uuid NOT NULL REFERENCES factory_operators(id) ON DELETE CASCADE,
  period_month text NOT NULL,
  gross_pkr integer NOT NULL DEFAULT 0,
  advances_pkr integer NOT NULL DEFAULT 0,
  bonus_pkr integer NOT NULL DEFAULT 0,
  cuts_pkr integer NOT NULL DEFAULT 0,
  net_pkr integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS factory_eway_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  eway_number text NOT NULL,
  doc_type text NOT NULL DEFAULT 'outward_cn',
  doc_ref text,
  party_id uuid REFERENCES factory_parties(id) ON DELETE SET NULL,
  eway_date text NOT NULL,
  vehicle text,
  amount_pkr integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS factory_broker_masters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES pops_branches(id) ON DELETE SET NULL,
  code text NOT NULL,
  name text NOT NULL,
  phone text,
  commission_pct numeric(6,2) NOT NULL DEFAULT 0,
  notes text,
  active text NOT NULL DEFAULT 'yes',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS factory_po_org_idx ON factory_purchase_orders (organization_id, branch_id);
CREATE INDEX IF NOT EXISTS factory_attendance_org_date_idx ON factory_attendance (organization_id, attend_date);
CREATE INDEX IF NOT EXISTS factory_expenses_org_date_idx ON factory_expenses (organization_id, expense_date);
