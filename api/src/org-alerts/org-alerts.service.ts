import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { OrgAlert } from "@platform/contracts";
import { canManageOrgUsers } from "@platform/contracts";
import { orgAlerts, organizations, type PlatformPgDb } from "@platform/database-pg";
import { DRIZZLE } from "../drizzle/drizzle.tokens";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { isSuperAdmin } from "../auth/jwt.types";

/** Hide month-end pay banners when licence still has more than this many days. */
const MONTH_END_ALERT_MAX_DAYS = 30;

@Injectable()
export class OrgAlertsService {
  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  assertOrgAdmin(user: AccessJwtPayload): void {
    if (isSuperAdmin(user)) {
      throw new ForbiddenException("Super Admin has no org alerts inbox");
    }
    const role = (user.role ?? "").toLowerCase();
    const isAdminRole = role === "admin" || role === "owner";
    if (!isAdminRole && !canManageOrgUsers(user.permissions ?? [])) {
      throw new ForbiddenException("Only business admins can view payment alerts");
    }
  }

  private licenceDaysLeft(expiresAt: Date | null | undefined): number | null {
    if (!expiresAt) return null;
    const ms = expiresAt.getTime() - Date.now();
    return Math.ceil(ms / (24 * 60 * 60 * 1000));
  }

  async listActive(user: AccessJwtPayload): Promise<OrgAlert[]> {
    this.assertOrgAdmin(user);
    const [org] = await this.db
      .select({ licenceExpiresAt: organizations.licenceExpiresAt })
      .from(organizations)
      .where(eq(organizations.id, user.organizationId))
      .limit(1);
    const daysLeft = this.licenceDaysLeft(org?.licenceExpiresAt ?? null);
    const hideMonthEnd =
      daysLeft === null || daysLeft > MONTH_END_ALERT_MAX_DAYS;

    const rows = await this.db
      .select()
      .from(orgAlerts)
      .where(
        and(
          eq(orgAlerts.organizationId, user.organizationId),
          isNull(orgAlerts.resolvedAt),
          isNull(orgAlerts.dismissedAt),
        ),
      )
      .orderBy(desc(orgAlerts.createdAt))
      .limit(20);

    if (hideMonthEnd) {
      const staleIds = rows
        .filter((r) => r.kind === "licence_month_end")
        .map((r) => r.id);
      if (staleIds.length > 0) {
        await this.db
          .update(orgAlerts)
          .set({ resolvedAt: new Date() })
          .where(inArray(orgAlerts.id, staleIds));
      }
      return rows
        .filter((r) => r.kind !== "licence_month_end")
        .map((r) => this.toAlert(r));
    }

    return rows.map((r) => this.toAlert(r));
  }

  async dismiss(user: AccessJwtPayload, alertId: string): Promise<{ ok: true }> {
    this.assertOrgAdmin(user);
    const [updated] = await this.db
      .update(orgAlerts)
      .set({ dismissedAt: new Date() })
      .where(
        and(eq(orgAlerts.id, alertId), eq(orgAlerts.organizationId, user.organizationId)),
      )
      .returning({ id: orgAlerts.id });
    if (!updated) throw new NotFoundException("Alert not found");
    return { ok: true };
  }

  /** Upsert an in-app alert for a business admin (used by Super Admin reminders). */
  async upsertLicenceAlert(opts: {
    organizationId: string;
    kind: "licence_month_end" | "licence_due";
    periodKey: string;
    title: string;
    message: string;
    force?: boolean;
  }): Promise<"created" | "refreshed" | "exists"> {
    const existing = await this.db
      .select()
      .from(orgAlerts)
      .where(
        and(
          eq(orgAlerts.organizationId, opts.organizationId),
          eq(orgAlerts.periodKey, opts.periodKey),
          eq(orgAlerts.kind, opts.kind),
        ),
      )
      .limit(1);

    const row = existing[0];
    if (row && !opts.force && !row.resolvedAt && !row.dismissedAt) {
      return "exists";
    }

    if (row) {
      await this.db
        .update(orgAlerts)
        .set({
          title: opts.title,
          message: opts.message,
          resolvedAt: null,
          dismissedAt: null,
          createdAt: new Date(),
        })
        .where(eq(orgAlerts.id, row.id));
      return "refreshed";
    }

    await this.db.insert(orgAlerts).values({
      organizationId: opts.organizationId,
      kind: opts.kind,
      periodKey: opts.periodKey,
      title: opts.title,
      message: opts.message,
    });
    return "created";
  }

  /** Clear open licence payment alerts after Super Admin records payment / grant. */
  async resolveLicenceAlerts(organizationId: string): Promise<void> {
    await this.db
      .update(orgAlerts)
      .set({ resolvedAt: new Date() })
      .where(
        and(
          eq(orgAlerts.organizationId, organizationId),
          isNull(orgAlerts.resolvedAt),
        ),
      );
  }

  private toAlert(row: {
    id: string;
    organizationId: string;
    kind: string;
    periodKey: string;
    title: string;
    message: string;
    createdAt: Date;
    resolvedAt: Date | null;
    dismissedAt: Date | null;
  }): OrgAlert {
    const kind =
      row.kind === "licence_due" ? "licence_due" : ("licence_month_end" as const);
    return {
      id: row.id,
      organizationId: row.organizationId,
      kind,
      periodKey: row.periodKey,
      title: row.title,
      message: row.message,
      createdAt: row.createdAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      dismissedAt: row.dismissedAt?.toISOString() ?? null,
    };
  }
}
