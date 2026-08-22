import { Inject, Injectable, InternalServerErrorException, OnModuleInit, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import {
  moduleVersions,
  modules,
  organizationMemberships,
  organizations,
  popsBranches,
  popsRiders,
  refreshTokens,
  users,
  type PlatformPgDb,
} from "@platform/database-pg";
import * as bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import {
  applyOrgModuleCeiling,
  permissionsForPlatformRole,
  permissionsForPopsRole,
  systemTypeSchema,
  type PlatformRole,
  type SystemType,
} from "@platform/contracts";
import { DRIZZLE } from "../drizzle/drizzle.tokens";
import { SecurityService } from "../security/security.service";
import { PLATFORM_SENTINEL_ORG_ID, type AccessJwtPayload } from "./jwt.types";

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly security: SecurityService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedIfEmpty();
  }

  async seedIfEmpty(): Promise<void> {
    const password = this.config.get<string>("SEED_USER_PASSWORD") ?? "changeme-please-01";
    const passwordHash = await bcrypt.hash(password, 12);
    const adminPerms = permissionsForPopsRole("admin");

    const primarySuper =
      this.config.get<string>("SEED_SUPER_ADMIN_EMAIL") ?? "superadmin@pops.platform";
    const secondarySuper =
      this.config.get<string>("SEED_SUPER_ADMIN_EMAIL_2") ?? "owner@pops.platform";

    const superAdmins = [
      { email: primarySuper, name: "Platform Super Admin" },
      { email: secondarySuper, name: "Platform Owner" },
      // Legacy alias kept so older clients / docs keep working.
      { email: "superadmin@platform.local", name: "Super Admin (legacy)" },
    ];

    for (const sa of superAdmins) {
      const email = sa.email.trim().toLowerCase();
      const existing = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (existing.length === 0) {
        await this.db.insert(users).values({
          email,
          name: sa.name,
          passwordHash,
          platformRole: "super_admin",
          status: "active",
        });
      } else {
        await this.db
          .update(users)
          .set({
            platformRole: "super_admin",
            status: "active",
            name: sa.name,
          })
          .where(eq(users.email, email));
      }
    }

    const systemBusinesses: Array<{
      systemType: SystemType;
      name: string;
      adminEmail: string;
      adminName: string;
      branchCode: string;
      branchName: string;
      city: string;
    }> = [
      {
        systemType: "restaurant",
        name: "POPS Demo Restaurant",
        adminEmail: this.config.get<string>("SEED_USER_EMAIL") ?? "admin.restaurant@pops.demo",
        adminName: "Restaurant Owner",
        branchCode: "REST-HQ",
        branchName: "Restaurant HQ",
        city: "Islamabad",
      },
      {
        systemType: "pharmacy",
        name: "POPS Demo Pharmacy",
        adminEmail: "admin.pharmacy@pops.demo",
        adminName: "Pharmacy Owner",
        branchCode: "PHAR-HQ",
        branchName: "Pharmacy HQ",
        city: "Lahore",
      },
      {
        systemType: "general_store",
        name: "POPS Demo General Store",
        adminEmail: "admin.store@pops.demo",
        adminName: "Store Owner",
        branchCode: "STORE-HQ",
        branchName: "Store HQ",
        city: "Karachi",
      },
      {
        systemType: "grocery",
        name: "POPS Demo Grocery",
        adminEmail: "admin.grocery@pops.demo",
        adminName: "Grocery Owner",
        branchCode: "GROC-HQ",
        branchName: "Grocery HQ",
        city: "Islamabad",
      },
      {
        systemType: "retail",
        name: "POPS Demo Retail",
        adminEmail: "admin.retail@pops.demo",
        adminName: "Retail Owner",
        branchCode: "RETL-HQ",
        branchName: "Retail HQ",
        city: "Multan",
      },
    ];

    // Also keep legacy restaurant admin email mapped to restaurant demo.
    const legacyRestaurantAdmin = "admin@platform.local";

    for (const biz of systemBusinesses) {
      await this.ensureDemoBusiness({
        ...biz,
        passwordHash,
        adminPerms,
        alsoBindEmail: biz.systemType === "restaurant" ? legacyRestaurantAdmin : undefined,
      });
    }

    const existingModule = await this.db.select({ id: modules.id }).from(modules).where(eq(modules.slug, "sample")).limit(1);
    if (existingModule.length === 0) {
      await this.db.insert(modules).values({
        slug: "sample",
        displayName: "Sample Module",
        description: "Reference microfrontend remote for the launcher host.",
        publisher: "platform",
      });

      const mod = await this.db.select().from(modules).where(eq(modules.slug, "sample")).limit(1);
      const moduleRow = mod[0];
      if (!moduleRow) throw new Error("Failed to seed module");

      await this.db.insert(moduleVersions).values({
        moduleId: moduleRow.id,
        semver: "0.1.0",
        artifactUrl: "http://127.0.0.1:5001/assets/remoteEntry.js",
        digestSha256: "0".repeat(64),
      });
    }
  }

  private async ensureDemoBusiness(input: {
    systemType: SystemType;
    name: string;
    adminEmail: string;
    adminName: string;
    branchCode: string;
    branchName: string;
    city: string;
    passwordHash: string;
    adminPerms: string[];
    alsoBindEmail?: string;
  }): Promise<void> {
    const adminEmail = input.adminEmail.trim().toLowerCase();
    // Dedicated demo org only — never pick the first active business of this type
    // (that overwrote Super Admin–created clients with name/plan "demo").
    const demoLicenceKey = `LIC-DEMO-${input.systemType.toUpperCase()}`;
    let orgId: string | undefined;

    const byKey = await this.db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.licenceKey, demoLicenceKey))
      .limit(1);
    orgId = byKey[0]?.id;

    if (!orgId) {
      const [org] = await this.db
        .insert(organizations)
        .values({
          name: input.name,
          systemType: input.systemType,
          status: "active",
          licencePlan: "demo",
          licenceKey: demoLicenceKey,
        })
        .returning({ id: organizations.id });
      orgId = org?.id;
    } else {
      // Respect Super Admin soft-delete — never resurrect LIC-DEMO-* orgs on API boot.
      const existing = await this.db
        .select({ id: organizations.id, status: organizations.status })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);
      if (existing[0]?.status === "deleted") {
        return;
      }
      await this.db
        .update(organizations)
        .set({
          name: input.name,
          licencePlan: "demo",
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, orgId));
    }

    if (!orgId) throw new Error(`Failed to seed organization for ${input.systemType}`);

    const ensureOwner = async (email: string, name: string) => {
      const existing = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      let userId = existing[0]?.id;
      if (!userId) {
        const [created] = await this.db
          .insert(users)
          .values({
            email,
            name,
            passwordHash: input.passwordHash,
            status: "active",
          })
          .returning({ id: users.id });
        userId = created?.id;
      } else {
        await this.db
          .update(users)
          .set({ name, status: "active" })
          .where(eq(users.id, userId));
      }
      if (!userId) throw new Error(`Failed to seed owner ${email}`);

      const mem = await this.db
        .select({ userId: organizationMemberships.userId })
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, orgId!),
            eq(organizationMemberships.userId, userId),
          ),
        )
        .limit(1);
      if (mem.length === 0) {
        await this.db.insert(organizationMemberships).values({
          organizationId: orgId!,
          userId,
          role: "owner",
          permissions: input.adminPerms,
          branchScope: "all",
          pinRequired: false,
          active: true,
          lastActivityAt: new Date(),
        });
      } else {
        await this.db
          .update(organizationMemberships)
          .set({
            role: "owner",
            permissions: input.adminPerms,
            branchScope: "all",
            active: true,
          })
          .where(
            and(
              eq(organizationMemberships.organizationId, orgId!),
              eq(organizationMemberships.userId, userId),
            ),
          );
      }

      await this.db.update(organizations).set({ createdBy: userId }).where(eq(organizations.id, orgId!));
      return userId;
    };

    await ensureOwner(adminEmail, input.adminName);
    if (input.alsoBindEmail && input.alsoBindEmail !== adminEmail) {
      await ensureOwner(input.alsoBindEmail.trim().toLowerCase(), "Restaurant Admin");
    }

    const branch = await this.db
      .select({ id: popsBranches.id })
      .from(popsBranches)
      .where(and(eq(popsBranches.organizationId, orgId), eq(popsBranches.code, input.branchCode)))
      .limit(1);
    if (branch.length === 0) {
      await this.db.insert(popsBranches).values({
        organizationId: orgId,
        code: input.branchCode,
        name: input.branchName,
        city: input.city,
      });
    }
  }

  async login(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const row = await this.db
      .select({
        id: users.id,
        email: users.email,
        passwordHash: users.passwordHash,
        status: users.status,
        platformRole: users.platformRole,
      })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);
    // Case-insensitive fallback for older rows stored with mixed case.
    const user =
      row[0] ??
      (
        await this.db
          .select({
            id: users.id,
            email: users.email,
            passwordHash: users.passwordHash,
            status: users.status,
            platformRole: users.platformRole,
          })
          .from(users)
          .where(sql`lower(${users.email}) = ${normalizedEmail}`)
          .limit(1)
      )[0];
    if (!user) {
      await this.security.logEvent({
        eventType: "login_failed",
        userEmail: normalizedEmail,
        action: "Login failed",
        detail: "Unknown email",
      });
      throw new UnauthorizedException("Invalid credentials");
    }

    if (
      user.status === "inactive" ||
      user.status === "suspended" ||
      user.status === "deleted" ||
      user.email.toLowerCase().endsWith("@deleted.local")
    ) {
      throw new UnauthorizedException("Account deactivated. Contact an administrator.");
    }

    const ok = await bcrypt.compare(password, user.passwordHash).catch((err: unknown) => {
      console.error(
        "[auth] bcrypt.compare failed:",
        err instanceof Error ? err.message : String(err),
      );
      return false;
    });
    if (!ok) {
      const membership = await this.loadMembershipLite(user.id);

      await this.security.logEvent({
        organizationId: membership?.organizationId ?? null,
        eventType: "login_failed",
        userEmail: normalizedEmail,
        userId: user.id,
        action: "Login failed",
        detail: "Invalid password",
      });
      throw new UnauthorizedException("Invalid credentials");
    }

    // Platform Super Admin — no org membership required.
    if (user.platformRole === "super_admin") {
      await this.security.logEvent({
        eventType: "login_success",
        userEmail: normalizedEmail,
        userId: user.id,
        action: "Login success",
        detail: "Super Admin session started",
      });

      try {
        return await this.issueTokens({
          userId: user.id,
          organizationId: PLATFORM_SENTINEL_ORG_ID,
          permissions: permissionsForPlatformRole("super_admin"),
          role: "super_admin",
          branchScope: "all",
          platformRole: "super_admin",
          systemType: null,
          navAllowlist: null,
        });
      } catch (err) {
        console.error("[auth] issueTokens failed:", err instanceof Error ? err.message : String(err));
        if (err instanceof UnauthorizedException || err instanceof InternalServerErrorException) throw err;
        throw new InternalServerErrorException(
          "Login succeeded but session could not be created. Check JWT_ACCESS_SECRET and DB schema (drizzle push).",
        );
      }
    }

    const membership = await this.db
      .select({
        membership: organizationMemberships,
        org: organizations,
      })
      .from(organizationMemberships)
      .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
      .where(eq(organizationMemberships.userId, user.id))
      .limit(1);

    const row0 = membership[0];
    if (!row0) throw new UnauthorizedException("No organization membership");

    const m = row0.membership;
    let org = row0.org;

    if (org.status === "deleted" || org.status === "suspended" || org.status === "inactive") {
      // Soft-deleted businesses stay deleted (Super Admin Delete). Only reactivate
      // suspended/inactive seed demos on login — never status "deleted".
      const isSeedDemoOrg =
        typeof org.licenceKey === "string" && org.licenceKey.toUpperCase().startsWith("LIC-DEMO-");
      const isDemoEmail =
        normalizedEmail.endsWith("@pops.demo") ||
        normalizedEmail ===
          (this.config.get<string>("SEED_USER_EMAIL") ?? "admin.restaurant@pops.demo").toLowerCase();
      if (org.status !== "deleted" && isSeedDemoOrg && isDemoEmail) {
        const [restored] = await this.db
          .update(organizations)
          .set({ status: "active", updatedAt: new Date() })
          .where(eq(organizations.id, org.id))
          .returning();
        if (restored) org = restored;
      }
    }

    if (org.status === "deleted" || org.status === "suspended" || org.status === "inactive") {
      throw new UnauthorizedException(
        `This business is ${org.status}. Contact the platform administrator.`,
      );
    }

    if (org.licenceExpiresAt && org.licenceExpiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException(
        "Software licence expired. Contact the platform administrator to renew (5-day or monthly).",
      );
    }

    if (m.active === false) {
      await this.security.logEvent({
        organizationId: m.organizationId,
        eventType: "login_failed",
        userEmail: normalizedEmail,
        userId: user.id,
        action: "Login failed",
        detail: "Account deactivated",
      });
      throw new UnauthorizedException("Account deactivated. Contact an administrator.");
    }

    const systemType = parseSystemType(org.systemType);

    await this.touchLastActivity(m.organizationId, user.id);

    await this.security.logEvent({
      organizationId: m.organizationId,
      eventType: "login_success",
      userEmail: normalizedEmail,
      userId: user.id,
      action: "Login success",
      detail: `Session started (${systemType})`,
    });

    try {
      return await this.issueTokens({
        userId: user.id,
        organizationId: m.organizationId,
        permissions: applyOrgModuleCeiling(
          normalizePermissions(m.permissions, m.role),
          org.enabledModules,
        ),
        role: m.role,
        branchScope: m.branchScope ?? "all",
        platformRole: null,
        systemType,
        navAllowlist: Array.isArray(m.navAllowlist) ? m.navAllowlist : null,
      });
    } catch (err) {
      console.error("[auth] issueTokens failed:", err instanceof Error ? err.message : String(err));
      if (err instanceof UnauthorizedException || err instanceof InternalServerErrorException) throw err;
      throw new InternalServerErrorException(
        "Login succeeded but session could not be created. Check JWT_ACCESS_SECRET and DB schema (drizzle push).",
      );
    }
  }

  async pinLogin(branchCode: string, pin: string) {
    const code = branchCode.trim().toUpperCase();
    const branchRows = await this.db
      .select({ organizationId: popsBranches.organizationId })
      .from(popsBranches)
      .where(eq(popsBranches.code, code))
      .limit(1);
    const branch = branchRows[0];
    if (!branch) throw new UnauthorizedException("Branch not found");

    const orgRows = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, branch.organizationId))
      .limit(1);
    const org = orgRows[0];
    if (!org || org.status !== "active") {
      throw new UnauthorizedException("This business is not active.");
    }
    if (org.licenceExpiresAt && org.licenceExpiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException(
        "Software licence expired. Contact the platform administrator to renew.",
      );
    }
    const systemType = parseSystemType(org.systemType);

    const memberships = await this.db
      .select({
        userId: organizationMemberships.userId,
        organizationId: organizationMemberships.organizationId,
        permissions: organizationMemberships.permissions,
        role: organizationMemberships.role,
        branchScope: organizationMemberships.branchScope,
        staffPinHash: organizationMemberships.staffPinHash,
        active: organizationMemberships.active,
        navAllowlist: organizationMemberships.navAllowlist,
        email: users.email,
        userStatus: users.status,
      })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(
        and(
          eq(organizationMemberships.organizationId, branch.organizationId),
          isNotNull(organizationMemberships.staffPinHash),
        ),
      );

    const eligible = memberships.filter(
      (row) =>
        row.active !== false &&
        row.userStatus === "active" &&
        row.staffPinHash &&
        (row.branchScope === "all" || row.branchScope.toUpperCase() === code),
    );

    for (const row of eligible) {
      if (!row.staffPinHash) continue;
      const ok = await bcrypt.compare(pin, row.staffPinHash);
      if (!ok) continue;

      await this.touchLastActivity(row.organizationId, row.userId);

      await this.security.logEvent({
        organizationId: row.organizationId,
        eventType: "login_success",
        userEmail: row.email,
        userId: row.userId,
        action: "PIN login success",
        detail: `Branch ${code}`,
      });

      return this.issueTokens({
        userId: row.userId,
        organizationId: row.organizationId,
        permissions: applyOrgModuleCeiling(
          normalizePermissions(row.permissions, row.role),
          org.enabledModules,
        ),
        role: row.role,
        branchScope: row.branchScope ?? "all",
        platformRole: null,
        systemType,
        navAllowlist: Array.isArray(row.navAllowlist) ? row.navAllowlist : null,
      });
    }

    await this.security.logEvent({
      organizationId: branch.organizationId,
      eventType: "login_failed",
      userEmail: `pin@${code.toLowerCase()}`,
      action: "PIN login failed",
      detail: `Branch ${code}`,
    });
    throw new UnauthorizedException("Invalid PIN for this branch");
  }

  async refresh(refreshToken: string) {
    const tokenHash = sha256Hex(refreshToken);
    const row = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);

    const rt = row[0];
    if (!rt) throw new UnauthorizedException("Invalid refresh token");
    if (rt.expiresAt.getTime() < Date.now()) throw new UnauthorizedException("Refresh expired");

    const userRows = await this.db.select().from(users).where(eq(users.id, rt.userId)).limit(1);
    const user = userRows[0];
    if (!user || user.status !== "active") {
      throw new UnauthorizedException("Account deactivated. Contact an administrator.");
    }

    await this.db.delete(refreshTokens).where(eq(refreshTokens.id, rt.id));

    if (user.platformRole === "super_admin") {
      return this.issueTokens({
        userId: user.id,
        organizationId: PLATFORM_SENTINEL_ORG_ID,
        permissions: permissionsForPlatformRole("super_admin"),
        role: "super_admin",
        branchScope: "all",
        platformRole: "super_admin",
        systemType: null,
        navAllowlist: null,
      });
    }

    const membership = await this.db
      .select({
        membership: organizationMemberships,
        org: organizations,
      })
      .from(organizationMemberships)
      .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
      .where(eq(organizationMemberships.userId, rt.userId))
      .limit(1);

    const row0 = membership[0];
    if (!row0) throw new UnauthorizedException("No organization membership");
    const m = row0.membership;
    if (m.active === false) throw new UnauthorizedException("Account deactivated. Contact an administrator.");
    if (row0.org.status !== "active") {
      throw new UnauthorizedException(`This business is ${row0.org.status}.`);
    }
    if (row0.org.licenceExpiresAt && row0.org.licenceExpiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException("Software licence expired. Contact the platform administrator to renew.");
    }

    return this.issueTokens({
      userId: rt.userId,
      organizationId: m.organizationId,
      permissions: applyOrgModuleCeiling(
        normalizePermissions(m.permissions, m.role),
        row0.org.enabledModules,
      ),
      role: m.role,
      branchScope: m.branchScope ?? "all",
      platformRole: null,
      systemType: parseSystemType(row0.org.systemType),
      navAllowlist: Array.isArray(m.navAllowlist) ? m.navAllowlist : null,
    });
  }

  /** Minimal membership lookup (never selects optional columns). */
  private async loadMembershipLite(
    userId: string,
  ): Promise<{ organizationId: string } | undefined> {
    const rows = await this.db
      .select({ organizationId: organizationMemberships.organizationId })
      .from(organizationMemberships)
      .where(eq(organizationMemberships.userId, userId))
      .limit(1);
    return rows[0];
  }

  private async touchLastActivity(organizationId: string, userId: string): Promise<void> {
    try {
      await this.db
        .update(organizationMemberships)
        .set({ lastActivityAt: new Date() })
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.userId, userId),
          ),
        );
    } catch (err) {
      console.warn(
        "[auth] lastActivityAt update skipped:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private async issueTokens(opts: {
    userId: string;
    organizationId: string;
    permissions: string[];
    role: string;
    branchScope: string;
    platformRole: PlatformRole | null;
    systemType: SystemType | null;
    navAllowlist: string[] | null;
  }) {
    let riderId: string | undefined;
    if (opts.role === "rider" && opts.organizationId !== PLATFORM_SENTINEL_ORG_ID) {
      const riders = await this.db
        .select({ id: popsRiders.id })
        .from(popsRiders)
        .where(eq(popsRiders.userId, opts.userId))
        .limit(1);
      riderId = riders[0]?.id;
    }

    const accessPayload: AccessJwtPayload = {
      sub: opts.userId,
      organizationId: opts.organizationId,
      permissions: opts.permissions,
      role: opts.role,
      branchScope: opts.branchScope,
      platformRole: opts.platformRole,
      systemType: opts.systemType,
      navAllowlist: opts.navAllowlist,
      ...(riderId ? { riderId } : {}),
    };

    const accessTtl = this.config.get<string>("JWT_ACCESS_TTL") ?? "15m";
    const refreshTtlDays = Number(this.config.get<string>("JWT_REFRESH_TTL_DAYS") ?? "30");
    const accessExpiresIn = parseExpiresInSeconds(accessTtl);

    let accessToken: string;
    try {
      accessToken = await this.jwt.signAsync(accessPayload, {
        expiresIn: accessExpiresIn,
      });
    } catch (err) {
      console.error(
        "[auth] JWT sign failed:",
        err instanceof Error ? err.message : String(err),
      );
      throw new InternalServerErrorException(
        "Auth token signing failed. Set JWT_ACCESS_SECRET (min 32 chars) on Railway.",
      );
    }

    const refreshToken = randomBytes(48).toString("base64url");
    const refreshHash = sha256Hex(refreshToken);
    const expiresAt = new Date(Date.now() + refreshTtlDays * 86_400_000);

    try {
      await this.db.insert(refreshTokens).values({
        userId: opts.userId,
        tokenHash: refreshHash,
        expiresAt,
      });
    } catch (err) {
      console.warn(
        "[auth] refresh token persist skipped:",
        err instanceof Error ? err.message : String(err),
      );
    }

    return {
      accessToken,
      refreshToken,
      expiresIn: accessExpiresIn,
    };
  }
}

function parseSystemType(value: string): SystemType {
  const parsed = systemTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : "restaurant";
}

function normalizePermissions(value: unknown, role: string): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return permissionsForPopsRole(role);
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseExpiresInSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!match) return 900;
  const n = Number(match[1]);
  const u = match[2];
  const mult = u === "s" ? 1 : u === "m" ? 60 : u === "h" ? 3600 : 86_400;
  return n * mult;
}
