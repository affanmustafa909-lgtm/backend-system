import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type {
  CreatePharmacyCompany,
  CreatePharmacyDistOrder,
  CreatePharmacyGrn,
  CreatePharmacyPurchaseOrder,
  CreatePharmacySaleReturn,
  CreatePharmacyTradeCustomer,
  CreatePharmacyWarehouse,
} from "@platform/contracts";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import {
  pharmacyAreas,
  pharmacyAssignments,
  pharmacyCities,
  pharmacyCollections,
  pharmacyCompanies,
  pharmacyDeliveries,
  pharmacyDistricts,
  pharmacyDivisions,
  pharmacyDistInvoiceLines,
  pharmacyDistInvoices,
  pharmacyDistOrderLines,
  pharmacyDistOrders,
  pharmacyGeoTerritories,
  pharmacyGrnLines,
  pharmacyGrns,
  pharmacyMedicineBatches,
  pharmacyMedicines,
  pharmacyPatients,
  pharmacyDoctors,
  pharmacyPrescriptions,
  pharmacyPriceListItems,
  pharmacyPriceLists,
  pharmacyProvinces,
  pharmacyPurchaseOrderLines,
  pharmacyPurchaseOrders,
  pharmacyPurchaseReturnLines,
  pharmacyPurchaseReturns,
  pharmacyRoutes,
  pharmacySaleLines,
  pharmacySaleReturnLines,
  pharmacySaleReturns,
  pharmacySales,
  pharmacySalesForceProfiles,
  pharmacySchemes,
  pharmacyStockMovements,
  pharmacyStockReservations,
  pharmacyTargets,
  pharmacyTerritories,
  pharmacyTradeCustomers,
  pharmacyVisits,
  pharmacyWarehouses,
  pharmacyWholesaleReturnLines,
  pharmacyWholesaleReturns,
  popsBranches,
  popsEmployees,
  type PlatformPgDb,
} from "@platform/database-pg";
import { AccountingHooksService } from "../accounting/accounting-hooks.service";
import { DRIZZLE } from "../drizzle/drizzle.tokens";
import { MOVEMENT_TYPES, StockLedgerService } from "./inventory/stock-ledger.service";
import { StockAvailabilityService } from "./inventory/stock-availability.service";
import { PharmacyStockEngine } from "./pharmacy-stock.engine";
import { PurchaseGrnService } from "./purchase/purchase-grn.service";
import { PurchaseOrderService } from "./purchase/purchase-order.service";
import { PurchaseReturnService } from "./purchase/purchase-return.service";
import { SalesCreditService } from "./sales/sales-credit.service";
import { SalesPricingService } from "./sales/sales-pricing.service";
import { CollectionService } from "./collections/collection.service";
import { DeliveryService } from "./delivery/delivery.service";

