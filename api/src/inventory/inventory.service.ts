import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import type {
  CompleteStockCount,
  CreateGoodsReceipt,
  CreateIngredient,
  CreateInventoryCategory,
  CreateProductionBatch,
  CreatePurchaseOrder,
  CreateRecipe,
  CreateStockAdjustment,
  CreateStockCount,
  CreateSupplier,
  CreateWasteRecord,
  IngredientUnit,
  UpdateAdjustmentStatus,
  UpdateIngredient,
  UpdateInventoryCategory,
  UpdatePurchaseOrderStatus,
  UpdatePurchaseOrder,
  UpdateRecipe,
  UpdateSupplier,
  UpdateWasteStatus,
} from "@platform/contracts";
import {
  popsBranches,
  popsGoodsReceiptLines,
  popsGoodsReceipts,
  popsIngredients,
  popsInventoryAuditLogs,
  popsInventoryCategories,
  popsMenuItems,
  popsProductionBatchLines,
  popsProductionBatches,
  popsPurchaseOrderLines,
  popsPurchaseOrders,
  popsRecipeLines,
  popsRecipes,
  popsStockAdjustments,
  popsStockBatches,
  popsStockCountLines,
  popsStockCounts,
  popsSuppliers,
  popsWasteRecords,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../drizzle/drizzle.tokens";
import { AccountingHooksService } from "../accounting/accounting-hooks.service";

const DEFAULT_CATEGORIES = [
  { name: "Meat", description: "Poultry, beef, mutton" },
  { name: "Vegetables", description: "Fresh produce" },
  { name: "Dairy", description: "Cheese, milk, butter" },
  { name: "Beverages", description: "Soft drinks, juices" },
  { name: "Sauces", description: "House & packaged sauces" },
  { name: "Bakery", description: "Buns, flour, bread" },
  { name: "Dry Goods", description: "Rice, oil, spices" },
];

const DEFAULT_INGREDIENTS: {
  sku: string;
  name: string;
  category: string;
  unit: IngredientUnit;
  currentStock: number;
  minStock: number;
  reorderLevel: number;
  maxStock: number;
  unitCost: number;
}[] = [
  { sku: "RM-001", name: "Chicken", category: "Meat", unit: "Kg", currentStock: 42, minStock: 30, reorderLevel: 35, maxStock: 100, unitCost: 580 },
  { sku: "RM-002", name: "Basmati Rice", category: "Dry Goods", unit: "Kg", currentStock: 85, minStock: 20, reorderLevel: 30, maxStock: 200, unitCost: 220 },
  { sku: "RM-003", name: "Cooking Oil", category: "Dry Goods", unit: "Liter", currentStock: 8, minStock: 20, reorderLevel: 25, maxStock: 80, unitCost: 450 },
  { sku: "RM-004", name: "Salt", category: "Dry Goods", unit: "Kg", currentStock: 12, minStock: 5, reorderLevel: 8, maxStock: 30, unitCost: 45 },
  { sku: "RM-005", name: "All-Purpose Flour", category: "Bakery", unit: "Kg", currentStock: 25, minStock: 10, reorderLevel: 15, maxStock: 50, unitCost: 95 },
  { sku: "RM-006", name: "Cheddar Cheese", category: "Dairy", unit: "Kg", currentStock: 6, minStock: 8, reorderLevel: 10, maxStock: 25, unitCost: 1800 },
  { sku: "RM-007", name: "Soft Drink (330ml)", category: "Beverages", unit: "Piece", currentStock: 120, minStock: 48, reorderLevel: 60, maxStock: 240, unitCost: 65 },
  { sku: "RM-008", name: "Burger Bun", category: "Bakery", unit: "Piece", currentStock: 0, minStock: 50, reorderLevel: 60, maxStock: 200, unitCost: 25 },
  { sku: "RM-009", name: "House Sauce", category: "Sauces", unit: "Gram", currentStock: 3500, minStock: 2000, reorderLevel: 2500, maxStock: 8000, unitCost: 1 },
  { sku: "RM-010", name: "Potatoes", category: "Vegetables", unit: "Kg", currentStock: 35, minStock: 15, reorderLevel: 20, maxStock: 80, unitCost: 80 },
];

const DEFAULT_SUPPLIERS = [
  { name: "Fresh Poultry Ltd", phone: "051-1234567", email: "orders@freshpoultry.pk", address: "I-9 Industrial, Islamabad", paymentTerms: "Net 15" },
  { name: "Metro Cash & Carry", phone: "042-9876543", email: "b2b@metro.pk", address: "DHA Phase 5, Lahore", paymentTerms: "Net 30" },
  { name: "National Foods", phone: "021-5551234", email: "supply@nationalfoods.com", address: "Port Qasim, Karachi", paymentTerms: "Net 7" },
];

@Injectable()
export class InventoryService implements OnModuleInit {
  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly accountingHooks: AccountingHooksService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.seedAllBranches();
    } catch {
      /* schema may not be ready */
    }
  }

  async seedAllBranches(): Promise<void> {
    const branches = await this.db.select().from(popsBranches);
    for (const branch of branches) {
      await this.seedBranchIfEmpty(branch);
    }
  }

  private async seedBranchIfEmpty(branch: typeof popsBranches.$inferSelect): Promise<void> {
    const existing = await this.db
      .select({ id: popsIngredients.id })
      .from(popsIngredients)
      .where(eq(popsIngredients.branchId, branch.id))
      .limit(1);
    if (existing.length > 0) return;

    const catMap = new Map<string, string>();
    for (const cat of DEFAULT_CATEGORIES) {
      const [row] = await this.db
        .insert(popsInventoryCategories)
        .values({
          organizationId: branch.organizationId,
          branchId: branch.id,
          name: cat.name,
          description: cat.description,
        })
        .returning();
      if (row) catMap.set(cat.name, row.id);
    }

    const ingredientIds = new Map<string, string>();
    for (const ing of DEFAULT_INGREDIENTS) {
      const [row] = await this.db
        .insert(popsIngredients)
        .values({
          organizationId: branch.organizationId,
          branchId: branch.id,
          categoryId: catMap.get(ing.category) ?? null,
          sku: ing.sku,
          name: ing.name,
          unit: ing.unit,
          currentStock: ing.currentStock,
          minStock: ing.minStock,
          reorderLevel: ing.reorderLevel,
          maxStock: ing.maxStock,
          unitCostPkr: ing.unitCost,
        })
        .returning();
      if (row) {
        ingredientIds.set(ing.sku, row.id);
        if (ing.currentStock > 0) {
          await this.db.insert(popsStockBatches).values({
            organizationId: branch.organizationId,
            branchId: branch.id,
            ingredientId: row.id,
            qty: ing.currentStock,
            batchNumber: `B-SEED-${ing.sku}`,
            location: ing.unit === "Kg" && ing.category === "Meat" ? "Cold store" : "Dry store",
            unitCostPkr: ing.unitCost,
          });
        }
      }
    }

    for (const sup of DEFAULT_SUPPLIERS) {
      await this.db.insert(popsSuppliers).values({
        organizationId: branch.organizationId,
        branchId: branch.id,
        name: sup.name,
        phone: sup.phone,
        email: sup.email,
        address: sup.address,
        paymentTerms: sup.paymentTerms,
        onboardedDate: new Date().toISOString().slice(0, 10),
        active: true,
      });
    }

    await this.audit(branch.organizationId, branch.id, "system", "Seed completed", "Inventory", "Default categories, ingredients, suppliers");
  }

  async getDashboard(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    await this.seedBranchIfEmpty(branch);

    const ingredients = await this.db
      .select()
      .from(popsIngredients)
      .where(eq(popsIngredients.branchId, branch.id));

    const batches = await this.db
      .select()
      .from(popsStockBatches)
      .where(eq(popsStockBatches.branchId, branch.id));

    const today = new Date().toISOString().slice(0, 10);
    const monthStart = `${today.slice(0, 7)}-01`;

    const wasteRows = await this.db
      .select()
      .from(popsWasteRecords)
      .where(and(eq(popsWasteRecords.branchId, branch.id), eq(popsWasteRecords.status, "Approved")));

    const wasteTodayFiltered = wasteRows.filter(
      (w) => w.createdAt.toISOString().slice(0, 10) === today,
    );

    const posThisMonth = await this.db
      .select()
      .from(popsPurchaseOrders)
      .where(
        and(
          eq(popsPurchaseOrders.branchId, branch.id),
          gte(popsPurchaseOrders.createdAt, new Date(monthStart)),
        ),
      );

    const inventoryValue = ingredients.reduce((s, i) => s + i.currentStock * i.unitCostPkr, 0);
    const lowStock = ingredients.filter((i) => i.currentStock > 0 && i.currentStock <= i.reorderLevel);
    const outOfStock = ingredients.filter((i) => i.currentStock === 0);
    const now = Date.now();
    const expiring = batches.filter((b) => {
      if (!b.expiryDate) return false;
      const days = (new Date(b.expiryDate).getTime() - now) / 86400000;
      return days >= 0 && days <= 7;
    });

    const alerts: { type: string; message: string; severity: "info" | "warning" | "danger" }[] = [];
    for (const i of lowStock) {
      alerts.push({
        type: "Low Stock",
        message: `${i.name} — ${i.currentStock} ${i.unit} (reorder at ${i.reorderLevel})`,
        severity: "warning",
      });
    }
    for (const i of outOfStock) {
      alerts.push({ type: "Out of Stock", message: `${i.name} — 0 ${i.unit}`, severity: "danger" });
    }
    for (const b of expiring) {
      const ing = ingredients.find((i) => i.id === b.ingredientId);
      alerts.push({
        type: "Expiry Warning",
        message: `${ing?.name ?? "Item"} batch ${b.batchNumber ?? "—"} expires ${b.expiryDate}`,
        severity: "warning",
      });
    }

    return {
      branchCode: branch.code,
      totalIngredients: ingredients.length,
      inventoryValue,
      lowStockItems: lowStock.length,
      outOfStockItems: outOfStock.length,
      expiringItems: expiring.length,
      todaysConsumption: 0,
      wasteToday: wasteTodayFiltered.reduce((s, w) => s + w.costImpactPkr, 0),
      purchaseCostThisMonth: posThisMonth.reduce((s, p) => s + p.totalAmountPkr, 0),
      alerts,
    };
  }

  async getBranchInventory(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    await this.seedBranchIfEmpty(branch);

    const [
      categories,
      ingredients,
      suppliers,
      purchaseOrders,
      goodsReceipts,
      stockBatches,
      recipes,
      adjustments,
      wasteRecords,
      stockCounts,
      auditLogs,
    ] = await Promise.all([
      this.loadCategories(branch.id),
      this.loadIngredients(branch.id),
      this.loadSuppliers(branch.id),
      this.loadPurchaseOrders(branch.id),
      this.loadGoodsReceipts(branch.id),
      this.loadStockBatches(branch.id),
      this.loadRecipes(branch.id),
      this.loadAdjustments(branch.id),
      this.loadWasteRecords(branch.id),
      this.loadStockCounts(branch.id),
      this.loadAuditLogs(branch.id),
    ]);

    return {
      branchCode: branch.code,
      categories,
      ingredients,
      suppliers,
      purchaseOrders,
      goodsReceipts,
      stockBatches,
      recipes,
      adjustments,
      wasteRecords,
      stockCounts,
      auditLogs,
    };
  }

  async getReport(
    organizationId: string,
    branchCode: string,
    reportId: string,
    query: { filterDate?: string; dateMode?: "activity" | "expiry" | "order" } = {},
  ) {
    const data = await this.getBranchInventory(organizationId, branchCode);
    const today = new Date().toISOString().slice(0, 10);
    const filterDate = query.filterDate;
    const dateMode = query.dateMode ?? "activity";

    const reports: Record<string, { name: string; category: string; description: string; rows: unknown[] }> = {
      "current-stock": {
        name: "Current Stock",
        category: "Inventory",
        description: "On-hand quantities by ingredient",
        rows: data.ingredients.map((i) => ({
          sku: i.sku,
          name: i.name,
          stock: `${i.currentStock} ${i.unit}`,
          value: i.currentStock * i.unitCost,
        })),
      },
      "low-stock": {
        name: "Low Stock",
        category: "Inventory",
        description: "Items below reorder level",
        rows: data.ingredients.filter((i) => i.currentStock <= i.reorderLevel),
      },
      expiry: {
        name: "Expiry Report",
        category: "Inventory",
        description: "Items nearing or past expiry",
        rows: data.stockBatches,
      },
      valuation: {
        name: "Inventory Valuation",
        category: "Inventory",
        description: "Total stock value by category",
        rows: data.categories.map((c) => ({
          category: c.name,
          items: c.itemCount,
          value: data.ingredients
            .filter((i) => i.categoryName === c.name)
            .reduce((s, i) => s + i.currentStock * i.unitCost, 0),
        })),
      },
      consumption: {
        name: "Ingredient Consumption",
        category: "Restaurant",
        description: "Consumption from recipes & POS",
        rows: data.adjustments.filter((a) => a.type === "Remove"),
      },
      "recipe-cost": {
        name: "Recipe Cost",
        category: "Restaurant",
        description: "Cost breakdown per menu item",
        rows: data.recipes,
      },
      waste: {
        name: "Waste Analysis",
        category: "Restaurant",
        description: "Waste trends",
        rows: data.wasteRecords,
      },
      purchases: {
        name: "Purchase Report",
        category: "Purchase",
        description: "PO history and spend",
        rows: data.purchaseOrders,
      },
      suppliers: {
        name: "Supplier Report",
        category: "Supplier",
        description: "Supplier performance",
        rows: data.suppliers,
      },
    };

    const report = reports[reportId];
    if (!report) throw new NotFoundException(`Report not found: ${reportId}`);

    const rows = this.applyReportDateFilter(report.rows, reportId, filterDate, dateMode);

    return {
      id: reportId,
      name: report.name,
      category: report.category,
      description: report.description,
      lastGenerated: today,
      filterDate: filterDate ?? null,
      dateMode: filterDate ? dateMode : null,
      data: rows,
    };
  }

  private sliceDateOnly(value: unknown): string | null {
    if (value == null || value === "") return null;
    return String(value).slice(0, 10);
  }

  private rowMatchesReportDate(
    row: Record<string, unknown>,
    reportId: string,
    filterDate: string,
    mode: "activity" | "expiry" | "order",
  ): boolean {
    const match = (...keys: string[]) =>
      keys.some((key) => this.sliceDateOnly(row[key]) === filterDate);

    switch (reportId) {
      case "expiry":
        if (mode === "expiry") return match("expiry");
        if (mode === "activity") return match("receivedDate");
        return false;
      case "consumption":
      case "waste":
        return mode === "activity" && match("date");
      case "purchases":
        if (mode === "activity") return match("createdAt");
        if (mode === "order") return match("expectedDate");
        return false;
      case "suppliers":
        if (mode === "activity") return match("onboardedDate");
        if (mode === "order") return match("lastOrder");
        return false;
      default:
        return true;
    }
  }

  private applyReportDateFilter(
    rows: unknown[],
    reportId: string,
    filterDate: string | undefined,
    mode: "activity" | "expiry" | "order",
  ): unknown[] {
    if (!filterDate) return rows;
    const dateReports = new Set(["expiry", "consumption", "waste", "purchases", "suppliers"]);
    if (!dateReports.has(reportId)) return rows;

    return rows.filter((row) => {
      if (!row || typeof row !== "object") return false;
      return this.rowMatchesReportDate(row as Record<string, unknown>, reportId, filterDate, mode);
    });
  }

  // ── Categories ──────────────────────────────────────────────────────────

  async createCategory(organizationId: string, userEmail: string, input: CreateInventoryCategory) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(popsInventoryCategories)
      .values({
        organizationId,
        branchId: branch.id,
        name: input.name.trim(),
        description: input.description?.trim() || null,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create category");
    await this.audit(organizationId, branch.id, userEmail, "Category created", "Categories", row.name);
    return this.mapCategory(row, 0);
  }

  async updateCategory(
    organizationId: string,
    userEmail: string,
    categoryId: string,
    input: UpdateInventoryCategory,
  ) {
    const cat = await this.getCategory(organizationId, categoryId);
    const [row] = await this.db
      .update(popsInventoryCategories)
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
      })
      .where(eq(popsInventoryCategories.id, categoryId))
      .returning();
    if (!row) throw new NotFoundException("Category not found");
    const count = await this.countIngredientsInCategory(categoryId);
    await this.audit(organizationId, cat.branchId, userEmail, "Category updated", "Categories", row.name);
    return this.mapCategory(row, count);
  }

  async deleteCategory(organizationId: string, userEmail: string, categoryId: string) {
    const cat = await this.getCategory(organizationId, categoryId);
    await this.db.delete(popsInventoryCategories).where(eq(popsInventoryCategories.id, categoryId));
    await this.audit(organizationId, cat.branchId, userEmail, "Category deleted", "Categories", cat.name);
    return { ok: true };
  }

  // ── Ingredients ─────────────────────────────────────────────────────────

  async createIngredient(organizationId: string, userEmail: string, input: CreateIngredient) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(popsIngredients)
      .values({
        organizationId,
        branchId: branch.id,
        categoryId: input.categoryId ?? null,
        sku: input.sku.trim(),
        name: input.name.trim(),
        unit: input.unit,
        currentStock: input.currentStock ?? 0,
        minStock: input.minStock ?? 0,
        reorderLevel: input.reorderLevel ?? 0,
        maxStock: input.maxStock ?? 0,
        unitCostPkr: input.unitCost ?? 0,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create ingredient");
    if (row.currentStock > 0) {
      await this.db.insert(popsStockBatches).values({
        organizationId,
        branchId: branch.id,
        ingredientId: row.id,
        qty: row.currentStock,
        location: "Main store",
        unitCostPkr: row.unitCostPkr,
      });
    }
    await this.audit(organizationId, branch.id, userEmail, "Ingredient created", "Ingredients", `${row.sku} ${row.name}`);
    return this.mapIngredient(row);
  }

  async updateIngredient(
    organizationId: string,
    userEmail: string,
    ingredientId: string,
    input: UpdateIngredient,
  ) {
    const existing = await this.getIngredient(organizationId, ingredientId);
    const [row] = await this.db
      .update(popsIngredients)
      .set({
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.sku !== undefined ? { sku: input.sku.trim() } : {}),
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.currentStock !== undefined ? { currentStock: input.currentStock } : {}),
        ...(input.minStock !== undefined ? { minStock: input.minStock } : {}),
        ...(input.reorderLevel !== undefined ? { reorderLevel: input.reorderLevel } : {}),
        ...(input.maxStock !== undefined ? { maxStock: input.maxStock } : {}),
        ...(input.unitCost !== undefined ? { unitCostPkr: input.unitCost } : {}),
      })
      .where(eq(popsIngredients.id, ingredientId))
      .returning();
    if (!row) throw new NotFoundException("Ingredient not found");
    await this.audit(organizationId, existing.branchId, userEmail, "Ingredient updated", "Ingredients", row.name);
    return this.mapIngredient(row);
  }

  async deleteIngredient(organizationId: string, userEmail: string, ingredientId: string) {
    const ing = await this.getIngredient(organizationId, ingredientId);
    await this.db.delete(popsIngredients).where(eq(popsIngredients.id, ingredientId));
    await this.audit(organizationId, ing.branchId, userEmail, "Ingredient deleted", "Ingredients", ing.name);
    return { ok: true };
  }

  // ── Suppliers ───────────────────────────────────────────────────────────

  async createSupplier(organizationId: string, userEmail: string, input: CreateSupplier) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(popsSuppliers)
      .values({
        organizationId,
        branchId: branch.id,
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
        address: input.address?.trim() || null,
        paymentTerms: input.paymentTerms?.trim() || null,
        openingBalancePkr: input.openingBalancePkr ?? 0,
        onboardedDate: input.onboardedDate ?? new Date().toISOString().slice(0, 10),
        active: input.active ?? true,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create supplier");
    await this.audit(organizationId, branch.id, userEmail, "Supplier created", "Suppliers", row.name);
    return this.mapSupplier(row, 0, null);
  }

  async updateSupplier(
    organizationId: string,
    userEmail: string,
    supplierId: string,
    input: UpdateSupplier,
  ) {
    const existing = await this.getSupplier(organizationId, supplierId);
    const [row] = await this.db
      .update(popsSuppliers)
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.paymentTerms !== undefined ? { paymentTerms: input.paymentTerms } : {}),
        ...(input.openingBalancePkr !== undefined ? { openingBalancePkr: input.openingBalancePkr } : {}),
        ...(input.onboardedDate !== undefined ? { onboardedDate: input.onboardedDate } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      })
      .where(eq(popsSuppliers.id, supplierId))
      .returning();
    if (!row) throw new NotFoundException("Supplier not found");
    await this.audit(organizationId, existing.branchId, userEmail, "Supplier updated", "Suppliers", row.name);
    const stats = await this.supplierStats(supplierId);
    return this.mapSupplier(row, stats.totalPurchases, stats.lastOrder);
  }

  async deleteSupplier(organizationId: string, userEmail: string, supplierId: string) {
    const sup = await this.getSupplier(organizationId, supplierId);
    await this.db.delete(popsSuppliers).where(eq(popsSuppliers.id, supplierId));
    await this.audit(organizationId, sup.branchId, userEmail, "Supplier deleted", "Suppliers", sup.name);
    return { ok: true };
  }

  // ── Purchase orders ─────────────────────────────────────────────────────

  async createPurchaseOrder(organizationId: string, userEmail: string, input: CreatePurchaseOrder) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    await this.getSupplier(organizationId, input.supplierId);

    const totalAmount = input.lines.reduce((s: number, l) => s + l.qty * l.unitCost, 0);
    const poNumber = `PO-${Date.now().toString().slice(-6)}`;

    const [po] = await this.db
      .insert(popsPurchaseOrders)
      .values({
        organizationId,
        branchId: branch.id,
        poNumber,
        supplierId: input.supplierId,
        status: "Draft",
        totalAmountPkr: totalAmount,
        expectedDate: input.expectedDate ?? null,
        requestedBy: input.requestedBy?.trim() || userEmail,
        chef: input.chef?.trim() || null,
      })
      .returning();
    if (!po) throw new BadRequestException("Failed to create PO");

    for (const line of input.lines) {
      await this.getIngredient(organizationId, line.ingredientId);
      await this.db.insert(popsPurchaseOrderLines).values({
        purchaseOrderId: po.id,
        ingredientId: line.ingredientId,
        qty: line.qty,
        unit: line.unit,
        unitCostPkr: line.unitCost,
      });
    }

    await this.audit(organizationId, branch.id, userEmail, "PO created", "Purchase Orders", poNumber);
    return (await this.loadPurchaseOrders(branch.id)).find((p) => p.id === po.id)!;
  }

  async updatePurchaseOrderStatus(
    organizationId: string,
    userEmail: string,
    poId: string,
    input: UpdatePurchaseOrderStatus,
  ) {
    const po = await this.getPurchaseOrder(organizationId, poId);
    const [row] = await this.db
      .update(popsPurchaseOrders)
      .set({ status: input.status })
      .where(eq(popsPurchaseOrders.id, poId))
      .returning();
    if (!row) throw new NotFoundException("PO not found");
    await this.audit(organizationId, po.branchId, userEmail, "PO status updated", "Purchase Orders", `${row.poNumber} → ${input.status}`);
    return (await this.loadPurchaseOrders(po.branchId)).find((p) => p.id === poId)!;
  }

  async updatePurchaseOrder(
    organizationId: string,
    userEmail: string,
    poId: string,
    input: UpdatePurchaseOrder,
  ) {
    const po = await this.getPurchaseOrder(organizationId, poId);
    if (po.status !== "Draft" && po.status !== "Pending") {
      throw new BadRequestException("Only Draft or Pending kitchen demand vouchers can be edited");
    }

    if (input.supplierId) {
      await this.getSupplier(organizationId, input.supplierId);
    }

    const patch: Partial<typeof popsPurchaseOrders.$inferInsert> = {};
    if (input.supplierId !== undefined) patch.supplierId = input.supplierId;
    if (input.expectedDate !== undefined) patch.expectedDate = input.expectedDate;
    if (input.requestedBy !== undefined) {
      patch.requestedBy = input.requestedBy?.trim() || userEmail;
    }
    if (input.chef !== undefined) patch.chef = input.chef?.trim() || null;

    if (input.lines) {
      const totalAmount = input.lines.reduce((s: number, l) => s + l.qty * l.unitCost, 0);
      patch.totalAmountPkr = totalAmount;
      await this.db.delete(popsPurchaseOrderLines).where(eq(popsPurchaseOrderLines.purchaseOrderId, poId));
      for (const line of input.lines) {
        await this.getIngredient(organizationId, line.ingredientId);
        await this.db.insert(popsPurchaseOrderLines).values({
          purchaseOrderId: poId,
          ingredientId: line.ingredientId,
          qty: line.qty,
          unit: line.unit,
          unitCostPkr: line.unitCost,
        });
      }
    }

    if (Object.keys(patch).length > 0) {
      await this.db.update(popsPurchaseOrders).set(patch).where(eq(popsPurchaseOrders.id, poId));
    }

    await this.audit(organizationId, po.branchId, userEmail, "PO updated", "Purchase Orders", po.poNumber);
    return (await this.loadPurchaseOrders(po.branchId)).find((p) => p.id === poId)!;
  }

  // ── Goods receiving ─────────────────────────────────────────────────────

  async createGoodsReceipt(organizationId: string, userEmail: string, input: CreateGoodsReceipt) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    await this.getSupplier(organizationId, input.supplierId);

    const totalCost = input.lines.reduce((s: number, l) => s + l.qty * l.unitCost, 0);
    const grnNumber = `GRN-${Date.now().toString().slice(-6)}`;

    const [grn] = await this.db
      .insert(popsGoodsReceipts)
      .values({
        organizationId,
        branchId: branch.id,
        grnNumber,
        supplierId: input.supplierId,
        purchaseOrderId: input.purchaseOrderId ?? null,
        invoiceNumber: input.invoiceNumber?.trim() || null,
        deliveryDate: input.deliveryDate,
        totalCostPkr: totalCost,
        receivedBy: input.receivedBy?.trim() || userEmail,
      })
      .returning();
    if (!grn) throw new BadRequestException("Failed to create GRN");

    for (const line of input.lines) {
      const ing = await this.getIngredient(organizationId, line.ingredientId);
      await this.db.insert(popsGoodsReceiptLines).values({
        goodsReceiptId: grn.id,
        ingredientId: line.ingredientId,
        qty: line.qty,
        unit: line.unit,
        unitCostPkr: line.unitCost,
        batchNumber: line.batchNumber?.trim() || null,
        expiryDate: line.expiryDate ?? null,
      });

      await this.db
        .update(popsIngredients)
        .set({
          currentStock: ing.currentStock + line.qty,
          unitCostPkr: line.unitCost,
        })
        .where(eq(popsIngredients.id, line.ingredientId));

      await this.db.insert(popsStockBatches).values({
        organizationId,
        branchId: branch.id,
        ingredientId: line.ingredientId,
        qty: line.qty,
        batchNumber: line.batchNumber?.trim() || null,
        expiryDate: line.expiryDate ?? null,
        location: "Main store",
        unitCostPkr: line.unitCost,
      });

      if (input.purchaseOrderId) {
        const poLines = await this.db
          .select()
          .from(popsPurchaseOrderLines)
          .where(
            and(
              eq(popsPurchaseOrderLines.purchaseOrderId, input.purchaseOrderId),
              eq(popsPurchaseOrderLines.ingredientId, line.ingredientId),
            ),
          );
        if (poLines[0]) {
          await this.db
            .update(popsPurchaseOrderLines)
            .set({ receivedQty: poLines[0].receivedQty + line.qty })
            .where(eq(popsPurchaseOrderLines.id, poLines[0].id));
        }
      }
    }

    if (input.purchaseOrderId) {
      const poLines = await this.db
        .select()
        .from(popsPurchaseOrderLines)
        .where(eq(popsPurchaseOrderLines.purchaseOrderId, input.purchaseOrderId));
      const allReceived = poLines.every((l) => l.receivedQty >= l.qty);
      const anyReceived = poLines.some((l) => l.receivedQty > 0);
      await this.db
        .update(popsPurchaseOrders)
        .set({ status: allReceived ? "Received" : anyReceived ? "Partially Received" : "Ordered" })
        .where(eq(popsPurchaseOrders.id, input.purchaseOrderId));
    }

    await this.audit(organizationId, branch.id, userEmail, "Goods received", "Goods Receiving", grnNumber);

    try {
      await this.accountingHooks.recordPurchaseFromGrn(organizationId, branch.id, grn);
    } catch {
      // accounting is best-effort; GRN already committed
    }

    return (await this.loadGoodsReceipts(branch.id)).find((g) => g.id === grn.id)!;
  }

  // ── Recipes ─────────────────────────────────────────────────────────────

  async createRecipe(organizationId: string, userEmail: string, input: CreateRecipe) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const totalCost = await this.computeRecipeCost(input.lines);

    const [recipe] = await this.db
      .insert(popsRecipes)
      .values({
        organizationId,
        branchId: branch.id,
        name: input.name.trim(),
        menuItemId: input.menuItemId ?? null,
        version: input.version ?? "v1.0",
        portionSize: input.portionSize?.trim() || null,
        totalCostPkr: totalCost,
        active: input.active ?? true,
      })
      .returning();
    if (!recipe) throw new BadRequestException("Failed to create recipe");

    for (const line of input.lines) {
      await this.getIngredient(organizationId, line.ingredientId);
      await this.db.insert(popsRecipeLines).values({
        recipeId: recipe.id,
        ingredientId: line.ingredientId,
        qty: line.qty,
        unit: line.unit,
      });
    }

    await this.audit(organizationId, branch.id, userEmail, "Recipe created", "Recipe Management", recipe.name);
    return (await this.loadRecipes(branch.id)).find((r) => r.id === recipe.id)!;
  }

  async updateRecipe(organizationId: string, userEmail: string, recipeId: string, input: UpdateRecipe) {
    const existing = await this.getRecipe(organizationId, recipeId);
    const totalCost = input.lines ? await this.computeRecipeCost(input.lines) : undefined;

    await this.db
      .update(popsRecipes)
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.menuItemId !== undefined ? { menuItemId: input.menuItemId } : {}),
        ...(input.version !== undefined ? { version: input.version } : {}),
        ...(input.portionSize !== undefined ? { portionSize: input.portionSize } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(totalCost !== undefined ? { totalCostPkr: totalCost } : {}),
      })
      .where(eq(popsRecipes.id, recipeId));

    if (input.lines) {
      await this.db.delete(popsRecipeLines).where(eq(popsRecipeLines.recipeId, recipeId));
      for (const line of input.lines) {
        await this.db.insert(popsRecipeLines).values({
          recipeId,
          ingredientId: line.ingredientId,
          qty: line.qty,
          unit: line.unit,
        });
      }
    }

    await this.audit(organizationId, existing.branchId, userEmail, "Recipe updated", "Recipe Management", existing.name);
    return (await this.loadRecipes(existing.branchId)).find((r) => r.id === recipeId)!;
  }

  async deleteRecipe(organizationId: string, userEmail: string, recipeId: string) {
    const recipe = await this.getRecipe(organizationId, recipeId);
    await this.db.delete(popsRecipes).where(eq(popsRecipes.id, recipeId));
    await this.audit(organizationId, recipe.branchId, userEmail, "Recipe deleted", "Recipe Management", recipe.name);
    return { ok: true };
  }

  // ── Adjustments ─────────────────────────────────────────────────────────

  async createAdjustment(organizationId: string, userEmail: string, input: CreateStockAdjustment) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const ing = await this.getIngredient(organizationId, input.ingredientId);

    const [row] = await this.db
      .insert(popsStockAdjustments)
      .values({
        organizationId,
        branchId: branch.id,
        ingredientId: input.ingredientId,
        type: input.type,
        qty: input.qty,
        unit: ing.unit,
        reason: input.reason.trim(),
        status: "Pending",
        requestedBy: input.requestedBy?.trim() || userEmail,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create adjustment");
    await this.audit(organizationId, branch.id, userEmail, "Adjustment requested", "Stock Adjustments", `${ing.name} ${input.type} ${input.qty}`);
    return (await this.loadAdjustments(branch.id)).find((a) => a.id === row.id)!;
  }

  async updateAdjustmentStatus(
    organizationId: string,
    userEmail: string,
    adjustmentId: string,
    input: UpdateAdjustmentStatus,
  ) {
    const adj = await this.getAdjustment(organizationId, adjustmentId);
    if (adj.status !== "Pending") throw new BadRequestException("Adjustment already processed");

    const [row] = await this.db
      .update(popsStockAdjustments)
      .set({ status: input.status })
      .where(eq(popsStockAdjustments.id, adjustmentId))
      .returning();
    if (!row) throw new NotFoundException("Adjustment not found");

    if (input.status === "Approved") {
      const ing = await this.getIngredient(organizationId, adj.ingredientId);
      const delta = adj.type === "Add" ? adj.qty : -adj.qty;
      const newStock = Math.max(0, ing.currentStock + delta);
      await this.db
        .update(popsIngredients)
        .set({ currentStock: newStock })
        .where(eq(popsIngredients.id, adj.ingredientId));

      const costImpact = Math.round(adj.qty * ing.unitCostPkr);
      try {
        await this.accountingHooks.recordStockAdjustment(
          organizationId,
          adj.branchId,
          `ADJ-${adjustmentId.slice(0, 8)}`,
          adj.type as "Add" | "Remove",
          costImpact,
          adj.reason,
        );
      } catch {
        // best-effort
      }
    }

    await this.audit(organizationId, adj.branchId, userEmail, "Adjustment " + input.status.toLowerCase(), "Stock Adjustments", adj.reason);
    return (await this.loadAdjustments(adj.branchId)).find((a) => a.id === adjustmentId)!;
  }

  // ── Waste ───────────────────────────────────────────────────────────────

  async createWaste(organizationId: string, userEmail: string, input: CreateWasteRecord) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const ing = await this.getIngredient(organizationId, input.ingredientId);
    const costImpact = Math.round((input.qty / Math.max(ing.currentStock, 1)) * ing.currentStock * ing.unitCostPkr) || ing.unitCostPkr * input.qty;

    const [row] = await this.db
      .insert(popsWasteRecords)
      .values({
        organizationId,
        branchId: branch.id,
        ingredientId: input.ingredientId,
        qty: input.qty,
        unit: ing.unit,
        wasteType: input.wasteType,
        reason: input.reason?.trim() || null,
        costImpactPkr: costImpact,
        status: "Pending",
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to record waste");
    await this.audit(organizationId, branch.id, userEmail, "Waste recorded", "Waste Management", `${ing.name} ${input.qty} ${ing.unit}`);
    return (await this.loadWasteRecords(branch.id)).find((w) => w.id === row.id)!;
  }

  async updateWasteStatus(
    organizationId: string,
    userEmail: string,
    wasteId: string,
    input: UpdateWasteStatus,
  ) {
    const waste = await this.getWaste(organizationId, wasteId);
    if (waste.status !== "Pending") throw new BadRequestException("Waste already processed");

    await this.db
      .update(popsWasteRecords)
      .set({ status: input.status })
      .where(eq(popsWasteRecords.id, wasteId));

    if (input.status === "Approved") {
      const ing = await this.getIngredient(organizationId, waste.ingredientId);
      await this.db
        .update(popsIngredients)
        .set({ currentStock: Math.max(0, ing.currentStock - waste.qty) })
        .where(eq(popsIngredients.id, waste.ingredientId));

      try {
        await this.accountingHooks.recordWaste(
          organizationId,
          waste.branchId,
          `WASTE-${wasteId.slice(0, 8)}`,
          waste.costImpactPkr,
          waste.wasteType,
        );
      } catch {
        // best-effort
      }
    }

    await this.audit(organizationId, waste.branchId, userEmail, "Waste " + input.status.toLowerCase(), "Waste Management", waste.reason ?? waste.wasteType);
    return (await this.loadWasteRecords(waste.branchId)).find((w) => w.id === wasteId)!;
  }

  // ── Stock counts ────────────────────────────────────────────────────────

  async createStockCount(organizationId: string, userEmail: string, input: CreateStockCount) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const today = new Date().toISOString().slice(0, 10);
    const typeInitial = input.type[0];
    const countNumber = `CNT-${today.replace(/-/g, "")}-${typeInitial}`;

    const ingredients = await this.db
      .select()
      .from(popsIngredients)
      .where(eq(popsIngredients.branchId, branch.id));

    const [count] = await this.db
      .insert(popsStockCounts)
      .values({
        organizationId,
        branchId: branch.id,
        countNumber,
        type: input.type,
        countDate: today,
        status: "In Progress",
        itemsCounted: ingredients.length,
        conductedBy: input.conductedBy?.trim() || userEmail,
      })
      .returning();
    if (!count) throw new BadRequestException("Failed to create stock count");

    for (const ing of ingredients) {
      await this.db.insert(popsStockCountLines).values({
        stockCountId: count.id,
        ingredientId: ing.id,
        systemQty: ing.currentStock,
        physicalQty: ing.currentStock,
      });
    }

    await this.audit(organizationId, branch.id, userEmail, "Stock count started", "Stock Count", countNumber);
    return (await this.loadStockCounts(branch.id)).find((c) => c.id === count.id)!;
  }

  async updateStockCountLine(
    organizationId: string,
    userEmail: string,
    countId: string,
    input: { ingredientId: string; physicalQty: number },
  ) {
    const count = await this.getStockCount(organizationId, countId);
    if (count.status !== "In Progress") throw new BadRequestException("Count is not in progress");

    await this.db
      .update(popsStockCountLines)
      .set({ physicalQty: input.physicalQty })
      .where(
        and(
          eq(popsStockCountLines.stockCountId, countId),
          eq(popsStockCountLines.ingredientId, input.ingredientId),
        ),
      );

    return (await this.loadStockCounts(count.branchId)).find((c) => c.id === countId)!;
  }

  async completeStockCount(
    organizationId: string,
    userEmail: string,
    countId: string,
    input: CompleteStockCount,
  ) {
    const count = await this.getStockCount(organizationId, countId);
    const lines = await this.db
      .select()
      .from(popsStockCountLines)
      .where(eq(popsStockCountLines.stockCountId, countId));

    let variances = 0;
    for (const line of lines) {
      if (line.physicalQty !== line.systemQty) variances++;
      if (input.applyAdjustments && line.physicalQty !== line.systemQty) {
        await this.db
          .update(popsIngredients)
          .set({ currentStock: line.physicalQty })
          .where(eq(popsIngredients.id, line.ingredientId));
      }
    }

    const status = input.applyAdjustments ? "Adjusted" : "Completed";
    await this.db
      .update(popsStockCounts)
      .set({ status, variances })
      .where(eq(popsStockCounts.id, countId));

    await this.audit(organizationId, count.branchId, userEmail, "Stock count completed", "Stock Count", `${count.countNumber} · ${variances} variances`);
    return (await this.loadStockCounts(count.branchId)).find((c) => c.id === countId)!;
  }

  // ── Production batches ──────────────────────────────────────────────────

  async listProductionBatches(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const batches = await this.loadProductionBatches(branch.id);
    return { branchCode: branch.code, batches };
  }

  async createProductionBatch(organizationId: string, userEmail: string, input: CreateProductionBatch) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const recipe = await this.getRecipe(organizationId, input.recipeId);
    if (recipe.branchId !== branch.id) throw new BadRequestException("Recipe belongs to another branch");
    if (!recipe.active) throw new BadRequestException("Recipe is inactive");

    const recipeLines = await this.db
      .select()
      .from(popsRecipeLines)
      .where(eq(popsRecipeLines.recipeId, recipe.id));
    if (recipeLines.length === 0) {
      throw new BadRequestException("Recipe has no ingredients — add lines under Inventory → Recipes");
    }

    const wastePct = input.wastePct ?? 0;
    const outputQty = input.outputQty;
    const { lines, totalCost } = await this.buildProductionLines(
      organizationId,
      recipeLines,
      wastePct,
    );

    if (lines.length === 0) throw new BadRequestException("Could not compute production lines");

    const unitCost = outputQty > 0 ? Math.round(totalCost / outputQty) : 0;
    const batchRef = await this.nextProductionBatchRef(branch.id);
    const outputName = input.outputName?.trim() || recipe.name;
    const outputDescription =
      input.outputDescription?.trim() ||
      (recipe.portionSize
        ? `${recipe.name} (est. ${outputQty} ${recipe.portionSize.replace(/^\d+\s*/, "") || "units"})`
        : `${recipe.name} · ${outputQty} units`);

    let outputIngredientId = input.outputIngredientId ?? null;
    if (outputIngredientId) {
      const outIng = await this.getIngredient(organizationId, outputIngredientId);
      if (outIng.branchId !== branch.id) {
        throw new BadRequestException("Output ingredient belongs to another branch");
      }
    }

    const [batch] = await this.db
      .insert(popsProductionBatches)
      .values({
        organizationId,
        branchId: branch.id,
        batchRef,
        recipeId: recipe.id,
        outputName,
        outputDescription,
        outputIngredientId,
        outputQty,
        wastePct,
        totalCostPkr: totalCost,
        unitCostPkr: unitCost,
        status: "Draft",
      })
      .returning();

    if (!batch) throw new BadRequestException("Failed to create production batch");

    for (const line of lines) {
      await this.db.insert(popsProductionBatchLines).values({
        batchId: batch.id,
        ingredientId: line.ingredientId,
        qty: line.qty,
        unit: line.unit,
        unitCostPkr: line.unitCostPkr,
        costPkr: line.costPkr,
      });
    }

    await this.audit(
      organizationId,
      branch.id,
      userEmail,
      "Production batch created",
      "Production",
      `${batchRef} · ${outputName}`,
    );

    return (await this.loadProductionBatches(branch.id)).find((b) => b.id === batch.id)!;
  }

  async postProductionBatch(organizationId: string, userEmail: string, batchId: string) {
    const batch = await this.getProductionBatch(organizationId, batchId);
    if (batch.status !== "Draft") throw new BadRequestException("Batch already posted");

    const lines = await this.db
      .select()
      .from(popsProductionBatchLines)
      .where(eq(popsProductionBatchLines.batchId, batchId));

    for (const line of lines) {
      const ing = await this.getIngredient(organizationId, line.ingredientId);
      if (ing.currentStock < line.qty) {
        throw new BadRequestException(
          `Insufficient stock for ${ing.name}: need ${line.qty} ${line.unit}, have ${ing.currentStock}`,
        );
      }
    }

    for (const line of lines) {
      const ing = await this.getIngredient(organizationId, line.ingredientId);
      await this.db
        .update(popsIngredients)
        .set({ currentStock: Math.max(0, ing.currentStock - line.qty) })
        .where(eq(popsIngredients.id, line.ingredientId));
    }

    if (batch.outputIngredientId) {
      const outIng = await this.getIngredient(organizationId, batch.outputIngredientId);
      await this.db
        .update(popsIngredients)
        .set({
          currentStock: outIng.currentStock + batch.outputQty,
          unitCostPkr: batch.unitCostPkr > 0 ? batch.unitCostPkr : outIng.unitCostPkr,
        })
        .where(eq(popsIngredients.id, batch.outputIngredientId));
    }

    const now = new Date();
    await this.db
      .update(popsProductionBatches)
      .set({ status: "Posted", postedAt: now, postedBy: userEmail })
      .where(eq(popsProductionBatches.id, batchId));

    try {
      await this.accountingHooks.recordProduction(
        organizationId,
        batch.branchId,
        batch.batchRef,
        batch.totalCostPkr,
        batch.outputName,
      );
    } catch {
      // inventory already committed
    }

    await this.audit(
      organizationId,
      batch.branchId,
      userEmail,
      "Production posted",
      "Production",
      `${batch.batchRef} · ${batch.outputName} (+${batch.outputQty} units)`,
    );

    return (await this.loadProductionBatches(batch.branchId)).find((b) => b.id === batchId)!;
  }

  // ── Loaders & mappers ───────────────────────────────────────────────────

  private async loadCategories(branchId: string) {
    const rows = await this.db
      .select()
      .from(popsInventoryCategories)
      .where(eq(popsInventoryCategories.branchId, branchId))
      .orderBy(asc(popsInventoryCategories.name));
    return Promise.all(rows.map(async (r) => this.mapCategory(r, await this.countIngredientsInCategory(r.id))));
  }

  private async loadIngredients(branchId: string) {
    const rows = await this.db
      .select()
      .from(popsIngredients)
      .where(eq(popsIngredients.branchId, branchId))
      .orderBy(asc(popsIngredients.name));
    return Promise.all(rows.map((r) => this.mapIngredient(r)));
  }

  private async loadSuppliers(branchId: string) {
    const rows = await this.db
      .select()
      .from(popsSuppliers)
      .where(eq(popsSuppliers.branchId, branchId))
      .orderBy(asc(popsSuppliers.name));
    return Promise.all(
      rows.map(async (r) => {
        const stats = await this.supplierStats(r.id);
        return this.mapSupplier(r, stats.totalPurchases, stats.lastOrder);
      }),
    );
  }

  private async loadPurchaseOrders(branchId: string) {
    const rows = await this.db
      .select()
      .from(popsPurchaseOrders)
      .where(eq(popsPurchaseOrders.branchId, branchId))
      .orderBy(desc(popsPurchaseOrders.createdAt));

    const ingredientMap = await this.ingredientNameMap(branchId);

    return Promise.all(
      rows.map(async (po) => {
        const supplier = await this.db
          .select()
          .from(popsSuppliers)
          .where(eq(popsSuppliers.id, po.supplierId))
          .limit(1);
        const lines = await this.db
          .select()
          .from(popsPurchaseOrderLines)
          .where(eq(popsPurchaseOrderLines.purchaseOrderId, po.id));
        return {
          id: po.id,
          poNumber: po.poNumber,
          supplierId: po.supplierId,
          supplierName: supplier[0]?.name ?? "—",
          status: po.status as PurchaseOrderStatus,
          items: lines.length,
          totalAmount: po.totalAmountPkr,
          createdAt: po.createdAt.toISOString().slice(0, 10),
          expectedDate: po.expectedDate ?? null,
          requestedBy: po.requestedBy,
          chef: po.chef,
          lines: lines.map((line) => ({
            id: line.id,
            ingredientId: line.ingredientId,
            ingredientName: ingredientMap.get(line.ingredientId) ?? "—",
            qty: line.qty,
            unit: line.unit,
            unitCost: line.unitCostPkr,
            receivedQty: line.receivedQty,
          })),
        };
      }),
    );
  }

  private async loadGoodsReceipts(branchId: string) {
    const rows = await this.db
      .select()
      .from(popsGoodsReceipts)
      .where(eq(popsGoodsReceipts.branchId, branchId))
      .orderBy(desc(popsGoodsReceipts.createdAt));

    return Promise.all(
      rows.map(async (grn) => {
        const supplier = await this.db.select().from(popsSuppliers).where(eq(popsSuppliers.id, grn.supplierId)).limit(1);
        let poNumber: string | null = null;
        if (grn.purchaseOrderId) {
          const po = await this.db.select().from(popsPurchaseOrders).where(eq(popsPurchaseOrders.id, grn.purchaseOrderId)).limit(1);
          poNumber = po[0]?.poNumber ?? null;
        }
        const lines = await this.db
          .select()
          .from(popsGoodsReceiptLines)
          .where(eq(popsGoodsReceiptLines.goodsReceiptId, grn.id));
        const ingredientMap = await this.ingredientNameMap(branchId);
        return {
          id: grn.id,
          grnNumber: grn.grnNumber,
          supplierId: grn.supplierId,
          supplierName: supplier[0]?.name ?? "—",
          invoiceNumber: grn.invoiceNumber,
          deliveryDate: grn.deliveryDate,
          poNumber,
          poId: grn.purchaseOrderId,
          items: lines.map((l) => ({
            id: l.id,
            ingredientId: l.ingredientId,
            name: ingredientMap.get(l.ingredientId) ?? "—",
            qty: l.qty,
            unit: l.unit,
            unitCost: l.unitCostPkr,
            batch: l.batchNumber,
            expiry: l.expiryDate,
          })),
          totalCost: grn.totalCostPkr,
          receivedBy: grn.receivedBy,
          createdAt: grn.createdAt.toISOString().slice(0, 10),
        };
      }),
    );
  }

  private async loadStockBatches(branchId: string) {
    const batches = await this.db
      .select()
      .from(popsStockBatches)
      .where(eq(popsStockBatches.branchId, branchId))
      .orderBy(asc(popsStockBatches.expiryDate));

    const ingredients = await this.db
      .select()
      .from(popsIngredients)
      .where(eq(popsIngredients.branchId, branchId));
    const ingMap = new Map(ingredients.map((i) => [i.id, i]));

    return batches.map((b) => {
      const ing = ingMap.get(b.ingredientId);
      return {
        id: b.id,
        sku: ing?.sku ?? "—",
        name: ing?.name ?? "—",
        qty: b.qty,
        unit: ing?.unit ?? "—",
        batch: b.batchNumber,
        expiry: b.expiryDate ? this.formatDateOnly(b.expiryDate, b.createdAt) : null,
        receivedDate: this.formatDateOnly(null, b.createdAt),
        location: b.location,
        unitCost: b.unitCostPkr,
      };
    });
  }

  private async loadRecipes(branchId: string) {
    const rows = await this.db
      .select()
      .from(popsRecipes)
      .where(eq(popsRecipes.branchId, branchId))
      .orderBy(asc(popsRecipes.name));

    const ingredientMap = await this.ingredientNameMap(branchId);
    const menuItems = await this.db.select().from(popsMenuItems).where(eq(popsMenuItems.branchId, branchId));
    const menuMap = new Map(menuItems.map((m) => [m.id, m.name]));

    return Promise.all(
      rows.map(async (r) => {
        const lines = await this.db
          .select()
          .from(popsRecipeLines)
          .where(eq(popsRecipeLines.recipeId, r.id));
        return {
          id: r.id,
          name: r.name,
          menuItemId: r.menuItemId,
          menuItem: r.menuItemId ? (menuMap.get(r.menuItemId) ?? null) : null,
          version: r.version,
          portionSize: r.portionSize,
          ingredients: lines.map((l) => ({
            id: l.id,
            ingredientId: l.ingredientId,
            ingredient: ingredientMap.get(l.ingredientId) ?? "—",
            qty: l.qty,
            unit: l.unit,
          })),
          totalCost: r.totalCostPkr,
          active: r.active,
        };
      }),
    );
  }

  private async loadAdjustments(branchId: string) {
    const rows = await this.db
      .select()
      .from(popsStockAdjustments)
      .where(eq(popsStockAdjustments.branchId, branchId))
      .orderBy(desc(popsStockAdjustments.createdAt));
    const ingredientMap = await this.ingredientNameMap(branchId);
    return rows.map((a) => ({
      id: a.id,
      date: a.createdAt.toISOString().slice(0, 10),
      ingredientId: a.ingredientId,
      ingredient: ingredientMap.get(a.ingredientId) ?? "—",
      type: a.type as "Add" | "Remove",
      qty: a.qty,
      unit: a.unit,
      reason: a.reason,
      status: a.status as "Pending" | "Approved" | "Rejected",
      requestedBy: a.requestedBy,
    }));
  }

  private async loadWasteRecords(branchId: string) {
    const rows = await this.db
      .select()
      .from(popsWasteRecords)
      .where(eq(popsWasteRecords.branchId, branchId))
      .orderBy(desc(popsWasteRecords.createdAt));
    const ingredientMap = await this.ingredientNameMap(branchId);
    return rows.map((w) => ({
      id: w.id,
      date: w.createdAt.toISOString().slice(0, 10),
      ingredientId: w.ingredientId,
      ingredient: ingredientMap.get(w.ingredientId) ?? "—",
      qty: w.qty,
      unit: w.unit,
      wasteType: w.wasteType as WasteType,
      reason: w.reason,
      costImpact: w.costImpactPkr,
      status: w.status as "Pending" | "Approved",
    }));
  }

  private async loadStockCounts(branchId: string) {
    const rows = await this.db
      .select()
      .from(popsStockCounts)
      .where(eq(popsStockCounts.branchId, branchId))
      .orderBy(desc(popsStockCounts.createdAt));
    return rows.map((c) => ({
      id: c.id,
      countNumber: c.countNumber,
      type: c.type as StockCountType,
      date: this.formatDateOnly(c.countDate, c.createdAt),
      startedDate: this.formatDateOnly(null, c.createdAt),
      status: c.status as StockCountStatus,
      itemsCounted: c.itemsCounted,
      variances: c.variances,
      conductedBy: c.conductedBy,
    }));
  }

  private async loadAuditLogs(branchId: string) {
    const rows = await this.db
      .select()
      .from(popsInventoryAuditLogs)
      .where(eq(popsInventoryAuditLogs.branchId, branchId))
      .orderBy(desc(popsInventoryAuditLogs.createdAt))
      .limit(100);
    return rows.map((l) => ({
      id: l.id,
      timestamp: l.createdAt.toISOString().replace("T", " ").slice(0, 16),
      user: l.userEmail,
      action: l.action,
      module: l.module,
      detail: l.detail,
    }));
  }

  private mapCategory(row: typeof popsInventoryCategories.$inferSelect, itemCount: number) {
    return { id: row.id, name: row.name, description: row.description, itemCount };
  }

  private async mapIngredient(row: typeof popsIngredients.$inferSelect) {
    let categoryName: string | null = null;
    if (row.categoryId) {
      const cat = await this.db
        .select()
        .from(popsInventoryCategories)
        .where(eq(popsInventoryCategories.id, row.categoryId))
        .limit(1);
      categoryName = cat[0]?.name ?? null;
    }
    return {
      id: row.id,
      categoryId: row.categoryId,
      categoryName,
      sku: row.sku,
      name: row.name,
      unit: row.unit as IngredientUnit,
      currentStock: row.currentStock,
      minStock: row.minStock,
      reorderLevel: row.reorderLevel,
      maxStock: row.maxStock,
      unitCost: row.unitCostPkr,
    };
  }

  private formatDateOnly(value: string | Date | null | undefined, fallback: Date): string {
    if (value) {
      if (typeof value === "string") return value.slice(0, 10);
      return value.toISOString().slice(0, 10);
    }
    return fallback.toISOString().slice(0, 10);
  }

  private mapSupplier(
    row: typeof popsSuppliers.$inferSelect,
    totalPurchases: number,
    lastOrder: string | null,
  ) {
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      address: row.address,
      paymentTerms: row.paymentTerms,
      openingBalancePkr: row.openingBalancePkr,
      onboardedDate: this.formatDateOnly(row.onboardedDate, row.createdAt),
      active: row.active,
      totalPurchases,
      lastOrder,
    };
  }

  private async countIngredientsInCategory(categoryId: string) {
    const rows = await this.db
      .select({ id: popsIngredients.id })
      .from(popsIngredients)
      .where(eq(popsIngredients.categoryId, categoryId));
    return rows.length;
  }

  private async supplierStats(supplierId: string) {
    const pos = await this.db
      .select()
      .from(popsPurchaseOrders)
      .where(eq(popsPurchaseOrders.supplierId, supplierId))
      .orderBy(desc(popsPurchaseOrders.createdAt));
    const totalPurchases = pos.reduce((s, p) => s + p.totalAmountPkr, 0);
    const lastOrder = pos.length > 0 ? pos[0].createdAt.toISOString().slice(0, 10) : null;
    return { totalPurchases, lastOrder };
  }

  private async ingredientNameMap(branchId: string) {
    const rows = await this.db
      .select()
      .from(popsIngredients)
      .where(eq(popsIngredients.branchId, branchId));
    return new Map(rows.map((i) => [i.id, i.name]));
  }

  private async computeRecipeCost(lines: { ingredientId: string; qty: number }[]) {
    let total = 0;
    for (const line of lines) {
      const ing = await this.db
        .select()
        .from(popsIngredients)
        .where(eq(popsIngredients.id, line.ingredientId))
        .limit(1);
      if (ing[0]) total += Math.round((line.qty / Math.max(ing[0].currentStock || 1, 1)) * ing[0].unitCostPkr);
    }
    return total;
  }

  private async audit(
    organizationId: string,
    branchId: string,
    userEmail: string,
    action: string,
    module: string,
    detail: string,
  ) {
    await this.db.insert(popsInventoryAuditLogs).values({
      organizationId,
      branchId,
      userEmail,
      action,
      module,
      detail,
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

  private async getCategory(organizationId: string, categoryId: string) {
    const rows = await this.db
      .select()
      .from(popsInventoryCategories)
      .where(eq(popsInventoryCategories.id, categoryId))
      .limit(1);
    const cat = rows[0];
    if (!cat || cat.organizationId !== organizationId) throw new NotFoundException("Category not found");
    return cat;
  }

  private async getIngredient(organizationId: string, ingredientId: string) {
    const rows = await this.db
      .select()
      .from(popsIngredients)
      .where(eq(popsIngredients.id, ingredientId))
      .limit(1);
    const ing = rows[0];
    if (!ing || ing.organizationId !== organizationId) throw new NotFoundException("Ingredient not found");
    return ing;
  }

  private async getSupplier(organizationId: string, supplierId: string) {
    const rows = await this.db.select().from(popsSuppliers).where(eq(popsSuppliers.id, supplierId)).limit(1);
    const sup = rows[0];
    if (!sup || sup.organizationId !== organizationId) throw new NotFoundException("Supplier not found");
    return sup;
  }

  private async getPurchaseOrder(organizationId: string, poId: string) {
    const rows = await this.db.select().from(popsPurchaseOrders).where(eq(popsPurchaseOrders.id, poId)).limit(1);
    const po = rows[0];
    if (!po || po.organizationId !== organizationId) throw new NotFoundException("PO not found");
    return po;
  }

  private async getRecipe(organizationId: string, recipeId: string) {
    const rows = await this.db.select().from(popsRecipes).where(eq(popsRecipes.id, recipeId)).limit(1);
    const recipe = rows[0];
    if (!recipe || recipe.organizationId !== organizationId) throw new NotFoundException("Recipe not found");
    return recipe;
  }

  private async getAdjustment(organizationId: string, adjustmentId: string) {
    const rows = await this.db
      .select()
      .from(popsStockAdjustments)
      .where(eq(popsStockAdjustments.id, adjustmentId))
      .limit(1);
    const adj = rows[0];
    if (!adj || adj.organizationId !== organizationId) throw new NotFoundException("Adjustment not found");
    return adj;
  }

  private async getWaste(organizationId: string, wasteId: string) {
    const rows = await this.db.select().from(popsWasteRecords).where(eq(popsWasteRecords.id, wasteId)).limit(1);
    const waste = rows[0];
    if (!waste || waste.organizationId !== organizationId) throw new NotFoundException("Waste record not found");
    return waste;
  }

  private async getStockCount(organizationId: string, countId: string) {
    const rows = await this.db.select().from(popsStockCounts).where(eq(popsStockCounts.id, countId)).limit(1);
    const count = rows[0];
    if (!count || count.organizationId !== organizationId) throw new NotFoundException("Stock count not found");
    return count;
  }

  private async loadProductionBatches(branchId: string) {
    const rows = await this.db
      .select()
      .from(popsProductionBatches)
      .where(eq(popsProductionBatches.branchId, branchId))
      .orderBy(desc(popsProductionBatches.createdAt));

    const ingredientMap = await this.ingredientNameMap(branchId);
    const recipes = await this.db.select().from(popsRecipes).where(eq(popsRecipes.branchId, branchId));
    const recipeMap = new Map(recipes.map((r) => [r.id, r.name]));

    return Promise.all(
      rows.map(async (batch) => {
        const lineRows = await this.db
          .select()
          .from(popsProductionBatchLines)
          .where(eq(popsProductionBatchLines.batchId, batch.id));

        return {
          id: batch.id,
          batchRef: batch.batchRef,
          recipeId: batch.recipeId,
          recipeName: batch.recipeId ? (recipeMap.get(batch.recipeId) ?? null) : null,
          outputName: batch.outputName,
          outputDescription: batch.outputDescription,
          outputIngredientId: batch.outputIngredientId,
          outputIngredient: batch.outputIngredientId
            ? (ingredientMap.get(batch.outputIngredientId) ?? null)
            : null,
          outputQty: batch.outputQty,
          wastePct: batch.wastePct,
          totalCost: batch.totalCostPkr,
          unitCost: batch.unitCostPkr,
          status: batch.status as "Draft" | "Posted",
          postedAt: batch.postedAt?.toISOString() ?? null,
          postedBy: batch.postedBy,
          createdAt: batch.createdAt.toISOString(),
          lines: lineRows.map((line) => ({
            id: line.id,
            ingredientId: line.ingredientId,
            ingredient: ingredientMap.get(line.ingredientId) ?? "—",
            qty: line.qty,
            unit: line.unit,
            unitCost: line.unitCostPkr,
            cost: line.costPkr,
          })),
        };
      }),
    );
  }

  private async getProductionBatch(organizationId: string, batchId: string) {
    const rows = await this.db
      .select()
      .from(popsProductionBatches)
      .where(eq(popsProductionBatches.id, batchId))
      .limit(1);
    const batch = rows[0];
    if (!batch || batch.organizationId !== organizationId) {
      throw new NotFoundException("Production batch not found");
    }
    return batch;
  }

  private async buildProductionLines(
    organizationId: string,
    recipeLines: (typeof popsRecipeLines.$inferSelect)[],
    wastePct: number,
  ) {
    const wasteFactor = 1 + wastePct / 100;
    const lines: {
      ingredientId: string;
      qty: number;
      unit: string;
      unitCostPkr: number;
      costPkr: number;
    }[] = [];
    let totalCost = 0;

    for (const recipeLine of recipeLines) {
      const ing = await this.getIngredient(organizationId, recipeLine.ingredientId);
      const qty = Math.ceil(recipeLine.qty * wasteFactor);
      const costPkr = Math.round(qty * ing.unitCostPkr);
      totalCost += costPkr;
      lines.push({
        ingredientId: recipeLine.ingredientId,
        qty,
        unit: recipeLine.unit,
        unitCostPkr: ing.unitCostPkr,
        costPkr,
      });
    }

    return { lines, totalCost };
  }

  private async nextProductionBatchRef(branchId: string): Promise<string> {
    const dateKey = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const prefix = `PB-${dateKey}-`;
    const existing = await this.db
      .select({ batchRef: popsProductionBatches.batchRef })
      .from(popsProductionBatches)
      .where(eq(popsProductionBatches.branchId, branchId));

    let maxSeq = 0;
    for (const row of existing) {
      if (row.batchRef.startsWith(prefix)) {
        const seq = Number.parseInt(row.batchRef.slice(prefix.length), 10);
        if (!Number.isNaN(seq)) maxSeq = Math.max(maxSeq, seq);
      }
    }
    return `${prefix}${String(maxSeq + 1).padStart(2, "0")}`;
  }
}

type PurchaseOrderStatus = "Draft" | "Pending" | "Approved" | "Ordered" | "Partially Received" | "Received" | "Cancelled";
type WasteType = "Expired Items" | "Burnt Food" | "Kitchen Waste" | "Returned Food";
type StockCountType = "Daily" | "Weekly" | "Monthly";
type StockCountStatus = "In Progress" | "Completed" | "Adjusted";
