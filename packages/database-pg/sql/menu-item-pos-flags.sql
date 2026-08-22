-- Menu item POS flags (run on Railway / Postgres if columns are missing)
ALTER TABLE pops_menu_items ADD COLUMN IF NOT EXISTS discountable boolean NOT NULL DEFAULT true;
ALTER TABLE pops_menu_items ADD COLUMN IF NOT EXISTS non_discountable boolean NOT NULL DEFAULT false;
ALTER TABLE pops_menu_items ADD COLUMN IF NOT EXISTS non_taxable boolean NOT NULL DEFAULT false;
ALTER TABLE pops_menu_items ADD COLUMN IF NOT EXISTS ask_for_price boolean NOT NULL DEFAULT false;
ALTER TABLE pops_menu_items ADD COLUMN IF NOT EXISTS ask_for_qty boolean NOT NULL DEFAULT false;
ALTER TABLE pops_menu_items ADD COLUMN IF NOT EXISTS allow_manual_discount boolean NOT NULL DEFAULT false;
ALTER TABLE pops_menu_items ADD COLUMN IF NOT EXISTS secondary_name text;
ALTER TABLE pops_menu_items ADD COLUMN IF NOT EXISTS default_discount_pct integer NOT NULL DEFAULT 0;
ALTER TABLE pops_menu_items ADD COLUMN IF NOT EXISTS simple_price boolean NOT NULL DEFAULT false;
