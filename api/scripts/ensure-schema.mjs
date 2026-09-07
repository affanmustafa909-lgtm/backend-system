/**
 * Idempotent ALTER TABLE for columns drizzle-kit push sometimes skips on
 * existing Railway databases. Run after `drizzle-kit push`.
 *
 * Uses `pg` from packages/database-pg (always present in the Docker image).
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWorkspaceRoot } from "./resolve-workspace.mjs";

const STATEMENTS = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_set_password text`,
  `ALTER TABLE organization_memberships ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true`,
  `ALTER TABLE organization_memberships ADD COLUMN IF NOT EXISTS nav_allowlist jsonb`,
  `ALTER TABLE organization_memberships ADD COLUMN IF NOT EXISTS last_activity_at timestamptz`,
  `ALTER TABLE organization_memberships ADD COLUMN IF NOT EXISTS staff_pin_hash text`,
  `ALTER TABLE pops_cash_movements ADD COLUMN IF NOT EXISTS employee_id uuid`,
  `ALTER TABLE pops_cash_movements ADD COLUMN IF NOT EXISTS party_kind text`,
  `ALTER TABLE pops_cash_movements ADD COLUMN IF NOT EXISTS client_request_id text`,
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS enabled_modules jsonb`,
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS fbr_enabled boolean NOT NULL DEFAULT false`,
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS pra_enabled boolean NOT NULL DEFAULT false`,
  `ALTER TABLE pops_menu_items ADD COLUMN IF NOT EXISTS simple_price boolean NOT NULL DEFAULT false`,
  // General Store core tables (create if drizzle push skipped them on Railway).
  `CREATE TABLE IF NOT EXISTS store_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
    name text NOT NULL,
    parent_id uuid,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS store_brands (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS store_units (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
    name text NOT NULL,
    abbreviation text NOT NULL DEFAULT 'pc',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS store_products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
    sku text NOT NULL,
    name text NOT NULL,
    description text,
    category_id uuid,
    subcategory_id uuid,
    brand_id uuid,
    unit_id uuid,
    variant_of_id uuid,
    barcode text,
    qr_code text,
    image_url text,
    purchase_price_pkr integer NOT NULL DEFAULT 0,
    selling_price_pkr integer NOT NULL DEFAULT 0,
    tax_pct integer NOT NULL DEFAULT 0,
    reorder_level integer NOT NULL DEFAULT 10,
    available_stock integer NOT NULL DEFAULT 0,
    reserved_stock integer NOT NULL DEFAULT 0,
    damaged_stock integer NOT NULL DEFAULT 0,
    expired_stock integer NOT NULL DEFAULT 0,
    in_transit_stock integer NOT NULL DEFAULT 0,
    track_batch text NOT NULL DEFAULT 'no',
    track_serial text NOT NULL DEFAULT 'no',
    is_weighed text NOT NULL DEFAULT 'no',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS store_warehouses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
    code text NOT NULL,
    name text NOT NULL,
    address text,
    is_default text NOT NULL DEFAULT 'no',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS store_zones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id uuid NOT NULL REFERENCES store_warehouses(id) ON DELETE CASCADE,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS store_suppliers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
    name text NOT NULL,
    contact_person text,
    phone text,
    email text,
    address text,
    payment_terms text,
    quality_score integer NOT NULL DEFAULT 80,
    avg_delivery_days integer NOT NULL DEFAULT 7,
    opening_balance_pkr integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS store_customers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
    name text NOT NULL,
    phone text,
    email text,
    address text,
    credit_limit_pkr integer NOT NULL DEFAULT 0,
    outstanding_pkr integer NOT NULL DEFAULT 0,
    loyalty_points integer NOT NULL DEFAULT 0,
    membership_tier text NOT NULL DEFAULT 'standard',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS store_product_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
    batch_number text NOT NULL,
    lot_number text,
    manufacturing_date date,
    expiry_date date,
    quantity integer NOT NULL DEFAULT 0,
    warehouse_id uuid,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  // General Store: missing columns make /v1/store/dashboard (and seed) return 500.
  `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS description text`,
  `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS subcategory_id uuid`,
  `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS variant_of_id uuid`,
  `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS barcode text`,
  `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS qr_code text`,
  `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS image_url text`,
  `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS purchase_price_pkr integer NOT NULL DEFAULT 0`,
  `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS selling_price_pkr integer NOT NULL DEFAULT 0`,
  `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS order_cost_pkr integer NOT NULL DEFAULT 0`,
  `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS sale_price_pkr integer NOT NULL DEFAULT 0`,
  `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS mrp_price_pkr integer NOT NULL DEFAULT 0`,
  `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS wholesale_price_pkr integer NOT NULL DEFAULT 0`,
  `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS custom_price_pkr integer NOT NULL DEFAULT 0`,
  `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS market_sale_price_pkr integer NOT NULL DEFAULT 0`,
  `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS margin_pct integer NOT NULL DEFAULT 0`,
  `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS markup_pct integer NOT NULL DEFAULT 0`,
  `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS supplier_id uuid`,
  `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS tax_pct integer NOT NULL DEFAULT 0`,
  `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS reorder_level integer NOT NULL DEFAULT 10`,
  `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS available_stock integer NOT NULL DEFAULT 0`,
  `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS reserved_stock integer NOT NULL DEFAULT 0`,
  `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS damaged_stock integer NOT NULL DEFAULT 0`,
  `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS expired_stock integer NOT NULL DEFAULT 0`,
  `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS in_transit_stock integer NOT NULL DEFAULT 0`,
  `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS track_batch text NOT NULL DEFAULT 'no'`,
  `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS track_serial text NOT NULL DEFAULT 'no'`,
  `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS is_weighed text NOT NULL DEFAULT 'no'`,
  `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS color text`,
  `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS size text`,
  `ALTER TABLE store_suppliers ADD COLUMN IF NOT EXISTS opening_balance_pkr integer NOT NULL DEFAULT 0`,
  `ALTER TABLE store_customers ADD COLUMN IF NOT EXISTS membership_tier text NOT NULL DEFAULT 'standard'`,
  `ALTER TABLE store_product_batches ADD COLUMN IF NOT EXISTS lot_number text`,
  `ALTER TABLE store_product_batches ADD COLUMN IF NOT EXISTS manufacturing_date date`,
  `ALTER TABLE store_product_batches ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'`,
  `CREATE TABLE IF NOT EXISTS store_product_barcodes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
    code text NOT NULL,
    is_primary text NOT NULL DEFAULT 'no',
    sort_order integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS store_product_serials (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
    serial_number text NOT NULL,
    batch_id uuid,
    status text NOT NULL DEFAULT 'available',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS licence_payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    period_days integer NOT NULL,
    amount integer NOT NULL DEFAULT 0,
    currency text NOT NULL DEFAULT 'PKR',
    paid_by_label text,
    note text,
    paid_at timestamptz NOT NULL DEFAULT now(),
    recorded_by uuid,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS licence_reminders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    period_key text NOT NULL,
    kind text NOT NULL,
    channel text NOT NULL DEFAULT 'email',
    to_email text,
    success text NOT NULL DEFAULT 'true',
    detail text,
    sent_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS licence_reminders_org_period_kind_uidx
    ON licence_reminders (organization_id, period_key, kind)`,
  `CREATE TABLE IF NOT EXISTS org_alerts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    kind text NOT NULL,
    period_key text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    dismissed_at timestamptz
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS org_alerts_org_period_kind_uidx
    ON org_alerts (organization_id, period_key, kind)`,
  `CREATE TABLE IF NOT EXISTS platform_settings (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    updated_by uuid,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS tax_authority_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
    company_name text NOT NULL DEFAULT '',
    ntn text NOT NULL DEFAULT '',
    strn text NOT NULL DEFAULT '',
    business_type text NOT NULL DEFAULT '',
    province text NOT NULL DEFAULT '',
    branch_name text NOT NULL DEFAULT '',
    branch_code text NOT NULL DEFAULT '',
    fbr_client_id text,
    fbr_client_secret text,
    fbr_pos_id text,
    fbr_terminal_id text,
    fbr_environment text NOT NULL DEFAULT 'sandbox',
    fbr_status text NOT NULL DEFAULT 'disconnected',
    fbr_access_token text,
    fbr_token_expires_at timestamptz,
    fbr_connected_at timestamptz,
    fbr_last_error text,
    pra_registration_number text,
    pra_username text,
    pra_password text,
    pra_branch_code text,
    pra_environment text NOT NULL DEFAULT 'sandbox',
    pra_status text NOT NULL DEFAULT 'disconnected',
    pra_access_token text,
    pra_token_expires_at timestamptz,
    pra_connected_at timestamptz,
    pra_last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS tax_authority_profiles_org_branch_uidx
    ON tax_authority_profiles (organization_id, branch_id)`,
  `CREATE TABLE IF NOT EXISTS tax_authority_invoices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
    authority text NOT NULL,
    source_type text NOT NULL,
    source_id uuid NOT NULL,
    source_ref text NOT NULL,
    status text NOT NULL DEFAULT 'queued',
    taxable_amount_pkr integer NOT NULL DEFAULT 0,
    tax_amount_pkr integer NOT NULL DEFAULT 0,
    request_json text,
    response_json text,
    authority_invoice_number text,
    qr_payload text,
    attempt_count integer NOT NULL DEFAULT 0,
    last_attempt_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS tax_authority_invoices_source_uidx
    ON tax_authority_invoices (organization_id, authority, invoice_mode, source_type, source_id)`,
  `CREATE TABLE IF NOT EXISTS tax_authority_activity_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id uuid REFERENCES pops_branches(id) ON DELETE SET NULL,
    authority text NOT NULL DEFAULT 'pra',
    event text NOT NULL,
    invoice_number text,
    pra_invoice_number text,
    status text NOT NULL DEFAULT '',
    error_message text,
    retry_count integer NOT NULL DEFAULT 0,
    meta_json text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  // Enterprise printing control plane
  `CREATE TABLE IF NOT EXISTS print_branch_servers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id uuid REFERENCES pops_branches(id) ON DELETE SET NULL,
    server_key text NOT NULL,
    branch_code text NOT NULL,
    branch_name text NOT NULL,
    server_name text NOT NULL,
    hostname text,
    local_ip text NOT NULL,
    port integer NOT NULL DEFAULT 9740,
    status text NOT NULL DEFAULT 'offline',
    printer_count integer NOT NULL DEFAULT 0,
    queue_pending integer NOT NULL DEFAULT 0,
    queue_failed integer NOT NULL DEFAULT 0,
    version text,
    cloud_sync_enabled boolean NOT NULL DEFAULT true,
    last_heartbeat_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS print_branch_servers_org_key_uidx
    ON print_branch_servers (organization_id, server_key)`,
  `CREATE TABLE IF NOT EXISTS print_printer_nodes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_code text NOT NULL,
    name text NOT NULL,
    printer_type text NOT NULL DEFAULT 'receipt',
    windows_printer_name text,
    ip_address text,
    mac_address text,
    hostname text,
    port integer,
    connection_type text NOT NULL DEFAULT 'other',
    paper_size text NOT NULL DEFAULT '80mm',
    online boolean NOT NULL DEFAULT true,
    reachable boolean,
    ping_ms integer,
    backup_printer_id uuid,
    legacy_profile_id text,
    last_heartbeat_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS print_jobs_cloud (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_code text NOT NULL,
    branch_server_id uuid REFERENCES print_branch_servers(id) ON DELETE SET NULL,
    local_job_id text,
    user_id text,
    device_id text,
    device_label text,
    printer_id uuid REFERENCES print_printer_nodes(id) ON DELETE SET NULL,
    printer_name text,
    order_id text,
    priority integer NOT NULL DEFAULT 100,
    status text NOT NULL DEFAULT 'pending',
    retry_count integer NOT NULL DEFAULT 0,
    max_retries integer NOT NULL DEFAULT 3,
    error text,
    payload_json jsonb NOT NULL,
    cloud_queued boolean NOT NULL DEFAULT false,
    printed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS print_jobs_cloud_org_branch_idx
    ON print_jobs_cloud (organization_id, branch_code, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS print_alerts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_code text NOT NULL,
    alert_type text NOT NULL,
    message text NOT NULL,
    printer_id uuid,
    job_id uuid,
    dismissed boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS entity_deletion_backups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    original_email text,
    label text,
    payload jsonb NOT NULL,
    deleted_by uuid,
    deleted_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS entity_deletion_backups_entity_idx
    ON entity_deletion_backups (entity_type, entity_id)`,
  `ALTER TABLE pops_staff_food ADD COLUMN IF NOT EXISTS supplier_id uuid`,
  `ALTER TABLE pops_staff_food ADD COLUMN IF NOT EXISTS expense_category text NOT NULL DEFAULT 'Staff Meals'`,
  `ALTER TABLE pops_staff_food ADD COLUMN IF NOT EXISTS expense_id uuid`,
  // Pharmacy ERP columns + tables (deployed code selects these; drizzle push often skipped on Railway).
  `ALTER TABLE pharmacy_medicines ADD COLUMN IF NOT EXISTS company_id uuid`,
  `ALTER TABLE pharmacy_medicines ADD COLUMN IF NOT EXISTS alternate_barcode text`,
  `ALTER TABLE pharmacy_medicines ADD COLUMN IF NOT EXISTS cost_price_pkr integer NOT NULL DEFAULT 0`,
  `ALTER TABLE pharmacy_medicines ADD COLUMN IF NOT EXISTS wholesale_price_pkr integer NOT NULL DEFAULT 0`,
  `ALTER TABLE pharmacy_medicines ADD COLUMN IF NOT EXISTS dealer_price_pkr integer NOT NULL DEFAULT 0`,
  `ALTER TABLE pharmacy_medicines ADD COLUMN IF NOT EXISTS min_sale_price_pkr integer NOT NULL DEFAULT 0`,
  `ALTER TABLE pharmacy_medicines ADD COLUMN IF NOT EXISTS max_retail_price_pkr integer NOT NULL DEFAULT 0`,
  `ALTER TABLE pharmacy_medicines ADD COLUMN IF NOT EXISTS preferred_warehouse_id uuid`,
  `ALTER TABLE pharmacy_medicines ADD COLUMN IF NOT EXISTS prescription_required boolean NOT NULL DEFAULT false`,
  `ALTER TABLE pharmacy_medicines ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'`,
  `ALTER TABLE pharmacy_medicine_batches ADD COLUMN IF NOT EXISTS warehouse_id uuid`,
  `ALTER TABLE pharmacy_medicine_batches ADD COLUMN IF NOT EXISTS reserved_quantity integer NOT NULL DEFAULT 0`,
  `ALTER TABLE pharmacy_medicine_batches ADD COLUMN IF NOT EXISTS damaged_quantity integer NOT NULL DEFAULT 0`,
  `ALTER TABLE pharmacy_medicine_batches ADD COLUMN IF NOT EXISTS free_quantity integer NOT NULL DEFAULT 0`,
  `ALTER TABLE pharmacy_medicine_batches ADD COLUMN IF NOT EXISTS purchase_rate_pkr integer NOT NULL DEFAULT 0`,
  `ALTER TABLE pharmacy_medicine_batches ADD COLUMN IF NOT EXISTS sale_rate_pkr integer NOT NULL DEFAULT 0`,
  `ALTER TABLE pharmacy_medicine_batches ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'`,
  `ALTER TABLE pharmacy_sale_lines ADD COLUMN IF NOT EXISTS sale_unit text`,
  `ALTER TABLE pharmacy_sale_lines ADD COLUMN IF NOT EXISTS tablets_qty integer NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS pharmacy_companies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code text NOT NULL,
    name text NOT NULL,
    manufacturer_name text,
    contact_person text,
    phone text,
    email text,
    address text,
    city text,
    country text DEFAULT 'Pakistan',
    license_info text,
    status text NOT NULL DEFAULT 'active',
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_warehouses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
    code text NOT NULL,
    name text NOT NULL,
    address text,
    city text,
    area text,
    manager_name text,
    is_default boolean NOT NULL DEFAULT false,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_territories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code text NOT NULL,
    name text NOT NULL,
    region text,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_cities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    territory_id uuid REFERENCES pharmacy_territories(id) ON DELETE SET NULL,
    code text NOT NULL,
    name text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_areas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    city_id uuid NOT NULL REFERENCES pharmacy_cities(id) ON DELETE CASCADE,
    code text NOT NULL,
    name text NOT NULL,
    sector text,
    market text,
    is_outstation boolean NOT NULL DEFAULT false,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_routes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    area_id uuid NOT NULL REFERENCES pharmacy_areas(id) ON DELETE CASCADE,
    code text NOT NULL,
    name text NOT NULL,
    station text,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_trade_customers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id uuid REFERENCES pops_branches(id) ON DELETE SET NULL,
    code text NOT NULL,
    name text NOT NULL,
    business_name text,
    customer_type text NOT NULL DEFAULT 'Retailer',
    phone text,
    whatsapp text,
    email text,
    address text,
    city_id uuid REFERENCES pharmacy_cities(id) ON DELETE SET NULL,
    area_id uuid REFERENCES pharmacy_areas(id) ON DELETE SET NULL,
    territory_id uuid REFERENCES pharmacy_territories(id) ON DELETE SET NULL,
    route_id uuid REFERENCES pharmacy_routes(id) ON DELETE SET NULL,
    salesman_employee_id uuid REFERENCES pops_employees(id) ON DELETE SET NULL,
    credit_limit_pkr integer NOT NULL DEFAULT 0,
    credit_days integer NOT NULL DEFAULT 30,
    outstanding_pkr integer NOT NULL DEFAULT 0,
    opening_balance_pkr integer NOT NULL DEFAULT 0,
    price_level text NOT NULL DEFAULT 'retail',
    discount_pct integer NOT NULL DEFAULT 0,
    tax_info text,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_sales_force_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    employee_id uuid NOT NULL REFERENCES pops_employees(id) ON DELETE CASCADE,
    field_role text NOT NULL DEFAULT 'Salesman',
    territory_id uuid REFERENCES pharmacy_territories(id) ON DELETE SET NULL,
    city_id uuid REFERENCES pharmacy_cities(id) ON DELETE SET NULL,
    area_id uuid REFERENCES pharmacy_areas(id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_stock_movements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
    warehouse_id uuid REFERENCES pharmacy_warehouses(id) ON DELETE SET NULL,
    medicine_id uuid NOT NULL REFERENCES pharmacy_medicines(id) ON DELETE RESTRICT,
    batch_id uuid REFERENCES pharmacy_medicine_batches(id) ON DELETE SET NULL,
    movement_type text NOT NULL,
    quantity_delta integer NOT NULL,
    quantity_after integer NOT NULL DEFAULT 0,
    reference_type text,
    reference_id text,
    notes text,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_stock_transfers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
    transfer_number text NOT NULL,
    from_warehouse_id uuid NOT NULL REFERENCES pharmacy_warehouses(id) ON DELETE RESTRICT,
    to_warehouse_id uuid NOT NULL REFERENCES pharmacy_warehouses(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'draft',
    notes text,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_stock_transfer_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id uuid NOT NULL REFERENCES pharmacy_stock_transfers(id) ON DELETE CASCADE,
    medicine_id uuid NOT NULL REFERENCES pharmacy_medicines(id) ON DELETE RESTRICT,
    batch_id uuid REFERENCES pharmacy_medicine_batches(id) ON DELETE SET NULL,
    quantity integer NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_purchase_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
    supplier_id uuid REFERENCES pops_suppliers(id) ON DELETE SET NULL,
    po_number text NOT NULL,
    status text NOT NULL DEFAULT 'draft',
    order_date date NOT NULL,
    expected_date date,
    notes text,
    subtotal_pkr integer NOT NULL DEFAULT 0,
    tax_pkr integer NOT NULL DEFAULT 0,
    discount_pkr integer NOT NULL DEFAULT 0,
    total_pkr integer NOT NULL DEFAULT 0,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    approved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_purchase_order_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id uuid NOT NULL REFERENCES pharmacy_purchase_orders(id) ON DELETE CASCADE,
    medicine_id uuid NOT NULL REFERENCES pharmacy_medicines(id) ON DELETE RESTRICT,
    quantity integer NOT NULL,
    free_quantity integer NOT NULL DEFAULT 0,
    received_qty integer NOT NULL DEFAULT 0,
    unit_cost_pkr integer NOT NULL DEFAULT 0,
    line_total_pkr integer NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_grns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
    warehouse_id uuid NOT NULL REFERENCES pharmacy_warehouses(id) ON DELETE RESTRICT,
    purchase_order_id uuid REFERENCES pharmacy_purchase_orders(id) ON DELETE SET NULL,
    supplier_id uuid REFERENCES pops_suppliers(id) ON DELETE SET NULL,
    grn_number text NOT NULL,
    supplier_invoice_number text,
    received_date date NOT NULL,
    status text NOT NULL DEFAULT 'posted',
    total_pkr integer NOT NULL DEFAULT 0,
    notes text,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_grn_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_id uuid NOT NULL REFERENCES pharmacy_grns(id) ON DELETE CASCADE,
    medicine_id uuid NOT NULL REFERENCES pharmacy_medicines(id) ON DELETE RESTRICT,
    batch_id uuid REFERENCES pharmacy_medicine_batches(id) ON DELETE SET NULL,
    batch_number text NOT NULL,
    manufacturing_date date,
    expiry_date date NOT NULL,
    quantity integer NOT NULL,
    free_quantity integer NOT NULL DEFAULT 0,
    unit_cost_pkr integer NOT NULL DEFAULT 0,
    line_total_pkr integer NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_sale_returns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
    warehouse_id uuid REFERENCES pharmacy_warehouses(id) ON DELETE SET NULL,
    original_sale_id uuid NOT NULL REFERENCES pharmacy_sales(id) ON DELETE RESTRICT,
    return_number text NOT NULL,
    reason text,
    refund_method text NOT NULL DEFAULT 'Cash',
    subtotal_pkr integer NOT NULL DEFAULT 0,
    tax_pkr integer NOT NULL DEFAULT 0,
    total_pkr integer NOT NULL DEFAULT 0,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_sale_return_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_return_id uuid NOT NULL REFERENCES pharmacy_sale_returns(id) ON DELETE CASCADE,
    medicine_id uuid NOT NULL REFERENCES pharmacy_medicines(id) ON DELETE RESTRICT,
    batch_id uuid REFERENCES pharmacy_medicine_batches(id) ON DELETE SET NULL,
    qty integer NOT NULL,
    tablets_qty integer NOT NULL DEFAULT 0,
    unit_price_pkr integer NOT NULL DEFAULT 0,
    line_total_pkr integer NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_purchase_returns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
    warehouse_id uuid REFERENCES pharmacy_warehouses(id) ON DELETE SET NULL,
    supplier_id uuid REFERENCES pops_suppliers(id) ON DELETE SET NULL,
    grn_id uuid REFERENCES pharmacy_grns(id) ON DELETE SET NULL,
    return_number text NOT NULL,
    reason text,
    total_pkr integer NOT NULL DEFAULT 0,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_purchase_return_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_return_id uuid NOT NULL REFERENCES pharmacy_purchase_returns(id) ON DELETE CASCADE,
    medicine_id uuid NOT NULL REFERENCES pharmacy_medicines(id) ON DELETE RESTRICT,
    batch_id uuid REFERENCES pharmacy_medicine_batches(id) ON DELETE SET NULL,
    quantity integer NOT NULL,
    unit_cost_pkr integer NOT NULL DEFAULT 0,
    line_total_pkr integer NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_dist_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
    warehouse_id uuid REFERENCES pharmacy_warehouses(id) ON DELETE SET NULL,
    order_number text NOT NULL,
    trade_customer_id uuid NOT NULL REFERENCES pharmacy_trade_customers(id) ON DELETE RESTRICT,
    salesman_employee_id uuid REFERENCES pops_employees(id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'draft',
    payment_status text NOT NULL DEFAULT 'unpaid',
    delivery_status text NOT NULL DEFAULT 'pending',
    subtotal_pkr integer NOT NULL DEFAULT 0,
    discount_pkr integer NOT NULL DEFAULT 0,
    tax_pkr integer NOT NULL DEFAULT 0,
    total_pkr integer NOT NULL DEFAULT 0,
    credit_override boolean NOT NULL DEFAULT false,
    notes text,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    approved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_dist_order_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES pharmacy_dist_orders(id) ON DELETE CASCADE,
    medicine_id uuid NOT NULL REFERENCES pharmacy_medicines(id) ON DELETE RESTRICT,
    batch_id uuid REFERENCES pharmacy_medicine_batches(id) ON DELETE SET NULL,
    quantity integer NOT NULL,
    free_quantity integer NOT NULL DEFAULT 0,
    unit_price_pkr integer NOT NULL DEFAULT 0,
    discount_pkr integer NOT NULL DEFAULT 0,
    line_total_pkr integer NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_dist_invoices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
    order_id uuid REFERENCES pharmacy_dist_orders(id) ON DELETE SET NULL,
    trade_customer_id uuid NOT NULL REFERENCES pharmacy_trade_customers(id) ON DELETE RESTRICT,
    invoice_number text NOT NULL,
    invoice_date date NOT NULL,
    payment_method text NOT NULL DEFAULT 'Credit',
    amount_paid_pkr integer NOT NULL DEFAULT 0,
    amount_due_pkr integer NOT NULL DEFAULT 0,
    subtotal_pkr integer NOT NULL DEFAULT 0,
    discount_pkr integer NOT NULL DEFAULT 0,
    tax_pkr integer NOT NULL DEFAULT 0,
    total_pkr integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'posted',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_dist_invoice_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id uuid NOT NULL REFERENCES pharmacy_dist_invoices(id) ON DELETE CASCADE,
    medicine_id uuid NOT NULL REFERENCES pharmacy_medicines(id) ON DELETE RESTRICT,
    batch_id uuid REFERENCES pharmacy_medicine_batches(id) ON DELETE SET NULL,
    quantity integer NOT NULL,
    free_quantity integer NOT NULL DEFAULT 0,
    unit_price_pkr integer NOT NULL DEFAULT 0,
    line_total_pkr integer NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
    delivery_number text NOT NULL,
    order_id uuid REFERENCES pharmacy_dist_orders(id) ON DELETE SET NULL,
    invoice_id uuid REFERENCES pharmacy_dist_invoices(id) ON DELETE SET NULL,
    trade_customer_id uuid REFERENCES pharmacy_trade_customers(id) ON DELETE SET NULL,
    rider_name text,
    route_id uuid REFERENCES pharmacy_routes(id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'pending',
    failed_reason text,
    pod_notes text,
    collected_pkr integer NOT NULL DEFAULT 0,
    delivered_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_collections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL REFERENCES pops_branches(id) ON DELETE CASCADE,
    collection_number text NOT NULL,
    trade_customer_id uuid NOT NULL REFERENCES pharmacy_trade_customers(id) ON DELETE RESTRICT,
    invoice_id uuid REFERENCES pharmacy_dist_invoices(id) ON DELETE SET NULL,
    patient_id uuid REFERENCES pharmacy_patients(id) ON DELETE SET NULL,
    amount_pkr integer NOT NULL,
    payment_method text NOT NULL DEFAULT 'Cash',
    salesman_employee_id uuid REFERENCES pops_employees(id) ON DELETE SET NULL,
    notes text,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id uuid REFERENCES pops_branches(id) ON DELETE SET NULL,
    assignment_date date NOT NULL,
    employee_id uuid NOT NULL REFERENCES pops_employees(id) ON DELETE CASCADE,
    city_id uuid REFERENCES pharmacy_cities(id) ON DELETE SET NULL,
    area_id uuid REFERENCES pharmacy_areas(id) ON DELETE SET NULL,
    route_id uuid REFERENCES pharmacy_routes(id) ON DELETE SET NULL,
    trade_customer_id uuid REFERENCES pharmacy_trade_customers(id) ON DELETE SET NULL,
    doctor_id uuid,
    task_type text NOT NULL DEFAULT 'visit',
    target_sales_pkr integer NOT NULL DEFAULT 0,
    target_collection_pkr integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'assigned',
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_visits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    assignment_id uuid REFERENCES pharmacy_assignments(id) ON DELETE SET NULL,
    employee_id uuid NOT NULL REFERENCES pops_employees(id) ON DELETE CASCADE,
    trade_customer_id uuid REFERENCES pharmacy_trade_customers(id) ON DELETE SET NULL,
    doctor_id uuid,
    visited_at timestamptz NOT NULL DEFAULT now(),
    purpose text,
    status text NOT NULL DEFAULT 'completed',
    productive boolean NOT NULL DEFAULT false,
    order_id uuid REFERENCES pharmacy_dist_orders(id) ON DELETE SET NULL,
    collection_id uuid REFERENCES pharmacy_collections(id) ON DELETE SET NULL,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_targets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    period_type text NOT NULL DEFAULT 'monthly',
    period_start date NOT NULL,
    period_end date NOT NULL,
    employee_id uuid REFERENCES pops_employees(id) ON DELETE SET NULL,
    city_id uuid REFERENCES pharmacy_cities(id) ON DELETE SET NULL,
    company_id uuid REFERENCES pharmacy_companies(id) ON DELETE SET NULL,
    medicine_id uuid REFERENCES pharmacy_medicines(id) ON DELETE SET NULL,
    target_sales_pkr integer NOT NULL DEFAULT 0,
    target_collection_pkr integer NOT NULL DEFAULT 0,
    actual_sales_pkr integer NOT NULL DEFAULT 0,
    actual_collection_pkr integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_price_lists (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name text NOT NULL,
    price_level text NOT NULL DEFAULT 'wholesale',
    customer_type text,
    area_id uuid REFERENCES pharmacy_areas(id) ON DELETE SET NULL,
    trade_customer_id uuid REFERENCES pharmacy_trade_customers(id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_price_list_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    price_list_id uuid NOT NULL REFERENCES pharmacy_price_lists(id) ON DELETE CASCADE,
    medicine_id uuid NOT NULL REFERENCES pharmacy_medicines(id) ON DELETE CASCADE,
    unit_price_pkr integer NOT NULL,
    min_qty integer NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_schemes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name text NOT NULL,
    scheme_type text NOT NULL DEFAULT 'buy_x_get_y',
    medicine_id uuid REFERENCES pharmacy_medicines(id) ON DELETE SET NULL,
    company_id uuid REFERENCES pharmacy_companies(id) ON DELETE SET NULL,
    buy_qty integer NOT NULL DEFAULT 0,
    free_qty integer NOT NULL DEFAULT 0,
    start_date date,
    end_date date,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pharmacy_audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id uuid REFERENCES pops_branches(id) ON DELETE SET NULL,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    old_value_json text,
    new_value_json text,
    reason text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
];
export function ensureCriticalSchema() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error("[ensure-schema] DATABASE_URL missing");
    return false;
  }

  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const apiRoot = join(scriptDir, "..");
  const appRoot = resolveWorkspaceRoot(apiRoot);
  const dbPkgRoot = join(appRoot, "packages", "database-pg");

  const runner = `
const { Client } = require("pg");
const statements = ${JSON.stringify(STATEMENTS)};
function stripSsl(raw) {
  try {
    const url = new URL(raw);
    url.searchParams.delete("sslmode");
    url.searchParams.delete("ssl");
    url.searchParams.delete("uselibpqcompat");
    return url.toString();
  } catch {
    return raw;
  }
}
(async () => {
  const raw = process.env.DATABASE_URL || "";
  const local = /localhost|127\\.0\\.0\\.1/.test(raw);
  const client = new Client({
    connectionString: stripSsl(raw),
    connectionTimeoutMillis: 10_000,
    ssl: local ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  for (const sql of statements) {
    try {
      await client.query(sql);
      console.log("[ensure-schema] OK:", sql.slice(0, 80));
    } catch (err) {
      console.warn("[ensure-schema] skip:", err && err.message ? err.message : err);
    }
  }
  await client.end();
})().catch((err) => {
  console.error("[ensure-schema] failed:", err && err.message ? err.message : err);
  process.exit(1);
});
`;

  const result = spawnSync(process.execPath, ["-e", runner], {
    cwd: dbPkgRoot,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });

  if (result.status !== 0) {
    console.error("[ensure-schema] aborted with status", result.status);
    return false;
  }
  console.log("[ensure-schema] critical columns verified.");
  return true;
}
