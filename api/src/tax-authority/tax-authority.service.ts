import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import * as https from "https";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { ZodError } from "zod";
import {
  fbrConnectSchema,
  confirmPraClientPostSchema,
  issuePraInvoiceSchema,
  praConnectSchema,
  preparePraClientPostSchema,
  retryFailedTaxInvoicesSchema,
  sendTaxInvoiceSchema,
  updatePraIntegrationSettingsSchema,
  type ConfirmPraClientPostInput,
  type FbrConnectInput,
  type IssuePraInvoiceInput,
  type IssuePraInvoiceResult,
  type PraConnectInput,
  type PraDashboard,
  type PraFiscalInvoice,
  type PraInvoiceMode,
  type PraReportPeriod,
  type PraReports,
  type PreparePraClientPostInput,
  type PreparePraClientPostResult,
  type TaxActivityLog,
  type TaxAuthorityFeatures,
  type TaxAuthorityStatus,
  type TaxConnectResult,
  type TaxInvoice,
  type TaxInvoiceSourceType,
  type TaxInvoiceStatus,
} from "@platform/contracts";
import {
  popsBills,
  popsBranches,
  pharmacySales,
  storeSales,
  storeSaleLines,
  storeProducts,
  organizations,
  taxAuthorityActivityLogs,
  taxAuthorityInvoices,
  taxAuthorityProfiles,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../drizzle/drizzle.tokens";
import {
  buildBillPraSourceLines,
  parsePraSourceLines,
  withAllocatedStoreLineTaxes,
  type PraSourceLine,
} from "./pra-invoice-lines";

type ProfileRow = typeof taxAuthorityProfiles.$inferSelect;

const FBR_POST_SANDBOX = "https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata_sb";
const FBR_POST_PRODUCTION = "https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata";
const FBR_VALIDATE_SANDBOX = "https://gw.fbr.gov.pk/di_data/v1/di/validateinvoicedata_sb";
const FBR_TOKEN_URL = process.env.FBR_TOKEN_URL?.trim() || "";
const PRA_TOKEN_URL = process.env.PRA_TOKEN_URL?.trim() || "";
const PRA_INVOICE_URL = process.env.PRA_INVOICE_URL?.trim() || "";
/** Official PRAL e-IMS cloud endpoints (POS Component user manual). */
const PRA_DEFAULT_SANDBOX_INVOICE_URL =
  "https://ims.pral.com.pk/ims/sandbox/api/Live/PostData";
const PRA_DEFAULT_PRODUCTION_INVOICE_URL =
  "https://ims.pral.com.pk/ims/production/api/Live/PostData";
const PRA_SANDBOX_TOKEN_URL = process.env.PRA_SANDBOX_TOKEN_URL?.trim() || PRA_TOKEN_URL;
const PRA_SANDBOX_INVOICE_URL =
  process.env.PRA_SANDBOX_INVOICE_URL?.trim() ||
  PRA_INVOICE_URL ||
  PRA_DEFAULT_SANDBOX_INVOICE_URL;
const PRA_PRODUCTION_TOKEN_URL = process.env.PRA_PRODUCTION_TOKEN_URL?.trim() || PRA_TOKEN_URL;
const PRA_PRODUCTION_INVOICE_URL =
  process.env.PRA_PRODUCTION_INVOICE_URL?.trim() ||
  PRA_INVOICE_URL ||
  PRA_DEFAULT_PRODUCTION_INVOICE_URL;
const PRA_SECRET_PREFIX = "enc:v1:";

function resolvePraPosId(input: {
  posId?: string;
  registrationNumber?: string;
  praRegistrationNumber?: string | null;
}): string {
  return (
    input.posId?.trim() ||
    input.registrationNumber?.trim() ||
    input.praRegistrationNumber?.trim() ||
    ""
  );
}

function resolvePraAccessCode(input: { accessCode?: string; password?: string }): string {
  return input.accessCode?.trim() || input.password?.trim() || "";
}

function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  // Encrypted-at-rest access codes — never echo ciphertext; show a stable "saved" mask.
  if (value.startsWith(PRA_SECRET_PREFIX)) return "•••••••• (saved)";
  if (value.length <= 4) return "••••";
  return `${"•".repeat(Math.min(12, value.length - 4))}${value.slice(-4)}`;
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function praReportBucketKey(d: Date, period: PraReportPeriod): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  if (period === "yearly") return String(y);
  if (period === "monthly") return `${y}-${m}`;
  if (period === "weekly") {
    const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  return `${y}-${m}-${day}`;
}

function praSecretKey(): Buffer {
  const material =
    process.env.PRA_CREDENTIALS_SECRET?.trim() ||
    process.env.JWT_ACCESS_SECRET?.trim() ||
    "dev-pra-credentials-secret-change-me";
  return createHash("sha256").update(material).digest();
}

function encryptSecret(plain: string): string {
  if (!plain) return plain;
  if (plain.startsWith(PRA_SECRET_PREFIX)) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", praSecretKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PRA_SECRET_PREFIX}${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!stored.startsWith(PRA_SECRET_PREFIX)) return stored;
  const raw = stored.slice(PRA_SECRET_PREFIX.length);
  const [ivB64, tagB64, dataB64] = raw.split(".");
  if (!ivB64 || !tagB64 || !dataB64) return "";
  const decipher = createDecipheriv("aes-256-gcm", praSecretKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function resolvePraUrls(environment: "sandbox" | "production"): {
  tokenUrl: string;
  invoiceUrl: string;
} {
  if (environment === "production") {
    return { tokenUrl: PRA_PRODUCTION_TOKEN_URL, invoiceUrl: PRA_PRODUCTION_INVOICE_URL };
  }
  return { tokenUrl: PRA_SANDBOX_TOKEN_URL, invoiceUrl: PRA_SANDBOX_INVOICE_URL };
}

function defaultPraSettings(profile?: ProfileRow | null) {
  return {
    autoSubmit: profile?.praAutoSubmit ?? true,
    offlineQueue: profile?.praOfflineQueue ?? true,
    retryFailed: profile?.praRetryFailed ?? true,
    maxRetryAttempts: profile?.praMaxRetryAttempts ?? 3,
  };
}

/** Reliable HTTPS POST to PRA (IPv4) — Nest/undici fetch often fails on Railway egress. */
/** True when PRA is unreachable from this host (e.g. Railway without IP whitelist). */
function isPraNetworkError(message: string): boolean {
  return /fetch failed|network timeout|could not reach|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPROTO|certificate|TLS|socket disconnected|PRA network error|secure TLS|Client network socket|getaddrinfo|EHOSTUNREACH|ENETUNREACH/i.test(
    message,
  );
}

function praHttpPost(
  url: string,
  token: string,
  body: unknown,
  timeoutMs = 25_000,
): Promise<{ status: number; text: string; json: unknown }> {
  const payload = JSON.stringify(body);
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method: "POST",
        family: 4,
        servername: u.hostname,
        timeout: timeoutMs,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Content-Length": Buffer.byteLength(payload),
          Connection: "close",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json: unknown = null;
          try {
            json = JSON.parse(text) as unknown;
          } catch {
            json = { message: text };
          }
          resolve({ status: res.statusCode ?? 0, text, json });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Network Timeout — could not reach PRA PostData endpoint"));
    });
    req.on("error", (err) => {
      reject(new Error(`PRA network error: ${err.message}`));
    });
    req.write(payload);
    req.end();
  });
}

