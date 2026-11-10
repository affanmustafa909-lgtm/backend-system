import { sql } from "drizzle-orm";
import { type PlatformPgDb } from "@platform/database-pg";

/**
 * Org key/value settings stored in Postgres jsonb.
 * Used by Mobizone desktop→mobile shop control sync.
 */
export async function ensureOrgAppSettingsTable(db: PlatformPgDb): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS org_app_settings (
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      key text NOT NULL,
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (organization_id, key)
    )
  `);
}

export async function readOrgAppSetting(
  db: PlatformPgDb,
  organizationId: string,
  key: string,
): Promise<unknown | null> {
  await ensureOrgAppSettingsTable(db);
  const rows = await db.execute(sql`
    SELECT value FROM org_app_settings
    WHERE organization_id = ${organizationId}::uuid AND key = ${key}
    LIMIT 1
  `);
  const row =
    (rows as unknown as { rows?: Array<{ value: unknown }> }).rows?.[0] ??
    (Array.isArray(rows) ? (rows as Array<{ value: unknown }>)[0] : undefined);
  return row?.value ?? null;
}

export async function writeOrgAppSetting(
  db: PlatformPgDb,
  organizationId: string,
  key: string,
  value: unknown,
): Promise<void> {
  await ensureOrgAppSettingsTable(db);
  const json = JSON.stringify(value);
  await db.execute(sql`
    INSERT INTO org_app_settings (organization_id, key, value, updated_at)
    VALUES (${organizationId}::uuid, ${key}, ${json}::jsonb, now())
    ON CONFLICT (organization_id, key)
    DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `);
}

export async function deleteOrgAppSetting(
  db: PlatformPgDb,
  organizationId: string,
  key: string,
): Promise<void> {
  await ensureOrgAppSettingsTable(db);
  await db.execute(sql`
    DELETE FROM org_app_settings
    WHERE organization_id = ${organizationId}::uuid AND key = ${key}
  `);
}
