import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, ilike, sql } from "drizzle-orm";
import {
  pharmacyAuditLogs,
  pharmacyCompanies,
  pharmacyDistInvoices,
  pharmacyIoJobs,
  pharmacyMedicines,
  pharmacyTradeCustomers,
  pharmacyWarehouses,
  popsBranches,
  popsSuppliers,
  type PlatformPgDb,
} from "@platform/database-pg";
import { createMedicineSchema } from "@platform/contracts";
import { DRIZZLE } from "../../drizzle/drizzle.tokens";
import { PharmacyService } from "../pharmacy.service";
import { PharmacyErpService } from "../pharmacy-erp.service";
import { PharmacyStockEngine } from "../pharmacy-stock.engine";
import { MOVEMENT_TYPES } from "../inventory/stock-ledger.service";

export const IO_MODULES = [
  "medicines",
  "customers",
  "suppliers",
  "companies",
  "opening_stock",
] as const;
export type IoModule = (typeof IO_MODULES)[number];

export type IoField = { key: string; label: string; required: boolean; example: string; notes?: string };

export type IoRowError = { row: number; field?: string; message: string; duplicate?: boolean };

const FIELDS: Record<IoModule, IoField[]> = {
  medicines: [
    { key: "sku", label: "Product Code", required: true, example: "MED-001" },
    { key: "name", label: "Product Name", required: true, example: "Paracetamol 500mg" },
    { key: "genericName", label: "Generic", required: false, example: "Paracetamol" },
    { key: "companyCode", label: "Company Code", required: false, example: "ABC", notes: "Must match an existing company code" },
    { key: "barcode", label: "Barcode", required: false, example: "1234567890123" },
    { key: "unit", label: "Unit", required: false, example: "Piece" },
    { key: "taxPct", label: "Tax %", required: false, example: "0" },
    { key: "purchasePrice", label: "Purchase Price", required: false, example: "80" },
    { key: "sellingPrice", label: "Sale Price", required: false, example: "100" },
    { key: "wholesalePrice", label: "Wholesale Price", required: false, example: "90" },
    { key: "status", label: "Status", required: false, example: "active", notes: "active | inactive" },
  ],
  customers: [
    { key: "code", label: "Customer Code", required: true, example: "TC-001" },
    { key: "name", label: "Customer Name", required: true, example: "City Pharmacy" },
    { key: "businessName", label: "Business Name", required: false, example: "City Pharmacy" },
    { key: "customerType", label: "Type", required: false, example: "Retailer" },
    { key: "phone", label: "Phone", required: false, example: "03001234567" },
    { key: "creditLimitPkr", label: "Credit Limit", required: false, example: "100000" },
    { key: "creditDays", label: "Credit Days", required: false, example: "30" },
    { key: "priceLevel", label: "Price Level", required: false, example: "retail" },
  ],
  suppliers: [
    { key: "name", label: "Supplier Name", required: true, example: "ABC Distributors" },
    { key: "phone", label: "Phone", required: false, example: "0211234567" },
    { key: "email", label: "Email", required: false, example: "ap@abc.com" },
    { key: "address", label: "Address", required: false, example: "Karachi" },
    { key: "paymentTerms", label: "Payment Terms", required: false, example: "Net 30" },
  ],
  companies: [
    { key: "code", label: "Company Code", required: true, example: "ABC" },
    { key: "name", label: "Company Name", required: true, example: "ABC Pharma" },
  ],
  opening_stock: [
    { key: "sku", label: "Product Code", required: true, example: "MED-001", notes: "Must exist" },
    { key: "warehouseCode", label: "Warehouse Code", required: true, example: "MAIN" },
    { key: "batchNumber", label: "Batch", required: true, example: "B1" },
    { key: "expiryDate", label: "Expiry", required: true, example: "2027-12-31", notes: "YYYY-MM-DD" },
    { key: "quantity", label: "Quantity", required: true, example: "100" },
    { key: "purchaseCost", label: "Purchase Cost", required: false, example: "80" },
  ],
};