@Injectable()
export class TaxAuthorityService {
  private readonly logger = new Logger(TaxAuthorityService.name);

  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  async getFeatures(organizationId: string): Promise<TaxAuthorityFeatures> {
    const rows = await this.db
      .select({
        fbrAllowed: organizations.fbrAllowed,
        praFakeAllowed: organizations.praFakeAllowed,
        praRealAllowed: organizations.praRealAllowed,
        fbrEnabled: organizations.fbrEnabled,
        praEnabled: organizations.praEnabled,
        praFakeEnabled: organizations.praFakeEnabled,
        praRealEnabled: organizations.praRealEnabled,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    const row = rows[0];
    let praFakeEnabled = Boolean(row?.praFakeEnabled);
    let praRealEnabled = Boolean(row?.praRealEnabled);
    // Legacy: praEnabled alone with both new flags false → treat as real PRA Active.
    if (Boolean(row?.praEnabled) && !praFakeEnabled && !praRealEnabled) {
      praRealEnabled = true;
    }
    // Prefer Real when both flags are set (Pay auto Real; no RPRA button).
    if (praFakeEnabled && praRealEnabled) {
      praFakeEnabled = false;
    }
    // Soft backfill: if Active was on before Allowed columns existed, treat as granted.
    const fbrAllowed = Boolean(row?.fbrAllowed) || Boolean(row?.fbrEnabled);
    const praFakeAllowed = Boolean(row?.praFakeAllowed) || praFakeEnabled;
    const praRealAllowed =
      Boolean(row?.praRealAllowed) || praRealEnabled || Boolean(row?.praEnabled);
    return {
      fbrAllowed,
      praFakeAllowed,
      praRealAllowed,
      fbrEnabled: Boolean(row?.fbrEnabled),
      praFakeEnabled,
      praRealEnabled,
      praEnabled: praFakeEnabled || praRealEnabled,
    };
  }

  /** Org Admin: Active/Inactive only. Super Admin decides which sections are Allowed. */
  async setFeatures(
    organizationId: string,
    patch: {
      praEnabled?: boolean;
      praFakeEnabled?: boolean;
      praRealEnabled?: boolean;
      fbrEnabled?: boolean;
    },
  ): Promise<TaxAuthorityFeatures> {
    if (
      patch.praEnabled === undefined &&
      patch.praFakeEnabled === undefined &&
      patch.praRealEnabled === undefined &&
      patch.fbrEnabled === undefined
    ) {
      throw new BadRequestException(
        "Provide praEnabled, praFakeEnabled, praRealEnabled, and/or fbrEnabled",
      );
    }

    const current = await this.getFeatures(organizationId);

    if (typeof patch.fbrEnabled === "boolean" && patch.fbrEnabled && !current.fbrAllowed) {
      throw new ForbiddenException(
        "FBR section is not available for this business. Ask the platform Super Admin to show it.",
      );
    }
    if (patch.praFakeEnabled === true && !current.praFakeAllowed) {
      throw new ForbiddenException(
        "FPRA section is not available for this business. Ask the platform Super Admin to show it.",
      );
    }
    if (patch.praRealEnabled === true && !current.praRealAllowed) {
      throw new ForbiddenException(
        "Real PRA section is not available for this business. Ask the platform Super Admin to show it.",
      );
    }
    if (
      patch.praEnabled === true &&
      !current.praFakeAllowed &&
      !current.praRealAllowed
    ) {
      throw new ForbiddenException(
        "PRA section is not available for this business. Ask the platform Super Admin to show it.",
      );
    }

    const update: Partial<{
      praEnabled: boolean;
      praFakeEnabled: boolean;
      praRealEnabled: boolean;
      fbrEnabled: boolean;
    }> = {};

    if (typeof patch.fbrEnabled === "boolean") update.fbrEnabled = patch.fbrEnabled;

    const fakeProvided = typeof patch.praFakeEnabled === "boolean";
    const realProvided = typeof patch.praRealEnabled === "boolean";
    if (fakeProvided || realProvided) {
      let praFakeEnabled = fakeProvided ? patch.praFakeEnabled! : current.praFakeEnabled;
      let praRealEnabled = realProvided ? patch.praRealEnabled! : current.praRealEnabled;
      if (fakeProvided && realProvided && patch.praFakeEnabled && patch.praRealEnabled) {
        praFakeEnabled = false;
        praRealEnabled = true;
      } else if (fakeProvided && patch.praFakeEnabled) {
        praRealEnabled = false;
      } else if (realProvided && patch.praRealEnabled) {
        praFakeEnabled = false;
      } else if (praFakeEnabled && praRealEnabled) {
        praFakeEnabled = false;
      }
      update.praFakeEnabled = praFakeEnabled;
      update.praRealEnabled = praRealEnabled;
      update.praEnabled = praFakeEnabled || praRealEnabled;
    } else if (typeof patch.praEnabled === "boolean") {
      update.praEnabled = patch.praEnabled;
      update.praFakeEnabled = false;
      update.praRealEnabled = patch.praEnabled;
    }

    const updated = await this.db
      .update(organizations)
      .set(update)
      .where(eq(organizations.id, organizationId))
      .returning({
        fbrEnabled: organizations.fbrEnabled,
        praEnabled: organizations.praEnabled,
        praFakeEnabled: organizations.praFakeEnabled,
        praRealEnabled: organizations.praRealEnabled,
      });
    const row = updated[0];
    if (!row) throw new NotFoundException("Organization not found");
    const features = await this.getFeatures(organizationId);
    this.logger.log(
      `Tax Active updated for org ${organizationId}: FBR=${features.fbrEnabled} PRA=${features.praEnabled} fake=${features.praFakeEnabled} real=${features.praRealEnabled}`,
    );
    return features;
  }

  async getStatus(organizationId: string, branchCode: string): Promise<TaxAuthorityStatus> {
    const features = await this.getFeatures(organizationId);
    const branch = await this.resolveBranch(organizationId, branchCode);
    const profile = await this.getProfile(organizationId, branch.id);

    if (!profile) {
      return {
        branchCode: branch.code,
        fbrAllowed: features.fbrAllowed,
        praFakeAllowed: features.praFakeAllowed,
        praRealAllowed: features.praRealAllowed,
        fbrEnabled: features.fbrEnabled,
        praEnabled: features.praEnabled,
        praFakeEnabled: features.praFakeEnabled,
        praRealEnabled: features.praRealEnabled,
        company: {
          companyName: "",
          ntn: "",
          strn: "",
          businessType: "",
          province: "",
          branchName: branch.name,
          branchCode: branch.code,
        },
        fbr: {
          status: "disconnected",
          environment: "sandbox",
          clientId: null,
          clientSecretMasked: null,
          posId: null,
          terminalId: null,
          connectedAt: null,
          tokenExpiresAt: null,
          lastError: null,
        },
        pra: {
          status: "disconnected",
          environment: "sandbox",
          posId: null,
          registrationNumber: null,
          username: null,
          passwordMasked: null,
          tokenMasked: null,
          praBranchCode: null,
          connectedAt: null,
          tokenExpiresAt: null,
          lastTokenRefreshAt: null,
          lastInvoiceSentAt: null,
          lastError: null,
          autoSubmit: true,
          offlineQueue: true,
          retryFailed: true,
          maxRetryAttempts: 3,
        },
      };
    }

    const settings = defaultPraSettings(profile);
    return {
      branchCode: branch.code,
      fbrAllowed: features.fbrAllowed,
      praFakeAllowed: features.praFakeAllowed,
      praRealAllowed: features.praRealAllowed,
      fbrEnabled: features.fbrEnabled,
      praEnabled: features.praEnabled,
      praFakeEnabled: features.praFakeEnabled,
      praRealEnabled: features.praRealEnabled,
      company: {
        companyName: profile.companyName,
        ntn: profile.ntn,
        strn: profile.strn,
        businessType: profile.businessType,
        province: profile.province,
        branchName: profile.branchName || branch.name,
        branchCode: profile.branchCode || branch.code,
      },
      fbr: {
        status: this.normalizeStatus(profile.fbrStatus, profile.fbrTokenExpiresAt),
        environment: profile.fbrEnvironment === "production" ? "production" : "sandbox",
        clientId: profile.fbrClientId,
        clientSecretMasked: maskSecret(profile.fbrClientSecret),
        posId: profile.fbrPosId,
        terminalId: profile.fbrTerminalId,
        connectedAt: iso(profile.fbrConnectedAt),
        tokenExpiresAt: iso(profile.fbrTokenExpiresAt),
        lastError: profile.fbrLastError,
      },
      pra: {
        status: this.normalizeStatus(profile.praStatus, profile.praTokenExpiresAt),
        environment: profile.praEnvironment === "production" ? "production" : "sandbox",
        posId: profile.praRegistrationNumber,
        registrationNumber: profile.praRegistrationNumber,
        username: profile.praUsername,
        passwordMasked: maskSecret(profile.praPassword),
        tokenMasked: maskSecret(profile.praAccessToken),
        praBranchCode: profile.praBranchCode,
        connectedAt: iso(profile.praConnectedAt),
        tokenExpiresAt: iso(profile.praTokenExpiresAt),
        lastTokenRefreshAt: iso(profile.praLastTokenRefreshAt),
        lastInvoiceSentAt: iso(profile.praLastInvoiceSentAt),
        lastError: profile.praLastError,
        autoSubmit: settings.autoSubmit,
        offlineQueue: settings.offlineQueue,
        retryFailed: settings.retryFailed,
        maxRetryAttempts: settings.maxRetryAttempts,
      },
    };
  }

  async connectFbr(organizationId: string, body: unknown): Promise<TaxConnectResult> {
    await this.assertOrgTaxEnabled(organizationId, "fbr");
    const input = this.parseOrThrow(fbrConnectSchema, body);
    this.assertRequiredConnectFields(input.company, input.clientSecret, input.posId, input.terminalId);

    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const now = new Date();

    let accessToken = input.clientSecret.trim();
    let expiresAt = new Date(now.getTime() + 5 * 365 * 24 * 60 * 60 * 1000);

    try {
      const oauth = await this.fetchFbrOauthToken(input);
      if (oauth) {
        accessToken = oauth.accessToken;
        expiresAt = oauth.expiresAt;
      } else {
        await this.pingFbrToken(accessToken, input.environment);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.upsertProfile(organizationId, branch, input, null, {
        fbrStatus: "error",
        fbrLastError: message,
        fbrAccessToken: null,
        fbrTokenExpiresAt: null,
        fbrConnectedAt: null,
      });
      throw new BadRequestException(message);
    }

    const profile = await this.upsertProfile(organizationId, branch, input, null, {
      fbrClientId: input.clientId || null,
      fbrClientSecret: input.clientSecret,
      fbrPosId: input.posId,
      fbrTerminalId: input.terminalId,
      fbrEnvironment: input.environment,
      fbrStatus: "connected",
      fbrAccessToken: accessToken,
      fbrTokenExpiresAt: expiresAt,
      fbrConnectedAt: now,
      fbrLastError: null,
    });

    return {
      authority: "fbr",
      status: "connected",
      connectedAt: iso(profile.fbrConnectedAt)!,
      tokenExpiresAt: iso(profile.fbrTokenExpiresAt),
      message: "Connected Successfully",
    };
  }

  async connectPra(organizationId: string, body: unknown): Promise<TaxConnectResult> {
    await this.assertOrgTaxEnabled(organizationId, "pra");
    const input = this.parseOrThrow(praConnectSchema, body);
    if (!input.company.companyName?.trim() || !input.company.ntn?.trim()) {
      throw new BadRequestException("Please complete all required fields.");
    }

    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const existing = await this.getProfile(organizationId, branch.id);

    const posId =
      resolvePraPosId(input) ||
      existing?.praRegistrationNumber?.trim() ||
      "";
    let accessCode = resolvePraAccessCode(input);
    let bearerToken = input.token.trim();

    // Empty secret fields mean "keep what is already saved" (UI clears them after connect).
    if (!accessCode && existing?.praPassword) {
      accessCode = decryptSecret(existing.praPassword);
    }
    if (!bearerToken && existing?.praAccessToken) {
      bearerToken = existing.praAccessToken.trim();
    }

    if (!posId || !accessCode || !bearerToken) {
      throw new BadRequestException(
        "POS ID, Access Code, and Bearer Token are required (or leave secrets blank to keep saved values).",
      );
    }

    const now = new Date();
    // PRA issues long-lived bearer tokens from the POS Details screen (no OAuth URL).
    const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

    try {
      await this.pingPraBearerToken(bearerToken, input.environment, Number(posId) || 0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!isPraNetworkError(message)) {
        // Keep previously saved credentials — do not wipe token/access code on a bad ping.
        await this.upsertProfile(organizationId, branch, null, input, {
          praStatus: "error",
          praLastError: message,
        });
        await this.writeActivityLog({
          organizationId,
          branchId: branch.id,
          event: "connect",
          status: "error",
          errorMessage: message,
        });
        throw new BadRequestException(this.friendlyPraError(err));
      }
      // Railway / cloud hosts often cannot reach PRA until the egress IP is whitelisted.
      // Still store POS credentials; POS client posts PostData from the shop IP.
      this.logger.warn(
        `PRA live ping skipped (network): ${message}. Storing credentials for POS ID ${posId}.`,
      );
    }

    const profile = await this.upsertProfile(organizationId, branch, null, input, {
      praRegistrationNumber: posId,
      praUsername: input.username || input.company.ntn || null,
      praPassword: encryptSecret(accessCode),
      praBranchCode: input.praBranchCode || null,
      praEnvironment: input.environment,
      praStatus: "connected",
      praAccessToken: bearerToken,
      praTokenExpiresAt: expiresAt,
      praConnectedAt: now,
      praLastTokenRefreshAt: now,
      praLastError: null,
    });

    await this.writeActivityLog({
      organizationId,
      branchId: branch.id,
      event: "connect",
      status: "connected",
    });

    return {
      authority: "pra",
      status: "connected",
      connectedAt: iso(profile.praConnectedAt)!,
      tokenExpiresAt: iso(profile.praTokenExpiresAt),
      message:
        "Connection Successful. Credentials saved. Leave Access Code / Token blank next time to keep them. Pay submits PRA from this POS.",
    };
  }

  async testPraConnection(organizationId: string, body: unknown): Promise<TaxConnectResult> {
    await this.assertOrgTaxEnabled(organizationId, "pra");
    const input = this.parseOrThrow(praConnectSchema, body);
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const existing = await this.getProfile(organizationId, branch.id);
    const posId =
      resolvePraPosId(input) || existing?.praRegistrationNumber?.trim() || "";
    let accessCode = resolvePraAccessCode(input);
    let bearerToken = input.token.trim();
    if (!accessCode && existing?.praPassword) accessCode = decryptSecret(existing.praPassword);
    if (!bearerToken && existing?.praAccessToken) bearerToken = existing.praAccessToken.trim();
    if (!posId || !accessCode || !bearerToken) {
      throw new BadRequestException(
        "POS ID, Access Code, and Bearer Token are required (or leave secrets blank to keep saved values).",
      );
    }
    try {
      await this.pingPraBearerToken(bearerToken, input.environment, Number(posId) || 0);
      const now = new Date();
      await this.writeActivityLog({
        organizationId,
        branchId: branch.id,
        event: "test_connection",
        status: "connected",
      });
      return {
        authority: "pra",
        status: "connected",
        connectedAt: now.toISOString(),
        tokenExpiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        message: "Connection Successful — PRA accepted the Bearer Token",
      };
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const message = this.friendlyPraError(err);
      if (isPraNetworkError(message) || isPraNetworkError(raw)) {
        // Expected on Railway — credentials are fine; POS Pay posts from shop IP.
        const now = new Date();
        if (existing) {
          await this.db
            .update(taxAuthorityProfiles)
            .set({
              praStatus: "connected",
              praLastError: null,
              praLastTokenRefreshAt: now,
              updatedAt: now,
            })
            .where(eq(taxAuthorityProfiles.id, existing.id));
        }
        await this.writeActivityLog({
          organizationId,
          branchId: branch.id,
          event: "test_connection",
          status: "connected",
          errorMessage: null,
        });
        return {
          authority: "pra",
          status: "connected",
          connectedAt: now.toISOString(),
          tokenExpiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          message:
            "Credentials OK. Cloud cannot reach PRA (normal) — invoices submit from this POS on Pay.",
        };
      }
      await this.writeActivityLog({
        organizationId,
        branchId: branch.id,
        event: "test_connection",
        status: "error",
        errorMessage: message,
      });
      throw new BadRequestException(message);
    }
  }

  /** Credentials + ping payload so the POS browser can live-test PRA from the shop IP. */
  async preparePraClientTest(
    organizationId: string,
    branchCode: string,
  ): Promise<{
    postUrl: string;
    bearerToken: string;
    payload: Record<string, unknown>;
    message: string;
  }> {
    await this.assertOrgTaxEnabled(organizationId, "pra");
    const branch = await this.resolveBranch(organizationId, branchCode.trim());
    const profile = await this.requireProfile(organizationId, branch.id);
    const token = profile.praAccessToken?.trim();
    if (!token) {
      throw new BadRequestException("Connect PRA first (Bearer Token missing).");
    }
    const env = profile.praEnvironment === "production" ? "production" : "sandbox";
    const { invoiceUrl } = resolvePraUrls(env);
    if (!invoiceUrl) {
      throw new BadRequestException("PRA invoice URL is not configured.");
    }
    return {
      postUrl: invoiceUrl,
      bearerToken: token,
      payload: {
        InvoiceNumber: "",
        POSID: 0,
        USIN: `PING-${Date.now()}`,
        DateTime: new Date().toISOString().replace("T", " ").slice(0, 19),
        BuyerPNTN: "",
        BuyerCNIC: "",
        BuyerName: "Connection Test",
        BuyerPhoneNumber: "",
        TotalBillAmount: 0,
        TotalQuantity: 0,
        TotalSaleValue: 0,
        TotalTaxCharged: 0,
        Discount: 0,
        FurtherTax: 0,
        PaymentMode: 1,
        RefUSIN: null,
        InvoiceType: 1,
        Items: [],
      },
      message: "Post this ping from the POS machine to verify shop IP reachability.",
    };
  }

  async disconnectPra(organizationId: string, branchCode: string): Promise<TaxConnectResult> {
    await this.assertOrgTaxEnabled(organizationId, "pra");
    const branch = await this.resolveBranch(organizationId, branchCode);
    const profile = await this.getProfile(organizationId, branch.id);
    if (!profile) {
      return {
        authority: "pra",
        status: "disconnected",
        connectedAt: null,
        tokenExpiresAt: null,
        message: "Not Connected",
      };
    }
    await this.db
      .update(taxAuthorityProfiles)
      .set({
        praStatus: "disconnected",
        praAccessToken: null,
        praTokenExpiresAt: null,
        praConnectedAt: null,
        praLastError: null,
        updatedAt: new Date(),
      })
      .where(eq(taxAuthorityProfiles.id, profile.id));

    await this.writeActivityLog({
      organizationId,
      branchId: branch.id,
      event: "disconnect",
      status: "disconnected",
    });

    return {
      authority: "pra",
      status: "disconnected",
      connectedAt: null,
      tokenExpiresAt: null,
      message: "Disconnected — invoices stay local until reconnected",
    };
  }

  async updatePraSettings(organizationId: string, body: unknown) {
    await this.assertOrgTaxEnabled(organizationId, "pra");
    const input = this.parseOrThrow(updatePraIntegrationSettingsSchema, body);
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const patch: Partial<ProfileRow> = {};
    if (typeof input.autoSubmit === "boolean") patch.praAutoSubmit = input.autoSubmit;
    if (typeof input.offlineQueue === "boolean") patch.praOfflineQueue = input.offlineQueue;
    if (typeof input.retryFailed === "boolean") patch.praRetryFailed = input.retryFailed;
    if (typeof input.maxRetryAttempts === "number") {
      patch.praMaxRetryAttempts = input.maxRetryAttempts;
    }
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException("No settings to update");
    }
    const profile = await this.upsertProfile(organizationId, branch, null, null, patch);
    return defaultPraSettings(profile);
  }

  async getPraDashboard(
    organizationId: string,
    branchCode: string,
    mode: PraInvoiceMode = "real",
  ): Promise<PraDashboard> {
    const invoiceMode: PraInvoiceMode = mode === "fake" ? "fake" : "real";
    const branch = await this.resolveBranch(organizationId, branchCode);
    const profile = await this.getProfile(organizationId, branch.id);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const rows = await this.db
      .select({
        status: taxAuthorityInvoices.status,
        updatedAt: taxAuthorityInvoices.updatedAt,
        taxableAmountPkr: taxAuthorityInvoices.taxableAmountPkr,
        taxAmountPkr: taxAuthorityInvoices.taxAmountPkr,
      })
      .from(taxAuthorityInvoices)
      .where(
        and(
          eq(taxAuthorityInvoices.organizationId, organizationId),
          eq(taxAuthorityInvoices.branchId, branch.id),
          eq(taxAuthorityInvoices.authority, "pra"),
          eq(taxAuthorityInvoices.invoiceMode, invoiceMode),
        ),
      )
      .orderBy(desc(taxAuthorityInvoices.updatedAt))
      .limit(500);

    let todaySubmitted = 0;
    let todayFailed = 0;
    let pendingQueue = 0;
    let todayTaxableTotalPkr = 0;
    let todayTaxTotalPkr = 0;
    let lastSyncAt: string | null =
      invoiceMode === "real" ? (iso(profile?.praLastInvoiceSentAt) ?? null) : null;

    for (const row of rows) {
      if (!lastSyncAt && (row.status === "submitted" || row.status === "verified")) {
        lastSyncAt = iso(row.updatedAt);
      }
      const isToday = row.updatedAt.getTime() >= startOfDay.getTime();
      if (isToday && (row.status === "submitted" || row.status === "verified")) {
        todaySubmitted += 1;
        todayTaxableTotalPkr += Number(row.taxableAmountPkr ?? 0);
        todayTaxTotalPkr += Number(row.taxAmountPkr ?? 0);
      }
      if (isToday && row.status === "failed") todayFailed += 1;
      if (
        row.status === "pending" ||
        row.status === "queued" ||
        row.status === "submitting"
      ) {
        pendingQueue += 1;
      }
    }

    return {
      mode: invoiceMode,
      todaySubmitted,
      todayFailed,
      pendingQueue,
      todayTaxableTotalPkr,
      todayTaxTotalPkr,
      lastSyncAt,
      connectionStatus:
        invoiceMode === "fake"
          ? "connected"
          : this.normalizeStatus(
              profile?.praStatus ?? "disconnected",
              profile?.praTokenExpiresAt ?? null,
            ),
      lastError: invoiceMode === "fake" ? null : (profile?.praLastError ?? null),
    };
  }

  async getPraReports(
    organizationId: string,
    opts: {
      branchCode: string;
      mode?: string;
      period?: string;
      from?: string;
      to?: string;
      status?: string;
    },
  ): Promise<PraReports> {
    const branch = await this.resolveBranch(organizationId, opts.branchCode);
    const mode: PraInvoiceMode = opts.mode === "fake" ? "fake" : "real";
    const period: PraReportPeriod =
      opts.period === "weekly" || opts.period === "monthly" || opts.period === "yearly"
        ? opts.period
        : "daily";

    const now = new Date();
    let from = opts.from ? new Date(opts.from) : new Date(now);
    let to = opts.to ? new Date(opts.to) : new Date(now);
    if (Number.isNaN(from.getTime())) from = new Date(now);
    if (Number.isNaN(to.getTime())) to = new Date(now);

    if (!opts.from || !opts.to) {
      if (period === "daily") {
        from = new Date(now);
        from.setDate(from.getDate() - 13);
        from.setHours(0, 0, 0, 0);
        to = new Date(now);
        to.setHours(23, 59, 59, 999);
      } else if (period === "weekly") {
        from = new Date(now);
        from.setDate(from.getDate() - 7 * 11);
        from.setHours(0, 0, 0, 0);
        to = new Date(now);
        to.setHours(23, 59, 59, 999);
      } else if (period === "monthly") {
        from = new Date(now.getFullYear(), now.getMonth() - 11, 1);
        to = new Date(now);
        to.setHours(23, 59, 59, 999);
      } else {
        from = new Date(now.getFullYear() - 4, 0, 1);
        to = new Date(now);
        to.setHours(23, 59, 59, 999);
      }
    } else {
      from.setHours(0, 0, 0, 0);
      to.setHours(23, 59, 59, 999);
    }

    const statusFilter = opts.status?.trim() || null;
    const conditions = [
      eq(taxAuthorityInvoices.organizationId, organizationId),
      eq(taxAuthorityInvoices.branchId, branch.id),
      eq(taxAuthorityInvoices.authority, "pra"),
      eq(taxAuthorityInvoices.invoiceMode, mode),
      gte(taxAuthorityInvoices.createdAt, from),
      lte(taxAuthorityInvoices.createdAt, to),
    ];
    if (statusFilter && statusFilter !== "all") {
      if (statusFilter === "submitted") {
        conditions.push(
          inArray(taxAuthorityInvoices.status, ["submitted", "verified"]),
        );
      } else if (statusFilter === "pending") {
        conditions.push(
          inArray(taxAuthorityInvoices.status, ["pending", "queued", "submitting"]),
        );
      } else if (statusFilter === "failed") {
        conditions.push(eq(taxAuthorityInvoices.status, "failed"));
      } else {
        conditions.push(eq(taxAuthorityInvoices.status, statusFilter));
      }
    }

    const rows = await this.db
      .select({
        status: taxAuthorityInvoices.status,
        taxableAmountPkr: taxAuthorityInvoices.taxableAmountPkr,
        taxAmountPkr: taxAuthorityInvoices.taxAmountPkr,
        createdAt: taxAuthorityInvoices.createdAt,
      })
      .from(taxAuthorityInvoices)
      .where(and(...conditions))
      .orderBy(desc(taxAuthorityInvoices.createdAt))
      .limit(20_000);

    type Acc = {
      invoiceCount: number;
      submittedCount: number;
      failedCount: number;
      pendingCount: number;
      taxableTotalPkr: number;
      taxTotalPkr: number;
    };
    const empty = (): Acc => ({
      invoiceCount: 0,
      submittedCount: 0,
      failedCount: 0,
      pendingCount: 0,
      taxableTotalPkr: 0,
      taxTotalPkr: 0,
    });
    const bump = (acc: Acc, row: (typeof rows)[number]) => {
      acc.invoiceCount += 1;
      acc.taxableTotalPkr += Number(row.taxableAmountPkr ?? 0);
      acc.taxTotalPkr += Number(row.taxAmountPkr ?? 0);
      if (row.status === "submitted" || row.status === "verified") acc.submittedCount += 1;
      else if (row.status === "failed") acc.failedCount += 1;
      else if (
        row.status === "pending" ||
        row.status === "queued" ||
        row.status === "submitting"
      ) {
        acc.pendingCount += 1;
      }
    };

    const summary = empty();
    const map = new Map<string, Acc>();
    for (const row of rows) {
      bump(summary, row);
      const key = praReportBucketKey(row.createdAt, period);
      const bucket = map.get(key) ?? empty();
      bump(bucket, row);
      map.set(key, bucket);
    }

    const buckets = [...map.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.key.localeCompare(a.key));

    return {
      summary,
      buckets,
      filtersEcho: {
        mode,
        period,
        from: from.toISOString(),
        to: to.toISOString(),
        status: statusFilter,
      },
    };
  }

  async listActivityLogs(
    organizationId: string,
    branchCode: string,
    limit = 50,
  ): Promise<TaxActivityLog[]> {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(taxAuthorityActivityLogs)
      .where(
        and(
          eq(taxAuthorityActivityLogs.organizationId, organizationId),
          eq(taxAuthorityActivityLogs.authority, "pra"),
          eq(taxAuthorityActivityLogs.branchId, branch.id),
        ),
      )
      .orderBy(desc(taxAuthorityActivityLogs.createdAt))
      .limit(Math.min(200, Math.max(1, limit)));

    return rows.reduce<TaxActivityLog[]>((acc, r) => {
      // One row per bill/invoice ref (latest first) — hide retry spam.
      if (r.invoiceNumber) {
        if (acc.some((x) => x.invoiceNumber === r.invoiceNumber)) return acc;
      }
      acc.push({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        event: r.event,
        invoiceNumber: r.invoiceNumber,
        praInvoiceNumber: r.praInvoiceNumber,
        status: r.status,
        errorMessage: r.errorMessage,
        retryCount: r.retryCount,
      });
      return acc;
    }, []);
  }

  async retryFailedInvoices(organizationId: string, body: unknown) {
    await this.assertOrgTaxEnabled(organizationId, "pra");
    const input = this.parseOrThrow(retryFailedTaxInvoicesSchema, body);
    const authority = input.authority ?? "pra";
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const profile = await this.requireProfile(organizationId, branch.id);
    const settings = defaultPraSettings(profile);

    const failed = await this.db
      .select()
      .from(taxAuthorityInvoices)
      .where(
        and(
          eq(taxAuthorityInvoices.organizationId, organizationId),
          eq(taxAuthorityInvoices.branchId, branch.id),
          eq(taxAuthorityInvoices.authority, authority),
          eq(taxAuthorityInvoices.invoiceMode, "real"),
          inArray(taxAuthorityInvoices.status, ["failed", "queued", "pending"]),
        ),
      )
      .orderBy(desc(taxAuthorityInvoices.updatedAt))
      .limit(50);

    // Real PRA PostData must run from the POS (whitelisted shop IP), not Railway.
    if (authority === "pra") {
      return {
        retried: 0,
        skipped: failed.length,
        message:
          failed.length === 0
            ? "No pending PRA invoices"
            : `Skipped ${failed.length} invoice(s): PRA submits from POS Pay (cloud cannot reach e-IMS). Open the bill and Pay/reprint with Real PRA.`,
      };
    }

    let retried = 0;
    let skipped = 0;
    for (const row of failed) {
      if (row.attemptCount >= settings.maxRetryAttempts) {
        skipped += 1;
        continue;
      }
      try {
        await this.sendInvoice(organizationId, authority, {
          branchCode: input.branchCode,
          sourceType: row.sourceType,
          sourceId: row.sourceId,
          force: true,
        });
        retried += 1;
      } catch {
        skipped += 1;
      }
    }

    return {
      retried,
      skipped,
      message: `Retried ${retried} invoice(s); skipped ${skipped}`,
    };
  }

  async refreshFbrToken(organizationId: string, branchCode: string): Promise<TaxConnectResult> {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const profile = await this.requireProfile(organizationId, branch.id);
    if (!profile.fbrClientSecret) {
      throw new BadRequestException("FBR is not configured. Please complete all required fields.");
    }

    const input: FbrConnectInput = {
      branchCode: branch.code,
      company: {
        companyName: profile.companyName,
        ntn: profile.ntn,
        strn: profile.strn,
        businessType: profile.businessType,
        province: profile.province,
        branchName: profile.branchName,
        branchCode: profile.branchCode,
      },
      clientId: profile.fbrClientId ?? "",
      clientSecret: profile.fbrClientSecret,
      posId: profile.fbrPosId ?? "",
      terminalId: profile.fbrTerminalId ?? "",
      environment: profile.fbrEnvironment === "production" ? "production" : "sandbox",
    };

    return this.connectFbr(organizationId, input);
  }

  async refreshPraToken(organizationId: string, branchCode: string): Promise<TaxConnectResult> {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const profile = await this.requireProfile(organizationId, branch.id);
    if (!profile.praAccessToken || !profile.praRegistrationNumber || !profile.praPassword) {
      throw new BadRequestException(
        "PRA is not configured. Enter POS ID, Access Code, and Bearer Token, then Connect.",
      );
    }

    const input: PraConnectInput = {
      branchCode: branch.code,
      company: {
        companyName: profile.companyName,
        ntn: profile.ntn,
        strn: profile.strn,
        businessType: profile.businessType,
        province: profile.province || "Punjab",
        branchName: profile.branchName,
        branchCode: profile.branchCode,
      },
      posId: profile.praRegistrationNumber,
      accessCode: decryptSecret(profile.praPassword),
      token: profile.praAccessToken,
      registrationNumber: profile.praRegistrationNumber ?? "",
      username: profile.praUsername ?? "",
      password: decryptSecret(profile.praPassword),
      praBranchCode: profile.praBranchCode ?? "",
      environment: profile.praEnvironment === "production" ? "production" : "sandbox",
    };

    return this.connectPra(organizationId, input);
  }

  async listInvoices(
    organizationId: string,
    branchCode: string,
    authority?: "fbr" | "pra",
    filters?: {
      invoiceMode?: string;
      status?: string;
      from?: string;
      to?: string;
      limit?: number;
    },
  ) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const conditions = [
      eq(taxAuthorityInvoices.organizationId, organizationId),
      eq(taxAuthorityInvoices.branchId, branch.id),
      ...(authority ? [eq(taxAuthorityInvoices.authority, authority)] : []),
    ];
    if (filters?.invoiceMode === "fake" || filters?.invoiceMode === "real") {
      conditions.push(eq(taxAuthorityInvoices.invoiceMode, filters.invoiceMode));
    }
    if (filters?.status && filters.status !== "all") {
      if (filters.status === "submitted") {
        conditions.push(inArray(taxAuthorityInvoices.status, ["submitted", "verified"]));
      } else if (filters.status === "pending") {
        conditions.push(
          inArray(taxAuthorityInvoices.status, ["pending", "queued", "submitting"]),
        );
      } else {
        conditions.push(eq(taxAuthorityInvoices.status, filters.status));
      }
    }
    if (filters?.from) {
      const from = new Date(filters.from);
      if (!Number.isNaN(from.getTime())) {
        from.setHours(0, 0, 0, 0);
        conditions.push(gte(taxAuthorityInvoices.createdAt, from));
      }
    }
    if (filters?.to) {
      const to = new Date(filters.to);
      if (!Number.isNaN(to.getTime())) {
        to.setHours(23, 59, 59, 999);
        conditions.push(lte(taxAuthorityInvoices.createdAt, to));
      }
    }
    const limit = Math.min(200, Math.max(1, filters?.limit ?? 100));
    const rows = await this.db
      .select()
      .from(taxAuthorityInvoices)
      .where(and(...conditions))
      .orderBy(desc(taxAuthorityInvoices.createdAt))
      .limit(limit);

    return rows.map((r) => this.mapInvoice(r));
  }

  async sendInvoice(organizationId: string, authority: "fbr" | "pra", body: unknown) {
    await this.assertOrgTaxEnabled(organizationId, authority);
    const input = this.parseOrThrow(sendTaxInvoiceSchema, body);
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const profile = await this.requireProfile(organizationId, branch.id);

    const source = await this.loadSourceDocument(organizationId, branch.id, input.sourceType, input.sourceId);
    const invoiceMode: PraInvoiceMode = "real";
    const existing = await this.findInvoice(
      organizationId,
      authority,
      input.sourceType,
      input.sourceId,
      invoiceMode,
    );
    if (existing && (existing.status === "verified" || existing.status === "submitted") && !input.force) {
      return { invoice: this.mapInvoice(existing), message: "Invoice Already Submitted" };
    }

    if (authority === "pra") {
      const settings = defaultPraSettings(profile);
      if (
        existing &&
        existing.status === "failed" &&
        existing.attemptCount >= settings.maxRetryAttempts &&
        !input.force
      ) {
        throw new BadRequestException(
          `Maximum retry attempts (${settings.maxRetryAttempts}) reached for this invoice.`,
        );
      }
    }

    const token = await this.ensureToken(organizationId, branch.code, authority, profile);
    const payload = this.buildInvoicePayload(authority, profile, source);
    const now = new Date();

    let row = existing;
    if (!row) {
      const [created] = await this.db
        .insert(taxAuthorityInvoices)
        .values({
          organizationId,
          branchId: branch.id,
          authority,
          invoiceMode,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          sourceRef: source.ref,
          status: "submitting",
          taxableAmountPkr: source.taxableAmountPkr,
          taxAmountPkr: source.taxAmountPkr,
          requestJson: JSON.stringify(payload),
          attemptCount: 1,
          lastAttemptAt: now,
          updatedAt: now,
        })
        .returning();
      row = created!;
    } else {
      const [updated] = await this.db
        .update(taxAuthorityInvoices)
        .set({
          status: "submitting",
          invoiceMode,
          requestJson: JSON.stringify(payload),
          attemptCount: row.attemptCount + 1,
          lastAttemptAt: now,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(taxAuthorityInvoices.id, row.id))
        .returning();
      row = updated!;
    }

    try {
      const result = await this.postInvoice(authority, profile, token, payload);
      const [saved] = await this.db
        .update(taxAuthorityInvoices)
        .set({
          status: authority === "pra" ? "submitted" : "verified",
          invoiceMode,
          responseJson: JSON.stringify(result.raw),
          authorityInvoiceNumber: result.invoiceNumber,
          qrPayload: result.qrPayload,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(taxAuthorityInvoices.id, row.id))
        .returning();

      if (authority === "pra") {
        await this.db
          .update(taxAuthorityProfiles)
          .set({
            praLastInvoiceSentAt: new Date(),
            praLastError: null,
            updatedAt: new Date(),
          })
          .where(eq(taxAuthorityProfiles.id, profile.id));

        await this.writeActivityLog({
          organizationId,
          branchId: branch.id,
          event: "submit_invoice",
          invoiceNumber: source.ref,
          praInvoiceNumber: result.invoiceNumber,
          status: "submitted",
          retryCount: row.attemptCount,
        });

        // Mark verified after successful store of fiscal fields.
        await this.db
          .update(taxAuthorityInvoices)
          .set({ status: "verified", updatedAt: new Date() })
          .where(eq(taxAuthorityInvoices.id, row.id));
      }

      if (authority === "pra" && input.sourceType === "bill") {
        const invoiceId =
          typeof result.raw === "object" &&
          result.raw &&
          "invoiceId" in result.raw &&
          (result.raw as { invoiceId?: unknown }).invoiceId
            ? String((result.raw as { invoiceId: unknown }).invoiceId)
            : `FISC-${Date.now()}-${Math.floor(100000 + Math.random() * 900000)}`;
        await this.db
          .update(taxAuthorityInvoices)
          .set({
            responseJson: JSON.stringify({
              ...(typeof result.raw === "object" && result.raw ? result.raw : { raw: result.raw }),
              invoiceId,
              invoiceNumber: result.invoiceNumber,
              usin: this.buildPraUsin(input.sourceId, source.ref),
              issuedAt: new Date().toISOString(),
            }),
          })
          .where(eq(taxAuthorityInvoices.id, row.id));
        await this.updateBillPraFields(organizationId, input.sourceId, {
          praMode: "real",
          praInvoiceNumber: result.invoiceNumber,
          praInvoiceId: invoiceId,
          praQrPayload: result.qrPayload,
          praIssuedAt: new Date(),
        });
      }

      const latest = await this.findInvoice(
        organizationId,
        authority,
        input.sourceType,
        input.sourceId,
        invoiceMode,
      );
      return {
        invoice: this.mapInvoice(latest ?? saved!),
        message: "Invoice submitted successfully",
      };
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      const message = this.friendlyPraError(err);
      const settings = defaultPraSettings(profile);
      const network = isPraNetworkError(rawMessage) || isPraNetworkError(message);
      // Cloud cannot reach PRA — keep pending for POS client relay (do not spam queued retries).
      const nextStatus =
        authority === "pra" && network
          ? "pending"
          : authority === "pra" && settings.offlineQueue
            ? "queued"
            : "failed";
      await this.db
        .update(taxAuthorityInvoices)
        .set({
          status: nextStatus,
          lastError: message,
          updatedAt: new Date(),
        })
        .where(eq(taxAuthorityInvoices.id, row.id));
      if (authority === "pra") {
        await this.db
          .update(taxAuthorityProfiles)
          .set({ praLastError: message, updatedAt: new Date() })
          .where(eq(taxAuthorityProfiles.id, profile.id));
        await this.writeActivityLog({
          organizationId,
          branchId: branch.id,
          event: "submit_invoice",
          invoiceNumber: source.ref,
          status: nextStatus,
          errorMessage: message,
          retryCount: row.attemptCount,
          dedupeByInvoice: true,
        });
      }
      throw new BadRequestException(message || "Invoice submission failed");
    }
  }

  /**
   * Issue a Fake or Real PRA fiscal invoice for a sale/bill.
   * Fake: local unique numbers + QR (not sent to PRA). Real: e-IMS via sendInvoice.
   */
  async issuePraInvoice(
    organizationId: string,
    body: unknown,
  ): Promise<IssuePraInvoiceResult> {
    const input = this.parseOrThrow(issuePraInvoiceSchema, body) as IssuePraInvoiceInput;
    await this.assertPraModeEnabled(organizationId, input.mode);

    if (input.mode === "real") {
      const sent = await this.sendInvoice(organizationId, "pra", {
        branchCode: input.branchCode,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        force: input.force,
      });
      const fiscal = await this.buildFiscalFromInvoice(
        organizationId,
        input.branchCode,
        input.sourceType,
        input.sourceId,
        "real",
        sent.invoice,
      );
      return {
        invoice: sent.invoice,
        fiscal,
        message: sent.message,
      };
    }

    // —— FPRA ——
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const profile = await this.getProfile(organizationId, branch.id);
    const source = await this.loadSourceDocument(
      organizationId,
      branch.id,
      input.sourceType,
      input.sourceId,
    );

    const existing = await this.findInvoice(
      organizationId,
      "pra",
      input.sourceType,
      input.sourceId,
      "fake",
    );
    if (existing && existing.status === "submitted" && !input.force) {
      const fiscal = await this.buildFiscalFromInvoice(
        organizationId,
        input.branchCode,
        input.sourceType,
        input.sourceId,
        "fake",
        this.mapInvoice(existing),
      );
      return {
        invoice: this.mapInvoice(existing),
        fiscal,
        message: "FPRA invoice already issued",
      };
    }

    const now = new Date();
    // Sequential FPRA invoice # — natural digits (e.g. 35929), no leading zeros.
    const invoiceNumber = await this.allocateFakePraInvoiceNumber(organizationId);
    const orderKey =
      source.ref.replace(/[^A-Za-z0-9-]/g, "").slice(0, 24) || String(Date.now()).slice(-8);
    const invoiceId = `FISC-${orderKey}-${Date.now().toString(36).toUpperCase()}`;
    const usin = this.buildPraUsin(input.sourceId, source.ref);
    const dateStr = now.toISOString().slice(0, 10);
    const qrPayload = `PRA|${invoiceNumber}|${orderKey}|${invoiceId}|${source.totalPkr}|${dateStr}`;

const responsePayload = {
      mode: "fake",
      invoiceNumber,
      invoiceId,
      usin,
      qrPayload,
      issuedAt: now.toISOString(),
    };

    let row = existing;
    if (!row) {
      const [created] = await this.db
        .insert(taxAuthorityInvoices)
        .values({
          organizationId,
          branchId: branch.id,
          authority: "pra",
          invoiceMode: "fake",
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          sourceRef: source.ref,
          status: "submitted",
          taxableAmountPkr: source.taxableAmountPkr,
          taxAmountPkr: source.taxAmountPkr,
          requestJson: JSON.stringify({ mode: "fake", sourceRef: source.ref }),
          responseJson: JSON.stringify(responsePayload),
          authorityInvoiceNumber: invoiceNumber,
          qrPayload,
          attemptCount: 1,
          lastAttemptAt: now,
          updatedAt: now,
        })
        .returning();
      row = created!;
    } else {
      const [updated] = await this.db
        .update(taxAuthorityInvoices)
        .set({
          status: "submitted",
          invoiceMode: "fake",
          responseJson: JSON.stringify(responsePayload),
          authorityInvoiceNumber: invoiceNumber,
          qrPayload,
          attemptCount: row.attemptCount + 1,
          lastAttemptAt: now,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(taxAuthorityInvoices.id, row.id))
        .returning();
      row = updated!;
    }

    if (input.sourceType === "bill") {
      await this.updateBillPraFields(organizationId, input.sourceId, {
        praMode: "fake",
        praInvoiceNumber: invoiceNumber,
        praInvoiceId: invoiceId,
        praQrPayload: qrPayload,
        praIssuedAt: now,
      });
    }

    const invoice = this.mapInvoice(row);
    const fiscal: PraFiscalInvoice = {
      mode: "fake",
      invoiceNumber,
      invoiceId,
      qrPayload,
      usin,
      issuedAt: now.toISOString(),
      sellerName: profile?.companyName ?? "",
      ntn: profile?.ntn ?? "",
      strn: profile?.strn ?? "",
      branchCode: profile?.praBranchCode || branch.code,
      sourceRef: source.ref,
      taxableAmountPkr: source.taxableAmountPkr,
      taxAmountPkr: source.taxAmountPkr,
      totalAmountPkr: source.totalPkr,
      lines: source.lines.map((line) => ({
        label: line.description,
        qty: Math.max(1, Math.round(line.qty)),
        unitPrice:
          line.qty > 0 ? Math.round(line.amount / line.qty) : Math.round(line.amount),
      })),
    };

    return {
      invoice,
      fiscal,
      message: "FPRA invoice issued",
    };
  }

  /**
   * Build PRAL PostData for the POS client. Shop IP is usually whitelisted; Railway often is not.
   */
  async preparePraClientPost(
    organizationId: string,
    body: unknown,
  ): Promise<PreparePraClientPostResult> {
    await this.assertPraModeEnabled(organizationId, "real");
    const input = this.parseOrThrow(
      preparePraClientPostSchema,
      body,
    ) as PreparePraClientPostInput;
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const profile = await this.requireProfile(organizationId, branch.id);
    if (profile.praStatus !== "connected" && profile.praStatus !== "expired") {
      throw new BadRequestException(
        "Real PRA is not connected. Please connect your PRA account before uploading invoices.",
      );
    }

    const existing = await this.findInvoice(
      organizationId,
      "pra",
      input.sourceType,
      input.sourceId,
      "real",
    );
    if (
      existing &&
      (existing.status === "verified" || existing.status === "submitted") &&
      !input.force
    ) {
      const invoice = this.mapInvoice(existing);
      const fiscal = await this.buildFiscalFromInvoice(
        organizationId,
        input.branchCode,
        input.sourceType,
        input.sourceId,
        "real",
        invoice,
      );
      return {
        invoiceDbId: existing.id,
        postUrl: "",
        bearerToken: "",
        payload: {},
        alreadySubmitted: true,
        fiscal,
        invoice,
        message: "Invoice Already Submitted",
      };
    }

    const token = await this.ensureToken(organizationId, branch.code, "pra", profile);
    const source = await this.loadSourceDocument(
      organizationId,
      branch.id,
      input.sourceType,
      input.sourceId,
    );
    const payload = this.buildInvoicePayload("pra", profile, source);
    const env = profile.praEnvironment === "production" ? "production" : "sandbox";
    const { invoiceUrl } = resolvePraUrls(env);
    if (!invoiceUrl) {
      throw new BadRequestException("PRA invoice URL is not configured on the server.");
    }

    const now = new Date();
    let row = existing;
    if (!row) {
      const [created] = await this.db
        .insert(taxAuthorityInvoices)
        .values({
          organizationId,
          branchId: branch.id,
          authority: "pra",
          invoiceMode: "real",
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          sourceRef: source.ref,
          status: "submitting",
          taxableAmountPkr: source.taxableAmountPkr,
          taxAmountPkr: source.taxAmountPkr,
          requestJson: JSON.stringify(payload),
          attemptCount: 1,
          lastAttemptAt: now,
          updatedAt: now,
        })
        .returning();
      row = created!;
    } else {
      const [updated] = await this.db
        .update(taxAuthorityInvoices)
        .set({
          status: "submitting",
          invoiceMode: "real",
          requestJson: JSON.stringify(payload),
          attemptCount: row.attemptCount + 1,
          lastAttemptAt: now,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(taxAuthorityInvoices.id, row.id))
        .returning();
      row = updated!;
    }

    return {
      invoiceDbId: row.id,
      postUrl: invoiceUrl,
      bearerToken: token,
      payload: payload as Record<string, unknown>,
      alreadySubmitted: false,
      message: "Post this payload to PRA from the POS machine, then confirm.",
    };
  }

  /** Persist fiscal # after the POS client successfully called PRA PostData. */
  async confirmPraClientPost(
    organizationId: string,
    body: unknown,
  ): Promise<IssuePraInvoiceResult> {
    await this.assertPraModeEnabled(organizationId, "real");
    const input = this.parseOrThrow(
      confirmPraClientPostSchema,
      body,
    ) as ConfirmPraClientPostInput;
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const profile = await this.requireProfile(organizationId, branch.id);

    const [row] = await this.db
      .select()
      .from(taxAuthorityInvoices)
      .where(
        and(
          eq(taxAuthorityInvoices.id, input.invoiceDbId),
          eq(taxAuthorityInvoices.organizationId, organizationId),
          eq(taxAuthorityInvoices.branchId, branch.id),
          eq(taxAuthorityInvoices.authority, "pra"),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException("PRA invoice draft not found");

    const invoiceNumber = input.invoiceNumber.trim();
    if (!invoiceNumber || /^not available$/i.test(invoiceNumber)) {
      throw new BadRequestException("PRA did not return InvoiceNumber");
    }
    const qrPayload = invoiceNumber;
    const raw: Record<string, unknown> =
      input.raw && typeof input.raw === "object"
        ? (input.raw as Record<string, unknown>)
        : { InvoiceNumber: invoiceNumber, Code: "100" };

    const invoiceId =
      typeof raw.invoiceId === "string" && raw.invoiceId
        ? raw.invoiceId
        : `FISC-${Date.now()}-${Math.floor(100000 + Math.random() * 900000)}`;
    const usin = this.buildPraUsin(row.sourceId, row.sourceRef || row.sourceId);

    const [saved] = await this.db
      .update(taxAuthorityInvoices)
      .set({
        status: "verified",
        invoiceMode: "real",
        responseJson: JSON.stringify({
          ...raw,
          invoiceId,
          invoiceNumber,
          usin,
          issuedAt: new Date().toISOString(),
        }),
        authorityInvoiceNumber: invoiceNumber,
        qrPayload,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(taxAuthorityInvoices.id, row.id),
          eq(taxAuthorityInvoices.organizationId, organizationId),
          eq(taxAuthorityInvoices.branchId, branch.id),
        ),
      )
      .returning();

    await this.db
      .update(taxAuthorityProfiles)
      .set({
        praLastInvoiceSentAt: new Date(),
        praLastError: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(taxAuthorityProfiles.id, profile.id),
          eq(taxAuthorityProfiles.organizationId, organizationId),
          eq(taxAuthorityProfiles.branchId, branch.id),
        ),
      );

    await this.writeActivityLog({
      organizationId,
      branchId: branch.id,
      event: "submit_invoice",
      invoiceNumber: row.sourceRef,
      praInvoiceNumber: invoiceNumber,
      status: "submitted",
      retryCount: row.attemptCount,
      dedupeByInvoice: true,
    });

    if (row.sourceType === "bill") {
      await this.updateBillPraFields(organizationId, row.sourceId, {
        praMode: "real",
        praInvoiceNumber: invoiceNumber,
        praInvoiceId: invoiceId,
        praQrPayload: qrPayload,
        praIssuedAt: new Date(),
      });
    }

    const invoice = this.mapInvoice(saved!);
    const fiscal = await this.buildFiscalFromInvoice(
      organizationId,
      input.branchCode,
      row.sourceType as TaxInvoiceSourceType,
      row.sourceId,
      "real",
      invoice,
    );
    return {
      invoice,
      fiscal,
      message: "Invoice submitted successfully (client relay)",
    };
  }

  /**
   * Return Fake/Real PRA fiscal details for a source from bill columns or latest invoice.
   */
  async getFiscalForSource(
    organizationId: string,
    branchCode: string,
    sourceType: TaxInvoiceSourceType,
    sourceId: string,
  ): Promise<PraFiscalInvoice | null> {
    const branch = await this.resolveBranch(organizationId, branchCode);

    if (sourceType === "bill") {
      const [bill] = await this.db
        .select()
        .from(popsBills)
        .where(
          and(
            eq(popsBills.id, sourceId),
            eq(popsBills.organizationId, organizationId),
            eq(popsBills.branchId, branch.id),
          ),
        )
        .limit(1);
      if (bill?.praInvoiceNumber && (bill.praMode === "fake" || bill.praMode === "real")) {
        const profile = await this.getProfile(organizationId, branch.id);
        const { lines, taxableAmountPkr, taxAmountPkr } = buildBillPraSourceLines({
          linesJson: bill.linesJson,
          subtotalPkr: bill.subtotalPkr,
          discountPkr: bill.discountPkr,
          servicePkr: bill.servicePkr,
          deliveryChargePkr: bill.deliveryChargePkr,
          taxPkr: bill.taxPkr,
        });
        return {
          mode: bill.praMode,
          invoiceNumber: bill.praInvoiceNumber,
          invoiceId: bill.praInvoiceId ?? bill.praInvoiceNumber,
          qrPayload: bill.praQrPayload ?? bill.praInvoiceNumber,
          usin: this.buildPraUsin(bill.id, bill.billRef),
          issuedAt: bill.praIssuedAt?.toISOString() ?? bill.createdAt.toISOString(),
          sellerName: profile?.companyName ?? "",
          ntn: profile?.ntn ?? "",
          strn: profile?.strn ?? "",
          branchCode: profile?.praBranchCode || branch.code,
          sourceRef: bill.billRef,
          taxableAmountPkr,
          taxAmountPkr,
          totalAmountPkr:
            taxableAmountPkr +
            taxAmountPkr +
            Math.max(0, bill.servicePkr) +
            Math.max(0, bill.deliveryChargePkr),
          lines: lines.map((line) => ({
            label: line.description,
            qty: Math.max(1, Math.round(line.qty)),
            unitPrice:
              line.qty > 0 ? Math.round(line.amount / line.qty) : Math.round(line.amount),
          })),
        };
      }
    }

    const [latest] = await this.db
      .select()
      .from(taxAuthorityInvoices)
      .where(
        and(
          eq(taxAuthorityInvoices.organizationId, organizationId),
          eq(taxAuthorityInvoices.branchId, branch.id),
          eq(taxAuthorityInvoices.authority, "pra"),
          eq(taxAuthorityInvoices.sourceType, sourceType),
          eq(taxAuthorityInvoices.sourceId, sourceId),
        ),
      )
      .orderBy(desc(taxAuthorityInvoices.createdAt))
      .limit(1);

    if (!latest?.authorityInvoiceNumber) return null;
    return this.buildFiscalFromInvoice(
      organizationId,
      branchCode,
      sourceType,
      sourceId,
      latest.invoiceMode === "fake" ? "fake" : "real",
      this.mapInvoice(latest),
    );
  }

  /**
   * Fire-and-forget enqueue after a sale is completed.
   * Never throws to the caller — failures are logged and queued as failed/queued rows.
   *
   * PRA auto-enqueue only when Real is enabled and Fake is not (both → client chooses).
   */
  async enqueueFromSale(params: {
    organizationId: string;
    branchId: string;
    branchCode: string;
    sourceType: TaxInvoiceSourceType;
    sourceId: string;
    sourceRef: string;
    taxableAmountPkr: number;
    taxAmountPkr: number;
  }): Promise<void> {
    try {
      const profile = await this.getProfile(params.organizationId, params.branchId);
      if (!profile) return;
      const features = await this.getFeatures(params.organizationId);

      const authorities: Array<"fbr" | "pra"> = [];
      if (
        features.fbrEnabled &&
        (profile.fbrStatus === "connected" || profile.fbrStatus === "expired")
      ) {
        authorities.push("fbr");
      }
      // Real-only: auto-enqueue when Real PRA is active and connected.
      if (
        features.praRealEnabled &&
        !features.praFakeEnabled &&
        (profile.praStatus === "connected" || profile.praStatus === "expired")
      ) {
        authorities.push("pra");
      }
      if (authorities.length === 0) return;

      for (const authority of authorities) {
        const invoiceMode: PraInvoiceMode = "real";
        const existing = await this.findInvoice(
          params.organizationId,
          authority,
          params.sourceType,
          params.sourceId,
          invoiceMode,
        );
        if (existing) continue;

        const initialStatus =
          authority === "pra"
            ? "pending"
            : "queued";

        await this.db.insert(taxAuthorityInvoices).values({
          organizationId: params.organizationId,
          branchId: params.branchId,
          authority,
          invoiceMode,
          sourceType: params.sourceType,
          sourceId: params.sourceId,
          sourceRef: params.sourceRef,
          status: initialStatus,
          taxableAmountPkr: params.taxableAmountPkr,
          taxAmountPkr: params.taxAmountPkr,
        });

        await this.writeActivityLog({
          organizationId: params.organizationId,
          branchId: params.branchId,
          event: "enqueue",
          invoiceNumber: params.sourceRef,
          status: initialStatus,
        });

        // Real PRA: never PostData from cloud (Railway TLS/IP blocked). POS Pay uses client relay.
        if (authority === "pra") continue;

        // FBR (and similar): best-effort immediate send from server.
        void this.sendInvoice(params.organizationId, authority, {
          branchCode: params.branchCode,
          sourceType: params.sourceType,
          sourceId: params.sourceId,
          force: false,
        }).catch((err) => {
          this.logger.warn(
            `Auto-submit ${authority} invoice for ${params.sourceRef} failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
      }
    } catch (err) {
      this.logger.warn(
        `enqueueFromSale failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private parseOrThrow<T>(schema: { parse: (v: unknown) => T }, body: unknown): T {
    try {
      return schema.parse(body);
    } catch (err) {
      if (err instanceof ZodError) {
        const first = err.issues[0]?.message;
        throw new BadRequestException(first || "Please complete all required fields.");
      }
      throw err;
    }
  }

  private assertRequiredConnectFields(
    company: FbrConnectInput["company"] | PraConnectInput["company"],
    ...secrets: string[]
  ): void {
    if (
      !company.companyName?.trim() ||
      !company.ntn?.trim() ||
      !company.strn?.trim() ||
      !company.businessType?.trim() ||
      !company.province?.trim() ||
      !company.branchName?.trim() ||
      !company.branchCode?.trim() ||
      secrets.some((s) => !s?.trim())
    ) {
      throw new BadRequestException("Please complete all required fields.");
    }
  }

  private normalizeStatus(
    status: string,
    expiresAt: Date | null,
  ): TaxAuthorityStatus["fbr"]["status"] {
    if (status === "connected" && expiresAt && expiresAt.getTime() < Date.now()) return "expired";
    if (status === "connected" || status === "error" || status === "expired" || status === "disconnected") {
      return status;
    }
    return "disconnected";
  }

  /**
   * Resolve a store branch, or attach to the org "Main System" when none is selected
   * (empty / SYSTEM / MAIN) so FBR/PRA can be configured without multi-branch setup.
   */
  private async resolveBranch(organizationId: string, branchCode: string) {
    const raw = branchCode.trim().toUpperCase();
    const code = !raw || raw === "SYSTEM" ? "MAIN" : branchCode.trim();

    const [existing] = await this.db
      .select()
      .from(popsBranches)
      .where(and(eq(popsBranches.organizationId, organizationId), eq(popsBranches.code, code)))
      .limit(1);
    if (existing) return existing;

    if (code === "MAIN") {
      try {
        const [created] = await this.db
          .insert(popsBranches)
          .values({
            organizationId,
            code: "MAIN",
            name: "Main System",
            city: "Head Office",
          })
          .returning();
        if (created) return created;
      } catch {
        const [retry] = await this.db
          .select()
          .from(popsBranches)
          .where(
            and(eq(popsBranches.organizationId, organizationId), eq(popsBranches.code, "MAIN")),
          )
          .limit(1);
        if (retry) return retry;
      }
    }

    throw new NotFoundException(`Branch not found: ${code}`);
  }

  private async getProfile(organizationId: string, branchId: string) {
    const [row] = await this.db
      .select()
      .from(taxAuthorityProfiles)
      .where(
        and(
          eq(taxAuthorityProfiles.organizationId, organizationId),
          eq(taxAuthorityProfiles.branchId, branchId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  private async requireProfile(organizationId: string, branchId: string) {
    const profile = await this.getProfile(organizationId, branchId);
    if (!profile) {
      throw new BadRequestException("Please complete all required fields.");
    }
    return profile;
  }

  private async upsertProfile(
    organizationId: string,
    branch: typeof popsBranches.$inferSelect,
    fbr: FbrConnectInput | null,
    pra: PraConnectInput | null,
    patch: Partial<ProfileRow>,
  ): Promise<ProfileRow> {
    const company = fbr?.company ?? pra?.company;
    const existing = await this.getProfile(organizationId, branch.id);
    const now = new Date();

    if (!existing) {
      const [created] = await this.db
        .insert(taxAuthorityProfiles)
        .values({
          organizationId,
          branchId: branch.id,
          companyName: company?.companyName ?? "",
          ntn: company?.ntn ?? "",
          strn: company?.strn ?? "",
          businessType: company?.businessType ?? "",
          province: company?.province ?? "",
          branchName: company?.branchName ?? branch.name,
          branchCode: company?.branchCode ?? branch.code,
          ...patch,
          updatedAt: now,
        })
        .returning();
      return created!;
    }

    const [updated] = await this.db
      .update(taxAuthorityProfiles)
      .set({
        ...(company
          ? {
              companyName: company.companyName,
              ntn: company.ntn,
              strn: company.strn,
              businessType: company.businessType,
              province: company.province,
              branchName: company.branchName,
              branchCode: company.branchCode,
            }
          : {}),
        ...patch,
        updatedAt: now,
      })
      .where(eq(taxAuthorityProfiles.id, existing.id))
      .returning();
    return updated!;
  }

  private async fetchFbrOauthToken(
    input: FbrConnectInput,
  ): Promise<{ accessToken: string; expiresAt: Date } | null> {
    if (!FBR_TOKEN_URL || !input.clientId?.trim()) return null;

    const res = await fetch(FBR_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: input.clientId,
        client_secret: input.clientSecret,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`FBR authentication failed (${res.status}): ${text || res.statusText}`);
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error("FBR authentication failed: no access_token returned");
    const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
    return {
      accessToken: json.access_token,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    };
  }

  private async pingFbrToken(token: string, environment: "sandbox" | "production"): Promise<void> {
    // Lightweight connectivity check against validate endpoint with an empty-ish probe.
    // Sandbox may reject payload but 401 clearly means bad token.
    const url = environment === "production" ? FBR_POST_PRODUCTION : FBR_VALIDATE_SANDBOX;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
        signal: controller.signal,
      });
      if (res.status === 401 || res.status === 403) {
        throw new Error("FBR authentication failed. Check Client Secret / security token.");
      }
      // Other statuses (400 validation, 200, 404) still prove the token was accepted at gateway level
      // or the endpoint is reachable; credentials are stored either way after field validation.
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // Network timeout — allow sandbox connect so merchants can save credentials offline.
        if (environment === "sandbox") return;
        throw new Error("Could not reach FBR. Check network / IP whitelist and try again.");
      }
      if (err instanceof Error && /authentication failed/i.test(err.message)) throw err;
      if (environment === "sandbox") return;
      throw err instanceof Error ? err : new Error(String(err));
    } finally {
      clearTimeout(timer);
    }
  }

  private async pingPraBearerToken(
    token: string,
    environment: "sandbox" | "production",
    _posId: number,
  ): Promise<void> {
    const { invoiceUrl } = resolvePraUrls(environment);
    if (!invoiceUrl) {
      throw new Error("PRA invoice URL is not configured on the server.");
    }
    try {
      // Probe with POSID 0 so PRA returns a validation fault instead of issuing a real fiscal #.
      const res = await praHttpPost(invoiceUrl, token, {
        InvoiceNumber: "",
        POSID: 0,
        USIN: `PING-${Date.now()}`,
        DateTime: new Date().toISOString().replace("T", " ").slice(0, 19),
        BuyerPNTN: "",
        BuyerCNIC: "",
        BuyerName: "Connection Test",
        BuyerPhoneNumber: "",
        TotalBillAmount: 0,
        TotalQuantity: 0,
        TotalSaleValue: 0,
        TotalTaxCharged: 0,
        Discount: 0,
        FurtherTax: 0,
        PaymentMode: 1,
        RefUSIN: null,
        InvoiceType: 1,
        Items: [],
      });
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          "Invalid Credentials — check Bearer Token / IP whitelist (eims@pra.punjab.gov.pk)",
        );
      }
      if (res.status >= 500) {
        throw new Error(`PRA Server Unavailable (${res.status}): ${res.text.slice(0, 200)}`);
      }
      this.logger.log(
        `PRA ping ${environment} status=${res.status} body=${res.text.slice(0, 180)}`,
      );
    } catch (err) {
      if (err instanceof Error && /timeout/i.test(err.message)) {
        throw new Error("Network Timeout — could not reach PRA PostData endpoint");
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  private async ensureToken(
    organizationId: string,
    branchCode: string,
    authority: "fbr" | "pra",
    profile: ProfileRow,
  ): Promise<string> {
    if (authority === "pra") {
      // PRA portal issues a long-lived Bearer token (POS Details). No OAuth refresh URL.
      if (profile.praAccessToken?.trim()) return profile.praAccessToken.trim();
      throw new BadRequestException(
        "PRA Bearer Token missing. Open Tax → PRA Integration and Connect again.",
      );
    }

    const expiresAt = profile.fbrTokenExpiresAt;
    const token = profile.fbrAccessToken;
    const expired = !expiresAt || expiresAt.getTime() <= Date.now() + 60_000;

    if (token && !expired) return token;

    const refreshed = await this.refreshFbrToken(organizationId, branchCode);
    const latest = await this.requireProfile(
      organizationId,
      (await this.resolveBranch(organizationId, branchCode)).id,
    );
    if (!latest.fbrAccessToken) throw new BadRequestException(refreshed.message);
    return latest.fbrAccessToken;
  }

  private async findInvoice(
    organizationId: string,
    authority: "fbr" | "pra",
    sourceType: string,
    sourceId: string,
    invoiceMode: PraInvoiceMode = "real",
  ) {
    const [row] = await this.db
      .select()
      .from(taxAuthorityInvoices)
      .where(
        and(
          eq(taxAuthorityInvoices.organizationId, organizationId),
          eq(taxAuthorityInvoices.authority, authority),
          eq(taxAuthorityInvoices.invoiceMode, invoiceMode),
          eq(taxAuthorityInvoices.sourceType, sourceType),
          eq(taxAuthorityInvoices.sourceId, sourceId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  private async updateBillPraFields(
    organizationId: string,
    billId: string,
    fields: {
      praMode: PraInvoiceMode;
      praInvoiceNumber: string;
      praInvoiceId: string;
      praQrPayload: string;
      praIssuedAt: Date;
    },
  ): Promise<void> {
    await this.db
      .update(popsBills)
      .set({
        praMode: fields.praMode,
        praInvoiceNumber: fields.praInvoiceNumber,
        praInvoiceId: fields.praInvoiceId,
        praQrPayload: fields.praQrPayload,
        praIssuedAt: fields.praIssuedAt,
      })
      .where(and(eq(popsBills.id, billId), eq(popsBills.organizationId, organizationId)));
  }

  private async buildFiscalFromInvoice(
    organizationId: string,
    branchCode: string,
    sourceType: TaxInvoiceSourceType,
    sourceId: string,
    mode: PraInvoiceMode,
    invoice: TaxInvoice,
  ): Promise<PraFiscalInvoice> {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const profile = await this.getProfile(organizationId, branch.id);
    const source = await this.loadSourceDocument(organizationId, branch.id, sourceType, sourceId);

    let invoiceId = invoice.authorityInvoiceNumber ?? `FISC-${invoice.id.slice(0, 8)}`;
    let usin = this.buildPraUsin(sourceId, source.ref);
    let issuedAt = invoice.updatedAt;

    const [row] = await this.db
      .select()
      .from(taxAuthorityInvoices)
      .where(
        and(
          eq(taxAuthorityInvoices.id, invoice.id),
          eq(taxAuthorityInvoices.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (row?.responseJson) {
      try {
        const parsed = JSON.parse(row.responseJson) as Record<string, unknown>;
        if (typeof parsed.invoiceId === "string" && parsed.invoiceId) invoiceId = parsed.invoiceId;
        if (typeof parsed.usin === "string" && parsed.usin) usin = parsed.usin;
        if (typeof parsed.issuedAt === "string" && parsed.issuedAt) issuedAt = parsed.issuedAt;
      } catch {
        /* ignore */
      }
    }

    if (sourceType === "bill") {
      const [bill] = await this.db
        .select({
          praInvoiceId: popsBills.praInvoiceId,
          praIssuedAt: popsBills.praIssuedAt,
        })
        .from(popsBills)
        .where(and(eq(popsBills.id, sourceId), eq(popsBills.organizationId, organizationId)))
        .limit(1);
      if (bill?.praInvoiceId) invoiceId = bill.praInvoiceId;
      if (bill?.praIssuedAt) issuedAt = bill.praIssuedAt.toISOString();
    }

    return {
      mode,
      invoiceNumber: invoice.authorityInvoiceNumber ?? invoiceId,
      invoiceId,
      qrPayload: invoice.qrPayload ?? invoice.authorityInvoiceNumber ?? invoiceId,
      usin,
      issuedAt,
      sellerName: profile?.companyName ?? "",
      ntn: profile?.ntn ?? "",
      strn: profile?.strn ?? "",
      branchCode: profile?.praBranchCode || branch.code,
      sourceRef: source.ref,
      taxableAmountPkr: source.taxableAmountPkr,
      taxAmountPkr: source.taxAmountPkr,
      totalAmountPkr: source.totalPkr,
      lines: source.lines.map((line) => ({
        label: line.description,
        qty: Math.max(1, Math.round(line.qty)),
        unitPrice:
          line.qty > 0 ? Math.round(line.amount / line.qty) : Math.round(line.amount),
      })),
    };
  }

  private async loadSourceDocument(
    organizationId: string,
    branchId: string,
    sourceType: TaxInvoiceSourceType,
    sourceId: string,
  ) {
    if (sourceType === "bill") {
      const [row] = await this.db
        .select()
        .from(popsBills)
        .where(
          and(
            eq(popsBills.id, sourceId),
            eq(popsBills.organizationId, organizationId),
            eq(popsBills.branchId, branchId),
          ),
        )
        .limit(1);
      if (!row) throw new NotFoundException("Bill not found");
      const { lines, taxableAmountPkr, taxAmountPkr } = buildBillPraSourceLines({
        linesJson: row.linesJson,
        subtotalPkr: row.subtotalPkr,
        discountPkr: row.discountPkr,
        servicePkr: row.servicePkr,
        deliveryChargePkr: row.deliveryChargePkr,
        taxPkr: row.taxPkr,
      });
      const service = Math.max(0, row.servicePkr);
      const delivery = Math.max(0, row.deliveryChargePkr);
      return {
        id: sourceId,
        ref: row.billRef,
        date: row.createdAt,
        taxableAmountPkr,
        taxAmountPkr,
        totalPkr: taxableAmountPkr + taxAmountPkr + service + delivery,
        lines,
      };
    }

    if (sourceType === "store_sale") {
      const [row] = await this.db
        .select()
        .from(storeSales)
        .where(
          and(
            eq(storeSales.id, sourceId),
            eq(storeSales.organizationId, organizationId),
            eq(storeSales.branchId, branchId),
          ),
        )
        .limit(1);
      if (!row) throw new NotFoundException("Store sale not found");
      const saleLines = await this.db
        .select()
        .from(storeSaleLines)
        .where(eq(storeSaleLines.saleId, row.id));
      const productIds = [...new Set(saleLines.map((l) => l.productId))];
      const products =
        productIds.length > 0
          ? await this.db
              .select()
              .from(storeProducts)
              .where(
                and(
                  eq(storeProducts.organizationId, organizationId),
                  inArray(storeProducts.id, productIds),
                ),
              )
          : [];
      const productName = (productId: string, displayName: string | null) => {
        if (displayName?.trim()) return displayName.trim();
        return products.find((p) => p.id === productId)?.name ?? "Item";
      };
      return {
        id: sourceId,
        ref: row.invoiceNumber,
        date: row.createdAt,
        taxableAmountPkr: Math.max(0, row.subtotalPkr - row.discountPkr - row.promotionDiscountPkr),
        taxAmountPkr: row.taxPkr,
        totalPkr: row.totalPkr,
        lines: withAllocatedStoreLineTaxes(
          saleLines.map((l) => {
            const qty = l.isWeighed === "yes" ? Math.max(0.001, l.qty / 1000) : Math.max(1, l.qty);
            return {
              description: productName(l.productId, null),
              qty,
              amount: l.lineTotalPkr,
              tax: 0,
            };
          }),
          row.taxPkr,
        ),
      };
    }

    const [row] = await this.db
      .select()
      .from(pharmacySales)
      .where(
        and(
          eq(pharmacySales.id, sourceId),
          eq(pharmacySales.organizationId, organizationId),
          eq(pharmacySales.branchId, branchId),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException("Pharmacy sale not found");
    return {
      id: sourceId,
      ref: row.invoiceNumber,
      date: row.createdAt,
      taxableAmountPkr: Math.max(0, row.subtotalPkr - row.discountPkr),
      taxAmountPkr: row.taxPkr,
      totalPkr: row.totalPkr,
      lines: [],
    };
  }

  /**
   * Next FPRA invoice number for this org — real-looking alphanumeric
   * (e.g. 197476FGYI32391068). Atomic UPDATE so concurrent Pays don't collide.
   */
  private async allocateFakePraInvoiceNumber(organizationId: string): Promise<string> {
    const [row] = await this.db
      .update(organizations)
      .set({
        praFakeInvoiceSeq: sql`${organizations.praFakeInvoiceSeq} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, organizationId))
      .returning({ seq: organizations.praFakeInvoiceSeq });
    const seq = Math.max(1, Number(row?.seq ?? 1));
    return this.formatFakePraInvoiceNumber(organizationId, seq);
  }

  /** 6 digits + 4 letters + 8 digits — matches real PRA-style invoice ids. */
  private formatFakePraInvoiceNumber(_organizationId: string, seq: number): string {
    const prefix = String(197475 + seq).padStart(6, "0").slice(-6);
    const letters = this.fakePraLetterBlock(seq);
    const suffix = String(10_000_000 + ((seq * 7919 + 3_239_106) % 89_999_999)).slice(-8);
    return `${prefix}${letters}${suffix}`;
  }

  private fakePraLetterBlock(seq: number): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    let h = Math.imul(seq, 2654435761) >>> 0;
    let out = "";
    for (let i = 0; i < 4; i++) {
      out += alphabet[(h + i * 17) % alphabet.length]!;
      h = (Math.imul(h, 33) + i) >>> 0;
    }
    return out;
  }

  /** PRA PostData USIN — unique per source UUID so billRef collisions across orgs/branches don't clash. */
  private buildPraUsin(sourceId: string, sourceRef: string): string {
    const idPart = sourceId.replace(/-/g, "").slice(0, 8);
    const refPart = sourceRef.replace(/[^A-Za-z0-9]/g, "").slice(-28);
    const body = refPart ? `${idPart}-${refPart}` : idPart;
    return body.slice(0, 50) || `USIN${Date.now()}`.slice(0, 50);
  }

  private parseLines(raw: string | null): PraSourceLine[] {
    return parsePraSourceLines(raw);
  }

  private buildInvoicePayload(
    authority: "fbr" | "pra",
    profile: ProfileRow,
    source: {
      id: string;
      ref: string;
      date: Date;
      taxableAmountPkr: number;
      taxAmountPkr: number;
      totalPkr: number;
      lines: PraSourceLine[];
    },
  ) {
    const invoiceDate = source.date.toISOString().slice(0, 10);
    const taxRatePct =
      source.taxableAmountPkr > 0
        ? Math.round((source.taxAmountPkr / source.taxableAmountPkr) * 10000) / 100
        : 0;
    const items =
      source.lines.length > 0
        ? source.lines.map((line) => ({
            hsCode: "0000.0000",
            productDescription: line.description,
            rate: `${Math.round(taxRatePct)}%`,
            uoM: "Numbers, pieces, units",
            quantity: line.qty,
            totalValues: 0,
            valueSalesExcludingST: line.amount,
            fixedNotifiedValueOrRetailPrice: 0,
            salesTaxApplicable: line.tax,
            salesTaxWithheldAtSource: 0,
            extraTax: 0,
            furtherTax: 0,
            sroScheduleNo: "",
            fedPayable: 0,
            discount: 0,
            saleType: "Goods at standard rate (default)",
            sroItemSerialNo: "",
          }))
        : [
            {
              hsCode: "0000.0000",
              productDescription: source.ref,
              rate: `${Math.round(taxRatePct)}%`,
              uoM: "Numbers, pieces, units",
              quantity: 1,
              totalValues: 0,
              valueSalesExcludingST: source.taxableAmountPkr,
              fixedNotifiedValueOrRetailPrice: 0,
              salesTaxApplicable: source.taxAmountPkr,
              salesTaxWithheldAtSource: 0,
              extraTax: 0,
              furtherTax: 0,
              sroScheduleNo: "",
              fedPayable: 0,
              discount: 0,
              saleType: "Goods at standard rate (default)",
              sroItemSerialNo: "",
            },
          ];

    if (authority === "fbr") {
      return {
        invoiceType: "Sale Invoice",
        invoiceDate,
        sellerNTNCNIC: profile.ntn.replace(/-/g, ""),
        sellerBusinessName: profile.companyName,
        sellerProvince: profile.province,
        sellerAddress: profile.branchName || profile.province,
        buyerNTNCNIC: "",
        buyerBusinessName: "Walking Customer",
        buyerProvince: profile.province,
        buyerAddress: profile.province,
        buyerRegistrationType: "Unregistered",
        invoiceRefNo: source.ref,
        ...(profile.fbrEnvironment === "sandbox" ? { scenarioId: "SN001" } : {}),
        posId: profile.fbrPosId,
        terminalId: profile.fbrTerminalId,
        items,
      };
    }

    return {
      InvoiceNumber: "",
      POSID: Number(profile.praRegistrationNumber) || 0,
      USIN: this.buildPraUsin(source.id, source.ref),
      DateTime: invoiceDate.includes("T")
        ? invoiceDate.replace("T", " ").slice(0, 19)
        : invoiceDate,
      BuyerPNTN: "",
      BuyerCNIC: "",
      BuyerName: "Walking Customer",
      BuyerPhoneNumber: "",
      TotalBillAmount: source.totalPkr,
      TotalQuantity: Math.max(
        1,
        source.lines.reduce((sum, l) => sum + (l.qty || 0), 0) || 1,
      ),
      TotalSaleValue: source.taxableAmountPkr,
      TotalTaxCharged: source.taxAmountPkr,
      Discount: 0,
      FurtherTax: 0,
      PaymentMode: 1,
      RefUSIN: null,
      InvoiceType: 1,
      Items:
        source.lines.length > 0
          ? source.lines.map((line, idx) => {
              const qty = Math.max(1, line.qty || 1);
              // Amounts from POS are tax-exclusive; TaxCharged is allocated ST.
              const saleValue = Math.max(0, Math.round(line.amount));
              const lineTax = Math.max(0, Math.round(line.tax || 0));
              const taxRate =
                saleValue > 0 ? Math.round((lineTax / saleValue) * 10000) / 100 : taxRatePct;
              return {
                ItemCode: `IT_${idx + 1}`,
                ItemName: (line.description || `Item ${idx + 1}`).slice(0, 100),
                Quantity: qty,
                PCTCode: "98012000",
                TaxRate: taxRate,
                SaleValue: saleValue,
                TotalAmount: saleValue + lineTax,
                TaxCharged: lineTax,
                Discount: 0,
                FurtherTax: 0,
                InvoiceType: 1,
                RefUSIN: null,
              };
            })
          : [
              {
                ItemCode: "IT_1",
                ItemName: source.ref,
                Quantity: 1,
                PCTCode: "98012000",
                TaxRate: taxRatePct,
                SaleValue: source.taxableAmountPkr,
                TotalAmount: source.taxableAmountPkr + source.taxAmountPkr,
                TaxCharged: source.taxAmountPkr,
                Discount: 0,
                FurtherTax: 0,
                InvoiceType: 1,
                RefUSIN: null,
              },
            ],
    };
  }

  private async postInvoice(
    authority: "fbr" | "pra",
    profile: ProfileRow,
    token: string,
    payload: Record<string, unknown>,
  ): Promise<{ invoiceNumber: string; qrPayload: string; raw: unknown }> {
    if (authority === "fbr") {
      const url =
        profile.fbrEnvironment === "production" ? FBR_POST_PRODUCTION : FBR_POST_SANDBOX;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const raw = await res.json().catch(async () => ({ message: await res.text() }));
      if (!res.ok) {
        const message =
          typeof raw === "object" && raw && "message" in raw
            ? String((raw as { message: unknown }).message)
            : `FBR submit failed (${res.status})`;
        throw new Error(message);
      }
      const invoiceNumber =
        typeof raw === "object" && raw && "invoiceNumber" in raw
          ? String((raw as { invoiceNumber: unknown }).invoiceNumber)
          : `FBR-${Date.now()}`;
      return {
        invoiceNumber,
        qrPayload: invoiceNumber,
        raw,
      };
    }

    const env = profile.praEnvironment === "production" ? "production" : "sandbox";
    const { invoiceUrl } = resolvePraUrls(env);
    if (!invoiceUrl) {
      throw new Error("PRA invoice URL is not configured on the server (PRA_INVOICE_URL).");
    }

    const res = await praHttpPost(invoiceUrl, token, payload);
    const raw = res.json;
    const code =
      typeof raw === "object" && raw && "Code" in raw
        ? String((raw as { Code: unknown }).Code)
        : "";
    const responseMsg =
      typeof raw === "object" && raw && "Response" in raw
        ? String((raw as { Response: unknown }).Response)
        : typeof raw === "object" && raw && "message" in raw
          ? String((raw as { message: unknown }).message)
          : "";

    if (res.status === 401 || res.status === 403) {
      throw new Error("Invalid Credentials");
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(responseMsg || `PRA submit failed (${res.status})`);
    }
    // PRA success codes are typically "100"
    if (code && code !== "100") {
      throw new Error(responseMsg || `PRA rejected invoice (Code ${code})`);
    }

    const invoiceNumber =
      typeof raw === "object" && raw && "InvoiceNumber" in raw
        ? String((raw as { InvoiceNumber: unknown }).InvoiceNumber)
        : typeof raw === "object" && raw && "invoiceNumber" in raw
          ? String((raw as { invoiceNumber: unknown }).invoiceNumber)
          : "";
    if (!invoiceNumber || /^not available$/i.test(invoiceNumber.trim())) {
      throw new Error(responseMsg || "PRA did not return InvoiceNumber");
    }
    return { invoiceNumber, qrPayload: invoiceNumber, raw };
  }

  private async assertOrgTaxEnabled(
    organizationId: string,
    authority: "fbr" | "pra",
  ): Promise<void> {
    const features = await this.getFeatures(organizationId);
    if (authority === "fbr") {
      if (!features.fbrEnabled) {
        throw new ForbiddenException(
          "FBR is not enabled for this business. Contact the platform Super Admin.",
        );
      }
      return;
    }
    // Fake OR Real grant allows Real PRA connect / upload (Fake shops use RPRA manually).
    if (!features.praRealEnabled && !features.praFakeEnabled && !features.praEnabled) {
      throw new ForbiddenException(
        "PRA is not enabled for this business. Contact the platform Super Admin.",
      );
    }
  }

  private async assertPraModeEnabled(
    organizationId: string,
    mode: PraInvoiceMode,
  ): Promise<void> {
    const features = await this.getFeatures(organizationId);
    if (mode === "fake") {
      if (!features.praFakeEnabled) {
        throw new ForbiddenException(
          "FPRA is not enabled for this business. Contact the platform Super Admin.",
        );
      }
      return;
    }
    // Real fiscal: allow when Real is ON, or Fake is ON (manual RPRA while Fake is default).
    if (!features.praRealEnabled && !features.praFakeEnabled && !features.praEnabled) {
      throw new ForbiddenException(
        "PRA is not enabled for this business. Contact the platform Super Admin.",
      );
    }
  }

  private mapInvoice(row: typeof taxAuthorityInvoices.$inferSelect): TaxInvoice {
    const status: TaxInvoiceStatus =
      row.status === "verified" ||
      row.status === "submitted" ||
      row.status === "failed" ||
      row.status === "submitting" ||
      row.status === "queued" ||
      row.status === "pending" ||
      row.status === "cancelled"
        ? row.status
        : "queued";
    return {
      id: row.id,
      authority: row.authority === "pra" ? "pra" : "fbr",
      invoiceMode: row.invoiceMode === "fake" ? "fake" : "real",
      sourceType:
        row.sourceType === "store_sale"
          ? "store_sale"
          : row.sourceType === "pharmacy_sale"
            ? "pharmacy_sale"
            : "bill",
      sourceId: row.sourceId,
      sourceRef: row.sourceRef,
      status,
      taxableAmountPkr: row.taxableAmountPkr,
      taxAmountPkr: row.taxAmountPkr,
      authorityInvoiceNumber: row.authorityInvoiceNumber,
      qrPayload: row.qrPayload,
      lastError: row.lastError,
      attemptCount: row.attemptCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private friendlyPraError(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    if (/invalid|unauthorized|401|403/i.test(message)) return "Invalid Credentials";
    if (/token.?expir|expired/i.test(message)) return "Token Expired";
    if (/timeout|AbortError/i.test(message)) return "Network Timeout";
    if (isPraNetworkError(message) || /fetch failed/i.test(message)) {
      return "Cloud cannot reach PRA — submit from POS Pay (shop IP)";
    }
    if (/unavailable|502|503|504/i.test(message)) return "Server Unavailable";
    if (/already.?submitted/i.test(message)) return "Invoice Already Submitted";
    if (/tax.?amount|invalid.?tax/i.test(message)) return "Invalid Tax Amount";
    if (/unauthorized.?branch|branch/i.test(message) && /unauthor/i.test(message)) {
      return "Unauthorized Branch";
    }
    return message || "Unknown Error";
  }

  private async writeActivityLog(input: {
    organizationId: string;
    branchId?: string | null;
    event: string;
    invoiceNumber?: string | null;
    praInvoiceNumber?: string | null;
    status: string;
    errorMessage?: string | null;
    retryCount?: number;
    /** When true, update the latest log for this invoice instead of inserting another row. */
    dedupeByInvoice?: boolean;
  }): Promise<void> {
    try {
      if (input.dedupeByInvoice && input.invoiceNumber) {
        const [latest] = await this.db
          .select()
          .from(taxAuthorityActivityLogs)
          .where(
            and(
              eq(taxAuthorityActivityLogs.organizationId, input.organizationId),
              eq(taxAuthorityActivityLogs.authority, "pra"),
              eq(taxAuthorityActivityLogs.invoiceNumber, input.invoiceNumber),
            ),
          )
          .orderBy(desc(taxAuthorityActivityLogs.createdAt))
          .limit(1);
        if (latest) {
          await this.db
            .update(taxAuthorityActivityLogs)
            .set({
              event: input.event,
              praInvoiceNumber: input.praInvoiceNumber ?? latest.praInvoiceNumber,
              status: input.status,
              errorMessage: input.errorMessage ?? null,
              retryCount: input.retryCount ?? latest.retryCount,
            })
            .where(eq(taxAuthorityActivityLogs.id, latest.id));
          return;
        }
      }
      await this.db.insert(taxAuthorityActivityLogs).values({
        organizationId: input.organizationId,
        branchId: input.branchId ?? null,
        authority: "pra",
        event: input.event,
        invoiceNumber: input.invoiceNumber ?? null,
        praInvoiceNumber: input.praInvoiceNumber ?? null,
        status: input.status,
        errorMessage: input.errorMessage ?? null,
        retryCount: input.retryCount ?? 0,
      });
    } catch (err) {
      this.logger.warn(
        `activity log write failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Public receipt-QR landing page: auto-search PRA e-IMS (their site ignores ?InvoiceNo=).
   */
  async renderPublicPraVerifyHtml(invoiceNumber: string): Promise<string> {
    const inv = invoiceNumber.trim();
    const official = inv
      ? `https://e.pra.punjab.gov.pk/public/eims.xhtml?InvoiceNo=${encodeURIComponent(inv)}`
      : "https://e.pra.punjab.gov.pk/public/eims.xhtml";

    if (!inv) {
      return renderPraVerifyShell({
        title: "PRA Invoice Verify",
        body: `
          <h1>PRA Invoice Verify</h1>
          <p class="muted">No Invoice No. in the QR link.</p>
          <p><a href="${escapeHtml(official)}">Open PRA e-IMS</a></p>`,
      });
    }

    try {
      const result = await this.lookupPublicPraInvoice(inv);
      if (!result.found) {
        return renderPraVerifyShell({
          title: `PRA — ${inv}`,
          body: `
            <h1>Invoice not found</h1>
            <p class="inv">${escapeHtml(inv)}</p>
            <p class="muted">${escapeHtml(result.message || "No records found on PRA e-IMS.")}</p>
            <p><a href="${escapeHtml(official)}">Open PRA e-IMS (manual search)</a></p>`,
        });
      }

      const itemRows = result.items
        .map(
          (it, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${escapeHtml(it.description)}</td>
            <td>${escapeHtml(it.quantity)}</td>
            <td>${escapeHtml(it.salePrice)}</td>
            <td>${escapeHtml(it.taxCharge)}</td>
            <td>${escapeHtml(it.total)}</td>
          </tr>`,
        )
        .join("");

      return renderPraVerifyShell({
        title: `PRA — ${inv}`,
        body: `
          <p class="badge">Verified on PRA e-IMS</p>
          <h1>${escapeHtml(result.businessName || "PRA Invoice")}</h1>
          <div class="card">
            <div><span>Invoice No.</span><strong>${escapeHtml(result.invoiceNumber)}</strong></div>
            <div><span>Invoice ID</span><strong>${escapeHtml(result.invoiceId || "—")}</strong></div>
            <div><span>Dated</span><strong>${escapeHtml(result.dated || "—")}</strong></div>
          </div>
          <table>
            <thead>
              <tr><th>#</th><th>Description</th><th>Qty</th><th>Sale</th><th>Tax</th><th>Total</th></tr>
            </thead>
            <tbody>${itemRows || `<tr><td colspan="6">No line items</td></tr>`}</tbody>
          </table>
          <div class="totals">
            <div><span>Gross Total</span><strong>${escapeHtml(result.grossTotal || "—")}</strong></div>
            <div><span>ST Charges</span><strong>${escapeHtml(result.stCharges || "—")}</strong></div>
            <div><span>Net Total</span><strong>${escapeHtml(result.netTotal || "—")}</strong></div>
          </div>
          <p class="muted"><a href="${escapeHtml(official)}">Official PRA portal</a></p>`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`public PRA verify failed for ${inv}: ${msg}`);
      return renderPraVerifyShell({
        title: `PRA — ${inv}`,
        body: `
          <h1>Could not auto-search</h1>
          <p class="inv">${escapeHtml(inv)}</p>
          <p class="muted">${escapeHtml(msg)}</p>
          <p>Copy the Invoice No. above, then open PRA and paste into search:</p>
          <p><a class="btn" href="${escapeHtml(official)}">Open PRA e-IMS</a></p>`,
      });
    }
  }

  /** GET+POST the public eims.xhtml search form (same as the PRA website search button). */
  private async lookupPublicPraInvoice(invoiceNumber: string): Promise<{
    found: boolean;
    message?: string;
    businessName?: string;
    invoiceNumber: string;
    invoiceId?: string;
    dated?: string;
    items: Array<{
      description: string;
      quantity: string;
      salePrice: string;
      taxCharge: string;
      total: string;
    }>;
    grossTotal?: string;
    stCharges?: string;
    netTotal?: string;
  }> {
    const eimsUrl = "https://e.pra.punjab.gov.pk/public/eims.xhtml";
    const getRes = await fetch(eimsUrl, {
      method: "GET",
      headers: { Accept: "text/html", "User-Agent": "PlatformPOS-PRA-Verify/1.0" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!getRes.ok) {
      throw new Error(`PRA e-IMS page unavailable (${getRes.status})`);
    }
    const getHtml = await getRes.text();
    const viewState = matchFirst(
      getHtml,
      /name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/i,
      /id="j_id1:javax\.faces\.ViewState:0"[^>]*value="([^"]+)"/i,
    );
    if (!viewState) {
      throw new Error("PRA e-IMS session token missing");
    }
    const searchBtn =
      matchFirst(getHtml, /invoiceVerificationCommand\s*=\s*function\(\)\s*\{PrimeFaces\.ab\(\{s:"([^"]+)"/i) ||
      "eimsForm:j_idt9";

    const cookie = collectSetCookies(getRes);
    const body = new URLSearchParams();
    body.set("eimsForm", "eimsForm");
    body.set("eimsForm:inputInvoiceNumber", invoiceNumber);
    body.set(searchBtn, "");
    body.set("javax.faces.ViewState", viewState);

    const postRes = await fetch(eimsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Accept: "text/html",
        "User-Agent": "PlatformPOS-PRA-Verify/1.0",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body.toString(),
      signal: AbortSignal.timeout(25_000),
      redirect: "follow",
    });
    const postHtml = await postRes.text();

    const businessName = stripTags(
      matchFirst(postHtml, /id="eimsForm:name"[^>]*>([^<]*)</i) || "",
    ).trim();
    const detailBlock =
      matchFirst(postHtml, /id="eimsForm:invoiceDetailPanel"[^>]*>([\s\S]*?)<\/span>/i) || "";
    const detailCells = [...detailBlock.matchAll(/<(?:th|td)[^>]*class="pra-txt-clr"[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map(
      (m) => stripTags(m[1] || "").trim(),
    );
    const foundInvoice = detailCells[0] || "";
    const invoiceId = detailCells[1] || "";
    const dated = detailCells[2] || "";

    if (!foundInvoice) {
      return {
        found: false,
        message: "No records found.",
        invoiceNumber,
        items: [],
      };
    }

    const items: Array<{
      description: string;
      quantity: string;
      salePrice: string;
      taxCharge: string;
      total: string;
    }> = [];
    const rowRe =
      /<tr[^>]*data-ri="\d+"[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRe.exec(postHtml)) !== null) {
      const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
        stripTags(m[1] || "").trim(),
      );
      // cells: Sr, Description, Qty, Sale, Tax, Total
      if (cells.length >= 6) {
        items.push({
          description: cells[1] || "",
          quantity: cells[2] || "",
          salePrice: cells[3] || "",
          taxCharge: cells[4] || "",
          total: cells[5] || "",
        });
      }
    }

    const grossTotal =
      matchFirst(postHtml, /Gross\s*Total[\s\S]{0,200}?<[^>]+>([0-9.,]+)/i) ||
      matchLabelValue(postHtml, "Gross Total");
    const stCharges =
      matchFirst(postHtml, /ST\s*Charges[\s\S]{0,200}?<[^>]+>([0-9.,]+)/i) ||
      matchLabelValue(postHtml, "ST Charges");
    const netTotal =
      matchFirst(postHtml, /Net\s*Total[\s\S]{0,200}?<[^>]+>([0-9.,]+)/i) ||
      matchLabelValue(postHtml, "Net Total");

    return {
      found: Boolean(foundInvoice),
      businessName,
      invoiceNumber: foundInvoice || invoiceNumber,
      invoiceId,
      dated,
      items,
      grossTotal,
      stCharges,
      netTotal,
    };
  }
}

function matchFirst(text: string, ...patterns: RegExp[]): string {
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1];
  }
  return "";
}

function collectSetCookies(res: Response): string {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const list =
    typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  if (list.length > 0) {
    return list.map((c) => c.split(";")[0]?.trim()).filter(Boolean).join("; ");
  }
  const raw = res.headers.get("set-cookie");
  if (!raw) return "";
  return raw
    .split(/,(?=\s*[^;=]+=)/)
    .map((c) => c.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

function matchLabelValue(html: string, label: string): string {
  const re = new RegExp(
    `${label.replace(/\s+/g, "\\s*")}[\\s\\S]{0,120}?<t[dh][^>]*>([\\s\\S]*?)</t[dh]>`,
    "i",
  );
  const m = html.match(re);
  return m?.[1] ? stripTags(m[1]).trim() : "";
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPraVerifyShell(input: { title: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(input.title)}</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      background: #f4f6f8; color: #122; padding: 20px 16px 40px; }
    main { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 14px;
      padding: 20px 18px; box-shadow: 0 8px 28px rgba(16,24,40,.08); }
    h1 { font-size: 1.25rem; margin: 8px 0 14px; }
    .badge { display: inline-block; background: #e8f7ee; color: #0b6b34;
      font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 999px; }
    .inv { font-size: 1.05rem; font-weight: 700; word-break: break-all; }
    .muted { color: #667085; font-size: 0.92rem; }
    .card { display: grid; gap: 10px; margin: 14px 0 18px; }
    .card > div, .totals > div { display: flex; justify-content: space-between; gap: 12px;
      padding: 10px 0; border-bottom: 1px solid #eef1f4; font-size: 0.95rem; }
    .card span, .totals span { color: #667085; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin: 8px 0 16px; }
    th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #eef1f4; vertical-align: top; }
    th { color: #667085; font-weight: 600; }
    .totals { margin-top: 4px; }
    a { color: #0b5fff; }
    .btn { display: inline-block; margin-top: 8px; background: #0b5fff; color: #fff !important;
      text-decoration: none; padding: 10px 14px; border-radius: 10px; font-weight: 600; }
  </style>
</head>
<body><main>${input.body}</main></body>
</html>`;
}
