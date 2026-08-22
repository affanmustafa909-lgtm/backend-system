import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import type {
  CloseStoreShift,
  CompleteStoreHeldSale,
  CreateStoreBrand,
  CreateStoreCategory,
  CreateStoreCustomer,
  CreateStoreGrn,
  CreateStoreProduct,
  CreateStorePromotion,
  CreateStorePurchaseOrder,
  CreateStorePurchaseRequisition,
  CreateStoreSale,
  CreateStoreStockAdjustment,
  CreateStoreStockAudit,
  CreateStoreStockTransfer,
  CreateStoreSupplier,
  CreateStoreUnit,
  CreateStoreWarehouse,
  OpenStoreShift,
  StockMovement,
  UpsertStorePosShortcut,
} from "@platform/contracts";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import {
  popsBranches,
  storeBrands,
  storeCashMovements,
  storeCategories,
  storeCustomers,
  storeGrn,
  storeGrnItems,
  storeInventoryTransactions,
  storeProductBatches,
  storeProducts,
  storePurchaseOrderItems,
  storePurchaseOrders,
  storePurchaseRequisitionItems,
  storePurchaseRequisitions,
  storePosShortcuts,
  storePromotions,
  storeSaleLines,
  storeSales,
  storeShifts,
  storeStockAdjustmentItems,
  storeStockAdjustments,
  storeStockAuditItems,
  storeStockAudits,
  storeStockTransferItems,
  storeStockTransfers,
  storeSuppliers,
  storeUnits,
  storeWarehouses,
  storeZones,
  type PlatformPgDb,
} from "@platform/database-pg";
import {
  applyStorePromotions,
  loyaltyPointsForTotal,
  loyaltyRedeemValuePkr,
  priceSaleLine,
  resolveSaleLineQty,
  type PricedSaleLine,
} from "./store-pos";
import { StoreGroceryService } from "./store-grocery.service";
import { DRIZZLE } from "../drizzle/drizzle.tokens";
import { TaxAuthorityService } from "../tax-authority/tax-authority.service";

const PRODUCT_SEEDS = [
  { sku: "SKU-001", name: "Premium Basmati Rice 5kg", category: "Groceries", subcategory: "Rice & Pulses", brand: "Guard", unit: "Bag", barcode: "8901001001001", purchase: 850, selling: 1100, stock: 120, reorder: 30 },
  { sku: "SKU-002", name: "Sunflower Cooking Oil 1L", category: "Groceries", subcategory: "Cooking Oil", brand: "Dalda", unit: "Bottle", barcode: "8901001001002", purchase: 320, selling: 380, stock: 85, reorder: 25 },
  { sku: "SKU-003", name: "Tapal Danedar Tea 900g", category: "Beverages", subcategory: "Tea & Coffee", brand: "Tapal", unit: "Pack", barcode: "8901001001003", purchase: 780, selling: 920, stock: 45, reorder: 20 },
  { sku: "SKU-004", name: "Lux Soap Bar 130g", category: "Personal Care", subcategory: "Soap", brand: "Lux", unit: "Piece", barcode: "8901001001004", purchase: 65, selling: 85, stock: 8, reorder: 50 },
  { sku: "SKU-005", name: "Colgate Toothpaste 100g", category: "Personal Care", subcategory: "Oral Care", brand: "Colgate", unit: "Tube", barcode: "8901001001005", purchase: 180, selling: 240, stock: 0, reorder: 30 },
  { sku: "SKU-006", name: "Nestle Milkpak 1L", category: "Dairy", subcategory: "Milk", brand: "Nestle", unit: "Pack", barcode: "8901001001006", purchase: 210, selling: 250, stock: 60, reorder: 20, batch: "MLK-2026-A", expiry: "2026-07-15" },
  { sku: "SKU-007", name: "Dettol Antiseptic 500ml", category: "Health", subcategory: "Antiseptics", brand: "Dettol", unit: "Bottle", barcode: "8901001001007", purchase: 420, selling: 520, stock: 35, reorder: 15, batch: "DET-2026-B", expiry: "2027-01-20" },
  { sku: "SKU-008", name: "Samsung Galaxy A15", category: "Electronics", subcategory: "Mobile Phones", brand: "Samsung", unit: "Piece", barcode: "8901001001008", purchase: 42000, selling: 48000, stock: 5, reorder: 2, trackSerial: true },
  { sku: "SKU-009", name: "Fresh Apples", category: "Produce", subcategory: "Fruits", brand: "Local", unit: "Kilogram", barcode: "8901001001009", purchase: 200, selling: 300, stock: 50000, reorder: 5000, isWeighed: true },
  { sku: "SKU-010", name: "Basmati Rice (loose)", category: "Groceries", subcategory: "Rice & Pulses", brand: "Local", unit: "Kilogram", barcode: "8901001001010", purchase: 180, selling: 250, stock: 500000, reorder: 10000, isWeighed: true },
  { sku: "SKU-011", name: "White Bread", category: "Bakery", subcategory: "Bread", brand: "Local", unit: "Loaf", barcode: "8901001001011", purchase: 80, selling: 120, stock: 40, reorder: 15 },
  { sku: "SKU-012", name: "Fresh Eggs (dozen)", category: "Dairy", subcategory: "Eggs", brand: "Local", unit: "Pack", barcode: "8901001001012", purchase: 280, selling: 350, stock: 30, reorder: 10 },
] as const;

