import { z } from "zod";

export const taxEnvironmentSchema = z.enum(["sandbox", "production"]);
export type TaxEnvironment = z.infer<typeof taxEnvironmentSchema>;

export const taxConnectionStatusSchema = z.enum([
  "disconnected",
  "connected",
  "error",
  "expired",
]);
export type TaxConnectionStatus = z.infer<typeof taxConnectionStatusSchema>;

export const taxAuthoritySchema = z.enum(["fbr", "pra"]);
export type TaxAuthority = z.infer<typeof taxAuthoritySchema>;

export const taxInvoiceSourceTypeSchema = z.enum(["bill", "store_sale", "pharmacy_sale"]);
export type TaxInvoiceSourceType = z.infer<typeof taxInvoiceSourceTypeSchema>;

export const taxInvoiceStatusSchema = z.enum([
  "pending",
  "queued",
  "submitting",
  "submitted",
  "verified",
  "failed",
  "cancelled",
]);
export type TaxInvoiceStatus = z.infer<typeof taxInvoiceStatusSchema>;

const ntnSchema = z
  .string()
  .trim()
  .transform((v) => {
    const raw = v.replace(/^P/i, "").trim();
    const digitsOnly = raw.replace(/-/g, "");
    if (digitsOnly.length === 13) return digitsOnly;
    return raw;
  })
  .refine(
    (v) => /^\d{7}(-\d)?$|^\d{13}$/.test(v),
    "NTN/PNTN must be 7 digits (optional -check) or 13-digit CNIC",
  );

/** Strict company info (FBR). */
export const taxCompanyInfoSchema = z.object({
  companyName: z.string().trim().min(1, "Company name is required").max(200),
  ntn: ntnSchema,
  strn: z.string().trim().min(1, "STRN is required").max(32),
  businessType: z.string().trim().min(1, "Business type is required").max(100),
  province: z.string().trim().min(1, "Province is required").max(100),
  branchName: z.string().trim().min(1, "Branch name is required").max(200),
  branchCode: z.string().trim().min(1, "Branch code is required").max(64),
});

/** Softer company info for Real PRA (STRN optional per registration). */
export const praCompanyInfoSchema = z.object({
  companyName: z.string().trim().min(1, "Business name is required").max(200),
  ntn: ntnSchema,
  strn: z.string().trim().max(32).optional().default(""),
  businessType: z.string().trim().max(100).optional().default(""),
  province: z.string().trim().min(1, "Province is required").max(100).default("Punjab"),
  branchName: z.string().trim().min(1, "Branch name is required").max(200),
  branchCode: z.string().trim().min(1, "Branch code is required").max(64),
});

export const fbrConnectSchema = z.object({
  branchCode: z.string().trim().min(1),
  company: taxCompanyInfoSchema,
  clientId: z.string().trim().max(200).optional().default(""),
  clientSecret: z.string().trim().min(1, "Client secret / security token is required").max(2000),
  posId: z.string().trim().min(1, "POS ID is required").max(100),
  terminalId: z.string().trim().min(1, "Terminal ID is required").max(100),
  environment: taxEnvironmentSchema.default("sandbox"),
});
export type FbrConnectInput = z.infer<typeof fbrConnectSchema>;

export const praConnectSchema = z.object({
  branchCode: z.string().trim().min(1),
  company: praCompanyInfoSchema,
  /**
   * PRA POS ID from POS Details tab (required for PostData `POSID`).
   * Falls back to registrationNumber when omitted (legacy).
   */
  posId: z.string().trim().max(100).optional().default(""),
  /** Access Code from POS Details (POS dashboard login). */
  accessCode: z.string().trim().max(200).optional().default(""),
  /** Bearer token from POS Details — used as Authorization: Bearer <token>. */
  token: z.string().trim().max(2000).optional().default(""),
  /** Optional PNTN / legacy registration number. */
  registrationNumber: z.string().trim().max(100).optional().default(""),
  /** Optional CNIC / portal username for reference. */
  username: z.string().trim().max(200).optional().default(""),
  /** Optional portal password (not required for PostData API). */
  password: z.string().trim().max(2000).optional().default(""),
  praBranchCode: z.string().trim().max(64).optional().default(""),
  environment: taxEnvironmentSchema.default("sandbox"),
}).superRefine((val, ctx) => {
  const posId = (val.posId || val.registrationNumber || "").trim();
  // Access Code + Token may be blank when the client is keeping previously saved secrets.
  if (!posId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "POS ID is required",
      path: ["posId"],
    });
  }
});
export type PraConnectInput = z.infer<typeof praConnectSchema>;

