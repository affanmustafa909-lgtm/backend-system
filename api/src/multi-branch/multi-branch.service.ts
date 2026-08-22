import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import type {
  CopyBranchPricing,
  CreateBranchTransfer,
  ManualBranchReceive,
  SetBranchPriceOverride,
  UpdateBranchTransfer,
} from "@platform/contracts";
import {
  popsBranchPriceOverrides,
  popsBranchTransfers,
  popsBranches,
  popsEmployees,
  popsIngredients,
  popsMenuCategories,
  popsMenuItems,
  type PlatformPgDb,
} from "@platform/database-pg";
import { BillingService } from "../billing/billing.service";
import { OperationsService } from "../operations/operations.service";
import { DRIZZLE } from "../drizzle/drizzle.tokens";

@Injectable()
export class MultiBranchService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly operations: OperationsService,
    private readonly billing: BillingService,
  ) {}

  async getOverview(organizationId: string) {
    const branches = await this.operations.listBranches(organizationId);

    const pendingRows = await this.db
      .select({ id: popsBranchTransfers.id })
      .from(popsBranchTransfers)
      .where(
        and(
          eq(popsBranchTransfers.organizationId, organizationId),
          sql`${popsBranchTransfers.status} IN ('pending', 'dispatched')`,
        ),
      );

    const branchRows = await Promise.all(
      branches.map(async (b) => {
        const dash = await this.operations.getDashboard(organizationId, b.code);
        const invAlerts = dash.metrics.lowStock.skuCount;
        const activeOrders = dash.metrics.activeOrders.total;
        const syncStatus: "live" | "idle" =
          activeOrders > 0 || dash.metrics.liveSales.amountPkr > 0 ? "live" : "idle";

        return {
          branchId: b.id,
          branchCode: b.code,
          branchName: b.name,
          city: b.city,
          salesTodayPkr: dash.metrics.liveSales.amountPkr,
          salesChangePct: dash.metrics.liveSales.changePercent,
          activeOrders,
          kitchenQueue: dash.metrics.kitchenQueue.total,
          inventoryAlerts: invAlerts,
          syncStatus,
          syncLabel: syncStatus === "live" ? "Live" : "Idle",
        };
      }),
    );

    return {
      consolidated: {
        branchCount: branchRows.length,
        salesTodayPkr: branchRows.reduce((s, b) => s + b.salesTodayPkr, 0),
        activeOrders: branchRows.reduce((s, b) => s + b.activeOrders, 0),
        inventoryAlerts: branchRows.reduce((s, b) => s + b.inventoryAlerts, 0),
        pendingTransfers: pendingRows.length,
      },
      branches: branchRows,
    };
  }

  async getConsolidatedReport(organizationId: string) {
    const branches = await this.operations.listBranches(organizationId);
    const now = new Date();
    const periodLabel = now.toLocaleString("en-PK", { month: "long", year: "numeric" });

    const rows = await Promise.all(
      branches.map(async (b) => {
        const { orders } = await this.billing.listOrders(organizationId, b.code);
        const completed = orders.filter(
          (o) => o.status === "completed" && !o.billRef.endsWith("-SEED"),
        );
        const salesPkr = completed.reduce((s, o) => s + o.total, 0);

        const staffRows = await this.db
          .select({ id: popsEmployees.id })
          .from(popsEmployees)
          .where(
            and(
              eq(popsEmployees.branchId, b.id),
              eq(popsEmployees.employmentStatus, "active"),
            ),
          );

        return {
          branchCode: b.code,
          branchName: b.name,
          salesPkr,
          orderCount: completed.length,
          avgTicketPkr:
            completed.length > 0 ? Math.round(salesPkr / completed.length) : 0,
          activeStaff: staffRows.length,
        };
      }),
    );

    return {
      periodLabel,
      branches: rows,
      totals: {
        salesPkr: rows.reduce((s, r) => s + r.salesPkr, 0),
        orderCount: rows.reduce((s, r) => s + r.orderCount, 0),
      },
    };
  }

  async listTransfers(organizationId: string) {
    const rows = await this.db
      .select({
        transfer: popsBranchTransfers,
        from: popsBranches,
      })
      .from(popsBranchTransfers)
      .innerJoin(popsBranches, eq(popsBranches.id, popsBranchTransfers.fromBranchId))
      .where(eq(popsBranchTransfers.organizationId, organizationId))
      .orderBy(desc(popsBranchTransfers.createdAt));

    const result = await Promise.all(
      rows.map(async ({ transfer, from }) => {
        const toRows = await this.db
          .select()
          .from(popsBranches)
          .where(eq(popsBranches.id, transfer.toBranchId))
          .limit(1);
        const to = toRows[0]!;
        return this.mapTransfer(transfer, from, to);
      }),
    );

    return { transfers: result };
  }

  async createTransfer(organizationId: string, userEmail: string, input: CreateBranchTransfer) {
    const from = await this.resolveBranch(organizationId, input.fromBranchCode);
    const to = await this.resolveBranch(organizationId, input.toBranchCode);
    if (from.id === to.id) {
      throw new BadRequestException("Source and destination branch must differ");
    }

    const ingRows = await this.db
      .select()
      .from(popsIngredients)
      .where(
        and(eq(popsIngredients.id, input.ingredientId), eq(popsIngredients.branchId, from.id)),
      )
      .limit(1);
    const ingredient = ingRows[0];
    if (!ingredient) throw new NotFoundException("Ingredient not found at source branch");

    const transferRef = `TRF-${Date.now().toString(36).toUpperCase().slice(-6)}`;
    const [row] = await this.db
      .insert(popsBranchTransfers)
      .values({
        organizationId,
        fromBranchId: from.id,
        toBranchId: to.id,
        transferRef,
        ingredientId: ingredient.id,
        ingredientSku: ingredient.sku,
        ingredientName: ingredient.name,
        qty: input.qty,
        unit: ingredient.unit,
        notes: input.notes?.trim() || null,
        createdBy: userEmail,
      })
      .returning();

    if (!row) throw new BadRequestException("Failed to create transfer");
    return this.mapTransfer(row, from, to);
  }

  async createManualReceive(
    organizationId: string,
    userEmail: string,
    input: ManualBranchReceive,
  ) {
    const from = await this.resolveBranch(organizationId, input.fromBranchCode);
    const to = await this.resolveBranch(organizationId, input.toBranchCode);
    if (from.id === to.id) {
      throw new BadRequestException("Source and destination branch must differ");
    }

    let ingredientName = input.ingredientName.trim();
    let ingredientSku = input.ingredientSku.trim();
    let unit = input.unit.trim();
    let ingredientId: string;

    if (input.ingredientId) {
      const ingRows = await this.db
        .select()
        .from(popsIngredients)
        .where(
          and(eq(popsIngredients.id, input.ingredientId), eq(popsIngredients.branchId, to.id)),
        )
        .limit(1);
      const ing = ingRows[0];
      if (!ing) {
        throw new NotFoundException("Ingredient not found at receiving branch");
      }
      ingredientId = ing.id;
      ingredientName = ing.name;
      ingredientSku = ing.sku;
      unit = ing.unit;
    } else {
      const existing = await this.db
        .select()
        .from(popsIngredients)
        .where(
          and(eq(popsIngredients.branchId, to.id), eq(popsIngredients.sku, ingredientSku)),
        )
        .limit(1);
      if (existing[0]) {
        ingredientId = existing[0].id;
        ingredientName = existing[0].name;
        unit = existing[0].unit;
      } else {
        const [created] = await this.db
          .insert(popsIngredients)
          .values({
            organizationId,
            branchId: to.id,
            sku: ingredientSku,
            name: ingredientName,
            unit,
            currentStock: 0,
            minStock: 0,
            reorderLevel: 0,
            maxStock: 0,
            unitCostPkr: 0,
          })
          .returning();
        if (!created) throw new BadRequestException("Failed to create ingredient");
        ingredientId = created.id;
      }
    }

    const now = new Date();
    const transferRef = `RCV-${Date.now().toString(36).toUpperCase().slice(-6)}`;
    const [row] = await this.db
      .insert(popsBranchTransfers)
      .values({
        organizationId,
        fromBranchId: from.id,
        toBranchId: to.id,
        transferRef,
        ingredientId,
        ingredientSku,
        ingredientName,
        qty: input.qty,
        unit,
        status: "received",
        notes: input.notes?.trim() || null,
        createdBy: userEmail,
        dispatchedAt: now,
        receivedAt: now,
      })
      .returning();

    if (!row) throw new BadRequestException("Failed to record receive");

    await this.addStockAtBranch(
      organizationId,
      to.id,
      ingredientSku,
      ingredientName,
      unit,
      input.qty,
    );

    return this.mapTransfer(row, from, to);
  }

  async updateTransfer(
    organizationId: string,
    transferId: string,
    input: UpdateBranchTransfer,
  ) {
    const rows = await this.db
      .select()
      .from(popsBranchTransfers)
      .where(eq(popsBranchTransfers.id, transferId))
      .limit(1);
    const transfer = rows[0];
    if (!transfer || transfer.organizationId !== organizationId) {
      throw new NotFoundException("Transfer not found");
    }

    if (input.status === "dispatched") {
      if (transfer.status !== "pending") {
        throw new BadRequestException("Only pending transfers can be dispatched");
      }
      const ingRows = await this.db
        .select()
        .from(popsIngredients)
        .where(eq(popsIngredients.id, transfer.ingredientId))
        .limit(1);
      const ing = ingRows[0];
      if (!ing || ing.currentStock < transfer.qty) {
        throw new BadRequestException("Insufficient stock at source branch");
      }
      await this.db
        .update(popsIngredients)
        .set({ currentStock: ing.currentStock - transfer.qty })
        .where(eq(popsIngredients.id, ing.id));
    }

    if (input.status === "received") {
      if (transfer.status !== "dispatched") {
        throw new BadRequestException("Transfer must be dispatched before receiving");
      }
      await this.addStockAtBranch(
        organizationId,
        transfer.toBranchId,
        transfer.ingredientSku,
        transfer.ingredientName,
        transfer.unit,
        transfer.qty,
      );
    }

    if (input.status === "cancelled" && transfer.status === "dispatched") {
      await this.addStockAtBranch(
        organizationId,
        transfer.fromBranchId,
        transfer.ingredientSku,
        transfer.ingredientName,
        transfer.unit,
        transfer.qty,
      );
    }

    const [updated] = await this.db
      .update(popsBranchTransfers)
      .set({
        status: input.status,
        ...(input.status === "dispatched" ? { dispatchedAt: new Date() } : {}),
        ...(input.status === "received" ? { receivedAt: new Date() } : {}),
      })
      .where(eq(popsBranchTransfers.id, transferId))
      .returning();

    if (!updated) throw new NotFoundException("Transfer not found");

    const from = await this.getBranchById(updated.fromBranchId);
    const to = await this.getBranchById(updated.toBranchId);
    return this.mapTransfer(updated, from, to);
  }

  async listPricing(organizationId: string, branchCode?: string) {
    const branches = branchCode
      ? [await this.resolveBranch(organizationId, branchCode)]
      : await this.db
          .select()
          .from(popsBranches)
          .where(eq(popsBranches.organizationId, organizationId));

    const overrideRows = await this.db
      .select()
      .from(popsBranchPriceOverrides)
      .where(eq(popsBranchPriceOverrides.organizationId, organizationId));
    const overrideMap = new Map(
      overrideRows.map((o) => [`${o.branchId}:${o.menuItemId}`, o.pricePkr]),
    );

    const pricing: Array<{
      menuItemId: string;
      itemName: string;
      categoryName: string;
      branchCode: string;
      branchName: string;
      basePricePkr: number;
      overridePricePkr: number | null;
      effectivePricePkr: number;
    }> = [];

    for (const branch of branches) {
      const items = await this.db
        .select({
          item: popsMenuItems,
          category: popsMenuCategories,
        })
        .from(popsMenuItems)
        .innerJoin(popsMenuCategories, eq(popsMenuCategories.id, popsMenuItems.categoryId))
        .where(and(eq(popsMenuItems.branchId, branch.id), eq(popsMenuItems.isActive, true)));

      for (const { item, category } of items) {
        const override = overrideMap.get(`${branch.id}:${item.id}`) ?? null;
        pricing.push({
          menuItemId: item.id,
          itemName: item.name,
          categoryName: category.name,
          branchCode: branch.code,
          branchName: branch.name,
          basePricePkr: item.pricePkr,
          overridePricePkr: override,
          effectivePricePkr: override ?? item.pricePkr,
        });
      }
    }

    return { rows: pricing };
  }

  async setPriceOverride(
    organizationId: string,
    userEmail: string,
    input: SetBranchPriceOverride,
  ) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const itemRows = await this.db
      .select()
      .from(popsMenuItems)
      .where(and(eq(popsMenuItems.id, input.menuItemId), eq(popsMenuItems.branchId, branch.id)))
      .limit(1);
    if (!itemRows[0]) throw new NotFoundException("Menu item not found at branch");

    const existing = await this.db
      .select()
      .from(popsBranchPriceOverrides)
      .where(
        and(
          eq(popsBranchPriceOverrides.branchId, branch.id),
          eq(popsBranchPriceOverrides.menuItemId, input.menuItemId),
        ),
      )
      .limit(1);

    if (existing[0]) {
      await this.db
        .update(popsBranchPriceOverrides)
        .set({
          pricePkr: input.pricePkr,
          notes: input.notes?.trim() || null,
          updatedBy: userEmail,
          updatedAt: new Date(),
        })
        .where(eq(popsBranchPriceOverrides.id, existing[0].id));
    } else {
      await this.db.insert(popsBranchPriceOverrides).values({
        organizationId,
        branchId: branch.id,
        menuItemId: input.menuItemId,
        pricePkr: input.pricePkr,
        notes: input.notes?.trim() || null,
        updatedBy: userEmail,
      });
    }

    await this.db
      .update(popsMenuItems)
      .set({ pricePkr: input.pricePkr })
      .where(eq(popsMenuItems.id, input.menuItemId));

    return this.listPricing(organizationId, branch.code);
  }

  async copyPricing(organizationId: string, userEmail: string, input: CopyBranchPricing) {
    const from = await this.resolveBranch(organizationId, input.fromBranchCode);
    const to = await this.resolveBranch(organizationId, input.toBranchCode);

    const sourceItems = await this.db
      .select()
      .from(popsMenuItems)
      .where(and(eq(popsMenuItems.branchId, from.id), eq(popsMenuItems.isActive, true)));

    const destItems = await this.db
      .select()
      .from(popsMenuItems)
      .where(and(eq(popsMenuItems.branchId, to.id), eq(popsMenuItems.isActive, true)));

    let copied = 0;
    for (const src of sourceItems) {
      const dest = destItems.find(
        (d) => d.name.toLowerCase() === src.name.toLowerCase() && d.portion === src.portion,
      );
      if (!dest) continue;

      await this.setPriceOverride(organizationId, userEmail, {
        branchCode: to.code,
        menuItemId: dest.id,
        pricePkr: src.pricePkr,
      });
      copied++;
    }

    return { copied, fromBranch: from.code, toBranch: to.code };
  }

  async listTransferIngredients(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select({
        id: popsIngredients.id,
        sku: popsIngredients.sku,
        name: popsIngredients.name,
        unit: popsIngredients.unit,
        currentStock: popsIngredients.currentStock,
      })
      .from(popsIngredients)
      .where(eq(popsIngredients.branchId, branch.id))
      .orderBy(popsIngredients.name);

    return { branchCode: branch.code, ingredients: rows };
  }

  private async addStockAtBranch(
    organizationId: string,
    branchId: string,
    sku: string,
    name: string,
    unit: string,
    qty: number,
  ) {
    const rows = await this.db
      .select()
      .from(popsIngredients)
      .where(and(eq(popsIngredients.branchId, branchId), eq(popsIngredients.sku, sku)))
      .limit(1);

    if (rows[0]) {
      await this.db
        .update(popsIngredients)
        .set({ currentStock: rows[0].currentStock + qty })
        .where(eq(popsIngredients.id, rows[0].id));
      return;
    }

    await this.db.insert(popsIngredients).values({
      organizationId,
      branchId,
      sku,
      name,
      unit,
      currentStock: qty,
      minStock: 0,
      reorderLevel: 0,
      maxStock: 0,
      unitCostPkr: 0,
    });
  }

  private mapTransfer(
    transfer: typeof popsBranchTransfers.$inferSelect,
    from: typeof popsBranches.$inferSelect,
    to: typeof popsBranches.$inferSelect,
  ) {
    return {
      id: transfer.id,
      transferRef: transfer.transferRef,
      fromBranchCode: from.code,
      fromBranchName: from.name,
      toBranchCode: to.code,
      toBranchName: to.name,
      ingredientSku: transfer.ingredientSku,
      ingredientName: transfer.ingredientName,
      qty: transfer.qty,
      unit: transfer.unit,
      status: transfer.status as "pending" | "dispatched" | "received" | "cancelled",
      notes: transfer.notes,
      createdBy: transfer.createdBy,
      createdAt: transfer.createdAt.toISOString(),
      dispatchedAt: transfer.dispatchedAt?.toISOString() ?? null,
      receivedAt: transfer.receivedAt?.toISOString() ?? null,
    };
  }

  private async resolveBranch(organizationId: string, branchCode: string) {
    const rows = await this.db
      .select()
      .from(popsBranches)
      .where(
        and(eq(popsBranches.organizationId, organizationId), eq(popsBranches.code, branchCode.trim())),
      )
      .limit(1);
    const branch = rows[0];
    if (!branch) throw new NotFoundException(`Branch not found: ${branchCode}`);
    return branch;
  }

  private async getBranchById(branchId: string) {
    const rows = await this.db
      .select()
      .from(popsBranches)
      .where(eq(popsBranches.id, branchId))
      .limit(1);
    const branch = rows[0];
    if (!branch) throw new NotFoundException("Branch not found");
    return branch;
  }
}
