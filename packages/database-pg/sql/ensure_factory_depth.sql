-- Factory Module Depth — additive columns + new tables. Idempotent.

-- Parties
ALTER TABLE factory_parties ADD COLUMN IF NOT EXISTS gstin text;
ALTER TABLE factory_parties ADD COLUMN IF NOT EXISTS ntn_cnic text;
ALTER TABLE factory_parties ADD COLUMN IF NOT EXISTS whatsapp text;
ALTER TABLE factory_parties ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE factory_parties ADD COLUMN IF NOT EXISTS billing_address text;
ALTER TABLE factory_parties ADD COLUMN IF NOT EXISTS shipping_address text;
ALTER TABLE factory_parties ADD COLUMN IF NOT EXISTS contact_persons text;
ALTER TABLE factory_parties ADD COLUMN IF NOT EXISTS payment_terms text;
ALTER TABLE factory_parties ADD COLUMN IF NOT EXISTS credit_limit_pkr integer NOT NULL DEFAULT 0;
ALTER TABLE factory_parties ADD COLUMN IF NOT EXISTS opening_balance_pkr integer NOT NULL DEFAULT 0;
ALTER TABLE factory_parties ADD COLUMN IF NOT EXISTS rate_type text NOT NULL DEFAULT 'stitch';
ALTER TABLE factory_parties ADD COLUMN IF NOT EXISTS default_stitch_rate_pkr integer NOT NULL DEFAULT 0;
ALTER TABLE factory_parties ADD COLUMN IF NOT EXISTS industry_segment text;
ALTER TABLE factory_parties ADD COLUMN IF NOT EXISTS bank_details text;
ALTER TABLE factory_parties ADD COLUMN IF NOT EXISTS details_json text;

-- Items
ALTER TABLE factory_items ADD COLUMN IF NOT EXISTS brand text;
ALTER TABLE factory_items ADD COLUMN IF NOT EXISTS colour text;
ALTER TABLE factory_items ADD COLUMN IF NOT EXISTS size_label text;
ALTER TABLE factory_items ADD COLUMN IF NOT EXISTS location text;
ALTER TABLE factory_items ADD COLUMN IF NOT EXISTS supplier_party_id uuid;
ALTER TABLE factory_items ADD COLUMN IF NOT EXISTS batch_lot text;
ALTER TABLE factory_items ADD COLUMN IF NOT EXISTS details_json text;

-- Operators
ALTER TABLE factory_operators ADD COLUMN IF NOT EXISTS cnic text;
ALTER TABLE factory_operators ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE factory_operators ADD COLUMN IF NOT EXISTS join_date text;
ALTER TABLE factory_operators ADD COLUMN IF NOT EXISTS pay_type text NOT NULL DEFAULT 'piece';
ALTER TABLE factory_operators ADD COLUMN IF NOT EXISTS bank_details text;
ALTER TABLE factory_operators ADD COLUMN IF NOT EXISTS photo_base64 text;
ALTER TABLE factory_operators ADD COLUMN IF NOT EXISTS details_json text;

-- Inward CN
ALTER TABLE factory_inward_challans ADD COLUMN IF NOT EXISTS party_cn_number text;
ALTER TABLE factory_inward_challans ADD COLUMN IF NOT EXISTS vehicle text;
ALTER TABLE factory_inward_challans ADD COLUMN IF NOT EXISTS received_by text;
ALTER TABLE factory_inward_challans ADD COLUMN IF NOT EXISTS details_json text;
ALTER TABLE factory_inward_challan_lines ADD COLUMN IF NOT EXISTS fabric text;
ALTER TABLE factory_inward_challan_lines ADD COLUMN IF NOT EXISTS lot_number text;
ALTER TABLE factory_inward_challan_lines ADD COLUMN IF NOT EXISTS condition_note text;
ALTER TABLE factory_inward_challan_lines ADD COLUMN IF NOT EXISTS details_json text;

-- Outward CN
ALTER TABLE factory_outward_challans ADD COLUMN IF NOT EXISTS vehicle text;
ALTER TABLE factory_outward_challans ADD COLUMN IF NOT EXISTS driver_name text;
ALTER TABLE factory_outward_challans ADD COLUMN IF NOT EXISTS eway_ref text;
ALTER TABLE factory_outward_challans ADD COLUMN IF NOT EXISTS details_json text;

