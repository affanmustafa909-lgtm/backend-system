import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from "@nestjs/common";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { permissionsForPopsRole, type CreateRider, type RiderDeliveryStatusUpdate, type UpdateDeliveryOrder, type UpdateRider } from "@platform/contracts";
import {
  organizationMemberships,
  popsBranches,
  popsKitchenTickets,
  popsMenuItems,
  popsRiders,
  organizations,
  users,
  type PlatformPgDb,
} from "@platform/database-pg";
import * as bcrypt from "bcryptjs";
import { DRIZZLE } from "../drizzle/drizzle.tokens";
import { extractOrderNotesFromItemsSummary } from "../lib/order-notes-from-summary";
import { NotificationsService } from "../notifications/notifications.service";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { findLiveLoginUserByEmail } from "../lib/login-email";

const RIDER_SEED_EMAIL = "rider1@platform.local";

@Injectable()
export class DeliveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly notifications: NotificationsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.seedRiderProfileIfMissing();
    } catch (err) {
      this.logger.warn(
        `Delivery rider bootstrap skipped — run pnpm db:push if the schema changed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async seedRiderProfileIfMissing(): Promise<void> {
    const org = await this.db.select({ id: organizations.id }).from(organizations).limit(1);
    const organizationId = org[0]?.id;
    if (!organizationId) return;

    const userRows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, RIDER_SEED_EMAIL))
      .limit(1);
    const userId = userRows[0]?.id;
    if (!userId) return;

    const branchRows = await this.db
      .select()
      .from(popsBranches)
      .where(and(eq(popsBranches.organizationId, organizationId), eq(popsBranches.code, "ISB-GT")))
      .limit(1);
    const branch = branchRows[0];
    if (!branch) return;

    const existing = await this.db
      .select({ id: popsRiders.id })
      .from(popsRiders)
      .where(eq(popsRiders.userId, userId))
      .limit(1);
    if (existing.length > 0) return;

    const byName = await this.db
      .select({ id: popsRiders.id })
      .from(popsRiders)
      .where(
        and(
          eq(popsRiders.organizationId, organizationId),
          eq(popsRiders.branchId, branch.id),
          eq(popsRiders.name, "Rider One"),
        ),
      )
      .limit(1);

    if (byName[0]) {
      await this.db.update(popsRiders).set({ userId }).where(eq(popsRiders.id, byName[0].id));
      return;
    }

    await this.db.insert(popsRiders).values({
      organizationId,
      branchId: branch.id,
      userId,
      name: "Rider One",
      phone: "+92 300 0000001",
      fromArea: "Islamabad",
      active: true,
    });
  }

  async listDeliveryOrders(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.fetchDeliveryTickets(organizationId, branch.id);
    return {
      branchCode: branch.code,
      orders: await Promise.all(rows.map((row) => this.mapDeliveryOrder(row))),
    };
  }

  async listMyDeliveries(user: AccessJwtPayload, branchCode: string) {
    if (!user.riderId) {
      throw new ForbiddenException("No delivery rider profile linked to this account");
    }
    const rider = await this.getRider(user.organizationId, user.riderId);

    const branchRows = await this.db
      .select()
      .from(popsBranches)
      .where(eq(popsBranches.id, rider.branchId))
      .limit(1);
    const riderBranch = branchRows[0];
    if (!riderBranch) throw new NotFoundException("Rider branch not found");

    const requestedCode = branchCode.trim();
    if (requestedCode && requestedCode !== riderBranch.code) {
      throw new ForbiddenException(
        `Your deliveries are for ${riderBranch.name} (${riderBranch.code}). Switch branch in the app.`,
      );
    }

    const rows = await this.fetchDeliveryTickets(user.organizationId, riderBranch.id, {
      riderId: user.riderId,
      activeOnly: true,
    });
    return {
      branchCode: riderBranch.code,
      orders: await Promise.all(rows.map((row) => this.mapDeliveryOrder(row))),
    };
  }

  async updateRiderDeliveryStatus(
    user: AccessJwtPayload,
    ticketId: string,
    input: RiderDeliveryStatusUpdate,
  ) {
    if (!user.riderId) {
      throw new ForbiddenException("No delivery rider profile linked to this account");
    }

    const ticket = await this.getTicket(user.organizationId, ticketId);
    if (!ticket.stationLabel.toLowerCase().includes("delivery")) {
      throw new BadRequestException("Not a delivery order");
    }
    if (ticket.riderId !== user.riderId) {
      throw new ForbiddenException("This delivery is not assigned to you");
    }
    if (ticket.status === "done") {
      throw new BadRequestException("Cannot update a completed delivery order");
    }

    const current = ticket.deliveryStatus ?? "unassigned";
    if (input.deliveryStatus === "out_for_delivery" && current !== "assigned") {
      throw new BadRequestException("Delivery must be assigned before starting");
    }
    if (input.deliveryStatus === "delivered" && current !== "out_for_delivery") {
      throw new BadRequestException("Delivery must be out for delivery before completing");
    }

    await this.updateDeliveryOrder(user.organizationId, ticketId, {
      deliveryStatus: input.deliveryStatus,
    });
    const updated = await this.getTicket(user.organizationId, ticketId);
    return this.mapDeliveryOrder(updated);
  }

  async listRiders(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    // Rider logins created via Users often lack a pops_riders row for this branch —
    // sync them so POS / mobile Delivery dropdowns are never empty for active riders.
    await this.ensureRiderProfilesForBranch(organizationId, branch);

    const rows = await this.db
      .select({
        rider: popsRiders,
        email: users.email,
        branchCode: popsBranches.code,
      })
      .from(popsRiders)
      .leftJoin(users, eq(popsRiders.userId, users.id))
      .innerJoin(popsBranches, eq(popsRiders.branchId, popsBranches.id))
      .where(eq(popsRiders.branchId, branch.id))
      .orderBy(asc(popsRiders.name));

    return {
      branchCode: branch.code,
      riders: rows.map((row) => this.mapRider(row.rider, row.email, row.branchCode)),
    };
  }

  /**
   * Ensure every active rider-role membership for this branch has a Delivery profile
   * on the branch (required for POS assignment + receipt rider name).
   */
  async ensureRiderProfilesForBranch(
    organizationId: string,
    branch: { id: string; code: string },
  ): Promise<void> {
    const memberships = await this.db
      .select({
        userId: organizationMemberships.userId,
        branchScope: organizationMemberships.branchScope,
        email: users.email,
        name: users.name,
      })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.role, "rider"),
          eq(organizationMemberships.active, true),
          ne(users.status, "deleted"),
        ),
      );

    const branchCode = branch.code.trim().toUpperCase();
    const eligible = memberships.filter((m) => {
      const scope = (m.branchScope ?? "all").trim().toUpperCase();
      return scope === "ALL" || scope === branchCode;
    });

    for (const m of eligible) {
      const existingOnBranch = await this.db
        .select({ id: popsRiders.id })
        .from(popsRiders)
        .where(
          and(
            eq(popsRiders.organizationId, organizationId),
            eq(popsRiders.branchId, branch.id),
            eq(popsRiders.userId, m.userId),
          ),
        )
        .limit(1);
      if (existingOnBranch.length > 0) continue;

      const anyProfile = await this.db
        .select()
        .from(popsRiders)
        .where(
          and(eq(popsRiders.organizationId, organizationId), eq(popsRiders.userId, m.userId)),
        )
        .limit(1);

      const fromEmail = (m.email?.split("@")[0] ?? "Rider").replace(/[._-]+/g, " ").trim();
      const displayName =
        anyProfile[0]?.name?.trim() || m.name?.trim() || fromEmail || "Rider";

      await this.db.insert(popsRiders).values({
        organizationId,
        branchId: branch.id,
        userId: m.userId,
        name: displayName,
        phone: anyProfile[0]?.phone ?? null,
        cnic: anyProfile[0]?.cnic ?? null,
        salaryPkr: anyProfile[0]?.salaryPkr ?? null,
        fromArea: anyProfile[0]?.fromArea ?? null,
        notes: anyProfile[0]?.notes ?? null,
        active: true,
      });
    }
  }

  /** Create / link a Delivery rider profile when a Users rider account is created. */
  async ensureRiderProfileForUser(
    organizationId: string,
    userId: string,
    branchScope: string,
  ): Promise<void> {
    const scope = branchScope.trim().toUpperCase();
    if (scope === "ALL" || !scope) {
      const branches = await this.db
        .select({ id: popsBranches.id, code: popsBranches.code })
        .from(popsBranches)
        .where(eq(popsBranches.organizationId, organizationId))
        .orderBy(asc(popsBranches.code));
      for (const branch of branches) {
        await this.ensureRiderProfilesForBranch(organizationId, branch);
      }
      return;
    }

    try {
      const branch = await this.resolveBranch(organizationId, scope);
      await this.ensureRiderProfilesForBranch(organizationId, branch);
    } catch {
      this.logger.warn(
        `Could not ensure rider profile for user ${userId} on branch scope ${branchScope}`,
      );
    }
  }

  async createRider(organizationId: string, input: CreateRider) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const email = input.email.trim().toLowerCase();

    const existing = await findLiveLoginUserByEmail(this.db, email);
    if (existing) {
      throw new ConflictException(`Login email already in use: ${email}`);
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const [user] = await this.db.insert(users).values({ email, passwordHash }).returning();
    if (!user) throw new BadRequestException("Failed to create rider login");

    await this.db.insert(organizationMemberships).values({
      organizationId,
      userId: user.id,
      role: "rider",
      permissions: permissionsForPopsRole("rider"),
      branchScope: branch.code,
      pinRequired: false,
      staffPinHash: input.pin ? await bcrypt.hash(input.pin, 10) : null,
      lastActivityAt: null,
    });

    const [row] = await this.db
      .insert(popsRiders)
      .values({
        organizationId,
        branchId: branch.id,
        userId: user.id,
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
        cnic: input.cnic?.trim() || null,
        salaryPkr: input.salaryPkr ?? null,
        fromArea: input.fromArea?.trim() || null,
        notes: input.notes?.trim() || null,
        active: true,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create rider");
    return this.mapRider(row, user.email, branch.code);
  }

  async updateRider(organizationId: string, riderId: string, input: UpdateRider) {
    const rider = await this.getRider(organizationId, riderId);

    let linkedUserId = rider.userId;
    if (input.email && input.password) {
      if (rider.userId) {
        throw new BadRequestException("This rider already has a login account");
      }
      const email = input.email.trim().toLowerCase();
      const existing = await findLiveLoginUserByEmail(this.db, email);
      if (existing) {
        throw new ConflictException(`Login email already in use: ${email}`);
      }

      const branchRows = await this.db
        .select({ code: popsBranches.code })
        .from(popsBranches)
        .where(eq(popsBranches.id, rider.branchId))
        .limit(1);
      const branchCode = branchRows[0]?.code;
      if (!branchCode) throw new NotFoundException("Rider branch not found");

      const passwordHash = await bcrypt.hash(input.password, 12);
      const [user] = await this.db.insert(users).values({ email, passwordHash }).returning();
      if (!user) throw new BadRequestException("Failed to create rider login");

      await this.db.insert(organizationMemberships).values({
        organizationId,
        userId: user.id,
        role: "rider",
        permissions: permissionsForPopsRole("rider"),
        branchScope: branchCode,
        pinRequired: false,
        staffPinHash: input.pin ? await bcrypt.hash(input.pin, 10) : null,
        lastActivityAt: null,
      });
      linkedUserId = user.id;
    } else if (input.pin) {
      const userId = linkedUserId ?? rider.userId;
      if (!userId) {
        throw new BadRequestException("Add a mobile login before setting a PIN.");
      }
      await this.db
        .update(organizationMemberships)
        .set({ staffPinHash: await bcrypt.hash(input.pin, 10) })
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.userId, userId),
          ),
        );
    }

    const pinUserId = linkedUserId ?? rider.userId;
    if (input.pin && pinUserId) {
      await this.db
        .update(organizationMemberships)
        .set({ staffPinHash: await bcrypt.hash(input.pin, 10) })
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.userId, pinUserId),
          ),
        );
    }

    const [row] = await this.db
      .update(popsRiders)
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.cnic !== undefined ? { cnic: input.cnic } : {}),
        ...(input.salaryPkr !== undefined ? { salaryPkr: input.salaryPkr } : {}),
        ...(input.fromArea !== undefined ? { fromArea: input.fromArea } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(linkedUserId && !rider.userId ? { userId: linkedUserId } : {}),
      })
      .where(eq(popsRiders.id, riderId))
      .returning();
    if (!row) throw new NotFoundException("Rider not found");
    const branch = await this.db
      .select({ code: popsBranches.code })
      .from(popsBranches)
      .where(eq(popsBranches.id, row.branchId))
      .limit(1);
    let email: string | null = null;
    if (row.userId) {
      const userRows = await this.db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, row.userId))
        .limit(1);
      email = userRows[0]?.email ?? null;
    }
    return this.mapRider(row, email, branch[0]?.code ?? "");
  }

  async updateDeliveryOrder(
    organizationId: string,
    ticketId: string,
    input: UpdateDeliveryOrder,
  ) {
    const ticket = await this.getTicket(organizationId, ticketId);
    if (!ticket.stationLabel.toLowerCase().includes("delivery")) {
      throw new BadRequestException("Not a delivery order");
    }
    if (ticket.status === "done") {
      throw new BadRequestException("Cannot update a completed delivery order");
    }

    const previousRiderId = ticket.riderId;

    if (input.riderId) {
      await this.getRider(organizationId, input.riderId);
    }

    let deliveryStatus = input.deliveryStatus;
    if (input.riderId !== undefined) {
      if (input.riderId && !deliveryStatus) {
        deliveryStatus = "assigned";
      }
      if (input.riderId === null && !deliveryStatus) {
        deliveryStatus = "unassigned";
      }
    }

    const [row] = await this.db
      .update(popsKitchenTickets)
      .set({
        ...(input.riderId !== undefined ? { riderId: input.riderId } : {}),
        ...(input.deliveryChargePkr !== undefined
          ? { deliveryChargePkr: input.deliveryChargePkr }
          : {}),
        ...(deliveryStatus !== undefined ? { deliveryStatus } : {}),
      })
      .where(eq(popsKitchenTickets.id, ticketId))
      .returning();

    if (!row) throw new NotFoundException("Delivery order not found");

    if (input.riderId && row.riderId && row.riderId !== previousRiderId) {
      const rider = await this.getRider(organizationId, row.riderId);
      const customerLabel = row.orderRef ? `Customer ${row.orderRef}` : `Customer ${row.ticketRef}`;
      try {
        await this.notifications.notifyRiderAssigned(organizationId, row.branchId, {
          orderRef: row.orderRef ?? row.ticketRef,
          riderName: rider.name,
          customerLabel,
          ticketRef: row.ticketRef,
        });
      } catch {
        // Non-blocking — delivery update still succeeds
      }
    }

    return this.mapTicketWithRider(row);
  }

  async mapTicketWithRider(row: typeof popsKitchenTickets.$inferSelect) {
    let riderName: string | null = null;
    if (row.riderId) {
      const riders = await this.db
        .select({ name: popsRiders.name })
        .from(popsRiders)
        .where(eq(popsRiders.id, row.riderId))
        .limit(1);
      riderName = riders[0]?.name ?? null;
    }

    const anchor = row.startedAt ?? row.createdAt;
    const mins = Math.max(0, Math.floor((Date.now() - anchor.getTime()) / 60_000));

    return {
      id: row.id,
      ticketRef: row.ticketRef,
      orderRef: row.orderRef,
      stationLabel: row.stationLabel,
      itemsSummary: row.itemsSummary,
      lines: this.parseTicketLines(row),
      notes: this.extractTicketNotes(row.itemsSummary),
      priority: row.priority as "normal" | "priority",
      status: row.status,
      mins,
      startedAt: row.startedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      riderId: row.riderId,
      riderName,
      deliveryChargePkr: row.deliveryChargePkr,
      deliveryStatus: row.deliveryStatus as
        | "unassigned"
        | "assigned"
        | "out_for_delivery"
        | "delivered"
        | null,
      createdById: row.createdByUserId ?? null,
      createdByName: row.createdByName ?? null,
    };
  }

  private mapRider(
    row: typeof popsRiders.$inferSelect,
    email: string | null = null,
    branchCode = "",
  ) {
    return {
      id: row.id,
      userId: row.userId,
      branchCode,
      email,
      name: row.name,
      phone: row.phone,
      cnic: row.cnic,
      salaryPkr: row.salaryPkr,
      fromArea: row.fromArea,
      notes: row.notes,
      active: row.active,
    };
  }

  private async mapDeliveryOrder(row: typeof popsKitchenTickets.$inferSelect) {
    const ticket = await this.mapTicketWithRider(row);
    const lines = await this.enrichLinesFromMenu(row.branchId, ticket.lines ?? []);
    const contact = this.parseDeliveryContact(row.itemsSummary);
    return {
      ...ticket,
      lines,
      customerName: contact.customer,
      customerAddress: contact.address,
    };
  }

  private async enrichLinesFromMenu(
    branchId: string,
    lines: { label: string; qty: number; unitPrice: number; menuItemId?: string }[],
  ): Promise<{ label: string; qty: number; unitPrice: number; menuItemId?: string }[]> {
    if (lines.length === 0) return lines;

    const menuRows = await this.db
      .select({
        id: popsMenuItems.id,
        name: popsMenuItems.name,
        portion: popsMenuItems.portion,
        price: popsMenuItems.pricePkr,
      })
      .from(popsMenuItems)
      .where(and(eq(popsMenuItems.branchId, branchId), eq(popsMenuItems.isActive, true)));

    return lines.map((line) => {
      if (line.unitPrice > 0 && line.menuItemId) return line;

      if (line.menuItemId) {
        const byId = menuRows.find((item) => item.id === line.menuItemId);
        if (byId) {
          return {
            ...line,
            unitPrice: line.unitPrice > 0 ? line.unitPrice : byId.price,
          };
        }
      }

      const norm = normalizeMenuLabel(line.label);
      const match = menuRows.find((item) => {
        const itemLabel = formatMenuItemLabel(item.name, item.portion);
        return (
          normalizeMenuLabel(itemLabel) === norm ||
          normalizeMenuLabel(item.name) === norm ||
          norm.includes(normalizeMenuLabel(item.name))
        );
      });
      if (!match) return line;
      return {
        ...line,
        unitPrice: line.unitPrice > 0 ? line.unitPrice : match.price,
        menuItemId: match.id,
      };
    });
  }

  private parseDeliveryContact(text: string | null | undefined): { customer: string; address: string } {
    if (!text?.trim()) return { customer: "—", address: "—" };

    const parts = text.split("·").map((p) => p.trim());
    const deliveryIdx = parts.findIndex((p) => p.toLowerCase() === "delivery");
    if (deliveryIdx >= 0) {
      return {
        customer: parts[deliveryIdx + 1]?.trim() || "—",
        address: parts[deliveryIdx + 2]?.trim() || "—",
      };
    }

    return { customer: "—", address: "—" };
  }

  private async fetchDeliveryTickets(
    organizationId: string,
    branchId: string,
    opts?: { riderId?: string; activeOnly?: boolean },
  ) {
    const conditions = [
      eq(popsKitchenTickets.organizationId, organizationId),
      eq(popsKitchenTickets.branchId, branchId),
      sql`lower(${popsKitchenTickets.stationLabel}) like '%delivery%'`,
    ];
    if (opts?.riderId) {
      conditions.push(eq(popsKitchenTickets.riderId, opts.riderId));
    }
    if (opts?.activeOnly) {
      conditions.push(ne(popsKitchenTickets.status, "done"));
    }

    return this.db
      .select()
      .from(popsKitchenTickets)
      .where(and(...conditions))
      .orderBy(asc(popsKitchenTickets.createdAt));
  }

  private async getRider(organizationId: string, riderId: string) {
    const rows = await this.db
      .select()
      .from(popsRiders)
      .where(eq(popsRiders.id, riderId))
      .limit(1);
    const rider = rows[0];
    if (!rider || rider.organizationId !== organizationId) {
      throw new NotFoundException("Rider not found");
    }
    return rider;
  }

  private async getTicket(organizationId: string, ticketId: string) {
    const rows = await this.db
      .select()
      .from(popsKitchenTickets)
      .where(eq(popsKitchenTickets.id, ticketId))
      .limit(1);
    const ticket = rows[0];
    if (!ticket || ticket.organizationId !== organizationId) {
      throw new NotFoundException("Delivery order not found");
    }
    return ticket;
  }

  private parseTicketLines(row: typeof popsKitchenTickets.$inferSelect) {
    if (row.linesJson) {
      try {
        const parsed = JSON.parse(row.linesJson) as {
          label: string;
          qty: number;
          unitPrice?: number;
          menuItemId?: string;
        }[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((l) => ({
            label: l.label,
            qty: l.qty,
            unitPrice: l.unitPrice ?? 0,
            ...(l.menuItemId ? { menuItemId: l.menuItemId } : {}),
          }));
        }
      } catch {
        /* fall through */
      }
    }
    return row.itemsSummary
      .split(" · ")[0]
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const match = part.match(/^(.+?)\s+x(\d+)$/i);
        return match
          ? { label: match[1].trim(), qty: Number(match[2]), unitPrice: 0 }
          : { label: part, qty: 1, unitPrice: 0 };
      });
  }

  private extractTicketNotes(summary: string): string | null {
    return extractOrderNotesFromItemsSummary(summary);
  }

  private async resolveBranch(organizationId: string, branchCode: string) {
    const code = branchCode.trim();
    const rows = await this.db
      .select()
      .from(popsBranches)
      .where(
        and(
          eq(popsBranches.organizationId, organizationId),
          sql`upper(${popsBranches.code}) = ${code.toUpperCase()}`,
        ),
      )
      .limit(1);
    const branch = rows[0];
    if (!branch) throw new NotFoundException(`Branch not found: ${code}`);
    return branch;
  }
}

function normalizeMenuLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, " ").trim();
}

function formatMenuItemLabel(name: string, portion: string | null): string {
  if (!portion) return name;
  const p = portion.charAt(0).toUpperCase() + portion.slice(1);
  return `${name} (${p})`;
}
