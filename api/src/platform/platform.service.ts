import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, count, desc, eq, gte, lt, ne, sql } from "drizzle-orm";
import {
  permissionsForPopsRole,
  SYSTEM_TYPES,
  type Business,
  type CreateBusiness,
  type CreateLicencePayment,
  type CreatePlatformUser,
  type GrantLicenceDays,
  type LicencePayment,
  type LicenceReminderResult,
  type MonthlyLicenceRow,
  type MonthlyLicenceStatus,
  type PlatformAnalytics,
  type PlatformPublicInfo,
  type PlatformUser,
  type SendLicenceReminders,
  type SystemType,
  type UpdateBusiness,
  type UpdatePlatformSettings,
  type UpdatePlatformUser,
} from "@platform/contracts";
import {
  licencePayments,
  licenceReminders,
  organizationMemberships,
  organizations,
  platformSettings,
  popsBranches,
  refreshTokens,
  users,
  entityDeletionBackups,
  type PlatformPgDb,
} from "@platform/database-pg";
import * as bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { DRIZZLE } from "../drizzle/drizzle.tokens";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { isSuperAdmin } from "../auth/jwt.types";
import { OrgAlertsService } from "../org-alerts/org-alerts.service";
import {
  findLiveLoginUserByEmail,
  isDeletedLoginUser,
  isTombstoneEmail,
  tombstoneLoginEmail,
} from "../lib/login-email";
import { wipeBusinessTransactions } from "./business-reset.wipe";
import { UsersService } from "../users/users.service";

const LICENCE_TZ = "Asia/Karachi";

function karachiYmd(date = new Date()): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LICENCE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  return { year, month, day };
}

/** Asia/Karachi has no DST (UTC+5). */
function karachiMonthBounds(year: number, month: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month - 1, 1) - 5 * 60 * 60 * 1000);
  const end = new Date(Date.UTC(year, month, 1) - 5 * 60 * 60 * 1000);
  return { start, end };
}

function periodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function periodLabel(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

@Injectable()
export class PlatformService {
  private readonly logger = new Logger(PlatformService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly orgAlerts: OrgAlertsService,
    private readonly usersService: UsersService,
  ) {}

  assertSuperAdmin(user: AccessJwtPayload): void {
    if (!isSuperAdmin(user)) {
      throw new ForbiddenException("Access denied. Super Admin role required.");
    }
  }

  async listBusinesses(): Promise<Business[]> {
    const rows = await this.db
      .select({
        id: organizations.id,
        name: organizations.name,
        systemType: organizations.systemType,
        status: organizations.status,
        licenceKey: organizations.licenceKey,
        licencePlan: organizations.licencePlan,
        licenceExpiresAt: organizations.licenceExpiresAt,
        enabledModules: organizations.enabledModules,
        fbrAllowed: organizations.fbrAllowed,
        praFakeAllowed: organizations.praFakeAllowed,
        praRealAllowed: organizations.praRealAllowed,
        fbrEnabled: organizations.fbrEnabled,
        praEnabled: organizations.praEnabled,
        praFakeEnabled: organizations.praFakeEnabled,
        praRealEnabled: organizations.praRealEnabled,
        createdBy: organizations.createdBy,
        createdAt: organizations.createdAt,
      })
      .from(organizations)
      .where(ne(organizations.status, "deleted"))
      .orderBy(desc(organizations.createdAt));

    const withCounts = await Promise.all(
      rows.map(async (row) => {
        const [userCountRow] = await this.db
          .select({ value: count() })
          .from(organizationMemberships)
          .where(eq(organizationMemberships.organizationId, row.id));

        const admin = await this.db
          .select({ email: users.email, status: users.status })
          .from(organizationMemberships)
          .innerJoin(users, eq(users.id, organizationMemberships.userId))
          .where(
            and(
              eq(organizationMemberships.organizationId, row.id),
              sql`${organizationMemberships.role} in ('owner', 'admin')`,
            ),
          )
          .limit(20);

        const liveAdmin =
          admin.find(
            (a) =>
              a.status !== "deleted" &&
              !String(a.email ?? "")
                .toLowerCase()
                .endsWith("@deleted.local"),
          ) ?? null;

        return this.toBusiness(row, {
          adminEmail: liveAdmin?.email ?? null,
          userCount: Number(userCountRow?.value ?? 0),
        });
      }),
    );

    return withCounts;
  }

  async getBusiness(businessId: string): Promise<Business> {
    const rows = await this.db
      .select()
      .from(organizations)
      .where(and(eq(organizations.id, businessId), ne(organizations.status, "deleted")))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException("Business not found");

    const [userCountRow] = await this.db
      .select({ value: count() })
      .from(organizationMemberships)
      .where(eq(organizationMemberships.organizationId, row.id));

    const admin = await this.db
      .select({ email: users.email, status: users.status })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(
        and(
          eq(organizationMemberships.organizationId, row.id),
          sql`${organizationMemberships.role} in ('owner', 'admin')`,
        ),
      )
      .limit(20);

    const liveAdmin =
      admin.find(
        (a) =>
          a.status !== "deleted" &&
          !String(a.email ?? "")
            .toLowerCase()
            .endsWith("@deleted.local"),
      ) ?? null;

    return this.toBusiness(row, {
      adminEmail: liveAdmin?.email ?? null,
      userCount: Number(userCountRow?.value ?? 0),
    });
  }

  async createBusiness(actor: AccessJwtPayload, input: CreateBusiness): Promise<Business> {
    const adminEmail = input.adminEmail.trim().toLowerCase();
    // Login namespace only — customer / patient emails are separate tables.
    const existingUser = await findLiveLoginUserByEmail(this.db, adminEmail);
    if (existingUser) {
      if (existingUser.platformRole === "super_admin") {
        throw new ConflictException(
          "This login email belongs to the Super Admin account. Pick a different login email for this business admin.",
        );
      }
      // Orphan / soft-deleted-org leftovers: email still on users but no live business
      // (Users page hid them when their only org was deleted). Free the address.
      const liveOrg = await this.findLiveOrgMembership(existingUser.id);
      if (!liveOrg) {
        this.logger.warn(
          `Reclaiming orphan login email ${adminEmail} (user ${existingUser.id}) for new business`,
        );
        await this.tombstoneLoginUser(existingUser.id, existingUser.email);
      } else {
        throw new ConflictException(
          `This login email is already used by “${liveOrg.businessName}” (${liveOrg.role}). Pick a different login email, or delete that user first.`,
        );
      }
    }

    const passwordHash = await bcrypt.hash(input.adminPassword, 12);
    const licenceKey = input.licenceKey ?? `LIC-${randomBytes(8).toString("hex").toUpperCase()}`;
    const settings = await this.getSettings();
    const defaultPlan =
      typeof settings.entries.default_licence_plan === "string" &&
      settings.entries.default_licence_plan.trim()
        ? settings.entries.default_licence_plan.trim()
        : "standard";

    const [org] = await this.db
      .insert(organizations)
      .values({
        name: input.name.trim(),
        systemType: input.systemType,
        status: "active",
        licenceKey,
        licencePlan: input.licencePlan ?? defaultPlan,
        licenceExpiresAt: input.licenceExpiresAt ? new Date(input.licenceExpiresAt) : null,
        enabledModules: input.enabledModules ?? null,
        fbrAllowed: input.fbrEnabled ?? false,
        fbrEnabled: false,
        ...this.resolvePraSectionGrantsForWrite(input),
        createdBy: actor.sub,
      })
      .returning();

    if (!org) throw new BadRequestException("Failed to create business");

    const [adminUser] = await this.db
      .insert(users)
      .values({
        name: input.adminName.trim(),
        email: adminEmail,
        passwordHash,
        lastSetPassword: input.adminPassword,
        status: "active",
        platformRole: null,
      })
      .returning({ id: users.id, email: users.email });

    if (!adminUser) throw new BadRequestException("Failed to create system admin");

    await this.db.insert(organizationMemberships).values({
      organizationId: org.id,
      userId: adminUser.id,
      role: "owner",
      permissions: permissionsForPopsRole("admin"),
      branchScope: "all",
      pinRequired: false,
      active: true,
      lastActivityAt: new Date(),
    });

    // Every new business gets a MAIN branch so ERP dashboards work on first login.
    await this.db.insert(popsBranches).values({
      organizationId: org.id,
      code: "MAIN",
      name: "Main System",
      city: "Head Office",
    });

    return this.toBusiness(org, { adminEmail: adminUser.email, userCount: 1 });
  }

  async updateBusiness(businessId: string, input: UpdateBusiness): Promise<Business> {
    const existing = await this.getBusiness(businessId);

    if (input.status === "deleted") {
      throw new BadRequestException("Use DELETE to remove a business");
    }

    const [raw] = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, businessId))
      .limit(1);

    const [updated] = await this.db
      .update(organizations)
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.licenceKey !== undefined ? { licenceKey: input.licenceKey } : {}),
        ...(input.licencePlan !== undefined ? { licencePlan: input.licencePlan } : {}),
        ...(input.licenceExpiresAt !== undefined
          ? {
              licenceExpiresAt: input.licenceExpiresAt ? new Date(input.licenceExpiresAt) : null,
            }
          : {}),
        ...(input.enabledModules !== undefined ? { enabledModules: input.enabledModules } : {}),
        ...(input.fbrEnabled !== undefined
          ? {
              fbrAllowed: input.fbrEnabled,
              ...(input.fbrEnabled ? {} : { fbrEnabled: false }),
            }
          : {}),
        ...this.resolvePraSectionGrantsForUpdate(input, {
          praFakeAllowed: Boolean(raw?.praFakeAllowed) || Boolean(raw?.praFakeEnabled),
          praRealAllowed: Boolean(raw?.praRealAllowed) || Boolean(raw?.praRealEnabled),
          praFakeEnabled: Boolean(raw?.praFakeEnabled),
          praRealEnabled: Boolean(raw?.praRealEnabled),
        }),
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, businessId))
      .returning();

    if (!updated) throw new NotFoundException("Business not found");
    return this.toBusiness(updated, {
      adminEmail: existing.adminEmail ?? null,
      userCount: existing.userCount ?? 0,
    });
  }

  /** Extend licence from max(now, current expiry) by N days; optional payment row. */
  async grantLicenceDays(
    actor: AccessJwtPayload,
    businessId: string,
    input: GrantLicenceDays,
  ): Promise<Business> {
    const existing = await this.getBusiness(businessId);
    const now = new Date();
    const currentExpiry = existing.licenceExpiresAt ? new Date(existing.licenceExpiresAt) : null;
    const base = currentExpiry && currentExpiry > now ? currentExpiry : now;
    const nextExpiry = new Date(base.getTime() + input.days * 24 * 60 * 60 * 1000);
    const plan =
      input.plan ??
      (input.days === 5 ? "trial_5" : input.days === 30 ? "monthly_30" : existing.licencePlan ?? "custom");

    const [updated] = await this.db
      .update(organizations)
      .set({
        licencePlan: plan,
        licenceExpiresAt: nextExpiry,
        status: existing.status === "suspended" ? "active" : existing.status,
        updatedAt: now,
      })
      .where(eq(organizations.id, businessId))
      .returning();

    if (!updated) throw new NotFoundException("Business not found");

    if (input.recordPayment) {
      await this.db.insert(licencePayments).values({
        organizationId: businessId,
        periodDays: input.days,
        amount: input.amount ?? 0,
        currency: input.currency ?? "PKR",
        paidByLabel: input.paidByLabel?.trim() || existing.adminEmail || existing.name,
        note: input.note?.trim() || `Granted ${input.days}-day licence`,
        paidAt: now,
        recordedBy: actor.sub,
      });
    }

    await this.orgAlerts.resolveLicenceAlerts(businessId);

    return this.toBusiness(updated, {
      adminEmail: existing.adminEmail ?? null,
      userCount: existing.userCount ?? 0,
    });
  }

  async listLicencePayments(businessId?: string): Promise<LicencePayment[]> {
    const base = this.db
      .select({
        id: licencePayments.id,
        organizationId: licencePayments.organizationId,
        periodDays: licencePayments.periodDays,
        amount: licencePayments.amount,
        currency: licencePayments.currency,
        paidByLabel: licencePayments.paidByLabel,
        note: licencePayments.note,
        paidAt: licencePayments.paidAt,
        recordedBy: licencePayments.recordedBy,
        createdAt: licencePayments.createdAt,
        businessName: organizations.name,
      })
      .from(licencePayments)
      .innerJoin(organizations, eq(organizations.id, licencePayments.organizationId));

    const rows = await (businessId
      ? base.where(eq(licencePayments.organizationId, businessId))
      : base
    )
      .orderBy(desc(licencePayments.paidAt))
      .limit(200);

    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      periodDays: row.periodDays,
      amount: row.amount,
      currency: row.currency,
      paidByLabel: row.paidByLabel,
      note: row.note,
      paidAt: row.paidAt.toISOString(),
      recordedBy: row.recordedBy,
      createdAt: row.createdAt.toISOString(),
      businessName: row.businessName,
    }));
  }

  async recordLicencePayment(
    actor: AccessJwtPayload,
    businessId: string,
    input: CreateLicencePayment,
  ): Promise<{ payment: LicencePayment; business: Business }> {
    const existing = await this.getBusiness(businessId);
    const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
    const extend = input.extendLicence !== false;

    const [payment] = await this.db
      .insert(licencePayments)
      .values({
        organizationId: businessId,
        periodDays: input.periodDays,
        amount: input.amount ?? 0,
        currency: input.currency ?? "PKR",
        paidByLabel: input.paidByLabel?.trim() || existing.adminEmail || existing.name,
        note: input.note?.trim() || null,
        paidAt,
        recordedBy: actor.sub,
      })
      .returning();

    let business = existing;
    if (extend) {
      business = await this.grantLicenceDays(actor, businessId, {
        days: input.periodDays,
        plan: input.periodDays === 5 ? "trial_5" : input.periodDays === 30 ? "monthly_30" : undefined,
        recordPayment: false,
      });
    } else {
      await this.orgAlerts.resolveLicenceAlerts(businessId);
    }

    return {
      payment: {
        id: payment.id,
        organizationId: payment.organizationId,
        periodDays: payment.periodDays,
        amount: payment.amount,
        currency: payment.currency,
        paidByLabel: payment.paidByLabel,
        note: payment.note,
        paidAt: payment.paidAt.toISOString(),
        recordedBy: payment.recordedBy,
        createdAt: payment.createdAt.toISOString(),
        businessName: existing.name,
      },
      business,
    };
  }

  async getMonthlyLicenceStatus(year?: number, month?: number): Promise<MonthlyLicenceStatus> {
    const nowParts = karachiYmd();
    const y = year ?? nowParts.year;
    const m = month ?? nowParts.month;
    if (m < 1 || m > 12) throw new BadRequestException("Invalid month");

    const { start, end } = karachiMonthBounds(y, m);
    const label = periodLabel(y, m);
    const key = periodKey(y, m);

    const businesses = await this.listBusinesses();
    const activeBiz = businesses.filter((b) => b.status === "active" || b.status === "suspended");

    const payments = await this.db
      .select()
      .from(licencePayments)
      .where(and(gte(licencePayments.paidAt, start), lt(licencePayments.paidAt, end)))
      .orderBy(desc(licencePayments.paidAt));

    const paymentByOrg = new Map<string, (typeof payments)[0]>();
    for (const p of payments) {
      if (!paymentByOrg.has(p.organizationId)) paymentByOrg.set(p.organizationId, p);
    }

    const reminderRows = await this.db
      .select()
      .from(licenceReminders)
      .where(eq(licenceReminders.periodKey, key))
      .orderBy(desc(licenceReminders.sentAt));
    const lastReminderByOrg = new Map<string, Date>();
    for (const r of reminderRows) {
      if (!lastReminderByOrg.has(r.organizationId)) {
        lastReminderByOrg.set(r.organizationId, r.sentAt);
      }
    }

    const paid: MonthlyLicenceRow[] = [];
    const unpaid: MonthlyLicenceRow[] = [];

    for (const b of activeBiz) {
      const pay = paymentByOrg.get(b.id) ?? null;
      const daysLeft =
        typeof b.licenceDaysLeft === "number"
          ? b.licenceDaysLeft
          : b.licenceExpiresAt
            ? Math.ceil((new Date(b.licenceExpiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
            : null;
      const row: MonthlyLicenceRow = {
        organizationId: b.id,
        businessName: b.name,
        systemType: b.systemType,
        status: b.status,
        adminEmail: b.adminEmail ?? null,
        licencePlan: b.licencePlan ?? null,
        licenceExpiresAt: b.licenceExpiresAt ?? null,
        licenceDaysLeft: daysLeft,
        licenceExpired: Boolean(b.licenceExpired),
        paidThisMonth: Boolean(pay),
        payment: pay
          ? {
              id: pay.id,
              amount: pay.amount,
              currency: pay.currency,
              periodDays: pay.periodDays,
              paidAt: pay.paidAt.toISOString(),
              paidByLabel: pay.paidByLabel,
              note: pay.note,
            }
          : null,
        lastReminderAt: lastReminderByOrg.get(b.id)?.toISOString() ?? null,
      };
      if (pay) {
        paid.push(row);
      } else {
        unpaid.push(row);
      }
    }

    const orgIds = new Set(activeBiz.map((b) => b.id));
    const totalCollected = payments
      .filter((p) => orgIds.has(p.organizationId))
      .reduce((sum, p) => sum + p.amount, 0);

    return {
      year: y,
      month: m,
      timezone: LICENCE_TZ,
      periodLabel: label,
      paidCount: paid.length,
      unpaidCount: unpaid.length,
      totalCollected,
      currency: "PKR",
      paid,
      unpaid,
    };
  }

  async sendLicenceReminders(input: SendLicenceReminders): Promise<LicenceReminderResult> {
    const status = await this.getMonthlyLicenceStatus(input.year, input.month);
    const nowParts = karachiYmd();
    const day = nowParts.day;
    const mode = input.mode ?? "month_end";
    const force = Boolean(input.force);
    const dryRun = Boolean(input.dryRun);
    const key = periodKey(status.year, status.month);
    const idFilter = input.organizationIds?.length
      ? new Set(input.organizationIds)
      : null;

    /** Month-end pay banner only when licence is within ~1 month (not e.g. 366d left). */
    const MONTH_END_ALERT_MAX_DAYS = 30;
    const candidates = status.unpaid.filter((row) => {
      if (idFilter && !idFilter.has(row.organizationId)) return false;
      const dueSoon =
        row.licenceExpired ||
        (row.licenceDaysLeft != null && row.licenceDaysLeft <= 5);
      const monthEndWindow = day >= 25 || day <= 3;
      const nearLicenceEnd =
        row.licenceDaysLeft != null &&
        row.licenceDaysLeft <= MONTH_END_ALERT_MAX_DAYS;
      if (mode === "due") return dueSoon;
      // month_end / all: never nag when plenty of licence time remains
      if (dueSoon) return true;
      return monthEndWindow && nearLicenceEnd;
    });

    const results: LicenceReminderResult["results"] = [];
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of candidates) {
      const kind: "month_end" | "due" =
        row.licenceExpired || (row.licenceDaysLeft != null && row.licenceDaysLeft <= 5)
          ? "due"
          : "month_end";

      if (!force) {
        const existing = await this.db
          .select({ id: licenceReminders.id })
          .from(licenceReminders)
          .where(
            and(
              eq(licenceReminders.organizationId, row.organizationId),
              eq(licenceReminders.periodKey, key),
              eq(licenceReminders.kind, kind),
            ),
          )
          .limit(1);
        if (existing[0]) {
          skipped += 1;
          results.push({
            organizationId: row.organizationId,
            businessName: row.businessName,
            adminEmail: row.adminEmail,
            status: "skipped",
            reason: `Already alerted (${kind}) for ${key}`,
          });
          continue;
        }
      }

      if (dryRun) {
        results.push({
          organizationId: row.organizationId,
          businessName: row.businessName,
          adminEmail: row.adminEmail,
          status: "dry_run",
          reason: `Would create in-app admin alert (${kind})`,
        });
        continue;
      }

      try {
        if (force) {
          await this.db
            .delete(licenceReminders)
            .where(
              and(
                eq(licenceReminders.organizationId, row.organizationId),
                eq(licenceReminders.periodKey, key),
                eq(licenceReminders.kind, kind),
              ),
            );
        }

        const alertKind = kind === "due" ? "licence_due" : "licence_month_end";
        const title =
          kind === "due"
            ? "Software licence payment due"
            : `Monthly payment due — ${status.periodLabel}`;
        const expiryBit = row.licenceExpiresAt
          ? ` Licence expiry: ${new Date(row.licenceExpiresAt).toLocaleDateString()}${
              row.licenceDaysLeft != null
                ? row.licenceDaysLeft < 0
                  ? ` (expired ${Math.abs(row.licenceDaysLeft)}d ago)`
                  : ` (${row.licenceDaysLeft}d left)`
                : ""
            }.`
          : "";
        const message =
          kind === "due"
            ? `Your POPS software licence needs renewal.${expiryBit} Contact the platform to pay and keep the system active.`
            : `Monthly software payment for ${status.periodLabel} is not recorded yet.${expiryBit} Please pay so your access continues.`;

        const upsert = await this.orgAlerts.upsertLicenceAlert({
          organizationId: row.organizationId,
          kind: alertKind,
          periodKey: key,
          title,
          message,
          force,
        });

        await this.db.insert(licenceReminders).values({
          organizationId: row.organizationId,
          periodKey: key,
          kind,
          channel: "in_app",
          toEmail: row.adminEmail,
          success: "true",
          detail: `admin_alert_${upsert}`,
        });

        sent += 1;
        results.push({
          organizationId: row.organizationId,
          businessName: row.businessName,
          adminEmail: row.adminEmail,
          status: "sent",
          reason: `In-app admin alert ${upsert}`,
        });
      } catch (err) {
        failed += 1;
        const reason = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Reminder failed for ${row.businessName}: ${reason}`);
        results.push({
          organizationId: row.organizationId,
          businessName: row.businessName,
          adminEmail: row.adminEmail,
          status: "failed",
          reason,
        });
      }
    }

    return { sent, skipped, failed, dryRun, results };
  }

  /** Automated tick: month-end window or licences due within 5 days. */
  async runAutomatedLicenceReminders(): Promise<LicenceReminderResult | null> {
    const { day } = karachiYmd();
    const status = await this.getMonthlyLicenceStatus();
    const hasDue = status.unpaid.some(
      (r) => r.licenceExpired || (r.licenceDaysLeft != null && r.licenceDaysLeft <= 5),
    );
    const monthEndWindow = day >= 25 || day <= 3;
    if (!monthEndWindow && !hasDue) {
      this.logger.debug("Licence reminder tick: nothing due");
      return null;
    }
    const mode = hasDue && !monthEndWindow ? "due" : monthEndWindow && hasDue ? "all" : "month_end";
    this.logger.log(`Licence reminder automation running (mode=${mode}, day=${day})`);
    return this.sendLicenceReminders({ mode });
  }

  /**
   * Wipe all transactional data for a business (sales, journals, stock movements, …).
   * Keeps company setup: users, menu, catalog, chart of accounts, licence.
   * Dashboard / P&L become zero after this.
   */
  async resetBusinessTransactions(
    actor: AccessJwtPayload,
    businessId: string,
    confirmName: string,
  ): Promise<{
    ok: true;
    businessId: string;
    businessName: string;
    deletedRows: number;
    wipedTables: string[];
  }> {
    const orgRows = await this.db
      .select()
      .from(organizations)
      .where(and(eq(organizations.id, businessId), ne(organizations.status, "deleted")))
      .limit(1);
    const org = orgRows[0];
    if (!org) throw new NotFoundException("Business not found");

    const expected = org.name.trim().toLowerCase();
    const given = confirmName.trim().toLowerCase();
    if (!given || given !== expected) {
      throw new BadRequestException(
        `Type the exact business name “${org.name}” to confirm company reset`,
      );
    }

    const wipe = await wipeBusinessTransactions(this.db, businessId);

    await this.db.insert(entityDeletionBackups).values({
      entityType: "business_reset",
      entityId: businessId,
      originalEmail: null,
      label: org.name,
      deletedBy: actor.sub,
      payload: {
        organizationId: businessId,
        businessName: org.name,
        deletedRows: wipe.deletedRows,
        wipedTables: wipe.wipedTables,
        resetAt: new Date().toISOString(),
      },
    });

    this.logger.warn(
      `Company reset for ${org.name} (${businessId}) by ${actor.sub}: ${wipe.deletedRows} rows`,
    );

    return {
      ok: true,
      businessId,
      businessName: org.name,
      deletedRows: wipe.deletedRows,
      wipedTables: wipe.wipedTables,
    };
  }

  async deleteBusiness(actor: AccessJwtPayload, businessId: string): Promise<{ ok: true }> {
    const orgRows = await this.db
      .select()
      .from(organizations)
      .where(and(eq(organizations.id, businessId), ne(organizations.status, "deleted")))
      .limit(1);
    const org = orgRows[0];
    if (!org) throw new NotFoundException("Business not found");

    const memberRows = await this.db
      .select({
        userId: users.id,
        email: users.email,
        name: users.name,
        status: users.status,
        platformRole: users.platformRole,
        role: organizationMemberships.role,
        active: organizationMemberships.active,
      })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(eq(organizationMemberships.organizationId, businessId));

    const adminEmail =
      memberRows.find((m) => m.role === "owner" || m.role === "admin")?.email ?? null;

    await this.db.insert(entityDeletionBackups).values({
      entityType: "business",
      entityId: businessId,
      originalEmail: adminEmail,
      label: org.name,
      deletedBy: actor.sub,
      payload: {
        organization: org,
        members: memberRows,
        deletedAt: new Date().toISOString(),
      },
    });

    const [updated] = await this.db
      .update(organizations)
      .set({ status: "deleted", updatedAt: new Date() })
      .where(eq(organizations.id, businessId))
      .returning({ id: organizations.id });
    if (!updated) throw new NotFoundException("Business not found");

    await this.db
      .update(organizationMemberships)
      .set({ active: false })
      .where(eq(organizationMemberships.organizationId, businessId));

    for (const member of memberRows) {
      if (member.platformRole === "super_admin") continue;
      const otherLive = await this.db
        .select({ organizationId: organizationMemberships.organizationId })
        .from(organizationMemberships)
        .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
        .where(
          and(
            eq(organizationMemberships.userId, member.userId),
            ne(organizationMemberships.organizationId, businessId),
            ne(organizations.status, "deleted"),
          ),
        )
        .limit(1);
      if (otherLive.length > 0) continue;
      await this.tombstoneLoginUser(member.userId, member.email);
    }

    return { ok: true };
  }

  async deleteUser(actor: AccessJwtPayload, userId: string): Promise<{ ok: true }> {
    const rows = await this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        platformRole: users.platformRole,
        status: users.status,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const target = rows[0];
    if (!target) throw new NotFoundException("User not found");
    if (target.platformRole === "super_admin") {
      throw new BadRequestException("Cannot delete the Super Admin account");
    }
    if (isDeletedLoginUser(target)) {
      throw new NotFoundException("User not found");
    }

    const memberships = await this.db
      .select({
        organizationId: organizationMemberships.organizationId,
        role: organizationMemberships.role,
        active: organizationMemberships.active,
        businessName: organizations.name,
        businessStatus: organizations.status,
      })
      .from(organizationMemberships)
      .leftJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
      .where(eq(organizationMemberships.userId, userId));

    await this.db.insert(entityDeletionBackups).values({
      entityType: "user",
      entityId: userId,
      originalEmail: target.email,
      label: target.name ?? target.email,
      deletedBy: actor.sub,
      payload: {
        user: target,
        memberships,
        deletedAt: new Date().toISOString(),
      },
    });

    await this.tombstoneLoginUser(userId, target.email);
    return { ok: true };
  }

  /** Soft-delete a login account: backup email freed, hidden from live lists, cannot sign in. */
  private async tombstoneLoginUser(userId: string, currentEmail: string): Promise<void> {
    if (isTombstoneEmail(currentEmail)) {
      await this.db.update(users).set({ status: "deleted" }).where(eq(users.id, userId));
    } else {
      await this.db
        .update(users)
        .set({
          status: "deleted",
          email: tombstoneLoginEmail(userId),
        })
        .where(eq(users.id, userId));
    }
    await this.db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
    await this.db
      .update(organizationMemberships)
      .set({ active: false })
      .where(eq(organizationMemberships.userId, userId));
  }

  /** Live (non-deleted) org membership for a login user, if any. */
  private async findLiveOrgMembership(
    userId: string,
  ): Promise<{ businessId: string; businessName: string; role: string } | null> {
    const row =
      (
        await this.db
          .select({
            businessId: organizations.id,
            businessName: organizations.name,
            role: organizationMemberships.role,
          })
          .from(organizationMemberships)
          .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
          .where(
            and(eq(organizationMemberships.userId, userId), ne(organizations.status, "deleted")),
          )
          .limit(1)
      )[0] ?? null;
    return row;
  }

  async listUsers(): Promise<PlatformUser[]> {
    const rows = await this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        platformRole: users.platformRole,
        status: users.status,
        createdAt: users.createdAt,
        lastSetPassword: users.lastSetPassword,
        role: organizationMemberships.role,
        active: organizationMemberships.active,
        businessId: organizations.id,
        businessName: organizations.name,
        businessStatus: organizations.status,
        systemType: organizations.systemType,
      })
      .from(users)
      .leftJoin(organizationMemberships, eq(organizationMemberships.userId, users.id))
      .leftJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
      .orderBy(desc(users.createdAt));

    // One row per live login user. Prefer a live business; if only deleted-org
    // memberships exist, still list the user (orphan) so Super Admin can see / delete.
    const byId = new Map<string, PlatformUser>();
    for (const row of rows) {
      if (isDeletedLoginUser(row)) continue;
      const liveBusiness = row.businessStatus && row.businessStatus !== "deleted";
      const prev = byId.get(row.id);
      if (!prev) {
        byId.set(row.id, {
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.platformRole === "super_admin" ? "super_admin" : liveBusiness ? (row.role ?? "none") : "none",
          platformRole: row.platformRole === "super_admin" ? "super_admin" : null,
          businessId: liveBusiness ? row.businessId : null,
          businessName: liveBusiness ? row.businessName : null,
          systemType: liveBusiness ? ((row.systemType as SystemType | null) ?? null) : null,
          status: row.status,
          active: liveBusiness ? (row.active ?? row.status === "active") : row.status === "active",
          createdAt: row.createdAt.toISOString(),
          lastSetPassword: row.lastSetPassword ?? null,
        });
        continue;
      }
      if (liveBusiness && !prev.businessId) {
        prev.role = row.platformRole === "super_admin" ? "super_admin" : (row.role ?? "none");
        prev.businessId = row.businessId;
        prev.businessName = row.businessName;
        prev.systemType = (row.systemType as SystemType | null) ?? null;
        prev.active = row.active ?? row.status === "active";
      }
    }

    return [...byId.values()];
  }

  async createUser(input: CreatePlatformUser): Promise<PlatformUser> {
    const [org] = await this.db
      .select({ id: organizations.id, status: organizations.status })
      .from(organizations)
      .where(eq(organizations.id, input.businessId))
      .limit(1);
    if (!org || org.status === "deleted") {
      throw new NotFoundException("Business not found");
    }

    const created = await this.usersService.createUser(input.businessId, {
      email: input.email,
      password: input.password,
      role: input.role,
      branchScope: input.branchScope,
      pinRequired: input.pinRequired,
      staffPin: input.staffPin,
    });

    if (input.name?.trim()) {
      await this.db.update(users).set({ name: input.name.trim() }).where(eq(users.id, created.id));
    }

    const listed = await this.listUsers();
    const row = listed.find((u) => u.id === created.id);
    if (!row) throw new BadRequestException("User created but could not be loaded");
    return row;
  }

  async resetUserPassword(userId: string, password: string): Promise<{ ok: true }> {
    const rows = await this.db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (!rows[0]) throw new NotFoundException("User not found");
    const passwordHash = await bcrypt.hash(password, 12);
    await this.db
      .update(users)
      .set({ passwordHash, lastSetPassword: password })
      .where(eq(users.id, userId));
    await this.db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
    return { ok: true };
  }

  async updateUser(userId: string, input: UpdatePlatformUser): Promise<PlatformUser> {
    const rows = await this.db
      .select({
        id: users.id,
        platformRole: users.platformRole,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const target = rows[0];
    if (!target) throw new NotFoundException("User not found");
    if (target.platformRole === "super_admin" && input.status && input.status !== "active") {
      throw new BadRequestException("Cannot deactivate the Super Admin account");
    }

    const [updated] = await this.db
      .update(users)
      .set({
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      })
      .where(eq(users.id, userId))
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        platformRole: users.platformRole,
        status: users.status,
        createdAt: users.createdAt,
      });

    if (!updated) throw new NotFoundException("User not found");

    if (input.status === "inactive" || input.status === "suspended") {
      await this.db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
      await this.db
        .update(organizationMemberships)
        .set({ active: false })
        .where(eq(organizationMemberships.userId, userId));
    } else if (input.status === "active") {
      await this.db
        .update(organizationMemberships)
        .set({ active: true })
        .where(eq(organizationMemberships.userId, userId));
    }

    const listed = await this.listUsers();
    const match = listed.find((u) => u.id === userId);
    if (match) return match;

    return {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.platformRole === "super_admin" ? "super_admin" : "none",
      platformRole: updated.platformRole === "super_admin" ? "super_admin" : null,
      businessId: null,
      businessName: null,
      systemType: null,
      status: updated.status,
      active: updated.status === "active",
      createdAt: updated.createdAt.toISOString(),
      lastSetPassword: null,
    };
  }

  async getPublicInfo(): Promise<PlatformPublicInfo> {
    const { entries } = await this.getSettings();
    const support =
      typeof entries.support_email === "string" && entries.support_email.trim()
        ? entries.support_email.trim()
        : null;
    const maintenance =
      typeof entries.maintenance_message === "string" && entries.maintenance_message.trim()
        ? entries.maintenance_message.trim()
        : null;
    return { supportEmail: support, maintenanceMessage: maintenance };
  }

  async getSettings(): Promise<{ entries: Record<string, unknown> }> {
    const rows = await this.db.select().from(platformSettings);
    const entries: Record<string, unknown> = {};
    for (const row of rows) {
      entries[row.key] = row.value;
    }
    return { entries };
  }

  async updateSettings(
    actor: AccessJwtPayload,
    input: UpdatePlatformSettings,
  ): Promise<{ entries: Record<string, unknown> }> {
    for (const [key, value] of Object.entries(input.entries)) {
      await this.db
        .insert(platformSettings)
        .values({
          key,
          value,
          updatedBy: actor.sub,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: platformSettings.key,
          set: {
            value,
            updatedBy: actor.sub,
            updatedAt: new Date(),
          },
        });
    }
    return this.getSettings();
  }

  async getAnalytics(): Promise<PlatformAnalytics> {
    const businesses = await this.listBusinesses();
    const allUsers = await this.db.select({ id: users.id }).from(users);

    const bySystemType = SYSTEM_TYPES.map((systemType) => ({
      systemType,
      count: businesses.filter((b) => b.systemType === systemType).length,
    }));

    return {
      totalBusinesses: businesses.length,
      activeBusinesses: businesses.filter((b) => b.status === "active").length,
      suspendedBusinesses: businesses.filter((b) => b.status === "suspended").length,
      inactiveBusinesses: businesses.filter((b) => b.status === "inactive").length,
      totalUsers: allUsers.length,
      expiredLicences: businesses.filter((b) => b.licenceExpired).length,
      expiringSoonLicences: businesses.filter(
        (b) => !b.licenceExpired && typeof b.licenceDaysLeft === "number" && b.licenceDaysLeft <= 30,
      ).length,
      bySystemType,
      recentBusinesses: businesses.slice(0, 10),
      licenceAlerts: businesses
        .filter(
          (b) =>
            b.licenceExpired ||
            (typeof b.licenceDaysLeft === "number" && b.licenceDaysLeft <= 30),
        )
        .slice(0, 20),
    };
  }

  async listSystemTypes(): Promise<{ id: SystemType; label: string }[]> {
    const { SYSTEM_TYPE_LABELS } = await import("@platform/contracts");
    // Only systems with a shipped ERP shell (exclude grocery/retail placeholders).
    const shipped: SystemType[] = ["restaurant", "ice_cream", "pharmacy", "general_store"];
    return shipped.map((id) => ({ id, label: SYSTEM_TYPE_LABELS[id] }));
  }

  /** Super Admin: section visibility (Fake + Real can both be shown). Active stays with Org Admin. */
  private resolvePraSectionGrantsForWrite(input: {
    praEnabled?: boolean;
    praFakeEnabled?: boolean;
    praRealEnabled?: boolean;
  }): {
    praFakeAllowed: boolean;
    praRealAllowed: boolean;
    praEnabled: boolean;
    praFakeEnabled: boolean;
    praRealEnabled: boolean;
  } {
    const fakeProvided = input.praFakeEnabled !== undefined;
    const realProvided = input.praRealEnabled !== undefined;
    let praFakeAllowed = false;
    let praRealAllowed = false;
    if (fakeProvided || realProvided) {
      praFakeAllowed = Boolean(input.praFakeEnabled);
      praRealAllowed = Boolean(input.praRealEnabled);
    } else if (input.praEnabled !== undefined) {
      praRealAllowed = Boolean(input.praEnabled);
    }
    return {
      praFakeAllowed,
      praRealAllowed,
      praEnabled: false,
      praFakeEnabled: false,
      praRealEnabled: false,
    };
  }

  private resolvePraSectionGrantsForUpdate(
    input: {
      praEnabled?: boolean;
      praFakeEnabled?: boolean;
      praRealEnabled?: boolean;
    },
    current: {
      praFakeAllowed?: boolean;
      praRealAllowed?: boolean;
      praFakeEnabled?: boolean;
      praRealEnabled?: boolean;
    },
  ): Partial<{
    praFakeAllowed: boolean;
    praRealAllowed: boolean;
    praEnabled: boolean;
    praFakeEnabled: boolean;
    praRealEnabled: boolean;
  }> {
    const fakeProvided = input.praFakeEnabled !== undefined;
    const realProvided = input.praRealEnabled !== undefined;
    if (!fakeProvided && !realProvided && input.praEnabled === undefined) return {};

    let praFakeAllowed = Boolean(current.praFakeAllowed);
    let praRealAllowed = Boolean(current.praRealAllowed);
    if (fakeProvided || realProvided) {
      if (fakeProvided) praFakeAllowed = Boolean(input.praFakeEnabled);
      if (realProvided) praRealAllowed = Boolean(input.praRealEnabled);
    } else if (input.praEnabled !== undefined) {
      praRealAllowed = Boolean(input.praEnabled);
      if (!input.praEnabled) praFakeAllowed = false;
    }

    const praFakeEnabled = praFakeAllowed ? Boolean(current.praFakeEnabled) : false;
    const praRealEnabled = praRealAllowed ? Boolean(current.praRealEnabled) : false;
    return {
      praFakeAllowed,
      praRealAllowed,
      praFakeEnabled,
      praRealEnabled,
      praEnabled: praFakeEnabled || praRealEnabled,
    };
  }

  private toBusiness(
    row: {
      id: string;
      name: string;
      systemType: string;
      status: string;
      licenceKey: string | null;
      licencePlan: string | null;
      licenceExpiresAt: Date | null;
      enabledModules?: string[] | null;
      fbrAllowed?: boolean;
      praFakeAllowed?: boolean;
      praRealAllowed?: boolean;
      fbrEnabled?: boolean;
      praEnabled?: boolean;
      praFakeEnabled?: boolean;
      praRealEnabled?: boolean;
      createdBy: string | null;
      createdAt: Date;
    },
    extras?: { adminEmail?: string | null; userCount?: number },
  ): Business {
    const expiresAt = row.licenceExpiresAt;
    const now = Date.now();
    const licenceExpired = expiresAt ? expiresAt.getTime() < now : false;
    const licenceDaysLeft = expiresAt
      ? Math.ceil((expiresAt.getTime() - now) / (24 * 60 * 60 * 1000))
      : undefined;
    // Super Admin checkboxes = section visibility (Allowed), with Active soft-backfill.
    const fbrAllowed = Boolean(row.fbrAllowed) || Boolean(row.fbrEnabled);
    const praFakeAllowed = Boolean(row.praFakeAllowed) || Boolean(row.praFakeEnabled);
    const praRealAllowed =
      Boolean(row.praRealAllowed) ||
      Boolean(row.praRealEnabled) ||
      (Boolean(row.praEnabled) && !Boolean(row.praFakeEnabled) && !Boolean(row.praFakeAllowed));
    return {
      id: row.id,
      name: row.name,
      systemType: row.systemType as SystemType,
      status: row.status as Business["status"],
      licenceKey: row.licenceKey,
      licencePlan: row.licencePlan,
      licenceExpiresAt: expiresAt?.toISOString() ?? null,
      enabledModules: row.enabledModules ?? null,
      fbrEnabled: fbrAllowed,
      praEnabled: praFakeAllowed || praRealAllowed,
      praFakeEnabled: praFakeAllowed,
      praRealEnabled: praRealAllowed,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      adminEmail: extras?.adminEmail ?? null,
      userCount: extras?.userCount ?? 0,
      licenceDaysLeft,
      licenceExpired,
    };
  }
}
