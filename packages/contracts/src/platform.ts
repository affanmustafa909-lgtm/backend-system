import { z } from "zod";
import { popsRoleSchema } from "./users";

/**
 * Canonical business system types.
 * New modules (hospital, hotel, …) are added here without changing auth/RBAC core.
 */
export const SYSTEM_TYPES = [
  "restaurant",
  "ice_cream",
  "pharmacy",
  "general_store",
  "grocery",
  "retail",
] as const;

export const systemTypeSchema = z.enum(SYSTEM_TYPES);
export type SystemType = z.infer<typeof systemTypeSchema>;

export const SYSTEM_TYPE_LABELS: Record<SystemType, string> = {
  restaurant: "Restaurant POS",
  ice_cream: "Ice Cream POS",
  pharmacy: "Pharmacy POS",
  general_store: "General Store POS",
  grocery: "Grocery POS",
  retail: "Retail POS",
};

/** Restaurant POS APIs also serve Ice Cream Bar tenants. */
export const RESTAURANT_FAMILY_SYSTEM_TYPES = ["restaurant", "ice_cream"] as const;

export function isRestaurantFamilySystemType(systemType: string | null | undefined): boolean {
  return systemType === "restaurant" || systemType === "ice_cream";
}

export function systemTypeLabel(systemType: string | null | undefined): string {
  if (!systemType) return "—";
  const parsed = systemTypeSchema.safeParse(systemType);
  return parsed.success ? SYSTEM_TYPE_LABELS[parsed.data] : systemType;
}

/** Frontend edition / route IDs use hyphens; DB / JWT use underscores. */
export function systemTypeToFrontendId(systemType: SystemType): string {
  if (systemType === "general_store") return "general-store";
  if (systemType === "ice_cream") return "ice-cream-bar";
  return systemType;
}

export function frontendIdToSystemType(id: string): SystemType | null {
  if (id === "general-store") return "general_store";
  if (id === "ice-cream-bar" || id === "ice-cream") return "ice_cream";
  const parsed = systemTypeSchema.safeParse(id);
  return parsed.success ? parsed.data : null;
}

export const BUSINESS_STATUSES = ["active", "inactive", "suspended", "deleted"] as const;
export const businessStatusSchema = z.enum(BUSINESS_STATUSES);
export type BusinessStatus = z.infer<typeof businessStatusSchema>;

/** Preset subscription plans sold by Super Admin. */
export const LICENCE_PLANS = ["trial_5", "monthly_30", "standard", "demo", "custom"] as const;
export const licencePlanSchema = z.enum(LICENCE_PLANS);
export type LicencePlan = z.infer<typeof licencePlanSchema>;

export const LICENCE_PLAN_LABELS: Record<LicencePlan, string> = {
  trial_5: "5-day trial",
  monthly_30: "Monthly (30 days)",
  standard: "Standard (1 year)",
  demo: "Demo (14 days)",
  custom: "Custom",
};

export type LicencePlanMeta = {
  label: string;
  /** null = operator picks the date */
  days: number | null;
  /** Display-only suggested price in PKR; null = n/a */
  suggestedPkr: number | null;
  blurb: string;
};

/** Operator-facing plan cards for Super Admin create / renew flows. */
export const LICENCE_PLAN_META: Record<LicencePlan, LicencePlanMeta> = {
  trial_5: {
    label: LICENCE_PLAN_LABELS.trial_5,
    days: 5,
    suggestedPkr: 0,
    blurb: "Short trial so the client can try the ERP before paying.",
  },
  monthly_30: {
    label: LICENCE_PLAN_LABELS.monthly_30,
    days: 30,
    suggestedPkr: 15_000,
    blurb: "One month of access. Renew from Licences when it ends.",
  },
  standard: {
    label: LICENCE_PLAN_LABELS.standard,
    days: 365,
    suggestedPkr: 120_000,
    blurb: "Full-year licence for a live client installation.",
  },
  demo: {
    label: LICENCE_PLAN_LABELS.demo,
    days: 14,
    suggestedPkr: 0,
    blurb: "Sales / training demo — not for long-term production use.",
  },
  custom: {
    label: LICENCE_PLAN_LABELS.custom,
    days: null,
    suggestedPkr: null,
    blurb: "Set any expiry date yourself (special deals, lifetime, etc.).",
  },
};

