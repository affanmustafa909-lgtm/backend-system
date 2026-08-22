import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  CreateStoreCashMovement,
  CreateStoreCoupon,
  CreateStoreGiftCard,
  CreateStorePurchaseReturn,
  CreateStoreSaleReturn,
} from "@platform/contracts";
import { LOYALTY_TIER_MULTIPLIERS } from "@platform/contracts";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import {
  popsBranches,
  storeCashMovements,
  storeCoupons,
  storeCustomers,
  storeGiftCards,
  storeInventoryTransactions,
  storeProductKits,
  storeProducts,
  storePurchaseReturnItems,
  storePurchaseReturns,
  storeSaleLines,
  storeSaleReturnLines,
  storeSaleReturns,
  storeSales,
  storeShifts,
  storeStockAdjustmentItems,
  storeStockAdjustments,
  storeSuppliers,
} from "@platform/database-pg";
import type { PlatformPgDb } from "@platform/database-pg";
import { DRIZZLE } from "../drizzle/drizzle.tokens";

@Injectable()
export class StoreGroceryService {
  private seqCounters = new Map<string, number>();

  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  private nextSeq(branchId: string, prefix: string): string {
    const key = `${branchId}:${prefix}`;
    const n = (this.seqCounters.get(key) ?? 0) + 1;
    this.seqCounters.set(key, n);
    return `${prefix}-${new Date().getFullYear()}-${String(n).padStart(4, "0")}`;
  }

  private async resolveBranch(organizationId: string, branchCode: string) {
    const [branch] = await this.db
      .select()
      .from(popsBranches)
      .where(and(eq(popsBranches.organizationId, organizationId), eq(popsBranches.code, branchCode.trim())))
      .limit(1);
    if (!branch) throw new NotFoundException(`Branch not found: ${branchCode}`);
    return branch;
  }

