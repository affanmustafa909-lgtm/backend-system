import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { pharmacyFieldForceAudits, popsBranches, popsEmployees, type PlatformPgDb } from "@platform/database-pg";
import type { AccessJwtPayload } from "../../auth/jwt.types";

export function achievementPct(actual: number, target: number): number | null {
  if (!(target > 0)) return null;
  return Math.round((actual / target) * 10000) / 100;
}

export function asPage<T>(items: T[], page = 1, pageSize = 25) {
  const p = Math.max(1, page);
  const size = Math.min(100, Math.max(1, pageSize));
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const start = (p - 1) * size;
  return { items: items.slice(start, start + size), page: p, pageSize: size, total, totalPages };
}

export function todayIso(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(dateIso: string) {
  return new Date(`${dateIso}T00:00:00Z`).getUTCDay();
}

export async function resolveBranch(db: PlatformPgDb, organizationId: string, branchCode?: string) {
  if (!branchCode?.trim()) return null;
  const [branch] = await db
    .select()
    .from(popsBranches)
    .where(and(eq(popsBranches.organizationId, organizationId), eq(popsBranches.code, branchCode.trim())))
    .limit(1);
  if (!branch) throw new NotFoundException(`Branch not found: ${branchCode}`);
  return branch;
}

export async function actorEmployee(db: PlatformPgDb, organizationId: string, userId: string) {
  const [row] = await db
    .select()
    .from(popsEmployees)
    .where(and(eq(popsEmployees.organizationId, organizationId), eq(popsEmployees.userId, userId)))
    .limit(1);
  return row ?? null;
}

export function canManageField(user: AccessJwtPayload) {
  const p = user.permissions ?? [];
  return (
    p.includes("*") ||
    p.includes("field.manage") ||
    p.includes("field.pjp") ||
    p.includes("distribution.field") ||
    user.role === "admin" ||
    user.role === "manager"
  );
}

export async function assertVisitOwner(
  db: PlatformPgDb,
  user: AccessJwtPayload,
  employeeId: string,
) {
  if (canManageField(user)) return;
  const self = await actorEmployee(db, user.organizationId, user.sub);
  if (!self || self.id !== employeeId) {
    throw new ForbiddenException("You can only act on your own visits");
  }
}

export async function writeAudit(
  db: PlatformPgDb,
  organizationId: string,
  input: {
    entityType: string;
    entityId: string;
    action: string;
    oldValue?: unknown;
    newValue?: unknown;
    reason?: string | null;
    userId?: string | null;
  },
) {
  await db.insert(pharmacyFieldForceAudits).values({
    organizationId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    oldValue: input.oldValue == null ? null : JSON.stringify(input.oldValue),
    newValue: input.newValue == null ? null : JSON.stringify(input.newValue),
    reason: input.reason ?? null,
    userId: input.userId ?? null,
  });
}
