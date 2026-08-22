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
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { CompleteBill, CreateBill, CreateWaiter, UpdateBill, UpdateWaiter } from "@platform/contracts";
import { permissionsForPopsRole } from "@platform/contracts";
import {
  organizationMemberships,
  popsBills,
  popsBranches,
  popsKitchenTickets,
  popsRiders,
  users,
  type PlatformPgDb,
} from "@platform/database-pg";
import * as bcrypt from "bcryptjs";
import { DRIZZLE } from "../drizzle/drizzle.tokens";
import { AccountingHooksService } from "../accounting/accounting-hooks.service";
import { ClosingService } from "../closing/closing.service";
import { InventoryDeductionService } from "../inventory/inventory-deduction.service";
import { TaxAuthorityService } from "../tax-authority/tax-authority.service";
import { assertDineInTableAvailable } from "../tables/table-booking";
import { findLiveLoginUserByEmail, findLiveLoginUserByEmailExcluding } from "../lib/login-email";

type BillTotals = {
  subtotal: number;
  discount: number;
  service: number;
  servicePct: number;
  tax: number;
  taxPct: number;
  deliveryCharge: number;
  total: number;
};

@Injectable()
export class BillingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly inventoryDeduction: InventoryDeductionService,
    private readonly accountingHooks: AccountingHooksService,
    private readonly closing: ClosingService,
    private readonly taxAuthority: TaxAuthorityService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.seedSampleBillsIfEmpty();
    } catch (err) {
      this.logger.warn(
        `Bill seed skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async seedSampleBillsIfEmpty(): Promise<void> {
    const existing = await this.db.select({ id: popsBills.id }).from(popsBills).limit(1);
    if (existing.length > 0) return;

    const branches = await this.db.select().from(popsBranches);
    for (const branch of branches) {
      const sampleLines = [
        { label: "Chicken Karahi (Full)", qty: 1, unitPrice: 2890 },
        { label: "Raita", qty: 2, unitPrice: 80 },
      ];
      const subtotal = 3050;
      const servicePct = 10;
      const taxPct = 15;
      const service = 305;
      const tax = 503;
      await this.db.insert(popsBills).values({
        organizationId: branch.organizationId,
        branchId: branch.id,
        billRef: `BILL-${branch.code}-SEED`,
        orderRef: "ORD-1042",
        tableLabel: "T1",
        waiterId: null,
        waiterName: "Waiter 1",
        linesJson: JSON.stringify(sampleLines),
        notes: "Sample completed order",
        subtotalPkr: subtotal,
        discountPkr: 0,
        servicePkr: service,
        servicePct,
        taxPkr: tax,
        taxPct,
        totalPkr: subtotal + service + tax,
        paymentsJson: JSON.stringify([{ method: "cash", amount: subtotal + service + tax }]),
        status: "completed",
        createdAt: new Date(Date.now() - 45 * 60_000),
      });
    }
  }

  async listWaiters(organizationId: string, branchCode?: string) {
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        branchScope: organizationMemberships.branchScope,
      })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.role, "waiter"),
        ),
      )
      .orderBy(users.email);

    const code = branchCode?.trim();
    const filtered = code
      ? rows.filter((row) => row.branchScope === code || row.branchScope === "all")
      : rows;

    return filtered.map((row) => ({
      id: row.id,
      email: row.email,
      name: waiterDisplayName(row.email),
      branchCode: row.branchScope === "all" ? code ?? row.branchScope : row.branchScope,
    }));
  }

  async createWaiter(organizationId: string, input: CreateWaiter) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const email = input.email.trim().toLowerCase();

    const existing = await findLiveLoginUserByEmail(this.db, email);
    if (existing) {
      throw new ConflictException(`Login email already in use: ${email}`);
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const [user] = await this.db.insert(users).values({ email, passwordHash }).returning();
    if (!user) throw new BadRequestException("Failed to create waiter login");

    await this.db.insert(organizationMemberships).values({
      organizationId,
      userId: user.id,
      role: "waiter",
      permissions: permissionsForPopsRole("waiter"),
      branchScope: branch.code,
      pinRequired: false,
      staffPinHash: input.pin ? await bcrypt.hash(input.pin, 10) : null,
      lastActivityAt: null,
    });

    return {
      id: user.id,
      email: user.email,
      name: input.name.trim() || waiterDisplayName(user.email),
      branchCode: branch.code,
    };
  }

  async updateWaiter(organizationId: string, waiterId: string, input: UpdateWaiter) {
    const membership = await this.getWaiterMembership(organizationId, waiterId);

    if (input.email) {
      const email = input.email.trim().toLowerCase();
      const existing = await findLiveLoginUserByEmailExcluding(this.db, email, waiterId);
      if (existing) {
        throw new ConflictException(`Login email already in use: ${email}`);
      }
      await this.db.update(users).set({ email }).where(eq(users.id, waiterId));
    }

    if (input.password) {
      const passwordHash = await bcrypt.hash(input.password, 12);
      await this.db.update(users).set({ passwordHash }).where(eq(users.id, waiterId));
    }

    let branchCode = membership.branchScope;
    if (input.branchCode) {
      const branch = await this.resolveBranch(organizationId, input.branchCode);
      branchCode = branch.code;
      await this.db
        .update(organizationMemberships)
        .set({ branchScope: branch.code })
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.userId, waiterId),
          ),
        );
    }

    if (input.pin) {
      await this.db
        .update(organizationMemberships)
        .set({ staffPinHash: await bcrypt.hash(input.pin, 10) })
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.userId, waiterId),
          ),
        );
    }

    const userRows = await this.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, waiterId))
      .limit(1);
    const email = userRows[0]?.email;
    if (!email) throw new NotFoundException("Waiter not found");

    return {
      id: waiterId,
      email,
      name: waiterDisplayName(email),
      branchCode,
    };
  }

  private async getWaiterMembership(organizationId: string, waiterId: string) {
    const rows = await this.db
      .select({
        userId: organizationMemberships.userId,
        branchScope: organizationMemberships.branchScope,
        role: organizationMemberships.role,
      })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.userId, waiterId),
        ),
      )
      .limit(1);
    const membership = rows[0];
    if (!membership || membership.role !== "waiter") {
      throw new NotFoundException("Waiter not found");
    }
    return membership;
  }

  async listOrders(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(popsBills)
      .where(
        and(
          eq(popsBills.branchId, branch.id),
          ne(popsBills.status, "void"),
        ),
      )
      .orderBy(desc(popsBills.createdAt));

    const riderNames = await this.loadRiderNames(
      rows.map((row) => row.riderId).filter((id): id is string => Boolean(id)),
    );

    return {
      branchCode: branch.code,
      orders: rows.map((row) =>
        this.mapBill(row, row.riderId ? (riderNames.get(row.riderId) ?? null) : null),
      ),
    };
  }

  async createBill(organizationId: string, input: CreateBill) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    await this.closing.assertOrdersNotPaused(branch.id);
    if (input.tableLabel.trim().toLowerCase().includes("delivery") && !input.riderId) {
      throw new BadRequestException("A rider is required for delivery orders.");
    }
    const waiter = await this.resolveWaiterInfo(organizationId, input);
    const status = input.status ?? "completed";
    const totals = this.computeBillTotals(input);

    await assertDineInTableAvailable(this.db, branch.id, input.tableLabel.trim(), {
      allowOrderRef: input.orderRef,
      intent: status === "held" ? "new-order" : "close",
    });

    if (status === "completed") {
      const payments = this.normalizePayments(input.payments, totals.total);
      this.assertPaymentsCoverTotal(payments, totals.total);
      return this.insertBill(organizationId, branch.id, input, waiter, totals, status, payments);
    }

    return this.insertBill(organizationId, branch.id, input, waiter, totals, status, []);
  }

  async completeBill(organizationId: string, billId: string, input: CompleteBill) {
    const rows = await this.db
      .select()
      .from(popsBills)
      .where(eq(popsBills.id, billId))
      .limit(1);
    const existing = rows[0];
    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundException("Bill not found");
    }
    if (existing.status !== "held") {
      throw new BadRequestException("Only held bills can be completed");
    }

    const servicePct = input.servicePct ?? existing.servicePct;
    const taxPct = input.taxPct ?? existing.taxPct;
    const totals = this.computeBillTotalsFromAmounts(
      existing.subtotalPkr,
      existing.discountPkr,
      servicePct,
      taxPct,
      existing.deliveryChargePkr,
    );
    const payments = this.normalizePayments(input.payments, totals.total);
    this.assertPaymentsCoverTotal(payments, totals.total);

    const [row] = await this.db
      .update(popsBills)
      .set({
        servicePkr: totals.service,
        servicePct: totals.servicePct,
        taxPkr: totals.tax,
        taxPct: totals.taxPct,
        totalPkr: totals.total,
        paymentsJson: JSON.stringify(payments),
        status: "completed",
      })
      .where(eq(popsBills.id, billId))
      .returning();

    if (!row) throw new NotFoundException("Bill not found");

    await this.finalizeCompletedBill(organizationId, row);
    return this.mapBill(row);
  }

  async updateBill(
    organizationId: string,
    billId: string,
    input: UpdateBill,
    editor?: { userId: string; role: string },
  ) {
    const rows = await this.db
      .select()
      .from(popsBills)
      .where(eq(popsBills.id, billId))
      .limit(1);
    const existing = rows[0];
    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundException("Bill not found");
    }
    if (existing.status !== "held") {
      throw new BadRequestException("Only held bills can be edited");
    }
    // A held bill belongs to the waiter who created it; other waiters get
    // view-only access. Managers/admins/cashiers can always edit.
    const editorIsStaff = editor && (editor.role === "waiter" || editor.role === "rider");
    if (editorIsStaff && existing.waiterId && existing.waiterId !== editor.userId) {
      throw new ForbiddenException(
        `This bill was taken by ${existing.waiterName}. Only they can edit it — you have view access.`,
      );
    }

    const existingLines = this.parseBillLines(existing.linesJson);
    const lines = input.lines ?? existingLines;
    if (lines.length === 0) {
      throw new BadRequestException("Bill must include at least one item");
    }

    const nextTableLabel = input.tableLabel?.trim() ?? existing.tableLabel;
    const nextRiderId = input.riderId !== undefined ? input.riderId : existing.riderId;
    if (nextTableLabel.toLowerCase().includes("delivery") && !nextRiderId) {
      throw new BadRequestException("A rider is required for delivery orders.");
    }

    if (
      input.tableLabel !== undefined &&
      nextTableLabel.toLowerCase() !== existing.tableLabel.trim().toLowerCase()
    ) {
      await assertDineInTableAvailable(this.db, existing.branchId, nextTableLabel, {
        allowOrderRef: existing.orderRef,
        excludeBillId: existing.id,
        intent: "new-order",
      });
    }

    const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
    const servicePct = input.servicePct ?? existing.servicePct;
    const taxPct = input.taxPct ?? existing.taxPct;
    const deliveryCharge = input.deliveryChargePkr ?? existing.deliveryChargePkr;
    let discount = existing.discountPkr;
    if (input.discountPkr != null) {
      discount = Math.min(Math.round(input.discountPkr), subtotal);
    } else if (input.discountPct != null) {
      discount = Math.round(subtotal * (input.discountPct / 100));
    } else if (input.lines !== undefined) {
      const prevSubtotal = existing.subtotalPkr;
      discount =
        prevSubtotal > 0
          ? Math.min(Math.round((existing.discountPkr / prevSubtotal) * subtotal), subtotal)
          : 0;
    }

    const totals = this.computeBillTotalsFromAmounts(
      subtotal,
      discount,
      servicePct,
      taxPct,
      deliveryCharge,
    );

    const [row] = await this.db
      .update(popsBills)
      .set({
        ...(input.tableLabel !== undefined ? { tableLabel: input.tableLabel.trim() } : {}),
        linesJson: JSON.stringify(lines),
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
        subtotalPkr: totals.subtotal,
        discountPkr: totals.discount,
        servicePkr: totals.service,
        servicePct: totals.servicePct,
        taxPkr: totals.tax,
        taxPct: totals.taxPct,
        totalPkr: totals.total,
        ...(input.riderId !== undefined ? { riderId: input.riderId } : {}),
        deliveryChargePkr: totals.deliveryCharge,
      })
      .where(eq(popsBills.id, billId))
      .returning();

    if (!row) throw new NotFoundException("Bill not found");
    return this.mapBill(row);
  }

  async voidBill(organizationId: string, billId: string) {
    const rows = await this.db
      .select()
      .from(popsBills)
      .where(eq(popsBills.id, billId))
      .limit(1);
    const existing = rows[0];
    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundException("Bill not found");
    }
    if (existing.status === "void") {
      throw new BadRequestException("Bill is already void");
    }

    const [row] = await this.db
      .update(popsBills)
      .set({ status: "void" })
      .where(eq(popsBills.id, billId))
      .returning();

    if (!row) throw new NotFoundException("Bill not found");
    await this.closeRelatedKitchenTickets(row);
    return this.mapBill(row);
  }

  async deleteBill(organizationId: string, billId: string) {
    const rows = await this.db
      .select()
      .from(popsBills)
      .where(eq(popsBills.id, billId))
      .limit(1);
    const existing = rows[0];
    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundException("Bill not found");
    }

    await this.db.delete(popsBills).where(eq(popsBills.id, billId));
    return { ok: true, billRef: existing.billRef };
  }

  private parseBillLines(linesJson: string | null): CreateBill["lines"] {
    if (!linesJson) return [];
    try {
      const parsed = JSON.parse(linesJson) as CreateBill["lines"];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async insertBill(
    organizationId: string,
    branchId: string,
    input: CreateBill,
    waiter: { id: string | null; name: string },
    totals: BillTotals,
    status: "held" | "completed" | "void" | "open",
    payments: { method: string; amount: number }[],
  ) {
    const billRef = `BILL-${Date.now().toString(36).toUpperCase().slice(-6)}`;

    const [row] = await this.db
      .insert(popsBills)
      .values({
        organizationId,
        branchId,
        billRef,
        orderRef: input.orderRef?.trim() || null,
        tableLabel: input.tableLabel.trim(),
        waiterId: waiter.id,
        waiterName: waiter.name,
        linesJson: JSON.stringify(input.lines),
        notes: input.notes?.trim() || null,
        subtotalPkr: totals.subtotal,
        discountPkr: totals.discount,
        servicePkr: totals.service,
        servicePct: totals.servicePct,
        taxPkr: totals.tax,
        taxPct: totals.taxPct,
        totalPkr: totals.total,
        paymentsJson: payments.length > 0 ? JSON.stringify(payments) : null,
        splitGroupRef: input.splitGroupRef?.trim() || null,
        riderId: input.riderId ?? null,
        deliveryChargePkr: totals.deliveryCharge,
        status,
      })
      .returning();

    if (!row) throw new BadRequestException("Failed to create bill");

    if (status === "completed") {
      await this.finalizeCompletedBill(organizationId, row);
    }

    return this.mapBill(row);
  }

  private async finalizeCompletedBill(
    organizationId: string,
    row: typeof popsBills.$inferSelect,
  ): Promise<void> {
    // Waiter / kitchen "Active" lists are ticket-status based. Closing the bill
    // must mark matching KOTs done or they stay "open" on waiter apps.
    await this.closeRelatedKitchenTickets(row);

    try {
      await this.inventoryDeduction.deductForCompletedBill(organizationId, row);
    } catch (err) {
      this.logger.warn(
        `Inventory deduction failed for ${row.billRef}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    try {
      await this.accountingHooks.recordSaleFromBill(organizationId, row.branchId, row);
    } catch (err) {
      this.logger.warn(
        `Accounting entry failed for ${row.billRef}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    try {
      const [branch] = await this.db
        .select()
        .from(popsBranches)
        .where(eq(popsBranches.id, row.branchId))
        .limit(1);
      if (branch) {
        await this.taxAuthority.enqueueFromSale({
          organizationId,
          branchId: row.branchId,
          branchCode: branch.code,
          sourceType: "bill",
          sourceId: row.id,
          sourceRef: row.billRef,
          taxableAmountPkr: Math.max(0, row.subtotalPkr - row.discountPkr + (row.servicePkr ?? 0)),
          taxAmountPkr: row.taxPkr,
        });
      }
    } catch (err) {
      this.logger.warn(
        `FBR/PRA enqueue failed for ${row.billRef}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Mark non-done kitchen tickets for this paid bill so waiter Active lists clear. */
  private async closeRelatedKitchenTickets(
    row: typeof popsBills.$inferSelect,
  ): Promise<void> {
    const orderRef = (row.orderRef ?? "").trim();
    if (!orderRef) return;
    try {
      const openTickets = await this.db
        .select({
          id: popsKitchenTickets.id,
          orderRef: popsKitchenTickets.orderRef,
          stationLabel: popsKitchenTickets.stationLabel,
        })
        .from(popsKitchenTickets)
        .where(
          and(
            eq(popsKitchenTickets.branchId, row.branchId),
            ne(popsKitchenTickets.status, "done"),
          ),
        );

      const targetRef = orderRef.toLowerCase();
      const tableKey = tableKeyFromLabel(row.tableLabel);
      const ids = openTickets
        .filter((ticket) => {
          const ticketRef = (ticket.orderRef ?? "").trim().toLowerCase();
          if (ticketRef && ticketRef === targetRef) return true;
          if (!ticketRef && tableKey) {
            const ticketTable = tableKeyFromLabel(ticket.stationLabel);
            return Boolean(ticketTable && ticketTable === tableKey);
          }
          return false;
        })
        .map((ticket) => ticket.id);

      if (ids.length === 0) return;

      await this.db
        .update(popsKitchenTickets)
        .set({ status: "done", billId: row.id })
        .where(inArray(popsKitchenTickets.id, ids));
    } catch (err) {
      this.logger.warn(
        `Could not close kitchen tickets for ${row.billRef}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private computeBillTotals(input: CreateBill): BillTotals {
    const subtotal = input.lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
    const servicePct = input.servicePct ?? 0;
    const taxPct = input.taxPct ?? 0;
    const discount =
      input.discountPkr != null && input.discountPkr > 0
        ? Math.min(Math.round(input.discountPkr), subtotal)
        : Math.round(subtotal * ((input.discountPct ?? 0) / 100));
    const deliveryCharge = input.deliveryChargePkr ?? 0;
    return this.computeBillTotalsFromAmounts(subtotal, discount, servicePct, taxPct, deliveryCharge);
  }

  private computeBillTotalsFromAmounts(
    subtotal: number,
    discount: number,
    servicePct: number,
    taxPct: number,
    deliveryCharge = 0,
  ): BillTotals {
    const afterDisc = subtotal - discount;
    const service = Math.round(afterDisc * (servicePct / 100));
    // Tax food/items only — never service or delivery (matches POS + PRA).
    const tax = Math.round(afterDisc * (taxPct / 100));
    const total = afterDisc + service + tax + deliveryCharge;
    return { subtotal, discount, service, servicePct, tax, taxPct, deliveryCharge, total };
  }

  private normalizePayments(
    payments: CreateBill["payments"] | CompleteBill["payments"] | undefined,
    total: number,
  ) {
    if (!payments || payments.length === 0) {
      return [{ method: "cash" as const, amount: total }];
    }
    const normalized = payments
      .filter((p) => p.amount > 0)
      .map((p) => ({ method: p.method, amount: Math.round(p.amount) }));
    if (normalized.length === 0) {
      return [{ method: "cash" as const, amount: total }];
    }
    // Single-tender: snap to exact server total so 1-PKR rounding never blocks Pay.
    if (normalized.length === 1) {
      return [{ ...normalized[0], amount: Math.max(normalized[0].amount, total) }];
    }
    return normalized;
  }

  private assertPaymentsCoverTotal(
    payments: { method: string; amount: number }[],
    total: number,
  ): void {
    const paid = payments.reduce((s, p) => s + p.amount, 0);
    if (paid < total) {
      throw new BadRequestException(`Payments (Rs ${paid}) do not cover bill total (Rs ${total})`);
    }
  }

  private async loadRiderNames(riderIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(riderIds)];
    if (unique.length === 0) return new Map();

    const rows = await this.db
      .select({ id: popsRiders.id, name: popsRiders.name })
      .from(popsRiders)
      .where(inArray(popsRiders.id, unique));

    return new Map(rows.map((row) => [row.id, row.name]));
  }

  private mapBill(row: typeof popsBills.$inferSelect, riderName: string | null = null) {
    let lines: CreateBill["lines"] = [];
    try {
      lines = JSON.parse(row.linesJson) as CreateBill["lines"];
    } catch {
      lines = [];
    }
    let payments: { method: string; amount: number }[] = [];
    if (row.paymentsJson) {
      try {
        payments = JSON.parse(row.paymentsJson) as { method: string; amount: number }[];
      } catch {
        payments = [];
      }
    }
    return {
      id: row.id,
      billRef: row.billRef,
      orderRef: row.orderRef,
      tableLabel: row.tableLabel,
      waiterId: row.waiterId,
      waiterName: row.waiterName,
      lines,
      notes: row.notes,
      subtotal: row.subtotalPkr,
      discount: row.discountPkr,
      service: row.servicePkr,
      servicePct: row.servicePct,
      tax: row.taxPkr,
      taxPct: row.taxPct,
      total: row.totalPkr,
      payments,
      splitGroupRef: row.splitGroupRef ?? null,
      riderId: row.riderId,
      riderName,
      deliveryChargePkr: row.deliveryChargePkr,
      status: row.status as "held" | "completed" | "void" | "open",
      praMode: (row.praMode as "fake" | "real" | null) ?? null,
      praInvoiceNumber: row.praInvoiceNumber ?? null,
      praInvoiceId: row.praInvoiceId ?? null,
      praQrPayload: row.praQrPayload ?? null,
      praIssuedAt: row.praIssuedAt ? row.praIssuedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async resolveBranch(organizationId: string, branchCode: string) {
    const code = branchCode.trim();
    const rows = await this.db
      .select()
      .from(popsBranches)
      .where(and(eq(popsBranches.organizationId, organizationId), eq(popsBranches.code, code)))
      .limit(1);
    const branch = rows[0];
    if (!branch) throw new NotFoundException(`Branch not found: ${code}`);
    return branch;
  }

  private async resolveWaiterInfo(
    organizationId: string,
    input: CreateBill,
  ): Promise<{ id: string | null; name: string }> {
    if (input.waiterId) {
      const rows = await this.db
        .select({
          id: users.id,
          email: users.email,
        })
        .from(organizationMemberships)
        .innerJoin(users, eq(users.id, organizationMemberships.userId))
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.role, "waiter"),
            eq(users.id, input.waiterId),
          ),
        )
        .limit(1);

      const row = rows[0];
      if (!row) throw new NotFoundException("Waiter not found");
      return { id: row.id, name: waiterDisplayName(row.email) };
    }

    return {
      id: null,
      name: input.waiterName?.trim() || "POS Counter",
    };
  }
}

function waiterDisplayName(email: string): string {
  const local = email.split("@")[0] ?? email;
  const words = local.replace(/[._-]+/g, " ").trim().split(/\s+/);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** Normalize "Table H5" / "H5" / "Dine-in · Table H5" → "H5". */
function tableKeyFromLabel(label: string | null | undefined): string {
  const raw = (label ?? "").trim();
  if (!raw) return "";
  const tableMatch = /\btable\s*[:#-]?\s*([a-z0-9-]+)\b/i.exec(raw);
  if (tableMatch?.[1]) return tableMatch[1].toUpperCase();
  // Bare station like "H5" or "R3"
  if (/^[a-z]?\d+[a-z]?$/i.test(raw)) return raw.toUpperCase();
  return raw.toUpperCase();
}