-- Daily sheet lines
ALTER TABLE factory_daily_sheet_lines ADD COLUMN IF NOT EXISTS thread_breaks integer NOT NULL DEFAULT 0;
ALTER TABLE factory_daily_sheet_lines ADD COLUMN IF NOT EXISTS run_minutes integer NOT NULL DEFAULT 0;
ALTER TABLE factory_daily_sheet_lines ADD COLUMN IF NOT EXISTS stop_reason text;
ALTER TABLE factory_daily_sheet_lines ADD COLUMN IF NOT EXISTS details_json text;

-- Job bills
ALTER TABLE factory_job_bills ADD COLUMN IF NOT EXISTS tax_pkr integer NOT NULL DEFAULT 0;
ALTER TABLE factory_job_bills ADD COLUMN IF NOT EXISTS defect_deduction_pkr integer NOT NULL DEFAULT 0;
ALTER TABLE factory_job_bills ADD COLUMN IF NOT EXISTS discount_pkr integer NOT NULL DEFAULT 0;
ALTER TABLE factory_job_bills ADD COLUMN IF NOT EXISTS details_json text;

-- Designs depth
ALTER TABLE embroidery_designs ADD COLUMN IF NOT EXISTS width_mm integer NOT NULL DEFAULT 0;
ALTER TABLE embroidery_designs ADD COLUMN IF NOT EXISTS height_mm integer NOT NULL DEFAULT 0;
ALTER TABLE embroidery_designs ADD COLUMN IF NOT EXISTS hoop text;
ALTER TABLE embroidery_designs ADD COLUMN IF NOT EXISTS work_type text NOT NULL DEFAULT 'flat';
ALTER TABLE embroidery_designs ADD COLUMN IF NOT EXISTS thread_brand text;
ALTER TABLE embroidery_designs ADD COLUMN IF NOT EXISTS rate_per_1k_pkr integer NOT NULL DEFAULT 0;
ALTER TABLE embroidery_designs ADD COLUMN IF NOT EXISTS needle_chart_json text;
ALTER TABLE embroidery_designs ADD COLUMN IF NOT EXISTS preview_base64 text;
ALTER TABLE embroidery_designs ADD COLUMN IF NOT EXISTS preview_mime_type text;
ALTER TABLE embroidery_designs ADD COLUMN IF NOT EXISTS ai_analysis_json text;
ALTER TABLE embroidery_designs ADD COLUMN IF NOT EXISTS details_json text;

-- Machines depth
ALTER TABLE embroidery_machines ADD COLUMN IF NOT EXISTS brand text;
ALTER TABLE embroidery_machines ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE embroidery_machines ADD COLUMN IF NOT EXISTS serial_number text;
ALTER TABLE embroidery_machines ADD COLUMN IF NOT EXISTS needles_per_head integer NOT NULL DEFAULT 15;
ALTER TABLE embroidery_machines ADD COLUMN IF NOT EXISTS max_rpm integer NOT NULL DEFAULT 0;
ALTER TABLE embroidery_machines ADD COLUMN IF NOT EXISTS hoop_sizes text;
ALTER TABLE embroidery_machines ADD COLUMN IF NOT EXISTS attachments text;
ALTER TABLE embroidery_machines ADD COLUMN IF NOT EXISTS power_status text NOT NULL DEFAULT 'ok';
ALTER TABLE embroidery_machines ADD COLUMN IF NOT EXISTS feed_status text NOT NULL DEFAULT 'ok';
ALTER TABLE embroidery_machines ADD COLUMN IF NOT EXISTS beam_buffer_notes text;
ALTER TABLE embroidery_machines ADD COLUMN IF NOT EXISTS factory_operator_id uuid;
ALTER TABLE embroidery_machines ADD COLUMN IF NOT EXISTS current_design_id uuid;
ALTER TABLE embroidery_machines ADD COLUMN IF NOT EXISTS location_bay text;
ALTER TABLE embroidery_machines ADD COLUMN IF NOT EXISTS last_service_date text;
ALTER TABLE embroidery_machines ADD COLUMN IF NOT EXISTS next_service_date text;
ALTER TABLE embroidery_machines ADD COLUMN IF NOT EXISTS run_hours integer NOT NULL DEFAULT 0;
ALTER TABLE embroidery_machines ADD COLUMN IF NOT EXISTS stitch_counter bigint NOT NULL DEFAULT 0;
ALTER TABLE embroidery_machines ADD COLUMN IF NOT EXISTS details_json text;