@Injectable()
export class DistIoService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly pharmacy: PharmacyService,
    private readonly erp: PharmacyErpService,
    private readonly stock: PharmacyStockEngine,
  ) {}

  modules() {
    return IO_MODULES.map((id) => ({
      id,
      fields: FIELDS[id],
      transactional: id === "opening_stock",
    }));
  }

  template(module: string) {
    const mod = this.requireModule(module);
    const fields = FIELDS[mod];
    const header = fields.map((f) => f.label).join(",");
    const example = fields.map((f) => csvCell(f.example)).join(",");
    const instructions = [
      "# Dist import template",
      `# Module: ${mod}`,
      "# Required columns are marked * in the field list below.",
      ...fields.map((f) => `# ${f.required ? "*" : " "}${f.label} (${f.key}) example=${f.example}${f.notes ? ` — ${f.notes}` : ""}`),
      "# Delete instruction lines (starting with #) before import, or they will be skipped.",
      header,
      example,
    ].join("\r\n");
    return {
      module: mod,
      filename: `${mod}-import-template.csv`,
      contentType: "text/csv; charset=utf-8",
      csv: instructions,
      fields,
    };
  }

  async validate(
    organizationId: string,
    branchCode: string,
    input: { module: string; headers: string[]; rows: string[][]; mapping: Record<string, string> },
  ) {
    const mod = this.requireModule(input.module);
    const fields = FIELDS[mod];
    this.assertMapping(fields, input.mapping);
    const branch = await this.resolveBranch(organizationId, branchCode);
    const parsed = this.mapRows(fields, input.headers, input.rows, input.mapping);
    const errors: IoRowError[] = [];
    let duplicates = 0;

    for (const row of parsed) {
      for (const f of fields.filter((x) => x.required)) {
        if (!String(row.values[f.key] ?? "").trim()) {
          errors.push({ row: row.row, field: f.key, message: `${f.label} is required` });
        }
      }
      if (mod === "medicines") {
        const sku = norm(row.values.sku);
        const barcode = norm(row.values.barcode);
        if (sku && (await this.skuExists(organizationId, sku))) {
          errors.push({ row: row.row, field: "sku", message: `Duplicate product code: ${sku}`, duplicate: true });
          duplicates += 1;
        }
        if (barcode && (await this.barcodeExists(organizationId, barcode))) {
          errors.push({ row: row.row, field: "barcode", message: `Duplicate barcode: ${barcode}`, duplicate: true });
          duplicates += 1;
        }
        const companyCode = norm(row.values.companyCode);
        if (companyCode && !(await this.companyByCode(organizationId, companyCode))) {
          errors.push({ row: row.row, field: "companyCode", message: `Invalid company: ${companyCode}` });
        }
        const tax = num(row.values.taxPct);
        if (row.values.taxPct && (tax == null || tax < 0 || tax > 100)) {
          errors.push({ row: row.row, field: "taxPct", message: "Invalid tax" });
        }
      }
      if (mod === "customers") {
        const code = norm(row.values.code);
        if (code && (await this.customerCodeExists(organizationId, code))) {
          errors.push({ row: row.row, field: "code", message: `Duplicate customer code: ${code}`, duplicate: true });
          duplicates += 1;
        }
      }
      if (mod === "companies") {
        const code = norm(row.values.code);
        if (code && (await this.companyByCode(organizationId, code))) {
          errors.push({ row: row.row, field: "code", message: `Duplicate company code: ${code}`, duplicate: true });
          duplicates += 1;
        }
      }
      if (mod === "opening_stock") {
        const sku = norm(row.values.sku);
        const wh = norm(row.values.warehouseCode);
        const qty = num(row.values.quantity);
        const exp = norm(row.values.expiryDate);
        if (sku && !(await this.medicineBySku(organizationId, sku))) {
          errors.push({ row: row.row, field: "sku", message: `Product not found: ${sku}` });
        }
        if (wh && !(await this.warehouseByCode(organizationId, branch.id, wh))) {
          errors.push({ row: row.row, field: "warehouseCode", message: `Warehouse not found: ${wh}` });
        }
        if (qty == null || qty <= 0) {
          errors.push({ row: row.row, field: "quantity", message: "Quantity must be a positive number" });
        }
        if (exp && !/^\d{4}-\d{2}-\d{2}$/.test(exp)) {
          errors.push({ row: row.row, field: "expiryDate", message: "Expiry date is invalid (use YYYY-MM-DD)" });
        }
      }
    }

    const failedRows = new Set(errors.map((e) => e.row)).size;
    return {
      module: mod,
      totalRows: parsed.length,
      validRows: parsed.length - failedRows,
      invalidRows: failedRows,
      duplicates,
      errors: errors.slice(0, 500),
      preview: parsed.slice(0, 25).map((r) => ({
        row: r.row,
        status: errors.some((e) => e.row === r.row) ? "invalid" : "valid",
        values: r.values,
        issues: errors.filter((e) => e.row === r.row).map((e) => e.message),
      })),
    };
  }

  async commit(
    organizationId: string,
    userId: string,
    branchCode: string,
    input: {
      module: string;
      headers: string[];
      rows: string[][];
      mapping: Record<string, string>;
      fileName?: string;
      importValidOnly?: boolean;
    },
  ) {
    const preview = await this.validate(organizationId, branchCode, input);
    if (preview.invalidRows > 0 && !input.importValidOnly) {
      throw new BadRequestException(
        `${preview.invalidRows} invalid row(s). Fix them or set importValidOnly=true to import valid rows only.`,
      );
    }
    const mod = this.requireModule(input.module);
    const fields = FIELDS[mod];
    const parsed = this.mapRows(fields, input.headers, input.rows, input.mapping);
    const invalid = new Set(preview.errors.map((e) => e.row));
    const branch = await this.resolveBranch(organizationId, branchCode);

    const [job] = await this.db
      .insert(pharmacyIoJobs)
      .values({
        organizationId,
        branchId: branch.id,
        userId,
        kind: "import",
        module: mod,
        fileName: input.fileName ?? `${mod}.csv`,
        status: "processing",
        totalRows: parsed.length,
        mappingJson: JSON.stringify(input.mapping),
      })
      .returning();
    if (!job) throw new BadRequestException("Failed to create import job");

    let imported = 0;
    let failed = 0;
    let skipped = 0;
    const commitErrors: IoRowError[] = [...preview.errors];

    for (const row of parsed) {
      if (invalid.has(row.row)) {
        skipped += 1;
        continue;
      }
      try {
        await this.commitRow(organizationId, userId, branchCode, branch.id, mod, row.values, job.id, row.row);
        imported += 1;
      } catch (err) {
        failed += 1;
        commitErrors.push({
          row: row.row,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const [updated] = await this.db
      .update(pharmacyIoJobs)
      .set({
        status: failed > 0 || skipped > 0 ? "completed_with_errors" : "completed",
        importedRows: imported,
        failedRows: failed,
        skippedRows: skipped,
        duplicateRows: preview.duplicates,
        errorJson: JSON.stringify(commitErrors.slice(0, 500)),
        completedAt: new Date(),
      })
      .where(eq(pharmacyIoJobs.id, job.id))
      .returning();

    await this.db.insert(pharmacyAuditLogs).values({
      organizationId,
      branchId: branch.id,
      userId,
      action: "import",
      entityType: "io_job",
      entityId: job.id,
      newValueJson: JSON.stringify({ module: mod, imported, failed, skipped }),
    });

    return updated;
  }

  async listJobs(organizationId: string, page = 1, pageSize = 25) {
    const safePage = Math.max(1, page);
    const safeSize = Math.min(100, Math.max(1, pageSize));
    const [countRow] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(pharmacyIoJobs)
      .where(eq(pharmacyIoJobs.organizationId, organizationId));
    const items = await this.db
      .select()
      .from(pharmacyIoJobs)
      .where(eq(pharmacyIoJobs.organizationId, organizationId))
      .orderBy(desc(pharmacyIoJobs.createdAt))
      .limit(safeSize)
      .offset((safePage - 1) * safeSize);
    return { items, page: safePage, pageSize: safeSize, total: countRow?.n ?? 0 };
  }

  async getJob(organizationId: string, id: string) {
    const [job] = await this.db
      .select()
      .from(pharmacyIoJobs)
      .where(and(eq(pharmacyIoJobs.id, id), eq(pharmacyIoJobs.organizationId, organizationId)))
      .limit(1);
    if (!job) throw new NotFoundException("Import/export job not found");
    return {
      ...job,
      errors: job.errorJson ? (JSON.parse(job.errorJson) as IoRowError[]) : [],
    };
  }

  async exportCsv(
    organizationId: string,
    userId: string,
    branchCode: string,
    module: string,
    q?: string,
  ) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const cap = 10_000;
    let header = "";
    let lines: string[] = [];

    if (module === "medicines") {
      const rows = await this.db
        .select({
          sku: pharmacyMedicines.sku,
          name: pharmacyMedicines.name,
          genericName: pharmacyMedicines.genericName,
          barcode: pharmacyMedicines.barcode,
          sellingPricePkr: pharmacyMedicines.sellingPricePkr,
          status: pharmacyMedicines.status,
        })
        .from(pharmacyMedicines)
        .where(
          and(
            eq(pharmacyMedicines.organizationId, organizationId),
            q ? ilike(pharmacyMedicines.name, `%${q}%`) : sql`true`,
          ),
        )
        .limit(cap);
      header = "Product Code,Product Name,Generic,Barcode,Sale Price,Status";
      lines = rows.map((r) =>
        [r.sku, r.name, r.genericName ?? "", r.barcode ?? "", r.sellingPricePkr, r.status].map(csvCell).join(","),
      );
    } else if (module === "customers") {
      const rows = await this.db
        .select({
          code: pharmacyTradeCustomers.code,
          name: pharmacyTradeCustomers.name,
          outstandingPkr: pharmacyTradeCustomers.outstandingPkr,
          creditLimitPkr: pharmacyTradeCustomers.creditLimitPkr,
        })
        .from(pharmacyTradeCustomers)
        .where(eq(pharmacyTradeCustomers.organizationId, organizationId))
        .limit(cap);
      header = "Customer Code,Customer Name,Outstanding,Credit Limit";
      lines = rows.map((r) => [r.code, r.name, r.outstandingPkr, r.creditLimitPkr].map(csvCell).join(","));
    } else if (module === "invoices") {
      const rows = await this.db
        .select({
          invoiceNumber: pharmacyDistInvoices.invoiceNumber,
          invoiceDate: pharmacyDistInvoices.invoiceDate,
          totalPkr: pharmacyDistInvoices.totalPkr,
          amountDuePkr: pharmacyDistInvoices.amountDuePkr,
          status: pharmacyDistInvoices.status,
        })
        .from(pharmacyDistInvoices)
        .where(
          and(
            eq(pharmacyDistInvoices.organizationId, organizationId),
            eq(pharmacyDistInvoices.branchId, branch.id),
          ),
        )
        .limit(cap);
      header = "Invoice,Date,Total,Due,Status";
      lines = rows.map((r) =>
        [r.invoiceNumber, r.invoiceDate, r.totalPkr, r.amountDuePkr, r.status].map(csvCell).join(","),
      );
    } else {
      throw new BadRequestException("Export module not supported. Use medicines, customers, or invoices.");
    }

    if (lines.length >= cap) {
      throw new BadRequestException(
        `Export exceeds ${cap} rows. Narrow the filter — large browser-side exports are not allowed.`,
      );
    }

    const [job] = await this.db
      .insert(pharmacyIoJobs)
      .values({
        organizationId,
        branchId: branch.id,
        userId,
        kind: "export",
        module,
        fileName: `${module}-export.csv`,
        status: "completed",
        totalRows: lines.length,
        importedRows: lines.length,
        completedAt: new Date(),
        filtersJson: JSON.stringify({ q: q ?? null }),
      })
      .returning();

    await this.db.insert(pharmacyAuditLogs).values({
      organizationId,
      branchId: branch.id,
      userId,
      action: "export",
      entityType: "io_job",
      entityId: job?.id ?? module,
      newValueJson: JSON.stringify({ module, rows: lines.length }),
    });

    return {
      filename: `${module}-export.csv`,
      contentType: "text/csv; charset=utf-8",
      csv: [header, ...lines].join("\r\n"),
      rows: lines.length,
      jobId: job?.id,
    };
  }

  async listAudit(organizationId: string, page = 1, pageSize = 50) {
    const safePage = Math.max(1, page);
    const safeSize = Math.min(100, Math.max(1, pageSize));
    const [countRow] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(pharmacyAuditLogs)
      .where(eq(pharmacyAuditLogs.organizationId, organizationId));
    const items = await this.db
      .select()
      .from(pharmacyAuditLogs)
      .where(eq(pharmacyAuditLogs.organizationId, organizationId))
      .orderBy(desc(pharmacyAuditLogs.createdAt))
      .limit(safeSize)
      .offset((safePage - 1) * safeSize);
    return { items, page: safePage, pageSize: safeSize, total: countRow?.n ?? 0 };
  }

  private async commitRow(
    organizationId: string,
    userId: string,
    branchCode: string,
    branchId: string,
    mod: IoModule,
    values: Record<string, string>,
    jobId: string,
    row: number,
  ) {
    if (mod === "medicines") {
      const company = values.companyCode
        ? await this.companyByCode(organizationId, norm(values.companyCode))
        : null;
      await this.pharmacy.createMedicine(
        organizationId,
        createMedicineSchema.parse({
          branchCode,
          sku: values.sku.trim(),
          name: values.name.trim(),
          genericName: values.genericName || undefined,
          barcode: values.barcode || undefined,
          unit: values.unit || "Piece",
          taxPct: num(values.taxPct) ?? 0,
          purchasePrice: num(values.purchasePrice) ?? 0,
          sellingPrice: num(values.sellingPrice) ?? 0,
          wholesalePrice: num(values.wholesalePrice) ?? 0,
          companyId: company?.id,
          status: values.status || "active",
        }),
      );
      return;
    }
    if (mod === "customers") {
      await this.erp.createTradeCustomer(organizationId, {
        branchCode,
        code: values.code.trim(),
        name: values.name.trim(),
        businessName: values.businessName || undefined,
        customerType: values.customerType || undefined,
        phone: values.phone || undefined,
        creditLimitPkr: num(values.creditLimitPkr) ?? 0,
        creditDays: num(values.creditDays) ?? 30,
        priceLevel: values.priceLevel || undefined,
      });
      return;
    }
    if (mod === "companies") {
      await this.erp.createCompany(organizationId, {
        code: values.code.trim(),
        name: values.name.trim(),
      });
      return;
    }
    if (mod === "suppliers") {
      await this.db.insert(popsSuppliers).values({
        organizationId,
        branchId,
        name: values.name.trim(),
        phone: values.phone || null,
        email: values.email || null,
        address: values.address || null,
        paymentTerms: values.paymentTerms || null,
      });
      return;
    }
    const medicine = await this.medicineBySku(organizationId, norm(values.sku));
    const warehouse = await this.warehouseByCode(organizationId, branchId, norm(values.warehouseCode));
    if (!medicine || !warehouse) throw new BadRequestException("Product or warehouse missing at commit");
    await this.db.transaction(async (tx) => {
      await this.stock.receiveBatch(tx, {
        organizationId,
        branchId,
        warehouseId: warehouse.id,
        medicineId: medicine.id,
        batchNumber: values.batchNumber.trim(),
        expiryDate: values.expiryDate.trim(),
        quantity: Math.round(num(values.quantity) ?? 0),
        purchaseRatePkr: num(values.purchaseCost) ?? 0,
        referenceType: "opening_stock",
        referenceId: jobId,
        movementType: MOVEMENT_TYPES.OPENING_STOCK,
        idempotencyKey: `io-open:${jobId}:${row}`,
        createdByUserId: userId,
      });
    });
  }

  private requireModule(module: string): IoModule {
    if (!IO_MODULES.includes(module as IoModule)) {
      throw new BadRequestException(`Unknown import module: ${module}`);
    }
    return module as IoModule;
  }

  private assertMapping(fields: IoField[], mapping: Record<string, string>) {
    const missing = fields.filter((f) => f.required && !mapping[f.key]);
    if (missing.length) {
      throw new BadRequestException(
        `Required fields are unmapped: ${missing.map((f) => f.label).join(", ")}`,
      );
    }
  }

  private mapRows(
    fields: IoField[],
    headers: string[],
    rows: string[][],
    mapping: Record<string, string>,
  ) {
    if (rows.length > 2000) {
      throw new BadRequestException("Import is limited to 2000 data rows. Split the file.");
    }
    return rows
      .map((cells, i) => {
        const values: Record<string, string> = {};
        for (const f of fields) {
          const col = mapping[f.key];
          const idx = col ? headers.indexOf(col) : -1;
          values[f.key] = idx >= 0 ? (cells[idx] ?? "").trim() : "";
        }
        return { row: i + 2, values };
      })
      .filter((r) => !Object.values(r.values).every((v) => !v) && !String(r.values[fields[0]!.key] ?? "").startsWith("#"));
  }

  private async resolveBranch(organizationId: string, branchCode: string) {
    const [branch] = await this.db
      .select()
      .from(popsBranches)
      .where(and(eq(popsBranches.organizationId, organizationId), eq(popsBranches.code, branchCode)))
      .limit(1);
    if (!branch) throw new NotFoundException(`Branch not found: ${branchCode}`);
    return branch;
  }

  private async skuExists(organizationId: string, sku: string) {
    const [row] = await this.db
      .select({ id: pharmacyMedicines.id })
      .from(pharmacyMedicines)
      .where(and(eq(pharmacyMedicines.organizationId, organizationId), eq(pharmacyMedicines.sku, sku)))
      .limit(1);
    return Boolean(row);
  }

  private async barcodeExists(organizationId: string, barcode: string) {
    const [row] = await this.db
      .select({ id: pharmacyMedicines.id })
      .from(pharmacyMedicines)
      .where(and(eq(pharmacyMedicines.organizationId, organizationId), eq(pharmacyMedicines.barcode, barcode)))
      .limit(1);
    return Boolean(row);
  }

  private async customerCodeExists(organizationId: string, code: string) {
    const [row] = await this.db
      .select({ id: pharmacyTradeCustomers.id })
      .from(pharmacyTradeCustomers)
      .where(and(eq(pharmacyTradeCustomers.organizationId, organizationId), eq(pharmacyTradeCustomers.code, code)))
      .limit(1);
    return Boolean(row);
  }

  private async companyByCode(organizationId: string, code: string) {
    const [row] = await this.db
      .select()
      .from(pharmacyCompanies)
      .where(and(eq(pharmacyCompanies.organizationId, organizationId), eq(pharmacyCompanies.code, code)))
      .limit(1);
    return row ?? null;
  }

  private async medicineBySku(organizationId: string, sku: string) {
    const [row] = await this.db
      .select()
      .from(pharmacyMedicines)
      .where(and(eq(pharmacyMedicines.organizationId, organizationId), eq(pharmacyMedicines.sku, sku)))
      .limit(1);
    return row ?? null;
  }

  private async warehouseByCode(organizationId: string, branchId: string, code: string) {
    const [row] = await this.db
      .select()
      .from(pharmacyWarehouses)
      .where(
        and(
          eq(pharmacyWarehouses.organizationId, organizationId),
          eq(pharmacyWarehouses.branchId, branchId),
          eq(pharmacyWarehouses.code, code),
        ),
      )
      .limit(1);
    return row ?? null;
  }
}

function norm(v?: string) {
  return (v ?? "").trim();
}
function num(v?: string) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function csvCell(v: unknown) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