/** Local calendar date `YYYY-MM-DD` for a plan’s default expiry (empty for custom / no days). */
export function defaultExpiryDateForPlan(
  plan: string,
  metaByPlan: Record<string, LicencePlanMeta> = LICENCE_PLAN_META,
): string {
  const meta = metaByPlan[plan] ?? (LICENCE_PLAN_META as Record<string, LicencePlanMeta>)[plan];
  if (!meta?.days) return "";
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + meta.days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function licencePlanLabel(
  plan: string | null | undefined,
  metaByPlan: Record<string, LicencePlanMeta> = LICENCE_PLAN_META,
): string {
  if (!plan) return "—";
  const meta = metaByPlan[plan] ?? (LICENCE_PLAN_META as Record<string, LicencePlanMeta>)[plan];
  if (meta) return meta.label;
  return (LICENCE_PLAN_LABELS as Record<string, string>)[plan] ?? plan;
}

/** Platform settings key for Super Admin–editable plan card copy/prices. */
export const LICENCE_PLAN_META_SETTINGS_KEY = "licence_plan_meta";

const licencePlanMetaRowSchema = z.object({
  label: z.string().min(1).max(80),
  days: z.number().int().min(1).max(3660).nullable(),
  suggestedPkr: z.number().int().min(0).max(100_000_000).nullable(),
  blurb: z.string().max(300),
});

/**
 * Merge built-in defaults with Super Admin overrides from platform settings.
 * Unknown / invalid rows fall back to defaults. Plan ids stay fixed.
 */
export function resolveLicencePlanMeta(
  settingsEntries: Record<string, unknown> | null | undefined,
): Record<LicencePlan, LicencePlanMeta> {
  const raw = settingsEntries?.[LICENCE_PLAN_META_SETTINGS_KEY];
  const overrides: Partial<Record<LicencePlan, LicencePlanMeta>> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const plan of LICENCE_PLANS) {
      const row = (raw as Record<string, unknown>)[plan];
      const parsed = licencePlanMetaRowSchema.safeParse(row);
      if (parsed.success) {
        // Custom plan always keeps null days (operator picks date).
        overrides[plan] =
          plan === "custom"
            ? { ...parsed.data, days: null }
            : parsed.data;
      }
    }
  }
  const out = { ...LICENCE_PLAN_META };
  for (const plan of LICENCE_PLANS) {
    if (overrides[plan]) out[plan] = overrides[plan]!;
  }
  return out;
}

/** Serialize plan meta for `updatePlatformSettings`. */
export function serializeLicencePlanMeta(
  meta: Record<LicencePlan, LicencePlanMeta>,
): Record<LicencePlan, LicencePlanMeta> {
  const out = {} as Record<LicencePlan, LicencePlanMeta>;
  for (const plan of LICENCE_PLANS) {
    const row = meta[plan];
    out[plan] = {
      label: row.label.trim() || LICENCE_PLAN_META[plan].label,
      days: plan === "custom" ? null : row.days,
      suggestedPkr: row.suggestedPkr,
      blurb: row.blurb.trim(),
    };
  }
  return out;
}

export const PLATFORM_ROLES = ["super_admin"] as const;
export const platformRoleSchema = z.enum(PLATFORM_ROLES);
export type PlatformRole = z.infer<typeof platformRoleSchema>;

/** Permissions granted exclusively to the platform Super Admin. */
export const PLATFORM_PERMISSIONS = [
  "*",
  "platform.businesses.manage",
  "platform.licences.manage",
  "platform.settings.manage",
  "platform.users.manage",
  "platform.analytics.read",
  "platform.permissions.manage",
] as const;

export function permissionsForPlatformRole(role: PlatformRole): string[] {
  if (role === "super_admin") return [...PLATFORM_PERMISSIONS];
  return [];
}

