-- Bonus Attach: allow schemes scoped to a trade customer.
-- Run once against the pharmacy DB (or use: pnpm --filter database-pg push).

ALTER TABLE pharmacy_schemes
  ADD COLUMN IF NOT EXISTS trade_customer_id uuid
  REFERENCES pharmacy_trade_customers(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS pharmacy_schemes_trade_customer_idx
  ON pharmacy_schemes (organization_id, trade_customer_id);
