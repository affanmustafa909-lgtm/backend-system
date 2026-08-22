import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, gte, lte, ne, sql } from "drizzle-orm";
import type { CreateBill, CreateKitchenTicket, KitchenTicketStatus, UpdateKitchenTicket } from "@platform/contracts";
import {
  popsBills,
  popsBranches,
  popsKitchenLineCancellations,
  popsKitchenTickets,
  popsMenuItems,
  users,
  type PlatformPgDb,
} from "@platform/database-pg";
import { BillingService } from "../billing/billing.service";
import { ClosingService } from "../closing/closing.service";
import { DeliveryService } from "../delivery/delivery.service";
import { DRIZZLE } from "../drizzle/drizzle.tokens";
import { extractOrderNotesFromItemsSummary } from "../lib/order-notes-from-summary";
import {
  assertDineInTableAvailable,
  isDineInTableLabel,
  normalizeTableLabel,
} from "../tables/table-booking";

type StoredLine = { label: string; qty: number; unitPrice: number; menuItemId?: string };

@Injectable()
export class KitchenService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly billing: BillingService,
    private readonly delivery: DeliveryService,
    private readonly closing: ClosingService,
  ) {}

  async listTickets(organizationId: string, branchCode: string, scope: "active" | "done" | "all" = "active") {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const statusFilter =
      scope === "done"
        ? eq(popsKitchenTickets.status, "done")
        : scope === "all"
          ? undefined
          : ne(popsKitchenTickets.status, "done");

    const rows = await this.db
      .select()
      .from(popsKitchenTickets)
      .where(
        statusFilter
          ? and(eq(popsKitchenTickets.branchId, branch.id), statusFilter)
          : eq(popsKitchenTickets.branchId, branch.id),
      )
      .orderBy(desc(popsKitchenTickets.priority), asc(popsKitchenTickets.createdAt));

    return {
      branchCode: branch.code,
      tickets: await Promise.all(rows.map((row) => this.mapTicketForResponse(row))),
    };
  }

  private async mapTicketForResponse(row: typeof popsKitchenTickets.$inferSelect) {
    const ticket = await this.delivery.mapTicketWithRider(row);
    const lines = await this.enrichLinesFromMenu(
      row.branchId,
      (ticket.lines ?? []).map((line) => {
        const menuItemId =
          "menuItemId" in line && typeof line.menuItemId === "string" ? line.menuItemId : undefined;
        return {
          label: line.label,
          qty: line.qty,
          unitPrice: line.unitPrice ?? 0,
          ...(menuItemId ? { menuItemId } : {}),
        };
      }),
    );
    return { ...ticket, lines };
  }

  async createTicket(
    organizationId: string,
    input: CreateKitchenTicket,
    createdByUserId?: string,
  ) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    await this.closing.assertOrdersNotPaused(branch.id);

    // Idempotent create: flaky mobile networks may retry the same ORD-* after the
    // first insert already succeeded (client never saw the 201).
    let orderRef = input.orderRef?.trim() || null;
    if (orderRef) {
      const existing = await this.db
        .select()
        .from(popsKitchenTickets)
        .where(
          and(
            eq(popsKitchenTickets.branchId, branch.id),
            eq(popsKitchenTickets.orderRef, orderRef),
            ne(popsKitchenTickets.status, "done"),
          ),
        )
        .orderBy(desc(popsKitchenTickets.createdAt))
        .limit(1);
      if (existing[0]) {
        return this.mapTicketForResponse(existing[0]);
      }

      // Never reuse an ORD that already has a completed/held bill or done ticket —
      // that mixed old paid orders with new ones in POS Latest / print.
      const paidClash = await this.db
        .select({ id: popsBills.id })
        .from(popsBills)
        .where(
          and(
            eq(popsBills.branchId, branch.id),
            eq(popsBills.orderRef, orderRef),
            ne(popsBills.status, "void"),
          ),
        )
        .limit(1);
      const doneClash = await this.db
        .select({ id: popsKitchenTickets.id })
        .from(popsKitchenTickets)
        .where(
          and(
            eq(popsKitchenTickets.branchId, branch.id),
            eq(popsKitchenTickets.orderRef, orderRef),
            eq(popsKitchenTickets.status, "done"),
          ),
        )
        .limit(1);
      if (paidClash[0] || doneClash[0]) {
        const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
        orderRef = `${orderRef}-${suffix}`;
      }
    }

    const enrichedLines = await this.enrichLinesFromMenu(
      branch.id,
      input.lines.map((l) => ({
        label: l.label,
        qty: l.qty,
        unitPrice: l.unitPrice ?? 0,
        ...(l.menuItemId ? { menuItemId: l.menuItemId } : {}),
      })),
    );
    const storedLines: StoredLine[] = enrichedLines.map((l) => ({
      label: l.label,
      qty: l.qty,
      unitPrice: l.unitPrice ?? 0,
      ...(l.menuItemId ? { menuItemId: l.menuItemId } : {}),
    }));
    const lineText = storedLines.map((l) => `${l.label} x${l.qty}`).join(", ");
    const notes = input.notes?.trim();
    const itemsSummary = notes ? `${lineText} · ${notes}` : lineText;
    const ticketRef = `KOT-${Date.now().toString(36).toUpperCase().slice(-6)}`;
    const isDelivery = input.stationLabel.trim().toLowerCase().includes("delivery");
    if (isDelivery && !input.riderId) {
      throw new BadRequestException("A rider is required for delivery orders.");
    }

    let createdByName: string | null = null;
    if (createdByUserId) {
      const userRows = await this.db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, createdByUserId))
        .limit(1);
      const email = userRows[0]?.email;
      if (email) createdByName = waiterDisplayName(email);
    }

    await assertDineInTableAvailable(this.db, branch.id, input.stationLabel.trim(), {
      allowOrderRef: orderRef ?? undefined,
      intent: "new-order",
    });

    const [row] = await this.db
      .insert(popsKitchenTickets)
      .values({
        organizationId,
        branchId: branch.id,
        ticketRef,
        orderRef,
        stationLabel: input.stationLabel.trim(),
        itemsSummary,
        linesJson: JSON.stringify(storedLines),
        priority: input.priority ?? "normal",
        status: "new",
        createdByUserId: createdByUserId ?? null,
        createdByName,
        riderId: input.riderId ?? null,
        deliveryChargePkr: input.deliveryChargePkr ?? 0,
        deliveryStatus: isDelivery
          ? input.riderId
            ? "assigned"
            : "unassigned"
          : null,
      })
      .returning();

    if (!row) throw new BadRequestException("Failed to create kitchen ticket");
    return this.mapTicketForResponse(row);
  }

  async updateTicket(
    organizationId: string,
    ticketId: string,
    input: UpdateKitchenTicket,
    editor?: { userId: string; role: string },
  ) {
    const existing = await this.getTicket(organizationId, ticketId);
    if (existing.status === "done" && (input.lines !== undefined || input.notes !== undefined)) {
      throw new BadRequestException("Cannot edit items on a completed order");
    }

    // Only the waiter who took the order may change its contents. Status-only
    // updates (kitchen marking cooking/ready/done) stay open to everyone, and
    // managers/admins/cashiers can always edit.
    const isContentEdit =
      input.lines !== undefined || input.notes !== undefined || input.stationLabel !== undefined;
    const editorIsStaff = editor && (editor.role === "waiter" || editor.role === "rider");
    if (
      isContentEdit &&
      editorIsStaff &&
      existing.createdByUserId &&
      existing.createdByUserId !== editor.userId
    ) {
      const owner = existing.createdByName ?? "another waiter";
      throw new ForbiddenException(
        `This order was taken by ${owner}. Only they can edit it — you have view access.`,
      );
    }
    /** Destination-table occupants absorbed during transfer (merged into this ticket). */
    let absorbedDestLines: StoredLine[] = [];
    let absorbedDestNotes: string | null = null;

    if (input.stationLabel !== undefined) {
      if (existing.status === "done") {
        throw new BadRequestException("Cannot change table on a completed order");
      }
      const nextLabel = input.stationLabel.trim();
      if (nextLabel.toLowerCase() !== existing.stationLabel.trim().toLowerCase()) {
        // Table transfer: merge any open order already on the destination into this
        // ticket, move held bills, then relocate — do not hard-block booked tables.
        if (isDineInTableLabel(nextLabel)) {
          const absorbed = await this.absorbDestinationTableOccupants(existing, nextLabel);
          absorbedDestLines = absorbed.lines;
          absorbedDestNotes = absorbed.notes;
          await this.relocateHeldBillsForOrder(
            existing.branchId,
            existing.orderRef,
            existing.stationLabel,
            nextLabel,
          );
          if (existing.billId) {
            await this.db
              .update(popsBills)
              .set({ tableLabel: nextLabel })
              .where(
                and(
                  eq(popsBills.id, existing.billId),
                  eq(popsBills.status, "held"),
                ),
              );
          }
        } else {
          await assertDineInTableAvailable(this.db, existing.branchId, nextLabel, {
            allowOrderRef: existing.orderRef,
            excludeTicketId: existing.id,
            intent: "new-order",
          });
        }
      }
    }

    let linesJson: string | undefined;
    let itemsSummary: string | undefined;
    let pendingCancellations: Array<{
      menuItemId: string | null;
      label: string;
      qtyCanceled: number;
      unitPricePkr: number;
    }> = [];
    if (input.lines !== undefined) {
      if (input.lines.length === 0) {
        throw new BadRequestException("Order must include at least one item");
      }
      const storedLines: StoredLine[] = input.lines.map((l) => ({
        label: l.label,
        qty: l.qty,
        unitPrice: l.unitPrice ?? 0,
        ...(l.menuItemId ? { menuItemId: l.menuItemId } : {}),
      }));
      const withDest = mergeStoredLines(storedLines, absorbedDestLines);
      const enrichedLines = await this.enrichLinesFromMenu(existing.branchId, withDest);
      const previousLines = this.linesFromTicket(existing);
      pendingCancellations = diffCanceledLines(previousLines, enrichedLines);
      linesJson = JSON.stringify(
        enrichedLines.map((l) => ({
          label: l.label,
          qty: l.qty,
          unitPrice: l.unitPrice ?? 0,
          ...(l.menuItemId ? { menuItemId: l.menuItemId } : {}),
        })),
      );
      const lineText = enrichedLines.map((l) => `${l.label} x${l.qty}`).join(", ");
      const baseNotes =
        input.notes !== undefined
          ? input.notes?.trim() || null
          : this.extractNotesFromSummary(existing.itemsSummary);
      const notes = joinOrderNotes(baseNotes, absorbedDestNotes);
      itemsSummary = notes ? `${lineText} · ${notes}` : lineText;
    } else if (input.notes !== undefined) {
      const storedLines = mergeStoredLines(this.linesFromTicket(existing), absorbedDestLines);
      const enrichedLines =
        absorbedDestLines.length > 0
          ? await this.enrichLinesFromMenu(existing.branchId, storedLines)
          : storedLines;
      if (absorbedDestLines.length > 0) {
        linesJson = JSON.stringify(
          enrichedLines.map((l) => ({
            label: l.label,
            qty: l.qty,
            unitPrice: l.unitPrice ?? 0,
            ...(l.menuItemId ? { menuItemId: l.menuItemId } : {}),
          })),
        );
      }
      const lineText =
        enrichedLines.length > 0
          ? enrichedLines.map((l) => `${l.label} x${l.qty}`).join(", ")
          : existing.itemsSummary.split(" · ")[0]?.trim() || existing.itemsSummary;
      const notes = joinOrderNotes(input.notes?.trim() || null, absorbedDestNotes);
      itemsSummary = notes ? `${lineText} · ${notes}` : lineText;
    } else if (absorbedDestLines.length > 0) {
      // Table transfer with destination merge — persist combined items on the moved ticket.
      const merged = mergeStoredLines(this.linesFromTicket(existing), absorbedDestLines);
      const enrichedLines = await this.enrichLinesFromMenu(existing.branchId, merged);
      linesJson = JSON.stringify(
        enrichedLines.map((l) => ({
          label: l.label,
          qty: l.qty,
          unitPrice: l.unitPrice ?? 0,
          ...(l.menuItemId ? { menuItemId: l.menuItemId } : {}),
        })),
      );
      const lineText = enrichedLines.map((l) => `${l.label} x${l.qty}`).join(", ");
      const notes = joinOrderNotes(
        this.extractNotesFromSummary(existing.itemsSummary),
        absorbedDestNotes,
      );
      itemsSummary = notes ? `${lineText} · ${notes}` : lineText;
    }

    const nextStatus = input.status ?? existing.status;

    let billId = existing.billId;
    // When marking done, only *link* an existing completed bill (e.g. already paid on POS).
    // Do not invent a new completed sale here — that blocked Close when day-close was
    // paused or payments were missing. Billing stays on Pay / Invoice.
    if (nextStatus === "done" && !billId && existing.orderRef) {
      const existingBill = await this.db
        .select({ id: popsBills.id })
        .from(popsBills)
        .where(
          and(
            eq(popsBills.branchId, existing.branchId),
            eq(popsBills.orderRef, existing.orderRef),
            eq(popsBills.status, "completed"),
          ),
        )
        .limit(1);
      billId = existingBill[0]?.id ?? null;
    }

    let deliveryStatus = input.deliveryStatus;
    if (input.riderId !== undefined) {
      if (input.riderId && !deliveryStatus) deliveryStatus = "assigned";
      if (input.riderId === null && !deliveryStatus) deliveryStatus = "unassigned";
    }
    if (nextStatus === "done" && existing.stationLabel.toLowerCase().includes("delivery")) {
      deliveryStatus = deliveryStatus ?? "delivered";
    }

    const nextStationLabel = input.stationLabel?.trim() ?? existing.stationLabel;
    const nextRiderId = input.riderId !== undefined ? input.riderId : existing.riderId;
    // Allow Close / Done without a rider — still require rider when keeping the ticket open.
    if (
      nextStatus !== "done" &&
      nextStationLabel.toLowerCase().includes("delivery") &&
      !nextRiderId
    ) {
      throw new BadRequestException("A rider is required for delivery orders.");
    }

    const [row] = await this.db
      .update(popsKitchenTickets)
      .set({
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.stationLabel !== undefined
          ? { stationLabel: input.stationLabel.trim() }
          : {}),
        ...(input.riderId !== undefined ? { riderId: input.riderId } : {}),
        ...(input.deliveryChargePkr !== undefined
          ? { deliveryChargePkr: input.deliveryChargePkr }
          : {}),
        ...(deliveryStatus !== undefined ? { deliveryStatus } : {}),
        ...(linesJson !== undefined ? { linesJson } : {}),
        ...(itemsSummary !== undefined ? { itemsSummary } : {}),
        ...(billId ? { billId } : {}),
        ...(nextStatus === "cooking" && !existing.startedAt
          ? { startedAt: new Date() }
          : {}),
      })
      .where(eq(popsKitchenTickets.id, ticketId))
      .returning();

    if (!row) throw new NotFoundException("Kitchen ticket not found");

    // Latest orders → Close sends recordAsCancellation. Kitchen "mark done" does not.
    const closingOpenTicket =
      existing.status !== "done" &&
      nextStatus === "done" &&
      input.lines === undefined &&
      input.recordAsCancellation === true;
    if (closingOpenTicket && pendingCancellations.length === 0) {
      const hasCompletedBill = Boolean(billId);
      if (!hasCompletedBill) {
        const openLines = this.linesFromTicket(existing);
        pendingCancellations = openLines
          .filter((l) => l.qty > 0)
          .map((l) => ({
            menuItemId: l.menuItemId ?? null,
            label: l.label,
            qtyCanceled: l.qty,
            unitPricePkr: Math.max(0, Math.round(l.unitPrice ?? 0)),
          }));
      }
    }

    if (pendingCancellations.length > 0) {
      let canceledByName: string | null = null;
      if (editor?.userId) {
        const userRows = await this.db
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, editor.userId))
          .limit(1);
        const email = userRows[0]?.email;
        if (email) canceledByName = waiterDisplayName(email);
      }
      const source =
        closingOpenTicket && input.lines === undefined
          ? "order_close"
          : editor?.role === "waiter" || editor?.role === "rider"
            ? "waiter_edit"
            : "pos_edit";
      await this.db.insert(popsKitchenLineCancellations).values(
        pendingCancellations.map((c) => ({
          organizationId,
          branchId: existing.branchId,
          ticketId: existing.id,
          ticketRef: existing.ticketRef,
          orderRef: existing.orderRef,
          stationLabel: nextStationLabel,
          menuItemId: c.menuItemId,
          label: c.label,
          qtyCanceled: c.qtyCanceled,
          unitPricePkr: c.unitPricePkr,
          ticketStatusAtCancel: existing.status,
          canceledByUserId: editor?.userId ?? null,
          canceledByName,
          source,
        })),
      );
    }

    return this.mapTicketForResponse(row);
  }

  async listCancellations(
    organizationId: string,
    branchCode: string,
    opts?: { from?: string; to?: string },
  ) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const conditions = [
      eq(popsKitchenLineCancellations.organizationId, organizationId),
      eq(popsKitchenLineCancellations.branchId, branch.id),
    ];
    if (opts?.from) {
      const fromDate = parseDayStart(opts.from);
      if (fromDate) conditions.push(gte(popsKitchenLineCancellations.canceledAt, fromDate));
    }
    if (opts?.to) {
      const toDate = parseDayEnd(opts.to);
      if (toDate) conditions.push(lte(popsKitchenLineCancellations.canceledAt, toDate));
    }

    const rows = await this.db
      .select()
      .from(popsKitchenLineCancellations)
      .where(and(...conditions))
      .orderBy(desc(popsKitchenLineCancellations.canceledAt));

    const cancellations = rows.map((row) => {
      const amountPkr = row.qtyCanceled * row.unitPricePkr;
      return {
        id: row.id,
        ticketId: row.ticketId,
        ticketRef: row.ticketRef,
        orderRef: row.orderRef,
        stationLabel: row.stationLabel,
        menuItemId: row.menuItemId,
        label: row.label,
        qtyCanceled: row.qtyCanceled,
        unitPricePkr: row.unitPricePkr,
        amountPkr,
        ticketStatusAtCancel: row.ticketStatusAtCancel as KitchenTicketStatus,
        canceledByName: row.canceledByName,
        source: row.source,
        canceledAt: row.canceledAt.toISOString(),
      };
    });

    return {
      branchCode: branch.code,
      from: opts?.from?.trim() || null,
      to: opts?.to?.trim() || null,
      totalQtyCanceled: cancellations.reduce((sum, c) => sum + c.qtyCanceled, 0),
      totalAmountPkr: cancellations.reduce((sum, c) => sum + c.amountPkr, 0),
      cancellations,
    };
  }

  async bumpPriority(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(popsKitchenTickets)
      .where(
        and(
          eq(popsKitchenTickets.branchId, branch.id),
          ne(popsKitchenTickets.status, "done"),
          eq(popsKitchenTickets.priority, "normal"),
        ),
      )
      .orderBy(asc(popsKitchenTickets.createdAt))
      .limit(1);

    const target = rows[0];
    if (!target) return { ok: true, bumped: null };

    const [row] = await this.db
      .update(popsKitchenTickets)
      .set({ priority: "priority" })
      .where(eq(popsKitchenTickets.id, target.id))
      .returning();

    return { ok: true, bumped: row ? await this.mapTicketForResponse(row) : null };
  }

  private async enrichLinesFromMenu(
    branchId: string,
    lines: CreateBill["lines"],
  ): Promise<CreateBill["lines"]> {
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

  private extractNotesFromSummary(summary: string): string | null {
    return extractOrderNotesFromItemsSummary(summary);
  }

  /**
   * When transferring onto an occupied dine-in table: pull open KOTs + held bills
   * into the moving ticket, then clear those occupants so H5 shows one full order.
   */
  private async absorbDestinationTableOccupants(
    source: typeof popsKitchenTickets.$inferSelect,
    nextLabel: string,
  ): Promise<{ lines: StoredLine[]; notes: string | null }> {
    const normalized = normalizeTableLabel(nextLabel);
    const lines: StoredLine[] = [];
    const noteParts: string[] = [];

    const destTickets = await this.db
      .select()
      .from(popsKitchenTickets)
      .where(
        and(
          eq(popsKitchenTickets.branchId, source.branchId),
          ne(popsKitchenTickets.status, "done"),
          ne(popsKitchenTickets.id, source.id),
          sql`lower(trim(${popsKitchenTickets.stationLabel})) = ${normalized}`,
        ),
      );

    for (const dest of destTickets) {
      for (const line of this.linesFromTicket(dest)) {
        lines.push({
          label: line.label,
          qty: line.qty,
          unitPrice: line.unitPrice ?? 0,
          ...(line.menuItemId ? { menuItemId: line.menuItemId } : {}),
        });
      }
      const n = this.extractNotesFromSummary(dest.itemsSummary);
      if (n) noteParts.push(n);
      await this.db
        .update(popsKitchenTickets)
        .set({
          status: "done",
          itemsSummary: `${dest.itemsSummary} · merged→${source.orderRef ?? source.ticketRef}`,
        })
        .where(eq(popsKitchenTickets.id, dest.id));
    }

    const destHeld = await this.db
      .select()
      .from(popsBills)
      .where(
        and(
          eq(popsBills.branchId, source.branchId),
          eq(popsBills.status, "held"),
          sql`lower(trim(${popsBills.tableLabel})) = ${normalized}`,
        ),
      );

    for (const bill of destHeld) {
      const sameOrder =
        source.orderRef?.trim() &&
        bill.orderRef?.trim() &&
        source.orderRef.trim() === bill.orderRef.trim();
      if (sameOrder) {
        // Source's own held bill already on dest — relocateHeldBills will keep it.
        continue;
      }
      try {
        const parsed = JSON.parse(bill.linesJson) as StoredLine[];
        if (Array.isArray(parsed)) {
          for (const line of parsed) {
            if (!line?.label || !(line.qty > 0)) continue;
            lines.push({
              label: line.label,
              qty: line.qty,
              unitPrice: line.unitPrice ?? 0,
              ...(line.menuItemId ? { menuItemId: line.menuItemId } : {}),
            });
          }
        }
      } catch {
        /* ignore bad json */
      }
      if (bill.notes?.trim()) noteParts.push(bill.notes.trim());
      await this.db
        .update(popsBills)
        .set({
          status: "void",
          notes: `${bill.notes?.trim() ? `${bill.notes.trim()} · ` : ""}merged→${source.orderRef ?? source.ticketRef}`,
        })
        .where(eq(popsBills.id, bill.id));
    }

    return {
      lines,
      notes: noteParts.length > 0 ? noteParts.join(" · ") : null,
    };
  }

  /** Move held bills for this order to the new table label. */
  private async relocateHeldBillsForOrder(
    branchId: string,
    orderRef: string | null,
    _fromLabel: string,
    toLabel: string,
  ): Promise<void> {
    if (!isDineInTableLabel(toLabel)) return;
    const ref = orderRef?.trim();
    if (!ref) return;
    await this.db
      .update(popsBills)
      .set({ tableLabel: toLabel.trim() })
      .where(
        and(
          eq(popsBills.branchId, branchId),
          eq(popsBills.status, "held"),
          eq(popsBills.orderRef, ref),
        ),
      );
  }

  private linesFromTicket(row: typeof popsKitchenTickets.$inferSelect): CreateBill["lines"] {
    if (row.linesJson) {
      try {
        const parsed = JSON.parse(row.linesJson) as StoredLine[];
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
    const deliverySplit = row.itemsSummary.split(/\s·\s*Delivery\b/i)[0] ?? row.itemsSummary;
    const foodPart = deliverySplit.split(" · ")[0]?.trim() || deliverySplit.trim();
    return foodPart
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

  private async getTicket(organizationId: string, ticketId: string) {
    const rows = await this.db
      .select()
      .from(popsKitchenTickets)
      .where(eq(popsKitchenTickets.id, ticketId))
      .limit(1);
    const row = rows[0];
    if (!row || row.organizationId !== organizationId) {
      throw new NotFoundException("Kitchen ticket not found");
    }
    return row;
  }
}

function normalizeMenuLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, " ").trim();
}

function lineKey(line: { label: string; menuItemId?: string }): string {
  return line.menuItemId ? `id:${line.menuItemId}` : `label:${normalizeMenuLabel(line.label)}`;
}

function mergeStoredLines(base: StoredLine[], extra: StoredLine[]): StoredLine[] {
  if (extra.length === 0) return base.map((l) => ({ ...l }));
  const out: StoredLine[] = base.map((l) => ({ ...l }));
  for (const line of extra) {
    if (!line.label?.trim() || !(line.qty > 0)) continue;
    const key = lineKey(line);
    const idx = out.findIndex((row) => lineKey(row) === key);
    if (idx >= 0) {
      const prev = out[idx]!;
      out[idx] = {
        ...prev,
        qty: prev.qty + line.qty,
        unitPrice: prev.unitPrice > 0 ? prev.unitPrice : line.unitPrice ?? 0,
        ...(prev.menuItemId || line.menuItemId
          ? { menuItemId: prev.menuItemId ?? line.menuItemId }
          : {}),
      };
    } else {
      out.push({
        label: line.label,
        qty: line.qty,
        unitPrice: line.unitPrice ?? 0,
        ...(line.menuItemId ? { menuItemId: line.menuItemId } : {}),
      });
    }
  }
  return out;
}

function joinOrderNotes(a: string | null | undefined, b: string | null | undefined): string | null {
  const parts = [a?.trim(), b?.trim()].filter(Boolean) as string[];
  if (parts.length === 0) return null;
  return [...new Set(parts)].join(" · ");
}

function aggregateLines(
  lines: Array<{ label: string; qty: number; unitPrice: number; menuItemId?: string }>,
): Map<string, { label: string; qty: number; unitPrice: number; menuItemId?: string }> {
  const map = new Map<string, { label: string; qty: number; unitPrice: number; menuItemId?: string }>();
  for (const line of lines) {
    const key = lineKey(line);
    const prev = map.get(key);
    if (prev) {
      prev.qty += line.qty;
      if (prev.unitPrice <= 0 && line.unitPrice > 0) prev.unitPrice = line.unitPrice;
    } else {
      map.set(key, {
        label: line.label,
        qty: line.qty,
        unitPrice: line.unitPrice ?? 0,
        ...(line.menuItemId ? { menuItemId: line.menuItemId } : {}),
      });
    }
  }
  return map;
}

function diffCanceledLines(
  previous: Array<{ label: string; qty: number; unitPrice: number; menuItemId?: string }>,
  next: Array<{ label: string; qty: number; unitPrice: number; menuItemId?: string }>,
): Array<{ menuItemId: string | null; label: string; qtyCanceled: number; unitPricePkr: number }> {
  const oldMap = aggregateLines(previous);
  const newMap = aggregateLines(next);
  const canceled: Array<{
    menuItemId: string | null;
    label: string;
    qtyCanceled: number;
    unitPricePkr: number;
  }> = [];
  for (const [key, oldLine] of oldMap) {
    const newQty = newMap.get(key)?.qty ?? 0;
    const qtyCanceled = oldLine.qty - newQty;
    if (qtyCanceled > 0) {
      canceled.push({
        menuItemId: oldLine.menuItemId ?? null,
        label: oldLine.label,
        qtyCanceled,
        unitPricePkr: Math.max(0, Math.round(oldLine.unitPrice ?? 0)),
      });
    }
  }
  return canceled;
}

function parseDayStart(value: string): Date | null {
  const day = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  // Pakistan business day (UTC+5) so "today" matches restaurant calendar.
  return new Date(`${day}T00:00:00.000+05:00`);
}

function parseDayEnd(value: string): Date | null {
  const day = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return new Date(`${day}T23:59:59.999+05:00`);
}

function waiterDisplayName(email: string): string {
  const local = email.split("@")[0] ?? email;
  const words = local.replace(/[._-]+/g, " ").trim().split(/\s+/);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function formatMenuItemLabel(name: string, portion: string | null): string {
  if (!portion) return name;
  const p = portion.charAt(0).toUpperCase() + portion.slice(1);
  return `${name} (${p})`;
}