export const businessSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  systemType: systemTypeSchema,
  status: businessStatusSchema,
  licenceKey: z.string().nullable(),
  licencePlan: z.string().nullable(),
  licenceExpiresAt: z.string().nullable(),
  /** null = all modules; otherwise Super Admin ceiling. */
  enabledModules: z.array(z.string()).nullable().optional(),
  fbrEnabled: z.boolean().default(false),
  praEnabled: z.boolean().default(false),
  praFakeEnabled: z.boolean().default(false),
  praRealEnabled: z.boolean().default(false),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  adminEmail: z.string().nullable().optional(),
  userCount: z.number().int().nonnegative().optional(),
  /** Days remaining until licenceExpiresAt (negative if expired). */
  licenceDaysLeft: z.number().int().optional(),
  licenceExpired: z.boolean().optional(),
});

export const createBusinessSchema = z.object({
  name: z.string().min(2).max(200),
  systemType: systemTypeSchema,
  adminName: z.string().min(1).max(200),
  adminEmail: z.string().email().max(320),
  adminPassword: z.string().min(8).max(128),
  licenceKey: z.string().min(4).max(128).optional(),
  licencePlan: z.string().min(1).max(64).optional(),
  licenceExpiresAt: z.string().datetime().optional(),
  enabledModules: z.array(z.string()).nullable().optional(),
  fbrEnabled: z.boolean().optional(),
  praEnabled: z.boolean().optional(),
  praFakeEnabled: z.boolean().optional(),
  praRealEnabled: z.boolean().optional(),
});

export const updateBusinessSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  status: businessStatusSchema.optional(),
  licenceKey: z.string().min(4).max(128).nullable().optional(),
  licencePlan: z.string().min(1).max(64).nullable().optional(),
  licenceExpiresAt: z.string().datetime().nullable().optional(),
  enabledModules: z.array(z.string()).nullable().optional(),
  fbrEnabled: z.boolean().optional(),
  praEnabled: z.boolean().optional(),
  praFakeEnabled: z.boolean().optional(),
  praRealEnabled: z.boolean().optional(),
});

export const grantLicenceDaysSchema = z.object({
  days: z.union([z.literal(5), z.literal(30), z.number().int().min(1).max(366)]),
  plan: z.string().min(1).max(64).optional(),
  /** If true, also insert a payment row. */
  recordPayment: z.boolean().optional(),
  amount: z.number().int().nonnegative().optional(),
  currency: z.string().min(1).max(8).optional(),
  paidByLabel: z.string().max(200).optional(),
  note: z.string().max(500).optional(),
});

export const licencePaymentSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  periodDays: z.number().int(),
  amount: z.number().int(),
  currency: z.string(),
  paidByLabel: z.string().nullable(),
  note: z.string().nullable(),
  paidAt: z.string(),
  recordedBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  businessName: z.string().optional(),
});

export const createLicencePaymentSchema = z.object({
  periodDays: z.number().int().min(1).max(366),
  amount: z.number().int().nonnegative().default(0),
  currency: z.string().min(1).max(8).default("PKR"),
  paidByLabel: z.string().max(200).optional(),
  note: z.string().max(500).optional(),
  paidAt: z.string().datetime().optional(),
  /** Also extend licenceExpiresAt by periodDays when true (default true). */
  extendLicence: z.boolean().optional(),
});

export const monthlyLicenceRowSchema = z.object({
  organizationId: z.string().uuid(),
  businessName: z.string(),
  systemType: systemTypeSchema,
  status: businessStatusSchema,
  adminEmail: z.string().nullable(),
  licencePlan: z.string().nullable(),
  licenceExpiresAt: z.string().nullable(),
  licenceDaysLeft: z.number().int().nullable(),
  licenceExpired: z.boolean(),
  paidThisMonth: z.boolean(),
  payment: z
    .object({
      id: z.string().uuid(),
      amount: z.number().int(),
      currency: z.string(),
      periodDays: z.number().int(),
      paidAt: z.string(),
      paidByLabel: z.string().nullable(),
      note: z.string().nullable(),
    })
    .nullable(),
  lastReminderAt: z.string().nullable().optional(),
});

