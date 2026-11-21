-- Safe additive columns for DST/EMB design file storage.
-- Prefer: pnpm --filter database-pg push
ALTER TABLE embroidery_designs ADD COLUMN IF NOT EXISTS file_content_base64 text;
ALTER TABLE embroidery_designs ADD COLUMN IF NOT EXISTS file_mime_type text;
