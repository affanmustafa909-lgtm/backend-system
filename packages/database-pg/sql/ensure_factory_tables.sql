-- Factory-native tables (embroidery job-work + own materials). Idempotent.

CREATE TABLE IF NOT EXISTS factory_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES pops_branches(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'customer',
  code text NOT NULL,
  name text NOT NULL,
  phone text,
  address text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS factory_parties_org_idx ON factory_parties (organization_id);

CREATE TABLE IF NOT EXISTS factory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  sku text NOT NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'thread',
  unit text NOT NULL DEFAULT 'pcs',
  reorder_level integer NOT NULL DEFAULT 0,
  unit_cost_pkr integer NOT NULL DEFAULT 0,
  active text NOT NULL DEFAULT 'yes',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS factory_items_org_branch_idx ON factory_items (organization_id, branch_id);

CREATE TABLE IF NOT EXISTS factory_stock_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES factory_items(id) ON DELETE CASCADE,
  qty_on_hand numeric(18,3) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS factory_stock_balances_org_branch_item_uidx
  ON factory_stock_balances (organization_id, branch_id, item_id);

CREATE TABLE IF NOT EXISTS factory_stock_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES factory_items(id) ON DELETE CASCADE,
  txn_type text NOT NULL,
  qty_delta numeric(18,3) NOT NULL,
  ref_type text,
  ref_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS factory_inward_challans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  cn_number text NOT NULL,
  party_id uuid NOT NULL REFERENCES factory_parties(id) ON DELETE RESTRICT,
  challan_date text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS factory_inward_cn_org_idx ON factory_inward_challans (organization_id, branch_id);

CREATE TABLE IF NOT EXISTS factory_inward_challan_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challan_id uuid NOT NULL REFERENCES factory_inward_challans(id) ON DELETE CASCADE,
  description text NOT NULL,
  design_id uuid REFERENCES embroidery_designs(id) ON DELETE SET NULL,
  qty integer NOT NULL DEFAULT 1,
  unit text NOT NULL DEFAULT 'pcs',
  colour text,
  qty_dispatched integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS factory_outward_challans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  cn_number text NOT NULL,
  party_id uuid NOT NULL REFERENCES factory_parties(id) ON DELETE RESTRICT,
  inward_challan_id uuid REFERENCES factory_inward_challans(id) ON DELETE SET NULL,
  job_id uuid REFERENCES embroidery_jobs(id) ON DELETE SET NULL,
  challan_date text NOT NULL,
  status text NOT NULL DEFAULT 'dispatched',
  invoice_amount_pkr integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS factory_outward_challan_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challan_id uuid NOT NULL REFERENCES factory_outward_challans(id) ON DELETE CASCADE,
  inward_line_id uuid REFERENCES factory_inward_challan_lines(id) ON DELETE SET NULL,
  description text NOT NULL,
  qty integer NOT NULL DEFAULT 1,
  unit text NOT NULL DEFAULT 'pcs'
);

CREATE TABLE IF NOT EXISTS factory_operators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  phone text,
  rate_per_1k_stitches_pkr integer NOT NULL DEFAULT 0,
  rate_per_piece_pkr integer NOT NULL DEFAULT 0,
  active text NOT NULL DEFAULT 'yes',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS factory_daily_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  sheet_date text NOT NULL,
  shift text NOT NULL DEFAULT 'day',
  status text NOT NULL DEFAULT 'open',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS factory_daily_sheets_org_date_idx ON factory_daily_sheets (organization_id, sheet_date);

CREATE TABLE IF NOT EXISTS factory_daily_sheet_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id uuid NOT NULL REFERENCES factory_daily_sheets(id) ON DELETE CASCADE,
  machine_id uuid REFERENCES embroidery_machines(id) ON DELETE SET NULL,
  operator_id uuid REFERENCES factory_operators(id) ON DELETE SET NULL,
  job_id uuid REFERENCES embroidery_jobs(id) ON DELETE SET NULL,
  design_id uuid REFERENCES embroidery_designs(id) ON DELETE SET NULL,
  stitches integer NOT NULL DEFAULT 0,
  frames integer NOT NULL DEFAULT 0,
  pieces integer NOT NULL DEFAULT 0,
  downtime_minutes integer NOT NULL DEFAULT 0,
  bonus_pkr integer NOT NULL DEFAULT 0,
  wage_pkr integer NOT NULL DEFAULT 0,
  notes text
);

CREATE TABLE IF NOT EXISTS factory_job_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  bill_number text NOT NULL,
  party_id uuid NOT NULL REFERENCES factory_parties(id) ON DELETE RESTRICT,
  outward_challan_id uuid REFERENCES factory_outward_challans(id) ON DELETE SET NULL,
  bill_date text NOT NULL,
  amount_pkr integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS factory_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  entry_date text NOT NULL,
  account_kind text NOT NULL,
  party_id uuid REFERENCES factory_parties(id) ON DELETE SET NULL,
  debit_pkr integer NOT NULL DEFAULT 0,
  credit_pkr integer NOT NULL DEFAULT 0,
  ref_type text,
  ref_id uuid,
  narration text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS factory_ledger_org_date_idx ON factory_ledger_entries (organization_id, entry_date);

CREATE TABLE IF NOT EXISTS factory_operator_advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
  operator_id uuid NOT NULL REFERENCES factory_operators(id) ON DELETE CASCADE,
  advance_date text NOT NULL,
  amount_pkr integer NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