-- Jobs depth
ALTER TABLE embroidery_jobs ADD COLUMN IF NOT EXISTS inward_challan_id uuid;
ALTER TABLE embroidery_jobs ADD COLUMN IF NOT EXISTS factory_operator_id uuid;
ALTER TABLE embroidery_jobs ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';
ALTER TABLE embroidery_jobs ADD COLUMN IF NOT EXISTS needle_chart_json text;
ALTER TABLE embroidery_jobs ADD COLUMN IF NOT EXISTS details_json text;

-- QC depth
ALTER TABLE embroidery_qc_records ADD COLUMN IF NOT EXISTS claim_side text NOT NULL DEFAULT 'operator';
ALTER TABLE embroidery_qc_records ADD COLUMN IF NOT EXISTS disposition text NOT NULL DEFAULT 'rework';
ALTER TABLE embroidery_qc_records ADD COLUMN IF NOT EXISTS details_json text;

-- Material issue link to factory item
ALTER TABLE embroidery_material_issues ADD COLUMN IF NOT EXISTS factory_item_id uuid;
ALTER TABLE embroidery_material_issues ADD COLUMN IF NOT EXISTS lot_number text;
ALTER TABLE embroidery_material_issues ADD COLUMN IF NOT EXISTS purpose text;
ALTER TABLE embroidery_material_issues ADD COLUMN IF NOT EXISTS returnable text NOT NULL DEFAULT 'no';
ALTER TABLE embroidery_material_issues ADD COLUMN IF NOT EXISTS issued_by text;

-- Production logs depth
ALTER TABLE embroidery_production_logs ADD COLUMN IF NOT EXISTS stitches integer NOT NULL DEFAULT 0;
ALTER TABLE embroidery_production_logs ADD COLUMN IF NOT EXISTS frames integer NOT NULL DEFAULT 0;
ALTER TABLE embroidery_production_logs ADD COLUMN IF NOT EXISTS thread_breaks integer NOT NULL DEFAULT 0;
ALTER TABLE embroidery_production_logs ADD COLUMN IF NOT EXISTS run_minutes integer NOT NULL DEFAULT 0;
ALTER TABLE embroidery_production_logs ADD COLUMN IF NOT EXISTS stop_minutes integer NOT NULL DEFAULT 0;
ALTER TABLE embroidery_production_logs ADD COLUMN IF NOT EXISTS factory_operator_id uuid;
ALTER TABLE embroidery_production_logs ADD COLUMN IF NOT EXISTS details_json text;

-- Deliveries depth
ALTER TABLE embroidery_deliveries ADD COLUMN IF NOT EXISTS vehicle text;
ALTER TABLE embroidery_deliveries ADD COLUMN IF NOT EXISTS driver_name text;
ALTER TABLE embroidery_deliveries ADD COLUMN IF NOT EXISTS details_json text;

CREATE TABLE IF NOT EXISTS factory_printer_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  printer_type text NOT NULL DEFAULT 'thermal',
  paper_width_mm integer NOT NULL DEFAULT 80,
  copies integer NOT NULL DEFAULT 1,
  default_for text NOT NULL DEFAULT 'cn',
  margins text,
  details_json text,
  active text NOT NULL DEFAULT 'yes',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS factory_printers_org_branch_idx ON factory_printer_profiles (organization_id, branch_id);

CREATE TABLE IF NOT EXISTS factory_print_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  job_number text NOT NULL,
  party_id uuid REFERENCES factory_parties(id) ON DELETE SET NULL,
  design_id uuid REFERENCES embroidery_designs(id) ON DELETE SET NULL,
  embroidery_job_id uuid REFERENCES embroidery_jobs(id) ON DELETE SET NULL,
  print_type text NOT NULL DEFAULT 'dtf',
  size_label text,
  qty integer NOT NULL DEFAULT 1,
  printer_profile_id uuid REFERENCES factory_printer_profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft',
  notes text,
  details_json text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS factory_print_jobs_org_branch_idx ON factory_print_jobs (organization_id, branch_id);

CREATE TABLE IF NOT EXISTS factory_packing_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES embroidery_jobs(id) ON DELETE CASCADE,
  carton_number text NOT NULL,
  pieces integer NOT NULL DEFAULT 0,
  weight_kg numeric(12,3) NOT NULL DEFAULT 0,
  labels text,
  seal_number text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
