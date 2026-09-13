import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, count, eq, ilike, or, type SQL } from "drizzle-orm";
import {
  pharmacyAreas,
  pharmacyCities,
  pharmacyCompanies,
  pharmacyMedicines,
  pharmacyTerritories,
  pharmacyTradeCustomers,
  popsBranches,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";
import { StockAvailabilityService } from "../inventory/stock-availability.service";

export type LeanSaleProduct = {
  id: string;
  sku: string;
  name: string;
  genericName: string | null;
  brandName: string | null;
  companyName: string | null;
  barcode: string | null;
  unit: string;
  presentation: string | null;
  strength: string | null;
  wholesalePricePkr: number;
  sellingPricePkr: number;
  tabletsPerStrip: number;
  stripsPerBox: number;
  availableQty: number;
  nearExpiry: boolean;
};

export type LeanSaleCustomer = {
  id: string;
  code: string;
  name: string;
  customerType: string;
  phone: string | null;
  city: string | null;
  areaName: string | null;
  creditLimitPkr: number;
  outstandingPkr: number;
  creditDays: number;
  priceLevel: string;
  salesmanEmployeeId: string | null;
  territory: string | null;
};

@Injectable()
export class SalesSearchService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly availability: StockAvailabilityService,
  ) {}

  private clampPage(page?: number, pageSize?: number, defaultSize = 24, maxSize = 50) {
    const p = Math.max(1, Math.floor(page ?? 1));
    const size = Math.min(maxSize, Math.max(1, Math.floor(pageSize ?? defaultSize)));
    return { page: p, pageSize: size, offset: (p - 1) * size };
  }

  private async resolveBranch(organizationId: string, branchCode: string) {
    const code = branchCode?.trim();
    if (!code) throw new BadRequestException("branchCode is required");
    const [branch] = await this.db
      .select({ id: popsBranches.id, code: popsBranches.code })
      .from(popsBranches)
      .where(and(eq(popsBranches.organizationId, organizationId), eq(popsBranches.code, code)))
      .limit(1);
    if (!branch) throw new NotFoundException(`Branch not found: ${code}`);
    return branch;
  }

  private async attachAvailability(
    organizationId: string,
    branchId: string,
    warehouseId: string | undefined,
    rows: Omit<LeanSaleProduct, "availableQty" | "nearExpiry">[],
  ): Promise<LeanSaleProduct[]> {
    if (!rows.length) return [];
    const stock = await this.availability.getAvailability({
      organizationId,
      branchId,
      medicineIds: rows.map((r) => r.id),
      warehouseId: warehouseId ?? null,
    });
    const byId = new Map(stock.map((s) => [s.medicineId, s]));
    return rows.map((r) => {
      const s = byId.get(r.id);
      return {
        ...r,
        availableQty: s?.availableQty ?? 0,
        nearExpiry: (s?.nearExpiryQty ?? 0) > 0,
      };
    });
  }

  /**
   * Server-side lean product search for Dist Sale Window.
   * Active medicines only; ILIKE on name/sku/barcode/generic/brand + company name.
   */
  async searchProducts(
    organizationId: string,
    branchCode: string,
    q: string,
    opts: { page?: number; pageSize?: number; warehouseId?: string } = {},
  ) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const { page, pageSize, offset } = this.clampPage(opts.page, opts.pageSize, 24, 50);
    const term = q?.trim() ?? "";
    const like = term ? `%${term}%` : null;
    const conds: SQL[] = [
      eq(pharmacyMedicines.organizationId, organizationId),
      eq(pharmacyMedicines.branchId, branch.id),
      eq(pharmacyMedicines.status, "active"),
    ];
    if (like) {
      conds.push(
        or(
          ilike(pharmacyMedicines.name, like),
          ilike(pharmacyMedicines.sku, like),
          ilike(pharmacyMedicines.barcode, like),
          ilike(pharmacyMedicines.alternateBarcode, like),
          ilike(pharmacyMedicines.genericName, like),
          ilike(pharmacyMedicines.brandName, like),
          ilike(pharmacyCompanies.name, like),
        )!,
      );
    }

    const where = and(...conds);
    const fromJoin = this.db
      .select({
        id: pharmacyMedicines.id,
        sku: pharmacyMedicines.sku,
        name: pharmacyMedicines.name,
        genericName: pharmacyMedicines.genericName,
        brandName: pharmacyMedicines.brandName,
        companyName: pharmacyCompanies.name,
        barcode: pharmacyMedicines.barcode,
        unit: pharmacyMedicines.unit,
        presentation: pharmacyMedicines.presentation,
        strength: pharmacyMedicines.dosageStrength,
        wholesalePricePkr: pharmacyMedicines.wholesalePricePkr,
        sellingPricePkr: pharmacyMedicines.sellingPricePkr,
        tabletsPerStrip: pharmacyMedicines.tabletsPerStrip,
        stripsPerBox: pharmacyMedicines.stripsPerBox,
      })
      .from(pharmacyMedicines)
      .leftJoin(pharmacyCompanies, eq(pharmacyCompanies.id, pharmacyMedicines.companyId))
      .where(where);

    const [totalRow] = await this.db
      .select({ n: count() })
      .from(pharmacyMedicines)
      .leftJoin(pharmacyCompanies, eq(pharmacyCompanies.id, pharmacyMedicines.companyId))
      .where(where);

    const raw = await fromJoin.orderBy(asc(pharmacyMedicines.name)).limit(pageSize).offset(offset);
    const items = await this.attachAvailability(organizationId, branch.id, opts.warehouseId, raw);
    return { items, page, pageSize, total: Number(totalRow?.n ?? 0) };
  }

  /** Exact barcode or SKU match — returns 0/1/many lean rows with availableQty. */
  async lookupBarcode(
    organizationId: string,
    branchCode: string,
    barcode: string,
    warehouseId?: string,
  ) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const code = barcode?.trim();
    if (!code) throw new BadRequestException("barcode is required");

    const raw = await this.db
      .select({
        id: pharmacyMedicines.id,
        sku: pharmacyMedicines.sku,
        name: pharmacyMedicines.name,
        genericName: pharmacyMedicines.genericName,
        brandName: pharmacyMedicines.brandName,
        companyName: pharmacyCompanies.name,
        barcode: pharmacyMedicines.barcode,
        unit: pharmacyMedicines.unit,
        presentation: pharmacyMedicines.presentation,
        strength: pharmacyMedicines.dosageStrength,
        wholesalePricePkr: pharmacyMedicines.wholesalePricePkr,
        sellingPricePkr: pharmacyMedicines.sellingPricePkr,
        tabletsPerStrip: pharmacyMedicines.tabletsPerStrip,
        stripsPerBox: pharmacyMedicines.stripsPerBox,
      })
      .from(pharmacyMedicines)
      .leftJoin(pharmacyCompanies, eq(pharmacyCompanies.id, pharmacyMedicines.companyId))
      .where(
        and(
          eq(pharmacyMedicines.organizationId, organizationId),
          eq(pharmacyMedicines.branchId, branch.id),
          eq(pharmacyMedicines.status, "active"),
          or(
            eq(pharmacyMedicines.barcode, code),
            eq(pharmacyMedicines.alternateBarcode, code),
            eq(pharmacyMedicines.sku, code),
          )!,
        ),
      )
      .orderBy(asc(pharmacyMedicines.name))
      .limit(50);

    const items = await this.attachAvailability(organizationId, branch.id, warehouseId, raw);
    return { items, count: items.length };
  }

  /** Trade customer search for Sale Window customer bar. */
  async searchCustomers(
    organizationId: string,
    q: string,
    opts: { page?: number; pageSize?: number; customerType?: string } = {},
  ) {
    const { page, pageSize, offset } = this.clampPage(opts.page, opts.pageSize, 20, 50);
    const term = q?.trim() ?? "";
    const like = term ? `%${term}%` : null;
    const conds: SQL[] = [
      eq(pharmacyTradeCustomers.organizationId, organizationId),
      eq(pharmacyTradeCustomers.status, "active"),
    ];
    if (like) {
      conds.push(
        or(
          ilike(pharmacyTradeCustomers.name, like),
          ilike(pharmacyTradeCustomers.code, like),
          ilike(pharmacyTradeCustomers.phone, like),
          ilike(pharmacyTradeCustomers.businessName, like),
          ilike(pharmacyCities.name, like),
          ilike(pharmacyAreas.name, like),
        )!,
      );
    }
    if (opts.customerType?.trim()) {
      conds.push(eq(pharmacyTradeCustomers.customerType, opts.customerType.trim()));
    }

    const where = and(...conds);
    const [totalRow] = await this.db
      .select({ n: count() })
      .from(pharmacyTradeCustomers)
      .leftJoin(pharmacyCities, eq(pharmacyCities.id, pharmacyTradeCustomers.cityId))
      .leftJoin(pharmacyAreas, eq(pharmacyAreas.id, pharmacyTradeCustomers.areaId))
      .where(where);

    const rows = await this.db
      .select({
        id: pharmacyTradeCustomers.id,
        code: pharmacyTradeCustomers.code,
        name: pharmacyTradeCustomers.name,
        customerType: pharmacyTradeCustomers.customerType,
        phone: pharmacyTradeCustomers.phone,
        city: pharmacyCities.name,
        areaName: pharmacyAreas.name,
        creditLimitPkr: pharmacyTradeCustomers.creditLimitPkr,
        outstandingPkr: pharmacyTradeCustomers.outstandingPkr,
        creditDays: pharmacyTradeCustomers.creditDays,
        priceLevel: pharmacyTradeCustomers.priceLevel,
        salesmanEmployeeId: pharmacyTradeCustomers.salesmanEmployeeId,
        territory: pharmacyTerritories.name,
      })
      .from(pharmacyTradeCustomers)
      .leftJoin(pharmacyCities, eq(pharmacyCities.id, pharmacyTradeCustomers.cityId))
      .leftJoin(pharmacyAreas, eq(pharmacyAreas.id, pharmacyTradeCustomers.areaId))
      .leftJoin(pharmacyTerritories, eq(pharmacyTerritories.id, pharmacyTradeCustomers.territoryId))
      .where(where)
      .orderBy(asc(pharmacyTradeCustomers.name))
      .limit(pageSize)
      .offset(offset);

    return {
      items: rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        customerType: r.customerType,
        phone: r.phone,
        city: r.city,
        areaName: r.areaName,
        creditLimitPkr: r.creditLimitPkr,
        outstandingPkr: r.outstandingPkr,
        creditDays: r.creditDays,
        priceLevel: r.priceLevel,
        salesmanEmployeeId: r.salesmanEmployeeId,
        territory: r.territory,
      })),
      page,
      pageSize,
      total: Number(totalRow?.n ?? 0),
    };
  }
}