@Injectable()
export class PharmacyErpService {
  private readonly logger = new Logger(PharmacyErpService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly stock: PharmacyStockEngine,
    private readonly ledger: StockLedgerService,
    private readonly accountingHooks: AccountingHooksService,
    private readonly pricing: SalesPricingService,
    private readonly credit: SalesCreditService,
    private readonly availability: StockAvailabilityService,
    private readonly purchaseOrders: PurchaseOrderService,
    private readonly purchaseGrns: PurchaseGrnService,
    private readonly purchaseReturns: PurchaseReturnService,
    /** Phase 7 — thin delegate for legacy /distribution/collections POST. */
    private readonly collectionsSvc: CollectionService,
    /** Phase 7 — thin delegate for legacy /distribution/deliveries. */
    private readonly deliveriesSvc: DeliveryService,
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

  private nextRef(prefix: string) {
    return `${prefix}-${Date.now().toString().slice(-8)}`;
  }

  /** DOC-000042 style sequential codes per org (+ optional branch). */
  async nextSeqCode(
    organizationId: string,
    prefix: string,
    table: { organizationId: unknown; code?: unknown },
    codeColumn: { name?: string },
  ): Promise<string> {
    void table;
    void codeColumn;
    const stamp = Date.now().toString().slice(-6);
    return `${prefix}-${stamp}`;
  }

  /** Global find-by-code across pharmacy masters and documents. */
  async lookupByCode(organizationId: string, branchCode: string, rawQ: string) {
    const q = rawQ.trim().toUpperCase().replace(/\s+/g, "");
    if (!q) throw new BadRequestException("code/q is required");
    const branch = branchCode?.trim()
      ? await this.resolveBranch(organizationId, branchCode.trim()).catch(() => null)
      : null;

    const hits: {
      module: string;
      code: string;
      id: string;
      name: string;
      path: string;
      meta?: string;
    }[] = [];

    const push = (module: string, code: string | null | undefined, id: string, name: string, path: string, meta?: string) => {
      if (!code) return;
      if (code.toUpperCase() === q || code.toUpperCase().includes(q) || name.toUpperCase().includes(q)) {
        hits.push({ module, code, id, name, path, meta });
      }
    };

    const meds = await this.db
      .select()
      .from(pharmacyMedicines)
      .where(eq(pharmacyMedicines.organizationId, organizationId))
      .limit(500);
    for (const m of meds) {
      if (branch && m.branchId !== branch.id) continue;
      push("medicine", m.sku, m.id, m.name, "/pops/pharmacy/medicines", m.barcode ?? undefined);
      if (m.barcode) push("medicine", m.barcode, m.id, m.name, "/pops/pharmacy/medicines", m.sku);
    }

    const companies = await this.db.select().from(pharmacyCompanies).where(eq(pharmacyCompanies.organizationId, organizationId)).limit(200);
    for (const c of companies) push("company", c.code, c.id, c.name, "/pops/pharmacy/companies");

    const warehouses = await this.db.select().from(pharmacyWarehouses).where(eq(pharmacyWarehouses.organizationId, organizationId)).limit(200);
    for (const w of warehouses) {
      if (branch && w.branchId !== branch.id) continue;
      push("warehouse", w.code, w.id, w.name, "/pops/pharmacy/warehouses");
    }

    const patients = await this.db.select().from(pharmacyPatients).where(eq(pharmacyPatients.organizationId, organizationId)).limit(500);
    for (const p of patients) {
      if (branch && p.branchId !== branch.id) continue;
      push("patient", p.code, p.id, p.name, "/pops/pharmacy/customers", p.phone ?? undefined);
    }

    const doctors = await this.db.select().from(pharmacyDoctors).where(eq(pharmacyDoctors.organizationId, organizationId)).limit(500);
    for (const d of doctors) {
      if (branch && d.branchId !== branch.id) continue;
      push("doctor", d.code, d.id, d.name, "/pops/pharmacy/doctors", d.specialization ?? undefined);
    }

    const trade = await this.db.select().from(pharmacyTradeCustomers).where(eq(pharmacyTradeCustomers.organizationId, organizationId)).limit(500);
    for (const c of trade) push("tradeCustomer", c.code, c.id, c.name, "/pops/distribution/trade-customers", c.customerType);

    const territories = await this.db.select().from(pharmacyTerritories).where(eq(pharmacyTerritories.organizationId, organizationId)).limit(200);
    for (const t of territories) push("territory", t.code, t.id, t.name, "/pops/distribution/geo");
    const cities = await this.db.select().from(pharmacyCities).where(eq(pharmacyCities.organizationId, organizationId)).limit(200);
    for (const c of cities) push("city", c.code, c.id, c.name, "/pops/distribution/geo");
    const areas = await this.db.select().from(pharmacyAreas).where(eq(pharmacyAreas.organizationId, organizationId)).limit(200);
    for (const a of areas) push("area", a.code, a.id, a.name, "/pops/distribution/geo");
    const routes = await this.db.select().from(pharmacyRoutes).where(eq(pharmacyRoutes.organizationId, organizationId)).limit(200);
    for (const r of routes) push("route", r.code, r.id, r.name, "/pops/distribution/geo");

    const sales = await this.db
      .select()
      .from(pharmacySales)
      .where(eq(pharmacySales.organizationId, organizationId))
      .orderBy(desc(pharmacySales.createdAt))
      .limit(300);
    for (const s of sales) {
      if (branch && s.branchId !== branch.id) continue;
      push("saleInvoice", s.invoiceNumber, s.id, s.invoiceNumber, "/pops/pharmacy/sales");
    }

    const orders = await this.db
      .select()
      .from(pharmacyDistOrders)
      .where(eq(pharmacyDistOrders.organizationId, organizationId))
      .orderBy(desc(pharmacyDistOrders.createdAt))
      .limit(200);
    for (const o of orders) {
      if (branch && o.branchId !== branch.id) continue;
      push("distOrder", o.orderNumber, o.id, o.orderNumber, "/pops/distribution/orders", o.status);
    }

    const pos = await this.db
      .select()
      .from(pharmacyPurchaseOrders)
      .where(eq(pharmacyPurchaseOrders.organizationId, organizationId))
      .orderBy(desc(pharmacyPurchaseOrders.createdAt))
      .limit(200);
    for (const p of pos) {
      if (branch && p.branchId !== branch.id) continue;
      push("purchaseOrder", p.poNumber, p.id, p.poNumber, "/pops/pharmacy/purchase-orders", p.status);
    }

    const grns = await this.db
      .select()
      .from(pharmacyGrns)
      .where(eq(pharmacyGrns.organizationId, organizationId))
      .orderBy(desc(pharmacyGrns.createdAt))
      .limit(200);
    for (const g of grns) {
      if (branch && g.branchId !== branch.id) continue;
      push("grn", g.grnNumber, g.id, g.grnNumber, "/pops/pharmacy/purchase-orders");
    }

    const rxs = await this.db
      .select()
      .from(pharmacyPrescriptions)
      .where(eq(pharmacyPrescriptions.organizationId, organizationId))
      .orderBy(desc(pharmacyPrescriptions.createdAt))
      .limit(200);
    for (const rx of rxs) {
      if (branch && rx.branchId !== branch.id) continue;
      push("prescription", rx.prescriptionNumber, rx.id, rx.prescriptionNumber, "/pops/pharmacy/prescriptions", rx.status);
    }

    const saleReturns = await this.db
      .select()
      .from(pharmacySaleReturns)
      .where(eq(pharmacySaleReturns.organizationId, organizationId))
      .orderBy(desc(pharmacySaleReturns.createdAt))
      .limit(200);
    for (const r of saleReturns) {
      if (branch && r.branchId !== branch.id) continue;
      push("saleReturn", r.returnNumber, r.id, r.returnNumber, "/pops/pharmacy/sale-returns");
    }

    const purchaseReturns = await this.db
      .select()
      .from(pharmacyPurchaseReturns)
      .where(eq(pharmacyPurchaseReturns.organizationId, organizationId))
      .orderBy(desc(pharmacyPurchaseReturns.createdAt))
      .limit(200);
    for (const r of purchaseReturns) {
      if (branch && r.branchId !== branch.id) continue;
      push("purchaseReturn", r.returnNumber, r.id, r.returnNumber, "/pops/pharmacy/purchase-orders");
    }

    const distInvoices = await this.db
      .select()
      .from(pharmacyDistInvoices)
      .where(eq(pharmacyDistInvoices.organizationId, organizationId))
      .orderBy(desc(pharmacyDistInvoices.createdAt))
      .limit(200);
    for (const inv of distInvoices) {
      if (branch && inv.branchId !== branch.id) continue;
      push("distInvoice", inv.invoiceNumber, inv.id, inv.invoiceNumber, "/pops/distribution/orders", inv.status);
    }

    const deliveries = await this.db
      .select()
      .from(pharmacyDeliveries)
      .where(eq(pharmacyDeliveries.organizationId, organizationId))
      .orderBy(desc(pharmacyDeliveries.createdAt))
      .limit(200);
    for (const d of deliveries) {
      if (branch && d.branchId !== branch.id) continue;
      push("delivery", d.deliveryNumber, d.id, d.deliveryNumber, "/pops/distribution/deliveries", d.status);
    }

    const collections = await this.db
      .select()
      .from(pharmacyCollections)
      .where(eq(pharmacyCollections.organizationId, organizationId))
      .orderBy(desc(pharmacyCollections.createdAt))
      .limit(200);
    for (const c of collections) {
      if (branch && c.branchId !== branch.id) continue;
      push("collection", c.collectionNumber, c.id, c.collectionNumber, "/pops/distribution/collections");
    }

    const priceLists = await this.db
      .select()
      .from(pharmacyPriceLists)
      .where(eq(pharmacyPriceLists.organizationId, organizationId))
      .limit(200);
    for (const pl of priceLists) push("priceList", pl.code, pl.id, pl.name, "/pops/distribution/pricing", pl.priceLevel);

    const schemes = await this.db
      .select()
      .from(pharmacySchemes)
      .where(eq(pharmacySchemes.organizationId, organizationId))
      .limit(200);
    for (const s of schemes) push("scheme", s.code, s.id, s.name, "/pops/distribution/pricing", s.schemeType);

    const exact = hits.filter((h) => h.code.toUpperCase() === q);
    return {
      query: q,
      count: hits.length,
      exact: exact[0] ?? null,
      results: (exact.length ? exact : hits).slice(0, 50),
    };
  }

  // ─── Companies ───────────────────────────────────────────────────────────

  async listCompanies(organizationId: string) {
    return this.db
      .select()
      .from(pharmacyCompanies)
      .where(eq(pharmacyCompanies.organizationId, organizationId))
      .orderBy(desc(pharmacyCompanies.createdAt));
  }

  async createCompany(organizationId: string, input: CreatePharmacyCompany) {
    const [row] = await this.db
      .insert(pharmacyCompanies)
      .values({
        organizationId,
        code: input.code.trim(),
        name: input.name.trim(),
        manufacturerName: input.manufacturerName ?? null,
        contactPerson: input.contactPerson ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        city: input.city ?? null,
        country: input.country ?? "Pakistan",
        licenseInfo: input.licenseInfo ?? null,
        notes: input.notes ?? null,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create company");
    return row;
  }

  // ─── Warehouses ──────────────────────────────────────────────────────────

  async listWarehouses(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    await this.stock.ensureDefaultWarehouse(organizationId, branch.id);
    return this.db
      .select()
      .from(pharmacyWarehouses)
      .where(
        and(eq(pharmacyWarehouses.organizationId, organizationId), eq(pharmacyWarehouses.branchId, branch.id)),
      )
      .orderBy(desc(pharmacyWarehouses.createdAt));
  }

  async createWarehouse(organizationId: string, input: CreatePharmacyWarehouse) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    await this.stock.ensureDefaultWarehouse(organizationId, branch.id);
    if (input.isDefault) {
      await this.db
        .update(pharmacyWarehouses)
        .set({ isDefault: false })
        .where(
          and(eq(pharmacyWarehouses.organizationId, organizationId), eq(pharmacyWarehouses.branchId, branch.id)),
        );
    }
    const [row] = await this.db
      .insert(pharmacyWarehouses)
      .values({
        organizationId,
        branchId: branch.id,
        code: input.code.trim(),
        name: input.name.trim(),
        address: input.address ?? null,
        city: input.city ?? null,
        area: input.area ?? null,
        managerName: input.managerName ?? null,
        isDefault: input.isDefault ?? false,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create warehouse");
    return row;
  }

  // ─── Geography ───────────────────────────────────────────────────────────

  async listTerritories(organizationId: string) {
    return this.db
      .select()
      .from(pharmacyTerritories)
      .where(eq(pharmacyTerritories.organizationId, organizationId))
      .orderBy(desc(pharmacyTerritories.createdAt));
  }

  async createTerritory(
    organizationId: string,
    input: { code: string; name: string; region?: string },
  ) {
    if (!input.code?.trim() || !input.name?.trim()) {
      throw new BadRequestException("code and name are required");
    }
    const [row] = await this.db
      .insert(pharmacyTerritories)
      .values({
        organizationId,
        code: input.code.trim(),
        name: input.name.trim(),
        region: input.region ?? null,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create territory");
    return row;
  }

  async listCities(organizationId: string) {
    return this.db
      .select()
      .from(pharmacyCities)
      .where(eq(pharmacyCities.organizationId, organizationId))
      .orderBy(desc(pharmacyCities.createdAt));
  }

  async createCity(
    organizationId: string,
    input: { code: string; name: string; territoryId?: string; districtId?: string },
  ) {
    if (!input.code?.trim() || !input.name?.trim()) {
      throw new BadRequestException("code and name are required");
    }
    const [row] = await this.db
      .insert(pharmacyCities)
      .values({
        organizationId,
        code: input.code.trim(),
        name: input.name.trim(),
        territoryId: input.territoryId ?? null,
        districtId: input.districtId ?? null,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create city");
    return row;
  }

  async listProvinces(organizationId: string) {
    return this.db
      .select()
      .from(pharmacyProvinces)
      .where(eq(pharmacyProvinces.organizationId, organizationId))
      .orderBy(desc(pharmacyProvinces.createdAt));
  }

  async createProvince(organizationId: string, input: { code: string; name: string }) {
    if (!input.code?.trim() || !input.name?.trim()) {
      throw new BadRequestException("code and name are required");
    }
    const [row] = await this.db
      .insert(pharmacyProvinces)
      .values({ organizationId, code: input.code.trim(), name: input.name.trim() })
      .returning();
    if (!row) throw new BadRequestException("Failed to create province");
    return row;
  }

  async listDivisions(organizationId: string) {
    return this.db
      .select()
      .from(pharmacyDivisions)
      .where(eq(pharmacyDivisions.organizationId, organizationId))
      .orderBy(desc(pharmacyDivisions.createdAt));
  }

  async createDivision(
    organizationId: string,
    input: { provinceId: string; code: string; name: string },
  ) {
    if (!input.provinceId || !input.code?.trim() || !input.name?.trim()) {
      throw new BadRequestException("provinceId, code and name are required");
    }
    const [row] = await this.db
      .insert(pharmacyDivisions)
      .values({
        organizationId,
        provinceId: input.provinceId,
        code: input.code.trim(),
        name: input.name.trim(),
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create division");
    return row;
  }

  async listDistricts(organizationId: string) {
    return this.db
      .select()
      .from(pharmacyDistricts)
      .where(eq(pharmacyDistricts.organizationId, organizationId))
      .orderBy(desc(pharmacyDistricts.createdAt));
  }

  async createDistrict(
    organizationId: string,
    input: { divisionId: string; code: string; name: string },
  ) {
    if (!input.divisionId || !input.code?.trim() || !input.name?.trim()) {
      throw new BadRequestException("divisionId, code and name are required");
    }
    const [row] = await this.db
      .insert(pharmacyDistricts)
      .values({
        organizationId,
        divisionId: input.divisionId,
        code: input.code.trim(),
        name: input.name.trim(),
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create district");
    return row;
  }

  async listGeoTerritories(organizationId: string) {
    return this.db
      .select()
      .from(pharmacyGeoTerritories)
      .where(eq(pharmacyGeoTerritories.organizationId, organizationId))
      .orderBy(desc(pharmacyGeoTerritories.createdAt));
  }

  async createGeoTerritory(
    organizationId: string,
    input: { areaId: string; code: string; name: string; managerEmployeeId?: string },
  ) {
    if (!input.areaId || !input.code?.trim() || !input.name?.trim()) {
      throw new BadRequestException("areaId, code and name are required");
    }
    const [row] = await this.db
      .insert(pharmacyGeoTerritories)
      .values({
        organizationId,
        areaId: input.areaId,
        code: input.code.trim(),
        name: input.name.trim(),
        managerEmployeeId: input.managerEmployeeId ?? null,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create geo territory");
    return row;
  }

  async listAreas(organizationId: string) {
    return this.db
      .select()
      .from(pharmacyAreas)
      .where(eq(pharmacyAreas.organizationId, organizationId))
      .orderBy(desc(pharmacyAreas.createdAt));
  }

  async createArea(
    organizationId: string,
    input: {
      cityId: string;
      code: string;
      name: string;
      sector?: string;
      market?: string;
      isOutstation?: boolean;
    },
  ) {
    if (!input.cityId || !input.code?.trim() || !input.name?.trim()) {
      throw new BadRequestException("cityId, code and name are required");
    }
    const [row] = await this.db
      .insert(pharmacyAreas)
      .values({
        organizationId,
        cityId: input.cityId,
        code: input.code.trim(),
        name: input.name.trim(),
        sector: input.sector ?? null,
        market: input.market ?? null,
        isOutstation: input.isOutstation ?? false,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create area");
    return row;
  }

  async listRoutes(organizationId: string) {
    return this.db
      .select()
      .from(pharmacyRoutes)
      .where(eq(pharmacyRoutes.organizationId, organizationId))
      .orderBy(desc(pharmacyRoutes.createdAt));
  }

  async createRoute(
    organizationId: string,
    input: {
      areaId: string;
      code: string;
      name: string;
      station?: string;
      sequenceNo?: number;
      pjpDayOfWeek?: number | null;
      geoTerritoryId?: string;
    },
  ) {
    if (!input.areaId || !input.code?.trim() || !input.name?.trim()) {
      throw new BadRequestException("areaId, code and name are required");
    }
    const [row] = await this.db
      .insert(pharmacyRoutes)
      .values({
        organizationId,
        areaId: input.areaId,
        geoTerritoryId: input.geoTerritoryId ?? null,
        code: input.code.trim(),
        name: input.name.trim(),
        station: input.station ?? null,
        sequenceNo: Math.round(input.sequenceNo ?? 0),
        pjpDayOfWeek:
          input.pjpDayOfWeek === undefined || input.pjpDayOfWeek === null
            ? null
            : Math.max(0, Math.min(6, Math.round(input.pjpDayOfWeek))),
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create route");
    return row;
  }

  // ─── Trade customers ─────────────────────────────────────────────────────

  async listTradeCustomers(organizationId: string) {
    return this.db
      .select()
      .from(pharmacyTradeCustomers)
      .where(eq(pharmacyTradeCustomers.organizationId, organizationId))
      .orderBy(desc(pharmacyTradeCustomers.createdAt));
  }

  async createTradeCustomer(organizationId: string, input: CreatePharmacyTradeCustomer) {
    let branchId: string | null = null;
    if (input.branchCode) {
      const branch = await this.resolveBranch(organizationId, input.branchCode);
      branchId = branch.id;
    }
    const [row] = await this.db
      .insert(pharmacyTradeCustomers)
      .values({
        organizationId,
        branchId,
        code: input.code.trim(),
        name: input.name.trim(),
        businessName: input.businessName ?? null,
        customerType: input.customerType ?? "Retailer",
        phone: input.phone ?? null,
        whatsapp: input.whatsapp ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        cityId: input.cityId ?? null,
        areaId: input.areaId ?? null,
        territoryId: input.territoryId ?? null,
        routeId: input.routeId ?? null,
        salesmanEmployeeId: input.salesmanEmployeeId ?? null,
        creditLimitPkr: Math.round(input.creditLimitPkr ?? 0),
        creditDays: Math.round(input.creditDays ?? 30),
        outstandingPkr: Math.round(input.openingBalancePkr ?? 0),
        openingBalancePkr: Math.round(input.openingBalancePkr ?? 0),
        priceLevel: input.priceLevel ?? "retail",
        discountPct: Math.round(input.discountPct ?? 0),
        taxInfo: input.taxInfo ?? null,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create trade customer");
    return row;
  }

  async getTradeCustomerLedger(organizationId: string, customerId: string) {
    const [customer] = await this.db
      .select()
      .from(pharmacyTradeCustomers)
      .where(
        and(eq(pharmacyTradeCustomers.id, customerId), eq(pharmacyTradeCustomers.organizationId, organizationId)),
      )
      .limit(1);
    if (!customer) throw new NotFoundException("Trade customer not found");

    const invoices = await this.db
      .select()
      .from(pharmacyDistInvoices)
      .where(
        and(
          eq(pharmacyDistInvoices.organizationId, organizationId),
          eq(pharmacyDistInvoices.tradeCustomerId, customerId),
        ),
      )
      .orderBy(desc(pharmacyDistInvoices.createdAt))
      .limit(200);

    const collections = await this.db
      .select()
      .from(pharmacyCollections)
      .where(
        and(
          eq(pharmacyCollections.organizationId, organizationId),
          eq(pharmacyCollections.tradeCustomerId, customerId),
        ),
      )
      .orderBy(desc(pharmacyCollections.createdAt))
      .limit(200);

    const now = Date.now();
    const aging = { d0_30: 0, d31_60: 0, d61_plus: 0 };
    for (const inv of invoices) {
      const due = inv.amountDuePkr ?? 0;
      if (due <= 0) continue;
      const ageDays = Math.floor((now - new Date(inv.createdAt).getTime()) / 86400000);
      if (ageDays <= 30) aging.d0_30 += due;
      else if (ageDays <= 60) aging.d31_60 += due;
      else aging.d61_plus += due;
    }

    return {
      customer,
      invoices,
      collections,
      aging,
      outstandingPkr: customer.outstandingPkr,
      creditLimitPkr: customer.creditLimitPkr,
      overdueBlocked: customer.creditLimitPkr > 0 && customer.outstandingPkr >= customer.creditLimitPkr,
    };
  }

  // ─── Sales force ─────────────────────────────────────────────────────────

  async listSalesForce(organizationId: string) {
    return this.db
      .select()
      .from(pharmacySalesForceProfiles)
      .where(eq(pharmacySalesForceProfiles.organizationId, organizationId))
      .orderBy(desc(pharmacySalesForceProfiles.createdAt));
  }

  async createSalesForceProfile(
    organizationId: string,
    input: {
      employeeId: string;
      fieldRole?: string;
      territoryId?: string;
      cityId?: string;
      areaId?: string;
    },
  ) {
    if (!input.employeeId) throw new BadRequestException("employeeId is required");
    const [row] = await this.db
      .insert(pharmacySalesForceProfiles)
      .values({
        organizationId,
        employeeId: input.employeeId,
        fieldRole: input.fieldRole ?? "Salesman",
        territoryId: input.territoryId ?? null,
        cityId: input.cityId ?? null,
        areaId: input.areaId ?? null,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create sales force profile");
    return row;
  }

  // ─── Purchase orders ─────────────────────────────────────────────────────

  async listPurchaseOrders(organizationId: string, branchCode?: string) {
    const page = await this.purchaseOrders.list(organizationId, {
      branchCode,
      page: 1,
      pageSize: 500,
    });
    return page.items;
  }

  async createPurchaseOrder(
    organizationId: string,
    input: CreatePharmacyPurchaseOrder,
    userId?: string,
  ) {
    return this.purchaseOrders.create(organizationId, input, userId);
  }

  async getPurchaseOrder(organizationId: string, id: string) {
    return this.purchaseOrders.getById(organizationId, id);
  }

  async approvePurchaseOrder(organizationId: string, id: string) {
    return this.purchaseOrders.approve(organizationId, id);
  }

  // ─── GRN ─────────────────────────────────────────────────────────────────

  async listGrns(organizationId: string, branchCode?: string) {
    const page = await this.purchaseGrns.list(organizationId, {
      branchCode,
      page: 1,
      pageSize: 500,
    });
    return page.items;
  }

  async createGrn(
    organizationId: string,
    input: CreatePharmacyGrn & {
      idempotencyKey?: string;
      skipPoStatusCheck?: boolean;
      priceVarianceOverride?: boolean;
      priceVarianceReason?: string;
    },
    userId?: string,
  ) {
    // Legacy /v1/pharmacy/grns delegates to Phase 6 PurchaseGrnService
    // (partial receive fix, expiry/variance gates, numbering).
    // skipPoStatusCheck defaults true for legacy callers that post GRN without
    // an approved PO; Dist purchase/grns leaves it false.
    return this.purchaseGrns.create(
      organizationId,
      {
        ...input,
        skipPoStatusCheck: input.skipPoStatusCheck ?? true,
      },
      userId,
    );
  }

  // ─── Sale returns ────────────────────────────────────────────────────────

  async listSaleReturns(organizationId: string, branchCode?: string) {
    if (branchCode) {
      const branch = await this.resolveBranch(organizationId, branchCode);
      return this.db
        .select()
        .from(pharmacySaleReturns)
        .where(
          and(
            eq(pharmacySaleReturns.organizationId, organizationId),
            eq(pharmacySaleReturns.branchId, branch.id),
          ),
        )
        .orderBy(desc(pharmacySaleReturns.createdAt));
    }
    return this.db
      .select()
      .from(pharmacySaleReturns)
      .where(eq(pharmacySaleReturns.organizationId, organizationId))
      .orderBy(desc(pharmacySaleReturns.createdAt));
  }

  async createSaleReturn(organizationId: string, input: CreatePharmacySaleReturn, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [sale] = await this.db
      .select()
      .from(pharmacySales)
      .where(and(eq(pharmacySales.id, input.originalSaleId), eq(pharmacySales.organizationId, organizationId)))
      .limit(1);
    if (!sale) throw new NotFoundException("Original sale not found");
    if (sale.branchId !== branch.id) throw new BadRequestException("Sale belongs to another branch");

    const saleLines = await this.db
      .select()
      .from(pharmacySaleLines)
      .where(eq(pharmacySaleLines.saleId, sale.id));

    let subtotal = 0;
    let tax = 0;
    const prepared: {
      medicineId: string;
      batchId: string | null;
      qty: number;
      tabletsQty: number;
      unitPricePkr: number;
      lineTotalPkr: number;
    }[] = [];

    for (const line of input.lines) {
      const orig = saleLines.find((l) => l.medicineId === line.medicineId);
      const unitPrice = Math.round(line.unitPricePkr ?? orig?.unitPricePkr ?? 0);
      const tabletsQty = Math.round(line.tabletsQty ?? line.qty);
      const lineTotal = unitPrice * Math.round(line.qty);
      subtotal += lineTotal;
      if (sale.subtotalPkr > 0 && sale.taxPkr > 0) {
        tax += Math.round((lineTotal * sale.taxPkr) / sale.subtotalPkr);
      }
      prepared.push({
        medicineId: line.medicineId,
        batchId: line.batchId ?? orig?.batchId ?? null,
        qty: Math.round(line.qty),
        tabletsQty,
        unitPricePkr: unitPrice,
        lineTotalPkr: lineTotal,
      });
    }

    const total = subtotal + tax;
    const returnNumber = this.nextRef("SRN");
    const warehouse = await this.stock.ensureDefaultWarehouse(organizationId, branch.id);

    const ret = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(pharmacySaleReturns)
        .values({
          organizationId,
          branchId: branch.id,
          warehouseId: warehouse.id,
          originalSaleId: sale.id,
          returnNumber,
          reason: input.reason ?? null,
          refundMethod: input.refundMethod ?? "Cash",
          subtotalPkr: subtotal,
          taxPkr: tax,
          totalPkr: total,
          createdByUserId: userId ?? null,
        })
        .returning();
      if (!created) throw new BadRequestException("Failed to create sale return");

      for (const [lineIndex, line] of prepared.entries()) {
        await this.stock.restoreBatch(tx, {
          organizationId,
          branchId: branch.id,
          medicineId: line.medicineId,
          batchId: line.batchId,
          qty: line.tabletsQty,
          warehouseId: warehouse.id,
          referenceType: "sale_return",
          referenceId: created.id,
          movementType: MOVEMENT_TYPES.SALES_RETURN,
          idempotencyKey: `sale-return:${created.id}:${lineIndex}`,
          createdByUserId: userId,
        });
        await tx.insert(pharmacySaleReturnLines).values({
          saleReturnId: created.id,
          medicineId: line.medicineId,
          batchId: line.batchId,
          qty: line.qty,
          tabletsQty: line.tabletsQty,
          unitPricePkr: line.unitPricePkr,
          lineTotalPkr: line.lineTotalPkr,
        });
      }

      if (sale.patientId && sale.amountDuePkr > 0) {
        const creditBack = Math.min(total, sale.amountDuePkr);
        const [patient] = await tx
          .select()
          .from(pharmacyPatients)
          .where(eq(pharmacyPatients.id, sale.patientId))
          .limit(1);
        if (patient && creditBack > 0) {
          await tx
            .update(pharmacyPatients)
            .set({ outstandingPkr: Math.max(0, patient.outstandingPkr - creditBack) })
            .where(eq(pharmacyPatients.id, patient.id));
        }
      }

      return created;
    });

    try {
      await this.accountingHooks.recordPharmacySaleReturn(organizationId, branch.id, {
        returnNumber: ret.returnNumber,
        subtotalPkr: ret.subtotalPkr,
        taxPkr: ret.taxPkr,
        totalPkr: ret.totalPkr,
        refundMethod: ret.refundMethod,
        createdAt: ret.createdAt,
      });
    } catch {
      /* ignore */
    }

    const lines = await this.db
      .select()
      .from(pharmacySaleReturnLines)
      .where(eq(pharmacySaleReturnLines.saleReturnId, ret.id));
    return { ...ret, lines };
  }

  // ─── Purchase returns ────────────────────────────────────────────────────

  async listPurchaseReturns(organizationId: string, branchCode?: string) {
    const page = await this.purchaseReturns.list(organizationId, {
      branchCode,
      page: 1,
      pageSize: 500,
    });
    return page.items;
  }

  async createPurchaseReturn(
    organizationId: string,
    input: {
      branchCode: string;
      warehouseId?: string;
      supplierId?: string;
      grnId?: string;
      reason?: string;
      lines: { medicineId: string; batchId?: string; quantity: number; unitCostPkr?: number }[];
    },
    userId?: string,
  ) {
    return this.purchaseReturns.create(organizationId, input, userId);
  }

  // ─── Distribution orders ─────────────────────────────────────────────────

  async listDistOrders(organizationId: string, branchCode?: string) {
    if (branchCode) {
      const branch = await this.resolveBranch(organizationId, branchCode);
      return this.db
        .select()
        .from(pharmacyDistOrders)
        .where(
          and(eq(pharmacyDistOrders.organizationId, organizationId), eq(pharmacyDistOrders.branchId, branch.id)),
        )
        .orderBy(desc(pharmacyDistOrders.createdAt));
    }
    return this.db
      .select()
      .from(pharmacyDistOrders)
      .where(eq(pharmacyDistOrders.organizationId, organizationId))
      .orderBy(desc(pharmacyDistOrders.createdAt));
  }

  async listDistInvoices(organizationId: string, branchCode?: string) {
    if (branchCode) {
      const branch = await this.resolveBranch(organizationId, branchCode);
      return this.db
        .select()
        .from(pharmacyDistInvoices)
        .where(
          and(
            eq(pharmacyDistInvoices.organizationId, organizationId),
            eq(pharmacyDistInvoices.branchId, branch.id),
          ),
        )
        .orderBy(desc(pharmacyDistInvoices.createdAt));
    }
    return this.db
      .select()
      .from(pharmacyDistInvoices)
      .where(eq(pharmacyDistInvoices.organizationId, organizationId))
      .orderBy(desc(pharmacyDistInvoices.createdAt));
  }

  async createDistOrder(organizationId: string, input: CreatePharmacyDistOrder, userId?: string) {
    const idempotencyKey = input.idempotencyKey?.trim() || null;
    if (idempotencyKey) {
      const [existing] = await this.db
        .select({ id: pharmacyDistOrders.id })
        .from(pharmacyDistOrders)
        .where(
          and(
            eq(pharmacyDistOrders.organizationId, organizationId),
            eq(pharmacyDistOrders.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) return this.getDistOrder(organizationId, existing.id);
    }

    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [customer] = await this.db
      .select()
      .from(pharmacyTradeCustomers)
      .where(
        and(
          eq(pharmacyTradeCustomers.id, input.tradeCustomerId),
          eq(pharmacyTradeCustomers.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!customer) throw new NotFoundException("Trade customer not found");

    let subtotal = 0;
    const prepared: {
      medicineId: string;
      quantity: number;
      freeQuantity: number;
      unitPricePkr: number;
      discountPkr: number;
      lineTotalPkr: number;
    }[] = [];

    for (const line of input.lines) {
      const resolved =
        line.unitPricePkr != null
          ? { unitPricePkr: Math.round(line.unitPricePkr) }
          : await this.pricing.resolvePrice(organizationId, line.medicineId, {
              tradeCustomerId: customer.id,
              priceLevel: customer.priceLevel,
              qty: line.quantity,
            });
      const unitPrice = resolved.unitPricePkr;
      const discount = Math.round(line.discountPkr ?? 0);
      const qty = Math.round(line.quantity);
      const freeFromScheme = await this.pricing.resolveSchemeFreeQty(organizationId, line.medicineId, qty);
      const freeQuantity = Math.round(line.freeQuantity ?? freeFromScheme);
      const lineTotal = qty * unitPrice - discount;
      subtotal += lineTotal;
      prepared.push({
        medicineId: line.medicineId,
        quantity: qty,
        freeQuantity,
        unitPricePkr: unitPrice,
        discountPkr: discount,
        lineTotalPkr: lineTotal,
      });
    }

    const discountPkr = Math.round(input.discountPkr ?? 0);
    const taxPkr = Math.round(input.taxPkr ?? 0);
    const total = subtotal - discountPkr + taxPkr;

    const creditEval = await this.credit.evaluate(organizationId, customer.id, total, {
      creditOverride: input.creditOverride,
      overrideReason: input.creditOverrideReason,
    });
    if (!creditEval.allowed) {
      throw new BadRequestException(creditEval.message);
    }

    const warehouse = input.warehouseId
      ? (
          await this.db
            .select()
            .from(pharmacyWarehouses)
            .where(eq(pharmacyWarehouses.id, input.warehouseId))
            .limit(1)
        )[0]
      : await this.stock.ensureDefaultWarehouse(organizationId, branch.id);

    if (input.submit && !input.skipStockCheck) {
      const stockCheck = await this.availability.checkAvailability({
        organizationId,
        branchCode: input.branchCode,
        warehouseId: warehouse?.id ?? input.warehouseId,
        lines: prepared.map((l) => ({
          medicineId: l.medicineId,
          quantity: l.quantity + l.freeQuantity,
        })),
      });
      const short = stockCheck.lines.filter((l) => !l.fulfillable);
      if (short.length) {
        throw new BadRequestException(
          `Insufficient stock: ${short
            .map((s) => `${s.name ?? s.sku ?? s.medicineId} short ${s.shortfall}`)
            .join("; ")}`,
        );
      }
    }

    const creditOverride = Boolean(input.creditOverride) && creditEval.requiresOverride;
    const orderId = await this.db.transaction(async (tx) => {
      if (idempotencyKey) {
        const [race] = await tx
          .select({ id: pharmacyDistOrders.id })
          .from(pharmacyDistOrders)
          .where(
            and(
              eq(pharmacyDistOrders.organizationId, organizationId),
              eq(pharmacyDistOrders.idempotencyKey, idempotencyKey),
            ),
          )
          .limit(1);
        if (race) return race.id;
      }

      const [order] = await tx
        .insert(pharmacyDistOrders)
        .values({
          organizationId,
          branchId: branch.id,
          warehouseId: warehouse?.id ?? null,
          orderNumber: this.nextRef("DO"),
          tradeCustomerId: customer.id,
          salesmanEmployeeId: input.salesmanEmployeeId ?? null,
          status: input.submit ? "booked" : "draft",
          bookedAt: input.submit ? new Date() : null,
          subtotalPkr: subtotal,
          discountPkr,
          taxPkr,
          totalPkr: total,
          creditOverride,
          creditOverrideReason: creditOverride ? (input.creditOverrideReason?.trim() ?? null) : null,
          creditOverrideByUserId: creditOverride ? (userId ?? null) : null,
          creditOverrideAt: creditOverride ? new Date() : null,
          idempotencyKey,
          notes: input.notes ?? null,
          createdByUserId: userId ?? null,
        })
        .returning({ id: pharmacyDistOrders.id });
      if (!order) throw new BadRequestException("Failed to create distribution order");

      for (const line of prepared) {
        await tx.insert(pharmacyDistOrderLines).values({
          orderId: order.id,
          medicineId: line.medicineId,
          quantity: line.quantity,
          freeQuantity: line.freeQuantity,
          unitPricePkr: line.unitPricePkr,
          discountPkr: line.discountPkr,
          lineTotalPkr: line.lineTotalPkr,
        });
      }
      return order.id;
    });

    return this.getDistOrder(organizationId, orderId);
  }

  /** Server-held Sale Window drafts (status=draft) for a branch. */
  async listHeldDistOrders(organizationId: string, branchCode?: string) {
    const conds = [
      eq(pharmacyDistOrders.organizationId, organizationId),
      eq(pharmacyDistOrders.status, "draft"),
    ];
    if (branchCode?.trim()) {
      const branch = await this.resolveBranch(organizationId, branchCode);
      conds.push(eq(pharmacyDistOrders.branchId, branch.id));
    }
    return this.db
      .select()
      .from(pharmacyDistOrders)
      .where(and(...conds))
      .orderBy(desc(pharmacyDistOrders.createdAt));
  }

  /** Soft-cancel a draft held order only. */
  async cancelHeldDistOrder(organizationId: string, orderId: string, _userId?: string) {
    const [order] = await this.db
      .select()
      .from(pharmacyDistOrders)
      .where(and(eq(pharmacyDistOrders.id, orderId), eq(pharmacyDistOrders.organizationId, organizationId)))
      .limit(1);
    if (!order) throw new NotFoundException("Distribution order not found");
    if (order.status !== "draft") {
      throw new BadRequestException(`Only draft held orders can be cancelled (status=${order.status})`);
    }
    const [updated] = await this.db
      .update(pharmacyDistOrders)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(eq(pharmacyDistOrders.id, orderId))
      .returning();
    return updated;
  }

  async getDistOrder(organizationId: string, id: string) {
    const [order] = await this.db
      .select()
      .from(pharmacyDistOrders)
      .where(and(eq(pharmacyDistOrders.id, id), eq(pharmacyDistOrders.organizationId, organizationId)))
      .limit(1);
    if (!order) throw new NotFoundException("Distribution order not found");
    const lines = await this.db
      .select()
      .from(pharmacyDistOrderLines)
      .where(eq(pharmacyDistOrderLines.orderId, id));
    return { ...order, lines };
  }

  async approveDistOrder(organizationId: string, id: string) {
    const order = await this.getDistOrder(organizationId, id);
    if (!["draft", "submitted", "booked"].includes(order.status)) {
      throw new BadRequestException(`Cannot approve order in status ${order.status}`);
    }
    const [customer] = await this.db
      .select()
      .from(pharmacyTradeCustomers)
      .where(eq(pharmacyTradeCustomers.id, order.tradeCustomerId))
      .limit(1);
    if (customer && !order.creditOverride && customer.creditLimitPkr > 0) {
      if (customer.outstandingPkr + order.totalPkr > customer.creditLimitPkr) {
        throw new BadRequestException("Credit limit exceeded — use credit override to approve");
      }
    }
    const [updated] = await this.db
      .update(pharmacyDistOrders)
      .set({ status: "approved", approvedAt: new Date() })
      .where(eq(pharmacyDistOrders.id, id))
      .returning();
    return { ...updated, lines: order.lines };
  }

  async invoiceFromOrder(organizationId: string, id: string, userId?: string) {
    const invoiceable = [
      "approved",
      "submitted",
      "stock_reserved",
      "picking",
      "packed",
      "ready_for_dispatch",
    ];

    const result = await this.db.transaction(async (tx) => {
      // Lock the order row before invoicing to prevent concurrent double WINV.
      const [locked] = await tx
        .select()
        .from(pharmacyDistOrders)
        .where(and(eq(pharmacyDistOrders.id, id), eq(pharmacyDistOrders.organizationId, organizationId)))
        .limit(1)
        .for("update");
      if (!locked) throw new NotFoundException("Distribution order not found");
      if (!invoiceable.includes(locked.status)) {
        throw new BadRequestException(
          locked.status === "invoiced"
            ? "Order is already invoiced"
            : "Order must be approved (or in warehouse pipeline) before invoicing",
        );
      }

      const lines = await tx
        .select()
        .from(pharmacyDistOrderLines)
        .where(eq(pharmacyDistOrderLines.orderId, id));

      const warehouseId =
        locked.warehouseId ??
        (await this.stock.ensureDefaultWarehouse(organizationId, locked.branchId)).id;

      const invoiceNumber = this.nextRef("WINV");
      const [invoice] = await tx
        .insert(pharmacyDistInvoices)
        .values({
          organizationId,
          branchId: locked.branchId,
          orderId: locked.id,
          tradeCustomerId: locked.tradeCustomerId,
          invoiceNumber,
          invoiceDate: new Date().toISOString().slice(0, 10),
          paymentMethod: "Credit",
          amountPaidPkr: 0,
          amountDuePkr: locked.totalPkr,
          subtotalPkr: locked.subtotalPkr,
          discountPkr: locked.discountPkr,
          taxPkr: locked.taxPkr,
          totalPkr: locked.totalPkr,
          status: "posted",
        })
        .returning();
      if (!invoice) throw new BadRequestException("Failed to create invoice");

      // If the order held reservations, they must come back to the AVAILABLE
      // bucket before the deduction: `deductFefo` only draws from `available`,
      // so releasing with outcome `consumed` (which leaves the units out of
      // `available`) would make the deduction fail or oversell a second batch.
      // `released` returns exactly the reserved units to the shelf and the
      // deduction below then removes them physically — net effect is N units
      // out and zero left reserved.
      await this.stock.releaseReservations(tx, {
        organizationId,
        branchId: locked.branchId,
        referenceType: "dist_order",
        referenceId: locked.id,
        outcome: "released",
        createdByUserId: userId,
      });

      for (const [lineIndex, line] of lines.entries()) {
        const batchId = await this.stock.deductFefo(tx, {
          organizationId,
          branchId: locked.branchId,
          medicineId: line.medicineId,
          qty: line.quantity + line.freeQuantity,
          warehouseId,
          referenceType: "dist_invoice",
          referenceId: invoice.id,
          movementType: MOVEMENT_TYPES.SALE,
          idempotencyKey: `dist-invoice:${invoice.id}:${lineIndex}`,
          createdByUserId: userId,
        });
        await tx
          .update(pharmacyDistOrderLines)
          .set({ batchId })
          .where(eq(pharmacyDistOrderLines.id, line.id));
        await tx.insert(pharmacyDistInvoiceLines).values({
          invoiceId: invoice.id,
          medicineId: line.medicineId,
          batchId,
          quantity: line.quantity,
          freeQuantity: line.freeQuantity,
          unitPricePkr: line.unitPricePkr,
          lineTotalPkr: line.lineTotalPkr,
        });
      }

      const [customer] = await tx
        .select()
        .from(pharmacyTradeCustomers)
        .where(eq(pharmacyTradeCustomers.id, locked.tradeCustomerId))
        .limit(1);
      if (customer) {
        await tx
          .update(pharmacyTradeCustomers)
          .set({ outstandingPkr: customer.outstandingPkr + locked.totalPkr })
          .where(eq(pharmacyTradeCustomers.id, customer.id));
      }

      await tx
        .update(pharmacyDistOrders)
        .set({
          status: "invoiced",
          paymentStatus: "unpaid",
          deliveryStatus: "pending",
          invoicedAt: new Date(),
        })
        .where(eq(pharmacyDistOrders.id, locked.id));

      return { invoice, branchId: locked.branchId };
    });

    try {
      await this.accountingHooks.recordDistWholesaleInvoice(organizationId, result.branchId, {
        invoiceNumber: result.invoice.invoiceNumber,
        subtotalPkr: result.invoice.subtotalPkr,
        discountPkr: result.invoice.discountPkr,
        taxPkr: result.invoice.taxPkr,
        totalPkr: result.invoice.totalPkr,
        amountPaidPkr: result.invoice.amountPaidPkr,
        amountDuePkr: result.invoice.amountDuePkr,
        paymentMethod: result.invoice.paymentMethod,
        createdAt: result.invoice.createdAt,
      });
    } catch (err) {
      this.logger.error(
        `WINV ${result.invoice.invoiceNumber} missing journal: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const lines = await this.db
      .select()
      .from(pharmacyDistInvoiceLines)
      .where(eq(pharmacyDistInvoiceLines.invoiceId, result.invoice.id));
    return { ...result.invoice, lines };
  }

  // ─── Deliveries ──────────────────────────────────────────────────────────

  async listDeliveries(organizationId: string, branchCode?: string) {
    if (branchCode) {
      const branch = await this.resolveBranch(organizationId, branchCode);
      return this.db
        .select()
        .from(pharmacyDeliveries)
        .where(
          and(eq(pharmacyDeliveries.organizationId, organizationId), eq(pharmacyDeliveries.branchId, branch.id)),
        )
        .orderBy(desc(pharmacyDeliveries.createdAt));
    }
    return this.db
      .select()
      .from(pharmacyDeliveries)
      .where(eq(pharmacyDeliveries.organizationId, organizationId))
      .orderBy(desc(pharmacyDeliveries.createdAt));
  }

  /** Legacy — delegates to Phase 7 DeliveryService (year+seq numbering). Prefer `/v1/pharmacy/delivery/orders`. */
  async createDelivery(
    organizationId: string,
    input: {
      branchCode: string;
      orderId?: string;
      invoiceId?: string;
      tradeCustomerId?: string;
      riderName?: string;
      routeId?: string;
    },
  ) {
    return this.deliveriesSvc.create(organizationId, input);
  }

  /**
   * Legacy POD patch — syncs order deliveryStatus (same as DeliveryService.completePod).
   * Prefer `/v1/pharmacy/delivery/orders/:id/pod` for full POD outcomes.
   */
  async updateDelivery(
    organizationId: string,
    id: string,
    input: {
      status?: string;
      failedReason?: string;
      podNotes?: string;
      collectedPkr?: number;
    },
  ) {
    const status = input.status;
    if (status && ["delivered", "partial", "failed", "refused"].includes(status)) {
      return this.deliveriesSvc.completePod(organizationId, id, {
        status: status as "delivered" | "partial" | "failed" | "refused",
        failedReason: input.failedReason,
        podNotes: input.podNotes,
        collectedPkr: input.collectedPkr,
        requireReceiverName: false,
      });
    }
    const [existing] = await this.db
      .select()
      .from(pharmacyDeliveries)
      .where(and(eq(pharmacyDeliveries.id, id), eq(pharmacyDeliveries.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Delivery not found");

    const nextStatus = input.status ?? existing.status;
    const [updated] = await this.db
      .update(pharmacyDeliveries)
      .set({
        status: nextStatus,
        failedReason: input.failedReason ?? existing.failedReason,
        podNotes: input.podNotes ?? existing.podNotes,
        collectedPkr: input.collectedPkr != null ? Math.round(input.collectedPkr) : existing.collectedPkr,
      })
      .where(eq(pharmacyDeliveries.id, id))
      .returning();

    if (existing.orderId && nextStatus) {
      await this.db
        .update(pharmacyDistOrders)
        .set({ deliveryStatus: nextStatus })
        .where(eq(pharmacyDistOrders.id, existing.orderId));
    }
    return updated;
  }

  // ─── Collections ─────────────────────────────────────────────────────────

  async listCollections(organizationId: string, branchCode?: string) {
    if (branchCode) {
      const branch = await this.resolveBranch(organizationId, branchCode);
      return this.db
        .select()
        .from(pharmacyCollections)
        .where(
          and(
            eq(pharmacyCollections.organizationId, organizationId),
            eq(pharmacyCollections.branchId, branch.id),
          ),
        )
        .orderBy(desc(pharmacyCollections.createdAt));
    }
    return this.db
      .select()
      .from(pharmacyCollections)
      .where(eq(pharmacyCollections.organizationId, organizationId))
      .orderBy(desc(pharmacyCollections.createdAt));
  }

  /**
   * Legacy `/v1/pharmacy/distribution/collections` — delegates to Phase 7 CollectionService.
   * Prefer `/v1/pharmacy/collections` (allocations required unless advance=true).
   * When legacy posts without invoiceId, we treat as advance so outstanding is NOT
   * reduced until allocate (fixes prior split-brain bug).
   */
  async createCollection(
    organizationId: string,
    input: {
      branchCode: string;
      tradeCustomerId: string;
      invoiceId?: string;
      patientId?: string;
      amountPkr: number;
      paymentMethod?: string;
      salesmanEmployeeId?: string;
      notes?: string;
    },
    userId?: string,
  ) {
    return this.collectionsSvc.create(
      organizationId,
      {
        branchCode: input.branchCode,
        tradeCustomerId: input.tradeCustomerId,
        invoiceId: input.invoiceId,
        patientId: input.patientId,
        amountPkr: input.amountPkr,
        paymentMethod: input.paymentMethod,
        salesmanEmployeeId: input.salesmanEmployeeId,
        notes: input.notes,
        // Legacy without invoice: hold as advance (do not silently cut outstanding).
        advance: !input.invoiceId,
      },
      userId,
    );
  }

  // ─── Assignments / visits / targets ──────────────────────────────────────

  async listAssignments(organizationId: string) {
    return this.db
      .select()
      .from(pharmacyAssignments)
      .where(eq(pharmacyAssignments.organizationId, organizationId))
      .orderBy(desc(pharmacyAssignments.createdAt));
  }

  async createAssignment(
    organizationId: string,
    input: {
      branchCode?: string;
      assignmentDate: string;
      employeeId: string;
      cityId?: string;
      areaId?: string;
      routeId?: string;
      tradeCustomerId?: string;
      doctorId?: string;
      taskType?: string;
      targetSalesPkr?: number;
      targetCollectionPkr?: number;
      notes?: string;
    },
  ) {
    if (!input.employeeId || !input.assignmentDate) {
      throw new BadRequestException("employeeId and assignmentDate are required");
    }
    let branchId: string | null = null;
    if (input.branchCode) {
      branchId = (await this.resolveBranch(organizationId, input.branchCode)).id;
    }
    const [row] = await this.db
      .insert(pharmacyAssignments)
      .values({
        organizationId,
        branchId,
        assignmentDate: input.assignmentDate,
        employeeId: input.employeeId,
        cityId: input.cityId ?? null,
        areaId: input.areaId ?? null,
        routeId: input.routeId ?? null,
        tradeCustomerId: input.tradeCustomerId ?? null,
        doctorId: input.doctorId ?? null,
        taskType: input.taskType ?? "visit",
        targetSalesPkr: Math.round(input.targetSalesPkr ?? 0),
        targetCollectionPkr: Math.round(input.targetCollectionPkr ?? 0),
        notes: input.notes ?? null,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create assignment");
    return row;
  }

  async listVisits(organizationId: string) {
    return this.db
      .select()
      .from(pharmacyVisits)
      .where(eq(pharmacyVisits.organizationId, organizationId))
      .orderBy(desc(pharmacyVisits.createdAt));
  }

  async createVisit(
    organizationId: string,
    input: {
      assignmentId?: string;
      employeeId: string;
      tradeCustomerId?: string;
      doctorId?: string;
      purpose?: string;
      status?: string;
      productive?: boolean;
      isOutstation?: boolean;
      orderId?: string;
      collectionId?: string;
      notes?: string;
    },
  ) {
    if (!input.employeeId) throw new BadRequestException("employeeId is required");
    const [row] = await this.db
      .insert(pharmacyVisits)
      .values({
        organizationId,
        assignmentId: input.assignmentId ?? null,
        employeeId: input.employeeId,
        tradeCustomerId: input.tradeCustomerId ?? null,
        doctorId: input.doctorId ?? null,
        purpose: input.purpose ?? null,
        status: input.status ?? "completed",
        productive: input.productive ?? false,
        isOutstation: input.isOutstation ?? false,
        orderId: input.orderId ?? null,
        collectionId: input.collectionId ?? null,
        notes: input.notes ?? null,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create visit");
    return row;
  }

  async listTargets(organizationId: string) {
    const rows = await this.db
      .select()
      .from(pharmacyTargets)
      .where(eq(pharmacyTargets.organizationId, organizationId))
      .orderBy(desc(pharmacyTargets.createdAt));

    const out = [];
    for (const t of rows) {
      let actualSales = t.actualSalesPkr;
      let actualCollection = t.actualCollectionPkr;
      if (t.employeeId) {
        const [salesAgg] = await this.db
          .select({ total: sql<number>`coalesce(sum(${pharmacyDistInvoices.totalPkr}), 0)` })
          .from(pharmacyDistInvoices)
          .innerJoin(pharmacyDistOrders, eq(pharmacyDistOrders.id, pharmacyDistInvoices.orderId))
          .where(
            and(
              eq(pharmacyDistInvoices.organizationId, organizationId),
              eq(pharmacyDistOrders.salesmanEmployeeId, t.employeeId),
              sql`${pharmacyDistInvoices.invoiceDate} >= ${t.periodStart}`,
              sql`${pharmacyDistInvoices.invoiceDate} <= ${t.periodEnd}`,
            ),
          );
        const [colAgg] = await this.db
          .select({ total: sql<number>`coalesce(sum(${pharmacyCollections.amountPkr}), 0)` })
          .from(pharmacyCollections)
          .where(
            and(
              eq(pharmacyCollections.organizationId, organizationId),
              eq(pharmacyCollections.salesmanEmployeeId, t.employeeId),
              sql`${pharmacyCollections.createdAt}::date >= ${t.periodStart}`,
              sql`${pharmacyCollections.createdAt}::date <= ${t.periodEnd}`,
            ),
          );
        actualSales = Number(salesAgg?.total ?? 0);
        actualCollection = Number(colAgg?.total ?? 0);
      }
      out.push({
        ...t,
        actualSalesPkr: actualSales,
        actualCollectionPkr: actualCollection,
      });
    }
    return out;
  }

  async createTarget(
    organizationId: string,
    input: {
      periodType?: string;
      periodStart: string;
      periodEnd: string;
      employeeId?: string;
      cityId?: string;
      companyId?: string;
      medicineId?: string;
      targetSalesPkr?: number;
      targetCollectionPkr?: number;
    },
  ) {
    if (!input.periodStart || !input.periodEnd) {
      throw new BadRequestException("periodStart and periodEnd are required");
    }
    const [row] = await this.db
      .insert(pharmacyTargets)
      .values({
        organizationId,
        periodType: input.periodType ?? "monthly",
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        employeeId: input.employeeId ?? null,
        cityId: input.cityId ?? null,
        companyId: input.companyId ?? null,
        medicineId: input.medicineId ?? null,
        targetSalesPkr: Math.round(input.targetSalesPkr ?? 0),
        targetCollectionPkr: Math.round(input.targetCollectionPkr ?? 0),
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create target");
    return row;
  }

  // ─── Pricing ─────────────────────────────────────────────────────────────

  async listPriceLists(organizationId: string) {
    const lists = await this.db
      .select()
      .from(pharmacyPriceLists)
      .where(eq(pharmacyPriceLists.organizationId, organizationId))
      .orderBy(desc(pharmacyPriceLists.createdAt));
    const out = [];
    for (const list of lists) {
      const items = await this.db
        .select()
        .from(pharmacyPriceListItems)
        .where(eq(pharmacyPriceListItems.priceListId, list.id));
      out.push({ ...list, items });
    }
    return out;
  }

  async createPriceList(
    organizationId: string,
    input: {
      name: string;
      priceLevel?: string;
      customerType?: string;
      areaId?: string;
      tradeCustomerId?: string;
      items?: { medicineId: string; unitPricePkr: number; minQty?: number }[];
    },
  ) {
    if (!input.name?.trim()) throw new BadRequestException("name is required");
    const code = await this.nextSeqCode(organizationId, "PL", pharmacyPriceLists, pharmacyPriceLists.code);
    const [list] = await this.db
      .insert(pharmacyPriceLists)
      .values({
        organizationId,
        code,
        name: input.name.trim(),
        priceLevel: input.priceLevel ?? "wholesale",
        customerType: input.customerType ?? null,
        areaId: input.areaId ?? null,
        tradeCustomerId: input.tradeCustomerId ?? null,
      })
      .returning();
    if (!list) throw new BadRequestException("Failed to create price list");

    for (const item of input.items ?? []) {
      await this.db.insert(pharmacyPriceListItems).values({
        priceListId: list.id,
        medicineId: item.medicineId,
        unitPricePkr: Math.round(item.unitPricePkr),
        minQty: Math.round(item.minQty ?? 1),
      });
    }

    const items = await this.db
      .select()
      .from(pharmacyPriceListItems)
      .where(eq(pharmacyPriceListItems.priceListId, list.id));
    return { ...list, items };
  }

  async listSchemes(organizationId: string) {
    return this.db
      .select()
      .from(pharmacySchemes)
      .where(eq(pharmacySchemes.organizationId, organizationId))
      .orderBy(desc(pharmacySchemes.createdAt));
  }

  async createScheme(
    organizationId: string,
    input: {
      name: string;
      schemeType?: string;
      medicineId?: string;
      companyId?: string;
      buyQty?: number;
      freeQty?: number;
      startDate?: string;
      endDate?: string;
    },
  ) {
    if (!input.name?.trim()) throw new BadRequestException("name is required");
    const code = await this.nextSeqCode(organizationId, "SCH", pharmacySchemes, pharmacySchemes.code);
    const [row] = await this.db
      .insert(pharmacySchemes)
      .values({
        organizationId,
        code,
        name: input.name.trim(),
        schemeType: input.schemeType ?? "buy_x_get_y",
        medicineId: input.medicineId ?? null,
        companyId: input.companyId ?? null,
        buyQty: Math.round(input.buyQty ?? 0),
        freeQty: Math.round(input.freeQty ?? 0),
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create scheme");
    return row;
  }

  /**
   * Priority: customer price list → area → customer type → wholesale/dealer on medicine → retail sellingPrice
   * Delegates to SalesPricingService (single pricing engine for Sale Window + createDistOrder).
   */
  async resolvePrice(
    organizationId: string,
    medicineId: string,
    opts: { tradeCustomerId?: string; priceLevel?: string; qty?: number } = {},
  ) {
    return this.pricing.resolvePrice(organizationId, medicineId, opts);
  }

  /**
   * Buy X Get Y free qty from active schemes.
   * Priority ASC (lower = higher priority); max free as tie-break — see SalesPricingService.
   */
  async resolveSchemeFreeQty(organizationId: string, medicineId: string, buyQty: number): Promise<number> {
    return this.pricing.resolveSchemeFreeQty(organizationId, medicineId, buyQty);
  }

  async listWholesaleReturns(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    return this.db
      .select()
      .from(pharmacyWholesaleReturns)
      .where(
        and(
          eq(pharmacyWholesaleReturns.organizationId, organizationId),
          eq(pharmacyWholesaleReturns.branchId, branch.id),
        ),
      )
      .orderBy(desc(pharmacyWholesaleReturns.createdAt));
  }

  async createWholesaleReturn(
    organizationId: string,
    input: {
      branchCode: string;
      tradeCustomerId: string;
      invoiceId?: string;
      warehouseId?: string;
      reason?: string;
      lines: { medicineId: string; batchId?: string; quantity: number; unitPricePkr?: number }[];
    },
    userId?: string,
  ) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    if (!input.tradeCustomerId || !input.lines?.length) {
      throw new BadRequestException("tradeCustomerId and lines are required");
    }
    const warehouse = input.warehouseId
      ? (
          await this.db
            .select()
            .from(pharmacyWarehouses)
            .where(eq(pharmacyWarehouses.id, input.warehouseId))
            .limit(1)
        )[0]
      : await this.stock.ensureDefaultWarehouse(organizationId, branch.id);

    const ret = await this.db.transaction(async (tx) => {
      let total = 0;
      const prepared: { medicineId: string; batchId?: string | null; quantity: number; unitPricePkr: number; lineTotalPkr: number }[] = [];
      for (const line of input.lines) {
        const qty = Math.round(line.quantity);
        if (qty <= 0) continue;
        const unit = Math.round(line.unitPricePkr ?? 0);
        const lineTotal = qty * unit;
        total += lineTotal;
        prepared.push({
          medicineId: line.medicineId,
          batchId: line.batchId ?? null,
          quantity: qty,
          unitPricePkr: unit,
          lineTotalPkr: lineTotal,
        });
      }
      if (!prepared.length) throw new BadRequestException("No valid return lines");

      const [created] = await tx
        .insert(pharmacyWholesaleReturns)
        .values({
          organizationId,
          branchId: branch.id,
          returnNumber: this.nextRef("WRN"),
          invoiceId: input.invoiceId ?? null,
          tradeCustomerId: input.tradeCustomerId,
          warehouseId: warehouse?.id ?? null,
          reason: input.reason ?? null,
          totalPkr: total,
          status: "posted",
          createdByUserId: userId ?? null,
        })
        .returning();
      if (!created) throw new BadRequestException("Failed to create wholesale return");

      for (const [lineIndex, line] of prepared.entries()) {
        if (line.batchId) {
          await this.stock.restoreBatch(tx, {
            organizationId,
            branchId: branch.id,
            medicineId: line.medicineId,
            batchId: line.batchId,
            qty: line.quantity,
            warehouseId: warehouse?.id,
            referenceType: "wholesale_return",
            referenceId: created.id,
            movementType: MOVEMENT_TYPES.SALES_RETURN,
            idempotencyKey: `wholesale-return:${created.id}:${lineIndex}`,
            createdByUserId: userId,
          });
        } else if (warehouse?.id) {
          await this.stock.receiveBatch(tx, {
            organizationId,
            branchId: branch.id,
            warehouseId: warehouse.id,
            medicineId: line.medicineId,
            batchNumber: `WRN-${Date.now().toString().slice(-6)}`,
            expiryDate: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
            quantity: line.quantity,
            purchaseRatePkr: line.unitPricePkr,
            saleRatePkr: line.unitPricePkr,
            referenceType: "wholesale_return",
            referenceId: created.id,
            movementType: MOVEMENT_TYPES.SALES_RETURN,
            idempotencyKey: `wholesale-return:${created.id}:${lineIndex}`,
            createdByUserId: userId,
          });
        }
        await tx.insert(pharmacyWholesaleReturnLines).values({
          returnId: created.id,
          medicineId: line.medicineId,
          batchId: line.batchId ?? null,
          quantity: line.quantity,
          unitPricePkr: line.unitPricePkr,
          lineTotalPkr: line.lineTotalPkr,
        });
      }

      const [customer] = await tx
        .select()
        .from(pharmacyTradeCustomers)
        .where(eq(pharmacyTradeCustomers.id, input.tradeCustomerId))
        .limit(1);
      if (customer) {
        await tx
          .update(pharmacyTradeCustomers)
          .set({ outstandingPkr: Math.max(0, customer.outstandingPkr - total) })
          .where(eq(pharmacyTradeCustomers.id, customer.id));
      }
      if (input.invoiceId) {
        const [inv] = await tx
          .select()
          .from(pharmacyDistInvoices)
          .where(eq(pharmacyDistInvoices.id, input.invoiceId))
          .limit(1);
        if (inv) {
          await tx
            .update(pharmacyDistInvoices)
            .set({
              amountDuePkr: Math.max(0, inv.amountDuePkr - total),
            })
            .where(eq(pharmacyDistInvoices.id, inv.id));
        }
      }
      return created;
    });

    try {
      await this.accountingHooks.recordDistWholesaleReturn(organizationId, ret.branchId, {
        returnNumber: ret.returnNumber,
        totalPkr: ret.totalPkr,
        createdAt: ret.createdAt,
      });
    } catch (err) {
      this.logger.error(
        `WRN ${ret.returnNumber} missing journal: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const lines = await this.db
      .select()
      .from(pharmacyWholesaleReturnLines)
      .where(eq(pharmacyWholesaleReturnLines.returnId, ret.id));
    return { ...ret, lines };
  }

  async listEmployeesForPicker(organizationId: string) {
    return this.db
      .select({
        id: popsEmployees.id,
        employeeCode: popsEmployees.employeeCode,
        name: popsEmployees.displayName,
      })
      .from(popsEmployees)
      .where(eq(popsEmployees.organizationId, organizationId))
      .orderBy(popsEmployees.displayName)
      .limit(500);
  }

  /** Advance dist order through warehouse / dispatch pipeline. */
  async advanceDistOrderStatus(
    organizationId: string,
    id: string,
    nextStatus: string,
    userId?: string,
  ) {
    const order = await this.getDistOrder(organizationId, id);
    const allowed: Record<string, string[]> = {
      draft: ["booked", "cancelled"],
      submitted: ["booked", "approved", "cancelled"],
      booked: ["approved", "cancelled"],
      approved: ["stock_reserved", "picking", "cancelled"],
      stock_reserved: ["picking", "cancelled"],
      picking: ["packed", "cancelled"],
      packed: ["ready_for_dispatch", "cancelled"],
      ready_for_dispatch: ["dispatched", "cancelled"],
      invoiced: ["dispatched", "delivered", "cancelled"],
      dispatched: ["delivered", "cancelled"],
    };
    const from = order.status;
    if (!(allowed[from] ?? []).includes(nextStatus)) {
      throw new BadRequestException(`Cannot move order from ${from} to ${nextStatus}`);
    }
    const now = new Date();
    const patch: Record<string, unknown> = { status: nextStatus };
    if (nextStatus === "booked") patch.bookedAt = now;
    if (nextStatus === "stock_reserved") patch.stockReservedAt = now;
    if (nextStatus === "picking") patch.pickingAt = now;
    if (nextStatus === "packed") patch.packedAt = now;
    if (nextStatus === "ready_for_dispatch") patch.readyAt = now;
    if (nextStatus === "dispatched") {
      patch.dispatchedAt = now;
      patch.deliveryStatus = "dispatched";
    }
    if (nextStatus === "delivered") {
      patch.deliveredAt = now;
      patch.deliveryStatus = "delivered";
    }
    if (nextStatus === "cancelled") patch.cancelledAt = now;

    const updated = await this.db.transaction(async (tx) => {
      if (nextStatus === "stock_reserved") {
        const [alreadyHeld] = await tx
          .select({ id: pharmacyStockReservations.id })
          .from(pharmacyStockReservations)
          .where(
            and(
              eq(pharmacyStockReservations.organizationId, organizationId),
              eq(pharmacyStockReservations.referenceType, "dist_order"),
              eq(pharmacyStockReservations.referenceId, order.id),
              eq(pharmacyStockReservations.status, "active"),
            ),
          )
          .limit(1);
        if (alreadyHeld) {
          throw new ConflictException("This order already holds reserved stock");
        }

        for (const line of order.lines) {
          const qty = line.quantity + line.freeQuantity;
          if (qty <= 0) continue;
          const held = await this.stock.reserve(tx, {
            organizationId,
            branchId: order.branchId,
            medicineId: line.medicineId,
            qty,
            warehouseId: order.warehouseId ?? undefined,
            preferredBatchId: line.batchId ?? undefined,
            referenceType: "dist_order",
            referenceId: order.id,
            createdByUserId: userId,
          });
          // A partial hold is worse than no hold: the order would report
          // "reserved" while only part of the stock is actually protected.
          if (held.shortfall > 0) {
            const [med] = await tx
              .select({ name: pharmacyMedicines.name })
              .from(pharmacyMedicines)
              .where(eq(pharmacyMedicines.id, line.medicineId))
              .limit(1);
            throw new BadRequestException(
              `Cannot reserve ${qty} of ${med?.name ?? "this item"} — short by ${held.shortfall}. Order not reserved.`,
            );
          }
        }
      }

      if (nextStatus === "cancelled") {
        await this.stock.releaseReservations(tx, {
          organizationId,
          branchId: order.branchId,
          referenceType: "dist_order",
          referenceId: order.id,
          outcome: "released",
          createdByUserId: userId,
        });
      }

      const [row] = await tx
        .update(pharmacyDistOrders)
        .set(patch)
        .where(eq(pharmacyDistOrders.id, id))
        .returning();
      return row;
    });

    return { ...updated, lines: order.lines };
  }

  async getDistributionPsWindow(organizationId: string, branchCode?: string) {
    const branch = branchCode?.trim()
      ? await this.resolveBranch(organizationId, branchCode.trim())
      : null;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
    const lastMonthStart = new Date(todayStart.getFullYear(), todayStart.getMonth() - 1, 1);
    const lastMonthEnd = new Date(monthStart.getTime() - 1);

    const todayStr = todayStart.toISOString().slice(0, 10);
    const in7 = new Date(todayStart);
    in7.setDate(in7.getDate() + 7);
    const in30 = new Date(todayStart);
    in30.setDate(in30.getDate() + 30);
    const expiry7 = in7.toISOString().slice(0, 10);
    const expiry30 = in30.toISOString().slice(0, 10);

    const orderOrg = eq(pharmacyDistOrders.organizationId, organizationId);
    const orderWhere = branch ? and(orderOrg, eq(pharmacyDistOrders.branchId, branch.id)) : orderOrg;

    const invOrg = eq(pharmacyDistInvoices.organizationId, organizationId);
    const invWhere = branch ? and(invOrg, eq(pharmacyDistInvoices.branchId, branch.id)) : invOrg;

    const delOrg = eq(pharmacyDeliveries.organizationId, organizationId);
    const delWhere = branch ? and(delOrg, eq(pharmacyDeliveries.branchId, branch.id)) : delOrg;

    const colOrg = eq(pharmacyCollections.organizationId, organizationId);
    const colWhere = branch ? and(colOrg, eq(pharmacyCollections.branchId, branch.id)) : colOrg;

    const retOrg = eq(pharmacyWholesaleReturns.organizationId, organizationId);
    const retWhere = branch ? and(retOrg, eq(pharmacyWholesaleReturns.branchId, branch.id)) : retOrg;

    const poOrg = eq(pharmacyPurchaseOrders.organizationId, organizationId);
    const poWhere = branch ? and(poOrg, eq(pharmacyPurchaseOrders.branchId, branch.id)) : poOrg;

    const grnOrg = eq(pharmacyGrns.organizationId, organizationId);
    const grnWhere = branch ? and(grnOrg, eq(pharmacyGrns.branchId, branch.id)) : grnOrg;

    const medOrg = eq(pharmacyMedicines.organizationId, organizationId);
    const medWhere = branch ? and(medOrg, eq(pharmacyMedicines.branchId, branch.id)) : medOrg;

    const [
      orderAgg,
      invoiceAgg,
      deliveryAgg,
      collectionAgg,
      returnAgg,
      custAgg,
      expiryAgg,
      stockAgg,
      visitAgg,
      assignAgg,
      poAgg,
      purchaseTodayAgg,
      gpAgg,
    ] = await Promise.all([
      this.db
        .select({
          ordersToday: sql<number>`count(*) filter (where ${pharmacyDistOrders.createdAt} >= ${todayStart})::int`,
          salesTodayPkr: sql<number>`coalesce(sum(${pharmacyDistOrders.totalPkr}) filter (where ${pharmacyDistOrders.createdAt} >= ${todayStart} and ${pharmacyDistOrders.status} not in ('cancelled','draft')), 0)::int`,
          salesYesterdayPkr: sql<number>`coalesce(sum(${pharmacyDistOrders.totalPkr}) filter (where ${pharmacyDistOrders.createdAt} >= ${yesterdayStart} and ${pharmacyDistOrders.createdAt} < ${todayStart} and ${pharmacyDistOrders.status} not in ('cancelled','draft')), 0)::int`,
          salesMonthPkr: sql<number>`coalesce(sum(${pharmacyDistOrders.totalPkr}) filter (where ${pharmacyDistOrders.createdAt} >= ${monthStart} and ${pharmacyDistOrders.status} not in ('cancelled','draft')), 0)::int`,
          salesLastMonthPkr: sql<number>`coalesce(sum(${pharmacyDistOrders.totalPkr}) filter (where ${pharmacyDistOrders.createdAt} >= ${lastMonthStart} and ${pharmacyDistOrders.createdAt} <= ${lastMonthEnd} and ${pharmacyDistOrders.status} not in ('cancelled','draft')), 0)::int`,
          pendingApproval: sql<number>`count(*) filter (where ${pharmacyDistOrders.status} in ('booked','submitted'))::int`,
          heldOrders: sql<number>`count(*) filter (where ${pharmacyDistOrders.status} = 'draft')::int`,
          pendingOrders: sql<number>`count(*) filter (where ${pharmacyDistOrders.status} in ('draft','booked','submitted','approved','stock_reserved','picking','packed','ready_for_dispatch'))::int`,
          inWarehousePipeline: sql<number>`count(*) filter (where ${pharmacyDistOrders.status} in ('approved','stock_reserved','picking','packed','ready_for_dispatch'))::int`,
          creditOverridesToday: sql<number>`count(*) filter (where ${pharmacyDistOrders.creditOverride} = true and ${pharmacyDistOrders.createdAt} >= ${todayStart})::int`,
        })
        .from(pharmacyDistOrders)
        .where(orderWhere)
        .then((r) => r[0]),

      this.db
        .select({
          invoicesToday: sql<number>`count(*) filter (where ${pharmacyDistInvoices.createdAt} >= ${todayStart})::int`,
          grossSalesTodayPkr: sql<number>`coalesce(sum(${pharmacyDistInvoices.totalPkr}) filter (where ${pharmacyDistInvoices.createdAt} >= ${todayStart}), 0)::int`,
          cashSalesTodayPkr: sql<number>`coalesce(sum(${pharmacyDistInvoices.totalPkr}) filter (where ${pharmacyDistInvoices.createdAt} >= ${todayStart} and lower(${pharmacyDistInvoices.paymentMethod}) in ('cash','cod')), 0)::int`,
          creditSalesTodayPkr: sql<number>`coalesce(sum(${pharmacyDistInvoices.totalPkr}) filter (where ${pharmacyDistInvoices.createdAt} >= ${todayStart} and lower(${pharmacyDistInvoices.paymentMethod}) not in ('cash','cod')), 0)::int`,
          amountDueOpenPkr: sql<number>`coalesce(sum(${pharmacyDistInvoices.amountDuePkr}) filter (where ${pharmacyDistInvoices.amountDuePkr} > 0), 0)::int`,
          openDueInvoices: sql<number>`count(*) filter (where ${pharmacyDistInvoices.amountDuePkr} > 0)::int`,
        })
        .from(pharmacyDistInvoices)
        .where(invWhere)
        .then((r) => r[0]),

      this.db
        .select({
          pendingDeliveries: sql<number>`count(*) filter (where ${pharmacyDeliveries.status} not in ('delivered','cancelled'))::int`,
        })
        .from(pharmacyDeliveries)
        .where(delWhere)
        .then((r) => r[0]),

      this.db
        .select({
          collectionsTodayPkr: sql<number>`coalesce(sum(${pharmacyCollections.amountPkr}) filter (where ${pharmacyCollections.createdAt} >= ${todayStart}), 0)::int`,
          collectionsTodayCount: sql<number>`count(*) filter (where ${pharmacyCollections.createdAt} >= ${todayStart})::int`,
        })
        .from(pharmacyCollections)
        .where(colWhere)
        .then((r) => r[0]),

      this.db
        .select({
          returnsTodayPkr: sql<number>`coalesce(sum(${pharmacyWholesaleReturns.totalPkr}) filter (where ${pharmacyWholesaleReturns.createdAt} >= ${todayStart}), 0)::int`,
          returnsTodayCount: sql<number>`count(*) filter (where ${pharmacyWholesaleReturns.createdAt} >= ${todayStart})::int`,
        })
        .from(pharmacyWholesaleReturns)
        .where(retWhere)
        .then((r) => r[0]),

      this.db
        .select({
          outstandingPkr: sql<number>`coalesce(sum(${pharmacyTradeCustomers.outstandingPkr}), 0)::int`,
          overdueAccounts: sql<number>`count(*) filter (where ${pharmacyTradeCustomers.outstandingPkr} > 0)::int`,
          creditExceeded: sql<number>`count(*) filter (where ${pharmacyTradeCustomers.creditLimitPkr} > 0 and ${pharmacyTradeCustomers.outstandingPkr} > ${pharmacyTradeCustomers.creditLimitPkr})::int`,
        })
        .from(pharmacyTradeCustomers)
        .where(eq(pharmacyTradeCustomers.organizationId, organizationId))
        .then((r) => r[0]),

      this.db
        .select({
          expiredBatches: sql<number>`count(*) filter (where ${pharmacyMedicineBatches.expiryDate} < ${todayStr} and ${pharmacyMedicineBatches.quantity} >= 1)::int`,
          nearExpiry7: sql<number>`count(*) filter (where ${pharmacyMedicineBatches.expiryDate} >= ${todayStr} and ${pharmacyMedicineBatches.expiryDate} <= ${expiry7} and ${pharmacyMedicineBatches.quantity} >= 1)::int`,
          nearExpiry30: sql<number>`count(*) filter (where ${pharmacyMedicineBatches.expiryDate} > ${expiry7} and ${pharmacyMedicineBatches.expiryDate} <= ${expiry30} and ${pharmacyMedicineBatches.quantity} >= 1)::int`,
          nearExpiryValuePkr: sql<number>`coalesce(sum((${pharmacyMedicineBatches.quantity}) * (${pharmacyMedicineBatches.purchaseRatePkr})) filter (where ${pharmacyMedicineBatches.expiryDate} <= ${expiry30} and ${pharmacyMedicineBatches.quantity} >= 1), 0)::int`,
        })
        .from(pharmacyMedicineBatches)
        .innerJoin(pharmacyMedicines, eq(pharmacyMedicineBatches.medicineId, pharmacyMedicines.id))
        .where(medWhere)
        .then((r) => r[0]),

      this.db
        .select({
          lowStockSkus: sql<number>`count(*) filter (where ${pharmacyMedicines.status} = 'active' and ${pharmacyMedicines.currentStock} <= ${pharmacyMedicines.reorderLevel})::int`,
          stockValuePkr: sql<number>`coalesce(sum(${pharmacyMedicines.currentStock} * ${pharmacyMedicines.costPricePkr}), 0)::int`,
        })
        .from(pharmacyMedicines)
        .where(medWhere)
        .then((r) => r[0]),

      this.db
        .select({
          visitsToday: sql<number>`count(*) filter (where ${pharmacyVisits.visitedAt} >= ${todayStart})::int`,
        })
        .from(pharmacyVisits)
        .where(eq(pharmacyVisits.organizationId, organizationId))
        .then((r) => r[0]),

      this.db
        .select({ assignmentsOpen: sql<number>`count(*) filter (where ${pharmacyAssignments.status} in ('assigned','in_progress'))::int` })
        .from(pharmacyAssignments)
        .where(
          branch
            ? and(eq(pharmacyAssignments.organizationId, organizationId), eq(pharmacyAssignments.branchId, branch.id))
            : eq(pharmacyAssignments.organizationId, organizationId),
        )
        .then((r) => r[0]),

      this.db
        .select({
          pendingPurchaseOrders: sql<number>`count(*) filter (where ${pharmacyPurchaseOrders.status} in ('draft','approved'))::int`,
        })
        .from(pharmacyPurchaseOrders)
        .where(poWhere)
        .then((r) => r[0]),

      this.db
        .select({
          purchaseTodayPkr: sql<number>`coalesce(sum(${pharmacyGrns.totalPkr}) filter (where ${pharmacyGrns.createdAt} >= ${todayStart}), 0)::int`,
        })
        .from(pharmacyGrns)
        .where(grnWhere)
        .then((r) => r[0]),

      this.db
        .select({
          grossProfitTodayPkr: sql<number>`coalesce(sum(
            ${pharmacyDistInvoiceLines.lineTotalPkr} - (${pharmacyDistInvoiceLines.quantity} * coalesce(${pharmacyMedicineBatches.purchaseRatePkr}, ${pharmacyMedicines.costPricePkr}, 0))
          ), 0)::int`,
        })
        .from(pharmacyDistInvoiceLines)
        .innerJoin(pharmacyDistInvoices, eq(pharmacyDistInvoiceLines.invoiceId, pharmacyDistInvoices.id))
        .innerJoin(pharmacyMedicines, eq(pharmacyDistInvoiceLines.medicineId, pharmacyMedicines.id))
        .leftJoin(pharmacyMedicineBatches, eq(pharmacyDistInvoiceLines.batchId, pharmacyMedicineBatches.id))
        .where(and(invWhere, gte(pharmacyDistInvoices.createdAt, todayStart)))
        .then((r) => r[0]),
    ]);

    const grossSales = invoiceAgg?.grossSalesTodayPkr ?? 0;
    const returnsToday = returnAgg?.returnsTodayPkr ?? 0;
    const netSalesTodayPkr = Math.max(0, grossSales - returnsToday);
    const salesTodayFallback = orderAgg?.salesTodayPkr ?? 0;
    const salesTodayPkr = grossSales > 0 ? grossSales : salesTodayFallback;

    const actions: {
      id: string;
      severity: "danger" | "warning" | "info";
      label: string;
      count: number;
      href: string;
    }[] = [];

    const pushAction = (
      id: string,
      severity: "danger" | "warning" | "info",
      label: string,
      count: number,
      href: string,
    ) => {
      if (count > 0) actions.push({ id, severity, label, count, href });
    };

    pushAction(
      "pending-approval",
      "warning",
      "Orders pending approval",
      orderAgg?.pendingApproval ?? 0,
      "/pops/distribution/orders?focus=pendingApproval",
    );
    pushAction(
      "credit-override",
      "warning",
      "Credit overrides today",
      orderAgg?.creditOverridesToday ?? 0,
      "/pops/distribution/orders?focus=creditOverride",
    );
    pushAction(
      "low-stock",
      "warning",
      "Low stock SKUs",
      stockAgg?.lowStockSkus ?? 0,
      "/pops/distribution/inventory?focus=lowStock",
    );
    pushAction(
      "near-expiry",
      "warning",
      "Near expiry (30d)",
      (expiryAgg?.nearExpiry7 ?? 0) + (expiryAgg?.nearExpiry30 ?? 0),
      "/pops/distribution/expiry?focus=near",
    );
    pushAction(
      "expired",
      "danger",
      "Expired stock batches",
      expiryAgg?.expiredBatches ?? 0,
      "/pops/distribution/expiry?focus=expired",
    );
    pushAction(
      "overdue",
      "danger",
      "Customers with outstanding",
      custAgg?.overdueAccounts ?? 0,
      "/pops/distribution/aging?focus=overdue",
    );
    pushAction(
      "credit-exceeded",
      "danger",
      "Credit limit exceeded",
      custAgg?.creditExceeded ?? 0,
      "/pops/distribution/aging?focus=creditExceeded",
    );
    pushAction(
      "pending-delivery",
      "info",
      "Pending deliveries",
      deliveryAgg?.pendingDeliveries ?? 0,
      "/pops/distribution/deliveries?focus=pending",
    );
    pushAction(
      "pending-collection",
      "info",
      "Invoices with open dues",
      invoiceAgg?.openDueInvoices ?? 0,
      "/pops/distribution/collections",
    );
    pushAction(
      "pending-po",
      "info",
      "Pending purchase orders",
      poAgg?.pendingPurchaseOrders ?? 0,
      "/pops/distribution/purchase-orders?focus=pending",
    );

    return {
      generatedAt: new Date().toISOString(),
      today: {
        ordersToday: orderAgg?.ordersToday ?? 0,
        salesTodayPkr,
        netSalesTodayPkr: grossSales > 0 ? netSalesTodayPkr : salesTodayPkr,
        cashSalesTodayPkr: invoiceAgg?.cashSalesTodayPkr ?? 0,
        creditSalesTodayPkr: invoiceAgg?.creditSalesTodayPkr ?? (salesTodayPkr > 0 ? salesTodayPkr : 0),
        returnsTodayPkr: returnsToday,
        returnsTodayCount: returnAgg?.returnsTodayCount ?? 0,
        collectionsTodayPkr: collectionAgg?.collectionsTodayPkr ?? 0,
        collectionsTodayCount: collectionAgg?.collectionsTodayCount ?? 0,
        outstandingPkr: custAgg?.outstandingPkr ?? 0,
        purchaseTodayPkr: purchaseTodayAgg?.purchaseTodayPkr ?? 0,
        grossProfitTodayPkr: gpAgg?.grossProfitTodayPkr ?? 0,
        lowStockSkus: stockAgg?.lowStockSkus ?? 0,
        nearExpiryBatches: (expiryAgg?.nearExpiry7 ?? 0) + (expiryAgg?.nearExpiry30 ?? 0),
        expiredBatches: expiryAgg?.expiredBatches ?? 0,
        pendingDeliveries: deliveryAgg?.pendingDeliveries ?? 0,
        pendingOrders: orderAgg?.pendingOrders ?? 0,
        heldOrders: orderAgg?.heldOrders ?? 0,
        invoicesToday: invoiceAgg?.invoicesToday ?? 0,
      },
      comparisons: {
        salesYesterdayPkr: orderAgg?.salesYesterdayPkr ?? 0,
        salesMonthPkr: orderAgg?.salesMonthPkr ?? 0,
        salesLastMonthPkr: orderAgg?.salesLastMonthPkr ?? 0,
      },
      stock: {
        nearExpiryBatches: (expiryAgg?.nearExpiry7 ?? 0) + (expiryAgg?.nearExpiry30 ?? 0),
        nearExpiry7: expiryAgg?.nearExpiry7 ?? 0,
        nearExpiry30: expiryAgg?.nearExpiry30 ?? 0,
        expiredBatches: expiryAgg?.expiredBatches ?? 0,
        nearExpiryValuePkr: expiryAgg?.nearExpiryValuePkr ?? 0,
        lowStockSkus: stockAgg?.lowStockSkus ?? 0,
        stockValuePkr: stockAgg?.stockValuePkr ?? 0,
      },
      sales: {
        ordersToday: orderAgg?.ordersToday ?? 0,
        salesTodayPkr,
        pendingApproval: orderAgg?.pendingApproval ?? 0,
        inWarehousePipeline: orderAgg?.inWarehousePipeline ?? 0,
        heldOrders: orderAgg?.heldOrders ?? 0,
        creditOverridesToday: orderAgg?.creditOverridesToday ?? 0,
      },
      distribution: {
        pendingDeliveries: deliveryAgg?.pendingDeliveries ?? 0,
        outstandingPkr: custAgg?.outstandingPkr ?? 0,
        overdueAccounts: custAgg?.overdueAccounts ?? 0,
        creditExceeded: custAgg?.creditExceeded ?? 0,
        pendingPurchaseOrders: poAgg?.pendingPurchaseOrders ?? 0,
      },
      field: {
        visitsToday: visitAgg?.visitsToday ?? 0,
        assignmentsOpen: assignAgg?.assignmentsOpen ?? 0,
      },
      actions,
    };
  }

  /** Lazy management widgets for PS Window (tops, aging, performance). */
  async getDistributionPsWidgets(organizationId: string, branchCode?: string) {
    const branch = branchCode?.trim()
      ? await this.resolveBranch(organizationId, branchCode.trim())
      : null;

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const d30 = new Date(todayStart);
    d30.setDate(d30.getDate() - 30);
    const d60 = new Date(todayStart);
    d60.setDate(d60.getDate() - 60);
    const d90 = new Date(todayStart);
    d90.setDate(d90.getDate() - 90);
    const d120 = new Date(todayStart);
    d120.setDate(d120.getDate() - 120);

    const invOrg = eq(pharmacyDistInvoices.organizationId, organizationId);
    const invWhere = branch ? and(invOrg, eq(pharmacyDistInvoices.branchId, branch.id)) : invOrg;
    const orderOrg = eq(pharmacyDistOrders.organizationId, organizationId);
    const orderWhere = branch ? and(orderOrg, eq(pharmacyDistOrders.branchId, branch.id)) : orderOrg;
    const colOrg = eq(pharmacyCollections.organizationId, organizationId);
    const colWhere = branch ? and(colOrg, eq(pharmacyCollections.branchId, branch.id)) : colOrg;

    const monthInvWhere = and(invWhere, gte(pharmacyDistInvoices.createdAt, monthStart));

    const [topMedicines, topCustomers, topCompanies, salesmanPerf, routePerf, recoveryPerf, agingAgg] =
      await Promise.all([
        this.db
          .select({
            medicineId: pharmacyDistInvoiceLines.medicineId,
            name: pharmacyMedicines.name,
            sku: pharmacyMedicines.sku,
            qty: sql<number>`coalesce(sum(${pharmacyDistInvoiceLines.quantity}), 0)::int`,
            amountPkr: sql<number>`coalesce(sum(${pharmacyDistInvoiceLines.lineTotalPkr}), 0)::int`,
          })
          .from(pharmacyDistInvoiceLines)
          .innerJoin(pharmacyDistInvoices, eq(pharmacyDistInvoiceLines.invoiceId, pharmacyDistInvoices.id))
          .innerJoin(pharmacyMedicines, eq(pharmacyDistInvoiceLines.medicineId, pharmacyMedicines.id))
          .where(monthInvWhere)
          .groupBy(pharmacyDistInvoiceLines.medicineId, pharmacyMedicines.name, pharmacyMedicines.sku)
          .orderBy(sql`sum(${pharmacyDistInvoiceLines.lineTotalPkr}) desc`)
          .limit(8),

        this.db
          .select({
            tradeCustomerId: pharmacyDistInvoices.tradeCustomerId,
            name: pharmacyTradeCustomers.name,
            code: pharmacyTradeCustomers.code,
            amountPkr: sql<number>`coalesce(sum(${pharmacyDistInvoices.totalPkr}), 0)::int`,
            invoices: sql<number>`count(*)::int`,
          })
          .from(pharmacyDistInvoices)
          .innerJoin(
            pharmacyTradeCustomers,
            eq(pharmacyDistInvoices.tradeCustomerId, pharmacyTradeCustomers.id),
          )
          .where(monthInvWhere)
          .groupBy(
            pharmacyDistInvoices.tradeCustomerId,
            pharmacyTradeCustomers.name,
            pharmacyTradeCustomers.code,
          )
          .orderBy(sql`sum(${pharmacyDistInvoices.totalPkr}) desc`)
          .limit(8),

        this.db
          .select({
            companyId: pharmacyCompanies.id,
            name: pharmacyCompanies.name,
            code: pharmacyCompanies.code,
            amountPkr: sql<number>`coalesce(sum(${pharmacyDistInvoiceLines.lineTotalPkr}), 0)::int`,
          })
          .from(pharmacyDistInvoiceLines)
          .innerJoin(pharmacyDistInvoices, eq(pharmacyDistInvoiceLines.invoiceId, pharmacyDistInvoices.id))
          .innerJoin(pharmacyMedicines, eq(pharmacyDistInvoiceLines.medicineId, pharmacyMedicines.id))
          .innerJoin(pharmacyCompanies, eq(pharmacyMedicines.companyId, pharmacyCompanies.id))
          .where(monthInvWhere)
          .groupBy(pharmacyCompanies.id, pharmacyCompanies.name, pharmacyCompanies.code)
          .orderBy(sql`sum(${pharmacyDistInvoiceLines.lineTotalPkr}) desc`)
          .limit(8),

        this.db
          .select({
            employeeId: pharmacyDistOrders.salesmanEmployeeId,
            name: popsEmployees.displayName,
            amountPkr: sql<number>`coalesce(sum(${pharmacyDistOrders.totalPkr}), 0)::int`,
            orders: sql<number>`count(*)::int`,
          })
          .from(pharmacyDistOrders)
          .innerJoin(popsEmployees, eq(pharmacyDistOrders.salesmanEmployeeId, popsEmployees.id))
          .where(
            and(
              orderWhere,
              gte(pharmacyDistOrders.createdAt, monthStart),
              sql`${pharmacyDistOrders.salesmanEmployeeId} is not null`,
              sql`${pharmacyDistOrders.status} not in ('cancelled','draft')`,
            ),
          )
          .groupBy(pharmacyDistOrders.salesmanEmployeeId, popsEmployees.displayName)
          .orderBy(sql`sum(${pharmacyDistOrders.totalPkr}) desc`)
          .limit(8),

        this.db
          .select({
            routeId: pharmacyDeliveries.routeId,
            name: pharmacyRoutes.name,
            code: pharmacyRoutes.code,
            deliveries: sql<number>`count(*)::int`,
            delivered: sql<number>`count(*) filter (where ${pharmacyDeliveries.status} = 'delivered')::int`,
            collectedPkr: sql<number>`coalesce(sum(${pharmacyDeliveries.collectedPkr}), 0)::int`,
          })
          .from(pharmacyDeliveries)
          .leftJoin(pharmacyRoutes, eq(pharmacyDeliveries.routeId, pharmacyRoutes.id))
          .where(
            and(
              branch
                ? and(eq(pharmacyDeliveries.organizationId, organizationId), eq(pharmacyDeliveries.branchId, branch.id))
                : eq(pharmacyDeliveries.organizationId, organizationId),
              gte(pharmacyDeliveries.createdAt, monthStart),
              sql`${pharmacyDeliveries.routeId} is not null`,
            ),
          )
          .groupBy(pharmacyDeliveries.routeId, pharmacyRoutes.name, pharmacyRoutes.code)
          .orderBy(sql`count(*) desc`)
          .limit(8),

        this.db
          .select({
            employeeId: pharmacyCollections.salesmanEmployeeId,
            name: popsEmployees.displayName,
            amountPkr: sql<number>`coalesce(sum(${pharmacyCollections.amountPkr}), 0)::int`,
            receipts: sql<number>`count(*)::int`,
          })
          .from(pharmacyCollections)
          .innerJoin(popsEmployees, eq(pharmacyCollections.salesmanEmployeeId, popsEmployees.id))
          .where(
            and(
              colWhere,
              gte(pharmacyCollections.createdAt, monthStart),
              sql`${pharmacyCollections.salesmanEmployeeId} is not null`,
            ),
          )
          .groupBy(pharmacyCollections.salesmanEmployeeId, popsEmployees.displayName)
          .orderBy(sql`sum(${pharmacyCollections.amountPkr}) desc`)
          .limit(8),

        this.db
          .select({
            currentPkr: sql<number>`coalesce(sum(${pharmacyDistInvoices.amountDuePkr}) filter (where ${pharmacyDistInvoices.invoiceDate}::date >= ${d30.toISOString().slice(0, 10)}), 0)::int`,
            d31to60Pkr: sql<number>`coalesce(sum(${pharmacyDistInvoices.amountDuePkr}) filter (where ${pharmacyDistInvoices.invoiceDate}::date < ${d30.toISOString().slice(0, 10)} and ${pharmacyDistInvoices.invoiceDate}::date >= ${d60.toISOString().slice(0, 10)}), 0)::int`,
            d61to90Pkr: sql<number>`coalesce(sum(${pharmacyDistInvoices.amountDuePkr}) filter (where ${pharmacyDistInvoices.invoiceDate}::date < ${d60.toISOString().slice(0, 10)} and ${pharmacyDistInvoices.invoiceDate}::date >= ${d90.toISOString().slice(0, 10)}), 0)::int`,
            d91to120Pkr: sql<number>`coalesce(sum(${pharmacyDistInvoices.amountDuePkr}) filter (where ${pharmacyDistInvoices.invoiceDate}::date < ${d90.toISOString().slice(0, 10)} and ${pharmacyDistInvoices.invoiceDate}::date >= ${d120.toISOString().slice(0, 10)}), 0)::int`,
            d120plusPkr: sql<number>`coalesce(sum(${pharmacyDistInvoices.amountDuePkr}) filter (where ${pharmacyDistInvoices.invoiceDate}::date < ${d120.toISOString().slice(0, 10)}), 0)::int`,
          })
          .from(pharmacyDistInvoices)
          .where(and(invWhere, sql`${pharmacyDistInvoices.amountDuePkr} > 0`))
          .then((r) => r[0]),
      ]);

    return {
      generatedAt: new Date().toISOString(),
      topMedicines,
      topCustomers,
      topCompanies,
      salesmanPerformance: salesmanPerf,
      routePerformance: routePerf,
      recoveryPerformance: recoveryPerf,
      aging: {
        currentPkr: agingAgg?.currentPkr ?? 0,
        d31to60Pkr: agingAgg?.d31to60Pkr ?? 0,
        d61to90Pkr: agingAgg?.d61to90Pkr ?? 0,
        d91to120Pkr: agingAgg?.d91to120Pkr ?? 0,
        d120plusPkr: agingAgg?.d120plusPkr ?? 0,
      },
    };
  }

  async runDistributionReport(
    organizationId: string,
    reportId: string,
    filters: { from?: string; to?: string; cityId?: string; areaId?: string; branchCode?: string },
  ) {
    const branch = filters.branchCode?.trim()
      ? await this.resolveBranch(organizationId, filters.branchCode.trim())
      : null;
    const from = filters.from?.trim() || undefined;
    const to = filters.to?.trim() || undefined;

    if (reportId === "daily-sales") {
      const conds = [eq(pharmacyDistOrders.organizationId, organizationId)];
      if (branch) conds.push(eq(pharmacyDistOrders.branchId, branch.id));
      if (from) conds.push(gte(pharmacyDistOrders.createdAt, new Date(`${from}T00:00:00.000Z`)));
      if (to) conds.push(lte(pharmacyDistOrders.createdAt, new Date(`${to}T23:59:59.999Z`)));
      const rows = await this.db
        .select({
          orderNumber: pharmacyDistOrders.orderNumber,
          status: pharmacyDistOrders.status,
          totalPkr: pharmacyDistOrders.totalPkr,
          createdAt: pharmacyDistOrders.createdAt,
          tradeCustomerId: pharmacyDistOrders.tradeCustomerId,
        })
        .from(pharmacyDistOrders)
        .where(and(...conds))
        .orderBy(desc(pharmacyDistOrders.createdAt))
        .limit(500);
      let filtered = rows;
      if (filters.cityId || filters.areaId) {
        const customers = await this.db
          .select()
          .from(pharmacyTradeCustomers)
          .where(eq(pharmacyTradeCustomers.organizationId, organizationId));
        const areas = await this.listAreas(organizationId);
        const areaById = new Map(areas.map((a) => [a.id, a]));
        const ok = new Set(
          customers
            .filter((c) => {
              if (filters.areaId && c.areaId !== filters.areaId) return false;
              if (filters.cityId) {
                const area = c.areaId ? areaById.get(c.areaId) : null;
                if (!area || area.cityId !== filters.cityId) return false;
              }
              return true;
            })
            .map((c) => c.id),
        );
        filtered = rows.filter((r) => ok.has(r.tradeCustomerId));
      }
      return {
        reportId,
        columns: ["orderNumber", "status", "totalPkr", "createdAt"],
        rows: filtered.map((r) => ({
          orderNumber: r.orderNumber,
          status: r.status,
          totalPkr: r.totalPkr,
          createdAt: r.createdAt,
        })),
      };
    }

    if (reportId === "outstanding-aging") {
      const customers = await this.db
        .select()
        .from(pharmacyTradeCustomers)
        .where(eq(pharmacyTradeCustomers.organizationId, organizationId));
      const areas = await this.listAreas(organizationId);
      const areaById = new Map(areas.map((a) => [a.id, a]));
      const rows = customers
        .filter((c) => (c.outstandingPkr ?? 0) > 0)
        .filter((c) => {
          if (filters.areaId && c.areaId !== filters.areaId) return false;
          if (filters.cityId) {
            const area = c.areaId ? areaById.get(c.areaId) : null;
            if (!area || area.cityId !== filters.cityId) return false;
          }
          return true;
        })
        .map((c) => ({
          code: c.code,
          name: c.name,
          outstandingPkr: c.outstandingPkr,
          creditLimitPkr: c.creditLimitPkr,
          areaId: c.areaId,
        }));
      return { reportId, columns: ["code", "name", "outstandingPkr", "creditLimitPkr"], rows };
    }

    if (reportId === "stock-near-expiry") {
      const in90 = new Date();
      in90.setDate(in90.getDate() + 90);
      const rows = await this.db
        .select({
          medicineName: pharmacyMedicines.name,
          batchNumber: pharmacyMedicineBatches.batchNumber,
          expiryDate: pharmacyMedicineBatches.expiryDate,
          quantity: pharmacyMedicineBatches.quantity,
        })
        .from(pharmacyMedicineBatches)
        .innerJoin(pharmacyMedicines, eq(pharmacyMedicineBatches.medicineId, pharmacyMedicines.id))
        .where(
          and(
            eq(pharmacyMedicines.organizationId, organizationId),
            gte(pharmacyMedicineBatches.quantity, 1),
            lte(pharmacyMedicineBatches.expiryDate, in90.toISOString().slice(0, 10)),
          ),
        )
        .orderBy(pharmacyMedicineBatches.expiryDate)
        .limit(500);
      return {
        reportId,
        columns: ["medicineName", "batchNumber", "expiryDate", "quantity"],
        rows,
      };
    }

    if (reportId === "pending-deliveries") {
      const conds = [eq(pharmacyDeliveries.organizationId, organizationId)];
      if (branch) conds.push(eq(pharmacyDeliveries.branchId, branch.id));
      const rows = await this.db
        .select({
          deliveryNumber: pharmacyDeliveries.deliveryNumber,
          status: pharmacyDeliveries.status,
          riderName: pharmacyDeliveries.riderName,
          createdAt: pharmacyDeliveries.createdAt,
        })
        .from(pharmacyDeliveries)
        .where(and(...conds))
        .orderBy(desc(pharmacyDeliveries.createdAt))
        .limit(500);
      return {
        reportId,
        columns: ["deliveryNumber", "status", "riderName", "createdAt"],
        rows: rows.filter((r) => r.status !== "delivered"),
      };
    }

    if (reportId === "visit-coverage") {
      const rows = await this.db
        .select({
          id: pharmacyVisits.id,
          employeeId: pharmacyVisits.employeeId,
          tradeCustomerId: pharmacyVisits.tradeCustomerId,
          status: pharmacyVisits.status,
          productive: pharmacyVisits.productive,
          visitedAt: pharmacyVisits.visitedAt,
        })
        .from(pharmacyVisits)
        .where(eq(pharmacyVisits.organizationId, organizationId))
        .orderBy(desc(pharmacyVisits.visitedAt))
        .limit(500);
      let filtered = rows;
      if (from) filtered = filtered.filter((r) => r.visitedAt && r.visitedAt.toISOString().slice(0, 10) >= from);
      if (to) filtered = filtered.filter((r) => r.visitedAt && r.visitedAt.toISOString().slice(0, 10) <= to);
      return {
        reportId,
        columns: ["employeeId", "tradeCustomerId", "status", "productive", "visitedAt"],
        rows: filtered,
      };
    }

    if (reportId === "target-vs-achievement") {
      const targets = await this.db
        .select()
        .from(pharmacyTargets)
        .where(eq(pharmacyTargets.organizationId, organizationId))
        .orderBy(desc(pharmacyTargets.createdAt))
        .limit(200);
      return {
        reportId,
        columns: ["employeeId", "period", "targetPkr", "achievedPkr", "pct"],
        rows: targets.map((t) => ({
          employeeId: t.employeeId,
          period: `${t.periodStart} → ${t.periodEnd}`,
          targetPkr: t.targetSalesPkr,
          achievedPkr: t.actualSalesPkr ?? 0,
          pct:
            t.targetSalesPkr > 0
              ? Math.round(((t.actualSalesPkr ?? 0) / t.targetSalesPkr) * 100)
              : 0,
        })),
      };
    }

    if (reportId === "city-sales") {
      const orders = await this.db
        .select({
          totalPkr: pharmacyDistOrders.totalPkr,
          tradeCustomerId: pharmacyDistOrders.tradeCustomerId,
          createdAt: pharmacyDistOrders.createdAt,
          status: pharmacyDistOrders.status,
        })
        .from(pharmacyDistOrders)
        .where(eq(pharmacyDistOrders.organizationId, organizationId));
      const customers = await this.listTradeCustomers(organizationId);
      const areas = await this.listAreas(organizationId);
      const cities = await this.listCities(organizationId);
      const custById = new Map(customers.map((c) => [c.id, c]));
      const areaById = new Map(areas.map((a) => [a.id, a]));
      const cityById = new Map(cities.map((c) => [c.id, c]));
      const map = new Map<string, { city: string; orders: number; salesPkr: number }>();
      for (const o of orders) {
        if (from && o.createdAt.toISOString().slice(0, 10) < from) continue;
        if (to && o.createdAt.toISOString().slice(0, 10) > to) continue;
        if (["cancelled", "draft"].includes(o.status)) continue;
        const cust = custById.get(o.tradeCustomerId);
        const area = cust?.areaId ? areaById.get(cust.areaId) : null;
        if (filters.cityId && area?.cityId !== filters.cityId) continue;
        if (filters.areaId && cust?.areaId !== filters.areaId) continue;
        const cityName = area?.cityId ? cityById.get(area.cityId)?.name ?? "Unassigned" : "Unassigned";
        const cur = map.get(cityName) ?? { city: cityName, orders: 0, salesPkr: 0 };
        cur.orders += 1;
        cur.salesPkr += o.totalPkr ?? 0;
        map.set(cityName, cur);
      }
      return {
        reportId,
        columns: ["city", "orders", "salesPkr"],
        rows: [...map.values()].sort((a, b) => b.salesPkr - a.salesPkr),
      };
    }

    if (reportId === "area-sales") {
      const orders = await this.db
        .select({
          totalPkr: pharmacyDistOrders.totalPkr,
          tradeCustomerId: pharmacyDistOrders.tradeCustomerId,
          createdAt: pharmacyDistOrders.createdAt,
          status: pharmacyDistOrders.status,
        })
        .from(pharmacyDistOrders)
        .where(eq(pharmacyDistOrders.organizationId, organizationId));
      const customers = await this.listTradeCustomers(organizationId);
      const areas = await this.listAreas(organizationId);
      const custById = new Map(customers.map((c) => [c.id, c]));
      const areaById = new Map(areas.map((a) => [a.id, a]));
      const map = new Map<string, { area: string; orders: number; salesPkr: number }>();
      for (const o of orders) {
        if (from && o.createdAt.toISOString().slice(0, 10) < from) continue;
        if (to && o.createdAt.toISOString().slice(0, 10) > to) continue;
        if (["cancelled", "draft"].includes(o.status)) continue;
        const cust = custById.get(o.tradeCustomerId);
        if (filters.areaId && cust?.areaId !== filters.areaId) continue;
        if (filters.cityId) {
          const area = cust?.areaId ? areaById.get(cust.areaId) : null;
          if (!area || area.cityId !== filters.cityId) continue;
        }
        const areaName = cust?.areaId ? areaById.get(cust.areaId)?.name ?? "Unassigned" : "Unassigned";
        const cur = map.get(areaName) ?? { area: areaName, orders: 0, salesPkr: 0 };
        cur.orders += 1;
        cur.salesPkr += o.totalPkr ?? 0;
        map.set(areaName, cur);
      }
      return {
        reportId,
        columns: ["area", "orders", "salesPkr"],
        rows: [...map.values()].sort((a, b) => b.salesPkr - a.salesPkr),
      };
    }

    if (reportId === "status-pipeline") {
      const conds = [eq(pharmacyDistOrders.organizationId, organizationId)];
      if (branch) conds.push(eq(pharmacyDistOrders.branchId, branch.id));
      const orders = await this.db
        .select({ status: pharmacyDistOrders.status, totalPkr: pharmacyDistOrders.totalPkr })
        .from(pharmacyDistOrders)
        .where(and(...conds));
      const map = new Map<string, { status: string; count: number; totalPkr: number }>();
      for (const o of orders) {
        const cur = map.get(o.status) ?? { status: o.status, count: 0, totalPkr: 0 };
        cur.count += 1;
        cur.totalPkr += o.totalPkr ?? 0;
        map.set(o.status, cur);
      }
      return {
        reportId,
        columns: ["status", "count", "totalPkr"],
        rows: [...map.values()].sort((a, b) => b.count - a.count),
      };
    }

    if (reportId === "collections-summary") {
      const conds = [eq(pharmacyCollections.organizationId, organizationId)];
      if (branch) conds.push(eq(pharmacyCollections.branchId, branch.id));
      if (from) conds.push(gte(pharmacyCollections.createdAt, new Date(`${from}T00:00:00.000Z`)));
      if (to) conds.push(lte(pharmacyCollections.createdAt, new Date(`${to}T23:59:59.999Z`)));
      const rows = await this.db
        .select({
          collectionNumber: pharmacyCollections.collectionNumber,
          amountPkr: pharmacyCollections.amountPkr,
          paymentMethod: pharmacyCollections.paymentMethod,
          createdAt: pharmacyCollections.createdAt,
        })
        .from(pharmacyCollections)
        .where(and(...conds))
        .orderBy(desc(pharmacyCollections.createdAt))
        .limit(500);
      return {
        reportId,
        columns: ["collectionNumber", "amountPkr", "paymentMethod", "createdAt"],
        rows,
      };
    }

    if (reportId === "delivery-status") {
      const conds = [eq(pharmacyDeliveries.organizationId, organizationId)];
      if (branch) conds.push(eq(pharmacyDeliveries.branchId, branch.id));
      const deliveries = await this.db
        .select({ status: pharmacyDeliveries.status })
        .from(pharmacyDeliveries)
        .where(and(...conds));
      const map = new Map<string, { status: string; count: number }>();
      for (const d of deliveries) {
        const cur = map.get(d.status) ?? { status: d.status, count: 0 };
        cur.count += 1;
        map.set(d.status, cur);
      }
      return {
        reportId,
        columns: ["status", "count"],
        rows: [...map.values()].sort((a, b) => b.count - a.count),
      };
    }

    if (reportId === "scheme-utilization") {
      const schemes = await this.db
        .select()
        .from(pharmacySchemes)
        .where(eq(pharmacySchemes.organizationId, organizationId))
        .orderBy(desc(pharmacySchemes.createdAt))
        .limit(200);
      const lines = await this.db
        .select({
          medicineId: pharmacyDistOrderLines.medicineId,
          quantity: pharmacyDistOrderLines.quantity,
          freeQuantity: pharmacyDistOrderLines.freeQuantity,
          orderId: pharmacyDistOrderLines.orderId,
        })
        .from(pharmacyDistOrderLines)
        .innerJoin(pharmacyDistOrders, eq(pharmacyDistOrderLines.orderId, pharmacyDistOrders.id))
        .where(eq(pharmacyDistOrders.organizationId, organizationId))
        .limit(2000);
      const freeByMed = new Map<string, { qty: number; free: number; lines: number }>();
      for (const l of lines) {
        const cur = freeByMed.get(l.medicineId) ?? { qty: 0, free: 0, lines: 0 };
        cur.qty += l.quantity ?? 0;
        cur.free += l.freeQuantity ?? 0;
        cur.lines += 1;
        freeByMed.set(l.medicineId, cur);
      }
      const meds = await this.db
        .select({ id: pharmacyMedicines.id, name: pharmacyMedicines.name, sku: pharmacyMedicines.sku })
        .from(pharmacyMedicines)
        .where(eq(pharmacyMedicines.organizationId, organizationId))
        .limit(2000);
      const medName = new Map(meds.map((m) => [m.id, m.name]));
      return {
        reportId,
        columns: ["scheme", "medicine", "buyQty", "freeQty", "soldQty", "freeGiven", "status"],
        rows: schemes.map((s) => {
          const usage = s.medicineId ? freeByMed.get(s.medicineId) : undefined;
          return {
            scheme: s.name,
            medicine: s.medicineId ? medName.get(s.medicineId) ?? s.medicineId : "—",
            buyQty: s.buyQty,
            freeQty: s.freeQty,
            soldQty: usage?.qty ?? 0,
            freeGiven: usage?.free ?? 0,
            status: s.status,
          };
        }),
      };
    }

    if (reportId === "salesman-sales") {
      const orders = await this.db
        .select({
          salesmanEmployeeId: pharmacyDistOrders.salesmanEmployeeId,
          totalPkr: pharmacyDistOrders.totalPkr,
          status: pharmacyDistOrders.status,
          createdAt: pharmacyDistOrders.createdAt,
        })
        .from(pharmacyDistOrders)
        .where(eq(pharmacyDistOrders.organizationId, organizationId));
      const emps = await this.db
        .select({ id: popsEmployees.id, name: popsEmployees.displayName })
        .from(popsEmployees)
        .where(eq(popsEmployees.organizationId, organizationId))
        .limit(500);
      const empName = new Map(emps.map((e) => [e.id, e.name]));
      const map = new Map<string, { salesman: string; orders: number; salesPkr: number }>();
      for (const o of orders) {
        if (from && o.createdAt.toISOString().slice(0, 10) < from) continue;
        if (to && o.createdAt.toISOString().slice(0, 10) > to) continue;
        if (["cancelled", "draft"].includes(o.status)) continue;
        const key = o.salesmanEmployeeId ?? "unassigned";
        const cur = map.get(key) ?? {
          salesman: o.salesmanEmployeeId ? empName.get(o.salesmanEmployeeId) ?? key : "Unassigned",
          orders: 0,
          salesPkr: 0,
        };
        cur.orders += 1;
        cur.salesPkr += o.totalPkr ?? 0;
        map.set(key, cur);
      }
      return {
        reportId,
        columns: ["salesman", "orders", "salesPkr"],
        rows: [...map.values()].sort((a, b) => b.salesPkr - a.salesPkr),
      };
    }

    if (reportId === "sku-sales") {
      const rows = await this.db
        .select({
          medicineId: pharmacyDistOrderLines.medicineId,
          quantity: pharmacyDistOrderLines.quantity,
          freeQuantity: pharmacyDistOrderLines.freeQuantity,
          lineTotalPkr: pharmacyDistOrderLines.lineTotalPkr,
          createdAt: pharmacyDistOrders.createdAt,
          status: pharmacyDistOrders.status,
        })
        .from(pharmacyDistOrderLines)
        .innerJoin(pharmacyDistOrders, eq(pharmacyDistOrderLines.orderId, pharmacyDistOrders.id))
        .where(eq(pharmacyDistOrders.organizationId, organizationId))
        .limit(5000);
      const meds = await this.db
        .select({
          id: pharmacyMedicines.id,
          name: pharmacyMedicines.name,
          sku: pharmacyMedicines.sku,
        })
        .from(pharmacyMedicines)
        .where(eq(pharmacyMedicines.organizationId, organizationId))
        .limit(3000);
      const medById = new Map(meds.map((m) => [m.id, m]));
      const map = new Map<string, { sku: string; name: string; qty: number; freeQty: number; salesPkr: number }>();
      for (const r of rows) {
        if (from && r.createdAt.toISOString().slice(0, 10) < from) continue;
        if (to && r.createdAt.toISOString().slice(0, 10) > to) continue;
        if (["cancelled", "draft"].includes(r.status)) continue;
        const med = medById.get(r.medicineId);
        const cur = map.get(r.medicineId) ?? {
          sku: med?.sku ?? "—",
          name: med?.name ?? r.medicineId,
          qty: 0,
          freeQty: 0,
          salesPkr: 0,
        };
        cur.qty += r.quantity ?? 0;
        cur.freeQty += r.freeQuantity ?? 0;
        cur.salesPkr += r.lineTotalPkr ?? 0;
        map.set(r.medicineId, cur);
      }
      return {
        reportId,
        columns: ["sku", "name", "qty", "freeQty", "salesPkr"],
        rows: [...map.values()].sort((a, b) => b.salesPkr - a.salesPkr).slice(0, 500),
      };
    }

    if (reportId === "customer-ledger") {
      const customers = await this.listTradeCustomers(organizationId);
      const areas = await this.listAreas(organizationId);
      const areaById = new Map(areas.map((a) => [a.id, a]));
      let rows = customers.map((c) => ({
        code: c.code,
        name: c.name,
        outstandingPkr: c.outstandingPkr,
        creditLimitPkr: c.creditLimitPkr,
        area: c.areaId ? areaById.get(c.areaId)?.name ?? "—" : "—",
        phone: c.phone ?? "—",
      }));
      if (filters.areaId) {
        rows = rows.filter((r) => {
          const c = customers.find((x) => x.code === r.code);
          return c?.areaId === filters.areaId;
        });
      }
      if (filters.cityId) {
        rows = rows.filter((r) => {
          const c = customers.find((x) => x.code === r.code);
          const area = c?.areaId ? areaById.get(c.areaId) : null;
          return area?.cityId === filters.cityId;
        });
      }
      return {
        reportId,
        columns: ["code", "name", "area", "phone", "outstandingPkr", "creditLimitPkr"],
        rows: rows.sort((a, b) => (b.outstandingPkr ?? 0) - (a.outstandingPkr ?? 0)),
      };
    }

    if (reportId === "credit-limit-breach") {
      const customers = await this.listTradeCustomers(organizationId);
      const rows = customers
        .filter((c) => (c.creditLimitPkr ?? 0) > 0 && (c.outstandingPkr ?? 0) > (c.creditLimitPkr ?? 0))
        .map((c) => ({
          code: c.code,
          name: c.name,
          outstandingPkr: c.outstandingPkr,
          creditLimitPkr: c.creditLimitPkr,
          overByPkr: (c.outstandingPkr ?? 0) - (c.creditLimitPkr ?? 0),
        }))
        .sort((a, b) => b.overByPkr - a.overByPkr);
      return {
        reportId,
        columns: ["code", "name", "outstandingPkr", "creditLimitPkr", "overByPkr"],
        rows,
      };
    }

    if (reportId === "stock-by-warehouse") {
      const warehouses = await this.db
        .select()
        .from(pharmacyWarehouses)
        .where(eq(pharmacyWarehouses.organizationId, organizationId));
      const whName = new Map(warehouses.map((w) => [w.id, w.name]));
      const batches = await this.db
        .select({
          warehouseId: pharmacyMedicineBatches.warehouseId,
          quantity: pharmacyMedicineBatches.quantity,
          medicineName: pharmacyMedicines.name,
          sku: pharmacyMedicines.sku,
        })
        .from(pharmacyMedicineBatches)
        .innerJoin(pharmacyMedicines, eq(pharmacyMedicineBatches.medicineId, pharmacyMedicines.id))
        .where(
          and(eq(pharmacyMedicines.organizationId, organizationId), gte(pharmacyMedicineBatches.quantity, 1)),
        )
        .limit(5000);
      const map = new Map<string, { warehouse: string; skus: number; qty: number }>();
      const skuSet = new Map<string, Set<string>>();
      for (const b of batches) {
        const key = b.warehouseId ?? "default";
        const cur = map.get(key) ?? {
          warehouse: b.warehouseId ? whName.get(b.warehouseId) ?? key : "Default / unassigned",
          skus: 0,
          qty: 0,
        };
        cur.qty += b.quantity ?? 0;
        map.set(key, cur);
        const set = skuSet.get(key) ?? new Set();
        set.add(b.sku ?? b.medicineName);
        skuSet.set(key, set);
      }
      for (const [k, set] of skuSet) {
        const cur = map.get(k);
        if (cur) cur.skus = set.size;
      }
      return {
        reportId,
        columns: ["warehouse", "skus", "qty"],
        rows: [...map.values()].sort((a, b) => b.qty - a.qty),
      };
    }

    if (reportId === "slow-moving") {
      const meds = await this.db
        .select({
          id: pharmacyMedicines.id,
          name: pharmacyMedicines.name,
          sku: pharmacyMedicines.sku,
          currentStock: pharmacyMedicines.currentStock,
        })
        .from(pharmacyMedicines)
        .where(eq(pharmacyMedicines.organizationId, organizationId))
        .limit(3000);
      const sold = await this.db
        .select({
          medicineId: pharmacyDistOrderLines.medicineId,
          quantity: pharmacyDistOrderLines.quantity,
        })
        .from(pharmacyDistOrderLines)
        .innerJoin(pharmacyDistOrders, eq(pharmacyDistOrderLines.orderId, pharmacyDistOrders.id))
        .where(eq(pharmacyDistOrders.organizationId, organizationId))
        .limit(8000);
      const soldMap = new Map<string, number>();
      for (const s of sold) soldMap.set(s.medicineId, (soldMap.get(s.medicineId) ?? 0) + (s.quantity ?? 0));
      const rows = meds
        .map((m) => ({
          sku: m.sku,
          name: m.name,
          stock: m.currentStock ?? 0,
          soldQty: soldMap.get(m.id) ?? 0,
        }))
        .filter((r) => r.stock > 0)
        .sort((a, b) => a.soldQty - b.soldQty || b.stock - a.stock)
        .slice(0, 200);
      return {
        reportId,
        columns: ["sku", "name", "stock", "soldQty"],
        rows,
      };
    }

    if (reportId === "batch-trace") {
      const rows = await this.db
        .select({
          medicineName: pharmacyMedicines.name,
          sku: pharmacyMedicines.sku,
          batchNumber: pharmacyMedicineBatches.batchNumber,
          expiryDate: pharmacyMedicineBatches.expiryDate,
          quantity: pharmacyMedicineBatches.quantity,
          reservedQuantity: pharmacyMedicineBatches.reservedQuantity,
          status: pharmacyMedicineBatches.status,
        })
        .from(pharmacyMedicineBatches)
        .innerJoin(pharmacyMedicines, eq(pharmacyMedicineBatches.medicineId, pharmacyMedicines.id))
        .where(eq(pharmacyMedicines.organizationId, organizationId))
        .orderBy(desc(pharmacyMedicineBatches.createdAt))
        .limit(500);
      return {
        reportId,
        columns: ["sku", "medicineName", "batchNumber", "expiryDate", "quantity", "reservedQuantity", "status"],
        rows,
      };
    }

    if (reportId === "pod-exceptions") {
      const conds = [eq(pharmacyDeliveries.organizationId, organizationId)];
      if (branch) conds.push(eq(pharmacyDeliveries.branchId, branch.id));
      const rows = await this.db
        .select({
          deliveryNumber: pharmacyDeliveries.deliveryNumber,
          status: pharmacyDeliveries.status,
          failedReason: pharmacyDeliveries.failedReason,
          podNotes: pharmacyDeliveries.podNotes,
          riderName: pharmacyDeliveries.riderName,
          createdAt: pharmacyDeliveries.createdAt,
        })
        .from(pharmacyDeliveries)
        .where(and(...conds))
        .orderBy(desc(pharmacyDeliveries.createdAt))
        .limit(500);
      return {
        reportId,
        columns: ["deliveryNumber", "status", "failedReason", "podNotes", "riderName", "createdAt"],
        rows: rows.filter(
          (r) =>
            ["failed", "partial", "returned", "exception"].includes(String(r.status).toLowerCase()) ||
            Boolean(r.failedReason),
        ),
      };
    }

    if (reportId === "route-load") {
      const deliveries = await this.db
        .select({
          routeId: pharmacyDeliveries.routeId,
          status: pharmacyDeliveries.status,
        })
        .from(pharmacyDeliveries)
        .where(eq(pharmacyDeliveries.organizationId, organizationId));
      const routes = await this.listRoutes(organizationId);
      const routeName = new Map(routes.map((r) => [r.id, r.name]));
      const map = new Map<string, { route: string; total: number; pending: number; delivered: number }>();
      for (const d of deliveries) {
        const key = d.routeId ?? "unassigned";
        const cur = map.get(key) ?? {
          route: d.routeId ? routeName.get(d.routeId) ?? key : "Unassigned",
          total: 0,
          pending: 0,
          delivered: 0,
        };
        cur.total += 1;
        if (d.status === "delivered") cur.delivered += 1;
        else cur.pending += 1;
        map.set(key, cur);
      }
      return {
        reportId,
        columns: ["route", "total", "pending", "delivered"],
        rows: [...map.values()].sort((a, b) => b.total - a.total),
      };
    }

    if (reportId === "pjp-adherence") {
      const routes = await this.listRoutes(organizationId);
      const visits = await this.db
        .select({
          visitedAt: pharmacyVisits.visitedAt,
          tradeCustomerId: pharmacyVisits.tradeCustomerId,
        })
        .from(pharmacyVisits)
        .where(eq(pharmacyVisits.organizationId, organizationId))
        .limit(2000);
      const customers = await this.listTradeCustomers(organizationId);
      const routeCustomers = new Map<string, number>();
      for (const c of customers) {
        if (!c.routeId) continue;
        routeCustomers.set(c.routeId, (routeCustomers.get(c.routeId) ?? 0) + 1);
      }
      const visitByDayRoute = new Map<string, number>();
      for (const v of visits) {
        if (!v.visitedAt || !v.tradeCustomerId) continue;
        const cust = customers.find((c) => c.id === v.tradeCustomerId);
        if (!cust?.routeId) continue;
        const day = v.visitedAt.getDay();
        const key = `${cust.routeId}:${day}`;
        visitByDayRoute.set(key, (visitByDayRoute.get(key) ?? 0) + 1);
      }
      const rows = routes.map((r) => {
        const plannedDay = r.pjpDayOfWeek;
        const plannedCustomers = routeCustomers.get(r.id) ?? 0;
        const visitsOnPjp =
          plannedDay == null ? 0 : visitByDayRoute.get(`${r.id}:${plannedDay}`) ?? 0;
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        return {
          route: r.name,
          pjpDay: plannedDay == null ? "Any" : days[plannedDay] ?? String(plannedDay),
          plannedCustomers,
          visitsOnPjpDay: visitsOnPjp,
          adherencePct:
            plannedCustomers > 0 ? Math.round((visitsOnPjp / plannedCustomers) * 100) : 0,
        };
      });
      return {
        reportId,
        columns: ["route", "pjpDay", "plannedCustomers", "visitsOnPjpDay", "adherencePct"],
        rows,
      };
    }

    if (reportId === "unvisited-customers") {
      const customers = await this.listTradeCustomers(organizationId);
      const visits = await this.db
        .select({ tradeCustomerId: pharmacyVisits.tradeCustomerId, visitedAt: pharmacyVisits.visitedAt })
        .from(pharmacyVisits)
        .where(eq(pharmacyVisits.organizationId, organizationId))
        .limit(5000);
      const lastVisit = new Map<string, Date>();
      for (const v of visits) {
        if (!v.tradeCustomerId || !v.visitedAt) continue;
        const prev = lastVisit.get(v.tradeCustomerId);
        if (!prev || v.visitedAt > prev) lastVisit.set(v.tradeCustomerId, v.visitedAt);
      }
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 14);
      const areas = await this.listAreas(organizationId);
      const areaById = new Map(areas.map((a) => [a.id, a]));
      const rows = customers
        .filter((c) => {
          const lv = lastVisit.get(c.id);
          return !lv || lv < cutoff;
        })
        .filter((c) => {
          if (filters.areaId && c.areaId !== filters.areaId) return false;
          if (filters.cityId) {
            const area = c.areaId ? areaById.get(c.areaId) : null;
            if (!area || area.cityId !== filters.cityId) return false;
          }
          return true;
        })
        .map((c) => ({
          code: c.code,
          name: c.name,
          area: c.areaId ? areaById.get(c.areaId)?.name ?? "—" : "—",
          lastVisit: lastVisit.get(c.id)?.toISOString().slice(0, 10) ?? "Never",
          outstandingPkr: c.outstandingPkr,
        }));
      return {
        reportId,
        columns: ["code", "name", "area", "lastVisit", "outstandingPkr"],
        rows,
      };
    }

    if (reportId === "company-performance") {
      const lines = await this.db
        .select({
          medicineId: pharmacyDistOrderLines.medicineId,
          lineTotalPkr: pharmacyDistOrderLines.lineTotalPkr,
          quantity: pharmacyDistOrderLines.quantity,
          status: pharmacyDistOrders.status,
          createdAt: pharmacyDistOrders.createdAt,
        })
        .from(pharmacyDistOrderLines)
        .innerJoin(pharmacyDistOrders, eq(pharmacyDistOrderLines.orderId, pharmacyDistOrders.id))
        .where(eq(pharmacyDistOrders.organizationId, organizationId))
        .limit(8000);
      const meds = await this.db
        .select({ id: pharmacyMedicines.id, companyId: pharmacyMedicines.companyId })
        .from(pharmacyMedicines)
        .where(eq(pharmacyMedicines.organizationId, organizationId))
        .limit(5000);
      const companies = await this.db
        .select({ id: pharmacyCompanies.id, name: pharmacyCompanies.name })
        .from(pharmacyCompanies)
        .where(eq(pharmacyCompanies.organizationId, organizationId));
      const medCo = new Map(meds.map((m) => [m.id, m.companyId]));
      const coName = new Map(companies.map((c) => [c.id, c.name]));
      const map = new Map<string, { company: string; qty: number; salesPkr: number }>();
      for (const l of lines) {
        if (from && l.createdAt.toISOString().slice(0, 10) < from) continue;
        if (to && l.createdAt.toISOString().slice(0, 10) > to) continue;
        if (["cancelled", "draft"].includes(l.status)) continue;
        const cid = medCo.get(l.medicineId) ?? "unassigned";
        const cur = map.get(cid) ?? {
          company: cid === "unassigned" ? "Unassigned" : coName.get(cid) ?? cid,
          qty: 0,
          salesPkr: 0,
        };
        cur.qty += l.quantity ?? 0;
        cur.salesPkr += l.lineTotalPkr ?? 0;
        map.set(cid, cur);
      }
      return {
        reportId,
        columns: ["company", "qty", "salesPkr"],
        rows: [...map.values()].sort((a, b) => b.salesPkr - a.salesPkr),
      };
    }

    if (reportId === "purchase-vs-sales") {
      const pos = await this.db
        .select({ totalPkr: pharmacyPurchaseOrders.totalPkr, status: pharmacyPurchaseOrders.status })
        .from(pharmacyPurchaseOrders)
        .where(eq(pharmacyPurchaseOrders.organizationId, organizationId));
      const sales = await this.db
        .select({ totalPkr: pharmacyDistOrders.totalPkr, status: pharmacyDistOrders.status })
        .from(pharmacyDistOrders)
        .where(eq(pharmacyDistOrders.organizationId, organizationId));
      const purchasePkr = pos
        .filter((p) => !["cancelled", "draft"].includes(p.status))
        .reduce((s, p) => s + (p.totalPkr ?? 0), 0);
      const salesPkr = sales
        .filter((o) => !["cancelled", "draft"].includes(o.status))
        .reduce((s, o) => s + (o.totalPkr ?? 0), 0);
      return {
        reportId,
        columns: ["metric", "amountPkr"],
        rows: [
          { metric: "Purchase (approved/received)", amountPkr: purchasePkr },
          { metric: "Distribution sales", amountPkr: salesPkr },
          { metric: "Sales − Purchase", amountPkr: salesPkr - purchasePkr },
        ],
      };
    }

    if (reportId === "grn-pending") {
      const pos = await this.db
        .select({
          id: pharmacyPurchaseOrders.id,
          poNumber: pharmacyPurchaseOrders.poNumber,
          status: pharmacyPurchaseOrders.status,
          totalPkr: pharmacyPurchaseOrders.totalPkr,
          orderDate: pharmacyPurchaseOrders.orderDate,
          expectedDate: pharmacyPurchaseOrders.expectedDate,
        })
        .from(pharmacyPurchaseOrders)
        .where(eq(pharmacyPurchaseOrders.organizationId, organizationId))
        .orderBy(desc(pharmacyPurchaseOrders.createdAt))
        .limit(300);
      const grns = await this.db
        .select({ purchaseOrderId: pharmacyGrns.purchaseOrderId })
        .from(pharmacyGrns)
        .where(eq(pharmacyGrns.organizationId, organizationId))
        .limit(1000);
      const grnSet = new Set(grns.map((g) => g.purchaseOrderId).filter(Boolean) as string[]);
      const rows = pos
        .filter((p) => ["approved", "ordered", "partial"].includes(p.status) || (p.status !== "cancelled" && !grnSet.has(p.id)))
        .filter((p) => !grnSet.has(p.id) || p.status === "approved")
        .map((p) => ({
          poNumber: p.poNumber,
          status: p.status,
          totalPkr: p.totalPkr,
          orderDate: p.orderDate,
          expectedDate: p.expectedDate ?? "—",
          hasGrn: grnSet.has(p.id) ? "Yes" : "No",
        }));
      return {
        reportId,
        columns: ["poNumber", "status", "totalPkr", "orderDate", "expectedDate", "hasGrn"],
        rows: rows.filter((r) => r.hasGrn === "No"),
      };
    }

    if (reportId === "district-coverage" || reportId === "province-sales") {
      const orders = await this.db
        .select({
          tradeCustomerId: pharmacyDistOrders.tradeCustomerId,
          totalPkr: pharmacyDistOrders.totalPkr,
          status: pharmacyDistOrders.status,
          createdAt: pharmacyDistOrders.createdAt,
        })
        .from(pharmacyDistOrders)
        .where(eq(pharmacyDistOrders.organizationId, organizationId));
      const customers = await this.listTradeCustomers(organizationId);
      const areas = await this.listAreas(organizationId);
      const cities = await this.listCities(organizationId);
      const districts = await this.listDistricts(organizationId);
      const divisions = await this.listDivisions(organizationId);
      const provinces = await this.listProvinces(organizationId);
      const custById = new Map(customers.map((c) => [c.id, c]));
      const areaById = new Map(areas.map((a) => [a.id, a]));
      const cityById = new Map(cities.map((c) => [c.id, c]));
      const districtById = new Map(districts.map((d) => [d.id, d]));
      const divisionById = new Map(divisions.map((d) => [d.id, d]));
      const provinceById = new Map(provinces.map((p) => [p.id, p]));

      const map = new Map<string, { label: string; orders: number; salesPkr: number; customers: Set<string> }>();
      for (const o of orders) {
        if (from && o.createdAt.toISOString().slice(0, 10) < from) continue;
        if (to && o.createdAt.toISOString().slice(0, 10) > to) continue;
        if (["cancelled", "draft"].includes(o.status)) continue;
        const cust = custById.get(o.tradeCustomerId);
        const area = cust?.areaId ? areaById.get(cust.areaId) : null;
        const city = area?.cityId ? cityById.get(area.cityId) : null;
        const district = city?.districtId ? districtById.get(city.districtId) : null;
        const division = district?.divisionId ? divisionById.get(district.divisionId) : null;
        const province = division?.provinceId ? provinceById.get(division.provinceId) : null;
        const label =
          reportId === "province-sales"
            ? province?.name ?? "Unassigned"
            : district?.name ?? "Unassigned";
        const cur = map.get(label) ?? { label, orders: 0, salesPkr: 0, customers: new Set() };
        cur.orders += 1;
        cur.salesPkr += o.totalPkr ?? 0;
        if (cust) cur.customers.add(cust.id);
        map.set(label, cur);
      }

      if (reportId === "district-coverage") {
        return {
          reportId,
          columns: ["district", "customers", "orders", "salesPkr"],
          rows: [...map.values()]
            .map((r) => ({
              district: r.label,
              customers: r.customers.size,
              orders: r.orders,
              salesPkr: r.salesPkr,
            }))
            .sort((a, b) => b.salesPkr - a.salesPkr),
        };
      }
      return {
        reportId,
        columns: ["province", "orders", "salesPkr"],
        rows: [...map.values()]
          .map((r) => ({ province: r.label, orders: r.orders, salesPkr: r.salesPkr }))
          .sort((a, b) => b.salesPkr - a.salesPkr),
      };
    }

    // ── Company depth ────────────────────────────────────────────────────────
    if (reportId === "company-sku-sales") {
      const lines = await this.db
        .select({
          medicineId: pharmacyDistOrderLines.medicineId,
          quantity: pharmacyDistOrderLines.quantity,
          freeQuantity: pharmacyDistOrderLines.freeQuantity,
          lineTotalPkr: pharmacyDistOrderLines.lineTotalPkr,
          status: pharmacyDistOrders.status,
          createdAt: pharmacyDistOrders.createdAt,
        })
        .from(pharmacyDistOrderLines)
        .innerJoin(pharmacyDistOrders, eq(pharmacyDistOrderLines.orderId, pharmacyDistOrders.id))
        .where(eq(pharmacyDistOrders.organizationId, organizationId))
        .limit(8000);
      const meds = await this.db
        .select({
          id: pharmacyMedicines.id,
          name: pharmacyMedicines.name,
          sku: pharmacyMedicines.sku,
          companyId: pharmacyMedicines.companyId,
        })
        .from(pharmacyMedicines)
        .where(eq(pharmacyMedicines.organizationId, organizationId))
        .limit(5000);
      const companies = await this.db
        .select({ id: pharmacyCompanies.id, name: pharmacyCompanies.name })
        .from(pharmacyCompanies)
        .where(eq(pharmacyCompanies.organizationId, organizationId));
      const coName = new Map(companies.map((c) => [c.id, c.name]));
      const medById = new Map(meds.map((m) => [m.id, m]));
      const map = new Map<
        string,
        { company: string; sku: string; name: string; qty: number; freeQty: number; salesPkr: number }
      >();
      for (const l of lines) {
        if (from && l.createdAt.toISOString().slice(0, 10) < from) continue;
        if (to && l.createdAt.toISOString().slice(0, 10) > to) continue;
        if (["cancelled", "draft"].includes(l.status)) continue;
        const med = medById.get(l.medicineId);
        const cid = med?.companyId ?? "unassigned";
        const key = `${cid}:${l.medicineId}`;
        const cur = map.get(key) ?? {
          company: cid === "unassigned" ? "Unassigned" : coName.get(cid) ?? cid,
          sku: med?.sku ?? "—",
          name: med?.name ?? l.medicineId,
          qty: 0,
          freeQty: 0,
          salesPkr: 0,
        };
        cur.qty += l.quantity ?? 0;
        cur.freeQty += l.freeQuantity ?? 0;
        cur.salesPkr += l.lineTotalPkr ?? 0;
        map.set(key, cur);
      }
      return {
        reportId,
        columns: ["company", "sku", "name", "qty", "freeQty", "salesPkr"],
        rows: [...map.values()].sort((a, b) => a.company.localeCompare(b.company) || b.salesPkr - a.salesPkr),
      };
    }

    if (reportId === "company-stock") {
      const meds = await this.db
        .select({
          name: pharmacyMedicines.name,
          sku: pharmacyMedicines.sku,
          currentStock: pharmacyMedicines.currentStock,
          companyId: pharmacyMedicines.companyId,
        })
        .from(pharmacyMedicines)
        .where(eq(pharmacyMedicines.organizationId, organizationId))
        .limit(5000);
      const companies = await this.db
        .select({ id: pharmacyCompanies.id, name: pharmacyCompanies.name })
        .from(pharmacyCompanies)
        .where(eq(pharmacyCompanies.organizationId, organizationId));
      const coName = new Map(companies.map((c) => [c.id, c.name]));
      const map = new Map<string, { company: string; skus: number; stockQty: number }>();
      for (const m of meds) {
        const cid = m.companyId ?? "unassigned";
        const cur = map.get(cid) ?? {
          company: cid === "unassigned" ? "Unassigned" : coName.get(cid) ?? cid,
          skus: 0,
          stockQty: 0,
        };
        cur.skus += 1;
        cur.stockQty += m.currentStock ?? 0;
        map.set(cid, cur);
      }
      return {
        reportId,
        columns: ["company", "skus", "stockQty"],
        rows: [...map.values()].sort((a, b) => b.stockQty - a.stockQty),
      };
    }

    if (reportId === "company-net-sales") {
      const salesLines = await this.db
        .select({
          medicineId: pharmacyDistOrderLines.medicineId,
          lineTotalPkr: pharmacyDistOrderLines.lineTotalPkr,
          status: pharmacyDistOrders.status,
          createdAt: pharmacyDistOrders.createdAt,
        })
        .from(pharmacyDistOrderLines)
        .innerJoin(pharmacyDistOrders, eq(pharmacyDistOrderLines.orderId, pharmacyDistOrders.id))
        .where(eq(pharmacyDistOrders.organizationId, organizationId))
        .limit(8000);
      const wrLines = await this.db
        .select({
          medicineId: pharmacyWholesaleReturnLines.medicineId,
          lineTotalPkr: pharmacyWholesaleReturnLines.lineTotalPkr,
          createdAt: pharmacyWholesaleReturns.createdAt,
        })
        .from(pharmacyWholesaleReturnLines)
        .innerJoin(
          pharmacyWholesaleReturns,
          eq(pharmacyWholesaleReturnLines.returnId, pharmacyWholesaleReturns.id),
        )
        .where(eq(pharmacyWholesaleReturns.organizationId, organizationId))
        .limit(4000);
      const meds = await this.db
        .select({ id: pharmacyMedicines.id, companyId: pharmacyMedicines.companyId })
        .from(pharmacyMedicines)
        .where(eq(pharmacyMedicines.organizationId, organizationId))
        .limit(5000);
      const companies = await this.db
        .select({ id: pharmacyCompanies.id, name: pharmacyCompanies.name })
        .from(pharmacyCompanies)
        .where(eq(pharmacyCompanies.organizationId, organizationId));
      const medCo = new Map(meds.map((m) => [m.id, m.companyId]));
      const coName = new Map(companies.map((c) => [c.id, c.name]));
      const map = new Map<string, { company: string; salesPkr: number; returnsPkr: number; netPkr: number }>();
      const bump = (cid: string | null | undefined, field: "salesPkr" | "returnsPkr", amt: number) => {
        const key = cid ?? "unassigned";
        const cur = map.get(key) ?? {
          company: key === "unassigned" ? "Unassigned" : coName.get(key) ?? key,
          salesPkr: 0,
          returnsPkr: 0,
          netPkr: 0,
        };
        cur[field] += amt;
        cur.netPkr = cur.salesPkr - cur.returnsPkr;
        map.set(key, cur);
      };
      for (const l of salesLines) {
        if (from && l.createdAt.toISOString().slice(0, 10) < from) continue;
        if (to && l.createdAt.toISOString().slice(0, 10) > to) continue;
        if (["cancelled", "draft"].includes(l.status)) continue;
        bump(medCo.get(l.medicineId), "salesPkr", l.lineTotalPkr ?? 0);
      }
      for (const l of wrLines) {
        if (from && l.createdAt.toISOString().slice(0, 10) < from) continue;
        if (to && l.createdAt.toISOString().slice(0, 10) > to) continue;
        bump(medCo.get(l.medicineId), "returnsPkr", l.lineTotalPkr ?? 0);
      }
      return {
        reportId,
        columns: ["company", "salesPkr", "returnsPkr", "netPkr"],
        rows: [...map.values()].sort((a, b) => b.netPkr - a.netPkr),
      };
    }

    // ── Document registers (SRN / WRN / WINV / GRN / PRN / …) ───────────────
    if (reportId === "srn-register") {
      const rows = await this.db
        .select({
          returnNumber: pharmacySaleReturns.returnNumber,
          totalPkr: pharmacySaleReturns.totalPkr,
          refundMethod: pharmacySaleReturns.refundMethod,
          reason: pharmacySaleReturns.reason,
          createdAt: pharmacySaleReturns.createdAt,
        })
        .from(pharmacySaleReturns)
        .where(eq(pharmacySaleReturns.organizationId, organizationId))
        .orderBy(desc(pharmacySaleReturns.createdAt))
        .limit(500);
      return {
        reportId,
        columns: ["returnNumber", "totalPkr", "refundMethod", "reason", "createdAt"],
        rows: rows.filter((r) => {
          const day = r.createdAt.toISOString().slice(0, 10);
          if (from && day < from) return false;
          if (to && day > to) return false;
          return true;
        }),
      };
    }

    if (reportId === "wrn-register") {
      const rows = await this.db
        .select({
          returnNumber: pharmacyWholesaleReturns.returnNumber,
          totalPkr: pharmacyWholesaleReturns.totalPkr,
          status: pharmacyWholesaleReturns.status,
          reason: pharmacyWholesaleReturns.reason,
          tradeCustomerId: pharmacyWholesaleReturns.tradeCustomerId,
          createdAt: pharmacyWholesaleReturns.createdAt,
        })
        .from(pharmacyWholesaleReturns)
        .where(eq(pharmacyWholesaleReturns.organizationId, organizationId))
        .orderBy(desc(pharmacyWholesaleReturns.createdAt))
        .limit(500);
      const customers = await this.listTradeCustomers(organizationId);
      const custName = new Map(customers.map((c) => [c.id, c.name]));
      return {
        reportId,
        columns: ["returnNumber", "customer", "totalPkr", "status", "reason", "createdAt"],
        rows: rows
          .filter((r) => {
            const day = r.createdAt.toISOString().slice(0, 10);
            if (from && day < from) return false;
            if (to && day > to) return false;
            return true;
          })
          .map((r) => ({
            returnNumber: r.returnNumber,
            customer: custName.get(r.tradeCustomerId) ?? r.tradeCustomerId,
            totalPkr: r.totalPkr,
            status: r.status,
            reason: r.reason ?? "—",
            createdAt: r.createdAt,
          })),
      };
    }

    if (reportId === "winv-register") {
      const conds = [eq(pharmacyDistInvoices.organizationId, organizationId)];
      if (branch) conds.push(eq(pharmacyDistInvoices.branchId, branch.id));
      const rows = await this.db
        .select({
          invoiceNumber: pharmacyDistInvoices.invoiceNumber,
          invoiceDate: pharmacyDistInvoices.invoiceDate,
          totalPkr: pharmacyDistInvoices.totalPkr,
          amountDuePkr: pharmacyDistInvoices.amountDuePkr,
          amountPaidPkr: pharmacyDistInvoices.amountPaidPkr,
          paymentMethod: pharmacyDistInvoices.paymentMethod,
          status: pharmacyDistInvoices.status,
          tradeCustomerId: pharmacyDistInvoices.tradeCustomerId,
          createdAt: pharmacyDistInvoices.createdAt,
        })
        .from(pharmacyDistInvoices)
        .where(and(...conds))
        .orderBy(desc(pharmacyDistInvoices.createdAt))
        .limit(500);
      const customers = await this.listTradeCustomers(organizationId);
      const custName = new Map(customers.map((c) => [c.id, c.name]));
      return {
        reportId,
        columns: [
          "invoiceNumber",
          "customer",
          "invoiceDate",
          "totalPkr",
          "amountPaidPkr",
          "amountDuePkr",
          "paymentMethod",
          "status",
        ],
        rows: rows
          .filter((r) => {
            const day = String(r.invoiceDate ?? r.createdAt.toISOString().slice(0, 10));
            if (from && day < from) return false;
            if (to && day > to) return false;
            return true;
          })
          .map((r) => ({
            invoiceNumber: r.invoiceNumber,
            customer: custName.get(r.tradeCustomerId) ?? r.tradeCustomerId,
            invoiceDate: r.invoiceDate,
            totalPkr: r.totalPkr,
            amountPaidPkr: r.amountPaidPkr,
            amountDuePkr: r.amountDuePkr,
            paymentMethod: r.paymentMethod,
            status: r.status,
          })),
      };
    }

    if (reportId === "grn-register") {
      const rows = await this.db
        .select({
          grnNumber: pharmacyGrns.grnNumber,
          receivedDate: pharmacyGrns.receivedDate,
          totalPkr: pharmacyGrns.totalPkr,
          status: pharmacyGrns.status,
          supplierInvoiceNumber: pharmacyGrns.supplierInvoiceNumber,
          createdAt: pharmacyGrns.createdAt,
        })
        .from(pharmacyGrns)
        .where(eq(pharmacyGrns.organizationId, organizationId))
        .orderBy(desc(pharmacyGrns.createdAt))
        .limit(500);
      return {
        reportId,
        columns: ["grnNumber", "receivedDate", "supplierInvoiceNumber", "totalPkr", "status"],
        rows: rows.filter((r) => {
          const day = String(r.receivedDate ?? r.createdAt.toISOString().slice(0, 10));
          if (from && day < from) return false;
          if (to && day > to) return false;
          return true;
        }),
      };
    }

    if (reportId === "prn-register") {
      const rows = await this.db
        .select({
          returnNumber: pharmacyPurchaseReturns.returnNumber,
          totalPkr: pharmacyPurchaseReturns.totalPkr,
          reason: pharmacyPurchaseReturns.reason,
          createdAt: pharmacyPurchaseReturns.createdAt,
        })
        .from(pharmacyPurchaseReturns)
        .where(eq(pharmacyPurchaseReturns.organizationId, organizationId))
        .orderBy(desc(pharmacyPurchaseReturns.createdAt))
        .limit(500);
      return {
        reportId,
        columns: ["returnNumber", "totalPkr", "reason", "createdAt"],
        rows: rows.filter((r) => {
          const day = r.createdAt.toISOString().slice(0, 10);
          if (from && day < from) return false;
          if (to && day > to) return false;
          return true;
        }),
      };
    }

    if (reportId === "po-register") {
      const rows = await this.db
        .select({
          poNumber: pharmacyPurchaseOrders.poNumber,
          orderDate: pharmacyPurchaseOrders.orderDate,
          expectedDate: pharmacyPurchaseOrders.expectedDate,
          totalPkr: pharmacyPurchaseOrders.totalPkr,
          status: pharmacyPurchaseOrders.status,
        })
        .from(pharmacyPurchaseOrders)
        .where(eq(pharmacyPurchaseOrders.organizationId, organizationId))
        .orderBy(desc(pharmacyPurchaseOrders.createdAt))
        .limit(500);
      return {
        reportId,
        columns: ["poNumber", "orderDate", "expectedDate", "totalPkr", "status"],
        rows: rows.filter((r) => {
          const day = String(r.orderDate);
          if (from && day < from) return false;
          if (to && day > to) return false;
          return true;
        }),
      };
    }

    if (reportId === "do-register") {
      const conds = [eq(pharmacyDistOrders.organizationId, organizationId)];
      if (branch) conds.push(eq(pharmacyDistOrders.branchId, branch.id));
      const rows = await this.db
        .select({
          orderNumber: pharmacyDistOrders.orderNumber,
          totalPkr: pharmacyDistOrders.totalPkr,
          status: pharmacyDistOrders.status,
          tradeCustomerId: pharmacyDistOrders.tradeCustomerId,
          createdAt: pharmacyDistOrders.createdAt,
        })
        .from(pharmacyDistOrders)
        .where(and(...conds))
        .orderBy(desc(pharmacyDistOrders.createdAt))
        .limit(500);
      const customers = await this.listTradeCustomers(organizationId);
      const custName = new Map(customers.map((c) => [c.id, c.name]));
      return {
        reportId,
        columns: ["orderNumber", "customer", "totalPkr", "status", "createdAt"],
        rows: rows
          .filter((r) => {
            const day = r.createdAt.toISOString().slice(0, 10);
            if (from && day < from) return false;
            if (to && day > to) return false;
            return true;
          })
          .map((r) => ({
            orderNumber: r.orderNumber,
            customer: custName.get(r.tradeCustomerId) ?? r.tradeCustomerId,
            totalPkr: r.totalPkr,
            status: r.status,
            createdAt: r.createdAt,
          })),
      };
    }

    if (reportId === "dlv-register") {
      const conds = [eq(pharmacyDeliveries.organizationId, organizationId)];
      if (branch) conds.push(eq(pharmacyDeliveries.branchId, branch.id));
      const rows = await this.db
        .select({
          deliveryNumber: pharmacyDeliveries.deliveryNumber,
          status: pharmacyDeliveries.status,
          riderName: pharmacyDeliveries.riderName,
          collectedPkr: pharmacyDeliveries.collectedPkr,
          deliveredAt: pharmacyDeliveries.deliveredAt,
          createdAt: pharmacyDeliveries.createdAt,
        })
        .from(pharmacyDeliveries)
        .where(and(...conds))
        .orderBy(desc(pharmacyDeliveries.createdAt))
        .limit(500);
      return {
        reportId,
        columns: ["deliveryNumber", "status", "riderName", "collectedPkr", "deliveredAt", "createdAt"],
        rows: rows.filter((r) => {
          const day = r.createdAt.toISOString().slice(0, 10);
          if (from && day < from) return false;
          if (to && day > to) return false;
          return true;
        }),
      };
    }

    if (reportId === "col-register") {
      const conds = [eq(pharmacyCollections.organizationId, organizationId)];
      if (branch) conds.push(eq(pharmacyCollections.branchId, branch.id));
      const rows = await this.db
        .select({
          collectionNumber: pharmacyCollections.collectionNumber,
          amountPkr: pharmacyCollections.amountPkr,
          paymentMethod: pharmacyCollections.paymentMethod,
          tradeCustomerId: pharmacyCollections.tradeCustomerId,
          createdAt: pharmacyCollections.createdAt,
        })
        .from(pharmacyCollections)
        .where(and(...conds))
        .orderBy(desc(pharmacyCollections.createdAt))
        .limit(500);
      const customers = await this.listTradeCustomers(organizationId);
      const custName = new Map(customers.map((c) => [c.id, c.name]));
      return {
        reportId,
        columns: ["collectionNumber", "customer", "amountPkr", "paymentMethod", "createdAt"],
        rows: rows
          .filter((r) => {
            const day = r.createdAt.toISOString().slice(0, 10);
            if (from && day < from) return false;
            if (to && day > to) return false;
            return true;
          })
          .map((r) => ({
            collectionNumber: r.collectionNumber,
            customer: custName.get(r.tradeCustomerId) ?? r.tradeCustomerId,
            amountPkr: r.amountPkr,
            paymentMethod: r.paymentMethod,
            createdAt: r.createdAt,
          })),
      };
    }

    if (reportId === "asn-register") {
      const rows = await this.db
        .select({
          assignmentDate: pharmacyAssignments.assignmentDate,
          taskType: pharmacyAssignments.taskType,
          status: pharmacyAssignments.status,
          targetSalesPkr: pharmacyAssignments.targetSalesPkr,
          targetCollectionPkr: pharmacyAssignments.targetCollectionPkr,
          employeeId: pharmacyAssignments.employeeId,
          createdAt: pharmacyAssignments.createdAt,
        })
        .from(pharmacyAssignments)
        .where(eq(pharmacyAssignments.organizationId, organizationId))
        .orderBy(desc(pharmacyAssignments.createdAt))
        .limit(500);
      const emps = await this.db
        .select({ id: popsEmployees.id, name: popsEmployees.displayName })
        .from(popsEmployees)
        .where(eq(popsEmployees.organizationId, organizationId))
        .limit(500);
      const empName = new Map(emps.map((e) => [e.id, e.name]));
      return {
        reportId,
        columns: [
          "assignmentDate",
          "employee",
          "taskType",
          "status",
          "targetSalesPkr",
          "targetCollectionPkr",
        ],
        rows: rows
          .filter((r) => {
            const day = String(r.assignmentDate);
            if (from && day < from) return false;
            if (to && day > to) return false;
            return true;
          })
          .map((r) => ({
            assignmentDate: r.assignmentDate,
            employee: empName.get(r.employeeId) ?? r.employeeId,
            taskType: r.taskType,
            status: r.status,
            targetSalesPkr: r.targetSalesPkr,
            targetCollectionPkr: r.targetCollectionPkr,
          })),
      };
    }

    throw new NotFoundException(`Report not available: ${reportId}`);
  }
}
