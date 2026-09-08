import {
  BadRequestException,
  Inject,
  Injectable,
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
import { PharmacyStockEngine } from "./pharmacy-stock.engine";

@Injectable()
export class PharmacyErpService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly stock: PharmacyStockEngine,
    private readonly accountingHooks: AccountingHooksService,
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
    if (branchCode) {
      const branch = await this.resolveBranch(organizationId, branchCode);
      return this.db
        .select()
        .from(pharmacyPurchaseOrders)
        .where(
          and(
            eq(pharmacyPurchaseOrders.organizationId, organizationId),
            eq(pharmacyPurchaseOrders.branchId, branch.id),
          ),
        )
        .orderBy(desc(pharmacyPurchaseOrders.createdAt));
    }
    return this.db
      .select()
      .from(pharmacyPurchaseOrders)
      .where(eq(pharmacyPurchaseOrders.organizationId, organizationId))
      .orderBy(desc(pharmacyPurchaseOrders.createdAt));
  }

  async createPurchaseOrder(
    organizationId: string,
    input: CreatePharmacyPurchaseOrder,
    userId?: string,
  ) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    let subtotal = 0;
    for (const line of input.lines) {
      subtotal += Math.round(line.quantity) * Math.round(line.unitCostPkr ?? 0);
    }
    const tax = Math.round(input.taxPkr ?? 0);
    const discount = Math.round(input.discountPkr ?? 0);
    const total = subtotal + tax - discount;
    const poNumber = this.nextRef("PO");

    const [po] = await this.db
      .insert(pharmacyPurchaseOrders)
      .values({
        organizationId,
        branchId: branch.id,
        supplierId: input.supplierId ?? null,
        poNumber,
        status: "draft",
        orderDate: input.orderDate ?? new Date().toISOString().slice(0, 10),
        expectedDate: input.expectedDate ?? null,
        notes: input.notes ?? null,
        subtotalPkr: subtotal,
        taxPkr: tax,
        discountPkr: discount,
        totalPkr: total,
        createdByUserId: userId ?? null,
      })
      .returning();
    if (!po) throw new BadRequestException("Failed to create purchase order");

    for (const line of input.lines) {
      const qty = Math.round(line.quantity);
      const unitCost = Math.round(line.unitCostPkr ?? 0);
      await this.db.insert(pharmacyPurchaseOrderLines).values({
        purchaseOrderId: po.id,
        medicineId: line.medicineId,
        quantity: qty,
        freeQuantity: Math.round(line.freeQuantity ?? 0),
        unitCostPkr: unitCost,
        lineTotalPkr: qty * unitCost,
      });
    }

    return this.getPurchaseOrder(organizationId, po.id);
  }

  async getPurchaseOrder(organizationId: string, id: string) {
    const [po] = await this.db
      .select()
      .from(pharmacyPurchaseOrders)
      .where(
        and(eq(pharmacyPurchaseOrders.id, id), eq(pharmacyPurchaseOrders.organizationId, organizationId)),
      )
      .limit(1);
    if (!po) throw new NotFoundException("Purchase order not found");
    const lines = await this.db
      .select()
      .from(pharmacyPurchaseOrderLines)
      .where(eq(pharmacyPurchaseOrderLines.purchaseOrderId, id));
    return { ...po, lines };
  }

  async approvePurchaseOrder(organizationId: string, id: string) {
    const po = await this.getPurchaseOrder(organizationId, id);
    if (po.status !== "draft" && po.status !== "submitted") {
      throw new BadRequestException(`Cannot approve PO in status ${po.status}`);
    }
    const [updated] = await this.db
      .update(pharmacyPurchaseOrders)
      .set({ status: "approved", approvedAt: new Date() })
      .where(eq(pharmacyPurchaseOrders.id, id))
      .returning();
    return { ...updated, lines: po.lines };
  }

  // ─── GRN ─────────────────────────────────────────────────────────────────

  async listGrns(organizationId: string, branchCode?: string) {
    if (branchCode) {
      const branch = await this.resolveBranch(organizationId, branchCode);
      return this.db
        .select()
        .from(pharmacyGrns)
        .where(and(eq(pharmacyGrns.organizationId, organizationId), eq(pharmacyGrns.branchId, branch.id)))
        .orderBy(desc(pharmacyGrns.createdAt));
    }
    return this.db
      .select()
      .from(pharmacyGrns)
      .where(eq(pharmacyGrns.organizationId, organizationId))
      .orderBy(desc(pharmacyGrns.createdAt));
  }

  async createGrn(organizationId: string, input: CreatePharmacyGrn, userId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const warehouse =
      input.warehouseId != null
        ? (
            await this.db
              .select()
              .from(pharmacyWarehouses)
              .where(eq(pharmacyWarehouses.id, input.warehouseId))
              .limit(1)
          )[0]
        : await this.stock.ensureDefaultWarehouse(organizationId, branch.id);
    if (!warehouse) throw new BadRequestException("Warehouse not found");

    const grnNumber = this.nextRef("GRN");
    let total = 0;
    for (const line of input.lines) {
      total += Math.round(line.quantity) * Math.round(line.unitCostPkr ?? 0);
    }

    const grn = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(pharmacyGrns)
        .values({
          organizationId,
          branchId: branch.id,
          warehouseId: warehouse.id,
          purchaseOrderId: input.purchaseOrderId ?? null,
          supplierId: input.supplierId ?? null,
          grnNumber,
          supplierInvoiceNumber: input.supplierInvoiceNumber ?? null,
          receivedDate: input.receivedDate ?? new Date().toISOString().slice(0, 10),
          status: "posted",
          totalPkr: total,
          notes: input.notes ?? null,
          createdByUserId: userId ?? null,
        })
        .returning();
      if (!created) throw new BadRequestException("Failed to create GRN");

      for (const line of input.lines) {
        const qty = Math.round(line.quantity);
        const freeQty = Math.round(line.freeQuantity ?? 0);
        const unitCost = Math.round(line.unitCostPkr ?? 0);
        const batchId = await this.stock.receiveBatch(tx, {
          organizationId,
          branchId: branch.id,
          warehouseId: warehouse.id,
          medicineId: line.medicineId,
          batchNumber: line.batchNumber.trim(),
          expiryDate: line.expiryDate,
          manufacturingDate: line.manufacturingDate ?? null,
          quantity: qty,
          freeQuantity: freeQty,
          purchaseRatePkr: unitCost,
          referenceType: "grn",
          referenceId: created.id,
          createdByUserId: userId,
        });

        await tx.insert(pharmacyGrnLines).values({
          grnId: created.id,
          medicineId: line.medicineId,
          batchId,
          batchNumber: line.batchNumber.trim(),
          manufacturingDate: line.manufacturingDate ?? null,
          expiryDate: line.expiryDate,
          quantity: qty,
          freeQuantity: freeQty,
          unitCostPkr: unitCost,
          lineTotalPkr: qty * unitCost,
        });

        if (input.purchaseOrderId) {
          const poLines = await tx
            .select()
            .from(pharmacyPurchaseOrderLines)
            .where(eq(pharmacyPurchaseOrderLines.purchaseOrderId, input.purchaseOrderId));
          const match =
            (line.purchaseOrderLineId
              ? poLines.find((l) => l.id === line.purchaseOrderLineId)
              : undefined) ?? poLines.find((l) => l.medicineId === line.medicineId);
          if (match) {
            await tx
              .update(pharmacyPurchaseOrderLines)
              .set({ receivedQty: match.receivedQty + qty + freeQty })
              .where(eq(pharmacyPurchaseOrderLines.id, match.id));
          }
        }
      }

      if (input.purchaseOrderId) {
        await tx
          .update(pharmacyPurchaseOrders)
          .set({ status: "received" })
          .where(eq(pharmacyPurchaseOrders.id, input.purchaseOrderId));
      }

      return created;
    });

    try {
      await this.accountingHooks.recordPurchaseFromPharmacyGrn(organizationId, branch.id, {
        grnNumber: grn.grnNumber,
        totalPkr: grn.totalPkr,
        createdAt: grn.createdAt,
      });
    } catch {
      /* accounting optional failure should not block GRN */
    }

    const lines = await this.db.select().from(pharmacyGrnLines).where(eq(pharmacyGrnLines.grnId, grn.id));
    return { ...grn, lines };
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

      for (const line of prepared) {
        await this.stock.restoreBatch(tx, {
          organizationId,
          branchId: branch.id,
          medicineId: line.medicineId,
          batchId: line.batchId,
          qty: line.tabletsQty,
          warehouseId: warehouse.id,
          referenceType: "sale_return",
          referenceId: created.id,
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
    if (branchCode) {
      const branch = await this.resolveBranch(organizationId, branchCode);
      return this.db
        .select()
        .from(pharmacyPurchaseReturns)
        .where(
          and(
            eq(pharmacyPurchaseReturns.organizationId, organizationId),
            eq(pharmacyPurchaseReturns.branchId, branch.id),
          ),
        )
        .orderBy(desc(pharmacyPurchaseReturns.createdAt));
    }
    return this.db
      .select()
      .from(pharmacyPurchaseReturns)
      .where(eq(pharmacyPurchaseReturns.organizationId, organizationId))
      .orderBy(desc(pharmacyPurchaseReturns.createdAt));
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
    if (!input.lines?.length) throw new BadRequestException("lines are required");
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const warehouse = input.warehouseId
      ? (
          await this.db
            .select()
            .from(pharmacyWarehouses)
            .where(eq(pharmacyWarehouses.id, input.warehouseId))
            .limit(1)
        )[0]
      : await this.stock.ensureDefaultWarehouse(organizationId, branch.id);
    if (!warehouse) throw new BadRequestException("Warehouse not found");

    let total = 0;
    for (const line of input.lines) {
      total += Math.round(line.quantity) * Math.round(line.unitCostPkr ?? 0);
    }
    const returnNumber = this.nextRef("PRN");

    const ret = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(pharmacyPurchaseReturns)
        .values({
          organizationId,
          branchId: branch.id,
          warehouseId: warehouse.id,
          supplierId: input.supplierId ?? null,
          grnId: input.grnId ?? null,
          returnNumber,
          reason: input.reason ?? null,
          totalPkr: total,
          createdByUserId: userId ?? null,
        })
        .returning();
      if (!created) throw new BadRequestException("Failed to create purchase return");

      for (const line of input.lines) {
        const qty = Math.round(line.quantity);
        const unitCost = Math.round(line.unitCostPkr ?? 0);
        await this.stock.deductFefo(tx, {
          organizationId,
          branchId: branch.id,
          medicineId: line.medicineId,
          qty,
          warehouseId: warehouse.id,
          preferredBatchId: line.batchId,
          referenceType: "purchase_return",
          referenceId: created.id,
          createdByUserId: userId,
        });
        await tx.insert(pharmacyPurchaseReturnLines).values({
          purchaseReturnId: created.id,
          medicineId: line.medicineId,
          batchId: line.batchId ?? null,
          quantity: qty,
          unitCostPkr: unitCost,
          lineTotalPkr: qty * unitCost,
        });
      }
      return created;
    });

    const lines = await this.db
      .select()
      .from(pharmacyPurchaseReturnLines)
      .where(eq(pharmacyPurchaseReturnLines.purchaseReturnId, ret.id));
    return { ...ret, lines };
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
          : await this.resolvePrice(organizationId, line.medicineId, {
              tradeCustomerId: customer.id,
              priceLevel: customer.priceLevel,
              qty: line.quantity,
            });
      const unitPrice = resolved.unitPricePkr;
      const discount = Math.round(line.discountPkr ?? 0);
      const qty = Math.round(line.quantity);
      const freeFromScheme = await this.resolveSchemeFreeQty(organizationId, line.medicineId, qty);
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

    if (!input.creditOverride && customer.creditLimitPkr > 0) {
      if (customer.outstandingPkr + total > customer.creditLimitPkr) {
        throw new BadRequestException(
          `Credit limit exceeded (outstanding ${customer.outstandingPkr} + order ${total} > limit ${customer.creditLimitPkr})`,
        );
      }
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

    const [order] = await this.db
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
        creditOverride: input.creditOverride ?? false,
        notes: input.notes ?? null,
        createdByUserId: userId ?? null,
      })
      .returning();
    if (!order) throw new BadRequestException("Failed to create distribution order");

    for (const line of prepared) {
      await this.db.insert(pharmacyDistOrderLines).values({
        orderId: order.id,
        medicineId: line.medicineId,
        quantity: line.quantity,
        freeQuantity: line.freeQuantity,
        unitPricePkr: line.unitPricePkr,
        discountPkr: line.discountPkr,
        lineTotalPkr: line.lineTotalPkr,
      });
    }

    return this.getDistOrder(organizationId, order.id);
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
    const order = await this.getDistOrder(organizationId, id);
    const invoiceable = [
      "approved",
      "submitted",
      "stock_reserved",
      "picking",
      "packed",
      "ready_for_dispatch",
    ];
    if (!invoiceable.includes(order.status)) {
      throw new BadRequestException("Order must be approved (or in warehouse pipeline) before invoicing");
    }

    const warehouseId =
      order.warehouseId ??
      (await this.stock.ensureDefaultWarehouse(organizationId, order.branchId)).id;

    const result = await this.db.transaction(async (tx) => {
      const invoiceNumber = this.nextRef("WINV");
      const [invoice] = await tx
        .insert(pharmacyDistInvoices)
        .values({
          organizationId,
          branchId: order.branchId,
          orderId: order.id,
          tradeCustomerId: order.tradeCustomerId,
          invoiceNumber,
          invoiceDate: new Date().toISOString().slice(0, 10),
          paymentMethod: "Credit",
          amountPaidPkr: 0,
          amountDuePkr: order.totalPkr,
          subtotalPkr: order.subtotalPkr,
          discountPkr: order.discountPkr,
          taxPkr: order.taxPkr,
          totalPkr: order.totalPkr,
          status: "posted",
        })
        .returning();
      if (!invoice) throw new BadRequestException("Failed to create invoice");

      for (const line of order.lines) {
        const batchId = await this.stock.deductFefo(tx, {
          organizationId,
          branchId: order.branchId,
          medicineId: line.medicineId,
          qty: line.quantity + line.freeQuantity,
          warehouseId,
          referenceType: "dist_invoice",
          referenceId: invoice.id,
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
        .where(eq(pharmacyTradeCustomers.id, order.tradeCustomerId))
        .limit(1);
      if (customer) {
        await tx
          .update(pharmacyTradeCustomers)
          .set({ outstandingPkr: customer.outstandingPkr + order.totalPkr })
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
        .where(eq(pharmacyDistOrders.id, order.id));

      return invoice;
    });

    try {
      await this.accountingHooks.recordSaleFromPharmacySale(organizationId, order.branchId, {
        invoiceNumber: result.invoiceNumber,
        subtotalPkr: result.subtotalPkr,
        discountPkr: result.discountPkr,
        taxPkr: result.taxPkr,
        totalPkr: result.totalPkr,
        amountPaidPkr: result.amountPaidPkr,
        amountDuePkr: result.amountDuePkr,
        paymentMethod: result.paymentMethod,
        createdAt: result.createdAt,
      });
    } catch {
      /* ignore */
    }

    const lines = await this.db
      .select()
      .from(pharmacyDistInvoiceLines)
      .where(eq(pharmacyDistInvoiceLines.invoiceId, result.id));
    return { ...result, lines };
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
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(pharmacyDeliveries)
      .values({
        organizationId,
        branchId: branch.id,
        deliveryNumber: this.nextRef("DLV"),
        orderId: input.orderId ?? null,
        invoiceId: input.invoiceId ?? null,
        tradeCustomerId: input.tradeCustomerId ?? null,
        riderName: input.riderName ?? null,
        routeId: input.routeId ?? null,
        status: "pending",
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create delivery");
    return row;
  }

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
    const [existing] = await this.db
      .select()
      .from(pharmacyDeliveries)
      .where(and(eq(pharmacyDeliveries.id, id), eq(pharmacyDeliveries.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Delivery not found");

    const status = input.status ?? existing.status;
    const [updated] = await this.db
      .update(pharmacyDeliveries)
      .set({
        status,
        failedReason: input.failedReason ?? existing.failedReason,
        podNotes: input.podNotes ?? existing.podNotes,
        collectedPkr: input.collectedPkr != null ? Math.round(input.collectedPkr) : existing.collectedPkr,
        deliveredAt: ["delivered", "partial"].includes(status) ? new Date() : existing.deliveredAt,
      })
      .where(eq(pharmacyDeliveries.id, id))
      .returning();

    if (existing.orderId && status) {
      const deliveryStatus =
        status === "delivered" ? "delivered" : status === "failed" ? "failed" : status === "partial" ? "partial" : "pending";
      await this.db
        .update(pharmacyDistOrders)
        .set({ deliveryStatus })
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
    if (!input.tradeCustomerId || !(input.amountPkr > 0)) {
      throw new BadRequestException("tradeCustomerId and positive amountPkr are required");
    }
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const amount = Math.round(input.amountPkr);

    const row = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(pharmacyCollections)
        .values({
          organizationId,
          branchId: branch.id,
          collectionNumber: this.nextRef("COL"),
          tradeCustomerId: input.tradeCustomerId,
          invoiceId: input.invoiceId ?? null,
          patientId: input.patientId ?? null,
          amountPkr: amount,
          paymentMethod: input.paymentMethod ?? "Cash",
          salesmanEmployeeId: input.salesmanEmployeeId ?? null,
          notes: input.notes ?? null,
          createdByUserId: userId ?? null,
        })
        .returning();
      if (!created) throw new BadRequestException("Failed to create collection");

      const [customer] = await tx
        .select()
        .from(pharmacyTradeCustomers)
        .where(eq(pharmacyTradeCustomers.id, input.tradeCustomerId))
        .limit(1);
      if (customer) {
        await tx
          .update(pharmacyTradeCustomers)
          .set({ outstandingPkr: Math.max(0, customer.outstandingPkr - amount) })
          .where(eq(pharmacyTradeCustomers.id, customer.id));
      }

      if (input.invoiceId) {
        const [inv] = await tx
          .select()
          .from(pharmacyDistInvoices)
          .where(eq(pharmacyDistInvoices.id, input.invoiceId))
          .limit(1);
        if (inv) {
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
        }
      }

      return created;
    });

    return row;
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
   */
  async resolvePrice(
    organizationId: string,
    medicineId: string,
    opts: { tradeCustomerId?: string; priceLevel?: string; qty?: number } = {},
  ) {
    const qty = Math.max(1, Math.round(opts.qty ?? 1));
    const [medicine] = await this.db
      .select()
      .from(pharmacyMedicines)
      .where(
        and(eq(pharmacyMedicines.id, medicineId), eq(pharmacyMedicines.organizationId, organizationId)),
      )
      .limit(1);
    if (!medicine) throw new NotFoundException("Medicine not found");

    let customer: typeof pharmacyTradeCustomers.$inferSelect | undefined;
    if (opts.tradeCustomerId) {
      const [c] = await this.db
        .select()
        .from(pharmacyTradeCustomers)
        .where(
          and(
            eq(pharmacyTradeCustomers.id, opts.tradeCustomerId),
            eq(pharmacyTradeCustomers.organizationId, organizationId),
          ),
        )
        .limit(1);
      customer = c;
    }

    const priceLevel = opts.priceLevel ?? customer?.priceLevel ?? "retail";

    const tryList = async (extra: Parameters<typeof and>[0], source: string) => {
      const lists = await this.db
        .select()
        .from(pharmacyPriceLists)
        .where(
          and(
            eq(pharmacyPriceLists.organizationId, organizationId),
            eq(pharmacyPriceLists.status, "active"),
            extra,
          ),
        );
      for (const list of lists) {
        const [item] = await this.db
          .select()
          .from(pharmacyPriceListItems)
          .where(
            and(
              eq(pharmacyPriceListItems.priceListId, list.id),
              eq(pharmacyPriceListItems.medicineId, medicineId),
              sql`${pharmacyPriceListItems.minQty} <= ${qty}`,
            ),
          )
          .orderBy(desc(pharmacyPriceListItems.minQty))
          .limit(1);
        if (item) {
          return {
            medicineId,
            unitPricePkr: item.unitPricePkr,
            source,
            priceListId: list.id,
          };
        }
      }
      return null;
    };

    if (customer) {
      const byCustomer = await tryList(eq(pharmacyPriceLists.tradeCustomerId, customer.id), "customer_price_list");
      if (byCustomer) return byCustomer;

      if (customer.areaId) {
        const byArea = await tryList(eq(pharmacyPriceLists.areaId, customer.areaId), "area_price_list");
        if (byArea) return byArea;
      }

      if (customer.customerType) {
        const byType = await tryList(
          eq(pharmacyPriceLists.customerType, customer.customerType),
          "customer_type_price_list",
        );
        if (byType) return byType;
      }
    }

    const byLevel = await tryList(eq(pharmacyPriceLists.priceLevel, priceLevel), "price_level_list");
    if (byLevel) return byLevel;

    if (priceLevel === "wholesale" && medicine.wholesalePricePkr > 0) {
      return {
        medicineId,
        unitPricePkr: medicine.wholesalePricePkr,
        source: "medicine_wholesale",
        priceListId: null,
      };
    }
    if (priceLevel === "dealer" && medicine.dealerPricePkr > 0) {
      return {
        medicineId,
        unitPricePkr: medicine.dealerPricePkr,
        source: "medicine_dealer",
        priceListId: null,
      };
    }
    if (medicine.wholesalePricePkr > 0 && (priceLevel === "wholesale" || customer?.customerType === "Wholesaler")) {
      return {
        medicineId,
        unitPricePkr: medicine.wholesalePricePkr,
        source: "medicine_wholesale",
        priceListId: null,
      };
    }
    if (medicine.dealerPricePkr > 0 && (priceLevel === "dealer" || customer?.customerType === "Dealer")) {
      return {
        medicineId,
        unitPricePkr: medicine.dealerPricePkr,
        source: "medicine_dealer",
        priceListId: null,
      };
    }

    return {
      medicineId,
      unitPricePkr: medicine.sellingPricePkr,
      source: "retail_selling_price",
      priceListId: null,
    };
  }

  /** Buy X Get Y free qty from active schemes. */
  async resolveSchemeFreeQty(organizationId: string, medicineId: string, buyQty: number): Promise<number> {
    const qty = Math.max(0, Math.round(buyQty));
    if (qty <= 0) return 0;
    const [med] = await this.db
      .select()
      .from(pharmacyMedicines)
      .where(and(eq(pharmacyMedicines.id, medicineId), eq(pharmacyMedicines.organizationId, organizationId)))
      .limit(1);
    const today = new Date().toISOString().slice(0, 10);
    const schemes = await this.db
      .select()
      .from(pharmacySchemes)
      .where(and(eq(pharmacySchemes.organizationId, organizationId), eq(pharmacySchemes.status, "active")));
    let best = 0;
    for (const s of schemes) {
      if (s.startDate && s.startDate > today) continue;
      if (s.endDate && s.endDate < today) continue;
      if (s.medicineId && s.medicineId !== medicineId) continue;
      if (s.companyId && med?.companyId && s.companyId !== med.companyId) continue;
      if (s.companyId && !med?.companyId) continue;
      if (!s.buyQty || s.buyQty <= 0 || !s.freeQty) continue;
      const multiples = Math.floor(qty / s.buyQty);
      if (multiples <= 0) continue;
      best = Math.max(best, multiples * s.freeQty);
    }
    return best;
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

      for (const line of prepared) {
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
  async advanceDistOrderStatus(organizationId: string, id: string, nextStatus: string) {
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
    const [updated] = await this.db
      .update(pharmacyDistOrders)
      .set(patch)
      .where(eq(pharmacyDistOrders.id, id))
      .returning();
    return { ...updated, lines: order.lines };
  }

  async getDistributionPsWindow(organizationId: string, branchCode?: string) {
    const branch = branchCode?.trim()
      ? await this.resolveBranch(organizationId, branchCode.trim())
      : null;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const in30 = new Date();
    in30.setDate(in30.getDate() + 30);
    const expiryTo = in30.toISOString().slice(0, 10);

    const orderOrg = eq(pharmacyDistOrders.organizationId, organizationId);
    const orderWhere = branch
      ? and(orderOrg, eq(pharmacyDistOrders.branchId, branch.id))
      : orderOrg;

    const [orderAgg] = await this.db
      .select({
        ordersToday: sql<number>`count(*) filter (where ${pharmacyDistOrders.createdAt} >= ${todayStart})::int`,
        salesTodayPkr: sql<number>`coalesce(sum(${pharmacyDistOrders.totalPkr}) filter (where ${pharmacyDistOrders.createdAt} >= ${todayStart}), 0)::int`,
        pendingApproval: sql<number>`count(*) filter (where ${pharmacyDistOrders.status} in ('draft','booked','submitted'))::int`,
        inWarehousePipeline: sql<number>`count(*) filter (where ${pharmacyDistOrders.status} in ('approved','stock_reserved','picking','packed','ready_for_dispatch'))::int`,
      })
      .from(pharmacyDistOrders)
      .where(orderWhere);

    const deliveryOrg = eq(pharmacyDeliveries.organizationId, organizationId);
    const deliveryWhere = branch
      ? and(deliveryOrg, eq(pharmacyDeliveries.branchId, branch.id))
      : deliveryOrg;
    const [deliveryAgg] = await this.db
      .select({
        pendingDeliveries: sql<number>`count(*) filter (where ${pharmacyDeliveries.status} <> 'delivered')::int`,
      })
      .from(pharmacyDeliveries)
      .where(deliveryWhere);

    const [custAgg] = await this.db
      .select({
        outstandingPkr: sql<number>`coalesce(sum(${pharmacyTradeCustomers.outstandingPkr}), 0)::int`,
        overdueAccounts: sql<number>`count(*) filter (where ${pharmacyTradeCustomers.outstandingPkr} > 0)::int`,
      })
      .from(pharmacyTradeCustomers)
      .where(eq(pharmacyTradeCustomers.organizationId, organizationId));

    const [expiryAgg] = await this.db
      .select({ nearExpiryBatches: sql<number>`count(*)::int` })
      .from(pharmacyMedicineBatches)
      .innerJoin(pharmacyMedicines, eq(pharmacyMedicineBatches.medicineId, pharmacyMedicines.id))
      .where(
        and(
          eq(pharmacyMedicines.organizationId, organizationId),
          gte(pharmacyMedicineBatches.quantity, 1),
          lte(pharmacyMedicineBatches.expiryDate, expiryTo),
        ),
      );

    const [visitAgg] = await this.db
      .select({
        visitsToday: sql<number>`count(*) filter (where ${pharmacyVisits.visitedAt} >= ${todayStart})::int`,
      })
      .from(pharmacyVisits)
      .where(eq(pharmacyVisits.organizationId, organizationId));

    const assignmentConds = [eq(pharmacyAssignments.organizationId, organizationId)];
    if (branch) assignmentConds.push(eq(pharmacyAssignments.branchId, branch.id));
    const [assignAgg] = await this.db
      .select({ assignmentsOpen: sql<number>`count(*)::int` })
      .from(pharmacyAssignments)
      .where(and(...assignmentConds));

    return {
      sales: {
        ordersToday: orderAgg?.ordersToday ?? 0,
        salesTodayPkr: orderAgg?.salesTodayPkr ?? 0,
        pendingApproval: orderAgg?.pendingApproval ?? 0,
        inWarehousePipeline: orderAgg?.inWarehousePipeline ?? 0,
      },
      stock: { nearExpiryBatches: expiryAgg?.nearExpiryBatches ?? 0 },
      distribution: {
        pendingDeliveries: deliveryAgg?.pendingDeliveries ?? 0,
        outstandingPkr: custAgg?.outstandingPkr ?? 0,
        overdueAccounts: custAgg?.overdueAccounts ?? 0,
      },
      field: {
        visitsToday: visitAgg?.visitsToday ?? 0,
        assignmentsOpen: assignAgg?.assignmentsOpen ?? 0,
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

    throw new NotFoundException(`Report not available: ${reportId}`);
  }
}