export const praIntegrationSettingsSchema = z.object({
  autoSubmit: z.boolean().default(true),
  offlineQueue: z.boolean().default(true),
  retryFailed: z.boolean().default(true),
  maxRetryAttempts: z.number().int().min(0).max(20).default(3),
});
export type PraIntegrationSettings = z.infer<typeof praIntegrationSettingsSchema>;

export const updatePraIntegrationSettingsSchema = z.object({
  branchCode: z.string().trim().min(1),
  autoSubmit: z.boolean().optional(),
  offlineQueue: z.boolean().optional(),
  retryFailed: z.boolean().optional(),
  maxRetryAttempts: z.number().int().min(0).max(20).optional(),
});
export type UpdatePraIntegrationSettingsInput = z.infer<typeof updatePraIntegrationSettingsSchema>;

/** Super Admin section grants + Org Admin Active flags for the signed-in business. */
export const taxAuthorityFeaturesSchema = z.object({
  /** Super Admin: show FBR section. */
  fbrAllowed: z.boolean().default(false),
  /** Super Admin: show FPRA section. */
  praFakeAllowed: z.boolean().default(false),
  /** Super Admin: show Real PRA section. */
  praRealAllowed: z.boolean().default(false),
  /** Org Admin Active: FBR on/off. */
  fbrEnabled: z.boolean(),
  /** True when FPRA and/or Real PRA Active (legacy-compatible). */
  praEnabled: z.boolean(),
  /** Org Admin Active: FPRA. */
  praFakeEnabled: z.boolean().default(false),
  /** Org Admin Active: Real PRA. */
  praRealEnabled: z.boolean().default(false),
});
export type TaxAuthorityFeatures = z.infer<typeof taxAuthorityFeaturesSchema>;

export const praInvoiceModeSchema = z.enum(["fake", "real"]);
export type PraInvoiceMode = z.infer<typeof praInvoiceModeSchema>;

export const taxAuthorityStatusSchema = z.object({
  branchCode: z.string(),
  fbrAllowed: z.boolean().default(false),
  praFakeAllowed: z.boolean().default(false),
  praRealAllowed: z.boolean().default(false),
  /** Org Admin Active flags. */
  fbrEnabled: z.boolean().default(false),
  praEnabled: z.boolean().default(false),
  praFakeEnabled: z.boolean().default(false),
  praRealEnabled: z.boolean().default(false),
  company: z.object({
    companyName: z.string().default(""),
    ntn: z.string().default(""),
    strn: z.string().default(""),
    businessType: z.string().default(""),
    province: z.string().default(""),
    branchName: z.string().default(""),
    branchCode: z.string().default(""),
  }),
  fbr: z.object({
    status: taxConnectionStatusSchema,
    environment: taxEnvironmentSchema,
    clientId: z.string().nullable(),
    clientSecretMasked: z.string().nullable(),
    posId: z.string().nullable(),
    terminalId: z.string().nullable(),
    connectedAt: z.string().nullable(),
    tokenExpiresAt: z.string().nullable(),
    lastError: z.string().nullable(),
  }),
  pra: z.object({
    status: taxConnectionStatusSchema,
    environment: taxEnvironmentSchema,
    /** POS ID (PostData POSID). */
    posId: z.string().nullable().optional().default(null),
    registrationNumber: z.string().nullable(),
    username: z.string().nullable(),
    passwordMasked: z.string().nullable(),
    tokenMasked: z.string().nullable().optional().default(null),
    praBranchCode: z.string().nullable(),
    connectedAt: z.string().nullable(),
    tokenExpiresAt: z.string().nullable(),
    lastTokenRefreshAt: z.string().nullable().optional().default(null),
    lastInvoiceSentAt: z.string().nullable().optional().default(null),
    lastError: z.string().nullable(),
    autoSubmit: z.boolean().default(true),
    offlineQueue: z.boolean().default(true),
    retryFailed: z.boolean().default(true),
    maxRetryAttempts: z.number().int().default(3),
  }),
});
export type TaxAuthorityStatus = z.infer<typeof taxAuthorityStatusSchema>;