  async lookupProduct(organizationId: string, branchCode: string, query: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const q = query.trim();
    const [product] = await this.db
      .select()
      .from(storeProducts)
      .where(
        and(
          eq(storeProducts.organizationId, organizationId),
          eq(storeProducts.branchId, branch.id),
          sql`(${storeProducts.barcode} = ${q} OR ${storeProducts.sku} = ${q} OR lower(${storeProducts.name}) LIKE ${`%${q.toLowerCase()}%`})`,
        ),
      )
      .limit(1);
    if (!product) throw new NotFoundException("Product not found");
    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      barcode: product.barcode,
      sellingPrice: product.sellingPricePkr,
      isWeighed: product.isWeighed === "yes",
      availableStock: product.availableStock,
      priceLabel: product.isWeighed === "yes" ? `${product.sellingPricePkr} / kg` : `${product.sellingPricePkr}`,
    };
  }

  async recordCashMovement(organizationId: string, input: CreateStoreCashMovement) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(storeCashMovements)
      .values({
        organizationId,
        branchId: branch.id,
        shiftId: input.shiftId,
        type: input.type,
        amountPkr: input.amountPkr,
        reason: input.reason,
        recordedBy: input.recordedBy ?? null,
      })
      .returning();
    return {
      id: row!.id,
      shiftId: row!.shiftId,
      type: row!.type as "paid_in" | "paid_out",
      amountPkr: row!.amountPkr,
      reason: row!.reason,
      recordedBy: row!.recordedBy,
      createdAt: row!.createdAt.toISOString(),
    };
  }

  async listCashMovements(organizationId: string, shiftId: string) {
    const rows = await this.db
      .select()
      .from(storeCashMovements)
      .where(and(eq(storeCashMovements.organizationId, organizationId), eq(storeCashMovements.shiftId, shiftId)))
      .orderBy(desc(storeCashMovements.createdAt));
    return rows.map((r) => ({
      id: r.id,
      shiftId: r.shiftId,
      type: r.type as "paid_in" | "paid_out",
      amountPkr: r.amountPkr,
      reason: r.reason,
      recordedBy: r.recordedBy,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async computeShiftCashAdjustments(shiftId: string): Promise<number> {
    const rows = await this.db.select().from(storeCashMovements).where(eq(storeCashMovements.shiftId, shiftId));
    return rows.reduce((s, r) => s + (r.type === "paid_in" ? r.amountPkr : -r.amountPkr), 0);
  }

  async listCoupons(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(storeCoupons)
      .where(and(eq(storeCoupons.organizationId, organizationId), eq(storeCoupons.branchId, branch.id)))
      .orderBy(desc(storeCoupons.createdAt));
    return rows.map((r) => this.mapCoupon(r));
  }

  private mapCoupon(r: typeof storeCoupons.$inferSelect) {
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      type: r.type as "percent" | "fixed",
      value: r.value,
      minPurchasePkr: r.minPurchasePkr,
      isActive: r.isActive === "yes",
      startsAt: r.startsAt?.toISOString() ?? null,
      endsAt: r.endsAt?.toISOString() ?? null,
      usageCount: r.usageCount,
      maxUses: r.maxUses,
    };
  }

  async createCoupon(organizationId: string, input: CreateStoreCoupon) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(storeCoupons)
      .values({
        organizationId,
        branchId: branch.id,
        code: input.code.toUpperCase(),
        name: input.name,
        type: input.type,
        value: input.value,
        minPurchasePkr: input.minPurchasePkr ?? 0,
        maxUses: input.maxUses ?? null,
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
      })
      .returning();
    return this.mapCoupon(row!);
  }

  async validateCoupon(organizationId: string, branchCode: string, code: string, cartTotal: number) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const [coupon] = await this.db
      .select()
      .from(storeCoupons)
      .where(
        and(
          eq(storeCoupons.organizationId, organizationId),
          eq(storeCoupons.branchId, branch.id),
          eq(storeCoupons.code, code.toUpperCase()),
          eq(storeCoupons.isActive, "yes"),
        ),
      )
      .limit(1);
    if (!coupon) throw new BadRequestException("Invalid coupon code");
    const now = new Date();
    if (coupon.startsAt && coupon.startsAt > now) throw new BadRequestException("Coupon not yet active");
    if (coupon.endsAt && coupon.endsAt < now) throw new BadRequestException("Coupon expired");
    if (coupon.maxUses != null && coupon.usageCount >= coupon.maxUses) throw new BadRequestException("Coupon usage limit reached");
    if (cartTotal < coupon.minPurchasePkr) throw new BadRequestException(`Minimum purchase Rs ${coupon.minPurchasePkr} required`);
    const discount =
      coupon.type === "percent" ? Math.round((cartTotal * coupon.value) / 100) : Math.min(coupon.value, cartTotal);
    return { code: coupon.code, name: coupon.name, discount };
  }

  async applyCouponUsage(organizationId: string, code: string): Promise<void> {
    const [coupon] = await this.db
      .select()
      .from(storeCoupons)
      .where(and(eq(storeCoupons.organizationId, organizationId), eq(storeCoupons.code, code.toUpperCase())))
      .limit(1);
    if (coupon) {
      await this.db.update(storeCoupons).set({ usageCount: coupon.usageCount + 1 }).where(eq(storeCoupons.id, coupon.id));
    }
  }

  async listGiftCards(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(storeGiftCards)
      .where(and(eq(storeGiftCards.organizationId, organizationId), eq(storeGiftCards.branchId, branch.id)))
      .orderBy(desc(storeGiftCards.createdAt));
    return rows.map((r) => ({
      id: r.id,
      cardNumber: r.cardNumber,
      initialBalancePkr: r.initialBalancePkr,
      balancePkr: r.balancePkr,
      status: r.status as "active" | "depleted" | "void",
      issuedTo: r.issuedTo,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async createGiftCard(organizationId: string, input: CreateStoreGiftCard) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(storeGiftCards)
      .values({
        organizationId,
        branchId: branch.id,
        cardNumber: input.cardNumber,
        initialBalancePkr: input.initialBalancePkr,
        balancePkr: input.initialBalancePkr,
        issuedTo: input.issuedTo ?? null,
      })
      .returning();
    return {
      id: row!.id,
      cardNumber: row!.cardNumber,
      initialBalancePkr: row!.initialBalancePkr,
      balancePkr: row!.balancePkr,
      status: "active" as const,
      issuedTo: row!.issuedTo,
      createdAt: row!.createdAt.toISOString(),
    };
  }

  async validateGiftCard(organizationId: string, branchCode: string, cardNumber: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const [card] = await this.db
      .select()
      .from(storeGiftCards)
      .where(
        and(
          eq(storeGiftCards.organizationId, organizationId),
          eq(storeGiftCards.branchId, branch.id),
          eq(storeGiftCards.cardNumber, cardNumber),
          eq(storeGiftCards.status, "active"),
        ),
      )
      .limit(1);
    if (!card || card.balancePkr <= 0) throw new BadRequestException("Invalid or depleted gift card");
    return { cardNumber: card.cardNumber, balancePkr: card.balancePkr };
  }

  async redeemGiftCard(organizationId: string, cardNumber: string, amount: number): Promise<void> {
    const [card] = await this.db
      .select()
      .from(storeGiftCards)
      .where(and(eq(storeGiftCards.organizationId, organizationId), eq(storeGiftCards.cardNumber, cardNumber)))
      .limit(1);
    if (!card) return;
    const newBalance = Math.max(0, card.balancePkr - amount);
    await this.db
      .update(storeGiftCards)
      .set({ balancePkr: newBalance, status: newBalance === 0 ? "depleted" : "active" })
      .where(eq(storeGiftCards.id, card.id));
  }

  async createSaleReturn(organizationId: string, input: CreateStoreSaleReturn) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [sale] = await this.db
      .select()
      .from(storeSales)
      .where(and(eq(storeSales.id, input.saleId), eq(storeSales.organizationId, organizationId)))
      .limit(1);
    if (!sale) throw new NotFoundException("Sale not found");
    if (sale.status !== "Completed") throw new BadRequestException("Only completed sales can be returned");

    const saleLines = await this.db.select().from(storeSaleLines).where(eq(storeSaleLines.saleId, sale.id));
    const products = await this.db.select().from(storeProducts).where(eq(storeProducts.branchId, branch.id));
    let totalRefund = 0;
    const lineDetails: { productId: string; qty: number; refundAmount: number }[] = [];

    for (const line of input.lines) {
      const saleLine = saleLines.find((l) => l.productId === line.productId);
      if (!saleLine) throw new BadRequestException(`Product not in original sale`);
      if (line.qty > saleLine.qty) throw new BadRequestException("Return qty exceeds sold qty");
      const refundAmount = Math.round((saleLine.lineTotalPkr / saleLine.qty) * line.qty);
      totalRefund += refundAmount;
      lineDetails.push({ productId: line.productId, qty: line.qty, refundAmount });

      const product = products.find((p) => p.id === line.productId);
      if (product) {
        await this.db
          .update(storeProducts)
          .set({ availableStock: product.availableStock + line.qty })
          .where(eq(storeProducts.id, line.productId));
        await this.db.insert(storeInventoryTransactions).values({
          organizationId,
          branchId: branch.id,
          productId: line.productId,
          type: "sale_return",
          qty: line.qty,
          reference: sale.invoiceNumber,
        });
      }
    }

    const returnNumber = this.nextSeq(branch.id, "RET");
    const [ret] = await this.db
      .insert(storeSaleReturns)
      .values({
        organizationId,
        branchId: branch.id,
        returnNumber,
        saleId: sale.id,
        reason: input.reason,
        refundMethod: input.refundMethod,
        totalRefundPkr: totalRefund,
      })
      .returning();

    for (const ld of lineDetails) {
      await this.db.insert(storeSaleReturnLines).values({
        returnId: ret!.id,
        productId: ld.productId,
        qty: ld.qty,
        refundAmountPkr: ld.refundAmount,
      });
    }

    return this.getSaleReturn(organizationId, ret!.id);
  }

  async listSaleReturns(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(storeSaleReturns)
      .where(and(eq(storeSaleReturns.organizationId, organizationId), eq(storeSaleReturns.branchId, branch.id)))
      .orderBy(desc(storeSaleReturns.createdAt))
      .limit(50);
    return Promise.all(rows.map((r) => this.getSaleReturn(organizationId, r.id)));
  }

  private async getSaleReturn(organizationId: string, returnId: string) {
    const [ret] = await this.db
      .select()
      .from(storeSaleReturns)
      .where(and(eq(storeSaleReturns.id, returnId), eq(storeSaleReturns.organizationId, organizationId)))
      .limit(1);
    if (!ret) throw new NotFoundException("Return not found");
    const [sale] = await this.db.select().from(storeSales).where(eq(storeSales.id, ret.saleId)).limit(1);
    const lines = await this.db.select().from(storeSaleReturnLines).where(eq(storeSaleReturnLines.returnId, returnId));
    const products = await this.db.select().from(storeProducts).where(eq(storeProducts.branchId, ret.branchId));
    return {
      id: ret.id,
      returnNumber: ret.returnNumber,
      saleId: ret.saleId,
      invoiceNumber: sale?.invoiceNumber ?? "—",
      reason: ret.reason,
      refundMethod: ret.refundMethod as "Cash" | "Card" | "Bank Transfer" | "Mobile Wallet" | "Credit",
      totalRefund: ret.totalRefundPkr,
      lines: lines.map((l) => {
        const p = products.find((x) => x.id === l.productId);
        return { productId: l.productId, productName: p?.name ?? "Unknown", qty: l.qty, refundAmount: l.refundAmountPkr };
      }),
      createdAt: ret.createdAt.toISOString(),
    };
  }

  async createPurchaseReturn(organizationId: string, input: CreateStorePurchaseReturn) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const returnNumber = this.nextSeq(branch.id, "PRN");
    let total = 0;
    for (const item of input.items) total += item.qty * item.unitPrice;

    const [ret] = await this.db
      .insert(storePurchaseReturns)
      .values({
        organizationId,
        branchId: branch.id,
        returnNumber,
        supplierId: input.supplierId,
        reason: input.reason,
        totalAmountPkr: total,
      })
      .returning();

    for (const item of input.items) {
      await this.db.insert(storePurchaseReturnItems).values({
        returnId: ret!.id,
        productId: item.productId,
        qty: item.qty,
        unitPricePkr: item.unitPrice,
      });
      const [product] = await this.db.select().from(storeProducts).where(eq(storeProducts.id, item.productId)).limit(1);
      if (product) {
        await this.db
          .update(storeProducts)
          .set({ availableStock: Math.max(0, product.availableStock - item.qty) })
          .where(eq(storeProducts.id, item.productId));
      }
    }

    return this.listPurchaseReturns(organizationId, input.branchCode).then((list) => list.find((r) => r.id === ret!.id)!);
  }

  async listPurchaseReturns(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(storePurchaseReturns)
      .where(and(eq(storePurchaseReturns.organizationId, organizationId), eq(storePurchaseReturns.branchId, branch.id)))
      .orderBy(desc(storePurchaseReturns.createdAt));
    const suppliers = await this.db.select().from(storeSuppliers).where(eq(storeSuppliers.branchId, branch.id));
    return rows.map((r) => ({
      id: r.id,
      returnNumber: r.returnNumber,
      supplierId: r.supplierId,
      supplierName: suppliers.find((s) => s.id === r.supplierId)?.name ?? null,
      reason: r.reason,
      totalAmount: r.totalAmountPkr,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async getCustomerDetail(organizationId: string, customerId: string) {
    const [customer] = await this.db
      .select()
      .from(storeCustomers)
      .where(and(eq(storeCustomers.id, customerId), eq(storeCustomers.organizationId, organizationId)))
      .limit(1);
    if (!customer) throw new NotFoundException("Customer not found");

    const sales = await this.db
      .select()
      .from(storeSales)
      .where(and(eq(storeSales.customerId, customerId), eq(storeSales.status, "Completed")))
      .orderBy(desc(storeSales.createdAt))
      .limit(20);

    const recentSales = await Promise.all(
      sales.map(async (s) => {
        const lines = await this.db.select().from(storeSaleLines).where(eq(storeSaleLines.saleId, s.id));
        return {
          id: s.id,
          invoiceNumber: s.invoiceNumber,
          total: s.totalPkr,
          createdAt: s.createdAt.toISOString(),
          lineCount: lines.length,
        };
      }),
    );

    const totalPurchases = sales.reduce((s, x) => s + x.totalPkr, 0);

    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      membershipTier: (customer.membershipTier ?? "standard") as "standard" | "silver" | "gold" | "vip",
      loyaltyPoints: customer.loyaltyPoints,
      creditLimitPkr: customer.creditLimitPkr,
      outstandingPkr: customer.outstandingPkr,
      totalPurchases,
      recentSales,
    };
  }

  async updateCustomerTier(organizationId: string, customerId: string, tier: string) {
    await this.db
      .update(storeCustomers)
      .set({ membershipTier: tier })
      .where(and(eq(storeCustomers.id, customerId), eq(storeCustomers.organizationId, organizationId)));
    return this.getCustomerDetail(organizationId, customerId);
  }

  loyaltyPointsForCustomer(totalPkr: number, tier: string): number {
    const mult = LOYALTY_TIER_MULTIPLIERS[tier as keyof typeof LOYALTY_TIER_MULTIPLIERS] ?? 1;
    return Math.floor((totalPkr / 100) * mult);
  }

  async getPeakHoursReport(organizationId: string, branchCode: string, fromIso?: string, toIso?: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const from = fromIso ? new Date(fromIso) : new Date(Date.now() - 7 * 86400000);
    const to = toIso ? new Date(toIso) : new Date();

    const sales = await this.db
      .select()
      .from(storeSales)
      .where(
        and(
          eq(storeSales.organizationId, organizationId),
          eq(storeSales.branchId, branch.id),
          eq(storeSales.status, "Completed"),
          gte(storeSales.createdAt, from),
          lte(storeSales.createdAt, to),
        ),
      );

    const hourly = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      label: `${String(hour).padStart(2, "0")}:00`,
      amount: 0,
      transactions: 0,
    }));

    for (const s of sales) {
      const h = s.createdAt.getHours();
      hourly[h]!.amount += s.totalPkr;
      hourly[h]!.transactions += 1;
    }

    const sorted = [...hourly].sort((a, b) => b.amount - a.amount);
    return {
      periodLabel: `${from.toISOString().slice(0, 10)} — ${to.toISOString().slice(0, 10)}`,
      hourlySales: hourly,
      peakHours: sorted.slice(0, 3).filter((h) => h.amount > 0),
      slowHours: sorted.slice(-3).reverse().filter((h) => h.amount >= 0),
    };
  }

  async getEmployeeReport(organizationId: string, branchCode: string, fromIso?: string, toIso?: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const from = fromIso ? new Date(fromIso) : new Date(Date.now() - 30 * 86400000);
    const to = toIso ? new Date(toIso) : new Date();

    const shifts = await this.db
      .select()
      .from(storeShifts)
      .where(
        and(
          eq(storeShifts.organizationId, organizationId),
          eq(storeShifts.branchId, branch.id),
          gte(storeShifts.openedAt, from),
          lte(storeShifts.openedAt, to),
        ),
      );

    const map = new Map<string, { shiftCount: number; totalSalesPkr: number; transactionCount: number }>();
    for (const sh of shifts) {
      const cur = map.get(sh.cashierName) ?? { shiftCount: 0, totalSalesPkr: 0, transactionCount: 0 };
      cur.shiftCount += 1;
      cur.totalSalesPkr += sh.totalSalesPkr;
      cur.transactionCount += sh.transactionCount;
      map.set(sh.cashierName, cur);
    }

    return {
      periodLabel: `${from.toISOString().slice(0, 10)} — ${to.toISOString().slice(0, 10)}`,
      cashiers: [...map.entries()].map(([cashierName, stats]) => ({
        cashierName,
        shiftCount: stats.shiftCount,
        totalSalesPkr: stats.totalSalesPkr,
        transactionCount: stats.transactionCount,
        avgTicketPkr: stats.transactionCount > 0 ? Math.round(stats.totalSalesPkr / stats.transactionCount) : 0,
      })),
    };
  }

  async getWastageReport(organizationId: string, branchCode: string, fromIso?: string, toIso?: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const from = fromIso ? new Date(fromIso) : new Date(Date.now() - 30 * 86400000);
    const to = toIso ? new Date(toIso) : new Date();

    const adjustments = await this.db
      .select()
      .from(storeStockAdjustments)
      .where(
        and(
          eq(storeStockAdjustments.organizationId, organizationId),
          eq(storeStockAdjustments.branchId, branch.id),
          gte(storeStockAdjustments.createdAt, from),
          lte(storeStockAdjustments.createdAt, to),
        ),
      );

    const products = await this.db.select().from(storeProducts).where(eq(storeProducts.branchId, branch.id));
    const items: { reason: string; productName: string; sku: string; qty: number; valuePkr: number; createdAt: string }[] = [];

    for (const adj of adjustments) {
      const adjItems = await this.db.select().from(storeStockAdjustmentItems).where(eq(storeStockAdjustmentItems.adjustmentId, adj.id));
      for (const item of adjItems) {
        if (item.qtyChange >= 0) continue;
        const prod = products.find((p) => p.id === item.productId);
        const qty = Math.abs(item.qtyChange);
        items.push({
          reason: adj.reason,
          productName: prod?.name ?? "Unknown",
          sku: prod?.sku ?? "—",
          qty,
          valuePkr: qty * (prod?.purchasePricePkr ?? 0),
          createdAt: adj.createdAt.toISOString(),
        });
      }
    }

    return {
      periodLabel: `${from.toISOString().slice(0, 10)} — ${to.toISOString().slice(0, 10)}`,
      items,
      totalValuePkr: items.reduce((s, i) => s + i.valuePkr, 0),
    };
  }

  async listProductKits(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(storeProductKits)
      .where(and(eq(storeProductKits.organizationId, organizationId), eq(storeProductKits.branchId, branch.id)));
    const products = await this.db.select().from(storeProducts).where(eq(storeProducts.branchId, branch.id));
    return rows.map((r) => ({
      id: r.id,
      kitProductId: r.kitProductId,
      kitProductName: products.find((p) => p.id === r.kitProductId)?.name ?? "—",
      componentProductId: r.componentProductId,
      componentName: products.find((p) => p.id === r.componentProductId)?.name ?? "—",
      qty: r.qty,
    }));
  }
}