export const monthlyLicenceStatusSchema = z.object({
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  timezone: z.string(),
  periodLabel: z.string(),
  paidCount: z.number().int().nonnegative(),
  unpaidCount: z.number().int().nonnegative(),
  totalCollected: z.number().int().nonnegative(),
  currency: z.string(),
  paid: z.array(monthlyLicenceRowSchema),
  unpaid: z.array(monthlyLicenceRowSchema),
});

export const sendLicenceRemindersSchema = z.object({
  /** month_end = unpaid this month; due = expiry within 5 days / already expired; all = both */
  mode: z.enum(["month_end", "due", "all"]).default("month_end"),
  year: z.number().int().optional(),
  month: z.number().int().min(1).max(12).optional(),
  organizationIds: z.array(z.string().uuid()).optional(),
  /** Skip idempotency and re-send even if already reminded this period. */
  force: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});

export const licenceReminderResultSchema = z.object({
  sent: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  dryRun: z.boolean(),
  results: z.array(
    z.object({
      organizationId: z.string().uuid(),
      businessName: z.string(),
      adminEmail: z.string().nullable(),
      /** sent = in-app admin alert created */
      status: z.enum(["sent", "logged", "skipped", "failed", "dry_run"]),
      reason: z.string().optional(),
    }),
  ),
});

export const orgAlertSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  kind: z.enum(["licence_month_end", "licence_due"]),
  periodKey: z.string(),
  title: z.string(),
  message: z.string(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  dismissedAt: z.string().nullable(),
});

/** Super Admin: wipe all transactional data; keep setup (users, menu, catalogue). */
export const resetBusinessTransactionsSchema = z.object({
  confirmName: z.string().min(1),
});

export const resetBusinessTransactionsResultSchema = z.object({
  ok: z.literal(true),
  businessId: z.string().uuid(),
  businessName: z.string(),
  deletedRows: z.number().int().nonnegative(),
  wipedTables: z.array(z.string()),
});

/** Org Settings: scoped data reset (HR / Restaurant / All). */
export const dataResetScopeSchema = z.enum(["hr", "restaurant", "all"]);
export type DataResetScope = z.infer<typeof dataResetScopeSchema>;

export const orgDataResetSchema = z.object({
  scope: dataResetScopeSchema,
  /** Must match business name (case-insensitive) or the word RESET. */
  confirmText: z.string().min(1),
});

export const orgDataResetResultSchema = z.object({
  ok: z.literal(true),
  scope: dataResetScopeSchema,
  businessName: z.string(),
  deletedRows: z.number().int().nonnegative(),
  wipedTables: z.array(z.string()),
  message: z.string(),
});

export const platformUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  email: z.string(),
  role: z.string(),
  platformRole: platformRoleSchema.nullable(),
  businessId: z.string().uuid().nullable(),
  businessName: z.string().nullable(),
  systemType: systemTypeSchema.nullable(),
  status: z.string(),
  active: z.boolean(),
  createdAt: z.string(),
  /** Plaintext last password set by Super Admin (support recovery). Null if unknown. */
  lastSetPassword: z.string().nullable().optional(),
});

export const resetPlatformUserPasswordSchema = z.object({
  password: z.string().min(8).max(128),
});

export const createPlatformUserSchema = z.object({
  businessId: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  email: z.string().min(3).max(320),
  password: z.string().min(8).max(128),
  role: popsRoleSchema,
  branchScope: z.string().min(1).max(64).default("All"),
  pinRequired: z.boolean().default(false),
  staffPin: z.string().regex(/^\d{4}$/).optional(),
});
export type CreatePlatformUser = z.infer<typeof createPlatformUserSchema>;

export const USER_ACCOUNT_STATUSES = ["active", "inactive", "suspended", "deleted"] as const;
export const userAccountStatusSchema = z.enum(USER_ACCOUNT_STATUSES);
export type UserAccountStatus = z.infer<typeof userAccountStatusSchema>;

