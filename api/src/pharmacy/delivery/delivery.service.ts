import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, count, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import {
  pharmacyDeliveryLines,
  pharmacyDeliveries,
  pharmacyDistInvoiceLines,
  pharmacyDistInvoices,
  pharmacyDistOrderLines,
  pharmacyDistOrders,
  pharmacyDrivers,
  pharmacyMedicineBatches,
  pharmacyMedicines,
  pharmacyTradeCustomers,
  pharmacyVehicles,
  popsBranches,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";
import { DeliveryNumberingService } from "./delivery-numbering.service";

export type DeliveryListFilters = {
  branchCode?: string;
  status?: string;
  driverId?: string;
  routeId?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  pageSize?: number;
};

const TERMINAL_STATUSES = new Set(["delivered", "partial", "failed", "refused", "cancelled"]);

/**
 * Dist delivery lifecycle. Syncs pharmacy_dist_orders.deliveryStatus on dispatch/POD.
 * Does NOT mutate invoice line quantities (returns use wholesale return path separately).
 */
@Injectable()
export class DeliveryService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly numbering: DeliveryNumberingService,
  ) {}

  private async resolveBranch(organizationId: string, branchCode: string) {
    const code = branchCode.trim();
    if (!code) throw new BadRequestException("branchCode is required");
    const [branch] = await this.db
      .select()
      .from(popsBranches)
      .where(and(eq(popsBranches.organizationId, organizationId), eq(popsBranches.code, code)))
      .limit(1);
    if (!branch) throw new NotFoundException(`Branch not found: ${code}`);
    return branch;
  }

  private async findByIdempotency(organizationId: string, key?: string | null) {
    if (!key?.trim()) return null;
    const [row] = await this.db
      .select()
      .from(pharmacyDeliveries)
      .where(
        and(
          eq(pharmacyDeliveries.organizationId, organizationId),
          eq(pharmacyDeliveries.idempotencyKey, key.trim()),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  private mapOrderDeliveryStatus(status: string): string {
    switch (status) {
      case "dispatched":
        return "dispatched";
      case "out_for_delivery":
        return "out_for_delivery";
      case "delivered":
        return "delivered";
      case "partial":
        return "partial";
      case "failed":
        return "failed";
      case "refused":
        return "refused";
      default:
        return status;
    }
  }

  private async syncOrderDelivery(
    tx: PlatformPgDb,
    orderId: string | null | undefined,
    status: string,
    extras?: { dispatchedAt?: Date; deliveredAt?: Date },
  ) {
    if (!orderId) return;
    const patch: Record<string, unknown> = {
      deliveryStatus: this.mapOrderDeliveryStatus(status),
    };
    if (extras?.dispatchedAt) patch.dispatchedAt = extras.dispatchedAt;
    if (extras?.deliveredAt) patch.deliveredAt = extras.deliveredAt;
    if (status === "dispatched" || status === "out_for_delivery") {
      patch.status = status === "dispatched" ? "dispatched" : "dispatched";
    }
    if (status === "delivered" || status === "partial") {
      patch.status = "delivered";
    }
    await tx.update(pharmacyDistOrders).set(patch).where(eq(pharmacyDistOrders.id, orderId));
  }

  async list(organizationId: string, filters: DeliveryListFilters = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
    const offset = (page - 1) * pageSize;

    const conds: SQL[] = [eq(pharmacyDeliveries.organizationId, organizationId)];
    if (filters.branchCode?.trim()) {
      const branch = await this.resolveBranch(organizationId, filters.branchCode);
      conds.push(eq(pharmacyDeliveries.branchId, branch.id));
    }
    if (filters.status?.trim()) conds.push(eq(pharmacyDeliveries.status, filters.status.trim()));
    if (filters.driverId?.trim()) conds.push(eq(pharmacyDeliveries.driverId, filters.driverId.trim()));
    if (filters.routeId?.trim()) conds.push(eq(pharmacyDeliveries.routeId, filters.routeId.trim()));
    if (filters.from?.trim()) {
      conds.push(gte(pharmacyDeliveries.createdAt, new Date(`${filters.from.trim()}T00:00:00.000Z`)));
    }
    if (filters.to?.trim()) {
      conds.push(lte(pharmacyDeliveries.createdAt, new Date(`${filters.to.trim()}T23:59:59.999Z`)));
    }
    if (filters.q?.trim()) {
      const q = `%${filters.q.trim()}%`;
      conds.push(
        or(
          ilike(pharmacyDeliveries.deliveryNumber, q),
          ilike(pharmacyDeliveries.address, q),
          ilike(pharmacyDeliveries.contactName, q),
          ilike(pharmacyDeliveries.riderName, q),
        )!,
      );
    }
    const where = and(...conds);

    const [totalRow] = await this.db.select({ n: count() }).from(pharmacyDeliveries).where(where);
    const items = await this.db
      .select()
      .from(pharmacyDeliveries)
      .where(where)
      .orderBy(desc(pharmacyDeliveries.createdAt))
      .limit(pageSize)
      .offset(offset);

    return { items, page, pageSize, total: Number(totalRow?.n ?? 0) };
  }

  async getById(organizationId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(pharmacyDeliveries)
      .where(and(eq(pharmacyDeliveries.id, id), eq(pharmacyDeliveries.organizationId, organizationId)))
      .limit(1);
    if (!row) throw new NotFoundException("Delivery not found");
    const lines = await this.db
      .select()
      .from(pharmacyDeliveryLines)
      .where(eq(pharmacyDeliveryLines.deliveryId, id));
    return { ...row, lines };
  }

  private async insertLinesFromInvoice(
    tx: PlatformPgDb,
    deliveryId: string,
    invoiceId: string,
  ) {
    const invLines = await tx
      .select({
        medicineId: pharmacyDistInvoiceLines.medicineId,
        batchId: pharmacyDistInvoiceLines.batchId,
        quantity: pharmacyDistInvoiceLines.quantity,
        medicineName: pharmacyMedicines.name,
        batchNumber: pharmacyMedicineBatches.batchNumber,
      })
      .from(pharmacyDistInvoiceLines)
      .leftJoin(pharmacyMedicines, eq(pharmacyDistInvoiceLines.medicineId, pharmacyMedicines.id))
      .leftJoin(pharmacyMedicineBatches, eq(pharmacyDistInvoiceLines.batchId, pharmacyMedicineBatches.id))
      .where(eq(pharmacyDistInvoiceLines.invoiceId, invoiceId));

    if (invLines.length === 0) return;
    await tx.insert(pharmacyDeliveryLines).values(
      invLines.map((l) => ({
        deliveryId,
        medicineId: l.medicineId,
        productLabel: l.medicineName ?? null,
        batchId: l.batchId,
        batchNumber: l.batchNumber ?? null,
        quantity: l.quantity,
        deliveredQty: 0,
        returnedQty: 0,
      })),
    );
  }

  private async insertLinesFromOrder(tx: PlatformPgDb, deliveryId: string, orderId: string) {
    const orderLines = await tx
      .select({
        medicineId: pharmacyDistOrderLines.medicineId,
        batchId: pharmacyDistOrderLines.batchId,
        quantity: pharmacyDistOrderLines.quantity,
        medicineName: pharmacyMedicines.name,
        batchNumber: pharmacyMedicineBatches.batchNumber,
      })
      .from(pharmacyDistOrderLines)
      .leftJoin(pharmacyMedicines, eq(pharmacyDistOrderLines.medicineId, pharmacyMedicines.id))
      .leftJoin(pharmacyMedicineBatches, eq(pharmacyDistOrderLines.batchId, pharmacyMedicineBatches.id))
      .where(eq(pharmacyDistOrderLines.orderId, orderId));

    if (orderLines.length === 0) return;
    await tx.insert(pharmacyDeliveryLines).values(
      orderLines.map((l) => ({
        deliveryId,
        medicineId: l.medicineId,
        productLabel: l.medicineName ?? null,
        batchId: l.batchId,
        batchNumber: l.batchNumber ?? null,
        quantity: l.quantity,
        deliveredQty: 0,
        returnedQty: 0,
      })),
    );
  }

  async createFromInvoice(
    organizationId: string,
    input: {
      branchCode: string;
      invoiceId: string;
      driverId?: string;
      vehicleId?: string;
      routeId?: string;
      warehouseId?: string;
      priority?: string;
      address?: string;
      contactName?: string;
      contactPhone?: string;
      idempotencyKey?: string;
    },
  ) {
    const existing = await this.findByIdempotency(organizationId, input.idempotencyKey);
    if (existing) return this.getById(organizationId, existing.id);

    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [inv] = await this.db
      .select()
      .from(pharmacyDistInvoices)
      .where(
        and(eq(pharmacyDistInvoices.id, input.invoiceId), eq(pharmacyDistInvoices.organizationId, organizationId)),
      )
      .limit(1);
    if (!inv) throw new NotFoundException("Invoice not found");

    let address = input.address ?? null;
    let contactName = input.contactName ?? null;
    let contactPhone = input.contactPhone ?? null;
    if (inv.tradeCustomerId && (!address || !contactName)) {
      const [cust] = await this.db
        .select()
        .from(pharmacyTradeCustomers)
        .where(eq(pharmacyTradeCustomers.id, inv.tradeCustomerId))
        .limit(1);
      if (cust) {
        address = address ?? cust.address ?? null;
        contactName = contactName ?? cust.name ?? null;
        contactPhone = contactPhone ?? cust.phone ?? null;
      }
    }

    // Avoid nested db.transaction here — some PG drivers (e.g. serverless) can
    // return insert ids that are not visible to a follow-up getById.
    return this.numbering.withNumber(organizationId, "delivery", async (deliveryNumber) => {
      const [row] = await this.db
        .insert(pharmacyDeliveries)
        .values({
          organizationId,
          branchId: branch.id,
          deliveryNumber,
          orderId: inv.orderId,
          invoiceId: inv.id,
          tradeCustomerId: inv.tradeCustomerId,
          driverId: input.driverId ?? null,
          vehicleId: input.vehicleId ?? null,
          routeId: input.routeId ?? null,
          warehouseId: input.warehouseId ?? null,
          priority: input.priority ?? "normal",
          address,
          contactName,
          contactPhone,
          status: "ready",
          idempotencyKey: input.idempotencyKey?.trim() || null,
        })
        .returning();
      if (!row) throw new BadRequestException("Failed to create delivery");
      await this.insertLinesFromInvoice(this.db, row.id, inv.id);
      return this.getById(organizationId, row.id);
    });
  }

  async createFromOrder(
    organizationId: string,
    input: {
      branchCode: string;
      orderId: string;
      invoiceId?: string;
      driverId?: string;
      vehicleId?: string;
      routeId?: string;
      warehouseId?: string;
      priority?: string;
      address?: string;
      contactName?: string;
      contactPhone?: string;
      idempotencyKey?: string;
    },
  ) {
    const existing = await this.findByIdempotency(organizationId, input.idempotencyKey);
    if (existing) return this.getById(organizationId, existing.id);

    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [order] = await this.db
      .select()
      .from(pharmacyDistOrders)
      .where(
        and(eq(pharmacyDistOrders.id, input.orderId), eq(pharmacyDistOrders.organizationId, organizationId)),
      )
      .limit(1);
    if (!order) throw new NotFoundException("Order not found");

    let invoiceId = input.invoiceId ?? null;
    if (!invoiceId) {
      const [inv] = await this.db
        .select({ id: pharmacyDistInvoices.id })
        .from(pharmacyDistInvoices)
        .where(
          and(
            eq(pharmacyDistInvoices.organizationId, organizationId),
            eq(pharmacyDistInvoices.orderId, order.id),
          ),
        )
        .orderBy(desc(pharmacyDistInvoices.createdAt))
        .limit(1);
      invoiceId = inv?.id ?? null;
    }

    let address = input.address ?? null;
    let contactName = input.contactName ?? null;
    let contactPhone = input.contactPhone ?? null;
    const [cust] = await this.db
      .select()
      .from(pharmacyTradeCustomers)
      .where(eq(pharmacyTradeCustomers.id, order.tradeCustomerId))
      .limit(1);
    if (cust) {
      address = address ?? cust.address ?? null;
      contactName = contactName ?? cust.name ?? null;
      contactPhone = contactPhone ?? cust.phone ?? null;
    }

    return this.numbering.withNumber(organizationId, "delivery", async (deliveryNumber) => {
      const [row] = await this.db
        .insert(pharmacyDeliveries)
        .values({
          organizationId,
          branchId: branch.id,
          deliveryNumber,
          orderId: order.id,
          invoiceId,
          tradeCustomerId: order.tradeCustomerId,
          driverId: input.driverId ?? null,
          vehicleId: input.vehicleId ?? null,
          routeId: input.routeId ?? null,
          warehouseId: input.warehouseId ?? order.warehouseId ?? null,
          priority: input.priority ?? "normal",
          address,
          contactName,
          contactPhone,
          status: "ready",
          idempotencyKey: input.idempotencyKey?.trim() || null,
        })
        .returning();
      if (!row) throw new BadRequestException("Failed to create delivery");
      if (invoiceId) {
        await this.insertLinesFromInvoice(this.db, row.id, invoiceId);
      } else {
        await this.insertLinesFromOrder(this.db, row.id, order.id);
      }
      return this.getById(organizationId, row.id);
    });
  }

  /** Manual create — legacy-compatible; prefer createFromInvoice/Order. */
  async create(
    organizationId: string,
    input: {
      branchCode: string;
      orderId?: string;
      invoiceId?: string;
      tradeCustomerId?: string;
      riderName?: string;
      driverId?: string;
      vehicleId?: string;
      routeId?: string;
      warehouseId?: string;
      priority?: string;
      address?: string;
      contactName?: string;
      contactPhone?: string;
      idempotencyKey?: string;
    },
  ) {
    if (input.invoiceId) {
      return this.createFromInvoice(organizationId, {
        branchCode: input.branchCode,
        invoiceId: input.invoiceId,
        driverId: input.driverId,
        vehicleId: input.vehicleId,
        routeId: input.routeId,
        warehouseId: input.warehouseId,
        priority: input.priority,
        address: input.address,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        idempotencyKey: input.idempotencyKey,
      });
    }
    if (input.orderId) {
      return this.createFromOrder(organizationId, {
        branchCode: input.branchCode,
        orderId: input.orderId,
        driverId: input.driverId,
        vehicleId: input.vehicleId,
        routeId: input.routeId,
        warehouseId: input.warehouseId,
        priority: input.priority,
        address: input.address,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        idempotencyKey: input.idempotencyKey,
      });
    }

    const existing = await this.findByIdempotency(organizationId, input.idempotencyKey);
    if (existing) return this.getById(organizationId, existing.id);

    const branch = await this.resolveBranch(organizationId, input.branchCode);
    return this.numbering.withNumber(organizationId, "delivery", async (deliveryNumber) => {
      const [row] = await this.db
        .insert(pharmacyDeliveries)
        .values({
          organizationId,
          branchId: branch.id,
          deliveryNumber,
          orderId: input.orderId ?? null,
          invoiceId: input.invoiceId ?? null,
          tradeCustomerId: input.tradeCustomerId ?? null,
          riderName: input.riderName ?? null,
          driverId: input.driverId ?? null,
          vehicleId: input.vehicleId ?? null,
          routeId: input.routeId ?? null,
          warehouseId: input.warehouseId ?? null,
          priority: input.priority ?? "normal",
          address: input.address ?? null,
          contactName: input.contactName ?? null,
          contactPhone: input.contactPhone ?? null,
          status: "pending",
          idempotencyKey: input.idempotencyKey?.trim() || null,
        })
        .returning();
      if (!row) throw new BadRequestException("Failed to create delivery");
      return this.getById(organizationId, row.id);
    });
  }

  async assign(
    organizationId: string,
    id: string,
    input: {
      driverId?: string | null;
      vehicleId?: string | null;
      routeId?: string | null;
      riderName?: string | null;
      priority?: string;
    },
  ) {
    const delivery = await this.getById(organizationId, id);
    if (TERMINAL_STATUSES.has(delivery.status)) {
      throw new BadRequestException(`Cannot assign driver on terminal status: ${delivery.status}`);
    }
    if (input.driverId) {
      const [d] = await this.db
        .select({ id: pharmacyDrivers.id })
        .from(pharmacyDrivers)
        .where(and(eq(pharmacyDrivers.id, input.driverId), eq(pharmacyDrivers.organizationId, organizationId)))
        .limit(1);
      if (!d) throw new BadRequestException("driverId not found");
    }
    if (input.vehicleId) {
      const [v] = await this.db
        .select({ id: pharmacyVehicles.id })
        .from(pharmacyVehicles)
        .where(and(eq(pharmacyVehicles.id, input.vehicleId), eq(pharmacyVehicles.organizationId, organizationId)))
        .limit(1);
      if (!v) throw new BadRequestException("vehicleId not found");
    }

    const [updated] = await this.db
      .update(pharmacyDeliveries)
      .set({
        ...(input.driverId !== undefined ? { driverId: input.driverId } : {}),
        ...(input.vehicleId !== undefined ? { vehicleId: input.vehicleId } : {}),
        ...(input.routeId !== undefined ? { routeId: input.routeId } : {}),
        ...(input.riderName !== undefined ? { riderName: input.riderName } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
      })
      .where(eq(pharmacyDeliveries.id, id))
      .returning();
    return updated;
  }

  async dispatch(organizationId: string, ids: string[]) {
    if (!ids?.length) throw new BadRequestException("ids array is required");
    const now = new Date();
    const results = [];
    for (const id of ids) {
      const [existing] = await this.db
        .select()
        .from(pharmacyDeliveries)
        .where(and(eq(pharmacyDeliveries.id, id), eq(pharmacyDeliveries.organizationId, organizationId)))
        .limit(1);
      if (!existing) throw new NotFoundException(`Delivery not found: ${id}`);
      if (TERMINAL_STATUSES.has(existing.status)) {
        throw new BadRequestException(`Cannot dispatch terminal delivery ${existing.deliveryNumber}`);
      }
      const [updated] = await this.db
        .update(pharmacyDeliveries)
        .set({ status: "dispatched", dispatchedAt: now })
        .where(eq(pharmacyDeliveries.id, id))
        .returning();
      await this.syncOrderDelivery(this.db, existing.orderId, "dispatched", { dispatchedAt: now });
      results.push(updated);
    }
    return { items: results, count: results.length };
  }

  async markOutForDelivery(organizationId: string, id: string) {
    const [existing] = await this.db
      .select()
      .from(pharmacyDeliveries)
      .where(and(eq(pharmacyDeliveries.id, id), eq(pharmacyDeliveries.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Delivery not found");
    if (TERMINAL_STATUSES.has(existing.status)) {
      throw new BadRequestException(`Cannot mark out for delivery from status: ${existing.status}`);
    }
    const now = new Date();
    const [updated] = await this.db
      .update(pharmacyDeliveries)
      .set({
        status: "out_for_delivery",
        outForDeliveryAt: now,
        dispatchedAt: existing.dispatchedAt ?? now,
      })
      .where(eq(pharmacyDeliveries.id, id))
      .returning();
    await this.syncOrderDelivery(this.db, existing.orderId, "out_for_delivery", {
      dispatchedAt: existing.dispatchedAt ?? now,
    });
    return updated;
  }

  async completePod(
    organizationId: string,
    id: string,
    input: {
      status: "delivered" | "partial" | "failed" | "refused";
      receiverName?: string;
      signatureRef?: string;
      photoRef?: string;
      failedReason?: string;
      refusalReason?: string;
      podNotes?: string;
      collectedPkr?: number;
      requireReceiverName?: boolean;
      lines?: Array<{
        lineId: string;
        deliveredQty?: number;
        returnedQty?: number;
        notes?: string;
      }>;
      idempotencyKey?: string;
    },
  ) {
    // Idempotent POD: if same key already applied on this delivery, return current state.
    if (input.idempotencyKey?.trim()) {
      const [byKey] = await this.db
        .select()
        .from(pharmacyDeliveries)
        .where(
          and(
            eq(pharmacyDeliveries.organizationId, organizationId),
            eq(pharmacyDeliveries.idempotencyKey, input.idempotencyKey.trim()),
            inArray(pharmacyDeliveries.status, ["delivered", "partial", "failed", "refused"]),
          ),
        )
        .limit(1);
      if (byKey && byKey.id === id) return this.getById(organizationId, id);
      if (byKey && byKey.id !== id) {
        throw new ConflictException("idempotencyKey already used on another delivery");
      }
    }

    const delivery = await this.getById(organizationId, id);
    if (TERMINAL_STATUSES.has(delivery.status) && delivery.status !== "partial") {
      // Legacy: already completed — return as-is (idempotent).
      return delivery;
    }

    const requireReceiver = input.requireReceiverName !== false;
    if (input.status === "delivered" && requireReceiver && !input.receiverName?.trim()) {
      throw new BadRequestException("receiverName is required for delivered POD");
    }
    if (
      (input.status === "failed" || input.status === "refused") &&
      !(input.failedReason?.trim() || input.refusalReason?.trim() || input.podNotes?.trim())
    ) {
      throw new BadRequestException("reason is required for failed/refused POD");
    }

    const now = new Date();
    return this.db.transaction(async (tx) => {
      if (input.lines?.length) {
        for (const line of input.lines) {
          const patch: Record<string, unknown> = {};
          if (line.deliveredQty !== undefined) patch.deliveredQty = Math.max(0, Math.round(line.deliveredQty));
          if (line.returnedQty !== undefined) patch.returnedQty = Math.max(0, Math.round(line.returnedQty));
          if (line.notes !== undefined) patch.notes = line.notes;
          if (Object.keys(patch).length === 0) continue;
          await tx
            .update(pharmacyDeliveryLines)
            .set(patch)
            .where(
              and(eq(pharmacyDeliveryLines.id, line.lineId), eq(pharmacyDeliveryLines.deliveryId, id)),
            );
        }
      } else if (input.status === "delivered") {
        // Default: mark all lines fully delivered when no explicit line updates.
        await tx
          .update(pharmacyDeliveryLines)
          .set({ deliveredQty: sql`${pharmacyDeliveryLines.quantity}` })
          .where(eq(pharmacyDeliveryLines.deliveryId, id));
      }

      const [updated] = await tx
        .update(pharmacyDeliveries)
        .set({
          status: input.status,
          receiverName: input.receiverName?.trim() || delivery.receiverName,
          signatureRef: input.signatureRef ?? delivery.signatureRef,
          photoRef: input.photoRef ?? delivery.photoRef,
          failedReason: input.failedReason ?? delivery.failedReason,
          refusalReason: input.refusalReason ?? (input.status === "refused" ? input.failedReason : null),
          podNotes: input.podNotes ?? delivery.podNotes,
          collectedPkr:
            input.collectedPkr != null ? Math.round(input.collectedPkr) : delivery.collectedPkr,
          // Note: collectedPkr on POD is informational only — real AR via CollectionService.
          deliveredAt: ["delivered", "partial"].includes(input.status) ? now : delivery.deliveredAt,
          idempotencyKey: input.idempotencyKey?.trim() || delivery.idempotencyKey,
        })
        .where(eq(pharmacyDeliveries.id, id))
        .returning();

      await this.syncOrderDelivery(tx as unknown as PlatformPgDb, delivery.orderId, input.status, {
        deliveredAt: ["delivered", "partial"].includes(input.status) ? now : undefined,
      });

      const lines = await tx
        .select()
        .from(pharmacyDeliveryLines)
        .where(eq(pharmacyDeliveryLines.deliveryId, id));
      return { ...updated!, lines };
    });
  }
}
