import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from "@nestjs/common";
import { and, eq, isNull, ne } from "drizzle-orm";
import {
  POPS_CAPABILITIES,
  POPS_ROLE_TEMPLATES,
  permissionsForPopsRole,
  type AcceptInvite,
  type CreateOrgUser,
  type InviteOrgUser,
  type UpdateOrgUser,
} from "@platform/contracts";
import {
  entityDeletionBackups,
  organizationMemberships,
  organizations,
  refreshTokens,
  userInvites,
  users,
  type PlatformPgDb,
} from "@platform/database-pg";
import * as bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { DRIZZLE } from "../drizzle/drizzle.tokens";
import { DeliveryService } from "../delivery/delivery.service";
import { MailService } from "../mail/mail.service";
import {
  findLiveLoginUserByEmail,
  isDeletedLoginUser,
  isTombstoneEmail,
  tombstoneLoginEmail,
} from "../lib/login-email";

const STAFF_SEEDS = [
  {
    email: "cashier1@platform.local",
    password: "changeme-please-01",
    role: "cashier",
    branchScope: "ISB-GT",
    pinRequired: true,
  },
  {
    email: "manager1@platform.local",
    password: "changeme-please-01",
    role: "manager",
    branchScope: "ISB-GT",
    pinRequired: true,
  },
  {
    email: "accountant1@platform.local",
    password: "changeme-please-01",
    role: "accountant",
    branchScope: "ISB-GT",
    pinRequired: false,
  },
  {
    email: "kitchen1@platform.local",
    password: "changeme-please-01",
    role: "kitchen",
    branchScope: "ISB-GT",
    pinRequired: true,
  },
  {
    email: "waiter1@platform.local",
    password: "changeme-please-01",
    role: "waiter",
    branchScope: "ISB-GT",
    pinRequired: false,
  },
  {
    email: "waiter2@platform.local",
    password: "changeme-please-01",
    role: "waiter",
    branchScope: "ISB-GT",
    pinRequired: false,
  },
  {
    email: "rider1@platform.local",
    password: "changeme-please-01",
    role: "rider",
    branchScope: "ISB-GT",
    pinRequired: false,
  },
  {
    email: "hr1@platform.local",
    password: "changeme-please-01",
    role: "hr",
    branchScope: "ISB-GT",
    pinRequired: false,
  },
] as const;

const STAFF_DEFAULT_PINS: Record<string, string> = {
  "cashier1@platform.local": "2222",
  "manager1@platform.local": "3333",
  "kitchen1@platform.local": "4444",
  "waiter1@platform.local": "1111",
  "waiter2@platform.local": "5555",
  "rider1@platform.local": "6666",
};

async function hashStaffPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

