import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, count, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import {
  pharmacyCollectionAllocations,
  pharmacyCollections,
  pharmacyDistInvoices,
  pharmacyDistOrders,
  pharmacyTradeCustomers,
  popsBranches,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";
import { DeliveryNumberingService } from "../delivery/delivery-numbering.service";

export type CollectionAllocationInput = { invoiceId: string; amountPkr: number };

export type CreateCollectionInput = {
  branchCode: string;
  tradeCustomerId: string;
  amountPkr: number;
  paymentMethod?: string;
  /** Legacy single invoice — converted to one allocation when allocations omitted. */
  invoiceId?: string;
  patientId?: string;
  salesmanEmployeeId?: string;
  notes?: string;
  allocations?: CollectionAllocationInput[];
  /**
   * When true and no allocations: store as advance (unallocatedPkr=amount).
   * Does NOT reduce customer outstanding until allocate() runs.
   */
  advance?: boolean;
  chequeNumber?: string;
  chequeBank?: string;
  chequeDate?: string;
  chequeStatus?: string;
  idempotencyKey?: string;
};

const CHEQUE_TRANSITIONS: Record<string, string[]> = {
  pending: ["deposited", "cancelled"],
  deposited: ["cleared", "bounced", "cancelled"],
  cleared: [],
  bounced: ["cancelled"],
  cancelled: [],
};

/**
 * Collection + multi-invoice allocation.
 * Fixes legacy bug: collection without invoice reduced outstanding but left amountDue open.
 * Rules:
 * - allocations required when amount>0 unless advance=true
 * - sum(allocations) <= amount; unallocated = amount - sum
 * - ALWAYS update each invoice amountPaid/amountDue/status when allocating
 * - Update customer outstanding by allocated amount only (not advance unallocated)
 * - Sync order paymentStatus when all invoices for that order are paid
 */
@Injectable()
export class CollectionService {
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
      .from(pharmacyCollections)
      .where(
        and(
          eq(pharmacyCollections.organizationId, organizationId),
          eq(pharmacyCollections.idempotencyKey, key.trim()),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Apply allocation amounts to invoices + customer outstanding + order paymentStatus.
   * Caller must run inside a transaction.
   */
  private async applyAllocations(
    tx: PlatformPgDb,
    organizationId: string,
    tradeCustomerId: string,
    allocations: CollectionAllocationInput[],
    collectionId: string,
  ) {
    let totalAllocated = 0;
    const touchedOrderIds = new Set<string>();

    for (const alloc of allocations) {
      const amount = Math.round(alloc.amountPkr);
      if (!(amount > 0)) throw new BadRequestException("allocation amountPkr must be positive");

      const [inv] = await tx
        .select()
        .from(pharmacyDistInvoices)
        .where(
          and(
            eq(pharmacyDistInvoices.id, alloc.invoiceId),
            eq(pharmacyDistInvoices.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!inv) throw new BadRequestException(`Invoice not found: ${alloc.invoiceId}`);
      if (inv.tradeCustomerId !== tradeCustomerId) {
        throw new BadRequestException(`Invoice ${alloc.invoiceId} does not belong to trade customer`);
      }
      if (amount > inv.amountDuePkr) {
        throw new BadRequestException(
          `Allocation ${amount} exceeds invoice amountDue ${inv.amountDuePkr} on ${inv.invoiceNumber}`,
        );
      }

      const paid = inv.amountPaidPkr + amount;
      const due = Math.max(0, inv.amountDuePkr - amount);
      await tx
        .update(pharmacyDistInvoices)
        .set({
          amountPaidPkr: paid,
          amountDuePkr: due,
          status: due === 0 ? "paid" : "partial",
        })
        .where(eq(pharmacyDistInvoices.id, inv.id));

      await tx.insert(pharmacyCollectionAllocations).values({
        collectionId,
        invoiceId: inv.id,
        amountPkr: amount,
      });

      if (inv.orderId) touchedOrderIds.add(inv.orderId);
      totalAllocated += amount;
    }

    if (totalAllocated > 0) {
      const [customer] = await tx
        .select()
        .from(pharmacyTradeCustomers)
        .where(eq(pharmacyTradeCustomers.id, tradeCustomerId))
        .limit(1);
      if (customer) {
        await tx
          .update(pharmacyTradeCustomers)
          .set({ outstandingPkr: Math.max(0, customer.outstandingPkr - totalAllocated) })
          .where(eq(pharmacyTradeCustomers.id, customer.id));
      }
    }

    for (const orderId of touchedOrderIds) {
      await this.syncOrderPaymentStatus(tx, organizationId, orderId);
    }

    return totalAllocated;
  }

  /** When all invoices for an order have amountDue=0 → paid; any paid → partial; else unpaid. */
  private async syncOrderPaymentStatus(tx: PlatformPgDb, organizationId: string, orderId: string) {
    const invoices = await tx
      .select({
        amountDuePkr: pharmacyDistInvoices.amountDuePkr,
        amountPaidPkr: pharmacyDistInvoices.amountPaidPkr,
        totalPkr: pharmacyDistInvoices.totalPkr,
      })
      .from(pharmacyDistInvoices)
      .where(
        and(
          eq(pharmacyDistInvoices.organizationId, organizationId),
          eq(pharmacyDistInvoices.orderId, orderId),
        ),
      );

    if (invoices.length === 0) return;

    const allPaid = invoices.every((i) => i.amountDuePkr === 0);
    const anyPaid = invoices.some((i) => i.amountPaidPkr > 0);
    const paymentStatus = allPaid ? "paid" : anyPaid ? "partial" : "unpaid";

    await tx
      .update(pharmacyDistOrders)
      .set({ paymentStatus })
      .where(eq(pharmacyDistOrders.id, orderId));
  }

  async list(
    organizationId: string,
    filters: {
      branchCode?: string;
      tradeCustomerId?: string;
      paymentMethod?: string;
      chequeStatus?: string;
      from?: string;
      to?: string;
      q?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
    const offset = (page - 1) * pageSize;

    const conds: SQL[] = [eq(pharmacyCollections.organizationId, organizationId)];
    if (filters.branchCode?.trim()) {
      const branch = await this.resolveBranch(organizationId, filters.branchCode);
      conds.push(eq(pharmacyCollections.branchId, branch.id));
    }
    if (filters.tradeCustomerId?.trim()) {
      conds.push(eq(pharmacyCollections.tradeCustomerId, filters.tradeCustomerId.trim()));
    }
    if (filters.paymentMethod?.trim()) {
      conds.push(eq(pharmacyCollections.paymentMethod, filters.paymentMethod.trim()));
    }
    if (filters.chequeStatus?.trim()) {
      conds.push(eq(pharmacyCollections.chequeStatus, filters.chequeStatus.trim()));
    }
    if (filters.from?.trim()) {
      conds.push(gte(pharmacyCollections.createdAt, new Date(`${filters.from.trim()}T00:00:00.000Z`)));
    }
    if (filters.to?.trim()) {
      conds.push(lte(pharmacyCollections.createdAt, new Date(`${filters.to.trim()}T23:59:59.999Z`)));
    }
    if (filters.q?.trim()) {
      const q = `%${filters.q.trim()}%`;
      conds.push(
        or(ilike(pharmacyCollections.collectionNumber, q), ilike(pharmacyCollections.chequeNumber, q))!,
      );
    }
    const where = and(...conds);

    const [totalRow] = await this.db.select({ n: count() }).from(pharmacyCollections).where(where);
    const items = await this.db
      .select()
      .from(pharmacyCollections)
      .where(where)
      .orderBy(desc(pharmacyCollections.createdAt))
      .limit(pageSize)
      .offset(offset);

    return { items, page, pageSize, total: Number(totalRow?.n ?? 0) };
  }

  async getById(organizationId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(pharmacyCollections)
      .where(and(eq(pharmacyCollections.id, id), eq(pharmacyCollections.organizationId, organizationId)))
      .limit(1);
    if (!row) throw new NotFoundException("Collection not found");
    const allocations = await this.db
      .select()
      .from(pharmacyCollectionAllocations)
      .where(eq(pharmacyCollectionAllocations.collectionId, id));
    return { ...row, allocations };
  }

  async getDashboard(organizationId: string, branchCode?: string) {
    const conds: SQL[] = [eq(pharmacyCollections.organizationId, organizationId)];
    if (branchCode?.trim()) {
      const branch = await this.resolveBranch(organizationId, branchCode);
      conds.push(eq(pharmacyCollections.branchId, branch.id));
    }
    const where = and(...conds);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [agg] = await this.db
      .select({
        todayPkr: sql<number>`coalesce(sum(${pharmacyCollections.amountPkr}) filter (where ${pharmacyCollections.createdAt} >= ${todayStart}), 0)::int`,
        todayCount: sql<number>`count(*) filter (where ${pharmacyCollections.createdAt} >= ${todayStart})::int`,
        unallocatedPkr: sql<number>`coalesce(sum(${pharmacyCollections.unallocatedPkr}), 0)::int`,
        pendingCheques: sql<number>`count(*) filter (where ${pharmacyCollections.chequeStatus} in ('pending','deposited'))::int`,
        bouncedCheques: sql<number>`count(*) filter (where ${pharmacyCollections.chequeStatus} = 'bounced')::int`,
      })
      .from(pharmacyCollections)
      .where(where);

    return {
      todayPkr: agg?.todayPkr ?? 0,
      todayCount: agg?.todayCount ?? 0,
      unallocatedPkr: agg?.unallocatedPkr ?? 0,
      pendingCheques: agg?.pendingCheques ?? 0,
      bouncedCheques: agg?.bouncedCheques ?? 0,
      asOf: new Date().toISOString(),
    };
  }

  async create(organizationId: string, input: CreateCollectionInput, userId?: string) {
    if (!input.tradeCustomerId || !(input.amountPkr > 0)) {
      throw new BadRequestException("tradeCustomerId and positive amountPkr are required");
    }

    const existing = await this.findByIdempotency(organizationId, input.idempotencyKey);
    if (existing) return this.getById(organizationId, existing.id);

    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const amount = Math.round(input.amountPkr);

    // Normalize allocations: legacy invoiceId → single allocation
    let allocations = (input.allocations ?? []).map((a) => ({
      invoiceId: a.invoiceId,
      amountPkr: Math.round(a.amountPkr),
    }));
    if (allocations.length === 0 && input.invoiceId) {
      allocations = [{ invoiceId: input.invoiceId, amountPkr: amount }];
    }

    const isAdvance = input.advance === true;
    if (allocations.length === 0 && !isAdvance) {
      throw new BadRequestException(
        "allocations are required (or set advance=true to hold as unallocated without reducing outstanding)",
      );
    }

    const allocSum = allocations.reduce((s, a) => s + a.amountPkr, 0);
    if (allocSum > amount) {
      throw new BadRequestException(`sum(allocations)=${allocSum} exceeds amountPkr=${amount}`);
    }
    const unallocated = amount - allocSum;

    if (isAdvance && allocations.length === 0) {
      // Pure advance: full amount unallocated, outstanding untouched until allocate().
    }

    const paymentMethod = input.paymentMethod ?? "Cash";
    const isCheque = /cheque|check/i.test(paymentMethod);

    return this.numbering.withNumber(organizationId, "collection", async (collectionNumber) => {
      try {
        return await this.db.transaction(async (tx) => {
          const [created] = await tx
            .insert(pharmacyCollections)
            .values({
              organizationId,
              branchId: branch.id,
              collectionNumber,
              tradeCustomerId: input.tradeCustomerId,
              invoiceId: allocations.length === 1 ? allocations[0]!.invoiceId : input.invoiceId ?? null,
              patientId: input.patientId ?? null,
              amountPkr: amount,
              paymentMethod,
              chequeNumber: input.chequeNumber ?? null,
              chequeBank: input.chequeBank ?? null,
              chequeDate: input.chequeDate ?? null,
              chequeStatus: input.chequeStatus ?? (isCheque ? "pending" : null),
              unallocatedPkr: unallocated,
              salesmanEmployeeId: input.salesmanEmployeeId ?? null,
              notes: input.notes ?? null,
              idempotencyKey: input.idempotencyKey?.trim() || null,
              createdByUserId: userId ?? null,
            })
            .returning();
          if (!created) throw new BadRequestException("Failed to create collection");

          if (allocations.length > 0) {
            await this.applyAllocations(
              tx as unknown as PlatformPgDb,
              organizationId,
              input.tradeCustomerId,
              allocations,
              created.id,
            );
          }
          // Advance / unallocated remainder: outstanding NOT reduced for unallocated portion.

          const allocRows = await tx
            .select()
            .from(pharmacyCollectionAllocations)
            .where(eq(pharmacyCollectionAllocations.collectionId, created.id));
          return { ...created, allocations: allocRows };
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("duplicate") || msg.includes("unique") || (err as { code?: string })?.code === "23505") {
          if (input.idempotencyKey) {
            const again = await this.findByIdempotency(organizationId, input.idempotencyKey);
            if (again) return this.getById(organizationId, again.id);
          }
          throw new ConflictException("Collection number or idempotency key conflict");
        }
        throw err;
      }
    });
  }

  /** Allocate remaining unallocatedPkr on an advance collection. */
  async allocate(
    organizationId: string,
    collectionId: string,
    allocations: CollectionAllocationInput[],
  ) {
    if (!allocations?.length) throw new BadRequestException("allocations required");
    const collection = await this.getById(organizationId, collectionId);
    if (collection.unallocatedPkr <= 0) {
      throw new BadRequestException("Collection has no unallocated amount");
    }

    const allocSum = allocations.reduce((s, a) => s + Math.round(a.amountPkr), 0);
    if (allocSum > collection.unallocatedPkr) {
      throw new BadRequestException(
        `sum(allocations)=${allocSum} exceeds unallocatedPkr=${collection.unallocatedPkr}`,
      );
    }

    return this.db.transaction(async (tx) => {
      await this.applyAllocations(
        tx as unknown as PlatformPgDb,
        organizationId,
        collection.tradeCustomerId,
        allocations.map((a) => ({ invoiceId: a.invoiceId, amountPkr: Math.round(a.amountPkr) })),
        collectionId,
      );
      const [updated] = await tx
        .update(pharmacyCollections)
        .set({ unallocatedPkr: collection.unallocatedPkr - allocSum })
        .where(eq(pharmacyCollections.id, collectionId))
        .returning();

      const allocRows = await tx
        .select()
        .from(pharmacyCollectionAllocations)
        .where(eq(pharmacyCollectionAllocations.collectionId, collectionId));
      return { ...updated!, allocations: allocRows };
    });
  }

  async updateChequeStatus(
    organizationId: string,
    collectionId: string,
    chequeStatus: string,
  ) {
    const collection = await this.getById(organizationId, collectionId);
    if (!collection.chequeStatus && !/cheque|check/i.test(collection.paymentMethod)) {
      throw new BadRequestException("Collection is not a cheque payment");
    }
    const current = collection.chequeStatus ?? "pending";
    const allowed = CHEQUE_TRANSITIONS[current] ?? [];
    if (!allowed.includes(chequeStatus)) {
      throw new BadRequestException(
        `Invalid cheque transition ${current} → ${chequeStatus}. Allowed: ${allowed.join(", ") || "none"}`,
      );
    }

    // Bounce: reverse outstanding reduction for allocated amount (re-open AR).
    if (chequeStatus === "bounced") {
      return this.db.transaction(async (tx) => {
        const allocated = collection.amountPkr - collection.unallocatedPkr;
        if (allocated > 0) {
          // Reverse invoice payments from allocations
          for (const alloc of collection.allocations) {
            const [inv] = await tx
              .select()
              .from(pharmacyDistInvoices)
              .where(eq(pharmacyDistInvoices.id, alloc.invoiceId))
              .limit(1);
            if (!inv) continue;
            const paid = Math.max(0, inv.amountPaidPkr - alloc.amountPkr);
            const due = inv.amountDuePkr + alloc.amountPkr;
            await tx
              .update(pharmacyDistInvoices)
              .set({
                amountPaidPkr: paid,
                amountDuePkr: due,
                status: paid === 0 ? "posted" : "partial",
              })
              .where(eq(pharmacyDistInvoices.id, inv.id));
            if (inv.orderId) {
              await this.syncOrderPaymentStatus(tx as unknown as PlatformPgDb, organizationId, inv.orderId);
            }
          }
          const [customer] = await tx
            .select()
            .from(pharmacyTradeCustomers)
            .where(eq(pharmacyTradeCustomers.id, collection.tradeCustomerId))
            .limit(1);
          if (customer) {
            await tx
              .update(pharmacyTradeCustomers)
              .set({ outstandingPkr: customer.outstandingPkr + allocated })
              .where(eq(pharmacyTradeCustomers.id, customer.id));
          }
        }
        const [updated] = await tx
          .update(pharmacyCollections)
          .set({ chequeStatus })
          .where(eq(pharmacyCollections.id, collectionId))
          .returning();
        return { ...updated!, allocations: collection.allocations };
      });
    }

    const [updated] = await this.db
      .update(pharmacyCollections)
      .set({ chequeStatus })
      .where(eq(pharmacyCollections.id, collectionId))
      .returning();
    return { ...updated!, allocations: collection.allocations };
  }
}