/** PATCH can activate / deactivate / suspend — hard soft-delete uses DELETE. */
export const updatePlatformUserSchema = z.object({
  status: z.enum(["active", "inactive", "suspended"]).optional(),
  name: z.string().min(1).max(200).optional(),
});

export const platformSettingsSchema = z.object({
  entries: z.record(z.string(), z.unknown()),
});

export const updatePlatformSettingsSchema = z.object({
  entries: z.record(z.string(), z.unknown()),
});

export const platformPublicInfoSchema = z.object({
  supportEmail: z.string().nullable(),
  maintenanceMessage: z.string().nullable(),
});

export const platformAnalyticsSchema = z.object({
  totalBusinesses: z.number().int().nonnegative(),
  activeBusinesses: z.number().int().nonnegative(),
  suspendedBusinesses: z.number().int().nonnegative(),
  inactiveBusinesses: z.number().int().nonnegative(),
  totalUsers: z.number().int().nonnegative(),
  // Defaults keep older hosted APIs (missing licence rollups) from breaking Overview.
  expiredLicences: z.number().int().nonnegative().default(0),
  expiringSoonLicences: z.number().int().nonnegative().default(0),
  bySystemType: z.array(
    z.object({
      systemType: systemTypeSchema,
      count: z.number().int().nonnegative(),
    }),
  ),
  recentBusinesses: z.array(businessSchema).max(20),
  licenceAlerts: z.array(businessSchema).max(20).default([]),
});

export type Business = z.infer<typeof businessSchema>;
export type CreateBusiness = z.infer<typeof createBusinessSchema>;
export type UpdateBusiness = z.infer<typeof updateBusinessSchema>;
export type GrantLicenceDays = z.infer<typeof grantLicenceDaysSchema>;
export type LicencePayment = z.infer<typeof licencePaymentSchema>;
export type CreateLicencePayment = z.infer<typeof createLicencePaymentSchema>;
export type MonthlyLicenceRow = z.infer<typeof monthlyLicenceRowSchema>;
export type MonthlyLicenceStatus = z.infer<typeof monthlyLicenceStatusSchema>;
export type SendLicenceReminders = z.infer<typeof sendLicenceRemindersSchema>;
export type LicenceReminderResult = z.infer<typeof licenceReminderResultSchema>;
export type OrgAlert = z.infer<typeof orgAlertSchema>;
export type ResetBusinessTransactions = z.infer<typeof resetBusinessTransactionsSchema>;
export type ResetBusinessTransactionsResult = z.infer<
  typeof resetBusinessTransactionsResultSchema
>;
export type OrgDataReset = z.infer<typeof orgDataResetSchema>;
export type OrgDataResetResult = z.infer<typeof orgDataResetResultSchema>;
export type PlatformUser = z.infer<typeof platformUserSchema>;
export type UpdatePlatformUser = z.infer<typeof updatePlatformUserSchema>;
export type PlatformSettings = z.infer<typeof platformSettingsSchema>;
export type UpdatePlatformSettings = z.infer<typeof updatePlatformSettingsSchema>;
export type PlatformPublicInfo = z.infer<typeof platformPublicInfoSchema>;
export type PlatformAnalytics = z.infer<typeof platformAnalyticsSchema>;

/** Org-scoped Super Admin module ceiling (null = all modules allowed). */
export const orgModuleAccessSchema = z.object({
  enabledModules: z.array(z.string()).nullable(),
});
export type OrgModuleAccess = z.infer<typeof orgModuleAccessSchema>;

/** Clamp membership permissions to Super Admin org module ceiling. */
export function applyOrgModuleCeiling(
  permissions: readonly string[],
  enabledModules: readonly string[] | null | undefined,
): string[] {
  if (enabledModules == null) return [...permissions];
  const allowed = new Set(enabledModules);
  allowed.add("pops.read");
  if (permissions.includes("*")) {
    return [...allowed];
  }
  return permissions.filter((p) => allowed.has(p) || p.startsWith("platform."));
}