@Injectable()
export class UsersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly delivery: DeliveryService,
  ) {}

  onApplicationBootstrap(): void {
    void (async () => {
      await this.upgradeOwnerPermissions();
      await this.upgradeRiderPermissions();
      await this.seedStaffIfMissing();
      await this.upgradeStaffPins();
    })().catch((err) => {
      this.logger.warn(
        `User bootstrap skipped — run pnpm db:push if the schema changed: ${err instanceof Error ? err.message : err}`,
      );
    });
  }

  async upgradeOwnerPermissions(): Promise<void> {
    const rows = await this.db
      .select()
      .from(organizationMemberships)
      .where(eq(organizationMemberships.role, "owner"));

    for (const row of rows) {
      const perms = new Set(row.permissions);
      perms.add("pops.users.manage");
      perms.add("pops.menu.manage");
      perms.add("*");
      await this.db
        .update(organizationMemberships)
        .set({
          permissions: [...perms],
          branchScope: row.branchScope ?? "all",
        })
        .where(
          and(
            eq(organizationMemberships.organizationId, row.organizationId),
            eq(organizationMemberships.userId, row.userId),
          ),
        );
    }
  }

  async upgradeRiderPermissions(): Promise<void> {
    const rows = await this.db
      .select()
      .from(organizationMemberships)
      .where(eq(organizationMemberships.role, "rider"));

    for (const row of rows) {
      const perms = new Set(row.permissions);
      perms.add("pops.delivery.manage");
      await this.db
        .update(organizationMemberships)
        .set({ permissions: [...perms] })
        .where(
          and(
            eq(organizationMemberships.organizationId, row.organizationId),
            eq(organizationMemberships.userId, row.userId),
          ),
        );
    }
  }

  async seedStaffIfMissing(): Promise<void> {
    const org = await this.db.select({ id: organizations.id }).from(organizations).limit(1);
    const organizationId = org[0]?.id;
    if (!organizationId) return;

    for (const seed of STAFF_SEEDS) {
      const existing = await this.db.select({ id: users.id }).from(users).where(eq(users.email, seed.email)).limit(1);
      let userId = existing[0]?.id;

      if (!userId) {
        const passwordHash = await bcrypt.hash(seed.password, 12);
        const [user] = await this.db.insert(users).values({ email: seed.email, passwordHash }).returning();
        if (!user) continue;
        userId = user.id;
      }

      const membership = await this.db
        .select({ userId: organizationMemberships.userId })
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.userId, userId),
          ),
        )
        .limit(1);

      if (membership.length > 0) continue;

      const defaultPin = STAFF_DEFAULT_PINS[seed.email];
      const staffPinHash = defaultPin ? await hashStaffPin(defaultPin) : null;

      await this.db.insert(organizationMemberships).values({
        organizationId,
        userId,
        role: seed.role,
        permissions: permissionsForPopsRole(seed.role),
        branchScope: seed.branchScope,
        pinRequired: seed.pinRequired,
        staffPinHash,
        lastActivityAt: new Date(Date.now() - (seed.role === "cashier" ? 9 * 60_000 : 11 * 60_000)),
      });
    }
  }

  async upgradeStaffPins(): Promise<void> {
    for (const [email, pin] of Object.entries(STAFF_DEFAULT_PINS)) {
      const userRows = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      const userId = userRows[0]?.id;
      if (!userId) continue;

      const membershipRows = await this.db
        .select({
          organizationId: organizationMemberships.organizationId,
          staffPinHash: organizationMemberships.staffPinHash,
        })
        .from(organizationMemberships)
        .where(eq(organizationMemberships.userId, userId))
        .limit(1);
      const membership = membershipRows[0];
      if (!membership || membership.staffPinHash) continue;

      await this.db
        .update(organizationMemberships)
        .set({ staffPinHash: await hashStaffPin(pin) })
        .where(
          and(
            eq(organizationMemberships.organizationId, membership.organizationId),
            eq(organizationMemberships.userId, userId),
          ),
        );
    }
  }

  getAccessControl() {
    return {
      capabilities: POPS_CAPABILITIES,
      roles: POPS_ROLE_TEMPLATES.filter((r) => ["admin", "cashier", "kitchen", "manager"].includes(r.id)),
    };
  }

  /** Staff who can print (for printer-section assignment). Uses pops.read — not pops.users.manage. */
  async listAssignableStaff(organizationId: string, branchCode?: string) {
    const printRoles = new Set([
      "waiter",
      "cashier",
      "kitchen",
      "manager",
      "rider",
      "admin",
      "owner",
    ]);
    const code = branchCode?.trim().toUpperCase();

    let rows: Array<{
      id: string;
      email: string;
      role: string;
      branchScope: string;
      active?: boolean | null;
    }>;

    try {
      rows = await this.db
        .select({
          id: users.id,
          email: users.email,
          role: organizationMemberships.role,
          branchScope: organizationMemberships.branchScope,
          active: organizationMemberships.active,
        })
        .from(organizationMemberships)
        .innerJoin(users, eq(users.id, organizationMemberships.userId))
        .where(eq(organizationMemberships.organizationId, organizationId));
    } catch (err) {
      this.logger.warn(
        `listAssignableStaff full select failed; using core columns: ${err instanceof Error ? err.message : String(err)}`,
      );
      rows = await this.db
        .select({
          id: users.id,
          email: users.email,
          role: organizationMemberships.role,
          branchScope: organizationMemberships.branchScope,
        })
        .from(organizationMemberships)
        .innerJoin(users, eq(users.id, organizationMemberships.userId))
        .where(eq(organizationMemberships.organizationId, organizationId));
    }

    return rows
      .filter((row) => printRoles.has(row.role))
      .filter((row) => row.active !== false)
      .filter((row) => {
        if (!code) return true;
        const scope = row.branchScope.trim().toUpperCase();
        return scope === "ALL" || scope === code;
      })
      .map((row) => ({
        id: row.id,
        email: row.email,
        name: staffDisplayName(row.email),
        role: formatRoleLabel(row.role),
        branchScope: row.branchScope === "all" ? "All" : row.branchScope,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async listUsers(organizationId: string) {
    // Core columns first — Railway DBs may still be missing active/nav_allowlist
    // until ensure-schema runs on boot.
    let rows: Array<{
      id: string;
      email: string;
      role: string;
      branchScope: string;
      pinRequired: boolean;
      permissions: unknown;
      active?: boolean | null;
      navAllowlist?: unknown;
      lastActivityAt?: Date | null;
    }>;

    try {
      rows = await this.db
        .select({
          id: users.id,
          email: users.email,
          role: organizationMemberships.role,
          branchScope: organizationMemberships.branchScope,
          pinRequired: organizationMemberships.pinRequired,
          permissions: organizationMemberships.permissions,
          active: organizationMemberships.active,
          navAllowlist: organizationMemberships.navAllowlist,
          lastActivityAt: organizationMemberships.lastActivityAt,
        })
        .from(organizationMemberships)
        .innerJoin(users, eq(users.id, organizationMemberships.userId))
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            ne(users.status, "deleted"),
          ),
        );
    } catch (err) {
      this.logger.warn(
        `listUsers full select failed; using core columns: ${err instanceof Error ? err.message : String(err)}`,
      );
      rows = await this.db
        .select({
          id: users.id,
          email: users.email,
          role: organizationMemberships.role,
          branchScope: organizationMemberships.branchScope,
          pinRequired: organizationMemberships.pinRequired,
          permissions: organizationMemberships.permissions,
        })
        .from(organizationMemberships)
        .innerJoin(users, eq(users.id, organizationMemberships.userId))
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            ne(users.status, "deleted"),
          ),
        );
    }

    return rows
      .filter((row) => !isTombstoneEmail(row.email))
      .map((row) => ({
        id: row.id,
        email: row.email,
        role: formatRoleLabel(row.role),
        branchScope: row.branchScope === "all" ? "All" : row.branchScope,
        pinRequired: row.pinRequired,
        permissions: Array.isArray(row.permissions) ? row.permissions : [],
        active: row.active !== false,
        navAllowlist: Array.isArray(row.navAllowlist) ? row.navAllowlist : null,
        lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
      }));
  }

  async createUser(organizationId: string, input: CreateOrgUser) {
    const email = normalizeEmail(input.email);
    const existing = await findLiveLoginUserByEmail(this.db, email);
    if (existing) {
      throw new ConflictException(
        `Login email already in use: ${email}. Customer emails are separate — use a different login email.`,
      );
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const [user] = await this.db
      .insert(users)
      .values({ email, passwordHash, lastSetPassword: input.password })
      .returning();
    if (!user) throw new BadRequestException("Failed to create user");

    const branchScope = input.branchScope.trim() === "All" ? "all" : input.branchScope.trim().toUpperCase();
    const staffPinHash = input.staffPin ? await hashStaffPin(input.staffPin) : null;

    await this.db.insert(organizationMemberships).values({
      organizationId,
      userId: user.id,
      role: input.role,
      permissions: permissionsForPopsRole(input.role),
      branchScope,
      pinRequired: input.pinRequired,
      staffPinHash,
      lastActivityAt: null,
    });

    if (input.role === "rider") {
      await this.delivery.ensureRiderProfileForUser(organizationId, user.id, branchScope);
    }

    return this.getUser(organizationId, user.id);
  }

  async updateUser(organizationId: string, userId: string, input: UpdateOrgUser) {
    const membership = await this.getMembership(organizationId, userId);

    if (membership.role === "owner" && input.role && input.role !== "admin") {
      throw new BadRequestException("Cannot change the organization owner role");
    }
    if (membership.role === "owner" && input.active === false) {
      throw new BadRequestException("Cannot deactivate the organization owner");
    }

    if (input.password) {
      const passwordHash = await bcrypt.hash(input.password, 12);
      await this.db
        .update(users)
        .set({ passwordHash, lastSetPassword: input.password })
        .where(eq(users.id, userId));
    }

    const patch: Partial<typeof organizationMemberships.$inferInsert> = {};
    if (input.role !== undefined) {
      patch.role = input.role;
      patch.permissions = permissionsForPopsRole(input.role);
    }
    if (input.permissions !== undefined) {
      const cleaned = [...new Set(input.permissions.map((p) => p.trim()).filter(Boolean))];
      patch.permissions = cleaned.length > 0 ? cleaned : ["pops.read"];
    }
    if (input.branchScope !== undefined) {
      patch.branchScope = input.branchScope.trim() === "All" ? "all" : input.branchScope.trim().toUpperCase();
    }
    if (input.pinRequired !== undefined) patch.pinRequired = input.pinRequired;
    if (input.active !== undefined) patch.active = input.active;
    if (input.navAllowlist !== undefined) {
      patch.navAllowlist =
        input.navAllowlist === null
          ? null
          : [...new Set(input.navAllowlist.map((p) => p.trim()).filter(Boolean))];
    }
    if (input.staffPin !== undefined) {
      patch.staffPinHash = await hashStaffPin(input.staffPin);
    }

    if (Object.keys(patch).length > 0) {
      await this.db
        .update(organizationMemberships)
        .set(patch)
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.userId, userId),
          ),
        );
    }

    const nextRole = input.role ?? membership.role;
    if (nextRole === "rider") {
      const nextScope =
        input.branchScope !== undefined
          ? input.branchScope.trim() === "All"
            ? "all"
            : input.branchScope.trim().toUpperCase()
          : membership.branchScope;
      await this.delivery.ensureRiderProfileForUser(organizationId, userId, nextScope);
    }

    return this.getUser(organizationId, userId);
  }

  /**
   * Soft-delete from this org: frees login email when the user has no other live
   * memberships (same tombstone pattern as Super Admin delete).
   */
  async deleteUser(organizationId: string, actorId: string, userId: string) {
    if (actorId === userId) {
      throw new BadRequestException("Cannot delete your own account");
    }
    const membership = await this.getMembership(organizationId, userId);
    if (membership.role === "owner") {
      throw new BadRequestException("Cannot delete the organization owner");
    }

    const [target] = await this.db
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
    if (!target || isDeletedLoginUser(target)) {
      throw new NotFoundException("User not found");
    }
    if (target.platformRole === "super_admin") {
      throw new BadRequestException("Cannot delete the Super Admin account");
    }

    await this.db.insert(entityDeletionBackups).values({
      entityType: "user",
      entityId: userId,
      originalEmail: target.email,
      label: target.name ?? target.email,
      deletedBy: actorId,
      payload: {
        user: target,
        organizationId,
        membership,
        deletedAt: new Date().toISOString(),
      },
    });

    await this.db
      .update(organizationMemberships)
      .set({ active: false })
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.userId, userId),
        ),
      );

    const otherLive = await this.db
      .select({ organizationId: organizationMemberships.organizationId })
      .from(organizationMemberships)
      .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
      .where(
        and(
          eq(organizationMemberships.userId, userId),
          ne(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.active, true),
          ne(organizations.status, "deleted"),
        ),
      )
      .limit(1);

    if (otherLive.length === 0) {
      if (isTombstoneEmail(target.email)) {
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

    return { ok: true as const };
  }

  async resetPassword(organizationId: string, userId: string, password: string) {
    await this.getMembership(organizationId, userId);
    const passwordHash = await bcrypt.hash(password, 12);
    await this.db
      .update(users)
      .set({ passwordHash, lastSetPassword: password })
      .where(eq(users.id, userId));
    return { ok: true };
  }

  /** Self-service — a staff member creating/updating/removing their own PIN (no admin permission needed). */
  async setOwnPin(organizationId: string, userId: string, pin: string | null) {
    await this.getMembership(organizationId, userId);
    const staffPinHash = pin ? await hashStaffPin(pin) : null;
    await this.db
      .update(organizationMemberships)
      .set({ staffPinHash })
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.userId, userId),
        ),
      );
    return { ok: true, pinSet: staffPinHash !== null };
  }

  async listPendingInvites(organizationId: string) {
    const rows = await this.db
      .select()
      .from(userInvites)
      .where(and(eq(userInvites.organizationId, organizationId), isNull(userInvites.acceptedAt)));

    return rows
      .filter((row) => row.expiresAt.getTime() > Date.now())
      .map((row) => ({
        id: row.id,
        email: row.email,
        role: formatRoleLabel(row.role),
        branchScope: row.branchScope === "all" ? "All" : row.branchScope,
        pinRequired: row.pinRequired,
        expiresAt: row.expiresAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      }));
  }

  async inviteUser(organizationId: string, input: InviteOrgUser) {
    const email = normalizeEmail(input.email);
    const existing = await findLiveLoginUserByEmail(this.db, email);
    if (existing) {
      throw new ConflictException(
        `Login email already in use: ${email}. Customer emails are separate — use a different login email.`,
      );
    }

    const pending = await this.db
      .select({ id: userInvites.id })
      .from(userInvites)
      .where(
        and(
          eq(userInvites.organizationId, organizationId),
          eq(userInvites.email, email),
          isNull(userInvites.acceptedAt),
        ),
      )
      .limit(1);

    if (pending.length > 0) throw new ConflictException(`An invite is already pending for ${email}`);

    const token = randomBytes(32).toString("base64url");
    const tokenHash = sha256Hex(token);
    const expiresAt = new Date(Date.now() + 7 * 86_400_000);
    const branchScope = input.branchScope.trim() === "All" ? "all" : input.branchScope.trim().toUpperCase();

    const [org] = await this.db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    await this.db.insert(userInvites).values({
      organizationId,
      email,
      role: input.role,
      branchScope,
      pinRequired: input.pinRequired,
      tokenHash,
      expiresAt,
    });

    const publicUrl = (this.config.get<string>("APP_PUBLIC_URL") ?? "http://127.0.0.1:1420").replace(/\/$/, "");
    const inviteUrl = `${publicUrl}/accept-invite?token=${encodeURIComponent(token)}`;
    const roleLabel = formatRoleLabel(input.role);

    const emailSent = await this.mail.sendUserInvite({
      to: email,
      inviteUrl,
      roleLabel,
      organizationName: org?.name ?? "your organization",
    });

    return { email, emailSent, inviteUrl, expiresAt: expiresAt.toISOString() };
  }

  async getInvitePreview(token: string) {
    const invite = await this.findValidInvite(token);
    const [org] = await this.db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, invite.organizationId))
      .limit(1);

    return {
      email: invite.email,
      role: formatRoleLabel(invite.role),
      branchScope: invite.branchScope === "all" ? "All" : invite.branchScope,
      organizationName: org?.name ?? "Organization",
      expiresAt: invite.expiresAt.toISOString(),
    };
  }

  async acceptInvite(input: AcceptInvite) {
    const invite = await this.findValidInvite(input.token);
    const email = invite.email;

    const existing = await findLiveLoginUserByEmail(this.db, email);
    if (existing) throw new ConflictException("An account with this login email already exists");

    const passwordHash = await bcrypt.hash(input.password, 12);
    const [user] = await this.db
      .insert(users)
      .values({ email, passwordHash, lastSetPassword: input.password })
      .returning();
    if (!user) throw new BadRequestException("Failed to create account");

    await this.db.insert(organizationMemberships).values({
      organizationId: invite.organizationId,
      userId: user.id,
      role: invite.role,
      permissions: permissionsForPopsRole(invite.role),
      branchScope: invite.branchScope,
      pinRequired: invite.pinRequired,
      lastActivityAt: new Date(),
    });

    if (invite.role === "rider") {
      await this.delivery.ensureRiderProfileForUser(
        invite.organizationId,
        user.id,
        invite.branchScope,
      );
    }

    await this.db
      .update(userInvites)
      .set({ acceptedAt: new Date() })
      .where(eq(userInvites.id, invite.id));

    return { email };
  }

  private async findValidInvite(token: string) {
    const tokenHash = sha256Hex(token);
    const rows = await this.db
      .select()
      .from(userInvites)
      .where(and(eq(userInvites.tokenHash, tokenHash), isNull(userInvites.acceptedAt)))
      .limit(1);

    const invite = rows[0];
    if (!invite) throw new NotFoundException("Invite not found or already used");
    if (invite.expiresAt.getTime() < Date.now()) throw new BadRequestException("Invite has expired");
    return invite;
  }

  async touchActivity(userId: string, organizationId: string): Promise<void> {
    await this.db
      .update(organizationMemberships)
      .set({ lastActivityAt: new Date() })
      .where(
        and(
          eq(organizationMemberships.userId, userId),
          eq(organizationMemberships.organizationId, organizationId),
        ),
      );
  }

  private async getUser(organizationId: string, userId: string) {
    const rows = await this.listUsers(organizationId);
    const user = rows.find((u) => u.id === userId);
    if (!user) throw new NotFoundException("User not found");
    return user;
  }

  private async getMembership(organizationId: string, userId: string) {
    const rows = await this.db
      .select()
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.userId, userId),
        ),
      )
      .limit(1);

    const membership = rows[0];
    if (!membership) throw new NotFoundException("User not found in organization");
    return membership;
  }
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeEmail(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.includes("@")) return trimmed;
  return `${trimmed}@platform.local`;
}

function formatRoleLabel(role: string): string {
  if (role === "owner") return "Admin";
  const template = POPS_ROLE_TEMPLATES.find((r) => r.id === role);
  return template?.label ?? role.charAt(0).toUpperCase() + role.slice(1);
}

function staffDisplayName(email: string): string {
  const local = email.split("@")[0] ?? email;
  const words = local.replace(/[._-]+/g, " ").trim().split(/\s+/);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
