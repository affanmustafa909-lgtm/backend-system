-- Safe create/ensure for Embroidery Factory domain tables.
-- Does not drop or truncate data. Safe to re-run.

CREATE TABLE IF NOT EXISTS embroidery_designs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  customer_id uuid,
  stitch_count integer NOT NULL DEFAULT 0,
  colorways text,
  file_name text,
  file_content_base64 text,
  file_mime_type text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE embroidery_designs ADD COLUMN IF NOT EXISTS file_content_base64 text;
ALTER TABLE embroidery_designs ADD COLUMN IF NOT EXISTS file_mime_type text;

CREATE TABLE IF NOT EXISTS embroidery_machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  heads integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'idle',
  operator_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS embroidery_customer_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  order_number text NOT NULL,
  customer_id uuid NOT NULL,
  design_id uuid REFERENCES embroidery_designs(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft',
  due_date text,
  quantity integer NOT NULL DEFAULT 1,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS embroidery_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  job_number text NOT NULL,
  customer_id uuid,
  customer_order_id uuid REFERENCES embroidery_customer_orders(id) ON DELETE SET NULL,
  design_id uuid REFERENCES embroidery_designs(id) ON DELETE SET NULL,
  machine_id uuid REFERENCES embroidery_machines(id) ON DELETE SET NULL,
  operator_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  stage text NOT NULL DEFAULT 'draft',
  due_date text,
  piece_rate_pkr integer NOT NULL DEFAULT 0,
  material_cost_pkr integer NOT NULL DEFAULT 0,
  labor_cost_pkr integer NOT NULL DEFAULT 0,
  overhead_cost_pkr integer NOT NULL DEFAULT 0,
  invoice_amount_pkr integer NOT NULL DEFAULT 0,
  invoice_ref text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS embroidery_job_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES embroidery_jobs(id) ON DELETE CASCADE,
  size_label text NOT NULL,
  color_label text NOT NULL DEFAULT 'Default',
  quantity integer NOT NULL DEFAULT 1,
  completed_qty integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS embroidery_material_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES embroidery_jobs(id) ON DELETE CASCADE,
  product_id uuid,
  item_name text NOT NULL,
  quantity numeric(14,3) NOT NULL,
  unit text NOT NULL DEFAULT 'pc',
  customer_owned text NOT NULL DEFAULT 'no',
  unit_cost_pkr integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS embroidery_qc_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES embroidery_jobs(id) ON DELETE CASCADE,
  result text NOT NULL,
  defect_code text,
  quantity integer NOT NULL DEFAULT 1,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS embroidery_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES embroidery_jobs(id) ON DELETE CASCADE,
  challan_number text NOT NULL,
  delivered_qty integer NOT NULL DEFAULT 1,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  invoice_ref text,
  invoice_amount_pkr integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS embroidery_piece_rate_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES embroidery_jobs(id) ON DELETE CASCADE,
  operator_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  pieces integer NOT NULL DEFAULT 1,
  rate_pkr integer NOT NULL DEFAULT 0,
  amount_pkr integer NOT NULL DEFAULT 0,
  work_date text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS embroidery_production_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES embroidery_jobs(id) ON DELETE CASCADE,
  machine_id uuid REFERENCES embroidery_machines(id) ON DELETE SET NULL,
  operator_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  stage text NOT NULL,
  pieces_completed integer NOT NULL DEFAULT 0,
  hours_worked numeric(10,2) NOT NULL DEFAULT 0,
  notes text,
  logged_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS embroidery_designs_org_branch_idx ON embroidery_designs (organization_id, branch_id);
CREATE INDEX IF NOT EXISTS embroidery_machines_org_branch_idx ON embroidery_machines (organization_id, branch_id);
CREATE INDEX IF NOT EXISTS embroidery_orders_org_branch_idx ON embroidery_customer_orders (organization_id, branch_id);
CREATE INDEX IF NOT EXISTS embroidery_jobs_org_branch_stage_idx ON embroidery_jobs (organization_id, branch_id, stage);
CREATE INDEX IF NOT EXISTS embroidery_jobs_order_idx ON embroidery_jobs (customer_order_id);
CREATE INDEX IF NOT EXISTS embroidery_deliveries_job_idx ON embroidery_deliveries (job_id);
CREATE INDEX IF NOT EXISTS embroidery_piece_rate_job_idx ON embroidery_piece_rate_entries (job_id);
CREATE INDEX IF NOT EXISTS embroidery_production_logs_job_idx ON embroidery_production_logs (job_id);