export const taxConnectResultSchema = z.object({
  authority: taxAuthoritySchema,
  status: taxConnectionStatusSchema,
  connectedAt: z.string().nullable().optional().default(null),
  tokenExpiresAt: z.string().nullable(),
  message: z.string(),
});
export type TaxConnectResult = z.infer<typeof taxConnectResultSchema>;

export const taxInvoiceSchema = z.object({
  id: z.string().uuid(),
  authority: taxAuthoritySchema,
  invoiceMode: praInvoiceModeSchema.default("real"),
  sourceType: taxInvoiceSourceTypeSchema,
  sourceId: z.string().uuid().optional(),
  sourceRef: z.string(),
  status: taxInvoiceStatusSchema,
  taxableAmountPkr: z.number().int(),
  taxAmountPkr: z.number().int(),
  authorityInvoiceNumber: z.string().nullable(),
  qrPayload: z.string().nullable(),
  lastError: z.string().nullable(),
  attemptCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TaxInvoice = z.infer<typeof taxInvoiceSchema>;

/** FPRA or Real PRA fiscal details attached to a sale / bill. */
export const praFiscalInvoiceSchema = z.object({
  mode: praInvoiceModeSchema,
  invoiceNumber: z.string(),
  invoiceId: z.string(),
  qrPayload: z.string(),
  usin: z.string(),
  issuedAt: z.string(),
  sellerName: z.string().default(""),
  ntn: z.string().default(""),
  strn: z.string().default(""),
  branchCode: z.string().default(""),
  sourceRef: z.string().default(""),
  taxableAmountPkr: z.number().int().default(0),
  taxAmountPkr: z.number().int().default(0),
  totalAmountPkr: z.number().int().default(0),
  lines: z
    .array(
      z.object({
        label: z.string(),
        qty: z.number().int(),
        unitPrice: z.number().int(),
      }),
    )
    .default([]),
});
export type PraFiscalInvoice = z.infer<typeof praFiscalInvoiceSchema>;

export const issuePraInvoiceSchema = z.object({
  branchCode: z.string().trim().min(1),
  sourceType: taxInvoiceSourceTypeSchema,
  sourceId: z.string().uuid(),
  mode: praInvoiceModeSchema,
  force: z.boolean().optional().default(false),
});
export type IssuePraInvoiceInput = z.infer<typeof issuePraInvoiceSchema>;

export const issuePraInvoiceResultSchema = z.object({
  invoice: taxInvoiceSchema,
  fiscal: praFiscalInvoiceSchema,
  message: z.string(),
});
export type IssuePraInvoiceResult = z.infer<typeof issuePraInvoiceResultSchema>;

/** Server builds PostData; POS client posts from shop IP (PRA whitelist). */
export const preparePraClientPostSchema = z.object({
  branchCode: z.string().trim().min(1),
  sourceType: taxInvoiceSourceTypeSchema,
  sourceId: z.string().uuid(),
  force: z.boolean().optional().default(false),
});
export type PreparePraClientPostInput = z.infer<typeof preparePraClientPostSchema>;

export const preparePraClientPostResultSchema = z.object({
  invoiceDbId: z.string().uuid(),
  postUrl: z.string(),
  bearerToken: z.string(),
  payload: z.record(z.string(), z.unknown()),
  alreadySubmitted: z.boolean().optional().default(false),
  fiscal: praFiscalInvoiceSchema.optional(),
  invoice: taxInvoiceSchema.optional(),
  message: z.string(),
});
export type PreparePraClientPostResult = z.infer<typeof preparePraClientPostResultSchema>;

export const confirmPraClientPostSchema = z.object({
  branchCode: z.string().trim().min(1),
  invoiceDbId: z.string().uuid(),
  invoiceNumber: z.string().trim().min(1),
  raw: z.unknown().optional(),
});
export type ConfirmPraClientPostInput = z.infer<typeof confirmPraClientPostSchema>;

export const sendTaxInvoiceSchema = z.object({
  branchCode: z.string().trim().min(1),
  sourceType: taxInvoiceSourceTypeSchema,
  sourceId: z.string().uuid(),
  /** When true, force re-submit even if a prior attempt exists. */
  force: z.boolean().optional().default(false),
});
export type SendTaxInvoiceInput = z.infer<typeof sendTaxInvoiceSchema>;

export const sendTaxInvoiceResultSchema = z.object({
  invoice: taxInvoiceSchema,
  message: z.string(),
});
export type SendTaxInvoiceResult = z.infer<typeof sendTaxInvoiceResultSchema>;

export const praDashboardSchema = z.object({
  mode: praInvoiceModeSchema.default("real"),
  todaySubmitted: z.number().int(),
  todayFailed: z.number().int(),
  pendingQueue: z.number().int(),
  todayTaxableTotalPkr: z.number().int().default(0),
  todayTaxTotalPkr: z.number().int().default(0),
  lastSyncAt: z.string().nullable(),
  connectionStatus: taxConnectionStatusSchema,
  lastError: z.string().nullable(),
});
export type PraDashboard = z.infer<typeof praDashboardSchema>;

export const praReportPeriodSchema = z.enum(["daily", "weekly", "monthly", "yearly"]);
export type PraReportPeriod = z.infer<typeof praReportPeriodSchema>;

export const praReportBucketSchema = z.object({
  key: z.string(),
  invoiceCount: z.number().int(),
  submittedCount: z.number().int(),
  failedCount: z.number().int(),
  pendingCount: z.number().int(),
  taxableTotalPkr: z.number().int(),
  taxTotalPkr: z.number().int(),
});
export type PraReportBucket = z.infer<typeof praReportBucketSchema>;

export const praReportsSchema = z.object({
  summary: z.object({
    invoiceCount: z.number().int(),
    submittedCount: z.number().int(),
    failedCount: z.number().int(),
    pendingCount: z.number().int(),
    taxableTotalPkr: z.number().int(),
    taxTotalPkr: z.number().int(),
  }),
  buckets: z.array(praReportBucketSchema),
  filtersEcho: z.object({
    mode: praInvoiceModeSchema,
    period: praReportPeriodSchema,
    from: z.string(),
    to: z.string(),
    status: z.string().nullable().optional(),
  }),
});
export type PraReports = z.infer<typeof praReportsSchema>;

export const taxActivityLogSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string(),
  event: z.string(),
  invoiceNumber: z.string().nullable(),
  praInvoiceNumber: z.string().nullable(),
  status: z.string(),
  errorMessage: z.string().nullable(),
  retryCount: z.number().int(),
});
export type TaxActivityLog = z.infer<typeof taxActivityLogSchema>;

export const retryFailedTaxInvoicesSchema = z.object({
  branchCode: z.string().trim().min(1),
  authority: taxAuthoritySchema.optional().default("pra"),
});
export type RetryFailedTaxInvoicesInput = z.infer<typeof retryFailedTaxInvoicesSchema>;

export const retryFailedTaxInvoicesResultSchema = z.object({
  retried: z.number().int(),
  skipped: z.number().int(),
  message: z.string(),
});
export type RetryFailedTaxInvoicesResult = z.infer<typeof retryFailedTaxInvoicesResultSchema>;
