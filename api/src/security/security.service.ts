import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  organizationMemberships,
  popsAccountingAuditLogs,
  popsBranches,
  popsInventoryAuditLogs,
  popsSecurityEvents,
  refreshTokens,
  users,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../drizzle/drizzle.tokens";

type AuditEntry = {
  id: string;
  time: string;
  user: string;
  action: string;
  detail: string;
  module: string;
  severity: "info" | "warning" | "danger";
  sortTs: number;
};

@Injectable()
export class SecurityService {
  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  async logEvent(input: {
    organizationId?: string | null;
    branchId?: string | null;
    eventType: string;
    userEmail: string;
    userId?: string | null;
    action: string;
    detail?: string;
  }): Promise<void> {
    try {
      await this.db.insert(popsSecurityEvents).values({
        organizationId: input.organizationId ?? null,
        branchId: input.branchId ?? null,
        eventType: input.eventType,
        userEmail: input.userEmail,
        userId: input.userId ?? null,
        action: input.action,
        detail: input.detail ?? null,
      });
    } catch (err) {
      console.warn(
        "[security] Audit log skipped:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async getOverview(organizationId: string, branchCode?: string) {
    const branch = branchCode ? await this.resolveBranch(organizationId, branchCode) : null;
    const emailById = await this.loadOrgUserEmails(organizationId);
    const since24h = new Date(Date.now() - 86_400_000);

    const securityEvents = await this.db
      .select()
      .from(popsSecurityEvents)
      .where(eq(popsSecurityEvents.organizationId, organizationId))
      .orderBy(desc(popsSecurityEvents.createdAt))
      .limit(200);

    const failedLogins24h = securityEvents.filter(
      (e) => e.eventType === "login_failed" && e.createdAt >= since24h,
    ).length;

    const policyViolations = this.countPolicyViolations(securityEvents, since24h);

    const orgUserIds = [...emailById.keys()];
    const devices = await this.loadDevices(organizationId, orgUserIds, emailById);
    const activeDevices = devices.filter((d) => d.status === "active").length;

    const auditTrail = await this.buildAuditTrail(
      organizationId,
      branch?.id,
      emailById,
      securityEvents,
    );

    return {
      branchCode: branch?.code ?? null,
      metrics: {
        failedLogins24h,
        activeDevices,
        policyViolations,
      },
      auditTrail: auditTrail.slice(0, 100),
      devices,
    };
  }

  private countPolicyViolations(
    events: (typeof popsSecurityEvents.$inferSelect)[],
    since: Date,
  ): number {
    const recentFailures = events.filter(
      (e) => e.eventType === "login_failed" && e.createdAt >= since,
    );
    const byEmail = new Map<string, number>();
    for (const event of recentFailures) {
      const key = event.userEmail.toLowerCase();
      byEmail.set(key, (byEmail.get(key) ?? 0) + 1);
    }
    return [...byEmail.values()].filter((count) => count >= 3).length;
  }

  private async buildAuditTrail(
    organizationId: string,
    branchId: string | undefined,
    emailById: Map<string, string>,
    securityEvents: (typeof popsSecurityEvents.$inferSelect)[],
  ): Promise<Omit<AuditEntry, "sortTs">[]> {
    const entries: AuditEntry[] = [];

    for (const event of securityEvents) {
      entries.push({
        id: `sec-${event.id}`,
        time: formatAuditTime(event.createdAt),
        user: event.userEmail,
        action: event.action,
        detail: event.detail ?? "—",
        module: "Security",
        severity: event.eventType === "login_failed" ? "danger" : "info",
        sortTs: event.createdAt.getTime(),
      });
    }

    const invConditions = [eq(popsInventoryAuditLogs.organizationId, organizationId)];
    if (branchId) invConditions.push(eq(popsInventoryAuditLogs.branchId, branchId));

    const invLogs = await this.db
      .select()
      .from(popsInventoryAuditLogs)
      .where(and(...invConditions))
      .orderBy(desc(popsInventoryAuditLogs.createdAt))
      .limit(100);

    for (const log of invLogs) {
      entries.push({
        id: `inv-${log.id}`,
        time: formatAuditTime(log.createdAt),
        user: this.resolveActor(log.userEmail, emailById),
        action: log.action,
        detail: `${log.module} · ${log.detail}`,
        module: log.module,
        severity: sensitiveActionSeverity(log.action),
        sortTs: log.createdAt.getTime(),
      });
    }

    const acctConditions = [eq(popsAccountingAuditLogs.organizationId, organizationId)];
    if (branchId) acctConditions.push(eq(popsAccountingAuditLogs.branchId, branchId));

    const acctLogs = await this.db
      .select()
      .from(popsAccountingAuditLogs)
      .where(and(...acctConditions))
      .orderBy(desc(popsAccountingAuditLogs.createdAt))
      .limit(100);

    for (const log of acctLogs) {
      entries.push({
        id: `acct-${log.id}`,
        time: formatAuditTime(log.createdAt),
        user: this.resolveActor(log.actorEmail, emailById),
        action: `${log.action} ${log.entityType}`,
        detail: log.entityId,
        module: "Accounting",
        severity: sensitiveActionSeverity(log.action),
        sortTs: log.createdAt.getTime(),
      });
    }

    entries.sort((a, b) => b.sortTs - a.sortTs);
    return entries.map(({ sortTs: _sortTs, ...rest }) => rest);
  }

  private async loadDevices(
    organizationId: string,
    orgUserIds: string[],
    emailById: Map<string, string>,
  ) {
    if (orgUserIds.length === 0) return [];

    const memberships = await this.db
      .select({
        userId: organizationMemberships.userId,
        role: organizationMemberships.role,
        lastActivityAt: organizationMemberships.lastActivityAt,
      })
      .from(organizationMemberships)
      .where(eq(organizationMemberships.organizationId, organizationId));

    const roleByUser = new Map(memberships.map((m) => [m.userId, m.role]));
    const activityByUser = new Map(memberships.map((m) => [m.userId, m.lastActivityAt]));

    const tokens = await this.db
      .select()
      .from(refreshTokens)
      .where(inArray(refreshTokens.userId, orgUserIds))
      .orderBy(desc(refreshTokens.createdAt));

    const now = Date.now();
    return tokens.map((token) => {
      const active = token.expiresAt.getTime() > now;
      return {
        id: token.id,
        userEmail: emailById.get(token.userId) ?? token.userId,
        role: formatRoleLabel(roleByUser.get(token.userId) ?? "member"),
        sessionStarted: token.createdAt.toISOString(),
        expiresAt: token.expiresAt.toISOString(),
        lastActivityAt: activityByUser.get(token.userId)?.toISOString() ?? null,
        status: active ? ("active" as const) : ("expired" as const),
      };
    });
  }

  private async loadOrgUserEmails(organizationId: string): Promise<Map<string, string>> {
    const rows = await this.db
      .select({
        userId: users.id,
        email: users.email,
      })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(eq(organizationMemberships.organizationId, organizationId));

    return new Map(rows.map((r) => [r.userId, r.email]));
  }

  private resolveActor(raw: string, emailById: Map<string, string>): string {
    if (raw.includes("@")) return raw;
    return emailById.get(raw) ?? raw;
  }

  private async resolveBranch(organizationId: string, branchCode: string) {
    const rows = await this.db
      .select()
      .from(popsBranches)
      .where(
        and(eq(popsBranches.organizationId, organizationId), eq(popsBranches.code, branchCode.trim())),
      )
      .limit(1);
    const branch = rows[0];
    if (!branch) throw new NotFoundException(`Branch not found: ${branchCode}`);
    return branch;
  }
}

function formatAuditTime(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 16);
}

function formatRoleLabel(role: string): string {
  if (!role) return "Member";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function sensitiveActionSeverity(action: string): "info" | "warning" | "danger" {
  const lower = action.toLowerCase();
  if (lower.includes("delete") || lower.includes("void") || lower.includes("failed")) {
    return "danger";
  }
  if (lower.includes("approve") || lower.includes("discount") || lower.includes("override")) {
    return "warning";
  }
  return "info";
}
