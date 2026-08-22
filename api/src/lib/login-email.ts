import { and, eq, ne, sql } from "drizzle-orm";
import { users, type PlatformPgDb } from "@platform/database-pg";

/** Tombstone domain — frees the original address for a new live login account. */
export const DELETED_EMAIL_DOMAIN = "deleted.local";

export function normalizeLoginEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isTombstoneEmail(email: string): boolean {
  return normalizeLoginEmail(email).endsWith(`@${DELETED_EMAIL_DOMAIN}`);
}

export function tombstoneLoginEmail(userId: string): string {
  return `deleted+${userId.replace(/-/g, "")}@${DELETED_EMAIL_DOMAIN}`;
}

export function isDeletedLoginUser(user: { status: string; email: string }): boolean {
  return user.status === "deleted" || isTombstoneEmail(user.email);
}

/**
 * Login accounts only (`users` table). Customer / patient emails live in other
 * tables and must never be treated as the same namespace.
 */
export async function findLiveLoginUserByEmail(
  db: PlatformPgDb,
  email: string,
): Promise<{ id: string; email: string; status: string; platformRole: string | null } | null> {
  const normalized = normalizeLoginEmail(email);
  if (!normalized || isTombstoneEmail(normalized)) return null;

  const row =
    (
      await db
        .select({
          id: users.id,
          email: users.email,
          status: users.status,
          platformRole: users.platformRole,
        })
        .from(users)
        .where(eq(users.email, normalized))
        .limit(1)
    )[0] ??
    (
      await db
        .select({
          id: users.id,
          email: users.email,
          status: users.status,
          platformRole: users.platformRole,
        })
        .from(users)
        .where(sql`lower(${users.email}) = ${normalized}`)
        .limit(1)
    )[0];

  if (!row || isDeletedLoginUser(row)) return null;
  return row;
}

export async function findLiveLoginUserByEmailExcluding(
  db: PlatformPgDb,
  email: string,
  excludeUserId: string,
): Promise<{ id: string; email: string } | null> {
  const normalized = normalizeLoginEmail(email);
  if (!normalized || isTombstoneEmail(normalized)) return null;

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      status: users.status,
    })
    .from(users)
    .where(and(sql`lower(${users.email}) = ${normalized}`, ne(users.id, excludeUserId)))
    .limit(5);

  const live = rows.find((r) => !isDeletedLoginUser(r));
  return live ? { id: live.id, email: live.email } : null;
}