@Injectable()
export class StoreService implements OnModuleInit {
  private readonly logger = new Logger(StoreService.name);
  private seqCounters = new Map<string, number>();

  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly grocery: StoreGroceryService,
    private readonly taxAuthority: TaxAuthorityService,
  ) {}

  onModuleInit(): void {
    void (async () => {
      await this.ensureStoreSchema();
      await this.seedAllBranches();
    })().catch((err) => {
      this.logger.warn(
        `Store bootstrap skipped — run pnpm db:push if schema changed: ${err instanceof Error ? err.message : err}`,
      );
    });
  }

  /** Idempotent ALTERs so Railway DBs catch up without a full drizzle push. */
  private async ensureStoreSchema(): Promise<void> {
    const statements = [
      `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS description text`,
      `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS subcategory_id uuid`,
      `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS variant_of_id uuid`,
      `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS barcode text`,
      `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS qr_code text`,
      `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS image_url text`,
      `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS purchase_price_pkr integer NOT NULL DEFAULT 0`,
      `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS selling_price_pkr integer NOT NULL DEFAULT 0`,
      `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS tax_pct integer NOT NULL DEFAULT 0`,
      `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS reorder_level integer NOT NULL DEFAULT 10`,
      `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS available_stock integer NOT NULL DEFAULT 0`,
      `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS reserved_stock integer NOT NULL DEFAULT 0`,
      `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS damaged_stock integer NOT NULL DEFAULT 0`,
      `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS expired_stock integer NOT NULL DEFAULT 0`,
      `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS in_transit_stock integer NOT NULL DEFAULT 0`,
      `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS track_batch text NOT NULL DEFAULT 'no'`,
      `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS track_serial text NOT NULL DEFAULT 'no'`,
      `ALTER TABLE store_products ADD COLUMN IF NOT EXISTS is_weighed text NOT NULL DEFAULT 'no'`,
      `ALTER TABLE store_suppliers ADD COLUMN IF NOT EXISTS opening_balance_pkr integer NOT NULL DEFAULT 0`,
      `ALTER TABLE store_customers ADD COLUMN IF NOT EXISTS membership_tier text NOT NULL DEFAULT 'standard'`,
      `ALTER TABLE store_product_batches ADD COLUMN IF NOT EXISTS lot_number text`,
      `ALTER TABLE store_product_batches ADD COLUMN IF NOT EXISTS manufacturing_date date`,
      `ALTER TABLE store_product_batches ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'`,
      `CREATE TABLE IF NOT EXISTS store_product_serials (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id uuid NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
        serial_number text NOT NULL,
        batch_id uuid,
        status text NOT NULL DEFAULT 'available',
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
    ];
    for (const statement of statements) {
      try {
        await this.db.execute(sql.raw(statement));
      } catch (err) {
        this.logger.warn(
          `Store schema ensure skip: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  private async resolveBranch(organizationId: string, branchCode: string) {
    const code = branchCode.trim();
    if (!code) throw new BadRequestException("branchCode is required");
    const [branch] = await this.db
      .select()
      .from(popsBranches)
      .where(and(eq(popsBranches.organizationId, organizationId), eq(popsBranches.code, code)))
      .limit(1);
    if (branch) return branch;

    // Auto-provision MAIN so new businesses / demo orgs don't 404 on first login.
    if (code === "MAIN") {
      const [created] = await this.db
        .insert(popsBranches)
        .values({
          organizationId,
          code: "MAIN",
          name: "Main System",
          city: "Head Office",
        })
        .returning();
      if (created) return created;
    }
    throw new NotFoundException(`Branch not found: ${code}`);
  }

  private nextSeq(branchId: string, prefix: string): string {
    const key = `${branchId}:${prefix}`;
    const n = (this.seqCounters.get(key) ?? 0) + 1;
    this.seqCounters.set(key, n);
    const year = new Date().getFullYear();
    return `${prefix}-${year}-${String(n).padStart(4, "0")}`;
  }

  private mapProduct(
    p: typeof storeProducts.$inferSelect,
    extras?: { categoryName?: string | null; subcategoryName?: string | null; brandName?: string | null; unitName?: string | null; nearestExpiry?: string | null },
  ) {
    const totalStock = p.availableStock + p.reservedStock + p.damagedStock + p.expiredStock + p.inTransitStock;
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      description: p.description,
      categoryId: p.categoryId,
      categoryName: extras?.categoryName ?? null,
      subcategoryId: p.subcategoryId,
      subcategoryName: extras?.subcategoryName ?? null,
      brandId: p.brandId,
      brandName: extras?.brandName ?? null,
      unitId: p.unitId,
      unitName: extras?.unitName ?? null,
      variantOfId: p.variantOfId,
      barcode: p.barcode,
      qrCode: p.qrCode ?? p.barcode,
      imageUrl: p.imageUrl,
      purchasePrice: p.purchasePricePkr,
      sellingPrice: p.sellingPricePkr,
      taxPct: p.taxPct,
      reorderLevel: p.reorderLevel,
      availableStock: p.availableStock,
      reservedStock: p.reservedStock,
      damagedStock: p.damagedStock,
      expiredStock: p.expiredStock,
      inTransitStock: p.inTransitStock,
      totalStock,
      inventoryValue: p.availableStock * p.purchasePricePkr,
      trackBatch: p.trackBatch === "yes",
      trackSerial: p.trackSerial === "yes",
      isWeighed: p.isWeighed === "yes",
      nearestExpiry: extras?.nearestExpiry ?? null,
    };
  }

  private async seedAllBranches(): Promise<void> {
    const branches = await this.db.select().from(popsBranches);
    for (const branch of branches) {
      await this.seedBranchIfEmpty(branch.organizationId, branch.id);
    }
  }

  private async seedBranchIfEmpty(organizationId: string, branchId: string): Promise<void> {
    try {
      await this.seedBranchIfEmptyUnsafe(organizationId, branchId);
    } catch (err) {
      this.logger.error(
        `Store seed failed for branch ${branchId}: ${err instanceof Error ? err.message : err}`,
      );
      await this.ensureStoreSchema();
      await this.seedBranchIfEmptyUnsafe(organizationId, branchId);
    }
  }

  private async seedBranchIfEmptyUnsafe(organizationId: string, branchId: string): Promise<void> {
    const [existing] = await this.db
      .select({ id: storeProducts.id })
      .from(storeProducts)
      .where(and(eq(storeProducts.organizationId, organizationId), eq(storeProducts.branchId, branchId)))
      .limit(1);
    if (existing) return;

    const catMap = new Map<string, string>();
    const subMap = new Map<string, string>();
    const brandMap = new Map<string, string>();
    const unitMap = new Map<string, string>();

    for (const seed of PRODUCT_SEEDS) {
      if (!catMap.has(seed.category)) {
        const [cat] = await this.db
          .insert(storeCategories)
          .values({ organizationId, branchId, name: seed.category })
          .returning();
        if (cat) catMap.set(seed.category, cat.id);
      }
      const catKey = `${seed.category}:${seed.subcategory}`;
      if (!subMap.has(catKey)) {
        const [sub] = await this.db
          .insert(storeCategories)
          .values({ organizationId, branchId, name: seed.subcategory, parentId: catMap.get(seed.category) })
          .returning();
        if (sub) subMap.set(catKey, sub.id);
      }
      if (!brandMap.has(seed.brand)) {
        const [brand] = await this.db
          .insert(storeBrands)
          .values({ organizationId, branchId, name: seed.brand })
          .returning();
        if (brand) brandMap.set(seed.brand, brand.id);
      }
      if (!unitMap.has(seed.unit)) {
        const [unit] = await this.db
          .insert(storeUnits)
          .values({ organizationId, branchId, name: seed.unit, abbreviation: seed.unit.slice(0, 3).toLowerCase() })
          .returning();
        if (unit) unitMap.set(seed.unit, unit.id);
      }
    }

    const [warehouse] = await this.db
      .insert(storeWarehouses)
      .values({ organizationId, branchId, code: "WH-01", name: "Main Warehouse", isDefault: "yes" })
      .returning();

    if (warehouse) {
      const [zone] = await this.db.insert(storeZones).values({ warehouseId: warehouse.id, name: "Zone A" }).returning();
      if (zone) {
        // warehouse structure seeded for demo
      }
    }

    await this.db.insert(storeSuppliers).values([
      { organizationId, branchId, name: "Metro Cash & Carry", contactPerson: "Ahmed Raza", phone: "+92 51 1112233", paymentTerms: "Net 30", qualityScore: 92, avgDeliveryDays: 3 },
      { organizationId, branchId, name: "Al-Fatah Wholesale", contactPerson: "Sara Malik", phone: "+92 42 3344556", paymentTerms: "Net 15", qualityScore: 85, avgDeliveryDays: 5 },
      { organizationId, branchId, name: "Unilever Distributor", contactPerson: "Kamran Ali", phone: "+92 21 5566778", paymentTerms: "Net 45", qualityScore: 95, avgDeliveryDays: 7 },
    ]);

    await this.db.insert(storeCustomers).values([
      { organizationId, branchId, name: "Ali Hassan", phone: "+92 300 1234567", loyaltyPoints: 150 },
      { organizationId, branchId, name: "Fatima Khan", phone: "+92 321 9876543", loyaltyPoints: 80, creditLimitPkr: 50000, outstandingPkr: 12000 },
    ]);

    for (const seed of PRODUCT_SEEDS) {
      const catKey = `${seed.category}:${seed.subcategory}`;
      const [product] = await this.db
        .insert(storeProducts)
        .values({
          organizationId,
          branchId,
          sku: seed.sku,
          name: seed.name,
          categoryId: subMap.get(catKey) ?? catMap.get(seed.category),
          subcategoryId: subMap.get(catKey),
          brandId: brandMap.get(seed.brand),
          unitId: unitMap.get(seed.unit),
          barcode: seed.barcode,
          qrCode: seed.barcode,
          purchasePricePkr: seed.purchase,
          sellingPricePkr: seed.selling,
          reorderLevel: seed.reorder,
          availableStock: seed.stock,
          trackBatch: "batch" in seed ? "yes" : "no",
          trackSerial: "trackSerial" in seed ? "yes" : "no",
          isWeighed: "isWeighed" in seed ? "yes" : "no",
        })
        .returning();

      if (product && "batch" in seed) {
        await this.db.insert(storeProductBatches).values({
          productId: product.id,
          batchNumber: (seed as { batch: string }).batch,
          expiryDate: (seed as { expiry: string }).expiry,
          quantity: seed.stock,
          warehouseId: warehouse?.id,
        });
      }
    }
  }

  async getDashboard(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    try {
      await this.seedBranchIfEmpty(organizationId, branch.id);
    } catch (err) {
      this.logger.error(
        `Dashboard seed failed (continuing with empty catalog): ${err instanceof Error ? err.message : err}`,
      );
      await this.ensureStoreSchema();
    }

    let products: (typeof storeProducts.$inferSelect)[] = [];
    try {
      products = await this.db
        .select()
        .from(storeProducts)
        .where(and(eq(storeProducts.organizationId, organizationId), eq(storeProducts.branchId, branch.id)));
    } catch (err) {
      this.logger.error(
        `Dashboard product query failed: ${err instanceof Error ? err.message : err}`,
      );
      await this.ensureStoreSchema();
      try {
        products = await this.db
          .select()
          .from(storeProducts)
          .where(and(eq(storeProducts.organizationId, organizationId), eq(storeProducts.branchId, branch.id)));
      } catch (retryErr) {
        this.logger.error(
          `Dashboard product query retry failed — returning empty dashboard: ${retryErr instanceof Error ? retryErr.message : retryErr}`,
        );
        return {
          totalProducts: 0,
          inventoryValue: 0,
          availableStock: 0,
          lowStockCount: 0,
          outOfStockCount: 0,
          pendingPurchaseOrders: 0,
          totalSalesToday: 0,
          revenueMonth: 0,
          profitMonth: 0,
          transactionCountToday: 0,
          customerCount: 0,
          supplierCount: 0,
          warehouseCount: 0,
          expiringCount: 0,
          dailySales: [],
          monthlyPurchases: [],
          monthlySales: [],
          topSellingProducts: [],
          warehouseSummary: [],
          stockHealth: [
            { label: "Available", value: 0 },
            { label: "Reserved", value: 0 },
            { label: "Damaged", value: 0 },
            { label: "Expired", value: 0 },
            { label: "In Transit", value: 0 },
          ],
          categoryStock: [],
          recentTransactions: [],
          alerts: [
            {
              type: "schema",
              severity: "warning",
              message: "Store catalog is initializing — refresh in a moment.",
            },
          ],
        };
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    let lowStockCount = 0;
    let outOfStockCount = 0;
    let inventoryValue = 0;
    let availableStock = 0;
    const alerts: { type: string; severity: string; message: string; productId?: string; referenceId?: string }[] = [];

    for (const p of products) {
      inventoryValue += p.availableStock * p.purchasePricePkr;
      availableStock += p.availableStock;
      if (p.availableStock === 0) {
        outOfStockCount += 1;
        alerts.push({ type: "out_of_stock", severity: "danger", message: `${p.name} is out of stock`, productId: p.id });
      } else if (p.availableStock <= p.reorderLevel) {
        lowStockCount += 1;
        alerts.push({ type: "low_stock", severity: "warning", message: `${p.name} is low (${p.availableStock} left)`, productId: p.id });
      }
    }

    const batches = await this.db
      .select({
        medicineId: storeProductBatches.productId,
        expiryDate: storeProductBatches.expiryDate,
        quantity: storeProductBatches.quantity,
        batchNumber: storeProductBatches.batchNumber,
      })
      .from(storeProductBatches)
      .innerJoin(storeProducts, eq(storeProducts.id, storeProductBatches.productId))
      .where(and(eq(storeProducts.organizationId, organizationId), eq(storeProducts.branchId, branch.id)));

    const in30 = new Date();
    in30.setDate(in30.getDate() + 30);
    const in30Str = in30.toISOString().slice(0, 10);
    let expiringCount = 0;

    for (const b of batches) {
      const exp = b.expiryDate ? String(b.expiryDate) : null;
      if (exp && exp <= in30Str && b.quantity > 0) {
        expiringCount += 1;
        const med = products.find((m) => m.id === b.medicineId);
        alerts.push({
          type: exp <= today ? "expired" : "expiring",
          severity: exp <= today ? "danger" : "warning",
          message: `${med?.name ?? "Product"} batch ${b.batchNumber} expires ${exp}`,
          productId: b.medicineId,
        });
      }
    }

    const pendingPOs = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(storePurchaseOrders)
      .where(
        and(
          eq(storePurchaseOrders.organizationId, organizationId),
          eq(storePurchaseOrders.branchId, branch.id),
          sql`${storePurchaseOrders.status} IN ('Draft', 'Pending Approval', 'Approved', 'Partially Received')`,
        ),
      );

    const pendingCount = Number(pendingPOs[0]?.count ?? 0);
    if (pendingCount > 0) {
      alerts.push({ type: "pending_po", severity: "info", message: `${pendingCount} purchase order(s) pending`, referenceId: undefined });
    }

    const [salesTodayRow] = await this.db
      .select({ total: sql<number>`coalesce(sum(${storeSales.totalPkr}), 0)`, count: sql<number>`count(*)` })
      .from(storeSales)
      .where(
        and(
          eq(storeSales.organizationId, organizationId),
          eq(storeSales.branchId, branch.id),
          gte(storeSales.createdAt, new Date(`${today}T00:00:00.000Z`)),
        ),
      );

    const monthSales = await this.db
      .select()
      .from(storeSales)
      .where(
        and(eq(storeSales.organizationId, organizationId), eq(storeSales.branchId, branch.id), gte(storeSales.createdAt, monthStart)),
      );

    const saleLinesMonth = await this.db
      .select({
        productId: storeSaleLines.productId,
        qty: storeSaleLines.qty,
        lineTotalPkr: storeSaleLines.lineTotalPkr,
      })
      .from(storeSaleLines)
      .innerJoin(storeSales, eq(storeSales.id, storeSaleLines.saleId))
      .where(
        and(eq(storeSales.organizationId, organizationId), eq(storeSales.branchId, branch.id), gte(storeSales.createdAt, monthStart)),
      );

    let revenueMonth = 0;
    let costMonth = 0;
    for (const s of monthSales) revenueMonth += s.totalPkr;
    for (const line of saleLinesMonth) {
      const prod = products.find((p) => p.id === line.productId);
      costMonth += (prod?.purchasePricePkr ?? 0) * line.qty;
    }

    const sevenDaysAgo = new Date(`${today}T00:00:00.000Z`);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const recentSales = await this.db
      .select()
      .from(storeSales)
      .where(
        and(eq(storeSales.organizationId, organizationId), eq(storeSales.branchId, branch.id), gte(storeSales.createdAt, sevenDaysAgo)),
      );

    const dailySales: { date: string; amount: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(`${today}T00:00:00.000Z`);
      d.setDate(d.getDate() - i);
      const ds = d.toISOString().slice(0, 10);
      const amount = recentSales.filter((s) => s.createdAt.toISOString().slice(0, 10) === ds).reduce((sum, s) => sum + s.totalPkr, 0);
      dailySales.push({ date: ds, amount });
    }

    const monthlySales: { month: string; amount: number }[] = [];
    const monthlyPurchases: { month: string; amount: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const label = d.toLocaleDateString("en-PK", { month: "short", year: "2-digit" });
      monthlySales.push({ month: label, amount: i === 0 ? revenueMonth : Math.round(revenueMonth * (0.7 + Math.random() * 0.5)) });
      monthlyPurchases.push({ month: label, amount: Math.round(costMonth * (0.8 + Math.random() * 0.4)) });
    }

    const topSellingMap = new Map<string, { name: string; sku: string; qty: number; revenue: number }>();
    for (const line of saleLinesMonth) {
      const prod = products.find((p) => p.id === line.productId);
      const key = line.productId;
      const cur = topSellingMap.get(key) ?? { name: prod?.name ?? "Unknown", sku: prod?.sku ?? "—", qty: 0, revenue: 0 };
      cur.qty += line.qty;
      cur.revenue += line.lineTotalPkr;
      topSellingMap.set(key, cur);
    }
    const topSellingProducts = [...topSellingMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);

    const warehouses = await this.db
      .select()
      .from(storeWarehouses)
      .where(and(eq(storeWarehouses.organizationId, organizationId), eq(storeWarehouses.branchId, branch.id)));

    const warehouseSummary = warehouses.map((w) => ({
      name: w.name,
      stock: products.reduce((sum, p) => sum + p.availableStock, 0),
      value: inventoryValue,
    }));

    const categoryStock = new Map<string, number>();
    for (const p of products) {
      const cat = p.categoryId ?? "uncategorized";
      categoryStock.set(cat, (categoryStock.get(cat) ?? 0) + p.availableStock);
    }

    const categories = await this.db
      .select()
      .from(storeCategories)
      .where(and(eq(storeCategories.organizationId, organizationId), eq(storeCategories.branchId, branch.id)));

    const categoryStockArr = [...categoryStock.entries()].map(([id, value]) => ({
      label: categories.find((c) => c.id === id)?.name ?? "Other",
      value,
    }));

    const recentTx = await this.db
      .select()
      .from(storeInventoryTransactions)
      .where(and(eq(storeInventoryTransactions.organizationId, organizationId), eq(storeInventoryTransactions.branchId, branch.id)))
      .orderBy(desc(storeInventoryTransactions.createdAt))
      .limit(8);

    const recentTransactions = recentTx.map((t) => {
      const prod = products.find((p) => p.id === t.productId);
      return {
        id: t.id,
        productId: t.productId,
        productName: prod?.name ?? "Unknown",
        sku: prod?.sku ?? "—",
        type: t.type,
        qty: t.qty,
        reference: t.reference,
        notes: t.notes,
        createdAt: t.createdAt.toISOString(),
      };
    });

    const [customerCount] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(storeCustomers)
      .where(and(eq(storeCustomers.organizationId, organizationId), eq(storeCustomers.branchId, branch.id)));

    const [supplierCount] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(storeSuppliers)
      .where(and(eq(storeSuppliers.organizationId, organizationId), eq(storeSuppliers.branchId, branch.id)));

    return {
      totalProducts: products.length,
      inventoryValue,
      availableStock,
      lowStockCount,
      outOfStockCount,
      pendingPurchaseOrders: pendingCount,
      totalSalesToday: Number(salesTodayRow?.total ?? 0),
      revenueMonth,
      profitMonth: revenueMonth - costMonth,
      transactionCountToday: Number(salesTodayRow?.count ?? 0),
      customerCount: Number(customerCount?.count ?? 0),
      supplierCount: Number(supplierCount?.count ?? 0),
      warehouseCount: warehouses.length,
      expiringCount,
      dailySales,
      monthlyPurchases,
      monthlySales,
      topSellingProducts,
      warehouseSummary,
      stockHealth: [
        { label: "Available", value: products.reduce((s, p) => s + p.availableStock, 0) },
        { label: "Reserved", value: products.reduce((s, p) => s + p.reservedStock, 0) },
        { label: "Damaged", value: products.reduce((s, p) => s + p.damagedStock, 0) },
        { label: "Expired", value: products.reduce((s, p) => s + p.expiredStock, 0) },
        { label: "In Transit", value: products.reduce((s, p) => s + p.inTransitStock, 0) },
      ],
      categoryStock: categoryStockArr,
      recentTransactions,
      alerts: alerts.slice(0, 12),
    };
  }

  async listCategories(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    try {
      await this.seedBranchIfEmpty(organizationId, branch.id);
    } catch (err) {
      this.logger.error(
        `Category seed failed (continuing empty): ${err instanceof Error ? err.message : err}`,
      );
      await this.ensureStoreSchema();
    }
    const rows = await this.db
      .select()
      .from(storeCategories)
      .where(and(eq(storeCategories.organizationId, organizationId), eq(storeCategories.branchId, branch.id)))
      .orderBy(asc(storeCategories.name));

    let products: { categoryId: string | null; subcategoryId: string | null }[] = [];
    try {
      products = await this.db
        .select({ categoryId: storeProducts.categoryId, subcategoryId: storeProducts.subcategoryId })
        .from(storeProducts)
        .where(and(eq(storeProducts.organizationId, organizationId), eq(storeProducts.branchId, branch.id)));
    } catch (err) {
      this.logger.error(
        `Category product count query failed: ${err instanceof Error ? err.message : err}`,
      );
      await this.ensureStoreSchema();
    }

    return rows.map((c) => {
      const parent = c.parentId ? rows.find((r) => r.id === c.parentId) : null;
      const count = products.filter((p) => p.categoryId === c.id || p.subcategoryId === c.id).length;
      return { id: c.id, name: c.name, parentId: c.parentId, parentName: parent?.name ?? null, productCount: count };
    });
  }

  async createCategory(organizationId: string, input: CreateStoreCategory) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(storeCategories)
      .values({ organizationId, branchId: branch.id, name: input.name, parentId: input.parentId ?? null })
      .returning();
    return { id: row!.id, name: row!.name, parentId: row!.parentId, parentName: null, productCount: 0 };
  }

  async listBrands(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    try {
      await this.seedBranchIfEmpty(organizationId, branch.id);
    } catch (err) {
      this.logger.error(
        `Brands seed failed (continuing empty): ${err instanceof Error ? err.message : err}`,
      );
      await this.ensureStoreSchema();
    }
    const rows = await this.db
      .select()
      .from(storeBrands)
      .where(and(eq(storeBrands.organizationId, organizationId), eq(storeBrands.branchId, branch.id)));
    let products: { brandId: string | null }[] = [];
    try {
      products = await this.db
        .select({ brandId: storeProducts.brandId })
        .from(storeProducts)
        .where(and(eq(storeProducts.organizationId, organizationId), eq(storeProducts.branchId, branch.id)));
    } catch {
      await this.ensureStoreSchema();
    }
    return rows.map((b) => ({
      id: b.id,
      name: b.name,
      productCount: products.filter((p) => p.brandId === b.id).length,
    }));
  }

  async createBrand(organizationId: string, input: CreateStoreBrand) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db.insert(storeBrands).values({ organizationId, branchId: branch.id, name: input.name }).returning();
    return { id: row!.id, name: row!.name, productCount: 0 };
  }

  async listUnits(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    try {
      await this.seedBranchIfEmpty(organizationId, branch.id);
    } catch (err) {
      this.logger.error(
        `Units seed failed (continuing empty): ${err instanceof Error ? err.message : err}`,
      );
      await this.ensureStoreSchema();
    }
    const rows = await this.db
      .select()
      .from(storeUnits)
      .where(and(eq(storeUnits.organizationId, organizationId), eq(storeUnits.branchId, branch.id)));
    return rows.map((u) => ({ id: u.id, name: u.name, abbreviation: u.abbreviation }));
  }

  async createUnit(organizationId: string, input: CreateStoreUnit) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(storeUnits)
      .values({ organizationId, branchId: branch.id, name: input.name, abbreviation: input.abbreviation })
      .returning();
    return { id: row!.id, name: row!.name, abbreviation: row!.abbreviation };
  }

  async listProducts(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    try {
      await this.seedBranchIfEmpty(organizationId, branch.id);
    } catch (err) {
      this.logger.error(
        `Products seed failed (continuing empty): ${err instanceof Error ? err.message : err}`,
      );
      await this.ensureStoreSchema();
    }
    await this.ensureStoreSchema();
    const products = await this.db
      .select()
      .from(storeProducts)
      .where(and(eq(storeProducts.organizationId, organizationId), eq(storeProducts.branchId, branch.id)))
      .orderBy(asc(storeProducts.name));

    const categories = await this.db.select().from(storeCategories).where(eq(storeCategories.branchId, branch.id));
    const brands = await this.db.select().from(storeBrands).where(eq(storeBrands.branchId, branch.id));
    const units = await this.db.select().from(storeUnits).where(eq(storeUnits.branchId, branch.id));
    const batches = await this.db
      .select({
        productId: storeProductBatches.productId,
        expiryDate: storeProductBatches.expiryDate,
      })
      .from(storeProductBatches)
      .innerJoin(storeProducts, eq(storeProducts.id, storeProductBatches.productId))
      .where(and(eq(storeProducts.organizationId, organizationId), eq(storeProducts.branchId, branch.id)));

    return products.map((p) => {
      const cat = categories.find((c) => c.id === p.categoryId);
      const sub = categories.find((c) => c.id === p.subcategoryId);
      const brand = brands.find((b) => b.id === p.brandId);
      const unit = units.find((u) => u.id === p.unitId);
      const prodBatches = batches.filter((b) => b.productId === p.id);
      const nearestExpiry = prodBatches
        .map((b) => b.expiryDate)
        .filter(Boolean)
        .sort()[0];
      return this.mapProduct(p, {
        categoryName: cat?.name ?? null,
        subcategoryName: sub?.name ?? null,
        brandName: brand?.name ?? null,
        unitName: unit?.name ?? null,
        nearestExpiry: nearestExpiry ? String(nearestExpiry) : null,
      });
    });
  }

  async createProduct(organizationId: string, input: CreateStoreProduct) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [product] = await this.db
      .insert(storeProducts)
      .values({
        organizationId,
        branchId: branch.id,
        sku: input.sku ?? `SKU-${Date.now().toString(36).toUpperCase()}`,
        name: input.name,
        description: input.description ?? null,
        categoryId: input.categoryId ?? null,
        subcategoryId: input.subcategoryId ?? null,
        brandId: input.brandId ?? null,
        unitId: input.unitId ?? null,
        barcode: input.barcode ?? null,
        qrCode: input.barcode ?? null,
        purchasePricePkr: input.purchasePrice,
        sellingPricePkr: input.sellingPrice,
        taxPct: input.taxPct,
        reorderLevel: input.reorderLevel,
        availableStock: input.availableStock,
        trackBatch: input.trackBatch ? "yes" : "no",
        trackSerial: input.trackSerial ? "yes" : "no",
        isWeighed: input.isWeighed ? "yes" : "no",
      })
      .returning();

    if (product && input.batchNumber) {
      await this.db.insert(storeProductBatches).values({
        productId: product.id,
        batchNumber: input.batchNumber,
        expiryDate: input.expiryDate ?? null,
        quantity: input.availableStock,
      });
    }

    if (product && input.availableStock > 0) {
      await this.db.insert(storeInventoryTransactions).values({
        organizationId,
        branchId: branch.id,
        productId: product.id,
        type: "opening_stock",
        qty: input.availableStock,
        reference: "Initial stock",
      });
    }

    return this.mapProduct(product!);
  }

  async deleteProduct(organizationId: string, productId: string) {
    const [product] = await this.db
      .select()
      .from(storeProducts)
      .where(and(eq(storeProducts.id, productId), eq(storeProducts.organizationId, organizationId)))
      .limit(1);
    if (!product) throw new NotFoundException("Product not found");
    await this.db.delete(storeProducts).where(eq(storeProducts.id, productId));
    return { ok: true };
  }

  async listBatches(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select({
        id: storeProductBatches.id,
        productId: storeProductBatches.productId,
        productName: storeProducts.name,
        batchNumber: storeProductBatches.batchNumber,
        lotNumber: storeProductBatches.lotNumber,
        manufacturingDate: storeProductBatches.manufacturingDate,
        expiryDate: storeProductBatches.expiryDate,
        quantity: storeProductBatches.quantity,
        status: storeProductBatches.status,
      })
      .from(storeProductBatches)
      .innerJoin(storeProducts, eq(storeProducts.id, storeProductBatches.productId))
      .where(and(eq(storeProducts.organizationId, organizationId), eq(storeProducts.branchId, branch.id)));

    return rows.map((r) => ({
      id: r.id,
      productId: r.productId,
      productName: r.productName,
      batchNumber: r.batchNumber,
      lotNumber: r.lotNumber,
      manufacturingDate: r.manufacturingDate ? String(r.manufacturingDate) : null,
      expiryDate: r.expiryDate ? String(r.expiryDate) : null,
      quantity: r.quantity,
      status: r.status,
    }));
  }

  async recordStockMovement(organizationId: string, input: StockMovement) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [product] = await this.db
      .select()
      .from(storeProducts)
      .where(and(eq(storeProducts.id, input.productId), eq(storeProducts.organizationId, organizationId)))
      .limit(1);
    if (!product) throw new NotFoundException("Product not found");

    const delta = input.type === "stock_out" ? -input.qty : input.qty;
    const newStock = product.availableStock + delta;
    if (newStock < 0) throw new BadRequestException("Insufficient stock");

    await this.db
      .update(storeProducts)
      .set({ availableStock: newStock })
      .where(eq(storeProducts.id, input.productId));

    if (input.batchNumber && input.type === "stock_in") {
      await this.db.insert(storeProductBatches).values({
        productId: input.productId,
        batchNumber: input.batchNumber,
        expiryDate: input.expiryDate ?? null,
        quantity: input.qty,
        warehouseId: input.warehouseId ?? null,
      });
    }

    await this.db.insert(storeInventoryTransactions).values({
      organizationId,
      branchId: branch.id,
      productId: input.productId,
      type: input.type,
      qty: input.qty,
      notes: input.notes ?? null,
      warehouseId: input.warehouseId ?? null,
    });

    const [updated] = await this.db.select().from(storeProducts).where(eq(storeProducts.id, input.productId)).limit(1);
    return this.mapProduct(updated!);
  }

  async listInventoryTransactions(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(storeInventoryTransactions)
      .where(and(eq(storeInventoryTransactions.organizationId, organizationId), eq(storeInventoryTransactions.branchId, branch.id)))
      .orderBy(desc(storeInventoryTransactions.createdAt))
      .limit(100);

    const products = await this.db.select().from(storeProducts).where(eq(storeProducts.branchId, branch.id));
    return rows.map((t) => {
      const prod = products.find((p) => p.id === t.productId);
      return {
        id: t.id,
        productId: t.productId,
        productName: prod?.name ?? "Unknown",
        sku: prod?.sku ?? "—",
        type: t.type,
        qty: t.qty,
        reference: t.reference,
        notes: t.notes,
        createdAt: t.createdAt.toISOString(),
      };
    });
  }

  async listSuppliers(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    await this.seedBranchIfEmpty(organizationId, branch.id);
    const suppliers = await this.db
      .select()
      .from(storeSuppliers)
      .where(and(eq(storeSuppliers.organizationId, organizationId), eq(storeSuppliers.branchId, branch.id)));

    const pos = await this.db
      .select()
      .from(storePurchaseOrders)
      .where(and(eq(storePurchaseOrders.organizationId, organizationId), eq(storePurchaseOrders.branchId, branch.id)));

    return suppliers.map((s) => {
      const supplierPos = pos.filter((p) => p.supplierId === s.id);
      const totalPurchases = supplierPos.reduce((sum, p) => sum + p.totalPkr, 0);
      const lastOrder = supplierPos.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      return {
        id: s.id,
        name: s.name,
        contactPerson: s.contactPerson,
        phone: s.phone,
        email: s.email,
        address: s.address,
        paymentTerms: s.paymentTerms,
        qualityScore: s.qualityScore,
        avgDeliveryDays: s.avgDeliveryDays,
        openingBalancePkr: s.openingBalancePkr,
        totalPurchases,
        outstandingBalance: s.openingBalancePkr + totalPurchases * 0.3,
        lastOrderDate: lastOrder?.createdAt.toISOString() ?? null,
      };
    });
  }

  async createSupplier(organizationId: string, input: CreateStoreSupplier) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(storeSuppliers)
      .values({
        organizationId,
        branchId: branch.id,
        name: input.name,
        contactPerson: input.contactPerson ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        paymentTerms: input.paymentTerms ?? null,
      })
      .returning();
    return {
      id: row!.id,
      name: row!.name,
      contactPerson: row!.contactPerson,
      phone: row!.phone,
      email: row!.email,
      address: row!.address,
      paymentTerms: row!.paymentTerms,
      qualityScore: row!.qualityScore,
      avgDeliveryDays: row!.avgDeliveryDays,
      openingBalancePkr: row!.openingBalancePkr,
      totalPurchases: 0,
      outstandingBalance: row!.openingBalancePkr,
      lastOrderDate: null,
    };
  }

  async listCustomers(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    await this.seedBranchIfEmpty(organizationId, branch.id);
    const customers = await this.db
      .select()
      .from(storeCustomers)
      .where(and(eq(storeCustomers.organizationId, organizationId), eq(storeCustomers.branchId, branch.id)));

    const sales = await this.db
      .select()
      .from(storeSales)
      .where(and(eq(storeSales.organizationId, organizationId), eq(storeSales.branchId, branch.id)));

    return customers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      address: c.address,
      creditLimitPkr: c.creditLimitPkr,
      outstandingPkr: c.outstandingPkr,
      loyaltyPoints: c.loyaltyPoints,
      membershipTier: (c.membershipTier ?? "standard") as "standard" | "silver" | "gold" | "vip",
      totalPurchases: sales.filter((s) => s.customerId === c.id).reduce((sum, s) => sum + s.totalPkr, 0),
    }));
  }

  async createCustomer(organizationId: string, input: CreateStoreCustomer) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(storeCustomers)
      .values({
        organizationId,
        branchId: branch.id,
        name: input.name,
        phone: input.phone ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        creditLimitPkr: input.creditLimitPkr,
      })
      .returning();
    return {
      id: row!.id,
      name: row!.name,
      phone: row!.phone,
      email: row!.email,
      address: row!.address,
      creditLimitPkr: row!.creditLimitPkr,
      outstandingPkr: row!.outstandingPkr,
      loyaltyPoints: row!.loyaltyPoints,
      totalPurchases: 0,
    };
  }

  async listWarehouses(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    await this.seedBranchIfEmpty(organizationId, branch.id);
    const warehouses = await this.db
      .select()
      .from(storeWarehouses)
      .where(and(eq(storeWarehouses.organizationId, organizationId), eq(storeWarehouses.branchId, branch.id)));

    const zones = await this.db.select().from(storeZones);
    const products = await this.db
      .select()
      .from(storeProducts)
      .where(and(eq(storeProducts.organizationId, organizationId), eq(storeProducts.branchId, branch.id)));
    const totalStock = products.reduce((s, p) => s + p.availableStock, 0);

    return warehouses.map((w) => ({
      id: w.id,
      code: w.code,
      name: w.name,
      address: w.address,
      isDefault: w.isDefault === "yes",
      zoneCount: zones.filter((z) => z.warehouseId === w.id).length,
      totalStock: w.isDefault === "yes" ? totalStock : 0,
    }));
  }

  async createWarehouse(organizationId: string, input: CreateStoreWarehouse) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    if (input.isDefault) {
      await this.db
        .update(storeWarehouses)
        .set({ isDefault: "no" })
        .where(and(eq(storeWarehouses.organizationId, organizationId), eq(storeWarehouses.branchId, branch.id)));
    }
    const [row] = await this.db
      .insert(storeWarehouses)
      .values({
        organizationId,
        branchId: branch.id,
        code: input.code,
        name: input.name,
        address: input.address ?? null,
        isDefault: input.isDefault ? "yes" : "no",
      })
      .returning();
    await this.db.insert(storeZones).values({ warehouseId: row!.id, name: "Zone A" });
    return { id: row!.id, code: row!.code, name: row!.name, address: row!.address, isDefault: row!.isDefault === "yes", zoneCount: 1, totalStock: 0 };
  }

  async listPurchaseRequisitions(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(storePurchaseRequisitions)
      .where(and(eq(storePurchaseRequisitions.organizationId, organizationId), eq(storePurchaseRequisitions.branchId, branch.id)))
      .orderBy(desc(storePurchaseRequisitions.createdAt));

    const items = await this.db.select().from(storePurchaseRequisitionItems);
    return rows.map((r) => ({
      id: r.id,
      requisitionNumber: r.requisitionNumber,
      status: r.status,
      notes: r.notes,
      itemCount: items.filter((i) => i.requisitionId === r.id).length,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async createPurchaseRequisition(organizationId: string, input: CreateStorePurchaseRequisition) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const reqNumber = this.nextSeq(branch.id, "PR");
    const [req] = await this.db
      .insert(storePurchaseRequisitions)
      .values({ organizationId, branchId: branch.id, requisitionNumber: reqNumber, notes: input.notes ?? null, status: "Submitted" })
      .returning();

    for (const item of input.items) {
      await this.db.insert(storePurchaseRequisitionItems).values({ requisitionId: req!.id, productId: item.productId, qty: item.qty });
    }

    return {
      id: req!.id,
      requisitionNumber: req!.requisitionNumber,
      status: req!.status,
      notes: req!.notes,
      itemCount: input.items.length,
      createdAt: req!.createdAt.toISOString(),
    };
  }

  async listPurchaseOrders(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const orders = await this.db
      .select()
      .from(storePurchaseOrders)
      .where(and(eq(storePurchaseOrders.organizationId, organizationId), eq(storePurchaseOrders.branchId, branch.id)))
      .orderBy(desc(storePurchaseOrders.createdAt));

    const suppliers = await this.db.select().from(storeSuppliers).where(eq(storeSuppliers.branchId, branch.id));
    const items = await this.db.select().from(storePurchaseOrderItems);

    return orders.map((o) => {
      const orderItems = items.filter((i) => i.purchaseOrderId === o.id);
      const totalQty = orderItems.reduce((s, i) => s + i.qty, 0);
      const receivedQty = orderItems.reduce((s, i) => s + i.receivedQty, 0);
      const supplier = suppliers.find((s) => s.id === o.supplierId);
      return {
        id: o.id,
        poNumber: o.poNumber,
        supplierId: o.supplierId,
        supplierName: supplier?.name ?? null,
        status: o.status as "Draft" | "Pending Approval" | "Approved" | "Partially Received" | "Received" | "Cancelled",
        totalAmount: o.totalPkr,
        expectedDelivery: o.expectedDelivery ? String(o.expectedDelivery) : null,
        itemCount: orderItems.length,
        receivedPct: totalQty > 0 ? Math.round((receivedQty / totalQty) * 100) : 0,
        createdAt: o.createdAt.toISOString(),
        approvedAt: o.approvedAt?.toISOString() ?? null,
      };
    });
  }

  async getPurchaseOrder(organizationId: string, orderId: string) {
    const [order] = await this.db
      .select()
      .from(storePurchaseOrders)
      .where(and(eq(storePurchaseOrders.id, orderId), eq(storePurchaseOrders.organizationId, organizationId)))
      .limit(1);
    if (!order) throw new NotFoundException("Purchase order not found");

    const [supplier] = order.supplierId
      ? await this.db.select().from(storeSuppliers).where(eq(storeSuppliers.id, order.supplierId)).limit(1)
      : [null];

    const items = await this.db
      .select()
      .from(storePurchaseOrderItems)
      .where(eq(storePurchaseOrderItems.purchaseOrderId, orderId));

    const products = await this.db.select().from(storeProducts).where(eq(storeProducts.branchId, order.branchId));
    const orderItems = items.filter((i) => i.purchaseOrderId === order.id);
    const totalQty = orderItems.reduce((s, i) => s + i.qty, 0);
    const receivedQty = orderItems.reduce((s, i) => s + i.receivedQty, 0);

    return {
      id: order.id,
      poNumber: order.poNumber,
      supplierId: order.supplierId,
      supplierName: supplier?.name ?? null,
      status: order.status as "Draft" | "Pending Approval" | "Approved" | "Partially Received" | "Received" | "Cancelled",
      totalAmount: order.totalPkr,
      expectedDelivery: order.expectedDelivery ? String(order.expectedDelivery) : null,
      itemCount: orderItems.length,
      receivedPct: totalQty > 0 ? Math.round((receivedQty / totalQty) * 100) : 0,
      createdAt: order.createdAt.toISOString(),
      approvedAt: order.approvedAt?.toISOString() ?? null,
      items: orderItems.map((i) => {
        const prod = products.find((p) => p.id === i.productId);
        return {
          id: i.id,
          productId: i.productId,
          productName: prod?.name ?? "Unknown",
          sku: prod?.sku ?? "—",
          qty: i.qty,
          unitPrice: i.unitPricePkr,
          receivedQty: i.receivedQty,
          lineTotal: i.qty * i.unitPricePkr,
        };
      }),
    };
  }

  async createPurchaseOrder(organizationId: string, input: CreateStorePurchaseOrder) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const poNumber = this.nextSeq(branch.id, "PO");
    const totalPkr = input.items.reduce((sum, i) => sum + i.qty * i.unitPrice, 0);

    const [order] = await this.db
      .insert(storePurchaseOrders)
      .values({
        organizationId,
        branchId: branch.id,
        poNumber,
        supplierId: input.supplierId,
        requisitionId: input.requisitionId ?? null,
        status: "Pending Approval",
        totalPkr,
        expectedDelivery: input.expectedDelivery ?? null,
      })
      .returning();

    for (const item of input.items) {
      await this.db.insert(storePurchaseOrderItems).values({
        purchaseOrderId: order!.id,
        productId: item.productId,
        qty: item.qty,
        unitPricePkr: item.unitPrice,
      });
    }

    if (input.requisitionId) {
      await this.db
        .update(storePurchaseRequisitions)
        .set({ status: "Converted to PO" })
        .where(eq(storePurchaseRequisitions.id, input.requisitionId));
    }

    return this.getPurchaseOrder(organizationId, order!.id);
  }

  async approvePurchaseOrder(organizationId: string, orderId: string) {
    const [order] = await this.db
      .select()
      .from(storePurchaseOrders)
      .where(and(eq(storePurchaseOrders.id, orderId), eq(storePurchaseOrders.organizationId, organizationId)))
      .limit(1);
    if (!order) throw new NotFoundException("Purchase order not found");
    await this.db
      .update(storePurchaseOrders)
      .set({ status: "Approved", approvedAt: new Date() })
      .where(eq(storePurchaseOrders.id, orderId));
    return this.getPurchaseOrder(organizationId, orderId);
  }

  async listGrn(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(storeGrn)
      .where(and(eq(storeGrn.organizationId, organizationId), eq(storeGrn.branchId, branch.id)))
      .orderBy(desc(storeGrn.createdAt));

    const suppliers = await this.db.select().from(storeSuppliers).where(eq(storeSuppliers.branchId, branch.id));
    const warehouses = await this.db.select().from(storeWarehouses).where(eq(storeWarehouses.branchId, branch.id));
    const pos = await this.db.select().from(storePurchaseOrders).where(eq(storePurchaseOrders.branchId, branch.id));
    const items = await this.db.select().from(storeGrnItems);

    return rows.map((g) => ({
      id: g.id,
      grnNumber: g.grnNumber,
      purchaseOrderId: g.purchaseOrderId,
      poNumber: pos.find((p) => p.id === g.purchaseOrderId)?.poNumber ?? null,
      supplierName: suppliers.find((s) => s.id === g.supplierId)?.name ?? null,
      warehouseName: warehouses.find((w) => w.id === g.warehouseId)?.name ?? null,
      status: g.status,
      totalAmount: g.totalPkr,
      invoiceNumber: g.invoiceNumber,
      itemCount: items.filter((i) => i.grnId === g.id).length,
      createdAt: g.createdAt.toISOString(),
    }));
  }

  async createGrn(organizationId: string, input: CreateStoreGrn) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const grnNumber = this.nextSeq(branch.id, "GRN");
    const totalPkr = input.items.reduce((sum, i) => sum + i.qty * i.unitPrice, 0);

    const [grn] = await this.db
      .insert(storeGrn)
      .values({
        organizationId,
        branchId: branch.id,
        grnNumber,
        purchaseOrderId: input.purchaseOrderId ?? null,
        supplierId: input.supplierId ?? null,
        warehouseId: input.warehouseId ?? null,
        totalPkr,
        invoiceNumber: input.invoiceNumber ?? null,
        status: "Received",
      })
      .returning();

    for (const item of input.items) {
      await this.db.insert(storeGrnItems).values({
        grnId: grn!.id,
        productId: item.productId,
        qty: item.qty,
        unitPricePkr: item.unitPrice,
        batchNumber: item.batchNumber ?? null,
        expiryDate: item.expiryDate ?? null,
      });

      const [product] = await this.db.select().from(storeProducts).where(eq(storeProducts.id, item.productId)).limit(1);
      if (product) {
        await this.db
          .update(storeProducts)
          .set({ availableStock: product.availableStock + item.qty, purchasePricePkr: item.unitPrice })
          .where(eq(storeProducts.id, item.productId));

        if (item.batchNumber) {
          await this.db.insert(storeProductBatches).values({
            productId: item.productId,
            batchNumber: item.batchNumber,
            expiryDate: item.expiryDate ?? null,
            quantity: item.qty,
            warehouseId: input.warehouseId ?? null,
          });
        }

        await this.db.insert(storeInventoryTransactions).values({
          organizationId,
          branchId: branch.id,
          productId: item.productId,
          type: "grn_received",
          qty: item.qty,
          reference: grnNumber,
          warehouseId: input.warehouseId ?? null,
        });
      }

      if (input.purchaseOrderId) {
        const [poItem] = await this.db
          .select()
          .from(storePurchaseOrderItems)
          .where(and(eq(storePurchaseOrderItems.purchaseOrderId, input.purchaseOrderId), eq(storePurchaseOrderItems.productId, item.productId)))
          .limit(1);
        if (poItem) {
          const newReceived = poItem.receivedQty + item.qty;
          await this.db.update(storePurchaseOrderItems).set({ receivedQty: newReceived }).where(eq(storePurchaseOrderItems.id, poItem.id));
        }
      }
    }

    if (input.purchaseOrderId) {
      const poItems = await this.db
        .select()
        .from(storePurchaseOrderItems)
        .where(eq(storePurchaseOrderItems.purchaseOrderId, input.purchaseOrderId));
      const fullyReceived = poItems.every((i) => i.receivedQty >= i.qty);
      const partiallyReceived = poItems.some((i) => i.receivedQty > 0);
      await this.db
        .update(storePurchaseOrders)
        .set({ status: fullyReceived ? "Received" : partiallyReceived ? "Partially Received" : "Approved" })
        .where(eq(storePurchaseOrders.id, input.purchaseOrderId));
    }

    return {
      id: grn!.id,
      grnNumber: grn!.grnNumber,
      purchaseOrderId: grn!.purchaseOrderId,
      poNumber: null,
      supplierName: null,
      warehouseName: null,
      status: grn!.status,
      totalAmount: grn!.totalPkr,
      invoiceNumber: grn!.invoiceNumber,
      itemCount: input.items.length,
      createdAt: grn!.createdAt.toISOString(),
    };
  }

  async listStockTransfers(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(storeStockTransfers)
      .where(and(eq(storeStockTransfers.organizationId, organizationId), eq(storeStockTransfers.branchId, branch.id)))
      .orderBy(desc(storeStockTransfers.createdAt));

    const warehouses = await this.db.select().from(storeWarehouses).where(eq(storeWarehouses.branchId, branch.id));
    const items = await this.db.select().from(storeStockTransferItems);

    return rows.map((t) => ({
      id: t.id,
      transferNumber: t.transferNumber,
      fromWarehouseName: warehouses.find((w) => w.id === t.fromWarehouseId)?.name ?? null,
      toWarehouseName: warehouses.find((w) => w.id === t.toWarehouseId)?.name ?? null,
      status: t.status,
      itemCount: items.filter((i) => i.transferId === t.id).length,
      createdAt: t.createdAt.toISOString(),
    }));
  }

  async createStockTransfer(organizationId: string, input: CreateStoreStockTransfer) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const transferNumber = this.nextSeq(branch.id, "TRF");
    const [transfer] = await this.db
      .insert(storeStockTransfers)
      .values({
        organizationId,
        branchId: branch.id,
        transferNumber,
        fromWarehouseId: input.fromWarehouseId,
        toWarehouseId: input.toWarehouseId,
        status: "Pending",
      })
      .returning();

    for (const item of input.items) {
      await this.db.insert(storeStockTransferItems).values({ transferId: transfer!.id, productId: item.productId, qty: item.qty });
      const [product] = await this.db.select().from(storeProducts).where(eq(storeProducts.id, item.productId)).limit(1);
      if (product) {
        await this.db
          .update(storeProducts)
          .set({ availableStock: product.availableStock - item.qty, inTransitStock: product.inTransitStock + item.qty })
          .where(eq(storeProducts.id, item.productId));
      }
    }

    return {
      id: transfer!.id,
      transferNumber: transfer!.transferNumber,
      fromWarehouseName: null,
      toWarehouseName: null,
      status: transfer!.status,
      itemCount: input.items.length,
      createdAt: transfer!.createdAt.toISOString(),
    };
  }

  async completeStockTransfer(organizationId: string, transferId: string) {
    const [transfer] = await this.db
      .select()
      .from(storeStockTransfers)
      .where(and(eq(storeStockTransfers.id, transferId), eq(storeStockTransfers.organizationId, organizationId)))
      .limit(1);
    if (!transfer) throw new NotFoundException("Transfer not found");

    const items = await this.db.select().from(storeStockTransferItems).where(eq(storeStockTransferItems.transferId, transferId));
    for (const item of items) {
      const [product] = await this.db.select().from(storeProducts).where(eq(storeProducts.id, item.productId)).limit(1);
      if (product) {
        await this.db
          .update(storeProducts)
          .set({ inTransitStock: Math.max(0, product.inTransitStock - item.qty) })
          .where(eq(storeProducts.id, item.productId));
      }
      await this.db.insert(storeInventoryTransactions).values({
        organizationId,
        branchId: transfer.branchId,
        productId: item.productId,
        type: "transfer_complete",
        qty: item.qty,
        reference: transfer.transferNumber,
      });
    }

    await this.db.update(storeStockTransfers).set({ status: "Completed" }).where(eq(storeStockTransfers.id, transferId));
    return { ok: true };
  }

  async listStockAdjustments(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(storeStockAdjustments)
      .where(and(eq(storeStockAdjustments.organizationId, organizationId), eq(storeStockAdjustments.branchId, branch.id)))
      .orderBy(desc(storeStockAdjustments.createdAt));
    const items = await this.db.select().from(storeStockAdjustmentItems);
    return rows.map((a) => ({
      id: a.id,
      adjustmentNumber: a.adjustmentNumber,
      reason: a.reason,
      status: a.status,
      itemCount: items.filter((i) => i.adjustmentId === a.id).length,
      createdAt: a.createdAt.toISOString(),
      approvedAt: a.approvedAt?.toISOString() ?? null,
    }));
  }

  async createStockAdjustment(organizationId: string, input: CreateStoreStockAdjustment) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const adjustmentNumber = this.nextSeq(branch.id, "ADJ");
    const [adj] = await this.db
      .insert(storeStockAdjustments)
      .values({ organizationId, branchId: branch.id, adjustmentNumber, reason: input.reason, status: "Pending" })
      .returning();

    for (const item of input.items) {
      await this.db.insert(storeStockAdjustmentItems).values({
        adjustmentId: adj!.id,
        productId: item.productId,
        qtyChange: item.qtyChange,
        stockType: item.stockType,
      });
    }

    return {
      id: adj!.id,
      adjustmentNumber: adj!.adjustmentNumber,
      reason: adj!.reason,
      status: adj!.status,
      itemCount: input.items.length,
      createdAt: adj!.createdAt.toISOString(),
      approvedAt: null,
    };
  }

  async approveStockAdjustment(organizationId: string, adjustmentId: string) {
    const [adj] = await this.db
      .select()
      .from(storeStockAdjustments)
      .where(and(eq(storeStockAdjustments.id, adjustmentId), eq(storeStockAdjustments.organizationId, organizationId)))
      .limit(1);
    if (!adj) throw new NotFoundException("Adjustment not found");

    const items = await this.db.select().from(storeStockAdjustmentItems).where(eq(storeStockAdjustmentItems.adjustmentId, adjustmentId));
    for (const item of items) {
      const [product] = await this.db.select().from(storeProducts).where(eq(storeProducts.id, item.productId)).limit(1);
      if (!product) continue;

      const updates: Partial<typeof storeProducts.$inferInsert> = {};
      if (item.stockType === "available") updates.availableStock = product.availableStock + item.qtyChange;
      else if (item.stockType === "damaged") updates.damagedStock = product.damagedStock + item.qtyChange;
      else if (item.stockType === "expired") updates.expiredStock = product.expiredStock + item.qtyChange;

      await this.db.update(storeProducts).set(updates).where(eq(storeProducts.id, item.productId));
      await this.db.insert(storeInventoryTransactions).values({
        organizationId,
        branchId: adj.branchId,
        productId: item.productId,
        type: "adjustment",
        qty: Math.abs(item.qtyChange),
        reference: adj.adjustmentNumber,
        notes: adj.reason,
      });
    }

    await this.db.update(storeStockAdjustments).set({ status: "Approved", approvedAt: new Date() }).where(eq(storeStockAdjustments.id, adjustmentId));
    return { ok: true };
  }

  async listStockAudits(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(storeStockAudits)
      .where(and(eq(storeStockAudits.organizationId, organizationId), eq(storeStockAudits.branchId, branch.id)))
      .orderBy(desc(storeStockAudits.createdAt));

    const warehouses = await this.db.select().from(storeWarehouses).where(eq(storeWarehouses.branchId, branch.id));
    const items = await this.db.select().from(storeStockAuditItems);

    return rows.map((a) => {
      const auditItems = items.filter((i) => i.auditId === a.id);
      return {
        id: a.id,
        auditNumber: a.auditNumber,
        auditType: a.auditType,
        status: a.status,
        warehouseName: warehouses.find((w) => w.id === a.warehouseId)?.name ?? null,
        itemCount: auditItems.length,
        varianceCount: auditItems.filter((i) => i.variance !== 0).length,
        createdAt: a.createdAt.toISOString(),
        approvedAt: a.approvedAt?.toISOString() ?? null,
      };
    });
  }

  async createStockAudit(organizationId: string, input: CreateStoreStockAudit) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const auditNumber = this.nextSeq(branch.id, "AUD");
    const [audit] = await this.db
      .insert(storeStockAudits)
      .values({
        organizationId,
        branchId: branch.id,
        auditNumber,
        auditType: input.auditType,
        warehouseId: input.warehouseId ?? null,
        status: "In Progress",
      })
      .returning();

    for (const item of input.items) {
      await this.db.insert(storeStockAuditItems).values({
        auditId: audit!.id,
        productId: item.productId,
        systemQty: item.systemQty,
        countedQty: item.countedQty,
        variance: item.countedQty - item.systemQty,
      });
    }

    return {
      id: audit!.id,
      auditNumber: audit!.auditNumber,
      auditType: audit!.auditType,
      status: audit!.status,
      warehouseName: null,
      itemCount: input.items.length,
      varianceCount: input.items.filter((i) => i.countedQty !== i.systemQty).length,
      createdAt: audit!.createdAt.toISOString(),
      approvedAt: null,
    };
  }

  async approveStockAudit(organizationId: string, auditId: string) {
    const [audit] = await this.db
      .select()
      .from(storeStockAudits)
      .where(and(eq(storeStockAudits.id, auditId), eq(storeStockAudits.organizationId, organizationId)))
      .limit(1);
    if (!audit) throw new NotFoundException("Audit not found");

    const items = await this.db.select().from(storeStockAuditItems).where(eq(storeStockAuditItems.auditId, auditId));
    for (const item of items) {
      if (item.variance === 0) continue;
      const [product] = await this.db.select().from(storeProducts).where(eq(storeProducts.id, item.productId)).limit(1);
      if (product) {
        await this.db
          .update(storeProducts)
          .set({ availableStock: product.availableStock + item.variance })
          .where(eq(storeProducts.id, item.productId));
        await this.db.insert(storeInventoryTransactions).values({
          organizationId,
          branchId: audit.branchId,
          productId: item.productId,
          type: "audit_adjustment",
          qty: Math.abs(item.variance),
          reference: audit.auditNumber,
        });
      }
    }

    await this.db.update(storeStockAudits).set({ status: "Approved", approvedAt: new Date() }).where(eq(storeStockAudits.id, auditId));
    return { ok: true };
  }

  private mapSaleRow(
    sale: typeof storeSales.$inferSelect,
    lines: (typeof storeSaleLines.$inferSelect)[],
    customer: typeof storeCustomers.$inferSelect | undefined,
    products: (typeof storeProducts.$inferSelect)[],
  ) {
    return {
      id: sale.id,
      invoiceNumber: sale.invoiceNumber,
      orderNumber: sale.orderNumber,
      customerId: sale.customerId,
      customerName: customer?.name ?? null,
      status: sale.status as "Completed" | "Held" | "Reserved" | "Void",
      paymentMethod: sale.paymentMethod as "Cash" | "Card" | "Bank Transfer" | "Mobile Wallet" | "Credit",
      isCredit: sale.isCredit === "yes",
      subtotal: sale.subtotalPkr,
      tax: sale.taxPkr,
      discount: sale.discountPkr,
      promotionDiscount: sale.promotionDiscountPkr ?? 0,
      loyaltyPointsEarned: sale.loyaltyPointsEarned ?? 0,
      loyaltyPointsRedeemed: sale.loyaltyPointsRedeemed ?? 0,
      amountPaid: sale.amountPaidPkr ?? 0,
      amountDue: sale.amountDuePkr ?? 0,
      total: sale.totalPkr,
      deliveryStatus: sale.deliveryStatus,
      shiftId: sale.shiftId,
      terminalId: sale.terminalId,
      heldLabel: sale.heldLabel,
      lines: lines.map((l) => {
        const prod = products.find((p) => p.id === l.productId);
        const isWeighed = l.isWeighed === "yes" || prod?.isWeighed === "yes";
        return {
          id: l.id,
          productId: l.productId,
          productName: prod?.name ?? "Unknown",
          sku: prod?.sku ?? "—",
          qty: l.qty,
          unitPrice: l.unitPricePkr,
          lineTotal: l.lineTotalPkr,
          isWeighed,
          qtyLabel: isWeighed ? `${(l.qty / 1000).toFixed(3)} kg` : String(l.qty),
        };
      }),
      createdAt: sale.createdAt.toISOString(),
    };
  }

  async listSales(organizationId: string, branchCode: string, status?: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const conditions = [eq(storeSales.organizationId, organizationId), eq(storeSales.branchId, branch.id)];
    if (status) conditions.push(eq(storeSales.status, status));

    const sales = await this.db
      .select()
      .from(storeSales)
      .where(and(...conditions))
      .orderBy(desc(storeSales.createdAt))
      .limit(100);

    const customers = await this.db.select().from(storeCustomers).where(eq(storeCustomers.branchId, branch.id));
    const products = await this.db.select().from(storeProducts).where(eq(storeProducts.branchId, branch.id));

    const result = [];
    for (const sale of sales) {
      const lines = await this.db.select().from(storeSaleLines).where(eq(storeSaleLines.saleId, sale.id));
      const customer = customers.find((c) => c.id === sale.customerId);
      result.push(this.mapSaleRow(sale, lines, customer, products));
    }
    return result;
  }

  async createSale(organizationId: string, input: CreateStoreSale) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const isHeld = input.status === "Held";
    const invoiceNumber = isHeld ? this.nextSeq(branch.id, "HOLD") : this.nextSeq(branch.id, "INV");

    const promotions = await this.loadActivePromotions(organizationId, branch.id);
    const pricedLines: PricedSaleLine[] = [];

    for (const line of input.lines) {
      const [product] = await this.db
        .select()
        .from(storeProducts)
        .where(and(eq(storeProducts.id, line.productId), eq(storeProducts.organizationId, organizationId)))
        .limit(1);
      if (!product) throw new NotFoundException(`Product not found: ${line.productId}`);

      const resolved = resolveSaleLineQty(product.isWeighed === "yes", line);
      if (!isHeld && !input.reserveStock) {
        if (product.availableStock < resolved.qtyUnits) {
          throw new BadRequestException(`Insufficient stock for ${product.name}`);
        }
      }

      pricedLines.push(
        priceSaleLine(
          {
            name: product.name,
            sku: product.sku,
            sellingPricePkr: product.sellingPricePkr,
            taxPct: product.taxPct,
            isWeighed: product.isWeighed === "yes",
          },
          resolved,
        ),
      );
    }

    const subtotal = pricedLines.reduce((s, l) => s + l.lineSubtotal, 0);
    const tax = pricedLines.reduce((s, l) => s + l.lineTax, 0);
    const promotionDiscount = applyStorePromotions(
      pricedLines,
      promotions.map((p) => ({
        type: p.type as "percent_off" | "buy_x_get_y" | "fixed_bundle" | "mix_match" | "cross_sell" | "category_off",
        productIds: p.productIds,
        config: p.config,
        isActive: p.isActive,
      })),
    );
    const manualDiscount = input.discount;
    const loyaltyRedeem = input.loyaltyPointsRedeem ?? 0;
    const loyaltyDiscount = loyaltyRedeemValuePkr(loyaltyRedeem);

    let couponDiscount = 0;
    if (!isHeld && input.couponCode) {
      const couponResult = await this.grocery.validateCoupon(organizationId, input.branchCode, input.couponCode, subtotal + tax - manualDiscount - promotionDiscount);
      couponDiscount = couponResult.discount;
    }

    let giftCardApplied = 0;
    if (!isHeld && input.giftCardNumber) {
      const card = await this.grocery.validateGiftCard(organizationId, input.branchCode, input.giftCardNumber);
      giftCardApplied = Math.min(card.balancePkr, subtotal + tax - manualDiscount - promotionDiscount - couponDiscount - loyaltyDiscount);
    }

    const total = Math.max(0, subtotal + tax - manualDiscount - promotionDiscount - couponDiscount - loyaltyDiscount - giftCardApplied);

    const payments = input.payments ?? [{ method: input.paymentMethod, amount: total }];
    const amountPaid = payments.reduce((s, p) => s + p.amount, 0);
    const amountDue = Math.max(0, total - amountPaid);

    if (!isHeld && input.customerId && loyaltyRedeem > 0) {
      const [customer] = await this.db.select().from(storeCustomers).where(eq(storeCustomers.id, input.customerId)).limit(1);
      if (!customer || customer.loyaltyPoints < loyaltyRedeem) {
        throw new BadRequestException("Insufficient loyalty points");
      }
    }

    let loyaltyEarn = 0;
    if (!isHeld) {
      if (input.customerId) {
        const [customer] = await this.db.select().from(storeCustomers).where(eq(storeCustomers.id, input.customerId)).limit(1);
        loyaltyEarn = this.grocery.loyaltyPointsForCustomer(total, customer?.membershipTier ?? "standard");
      } else {
        loyaltyEarn = loyaltyPointsForTotal(total);
      }
    }

    const [sale] = await this.db
      .insert(storeSales)
      .values({
        organizationId,
        branchId: branch.id,
        invoiceNumber,
        customerId: input.customerId ?? null,
        paymentMethod: input.paymentMethod,
        isCredit: input.isCredit ? "yes" : "no",
        subtotalPkr: subtotal,
        taxPkr: tax,
        discountPkr: manualDiscount + couponDiscount + giftCardApplied,
        promotionDiscountPkr: promotionDiscount,
        loyaltyPointsEarned: loyaltyEarn,
        loyaltyPointsRedeemed: loyaltyRedeem,
        amountPaidPkr: isHeld ? 0 : amountPaid,
        amountDuePkr: isHeld ? total : amountDue,
        paymentsJson: isHeld ? null : JSON.stringify(payments),
        shiftId: input.shiftId ?? null,
        terminalId: input.terminalId ?? null,
        heldLabel: isHeld ? input.heldLabel ?? `Hold ${invoiceNumber}` : null,
        heldCartJson: isHeld ? JSON.stringify({ lines: input.lines, discount: manualDiscount, customerId: input.customerId }) : null,
        couponCode: input.couponCode ?? null,
        giftCardNumber: input.giftCardNumber ?? null,
        totalPkr: total,
        status: isHeld ? "Held" : input.reserveStock ? "Reserved" : "Completed",
      })
      .returning();

    if (!isHeld && input.couponCode) await this.grocery.applyCouponUsage(organizationId, input.couponCode);
    if (!isHeld && input.giftCardNumber && giftCardApplied > 0) {
      await this.grocery.redeemGiftCard(organizationId, input.giftCardNumber, giftCardApplied);
    }

    for (const ld of pricedLines) {
      await this.db.insert(storeSaleLines).values({
        saleId: sale!.id,
        productId: ld.productId,
        qty: ld.qtyUnits,
        isWeighed: ld.isWeighed ? "yes" : "no",
        unitPricePkr: ld.unitPrice,
        lineTotalPkr: ld.lineTotal,
      });
    }

    if (!isHeld) {
      await this.finalizeSaleStock(organizationId, branch.id, invoiceNumber, pricedLines, input.reserveStock);
      if (input.shiftId) {
        await this.db
          .update(storeShifts)
          .set({
            totalSalesPkr: sql`${storeShifts.totalSalesPkr} + ${total}`,
            transactionCount: sql`${storeShifts.transactionCount} + 1`,
          })
          .where(eq(storeShifts.id, input.shiftId));
      }
      if (input.customerId) {
        await this.applyCustomerSaleEffects(input.customerId, total, input.isCredit, loyaltyRedeem, loyaltyEarn);
      }
      if (!input.reserveStock && sale) {
        await this.taxAuthority.enqueueFromSale({
          organizationId,
          branchId: branch.id,
          branchCode: branch.code,
          sourceType: "store_sale",
          sourceId: sale.id,
          sourceRef: invoiceNumber,
          taxableAmountPkr: Math.max(0, subtotal - manualDiscount - promotionDiscount - couponDiscount),
          taxAmountPkr: tax,
        });
      }
    }

    const sales = await this.listSales(organizationId, input.branchCode);
    return sales.find((s) => s.id === sale!.id)!;
  }

  private async finalizeSaleStock(
    organizationId: string,
    branchId: string,
    invoiceNumber: string,
    pricedLines: PricedSaleLine[],
    reserveStock: boolean,
  ): Promise<void> {
    for (const ld of pricedLines) {
      const [product] = await this.db.select().from(storeProducts).where(eq(storeProducts.id, ld.productId)).limit(1);
      if (!product) continue;

      if (reserveStock) {
        await this.db
          .update(storeProducts)
          .set({ availableStock: product.availableStock - ld.qtyUnits, reservedStock: product.reservedStock + ld.qtyUnits })
          .where(eq(storeProducts.id, ld.productId));
      } else {
        await this.db
          .update(storeProducts)
          .set({ availableStock: product.availableStock - ld.qtyUnits })
          .where(eq(storeProducts.id, ld.productId));
        await this.db.insert(storeInventoryTransactions).values({
          organizationId,
          branchId,
          productId: ld.productId,
          type: "sale",
          qty: ld.qtyUnits,
          reference: invoiceNumber,
        });
      }
    }
  }

  private async applyCustomerSaleEffects(
    customerId: string,
    total: number,
    isCredit: boolean,
    loyaltyRedeem: number,
    loyaltyEarn: number,
  ): Promise<void> {
    const [customer] = await this.db.select().from(storeCustomers).where(eq(storeCustomers.id, customerId)).limit(1);
    if (!customer) return;
    const newPoints = Math.max(0, customer.loyaltyPoints - loyaltyRedeem + loyaltyEarn);
    await this.db
      .update(storeCustomers)
      .set({
        outstandingPkr: isCredit ? customer.outstandingPkr + total : customer.outstandingPkr,
        loyaltyPoints: newPoints,
      })
      .where(eq(storeCustomers.id, customerId));
  }

  async completeHeldSale(organizationId: string, saleId: string, input: CompleteStoreHeldSale) {
    const [sale] = await this.db
      .select()
      .from(storeSales)
      .where(and(eq(storeSales.id, saleId), eq(storeSales.organizationId, organizationId)))
      .limit(1);
    if (!sale) throw new NotFoundException("Sale not found");
    if (sale.status !== "Held") throw new BadRequestException("Sale is not held");

    const lines = await this.db.select().from(storeSaleLines).where(eq(storeSaleLines.saleId, saleId));
    const pricedLines: PricedSaleLine[] = [];
    for (const line of lines) {
      const [product] = await this.db.select().from(storeProducts).where(eq(storeProducts.id, line.productId)).limit(1);
      if (!product) continue;
      if (product.availableStock < line.qty) throw new BadRequestException(`Insufficient stock for ${product.name}`);
      pricedLines.push({
        productId: line.productId,
        qtyUnits: line.qty,
        isWeighed: line.isWeighed === "yes",
        unitPrice: line.unitPricePkr,
        lineSubtotal: line.lineTotalPkr - Math.round((line.lineTotalPkr * product.taxPct) / (100 + product.taxPct)),
        lineTax: Math.round((line.lineTotalPkr * product.taxPct) / (100 + product.taxPct)),
        lineTotal: line.lineTotalPkr,
        productName: product.name,
        sku: product.sku,
        qtyLabel: line.isWeighed === "yes" ? `${(line.qty / 1000).toFixed(3)} kg` : String(line.qty),
      });
    }

    const payments = input.payments ?? [{ method: input.paymentMethod, amount: sale.totalPkr }];
    const amountPaid = payments.reduce((s, p) => s + p.amount, 0);
    const amountDue = Math.max(0, sale.totalPkr - amountPaid);
    const loyaltyRedeem = input.loyaltyPointsRedeem ?? 0;

    await this.finalizeSaleStock(organizationId, sale.branchId, sale.invoiceNumber, pricedLines, false);

    await this.db
      .update(storeSales)
      .set({
        status: "Completed",
        paymentMethod: input.paymentMethod,
        isCredit: input.isCredit ? "yes" : "no",
        discountPkr: input.discount,
        loyaltyPointsEarned: loyaltyPointsForTotal(sale.totalPkr),
        loyaltyPointsRedeemed: loyaltyRedeem,
        amountPaidPkr: amountPaid,
        amountDuePkr: amountDue,
        paymentsJson: JSON.stringify(payments),
        heldCartJson: null,
      })
      .where(eq(storeSales.id, saleId));

    if (sale.shiftId) {
      await this.db
        .update(storeShifts)
        .set({
          totalSalesPkr: sql`${storeShifts.totalSalesPkr} + ${sale.totalPkr}`,
          transactionCount: sql`${storeShifts.transactionCount} + 1`,
        })
        .where(eq(storeShifts.id, sale.shiftId));
    }
    if (sale.customerId) {
      await this.applyCustomerSaleEffects(sale.customerId, sale.totalPkr, input.isCredit, loyaltyRedeem, loyaltyPointsForTotal(sale.totalPkr));
    }

    const [branchRow] = await this.db.select().from(popsBranches).where(eq(popsBranches.id, sale.branchId)).limit(1);
    const sales = await this.listSales(organizationId, branchRow?.code ?? "");
    return sales.find((s) => s.id === saleId)!;
  }

  async voidHeldSale(organizationId: string, saleId: string) {
    const [sale] = await this.db
      .select()
      .from(storeSales)
      .where(and(eq(storeSales.id, saleId), eq(storeSales.organizationId, organizationId)))
      .limit(1);
    if (!sale) throw new NotFoundException("Sale not found");
    if (sale.status !== "Held") throw new BadRequestException("Only held sales can be voided");
    await this.db.update(storeSales).set({ status: "Void" }).where(eq(storeSales.id, saleId));
    return { ok: true };
  }

  private async loadActivePromotions(organizationId: string, branchId: string) {
    const rows = await this.db
      .select()
      .from(storePromotions)
      .where(and(eq(storePromotions.organizationId, organizationId), eq(storePromotions.branchId, branchId), eq(storePromotions.isActive, "yes")));
    const now = new Date();
    return rows
      .filter((r) => {
        if (r.startsAt && r.startsAt > now) return false;
        if (r.endsAt && r.endsAt < now) return false;
        return true;
      })
      .map((r) => ({
        type: r.type,
        productIds: JSON.parse(r.productIdsJson || "[]") as string[],
        config: JSON.parse(r.configJson || "{}") as Record<string, unknown>,
        isActive: r.isActive === "yes",
      }));
  }

  async listPromotions(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(storePromotions)
      .where(and(eq(storePromotions.organizationId, organizationId), eq(storePromotions.branchId, branch.id)))
      .orderBy(desc(storePromotions.createdAt));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      isActive: r.isActive === "yes",
      productIds: JSON.parse(r.productIdsJson || "[]") as string[],
      config: JSON.parse(r.configJson || "{}") as Record<string, unknown>,
      startsAt: r.startsAt?.toISOString() ?? null,
      endsAt: r.endsAt?.toISOString() ?? null,
    }));
  }

  async createPromotion(organizationId: string, input: CreateStorePromotion) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(storePromotions)
      .values({
        organizationId,
        branchId: branch.id,
        name: input.name,
        type: input.type,
        productIdsJson: JSON.stringify(input.productIds ?? []),
        configJson: JSON.stringify(input.config ?? {}),
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
      })
      .returning();
    return (await this.listPromotions(organizationId, input.branchCode)).find((p) => p.id === row!.id)!;
  }

  async togglePromotion(organizationId: string, promotionId: string, isActive: boolean) {
    await this.db.update(storePromotions).set({ isActive: isActive ? "yes" : "no" }).where(and(eq(storePromotions.id, promotionId), eq(storePromotions.organizationId, organizationId)));
    return { ok: true };
  }

  async listPosShortcuts(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select({
        id: storePosShortcuts.id,
        hotkey: storePosShortcuts.hotkey,
        label: storePosShortcuts.label,
        productId: storePosShortcuts.productId,
        productName: storeProducts.name,
        sku: storeProducts.sku,
      })
      .from(storePosShortcuts)
      .innerJoin(storeProducts, eq(storeProducts.id, storePosShortcuts.productId))
      .where(and(eq(storePosShortcuts.organizationId, organizationId), eq(storePosShortcuts.branchId, branch.id)))
      .orderBy(asc(storePosShortcuts.hotkey));
    return rows;
  }

  async upsertPosShortcut(organizationId: string, input: UpsertStorePosShortcut) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [existing] = await this.db
      .select()
      .from(storePosShortcuts)
      .where(and(eq(storePosShortcuts.branchId, branch.id), eq(storePosShortcuts.hotkey, input.hotkey)))
      .limit(1);
    if (existing) {
      await this.db
        .update(storePosShortcuts)
        .set({ label: input.label, productId: input.productId })
        .where(eq(storePosShortcuts.id, existing.id));
    } else {
      await this.db.insert(storePosShortcuts).values({
        organizationId,
        branchId: branch.id,
        hotkey: input.hotkey,
        label: input.label,
        productId: input.productId,
      });
    }
    return (await this.listPosShortcuts(organizationId, input.branchCode)).find((s) => s.hotkey === input.hotkey)!;
  }

  async deletePosShortcut(organizationId: string, shortcutId: string) {
    await this.db.delete(storePosShortcuts).where(and(eq(storePosShortcuts.id, shortcutId), eq(storePosShortcuts.organizationId, organizationId)));
    return { ok: true };
  }

  private mapShift(row: typeof storeShifts.$inferSelect) {
    return {
      id: row.id,
      cashierName: row.cashierName,
      openingCashPkr: row.openingCashPkr,
      closingCashPkr: row.closingCashPkr,
      expectedCashPkr: row.expectedCashPkr,
      cashDifferencePkr: row.cashDifferencePkr,
      totalSalesPkr: row.totalSalesPkr,
      transactionCount: row.transactionCount,
      status: row.status as "open" | "closed",
      openedAt: row.openedAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
    };
  }

  async listShifts(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(storeShifts)
      .where(and(eq(storeShifts.organizationId, organizationId), eq(storeShifts.branchId, branch.id)))
      .orderBy(desc(storeShifts.openedAt))
      .limit(50);
    return rows.map((r) => this.mapShift(r));
  }

  async getOpenShift(organizationId: string, branchCode: string, terminalId?: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const conditions = [
      eq(storeShifts.organizationId, organizationId),
      eq(storeShifts.branchId, branch.id),
      eq(storeShifts.status, "open"),
    ];
    if (terminalId) conditions.push(eq(storeShifts.terminalId, terminalId));
    const [row] = await this.db
      .select()
      .from(storeShifts)
      .where(and(...conditions))
      .orderBy(desc(storeShifts.openedAt))
      .limit(1);
    return row ? this.mapShift(row) : null;
  }

  async openShift(organizationId: string, input: OpenStoreShift) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const existing = await this.getOpenShift(organizationId, input.branchCode, input.terminalId);
    if (existing) throw new BadRequestException("A shift is already open on this terminal");

    const [shift] = await this.db
      .insert(storeShifts)
      .values({
        organizationId,
        branchId: branch.id,
        cashierName: input.cashierName.trim(),
        openingCashPkr: Math.round(input.openingCashPkr ?? 0),
        terminalId: input.terminalId ?? null,
        status: "open",
      })
      .returning();
    if (!shift) throw new BadRequestException("Failed to open shift");
    return this.mapShift(shift);
  }

  async closeShift(organizationId: string, shiftId: string, input: CloseStoreShift) {
    const [shift] = await this.db
      .select()
      .from(storeShifts)
      .where(and(eq(storeShifts.id, shiftId), eq(storeShifts.organizationId, organizationId)))
      .limit(1);
    if (!shift) throw new NotFoundException("Shift not found");
    if (shift.status === "closed") throw new BadRequestException("Shift already closed");

    const cashSales = await this.db
      .select({ total: sql<number>`coalesce(sum(${storeSales.amountPaidPkr}), 0)` })
      .from(storeSales)
      .where(and(eq(storeSales.shiftId, shiftId), eq(storeSales.paymentMethod, "Cash"), eq(storeSales.status, "Completed")));

    const cashMovements = await this.db.select().from(storeCashMovements).where(eq(storeCashMovements.shiftId, shiftId));
    const cashAdjustments = cashMovements.reduce((s, r) => s + (r.type === "paid_in" ? r.amountPkr : -r.amountPkr), 0);

    const expectedCash = shift.openingCashPkr + Number(cashSales[0]?.total ?? 0) + cashAdjustments;
    const closingCash = Math.round(input.closingCashPkr);
    const difference = closingCash - expectedCash;

    await this.db
      .update(storeShifts)
      .set({
        status: "closed",
        closingCashPkr: closingCash,
        expectedCashPkr: expectedCash,
        cashDifferencePkr: difference,
        closedAt: new Date(),
      })
      .where(eq(storeShifts.id, shiftId));

    return this.mapShift({ ...shift, status: "closed", closingCashPkr: closingCash, expectedCashPkr: expectedCash, cashDifferencePkr: difference, closedAt: new Date() });
  }

  async syncInventorySnapshot(organizationId: string, branchCode: string) {
    const products = await this.listProducts(organizationId, branchCode);
    return {
      syncedAt: new Date().toISOString(),
      products: products.map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        availableStock: p.availableStock,
        isWeighed: p.isWeighed,
      })),
    };
  }

  async getStockReport(organizationId: string, branchCode: string, fromIso?: string, toIso?: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const products = await this.listProducts(organizationId, branchCode);

    const defaultFrom = new Date();
    defaultFrom.setDate(defaultFrom.getDate() - 30);
    const from = fromIso ? new Date(fromIso) : defaultFrom;
    const to = toIso ? new Date(toIso) : new Date();

    const periodLabel = `${from.toISOString().slice(0, 16).replace("T", " ")} — ${to.toISOString().slice(0, 16).replace("T", " ")}`;

    const tx = await this.db
      .select()
      .from(storeInventoryTransactions)
      .where(
        and(
          eq(storeInventoryTransactions.organizationId, organizationId),
          eq(storeInventoryTransactions.branchId, branch.id),
          gte(storeInventoryTransactions.createdAt, from),
          lte(storeInventoryTransactions.createdAt, to),
        ),
      );

    const saleLines = await this.db
      .select({
        productId: storeSaleLines.productId,
        qty: storeSaleLines.qty,
        lineTotalPkr: storeSaleLines.lineTotalPkr,
      })
      .from(storeSaleLines)
      .innerJoin(storeSales, eq(storeSales.id, storeSaleLines.saleId))
      .where(
        and(
          eq(storeSales.organizationId, organizationId),
          eq(storeSales.branchId, branch.id),
          gte(storeSales.createdAt, from),
          lte(storeSales.createdAt, to),
        ),
      );

    const periodDays = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)));

    const productReport = products.map((p) => {
      const movementInPeriod = tx.filter((t) => t.productId === p.id).reduce((s, t) => s + t.qty, 0);
      let status: "ok" | "low" | "out" = "ok";
      if (p.availableStock === 0) status = "out";
      else if (p.availableStock <= p.reorderLevel) status = "low";
      return {
        sku: p.sku,
        name: p.name,
        category: p.categoryName,
        availableStock: p.availableStock,
        reorderLevel: p.reorderLevel,
        status,
        value: p.inventoryValue,
        movement30d: movementInPeriod,
      };
    });

    const soldMap = new Map<string, number>();
    for (const line of saleLines) {
      soldMap.set(line.productId, (soldMap.get(line.productId) ?? 0) + line.qty);
    }

    const withSales = products.map((p) => ({ name: p.name, sku: p.sku, qtySold: soldMap.get(p.id) ?? 0 }));
    const fastMoving = [...withSales].sort((a, b) => b.qtySold - a.qtySold).filter((p) => p.qtySold > 0).slice(0, 5);
    const slowMoving = [...withSales].sort((a, b) => a.qtySold - b.qtySold).slice(0, 5);
    const deadStock = products
      .filter((p) => !soldMap.has(p.id) && p.availableStock > 0)
      .map((p) => ({ name: p.name, sku: p.sku, daysIdle: periodDays, value: p.inventoryValue }))
      .slice(0, 5);

    return {
      periodLabel,
      from: from.toISOString(),
      to: to.toISOString(),
      products: productReport,
      deadStock,
      fastMoving,
      slowMoving,
    };
  }

  async getProfitLoss(organizationId: string, branchCode: string, fromIso?: string, toIso?: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const from = fromIso ? new Date(fromIso) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const to = toIso ? new Date(toIso) : new Date();

    const sales = await this.db
      .select()
      .from(storeSales)
      .where(
        and(
          eq(storeSales.organizationId, organizationId),
          eq(storeSales.branchId, branch.id),
          gte(storeSales.createdAt, from),
          lte(storeSales.createdAt, to),
        ),
      );

    const saleLines = await this.db
      .select({
        productId: storeSaleLines.productId,
        qty: storeSaleLines.qty,
        lineTotalPkr: storeSaleLines.lineTotalPkr,
      })
      .from(storeSaleLines)
      .innerJoin(storeSales, eq(storeSales.id, storeSaleLines.saleId))
      .where(
        and(
          eq(storeSales.organizationId, organizationId),
          eq(storeSales.branchId, branch.id),
          gte(storeSales.createdAt, from),
          lte(storeSales.createdAt, to),
        ),
      );

    const products = await this.db.select().from(storeProducts).where(eq(storeProducts.branchId, branch.id));

    let revenue = 0;
    let costOfGoods = 0;
    let itemsSold = 0;
    const topMap = new Map<string, { productName: string; qtySold: number; revenue: number; profit: number }>();

    for (const s of sales) revenue += s.totalPkr;
    for (const line of saleLines) {
      const prod = products.find((p) => p.id === line.productId);
      const cost = (prod?.purchasePricePkr ?? 0) * line.qty;
      costOfGoods += cost;
      itemsSold += line.qty;
      const cur = topMap.get(line.productId) ?? { productName: prod?.name ?? "Unknown", qtySold: 0, revenue: 0, profit: 0 };
      cur.qtySold += line.qty;
      cur.revenue += line.lineTotalPkr;
      cur.profit += line.lineTotalPkr - cost;
      topMap.set(line.productId, cur);
    }

    const grossProfit = revenue - costOfGoods;
    const expenses = Math.round(revenue * 0.08);
    const netProfit = grossProfit - expenses;

    return {
      periodLabel: `${from.toISOString().slice(0, 10)} — ${to.toISOString().slice(0, 10)}`,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      revenue,
      costOfGoods,
      grossProfit,
      expenses,
      netProfit,
      marginPct: revenue > 0 ? Math.round((netProfit / revenue) * 100) : 0,
      transactionCount: sales.length,
      itemsSold,
      topProducts: [...topMap.values()].sort((a, b) => b.profit - a.profit).slice(0, 5),
    };
  }
}
