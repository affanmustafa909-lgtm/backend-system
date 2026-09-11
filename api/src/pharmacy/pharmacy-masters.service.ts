import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import {
  pharmacyAuditLogs,
  pharmacyBrands,
  pharmacyCategories,
  pharmacyCompanies,
  pharmacyDistOrderLines,
  pharmacyDosageForms,
  pharmacyGenerics,
  pharmacyMedicines,
  pharmacyPriceListItems,
  pharmacyPriceLists,
  pharmacySaleLines,
  pharmacySalesForceProfiles,
  pharmacySchemes,
  pharmacyTaxProfiles,
  pharmacyTradeCustomers,
  pharmacyUnits,
  pharmacyWarehouses,
  popsBranches,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../drizzle/drizzle.tokens";

export type PageFilters = {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: string;
  sort?: string;
  companyId?: string;
  genericId?: string;
  parentId?: string;
  branchCode?: string;
};

export type PageResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

@Injectable()
export class PharmacyMastersService {
  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  private normalizePage(page?: number, pageSize?: number) {
    const p = Math.max(1, Math.floor(Number(page) || 1));
    const ps = Math.min(100, Math.max(1, Math.floor(Number(pageSize) || 25)));
    return { page: p, pageSize: ps, offset: (p - 1) * ps };
  }

  private normalizeCode(code: string) {
    return code.trim().toLowerCase();
  }

  private normalizeStatus(status?: string) {
    const s = (status ?? "active").trim().toLowerCase();
    if (s !== "active" && s !== "inactive") {
      throw new BadRequestException("status must be active or inactive");
    }
    return s;
  }

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

  private async writeAudit(input: {
    organizationId: string;
    branchId?: string | null;
    userId?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    oldValue?: unknown;
    newValue?: unknown;
    reason?: string;
  }) {
    await this.db.insert(pharmacyAuditLogs).values({
      organizationId: input.organizationId,
      branchId: input.branchId ?? null,
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      oldValueJson: input.oldValue === undefined ? null : JSON.stringify(input.oldValue),
      newValueJson: input.newValue === undefined ? null : JSON.stringify(input.newValue),
      reason: input.reason ?? null,
    });
  }

  private pageResult<T>(items: T[], total: number, page: number, pageSize: number): PageResult<T> {
    return {
      items,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  private async assertCodeUnique(
    organizationId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table: any,
    code: string,
    excludeId?: string,
  ) {
    const normalized = this.normalizeCode(code);
    if (!normalized) throw new BadRequestException("code is required");
    const conds: SQL[] = [
      eq(table.organizationId, organizationId),
      sql`lower(trim(${table.code})) = ${normalized}`,
    ];
    if (excludeId) conds.push(sql`${table.id} <> ${excludeId}`);
    const [hit] = await this.db.select({ id: table.id }).from(table).where(and(...conds)).limit(1);
    if (hit) throw new BadRequestException(`Duplicate code: ${code.trim()}`);
  }

  // ─── Generics ────────────────────────────────────────────────────────────

  async listGenerics(organizationId: string, filters: PageFilters = {}) {
    return this.listCodedMaster(organizationId, pharmacyGenerics, filters);
  }

  async createGeneric(
    organizationId: string,
    body: { code: string; name: string; description?: string; notes?: string; status?: string },
    userId?: string,
  ) {
    if (!body.code?.trim() || !body.name?.trim()) {
      throw new BadRequestException("code and name are required");
    }
    await this.assertCodeUnique(organizationId, pharmacyGenerics, body.code);
    const [row] = await this.db
      .insert(pharmacyGenerics)
      .values({
        organizationId,
        code: body.code.trim(),
        name: body.name.trim(),
        description: body.description?.trim() || null,
        notes: body.notes?.trim() || null,
        status: this.normalizeStatus(body.status),
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create generic");
    await this.writeAudit({
      organizationId,
      userId,
      action: "create",
      entityType: "pharmacy_generic",
      entityId: row.id,
      newValue: row,
    });
    return row;
  }

  async updateGeneric(
    organizationId: string,
    id: string,
    body: { code?: string; name?: string; description?: string | null; notes?: string | null; status?: string },
    userId?: string,
  ) {
    const existing = await this.getByOrgId(pharmacyGenerics, organizationId, id, "Generic");
    if (body.code !== undefined && this.normalizeCode(body.code) !== this.normalizeCode(existing.code)) {
      await this.assertCodeUnique(organizationId, pharmacyGenerics, body.code, id);
    }
    const [row] = await this.db
      .update(pharmacyGenerics)
      .set({
        code: body.code !== undefined ? body.code.trim() : existing.code,
        name: body.name !== undefined ? body.name.trim() : existing.name,
        description:
          body.description !== undefined ? (body.description?.trim() || null) : existing.description,
        notes: body.notes !== undefined ? (body.notes?.trim() || null) : existing.notes,
        status: body.status !== undefined ? this.normalizeStatus(body.status) : existing.status,
      })
      .where(eq(pharmacyGenerics.id, id))
      .returning();
    if (!row) throw new BadRequestException("Failed to update generic");
    await this.writeAudit({
      organizationId,
      userId,
      action: "update",
      entityType: "pharmacy_generic",
      entityId: id,
      oldValue: existing,
      newValue: row,
    });
    return row;
  }

  async setGenericStatus(organizationId: string, id: string, status: string, userId?: string) {
    return this.setMasterStatus(pharmacyGenerics, "pharmacy_generic", "Generic", organizationId, id, status, userId);
  }

  // ─── Brands ──────────────────────────────────────────────────────────────

  async listBrands(organizationId: string, filters: PageFilters = {}) {
    const { page, pageSize, offset } = this.normalizePage(filters.page, filters.pageSize);
    const conds: SQL[] = [eq(pharmacyBrands.organizationId, organizationId)];
    if (filters.status) conds.push(eq(pharmacyBrands.status, this.normalizeStatus(filters.status)));
    if (filters.companyId) conds.push(eq(pharmacyBrands.companyId, filters.companyId));
    if (filters.q?.trim()) {
      const q = `%${filters.q.trim()}%`;
      conds.push(or(ilike(pharmacyBrands.code, q), ilike(pharmacyBrands.name, q))!);
    }
    const where = and(...conds);
    const [totalRow] = await this.db.select({ n: count() }).from(pharmacyBrands).where(where);
    const items = await this.db
      .select()
      .from(pharmacyBrands)
      .where(where)
      .orderBy(asc(pharmacyBrands.name))
      .limit(pageSize)
      .offset(offset);
    return this.pageResult(items, Number(totalRow?.n ?? 0), page, pageSize);
  }

  async createBrand(
    organizationId: string,
    body: { code: string; name: string; companyId?: string; notes?: string; status?: string },
    userId?: string,
  ) {
    if (!body.code?.trim() || !body.name?.trim()) {
      throw new BadRequestException("code and name are required");
    }
    await this.assertCodeUnique(organizationId, pharmacyBrands, body.code);
    if (body.companyId) await this.assertCompany(organizationId, body.companyId);
    const [row] = await this.db
      .insert(pharmacyBrands)
      .values({
        organizationId,
        code: body.code.trim(),
        name: body.name.trim(),
        companyId: body.companyId ?? null,
        notes: body.notes?.trim() || null,
        status: this.normalizeStatus(body.status),
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create brand");
    await this.writeAudit({
      organizationId,
      userId,
      action: "create",
      entityType: "pharmacy_brand",
      entityId: row.id,
      newValue: row,
    });
    return row;
  }

  async updateBrand(
    organizationId: string,
    id: string,
    body: {
      code?: string;
      name?: string;
      companyId?: string | null;
      notes?: string | null;
      status?: string;
    },
    userId?: string,
  ) {
    const existing = await this.getByOrgId(pharmacyBrands, organizationId, id, "Brand");
    if (body.code !== undefined && this.normalizeCode(body.code) !== this.normalizeCode(existing.code)) {
      await this.assertCodeUnique(organizationId, pharmacyBrands, body.code, id);
    }
    if (body.companyId) await this.assertCompany(organizationId, body.companyId);
    const [row] = await this.db
      .update(pharmacyBrands)
      .set({
        code: body.code !== undefined ? body.code.trim() : existing.code,
        name: body.name !== undefined ? body.name.trim() : existing.name,
        companyId: body.companyId !== undefined ? body.companyId || null : existing.companyId,
        notes: body.notes !== undefined ? (body.notes?.trim() || null) : existing.notes,
        status: body.status !== undefined ? this.normalizeStatus(body.status) : existing.status,
      })
      .where(eq(pharmacyBrands.id, id))
      .returning();
    if (!row) throw new BadRequestException("Failed to update brand");
    await this.writeAudit({
      organizationId,
      userId,
      action: "update",
      entityType: "pharmacy_brand",
      entityId: id,
      oldValue: existing,
      newValue: row,
    });
    return row;
  }

  async setBrandStatus(organizationId: string, id: string, status: string, userId?: string) {
    return this.setMasterStatus(pharmacyBrands, "pharmacy_brand", "Brand", organizationId, id, status, userId);
  }

  // ─── Categories ──────────────────────────────────────────────────────────

  async listCategories(organizationId: string, filters: PageFilters = {}) {
    const { page, pageSize, offset } = this.normalizePage(filters.page, filters.pageSize);
    const conds: SQL[] = [eq(pharmacyCategories.organizationId, organizationId)];
    if (filters.status) conds.push(eq(pharmacyCategories.status, this.normalizeStatus(filters.status)));
    if (filters.parentId === "null") conds.push(isNull(pharmacyCategories.parentId));
    else if (filters.parentId) conds.push(eq(pharmacyCategories.parentId, filters.parentId));
    if (filters.q?.trim()) {
      const q = `%${filters.q.trim()}%`;
      conds.push(or(ilike(pharmacyCategories.code, q), ilike(pharmacyCategories.name, q))!);
    }
    const where = and(...conds);
    const [totalRow] = await this.db.select({ n: count() }).from(pharmacyCategories).where(where);
    const items = await this.db
      .select()
      .from(pharmacyCategories)
      .where(where)
      .orderBy(asc(pharmacyCategories.name))
      .limit(pageSize)
      .offset(offset);
    return this.pageResult(items, Number(totalRow?.n ?? 0), page, pageSize);
  }

  async createCategory(
    organizationId: string,
    body: { code: string; name: string; parentId?: string; notes?: string; status?: string },
    userId?: string,
  ) {
    if (!body.code?.trim() || !body.name?.trim()) {
      throw new BadRequestException("code and name are required");
    }
    await this.assertCodeUnique(organizationId, pharmacyCategories, body.code);
    if (body.parentId) await this.getByOrgId(pharmacyCategories, organizationId, body.parentId, "Parent category");
    const [row] = await this.db
      .insert(pharmacyCategories)
      .values({
        organizationId,
        code: body.code.trim(),
        name: body.name.trim(),
        parentId: body.parentId ?? null,
        notes: body.notes?.trim() || null,
        status: this.normalizeStatus(body.status),
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create category");
    await this.writeAudit({
      organizationId,
      userId,
      action: "create",
      entityType: "pharmacy_category",
      entityId: row.id,
      newValue: row,
    });
    return row;
  }

  async updateCategory(
    organizationId: string,
    id: string,
    body: {
      code?: string;
      name?: string;
      parentId?: string | null;
      notes?: string | null;
      status?: string;
    },
    userId?: string,
  ) {
    const existing = await this.getByOrgId(pharmacyCategories, organizationId, id, "Category");
    if (body.code !== undefined && this.normalizeCode(body.code) !== this.normalizeCode(existing.code)) {
      await this.assertCodeUnique(organizationId, pharmacyCategories, body.code, id);
    }
    if (body.parentId) {
      if (body.parentId === id) throw new BadRequestException("Category cannot be its own parent");
      await this.getByOrgId(pharmacyCategories, organizationId, body.parentId, "Parent category");
    }
    const [row] = await this.db
      .update(pharmacyCategories)
      .set({
        code: body.code !== undefined ? body.code.trim() : existing.code,
        name: body.name !== undefined ? body.name.trim() : existing.name,
        parentId: body.parentId !== undefined ? body.parentId || null : existing.parentId,
        notes: body.notes !== undefined ? (body.notes?.trim() || null) : existing.notes,
        status: body.status !== undefined ? this.normalizeStatus(body.status) : existing.status,
      })
      .where(eq(pharmacyCategories.id, id))
      .returning();
    if (!row) throw new BadRequestException("Failed to update category");
    await this.writeAudit({
      organizationId,
      userId,
      action: "update",
      entityType: "pharmacy_category",
      entityId: id,
      oldValue: existing,
      newValue: row,
    });
    return row;
  }

  async setCategoryStatus(organizationId: string, id: string, status: string, userId?: string) {
    return this.setMasterStatus(
      pharmacyCategories,
      "pharmacy_category",
      "Category",
      organizationId,
      id,
      status,
      userId,
    );
  }

  // ─── Dosage forms ────────────────────────────────────────────────────────

  async listDosageForms(organizationId: string, filters: PageFilters = {}) {
    return this.listCodedMaster(organizationId, pharmacyDosageForms, filters);
  }

  async createDosageForm(
    organizationId: string,
    body: { code: string; name: string; notes?: string; status?: string },
    userId?: string,
  ) {
    return this.createCodedMaster(
      pharmacyDosageForms,
      "pharmacy_dosage_form",
      organizationId,
      body,
      userId,
    );
  }

  async updateDosageForm(
    organizationId: string,
    id: string,
    body: { code?: string; name?: string; notes?: string | null; status?: string },
    userId?: string,
  ) {
    return this.updateCodedMaster(
      pharmacyDosageForms,
      "pharmacy_dosage_form",
      "Dosage form",
      organizationId,
      id,
      body,
      userId,
    );
  }

  async setDosageFormStatus(organizationId: string, id: string, status: string, userId?: string) {
    return this.setMasterStatus(
      pharmacyDosageForms,
      "pharmacy_dosage_form",
      "Dosage form",
      organizationId,
      id,
      status,
      userId,
    );
  }

  // ─── Units ───────────────────────────────────────────────────────────────

  async listUnits(organizationId: string, filters: PageFilters = {}) {
    return this.listCodedMaster(organizationId, pharmacyUnits, filters);
  }

  async createUnit(
    organizationId: string,
    body: { code: string; name: string; baseUnit?: string; notes?: string; status?: string },
    userId?: string,
  ) {
    if (!body.code?.trim() || !body.name?.trim()) {
      throw new BadRequestException("code and name are required");
    }
    await this.assertCodeUnique(organizationId, pharmacyUnits, body.code);
    const [row] = await this.db
      .insert(pharmacyUnits)
      .values({
        organizationId,
        code: body.code.trim(),
        name: body.name.trim(),
        baseUnit: body.baseUnit?.trim() || null,
        notes: body.notes?.trim() || null,
        status: this.normalizeStatus(body.status),
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create unit");
    await this.writeAudit({
      organizationId,
      userId,
      action: "create",
      entityType: "pharmacy_unit",
      entityId: row.id,
      newValue: row,
    });
    return row;
  }

  async updateUnit(
    organizationId: string,
    id: string,
    body: {
      code?: string;
      name?: string;
      baseUnit?: string | null;
      notes?: string | null;
      status?: string;
    },
    userId?: string,
  ) {
    const existing = await this.getByOrgId(pharmacyUnits, organizationId, id, "Unit");
    if (body.code !== undefined && this.normalizeCode(body.code) !== this.normalizeCode(existing.code)) {
      await this.assertCodeUnique(organizationId, pharmacyUnits, body.code, id);
    }
    const [row] = await this.db
      .update(pharmacyUnits)
      .set({
        code: body.code !== undefined ? body.code.trim() : existing.code,
        name: body.name !== undefined ? body.name.trim() : existing.name,
        baseUnit: body.baseUnit !== undefined ? (body.baseUnit?.trim() || null) : existing.baseUnit,
        notes: body.notes !== undefined ? (body.notes?.trim() || null) : existing.notes,
        status: body.status !== undefined ? this.normalizeStatus(body.status) : existing.status,
      })
      .where(eq(pharmacyUnits.id, id))
      .returning();
    if (!row) throw new BadRequestException("Failed to update unit");
    await this.writeAudit({
      organizationId,
      userId,
      action: "update",
      entityType: "pharmacy_unit",
      entityId: id,
      oldValue: existing,
      newValue: row,
    });
    return row;
  }

  async setUnitStatus(organizationId: string, id: string, status: string, userId?: string) {
    return this.setMasterStatus(pharmacyUnits, "pharmacy_unit", "Unit", organizationId, id, status, userId);
  }

  // ─── Tax profiles ────────────────────────────────────────────────────────

  async listTaxProfiles(organizationId: string, filters: PageFilters = {}) {
    return this.listCodedMaster(organizationId, pharmacyTaxProfiles, filters);
  }

  async createTaxProfile(
    organizationId: string,
    body: {
      code: string;
      name: string;
      ratePct?: number;
      taxType?: string;
      notes?: string;
      status?: string;
    },
    userId?: string,
  ) {
    if (!body.code?.trim() || !body.name?.trim()) {
      throw new BadRequestException("code and name are required");
    }
    await this.assertCodeUnique(organizationId, pharmacyTaxProfiles, body.code);
    const [row] = await this.db
      .insert(pharmacyTaxProfiles)
      .values({
        organizationId,
        code: body.code.trim(),
        name: body.name.trim(),
        ratePct: Math.round(body.ratePct ?? 0),
        taxType: body.taxType?.trim() || "percentage",
        notes: body.notes?.trim() || null,
        status: this.normalizeStatus(body.status),
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create tax profile");
    await this.writeAudit({
      organizationId,
      userId,
      action: "create",
      entityType: "pharmacy_tax_profile",
      entityId: row.id,
      newValue: row,
    });
    return row;
  }

  async updateTaxProfile(
    organizationId: string,
    id: string,
    body: {
      code?: string;
      name?: string;
      ratePct?: number;
      taxType?: string;
      notes?: string | null;
      status?: string;
    },
    userId?: string,
  ) {
    const existing = await this.getByOrgId(pharmacyTaxProfiles, organizationId, id, "Tax profile");
    if (body.code !== undefined && this.normalizeCode(body.code) !== this.normalizeCode(existing.code)) {
      await this.assertCodeUnique(organizationId, pharmacyTaxProfiles, body.code, id);
    }
    const [row] = await this.db
      .update(pharmacyTaxProfiles)
      .set({
        code: body.code !== undefined ? body.code.trim() : existing.code,
        name: body.name !== undefined ? body.name.trim() : existing.name,
        ratePct: body.ratePct !== undefined ? Math.round(body.ratePct) : existing.ratePct,
        taxType: body.taxType !== undefined ? body.taxType.trim() || existing.taxType : existing.taxType,
        notes: body.notes !== undefined ? (body.notes?.trim() || null) : existing.notes,
        status: body.status !== undefined ? this.normalizeStatus(body.status) : existing.status,
      })
      .where(eq(pharmacyTaxProfiles.id, id))
      .returning();
    if (!row) throw new BadRequestException("Failed to update tax profile");
    await this.writeAudit({
      organizationId,
      userId,
      action: "update",
      entityType: "pharmacy_tax_profile",
      entityId: id,
      oldValue: existing,
      newValue: row,
    });
    return row;
  }

  async setTaxProfileStatus(organizationId: string, id: string, status: string, userId?: string) {
    return this.setMasterStatus(
      pharmacyTaxProfiles,
      "pharmacy_tax_profile",
      "Tax profile",
      organizationId,
      id,
      status,
      userId,
    );
  }

  // ─── Companies (paged + update + status) ─────────────────────────────────

  async listCompaniesPaged(organizationId: string, filters: PageFilters = {}) {
    const { page, pageSize, offset } = this.normalizePage(filters.page, filters.pageSize);
    const conds: SQL[] = [eq(pharmacyCompanies.organizationId, organizationId)];
    if (filters.status) conds.push(eq(pharmacyCompanies.status, this.normalizeStatus(filters.status)));
    if (filters.q?.trim()) {
      const q = `%${filters.q.trim()}%`;
      conds.push(
        or(
          ilike(pharmacyCompanies.code, q),
          ilike(pharmacyCompanies.name, q),
          ilike(pharmacyCompanies.manufacturerName, q),
        )!,
      );
    }
    const where = and(...conds);
    const [totalRow] = await this.db.select({ n: count() }).from(pharmacyCompanies).where(where);
    const items = await this.db
      .select()
      .from(pharmacyCompanies)
      .where(where)
      .orderBy(desc(pharmacyCompanies.createdAt))
      .limit(pageSize)
      .offset(offset);
    return this.pageResult(items, Number(totalRow?.n ?? 0), page, pageSize);
  }

  async updateCompany(
    organizationId: string,
    id: string,
    body: Record<string, unknown>,
    userId?: string,
  ) {
    const existing = await this.getByOrgId(pharmacyCompanies, organizationId, id, "Company");
    if (typeof body.code === "string" && this.normalizeCode(body.code) !== this.normalizeCode(existing.code)) {
      const [dup] = await this.db
        .select({ id: pharmacyCompanies.id })
        .from(pharmacyCompanies)
        .where(
          and(
            eq(pharmacyCompanies.organizationId, organizationId),
            sql`lower(trim(${pharmacyCompanies.code})) = ${this.normalizeCode(body.code)}`,
            sql`${pharmacyCompanies.id} <> ${id}`,
          ),
        )
        .limit(1);
      if (dup) throw new BadRequestException(`Duplicate code: ${String(body.code).trim()}`);
    }
    const str = (v: unknown, fallback: string | null) =>
      v === undefined ? fallback : typeof v === "string" ? v.trim() || null : fallback;
    const [row] = await this.db
      .update(pharmacyCompanies)
      .set({
        code: typeof body.code === "string" ? body.code.trim() : existing.code,
        name: typeof body.name === "string" ? body.name.trim() : existing.name,
        manufacturerName: str(body.manufacturerName, existing.manufacturerName),
        contactPerson: str(body.contactPerson, existing.contactPerson),
        phone: str(body.phone, existing.phone),
        email: str(body.email, existing.email),
        address: str(body.address, existing.address),
        city: str(body.city, existing.city),
        country: str(body.country, existing.country) ?? existing.country,
        licenseInfo: str(body.licenseInfo, existing.licenseInfo),
        notes: str(body.notes, existing.notes),
        status:
          typeof body.status === "string" ? this.normalizeStatus(body.status) : existing.status,
      })
      .where(eq(pharmacyCompanies.id, id))
      .returning();
    if (!row) throw new BadRequestException("Failed to update company");
    await this.writeAudit({
      organizationId,
      userId,
      action: "update",
      entityType: "pharmacy_company",
      entityId: id,
      oldValue: existing,
      newValue: row,
    });
    return row;
  }

  async setCompanyStatus(organizationId: string, id: string, status: string, userId?: string) {
    return this.setMasterStatus(
      pharmacyCompanies,
      "pharmacy_company",
      "Company",
      organizationId,
      id,
      status,
      userId,
    );
  }

  // ─── Warehouses ──────────────────────────────────────────────────────────

  async listWarehousesPaged(organizationId: string, filters: PageFilters = {}) {
    const { page, pageSize, offset } = this.normalizePage(filters.page, filters.pageSize);
    const conds: SQL[] = [eq(pharmacyWarehouses.organizationId, organizationId)];
    if (filters.branchCode?.trim()) {
      const branch = await this.resolveBranch(organizationId, filters.branchCode);
      conds.push(eq(pharmacyWarehouses.branchId, branch.id));
    }
    if (filters.status) conds.push(eq(pharmacyWarehouses.status, this.normalizeStatus(filters.status)));
    if (filters.q?.trim()) {
      const q = `%${filters.q.trim()}%`;
      conds.push(or(ilike(pharmacyWarehouses.code, q), ilike(pharmacyWarehouses.name, q))!);
    }
    const where = and(...conds);
    const [totalRow] = await this.db.select({ n: count() }).from(pharmacyWarehouses).where(where);
    const items = await this.db
      .select()
      .from(pharmacyWarehouses)
      .where(where)
      .orderBy(desc(pharmacyWarehouses.createdAt))
      .limit(pageSize)
      .offset(offset);
    return this.pageResult(items, Number(totalRow?.n ?? 0), page, pageSize);
  }

  async updateWarehouse(
    organizationId: string,
    id: string,
    body: Record<string, unknown>,
    userId?: string,
  ) {
    const existing = await this.getByOrgId(pharmacyWarehouses, organizationId, id, "Warehouse");
    const str = (v: unknown, fallback: string | null) =>
      v === undefined ? fallback : typeof v === "string" ? v.trim() || null : fallback;
    if (body.isDefault === true) {
      await this.db
        .update(pharmacyWarehouses)
        .set({ isDefault: false })
        .where(
          and(
            eq(pharmacyWarehouses.organizationId, organizationId),
            eq(pharmacyWarehouses.branchId, existing.branchId),
          ),
        );
    }
    const [row] = await this.db
      .update(pharmacyWarehouses)
      .set({
        code: typeof body.code === "string" ? body.code.trim() : existing.code,
        name: typeof body.name === "string" ? body.name.trim() : existing.name,
        address: str(body.address, existing.address),
        city: str(body.city, existing.city),
        area: str(body.area, existing.area),
        managerName: str(body.managerName, existing.managerName),
        isDefault: typeof body.isDefault === "boolean" ? body.isDefault : existing.isDefault,
        status:
          typeof body.status === "string" ? this.normalizeStatus(body.status) : existing.status,
      })
      .where(eq(pharmacyWarehouses.id, id))
      .returning();
    if (!row) throw new BadRequestException("Failed to update warehouse");
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      entityType: "pharmacy_warehouse",
      entityId: id,
      oldValue: existing,
      newValue: row,
    });
    return row;
  }

  async setWarehouseStatus(organizationId: string, id: string, status: string, userId?: string) {
    return this.setMasterStatus(
      pharmacyWarehouses,
      "pharmacy_warehouse",
      "Warehouse",
      organizationId,
      id,
      status,
      userId,
    );
  }

  // ─── Trade customers ─────────────────────────────────────────────────────

  async listTradeCustomersPaged(organizationId: string, filters: PageFilters = {}) {
    const { page, pageSize, offset } = this.normalizePage(filters.page, filters.pageSize);
    const conds: SQL[] = [eq(pharmacyTradeCustomers.organizationId, organizationId)];
    if (filters.status) {
      conds.push(eq(pharmacyTradeCustomers.status, this.normalizeStatus(filters.status)));
    }
    if (filters.q?.trim()) {
      const q = `%${filters.q.trim()}%`;
      conds.push(
        or(
          ilike(pharmacyTradeCustomers.code, q),
          ilike(pharmacyTradeCustomers.name, q),
          ilike(pharmacyTradeCustomers.businessName, q),
          ilike(pharmacyTradeCustomers.phone, q),
        )!,
      );
    }
    const where = and(...conds);
    const [totalRow] = await this.db.select({ n: count() }).from(pharmacyTradeCustomers).where(where);
    const items = await this.db
      .select()
      .from(pharmacyTradeCustomers)
      .where(where)
      .orderBy(desc(pharmacyTradeCustomers.createdAt))
      .limit(pageSize)
      .offset(offset);
    return this.pageResult(items, Number(totalRow?.n ?? 0), page, pageSize);
  }

  async updateTradeCustomer(
    organizationId: string,
    id: string,
    body: Record<string, unknown>,
    userId?: string,
  ) {
    const existing = await this.getByOrgId(pharmacyTradeCustomers, organizationId, id, "Trade customer");
    const str = (v: unknown, fallback: string | null) =>
      v === undefined ? fallback : typeof v === "string" ? v.trim() || null : fallback;
    const num = (v: unknown, fallback: number) =>
      v === undefined || v === null ? fallback : Math.round(Number(v));
    const [row] = await this.db
      .update(pharmacyTradeCustomers)
      .set({
        code: typeof body.code === "string" ? body.code.trim() : existing.code,
        name: typeof body.name === "string" ? body.name.trim() : existing.name,
        businessName: str(body.businessName, existing.businessName),
        customerType:
          typeof body.customerType === "string" ? body.customerType.trim() : existing.customerType,
        phone: str(body.phone, existing.phone),
        whatsapp: str(body.whatsapp, existing.whatsapp),
        email: str(body.email, existing.email),
        address: str(body.address, existing.address),
        cityId: body.cityId !== undefined ? (body.cityId as string | null) || null : existing.cityId,
        areaId: body.areaId !== undefined ? (body.areaId as string | null) || null : existing.areaId,
        territoryId:
          body.territoryId !== undefined
            ? (body.territoryId as string | null) || null
            : existing.territoryId,
        routeId: body.routeId !== undefined ? (body.routeId as string | null) || null : existing.routeId,
        salesmanEmployeeId:
          body.salesmanEmployeeId !== undefined
            ? (body.salesmanEmployeeId as string | null) || null
            : existing.salesmanEmployeeId,
        creditLimitPkr: num(body.creditLimitPkr, existing.creditLimitPkr),
        creditDays: num(body.creditDays, existing.creditDays),
        priceLevel: typeof body.priceLevel === "string" ? body.priceLevel.trim() : existing.priceLevel,
        discountPct: num(body.discountPct, existing.discountPct),
        taxInfo: str(body.taxInfo, existing.taxInfo),
        status:
          typeof body.status === "string" ? this.normalizeStatus(body.status) : existing.status,
      })
      .where(eq(pharmacyTradeCustomers.id, id))
      .returning();
    if (!row) throw new BadRequestException("Failed to update trade customer");
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      entityType: "pharmacy_trade_customer",
      entityId: id,
      oldValue: existing,
      newValue: row,
    });
    return row;
  }

  async setTradeCustomerStatus(organizationId: string, id: string, status: string, userId?: string) {
    return this.setMasterStatus(
      pharmacyTradeCustomers,
      "pharmacy_trade_customer",
      "Trade customer",
      organizationId,
      id,
      status,
      userId,
    );
  }

  // ─── Sales force ─────────────────────────────────────────────────────────

  async updateSalesForce(
    organizationId: string,
    id: string,
    body: {
      fieldRole?: string;
      territoryId?: string | null;
      cityId?: string | null;
      areaId?: string | null;
      status?: string;
    },
    userId?: string,
  ) {
    const existing = await this.getByOrgId(
      pharmacySalesForceProfiles,
      organizationId,
      id,
      "Sales force profile",
    );
    const [row] = await this.db
      .update(pharmacySalesForceProfiles)
      .set({
        fieldRole: body.fieldRole !== undefined ? body.fieldRole.trim() : existing.fieldRole,
        territoryId: body.territoryId !== undefined ? body.territoryId || null : existing.territoryId,
        cityId: body.cityId !== undefined ? body.cityId || null : existing.cityId,
        areaId: body.areaId !== undefined ? body.areaId || null : existing.areaId,
        status: body.status !== undefined ? this.normalizeStatus(body.status) : existing.status,
      })
      .where(eq(pharmacySalesForceProfiles.id, id))
      .returning();
    if (!row) throw new BadRequestException("Failed to update sales force profile");
    await this.writeAudit({
      organizationId,
      userId,
      action: "update",
      entityType: "pharmacy_sales_force",
      entityId: id,
      oldValue: existing,
      newValue: row,
    });
    return row;
  }

  async setSalesForceStatus(organizationId: string, id: string, status: string, userId?: string) {
    return this.setMasterStatus(
      pharmacySalesForceProfiles,
      "pharmacy_sales_force",
      "Sales force profile",
      organizationId,
      id,
      status,
      userId,
    );
  }

  // ─── Price lists ─────────────────────────────────────────────────────────

  async updatePriceList(
    organizationId: string,
    id: string,
    body: {
      name?: string;
      code?: string | null;
      priceLevel?: string;
      customerType?: string | null;
      areaId?: string | null;
      tradeCustomerId?: string | null;
      status?: string;
    },
    userId?: string,
  ) {
    const existing = await this.getByOrgId(pharmacyPriceLists, organizationId, id, "Price list");
    const [row] = await this.db
      .update(pharmacyPriceLists)
      .set({
        name: body.name !== undefined ? body.name.trim() : existing.name,
        code: body.code !== undefined ? (body.code?.trim() || null) : existing.code,
        priceLevel: body.priceLevel !== undefined ? body.priceLevel.trim() : existing.priceLevel,
        customerType:
          body.customerType !== undefined ? (body.customerType?.trim() || null) : existing.customerType,
        areaId: body.areaId !== undefined ? body.areaId || null : existing.areaId,
        tradeCustomerId:
          body.tradeCustomerId !== undefined ? body.tradeCustomerId || null : existing.tradeCustomerId,
        status: body.status !== undefined ? this.normalizeStatus(body.status) : existing.status,
      })
      .where(eq(pharmacyPriceLists.id, id))
      .returning();
    if (!row) throw new BadRequestException("Failed to update price list");
    await this.writeAudit({
      organizationId,
      userId,
      action: "update",
      entityType: "pharmacy_price_list",
      entityId: id,
      oldValue: existing,
      newValue: row,
    });
    return row;
  }

  async listPriceListItems(organizationId: string, priceListId: string) {
    await this.getByOrgId(pharmacyPriceLists, organizationId, priceListId, "Price list");
    return this.db
      .select()
      .from(pharmacyPriceListItems)
      .where(eq(pharmacyPriceListItems.priceListId, priceListId))
      .orderBy(asc(pharmacyPriceListItems.medicineId));
  }

  async upsertPriceListItems(
    organizationId: string,
    priceListId: string,
    items: { medicineId: string; unitPricePkr: number; minQty?: number }[],
    userId?: string,
  ) {
    await this.getByOrgId(pharmacyPriceLists, organizationId, priceListId, "Price list");
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException("items array is required");
    }
    const upserted = [];
    for (const item of items) {
      if (!item.medicineId) throw new BadRequestException("medicineId is required");
      const [med] = await this.db
        .select({ id: pharmacyMedicines.id })
        .from(pharmacyMedicines)
        .where(
          and(
            eq(pharmacyMedicines.id, item.medicineId),
            eq(pharmacyMedicines.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!med) throw new NotFoundException(`Medicine not found: ${item.medicineId}`);

      const [existing] = await this.db
        .select()
        .from(pharmacyPriceListItems)
        .where(
          and(
            eq(pharmacyPriceListItems.priceListId, priceListId),
            eq(pharmacyPriceListItems.medicineId, item.medicineId),
          ),
        )
        .limit(1);

      if (existing) {
        const [row] = await this.db
          .update(pharmacyPriceListItems)
          .set({
            unitPricePkr: Math.round(item.unitPricePkr),
            minQty: Math.round(item.minQty ?? existing.minQty ?? 1),
          })
          .where(eq(pharmacyPriceListItems.id, existing.id))
          .returning();
        if (row) upserted.push(row);
      } else {
        const [row] = await this.db
          .insert(pharmacyPriceListItems)
          .values({
            priceListId,
            medicineId: item.medicineId,
            unitPricePkr: Math.round(item.unitPricePkr),
            minQty: Math.round(item.minQty ?? 1),
          })
          .returning();
        if (row) upserted.push(row);
      }
    }
    await this.writeAudit({
      organizationId,
      userId,
      action: "upsert_items",
      entityType: "pharmacy_price_list",
      entityId: priceListId,
      newValue: { count: upserted.length },
    });
    return upserted;
  }

  // ─── Schemes ─────────────────────────────────────────────────────────────

  async updateScheme(
    organizationId: string,
    id: string,
    body: {
      name?: string;
      schemeType?: string;
      medicineId?: string | null;
      companyId?: string | null;
      buyQty?: number;
      freeQty?: number;
      startDate?: string | null;
      endDate?: string | null;
      priority?: number;
      status?: string;
    },
    userId?: string,
  ) {
    const existing = await this.getByOrgId(pharmacySchemes, organizationId, id, "Scheme");
    const [row] = await this.db
      .update(pharmacySchemes)
      .set({
        name: body.name !== undefined ? body.name.trim() : existing.name,
        schemeType: body.schemeType !== undefined ? body.schemeType.trim() : existing.schemeType,
        medicineId: body.medicineId !== undefined ? body.medicineId || null : existing.medicineId,
        companyId: body.companyId !== undefined ? body.companyId || null : existing.companyId,
        buyQty: body.buyQty !== undefined ? Math.round(body.buyQty) : existing.buyQty,
        freeQty: body.freeQty !== undefined ? Math.round(body.freeQty) : existing.freeQty,
        startDate: body.startDate !== undefined ? body.startDate || null : existing.startDate,
        endDate: body.endDate !== undefined ? body.endDate || null : existing.endDate,
        priority: body.priority !== undefined ? Math.round(body.priority) : existing.priority,
        status: body.status !== undefined ? this.normalizeStatus(body.status) : existing.status,
      })
      .where(eq(pharmacySchemes.id, id))
      .returning();
    if (!row) throw new BadRequestException("Failed to update scheme");
    await this.writeAudit({
      organizationId,
      userId,
      action: "update",
      entityType: "pharmacy_scheme",
      entityId: id,
      oldValue: existing,
      newValue: row,
    });
    return row;
  }

  // ─── Medicines ───────────────────────────────────────────────────────────

  async listMedicinesPaged(
    organizationId: string,
    branchCode: string,
    filters: PageFilters & { companyId?: string; genericId?: string } = {},
  ) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const { page, pageSize, offset } = this.normalizePage(filters.page, filters.pageSize);
    const conds: SQL[] = [
      eq(pharmacyMedicines.organizationId, organizationId),
      eq(pharmacyMedicines.branchId, branch.id),
    ];
    if (filters.status) conds.push(eq(pharmacyMedicines.status, this.normalizeStatus(filters.status)));
    if (filters.companyId) conds.push(eq(pharmacyMedicines.companyId, filters.companyId));
    if (filters.genericId) conds.push(eq(pharmacyMedicines.genericId, filters.genericId));
    if (filters.q?.trim()) {
      const q = `%${filters.q.trim()}%`;
      conds.push(
        or(
          ilike(pharmacyMedicines.sku, q),
          ilike(pharmacyMedicines.name, q),
          ilike(pharmacyMedicines.genericName, q),
          ilike(pharmacyMedicines.brandName, q),
          ilike(pharmacyMedicines.barcode, q),
        )!,
      );
    }
    const where = and(...conds);
    const [totalRow] = await this.db.select({ n: count() }).from(pharmacyMedicines).where(where);
    const items = await this.db
      .select()
      .from(pharmacyMedicines)
      .where(where)
      .orderBy(asc(pharmacyMedicines.name))
      .limit(pageSize)
      .offset(offset);
    return this.pageResult(items, Number(totalRow?.n ?? 0), page, pageSize);
  }

  async getMedicineDetail(organizationId: string, id: string) {
    const [med] = await this.db
      .select()
      .from(pharmacyMedicines)
      .where(and(eq(pharmacyMedicines.id, id), eq(pharmacyMedicines.organizationId, organizationId)))
      .limit(1);
    if (!med) throw new NotFoundException("Medicine not found");

    const [company] = med.companyId
      ? await this.db
          .select({ id: pharmacyCompanies.id, code: pharmacyCompanies.code, name: pharmacyCompanies.name })
          .from(pharmacyCompanies)
          .where(eq(pharmacyCompanies.id, med.companyId))
          .limit(1)
      : [null];
    const [generic] = med.genericId
      ? await this.db
          .select({ id: pharmacyGenerics.id, code: pharmacyGenerics.code, name: pharmacyGenerics.name })
          .from(pharmacyGenerics)
          .where(eq(pharmacyGenerics.id, med.genericId))
          .limit(1)
      : [null];
    const [brand] = med.brandId
      ? await this.db
          .select({ id: pharmacyBrands.id, code: pharmacyBrands.code, name: pharmacyBrands.name })
          .from(pharmacyBrands)
          .where(eq(pharmacyBrands.id, med.brandId))
          .limit(1)
      : [null];
    const [category] = med.categoryId
      ? await this.db
          .select({
            id: pharmacyCategories.id,
            code: pharmacyCategories.code,
            name: pharmacyCategories.name,
          })
          .from(pharmacyCategories)
          .where(eq(pharmacyCategories.id, med.categoryId))
          .limit(1)
      : [null];
    const [dosageForm] = med.dosageFormId
      ? await this.db
          .select({
            id: pharmacyDosageForms.id,
            code: pharmacyDosageForms.code,
            name: pharmacyDosageForms.name,
          })
          .from(pharmacyDosageForms)
          .where(eq(pharmacyDosageForms.id, med.dosageFormId))
          .limit(1)
      : [null];
    const [unit] = med.unitId
      ? await this.db
          .select({ id: pharmacyUnits.id, code: pharmacyUnits.code, name: pharmacyUnits.name })
          .from(pharmacyUnits)
          .where(eq(pharmacyUnits.id, med.unitId))
          .limit(1)
      : [null];
    const [taxProfile] = med.taxProfileId
      ? await this.db
          .select({
            id: pharmacyTaxProfiles.id,
            code: pharmacyTaxProfiles.code,
            name: pharmacyTaxProfiles.name,
            ratePct: pharmacyTaxProfiles.ratePct,
          })
          .from(pharmacyTaxProfiles)
          .where(eq(pharmacyTaxProfiles.id, med.taxProfileId))
          .limit(1)
      : [null];

    return {
      ...med,
      companyName: company?.name ?? null,
      companyCode: company?.code ?? null,
      genericNameMaster: generic?.name ?? null,
      brandNameMaster: brand?.name ?? null,
      categoryNameMaster: category?.name ?? null,
      dosageFormName: dosageForm?.name ?? null,
      unitNameMaster: unit?.name ?? null,
      taxProfileName: taxProfile?.name ?? null,
      taxProfileRatePct: taxProfile?.ratePct ?? null,
      refs: { company, generic, brand, category, dosageForm, unit, taxProfile },
    };
  }

  async updateMedicineMasters(
    organizationId: string,
    id: string,
    body: Record<string, unknown>,
    userId?: string,
  ) {
    const existing = await this.getByOrgId(pharmacyMedicines, organizationId, id, "Medicine");

    if (typeof body.sku === "string" && body.sku.trim() && body.sku.trim() !== existing.sku) {
      const [dup] = await this.db
        .select({ id: pharmacyMedicines.id })
        .from(pharmacyMedicines)
        .where(
          and(
            eq(pharmacyMedicines.organizationId, organizationId),
            eq(pharmacyMedicines.branchId, existing.branchId),
            sql`lower(trim(${pharmacyMedicines.sku})) = ${body.sku.trim().toLowerCase()}`,
            sql`${pharmacyMedicines.id} <> ${id}`,
          ),
        )
        .limit(1);
      if (dup) throw new BadRequestException(`Duplicate SKU: ${body.sku.trim()}`);
    }

    const str = (v: unknown, fallback: string | null) =>
      v === undefined ? fallback : typeof v === "string" ? v.trim() || null : fallback;
    const num = (v: unknown, fallback: number) =>
      v === undefined || v === null ? fallback : Math.round(Number(v));
    const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
    const uuidOrNull = (v: unknown, fallback: string | null) =>
      v === undefined ? fallback : v ? String(v) : null;

    const [row] = await this.db
      .update(pharmacyMedicines)
      .set({
        sku: typeof body.sku === "string" ? body.sku.trim() : existing.sku,
        name: typeof body.name === "string" ? body.name.trim() : existing.name,
        genericName: str(body.genericName, existing.genericName),
        brandName: str(body.brandName, existing.brandName),
        category: typeof body.category === "string" ? body.category.trim() : existing.category,
        manufacturer: str(body.manufacturer, existing.manufacturer),
        unit: typeof body.unit === "string" ? body.unit.trim() : existing.unit,
        companyId: uuidOrNull(body.companyId, existing.companyId),
        genericId: uuidOrNull(body.genericId, existing.genericId),
        brandId: uuidOrNull(body.brandId, existing.brandId),
        categoryId: uuidOrNull(body.categoryId, existing.categoryId),
        dosageFormId: uuidOrNull(body.dosageFormId, existing.dosageFormId),
        unitId: uuidOrNull(body.unitId, existing.unitId),
        taxProfileId: uuidOrNull(body.taxProfileId, existing.taxProfileId),
        barcode: str(body.barcode, existing.barcode),
        alternateBarcode: str(body.alternateBarcode, existing.alternateBarcode),
        purchasePricePkr: num(body.purchasePricePkr ?? body.purchasePrice, existing.purchasePricePkr),
        sellingPricePkr: num(body.sellingPricePkr ?? body.sellingPrice, existing.sellingPricePkr),
        costPricePkr: num(body.costPricePkr ?? body.costPrice, existing.costPricePkr),
        wholesalePricePkr: num(body.wholesalePricePkr ?? body.wholesalePrice, existing.wholesalePricePkr),
        dealerPricePkr: num(body.dealerPricePkr ?? body.dealerPrice, existing.dealerPricePkr),
        minSalePricePkr: num(body.minSalePricePkr ?? body.minSalePrice, existing.minSalePricePkr),
        maxRetailPricePkr: num(body.maxRetailPricePkr ?? body.maxRetailPrice, existing.maxRetailPricePkr),
        taxPct: num(body.taxPct, existing.taxPct),
        reorderLevel: num(body.reorderLevel, existing.reorderLevel),
        suggestedReorderQty: num(body.suggestedReorderQty, existing.suggestedReorderQty),
        minStock: num(body.minStock, existing.minStock),
        maxStock: num(body.maxStock, existing.maxStock),
        rackLocation: str(body.rackLocation, existing.rackLocation),
        shelfLocation: str(body.shelfLocation, existing.shelfLocation),
        aisleLocation: str(body.aisleLocation, existing.aisleLocation),
        preferredWarehouseId: uuidOrNull(body.preferredWarehouseId, existing.preferredWarehouseId),
        dosageStrength: str(body.dosageStrength, existing.dosageStrength),
        presentation: str(body.presentation, existing.presentation),
        tabletsPerStrip:
          body.tabletsPerStrip !== undefined
            ? Math.max(1, Math.round(Number(body.tabletsPerStrip)))
            : existing.tabletsPerStrip,
        stripsPerBox:
          body.stripsPerBox !== undefined
            ? Math.max(1, Math.round(Number(body.stripsPerBox)))
            : existing.stripsPerBox,
        isControlled: bool(body.isControlled, existing.isControlled),
        prescriptionRequired: bool(body.prescriptionRequired, existing.prescriptionRequired),
        batchTrackingEnabled: bool(body.batchTrackingEnabled, existing.batchTrackingEnabled),
        expiryTrackingEnabled: bool(body.expiryTrackingEnabled, existing.expiryTrackingEnabled),
        fefoEnabled: bool(body.fefoEnabled, existing.fefoEnabled),
        restrictedSale: bool(body.restrictedSale, existing.restrictedSale),
        status: typeof body.status === "string" ? this.normalizeStatus(body.status) : existing.status,
      })
      .where(eq(pharmacyMedicines.id, id))
      .returning();
    if (!row) throw new BadRequestException("Failed to update medicine");
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "update",
      entityType: "pharmacy_medicine",
      entityId: id,
      oldValue: existing,
      newValue: row,
    });
    return this.getMedicineDetail(organizationId, id);
  }

  async setMedicineStatus(organizationId: string, id: string, status: string, userId?: string) {
    const existing = await this.getByOrgId(pharmacyMedicines, organizationId, id, "Medicine");
    const next = this.normalizeStatus(status);
    if (next === "inactive") {
      // Prefer soft deactivate; hard delete is blocked elsewhere when referenced.
      const [sold] = await this.db
        .select({ id: pharmacySaleLines.id })
        .from(pharmacySaleLines)
        .where(eq(pharmacySaleLines.medicineId, id))
        .limit(1);
      const [dist] = await this.db
        .select({ id: pharmacyDistOrderLines.id })
        .from(pharmacyDistOrderLines)
        .where(eq(pharmacyDistOrderLines.medicineId, id))
        .limit(1);
      void sold;
      void dist;
    }
    const [row] = await this.db
      .update(pharmacyMedicines)
      .set({ status: next })
      .where(eq(pharmacyMedicines.id, id))
      .returning();
    if (!row) throw new BadRequestException("Failed to update medicine status");
    await this.writeAudit({
      organizationId,
      branchId: existing.branchId,
      userId,
      action: "status_change",
      entityType: "pharmacy_medicine",
      entityId: id,
      oldValue: { status: existing.status },
      newValue: { status: next },
    });
    return row;
  }

  // ─── Overview / data quality ─────────────────────────────────────────────

  async getMastersOverview(organizationId: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const countTable = async (table: any) => {
      const [row] = await this.db
        .select({ n: count() })
        .from(table)
        .where(eq(table.organizationId, organizationId));
      return Number(row?.n ?? 0);
    };
    const [companies, generics, brands, categories, dosageForms, units, taxProfiles, medicines, warehouses, tradeCustomers] =
      await Promise.all([
        countTable(pharmacyCompanies),
        countTable(pharmacyGenerics),
        countTable(pharmacyBrands),
        countTable(pharmacyCategories),
        countTable(pharmacyDosageForms),
        countTable(pharmacyUnits),
        countTable(pharmacyTaxProfiles),
        countTable(pharmacyMedicines),
        countTable(pharmacyWarehouses),
        countTable(pharmacyTradeCustomers),
      ]);
    return {
      companies,
      generics,
      brands,
      categories,
      dosageForms,
      units,
      taxProfiles,
      medicines,
      warehouses,
      tradeCustomers,
    };
  }

  async getMasterDataQuality(organizationId: string, branchCode?: string) {
    const branch = branchCode?.trim()
      ? await this.resolveBranch(organizationId, branchCode.trim())
      : null;

    const medConds: SQL[] = [eq(pharmacyMedicines.organizationId, organizationId)];
    if (branch) medConds.push(eq(pharmacyMedicines.branchId, branch.id));
    const medWhere = and(...medConds);

    const [withoutCompany] = await this.db
      .select({ n: count() })
      .from(pharmacyMedicines)
      .where(and(medWhere, isNull(pharmacyMedicines.companyId)));

    const [withoutPrice] = await this.db
      .select({ n: count() })
      .from(pharmacyMedicines)
      .where(
        and(
          medWhere,
          eq(pharmacyMedicines.wholesalePricePkr, 0),
          eq(pharmacyMedicines.sellingPricePkr, 0),
        ),
      );

    const [withoutUnitId] = await this.db
      .select({ n: count() })
      .from(pharmacyMedicines)
      .where(and(medWhere, isNull(pharmacyMedicines.unitId)));

    const custConds: SQL[] = [eq(pharmacyTradeCustomers.organizationId, organizationId)];
    if (branch) custConds.push(eq(pharmacyTradeCustomers.branchId, branch.id));
    const custWhere = and(...custConds);

    const [customersWithoutRoute] = await this.db
      .select({ n: count() })
      .from(pharmacyTradeCustomers)
      .where(and(custWhere, isNull(pharmacyTradeCustomers.routeId)));

    const [customersWithoutSalesman] = await this.db
      .select({ n: count() })
      .from(pharmacyTradeCustomers)
      .where(and(custWhere, isNull(pharmacyTradeCustomers.salesmanEmployeeId)));

    const barcodeRows = await this.db
      .select({
        barcode: pharmacyMedicines.barcode,
        n: count(),
      })
      .from(pharmacyMedicines)
      .where(and(medWhere, sql`${pharmacyMedicines.barcode} is not null and trim(${pharmacyMedicines.barcode}) <> ''`))
      .groupBy(pharmacyMedicines.barcode)
      .having(sql`count(*) > 1`)
      .orderBy(desc(count()))
      .limit(20);

    const inactiveCompanyLinked = await this.db
      .select({ n: count() })
      .from(pharmacyMedicines)
      .innerJoin(pharmacyCompanies, eq(pharmacyCompanies.id, pharmacyMedicines.companyId))
      .where(and(medWhere, eq(pharmacyCompanies.status, "inactive")));

    return {
      medicinesWithoutCompany: Number(withoutCompany?.n ?? 0),
      medicinesWithoutPrice: Number(withoutPrice?.n ?? 0),
      medicinesWithoutUnit: Number(withoutUnitId?.n ?? 0),
      customersWithoutRoute: Number(customersWithoutRoute?.n ?? 0),
      customersWithoutSalesman: Number(customersWithoutSalesman?.n ?? 0),
      duplicateBarcodeCandidates: barcodeRows.map((r) => ({
        barcode: r.barcode,
        count: Number(r.n),
      })),
      inactiveCompanyLinkedMedicines: Number(inactiveCompanyLinked[0]?.n ?? 0),
    };
  }

  // ─── Shared helpers ──────────────────────────────────────────────────────

  private async listCodedMaster(
    organizationId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table: any,
    filters: PageFilters,
  ) {
    const { page, pageSize, offset } = this.normalizePage(filters.page, filters.pageSize);
    const conds: SQL[] = [eq(table.organizationId, organizationId)];
    if (filters.status) conds.push(eq(table.status, this.normalizeStatus(filters.status)));
    if (filters.q?.trim()) {
      const q = `%${filters.q.trim()}%`;
      conds.push(or(ilike(table.code, q), ilike(table.name, q))!);
    }
    const where = and(...conds);
    const [totalRow] = await this.db.select({ n: count() }).from(table).where(where);
    const items = await this.db
      .select()
      .from(table)
      .where(where)
      .orderBy(asc(table.name))
      .limit(pageSize)
      .offset(offset);
    return this.pageResult(items, Number(totalRow?.n ?? 0), page, pageSize);
  }

  private async createCodedMaster(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table: any,
    entityType: string,
    organizationId: string,
    body: { code: string; name: string; notes?: string; status?: string },
    userId?: string,
  ) {
    if (!body.code?.trim() || !body.name?.trim()) {
      throw new BadRequestException("code and name are required");
    }
    await this.assertCodeUnique(organizationId, table, body.code);
    const inserted = (await this.db
      .insert(table)
      .values({
        organizationId,
        code: body.code.trim(),
        name: body.name.trim(),
        notes: body.notes?.trim() || null,
        status: this.normalizeStatus(body.status),
      })
      .returning()) as Array<{ id: string } & Record<string, unknown>>;
    const row = inserted[0];
    if (!row) throw new BadRequestException("Failed to create record");
    await this.writeAudit({
      organizationId,
      userId,
      action: "create",
      entityType,
      entityId: row.id,
      newValue: row,
    });
    return row;
  }

  private async updateCodedMaster(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table: any,
    entityType: string,
    label: string,
    organizationId: string,
    id: string,
    body: { code?: string; name?: string; notes?: string | null; status?: string },
    userId?: string,
  ) {
    const existing = await this.getByOrgId(table, organizationId, id, label);
    if (body.code !== undefined && this.normalizeCode(body.code) !== this.normalizeCode(existing.code)) {
      await this.assertCodeUnique(organizationId, table, body.code, id);
    }
    const [row] = (await this.db
      .update(table)
      .set({
        code: body.code !== undefined ? body.code.trim() : existing.code,
        name: body.name !== undefined ? body.name.trim() : existing.name,
        notes: body.notes !== undefined ? (body.notes?.trim() || null) : existing.notes,
        status: body.status !== undefined ? this.normalizeStatus(body.status) : existing.status,
      })
      .where(eq(table.id, id))
      .returning()) as Array<Record<string, unknown>>;
    if (!row) throw new BadRequestException("Failed to update record");
    await this.writeAudit({
      organizationId,
      userId,
      action: "update",
      entityType,
      entityId: id,
      oldValue: existing,
      newValue: row,
    });
    return row;
  }

  private async setMasterStatus(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table: any,
    entityType: string,
    label: string,
    organizationId: string,
    id: string,
    status: string,
    userId?: string,
  ) {
    const existing = await this.getByOrgId(table, organizationId, id, label);
    const next = this.normalizeStatus(status);
    const [row] = (await this.db
      .update(table)
      .set({ status: next })
      .where(eq(table.id, id))
      .returning()) as Array<Record<string, unknown>>;
    if (!row) throw new BadRequestException(`Failed to update ${label} status`);
    await this.writeAudit({
      organizationId,
      userId,
      action: "status_change",
      entityType,
      entityId: id,
      oldValue: { status: existing.status },
      newValue: { status: next },
    });
    return row;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async getByOrgId(table: any, organizationId: string, id: string, label: string): Promise<any> {
    const [row] = await this.db
      .select()
      .from(table)
      .where(and(eq(table.id, id), eq(table.organizationId, organizationId)))
      .limit(1);
    if (!row) throw new NotFoundException(`${label} not found`);
    return row;
  }

  private async assertCompany(organizationId: string, companyId: string) {
    await this.getByOrgId(pharmacyCompanies, organizationId, companyId, "Company");
  }
}
