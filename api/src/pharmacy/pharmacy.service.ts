import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import type {
  ClosePharmacyShift,
  CreateDoctor,
  CreateMedicine,
  CreatePatient,
  CreatePharmacySale,
  CreatePrescription,
  OpenPharmacyShift,
  PharmacySaleUnit,
  RecordKhataPayment,
  UpdateMedicine,
  UpdatePatient,
} from "@platform/contracts";
import { computeLinePrice, formatMedicineLocation, saleQtyToTablets } from "@platform/contracts";
import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import {
  pharmacyControlledDrugLogs,
  pharmacyDoctors,
  pharmacyKhataEntries,
  pharmacyMedicineBatches,
  pharmacyMedicines,
  pharmacyPatients,
  pharmacyPrescriptionItems,
  pharmacyPrescriptions,
  pharmacyRefillReminders,
  pharmacySaleLines,
  pharmacySales,
  pharmacyShifts,
  popsBranches,
  popsPurchaseOrders,
  popsSuppliers,
  users,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../drizzle/drizzle.tokens";
import { TaxAuthorityService } from "../tax-authority/tax-authority.service";
import { mapMedicineRow, parseJsonArray, parsePaymentsJson, stringifyJsonArray } from "./pharmacy-mappers";

const MEDICINE_SEEDS = [
  {
    sku: "MED-001",
    name: "Panadol 500mg",
    genericName: "Paracetamol",
    presentation: "500mg Tablet — 10 strips",
    brandName: "Panadol",
    category: "Tablet",
    manufacturer: "GSK",
    barcode: "8901030865123",
    purchasePrice: 120,
    sellingPrice: 180,
    taxPct: 0,
    reorderLevel: 200,
    currentStock: 1000,
    unit: "Tablet",
    dosageStrength: "500mg",
    tabletsPerStrip: 10,
    stripsPerBox: 10,
    batchNumber: "BN2026A",
    expiryDate: "2027-06-30",
    aisleLocation: "Aisle 1",
    rackLocation: "Rack A",
    shelfLocation: "Shelf 3",
    suggestedReorderQty: 100,
    warnings: ["Take after meals"],
    instructions: ["Take with water"],
  },
  {
    sku: "MED-002",
    name: "Augmentin 625mg",
    genericName: "Amoxicillin + Clavulanate",
    dosageStrength: "625mg",
    brandName: "Augmentin",
    category: "Tablet",
    manufacturer: "GSK",
    barcode: "8901030865234",
    purchasePrice: 450,
    sellingPrice: 620,
    taxPct: 0,
    reorderLevel: 300,
    currentStock: 850,
    unit: "Tablet",
    tabletsPerStrip: 10,
    stripsPerBox: 6,
    aisleLocation: "Aisle 2",
    rackLocation: "Rack B",
    shelfLocation: "Shelf 1",
    batchNumber: "BN2026B",
    expiryDate: "2026-08-15",
  },
  {
    sku: "MED-003",
    name: "Brufen 400mg",
    genericName: "Ibuprofen",
    brandName: "Brufen",
    category: "Tablet",
    manufacturer: "Abbott",
    barcode: "8901030865345",
    purchasePrice: 90,
    sellingPrice: 140,
    taxPct: 0,
    reorderLevel: 40,
    currentStock: 12,
    unit: "Tablet",
    batchNumber: "BN2025Z",
    expiryDate: "2026-04-20",
  },
  {
    sku: "MED-004",
    name: "Ventolin Inhaler",
    genericName: "Salbutamol",
    brandName: "Ventolin",
    category: "Inhaler",
    manufacturer: "GSK",
    barcode: "8901030865456",
    purchasePrice: 1200,
    sellingPrice: 1580,
    taxPct: 0,
    reorderLevel: 10,
    currentStock: 24,
    unit: "Piece",
    batchNumber: "BN2026C",
    expiryDate: "2026-03-10",
  },
  {
    sku: "MED-005",
    name: "Metformin 500mg",
    genericName: "Metformin HCl",
    brandName: "Glucophage",
    category: "Tablet",
    manufacturer: "Merck",
    barcode: "8901030865567",
    purchasePrice: 80,
    sellingPrice: 120,
    taxPct: 0,
    reorderLevel: 60,
    currentStock: 0,
    unit: "Tablet",
    dosageStrength: "500mg",
    batchNumber: "BN2025Y",
    expiryDate: "2026-02-28",
    isControlled: true,
    rackLocation: "Rack C",
    shelfLocation: "Drawer 2",
    suggestedReorderQty: 120,
    warnings: ["Take after meals", "High dosage warning"],
  },
] as const;

@Injectable()
export class PharmacyService implements OnModuleInit {
  private readonly logger = new Logger(PharmacyService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly taxAuthority: TaxAuthorityService,
  ) {}

  onModuleInit(): void {
    void this.seedAllBranches().catch((err) => {
      this.logger.warn(
        `Pharmacy bootstrap skipped — run pnpm db:push if schema changed: ${err instanceof Error ? err.message : err}`,
      );
    });
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

  private async seedAllBranches(): Promise<void> {
    const branches = await this.db.select().from(popsBranches);
    for (const branch of branches) {
      await this.seedBranchIfEmpty(branch.organizationId, branch.id);
    }
  }

  private async seedBranchIfEmpty(organizationId: string, branchId: string): Promise<void> {
    const [existing] = await this.db
      .select({ id: pharmacyMedicines.id })
      .from(pharmacyMedicines)
      .where(and(eq(pharmacyMedicines.organizationId, organizationId), eq(pharmacyMedicines.branchId, branchId)))
      .limit(1);
    if (existing) return;

    for (const seed of MEDICINE_SEEDS) {
      const seedExtras = seed as {
        dosageStrength?: string;
        rackLocation?: string;
        shelfLocation?: string;
        suggestedReorderQty?: number;
        isControlled?: boolean;
        warnings?: readonly string[];
        instructions?: readonly string[];
      };
      const [med] = await this.db
        .insert(pharmacyMedicines)
        .values({
          organizationId,
          branchId,
          sku: seed.sku,
          name: seed.name,
          genericName: seed.genericName,
          dosageStrength: seedExtras.dosageStrength ?? null,
          presentation: "presentation" in seed ? (seed as { presentation?: string }).presentation ?? null : null,
          brandName: seed.brandName,
          category: seed.category,
          manufacturer: seed.manufacturer,
          barcode: seed.barcode,
          purchasePricePkr: seed.purchasePrice,
          sellingPricePkr: seed.sellingPrice,
          taxPct: seed.taxPct,
          reorderLevel: seed.reorderLevel,
          suggestedReorderQty: seedExtras.suggestedReorderQty ?? seed.reorderLevel * 2,
          currentStock: seed.currentStock,
          unit: seed.unit,
          rackLocation: seedExtras.rackLocation ?? null,
          shelfLocation: seedExtras.shelfLocation ?? null,
          aisleLocation: (seedExtras as { aisleLocation?: string }).aisleLocation ?? null,
          tabletsPerStrip: (seedExtras as { tabletsPerStrip?: number }).tabletsPerStrip ?? 1,
          stripsPerBox: (seedExtras as { stripsPerBox?: number }).stripsPerBox ?? 1,
          isControlled: seedExtras.isControlled ?? false,
          warningsJson: stringifyJsonArray(seedExtras.warnings ? [...seedExtras.warnings] : undefined),
          instructionsJson: stringifyJsonArray(seedExtras.instructions ? [...seedExtras.instructions] : undefined),
        })
        .returning();
      if (med) {
        await this.db.insert(pharmacyMedicineBatches).values({
          medicineId: med.id,
          batchNumber: seed.batchNumber,
          expiryDate: seed.expiryDate,
          quantity: seed.currentStock,
        });
      }
    }

    await this.db.insert(pharmacyPatients).values([
      {
        organizationId,
        branchId,
        name: "Ali Hassan",
        phone: "+92 300 1234567",
        email: "ali@example.com",
        address: "F-7 Markaz, Islamabad",
        loyaltyPoints: 120,
        chronicDiseasesJson: stringifyJsonArray(["Diabetes"]),
        refillReminderEnabled: true,
        refillReminderChannel: "sms",
        creditLimitPkr: 50000,
      },
      {
        organizationId,
        branchId,
        name: "Fatima Khan",
        phone: "+92 321 9876543",
        email: "fatima@example.com",
        address: "Blue Area, Islamabad",
        loyaltyPoints: 80,
        chronicDiseasesJson: stringifyJsonArray(["Hypertension"]),
        allergiesJson: stringifyJsonArray(["Penicillin"]),
        refillReminderEnabled: true,
        refillReminderChannel: "whatsapp",
      },
    ]);

    await this.db.insert(pharmacyDoctors).values([
      {
        organizationId,
        branchId,
        name: "Dr. Ahmed Malik",
        specialization: "General Physician",
        clinic: "City Clinic F-8",
        phone: "+92 51 2345678",
      },
      {
        organizationId,
        branchId,
        name: "Dr. Sana Iqbal",
        specialization: "Pediatrician",
        clinic: "Children's Hospital",
        phone: "+92 51 8765432",
      },
    ]);
  }

  async getDashboard(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    await this.seedBranchIfEmpty(organizationId, branch.id);

    const medicines = await this.db
      .select()
      .from(pharmacyMedicines)
      .where(and(eq(pharmacyMedicines.organizationId, organizationId), eq(pharmacyMedicines.branchId, branch.id)));

    const today = new Date().toISOString().slice(0, 10);
    const salesToday = await this.db
      .select({ total: sql<number>`coalesce(sum(${pharmacySales.totalPkr}), 0)` })
      .from(pharmacySales)
      .where(
        and(
          eq(pharmacySales.organizationId, organizationId),
          eq(pharmacySales.branchId, branch.id),
          gte(pharmacySales.createdAt, new Date(`${today}T00:00:00.000Z`)),
        ),
      );

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const patients = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(pharmacyPatients)
      .where(and(eq(pharmacyPatients.organizationId, organizationId), eq(pharmacyPatients.branchId, branch.id)));

    const batches = await this.db
      .select({
        medicineId: pharmacyMedicineBatches.medicineId,
        expiryDate: pharmacyMedicineBatches.expiryDate,
        quantity: pharmacyMedicineBatches.quantity,
      })
      .from(pharmacyMedicineBatches)
      .innerJoin(pharmacyMedicines, eq(pharmacyMedicines.id, pharmacyMedicineBatches.medicineId))
      .where(and(eq(pharmacyMedicines.organizationId, organizationId), eq(pharmacyMedicines.branchId, branch.id)));

    const now = new Date();
    const in30 = new Date(now);
    in30.setDate(in30.getDate() + 30);
    const in30Str = in30.toISOString().slice(0, 10);

    let lowStockCount = 0;
    let expiringCount = 0;
    const alerts: { type: string; severity: string; message: string; medicineId?: string }[] = [];

    for (const m of medicines) {
      if (m.currentStock === 0) {
        alerts.push({ type: "out_of_stock", severity: "danger", message: `${m.name} is out of stock`, medicineId: m.id });
      } else if (m.currentStock <= m.reorderLevel) {
        lowStockCount += 1;
        alerts.push({ type: "low_stock", severity: "warning", message: `${m.name} is low (${m.currentStock} left)`, medicineId: m.id });
      }
    }

    for (const b of batches) {
      const exp = String(b.expiryDate);
      if (b.quantity <= 0) continue;
      const med = medicines.find((m) => m.id === b.medicineId);
      if (!med) continue;

      const expDate = new Date(`${exp}T12:00:00`);
      const dayMs = 86400000;
      const daysUntil = Math.floor((expDate.getTime() - now.getTime()) / dayMs);

      if (exp <= today) {
        alerts.push({
          type: "expiry",
          severity: "danger",
          message: `${med.name} batch expired ${exp}`,
          medicineId: med.id,
        });
      } else if (daysUntil <= 30) {
        expiringCount += 1;
        alerts.push({
          type: "expiry_1mo",
          severity: "danger",
          message: `${med.name} — 30-day expiry alert (${exp})`,
          medicineId: med.id,
        });
      } else if (daysUntil <= 60) {
        expiringCount += 1;
        alerts.push({
          type: "expiry_2mo",
          severity: "warning",
          message: `${med.name} — 60-day expiry alert (${exp})`,
          medicineId: med.id,
        });
      } else if (daysUntil <= 90) {
        alerts.push({
          type: "expiry_3mo",
          severity: "info",
          message: `${med.name} — 90-day expiry alert (${exp})`,
          medicineId: med.id,
        });
      }
    }

    for (const m of medicines) {
      if (m.currentStock > 0 && m.currentStock <= m.reorderLevel && m.suggestedReorderQty > 0) {
        alerts.push({
          type: "reorder",
          severity: "warning",
          message: `Reorder alert: ${m.name} below minimum (${m.currentStock}/${m.reorderLevel}) — suggest PO for ${m.suggestedReorderQty} units`,
          medicineId: m.id,
        });
      }
    }

    const pendingRx = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(pharmacyPrescriptions)
      .where(
        and(
          eq(pharmacyPrescriptions.organizationId, organizationId),
          eq(pharmacyPrescriptions.branchId, branch.id),
          eq(pharmacyPrescriptions.status, "Pending"),
        ),
      );

    const todayStart = new Date(`${today}T00:00:00.000Z`);
    const sevenDaysAgo = new Date(todayStart);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    const recentSales = await this.db
      .select()
      .from(pharmacySales)
      .where(
        and(
          eq(pharmacySales.organizationId, organizationId),
          eq(pharmacySales.branchId, branch.id),
          gte(pharmacySales.createdAt, sevenDaysAgo),
        ),
      );

    const monthSales = await this.db
      .select()
      .from(pharmacySales)
      .where(
        and(
          eq(pharmacySales.organizationId, organizationId),
          eq(pharmacySales.branchId, branch.id),
          gte(pharmacySales.createdAt, monthStart),
        ),
      );

    const saleLinesMonth = await this.db
      .select({
        medicineName: pharmacyMedicines.name,
        qty: pharmacySaleLines.qty,
        lineTotal: pharmacySaleLines.lineTotalPkr,
        purchasePrice: pharmacyMedicines.purchasePricePkr,
      })
      .from(pharmacySaleLines)
      .innerJoin(pharmacySales, eq(pharmacySales.id, pharmacySaleLines.saleId))
      .innerJoin(pharmacyMedicines, eq(pharmacyMedicines.id, pharmacySaleLines.medicineId))
      .where(
        and(
          eq(pharmacySales.organizationId, organizationId),
          eq(pharmacySales.branchId, branch.id),
          gte(pharmacySales.createdAt, monthStart),
        ),
      );

    const purchaseOrdersMonth = await this.db
      .select({ total: sql<number>`coalesce(sum(${popsPurchaseOrders.totalAmountPkr}), 0)` })
      .from(popsPurchaseOrders)
      .where(
        and(
          eq(popsPurchaseOrders.organizationId, organizationId),
          eq(popsPurchaseOrders.branchId, branch.id),
          gte(popsPurchaseOrders.createdAt, monthStart),
        ),
      );

    const allPrescriptions = await this.db
      .select({ status: pharmacyPrescriptions.status })
      .from(pharmacyPrescriptions)
      .where(
        and(eq(pharmacyPrescriptions.organizationId, organizationId), eq(pharmacyPrescriptions.branchId, branch.id)),
      );

    const totalStock = medicines.reduce((s, m) => s + m.currentStock, 0);
    const revenueMonth = monthSales.reduce((sum, sale) => sum + sale.totalPkr, 0);
    const purchaseMonth = Number(purchaseOrdersMonth[0]?.total ?? 0);
    const cogsMonth = saleLinesMonth.reduce((sum, line) => sum + line.purchasePrice * line.qty, 0);
    const profitMonth = revenueMonth - cogsMonth - Math.round(purchaseMonth * 0.1);

    const dailyBuckets = new Map<string, number>();
    for (let i = 0; i < 7; i++) {
      const d = new Date(sevenDaysAgo);
      d.setDate(d.getDate() + i);
      dailyBuckets.set(d.toISOString().slice(0, 10), 0);
    }
    for (const sale of recentSales) {
      const day = sale.createdAt.toISOString().slice(0, 10);
      if (dailyBuckets.has(day)) {
        dailyBuckets.set(day, (dailyBuckets.get(day) ?? 0) + sale.totalPkr);
      }
    }
    const dailySales = [...dailyBuckets.entries()].map(([date, amount]) => ({ date, amount }));

    const monthlyBuckets = new Map<string, number>();
    const monthlyLabels = new Map<string, string>();
    for (let i = 0; i < 6; i++) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - (5 - i));
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      monthlyBuckets.set(key, 0);
      monthlyLabels.set(key, d.toLocaleString("en", { month: "short" }));
    }
    const allSalesSixMonths = await this.db
      .select()
      .from(pharmacySales)
      .where(
        and(
          eq(pharmacySales.organizationId, organizationId),
          eq(pharmacySales.branchId, branch.id),
          gte(pharmacySales.createdAt, new Date(new Date().setMonth(new Date().getMonth() - 5, 1))),
        ),
      );
    for (const sale of allSalesSixMonths) {
      const d = sale.createdAt;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (monthlyBuckets.has(key)) {
        monthlyBuckets.set(key, (monthlyBuckets.get(key) ?? 0) + sale.totalPkr);
      }
    }
    const monthlyRevenue = [...monthlyBuckets.entries()].map(([key, amount]) => ({
      month: monthlyLabels.get(key) ?? key,
      amount,
    }));

    const purchaseBuckets = new Map<string, number>();
    for (const key of monthlyBuckets.keys()) {
      purchaseBuckets.set(key, 0);
    }
    const purchaseRows = await this.db
      .select({ total: popsPurchaseOrders.totalAmountPkr, createdAt: popsPurchaseOrders.createdAt })
      .from(popsPurchaseOrders)
      .where(
        and(
          eq(popsPurchaseOrders.organizationId, organizationId),
          eq(popsPurchaseOrders.branchId, branch.id),
          gte(popsPurchaseOrders.createdAt, new Date(new Date().setMonth(new Date().getMonth() - 5, 1))),
        ),
      );
    for (const row of purchaseRows) {
      const d = row.createdAt;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (purchaseBuckets.has(key)) {
        purchaseBuckets.set(key, (purchaseBuckets.get(key) ?? 0) + row.total);
      }
    }
    const purchaseTrends = [...purchaseBuckets.entries()].map(([key, amount]) => ({
      month: monthlyLabels.get(key) ?? key,
      amount,
    }));

    const topMap = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const line of saleLinesMonth) {
      const cur = topMap.get(line.medicineName) ?? { name: line.medicineName, qty: 0, revenue: 0 };
      topMap.set(line.medicineName, {
        name: line.medicineName,
        qty: cur.qty + line.qty,
        revenue: cur.revenue + line.lineTotal,
      });
    }
    const topMedicines = [...topMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 6);

    let stockOk = 0;
    let stockOut = 0;
    for (const m of medicines) {
      if (m.currentStock === 0) stockOut += 1;
      else if (m.currentStock > m.reorderLevel) stockOk += 1;
    }

    const rxStatusMap = new Map<string, number>();
    for (const rx of allPrescriptions) {
      rxStatusMap.set(rx.status, (rxStatusMap.get(rx.status) ?? 0) + 1);
    }
    const prescriptionBreakdown = [...rxStatusMap.entries()].map(([label, value]) => ({ label, value }));

    const paymentMap = new Map<string, number>();
    for (const sale of monthSales) {
      paymentMap.set(sale.paymentMethod, (paymentMap.get(sale.paymentMethod) ?? 0) + sale.totalPkr);
    }
    const paymentBreakdown = [...paymentMap.entries()].map(([label, value]) => ({ label, value }));

    const categoryMap = new Map<string, number>();
    for (const m of medicines) {
      categoryMap.set(m.category, (categoryMap.get(m.category) ?? 0) + m.currentStock);
    }
    const categoryStock = [...categoryMap.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);

    const transactionCountToday = recentSales.filter((s) => s.createdAt >= todayStart).length;

    return {
      totalSalesToday: Number(salesToday[0]?.total ?? 0),
      totalPurchasesMonth: purchaseMonth,
      availableStock: totalStock,
      lowStockCount,
      expiringCount,
      revenueMonth,
      profitMonth,
      pendingOrders: Number(pendingRx[0]?.count ?? 0),
      customerCount: Number(patients[0]?.count ?? 0),
      transactionCountToday,
      dailySales,
      monthlyRevenue,
      topMedicines,
      purchaseTrends,
      stockHealth: [
        { label: "In stock", value: stockOk },
        { label: "Low stock", value: lowStockCount },
        { label: "Out of stock", value: stockOut },
      ],
      prescriptionBreakdown,
      paymentBreakdown,
      categoryStock,
      alerts: alerts.slice(0, 12),
    };
  }

  async listMedicines(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    await this.seedBranchIfEmpty(organizationId, branch.id);

    const rows = await this.db
      .select()
      .from(pharmacyMedicines)
      .where(and(eq(pharmacyMedicines.organizationId, organizationId), eq(pharmacyMedicines.branchId, branch.id)))
      .orderBy(pharmacyMedicines.name);

    const batches = await this.db
      .select({
        medicineId: pharmacyMedicineBatches.medicineId,
        expiryDate: pharmacyMedicineBatches.expiryDate,
      })
      .from(pharmacyMedicineBatches)
      .innerJoin(pharmacyMedicines, eq(pharmacyMedicines.id, pharmacyMedicineBatches.medicineId))
      .where(and(eq(pharmacyMedicines.organizationId, organizationId), eq(pharmacyMedicines.branchId, branch.id)));

    return rows.map((m) => {
      const medBatches = batches.filter((b) => b.medicineId === m.id);
      const nearest = medBatches.map((b) => String(b.expiryDate)).sort()[0] ?? null;
      return mapMedicineRow(m, nearest);
    });
  }

  async createMedicine(organizationId: string, input: CreateMedicine) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [med] = await this.db
      .insert(pharmacyMedicines)
      .values({
        organizationId,
        branchId: branch.id,
        sku: input.sku.trim(),
        name: input.name.trim(),
        genericName: input.genericName?.trim() || null,
        dosageStrength: input.dosageStrength?.trim() || null,
        presentation: input.presentation?.trim() || null,
        brandName: input.brandName?.trim() || null,
        category: input.category ?? "Tablet",
        manufacturer: input.manufacturer?.trim() || null,
        barcode: input.barcode?.trim() || null,
        purchasePricePkr: Math.round(input.purchasePrice ?? 0),
        sellingPricePkr: Math.round(input.sellingPrice ?? 0),
        taxPct: Math.round(input.taxPct ?? 0),
        reorderLevel: Math.round(input.reorderLevel ?? 10),
        suggestedReorderQty: Math.round(input.suggestedReorderQty ?? (input.reorderLevel ?? 10) * 2),
        currentStock: Math.round(input.currentStock ?? 0),
        unit: input.unit ?? "Piece",
        rackLocation: input.rackLocation?.trim() || null,
        shelfLocation: input.shelfLocation?.trim() || null,
        aisleLocation: input.aisleLocation?.trim() || null,
        tabletsPerStrip: Math.max(1, Math.round(input.tabletsPerStrip ?? 1)),
        stripsPerBox: Math.max(1, Math.round(input.stripsPerBox ?? 1)),
        isControlled: input.isControlled ?? false,
        warningsJson: stringifyJsonArray(input.warnings),
        instructionsJson: stringifyJsonArray(input.instructions),
      })
      .returning();
    if (!med) throw new BadRequestException("Failed to create medicine");
    if (input.batchNumber && input.expiryDate) {
      await this.db.insert(pharmacyMedicineBatches).values({
        medicineId: med.id,
        batchNumber: input.batchNumber.trim(),
        expiryDate: input.expiryDate,
        quantity: med.currentStock,
      });
    } else if (med.currentStock > 0) {
      const defaultExpiry = new Date();
      defaultExpiry.setFullYear(defaultExpiry.getFullYear() + 2);
      await this.db.insert(pharmacyMedicineBatches).values({
        medicineId: med.id,
        batchNumber: `OPEN-${med.sku}`,
        expiryDate: defaultExpiry.toISOString().slice(0, 10),
        quantity: med.currentStock,
      });
    }
    return this.listMedicines(organizationId, input.branchCode).then((list) => list.find((m) => m.id === med.id)!);
  }

  async deleteMedicine(organizationId: string, medicineId: string) {
    const [row] = await this.db
      .select()
      .from(pharmacyMedicines)
      .where(and(eq(pharmacyMedicines.id, medicineId), eq(pharmacyMedicines.organizationId, organizationId)))
      .limit(1);
    if (!row) throw new NotFoundException("Medicine not found");

    const [sold] = await this.db
      .select({ id: pharmacySaleLines.id })
      .from(pharmacySaleLines)
      .where(eq(pharmacySaleLines.medicineId, medicineId))
      .limit(1);
    if (sold) {
      throw new BadRequestException("Cannot delete — this medicine has sales history. Reduce stock to zero instead.");
    }

    const [prescribed] = await this.db
      .select({ id: pharmacyPrescriptionItems.id })
      .from(pharmacyPrescriptionItems)
      .where(eq(pharmacyPrescriptionItems.medicineId, medicineId))
      .limit(1);
    if (prescribed) {
      throw new BadRequestException("Cannot delete — this medicine is linked to prescriptions.");
    }

    await this.db.delete(pharmacyMedicines).where(eq(pharmacyMedicines.id, medicineId));
  }

  async updateMedicine(
    organizationId: string,
    medicineId: string,
    branchCode: string,
    input: UpdateMedicine,
  ) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const [existing] = await this.db
      .select()
      .from(pharmacyMedicines)
      .where(
        and(
          eq(pharmacyMedicines.id, medicineId),
          eq(pharmacyMedicines.organizationId, organizationId),
          eq(pharmacyMedicines.branchId, branch.id),
        ),
      )
      .limit(1);
    if (!existing) throw new NotFoundException("Medicine not found");

    const [row] = await this.db
      .update(pharmacyMedicines)
      .set({
        sku: input.sku?.trim() ?? existing.sku,
        name: input.name?.trim() ?? existing.name,
        genericName: input.genericName !== undefined ? input.genericName.trim() || null : existing.genericName,
        dosageStrength:
          input.dosageStrength !== undefined ? input.dosageStrength.trim() || null : existing.dosageStrength,
        presentation: input.presentation !== undefined ? input.presentation.trim() || null : existing.presentation,
        brandName: input.brandName !== undefined ? input.brandName.trim() || null : existing.brandName,
        category: input.category ?? existing.category,
        manufacturer: input.manufacturer !== undefined ? input.manufacturer.trim() || null : existing.manufacturer,
        barcode: input.barcode !== undefined ? input.barcode.trim() || null : existing.barcode,
        purchasePricePkr:
          input.purchasePrice !== undefined ? Math.round(input.purchasePrice) : existing.purchasePricePkr,
        sellingPricePkr:
          input.sellingPrice !== undefined ? Math.round(input.sellingPrice) : existing.sellingPricePkr,
        taxPct: input.taxPct !== undefined ? Math.round(input.taxPct) : existing.taxPct,
        reorderLevel: input.reorderLevel !== undefined ? Math.round(input.reorderLevel) : existing.reorderLevel,
        suggestedReorderQty:
          input.suggestedReorderQty !== undefined
            ? Math.round(input.suggestedReorderQty)
            : existing.suggestedReorderQty,
        currentStock: input.currentStock !== undefined ? Math.round(input.currentStock) : existing.currentStock,
        unit: input.unit ?? existing.unit,
        rackLocation: input.rackLocation !== undefined ? input.rackLocation.trim() || null : existing.rackLocation,
        shelfLocation: input.shelfLocation !== undefined ? input.shelfLocation.trim() || null : existing.shelfLocation,
        aisleLocation: input.aisleLocation !== undefined ? input.aisleLocation.trim() || null : existing.aisleLocation,
        tabletsPerStrip:
          input.tabletsPerStrip !== undefined ? Math.max(1, Math.round(input.tabletsPerStrip)) : existing.tabletsPerStrip,
        stripsPerBox:
          input.stripsPerBox !== undefined ? Math.max(1, Math.round(input.stripsPerBox)) : existing.stripsPerBox,
        isControlled: input.isControlled !== undefined ? input.isControlled : existing.isControlled,
        warningsJson: input.warnings ? stringifyJsonArray(input.warnings) : existing.warningsJson,
        instructionsJson: input.instructions ? stringifyJsonArray(input.instructions) : existing.instructionsJson,
      })
      .where(eq(pharmacyMedicines.id, medicineId))
      .returning();
    if (!row) throw new BadRequestException("Failed to update medicine");
    return this.listMedicines(organizationId, branchCode).then((list) => list.find((m) => m.id === medicineId)!);
  }

  async matchMedicines(organizationId: string, branchCode: string, query: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const rows = await this.db
      .select()
      .from(pharmacyMedicines)
      .where(and(eq(pharmacyMedicines.organizationId, organizationId), eq(pharmacyMedicines.branchId, branch.id)));

    const scored = rows
      .map((m) => {
        const name = m.name.toLowerCase();
        const generic = (m.genericName ?? "").toLowerCase();
        const brand = (m.brandName ?? "").toLowerCase();
        const sku = m.sku.toLowerCase();
        let score = 0;
        if (name === q || generic === q) score = 100;
        else if (name.startsWith(q) || generic.startsWith(q)) score = 80;
        else if (name.includes(q) || generic.includes(q) || brand.includes(q)) score = 60;
        else if (sku.includes(q)) score = 40;
        else {
          const tokens = q.split(/\s+/).filter(Boolean);
          const haystack = `${name} ${generic} ${brand}`;
          const hits = tokens.filter((t) => haystack.includes(t)).length;
          if (hits > 0) score = 20 + hits * 10;
        }
        return { m, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);

    return scored.map(({ m, score }) => ({
      id: m.id,
      name: m.name,
      genericName: m.genericName,
      brandName: m.brandName,
      currentStock: m.currentStock,
      matchScore: score,
    }));
  }

  async listBatches(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select({
        id: pharmacyMedicineBatches.id,
        medicineId: pharmacyMedicineBatches.medicineId,
        medicineName: pharmacyMedicines.name,
        batchNumber: pharmacyMedicineBatches.batchNumber,
        manufacturingDate: pharmacyMedicineBatches.manufacturingDate,
        expiryDate: pharmacyMedicineBatches.expiryDate,
        quantity: pharmacyMedicineBatches.quantity,
      })
      .from(pharmacyMedicineBatches)
      .innerJoin(pharmacyMedicines, eq(pharmacyMedicines.id, pharmacyMedicineBatches.medicineId))
      .where(and(eq(pharmacyMedicines.organizationId, organizationId), eq(pharmacyMedicines.branchId, branch.id)))
      .orderBy(pharmacyMedicineBatches.expiryDate);
    return rows.map((r) => ({
      id: r.id,
      medicineId: r.medicineId,
      medicineName: r.medicineName,
      batchNumber: r.batchNumber,
      manufacturingDate: r.manufacturingDate ? String(r.manufacturingDate) : null,
      expiryDate: String(r.expiryDate),
      quantity: r.quantity,
    }));
  }

  async listPatients(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    await this.seedBranchIfEmpty(organizationId, branch.id);
    const rows = await this.db
      .select()
      .from(pharmacyPatients)
      .where(and(eq(pharmacyPatients.organizationId, organizationId), eq(pharmacyPatients.branchId, branch.id)))
      .orderBy(pharmacyPatients.name);

    const sales = await this.db
      .select({ patientId: pharmacySales.patientId, total: sql<number>`coalesce(sum(${pharmacySales.totalPkr}), 0)` })
      .from(pharmacySales)
      .where(and(eq(pharmacySales.organizationId, organizationId), eq(pharmacySales.branchId, branch.id)))
      .groupBy(pharmacySales.patientId);

    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      phone: p.phone,
      email: p.email,
      address: p.address,
      dateOfBirth: p.dateOfBirth ? String(p.dateOfBirth) : null,
      allergies: parseJsonArray(p.allergiesJson),
      medicalConditions: parseJsonArray(p.medicalConditionsJson),
      chronicDiseases: parseJsonArray(p.chronicDiseasesJson),
      loyaltyPoints: p.loyaltyPoints,
      outstandingPkr: p.outstandingPkr,
      creditLimitPkr: p.creditLimitPkr,
      creditDueDate: p.creditDueDate ? String(p.creditDueDate) : null,
      refillReminderEnabled: p.refillReminderEnabled,
      refillReminderChannel: (p.refillReminderChannel as "sms" | "email" | "whatsapp" | null) ?? null,
      totalPurchases: Number(sales.find((s) => s.patientId === p.id)?.total ?? 0),
    }));
  }

  async createPatient(organizationId: string, input: CreatePatient) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(pharmacyPatients)
      .values({
        organizationId,
        branchId: branch.id,
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
        address: input.address?.trim() || null,
        dateOfBirth: input.dateOfBirth || null,
        allergiesJson: stringifyJsonArray(input.allergies),
        medicalConditionsJson: stringifyJsonArray(input.medicalConditions),
        chronicDiseasesJson: stringifyJsonArray(input.chronicDiseases),
        creditLimitPkr: Math.round(input.creditLimitPkr ?? 0),
        creditDueDate: input.creditDueDate || null,
        refillReminderEnabled: input.refillReminderEnabled ?? false,
        refillReminderChannel: input.refillReminderChannel ?? null,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create patient");
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      address: row.address,
      dateOfBirth: row.dateOfBirth ? String(row.dateOfBirth) : null,
      allergies: parseJsonArray(row.allergiesJson),
      medicalConditions: parseJsonArray(row.medicalConditionsJson),
      chronicDiseases: parseJsonArray(row.chronicDiseasesJson),
      loyaltyPoints: row.loyaltyPoints,
      outstandingPkr: row.outstandingPkr,
      creditLimitPkr: row.creditLimitPkr,
      creditDueDate: row.creditDueDate ? String(row.creditDueDate) : null,
      refillReminderEnabled: row.refillReminderEnabled,
      refillReminderChannel: (row.refillReminderChannel as "sms" | "email" | "whatsapp" | null) ?? null,
      totalPurchases: 0,
    };
  }

  async listDoctors(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    await this.seedBranchIfEmpty(organizationId, branch.id);
    const rows = await this.db
      .select()
      .from(pharmacyDoctors)
      .where(and(eq(pharmacyDoctors.organizationId, organizationId), eq(pharmacyDoctors.branchId, branch.id)))
      .orderBy(pharmacyDoctors.name);

    const rxCounts = await this.db
      .select({ doctorId: pharmacyPrescriptions.doctorId, count: sql<number>`count(*)` })
      .from(pharmacyPrescriptions)
      .where(and(eq(pharmacyPrescriptions.organizationId, organizationId), eq(pharmacyPrescriptions.branchId, branch.id)))
      .groupBy(pharmacyPrescriptions.doctorId);

    return rows.map((d) => ({
      id: d.id,
      name: d.name,
      specialization: d.specialization,
      clinic: d.clinic,
      phone: d.phone,
      email: d.email,
      prescriptionCount: Number(rxCounts.find((r) => r.doctorId === d.id)?.count ?? 0),
    }));
  }

  async createDoctor(organizationId: string, input: CreateDoctor) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(pharmacyDoctors)
      .values({
        organizationId,
        branchId: branch.id,
        name: input.name.trim(),
        specialization: input.specialization?.trim() || null,
        clinic: input.clinic?.trim() || null,
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create doctor");
    return {
      id: row.id,
      name: row.name,
      specialization: row.specialization,
      clinic: row.clinic,
      phone: row.phone,
      email: row.email,
      prescriptionCount: 0,
    };
  }

  async listPrescriptions(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(pharmacyPrescriptions)
      .where(and(eq(pharmacyPrescriptions.organizationId, organizationId), eq(pharmacyPrescriptions.branchId, branch.id)))
      .orderBy(desc(pharmacyPrescriptions.createdAt));

    const out = [];
    for (const rx of rows) {
      const items = await this.db
        .select({
          id: pharmacyPrescriptionItems.id,
          medicineId: pharmacyPrescriptionItems.medicineId,
          medicineName: pharmacyMedicines.name,
          dosage: pharmacyPrescriptionItems.dosage,
          quantity: pharmacyPrescriptionItems.quantity,
          dispensedQty: pharmacyPrescriptionItems.dispensedQty,
        })
        .from(pharmacyPrescriptionItems)
        .innerJoin(pharmacyMedicines, eq(pharmacyMedicines.id, pharmacyPrescriptionItems.medicineId))
        .where(eq(pharmacyPrescriptionItems.prescriptionId, rx.id));

      const patient = rx.patientId
        ? await this.db.select().from(pharmacyPatients).where(eq(pharmacyPatients.id, rx.patientId)).limit(1)
        : [];
      const doctor = rx.doctorId
        ? await this.db.select().from(pharmacyDoctors).where(eq(pharmacyDoctors.id, rx.doctorId)).limit(1)
        : [];

      const attachment = rx.attachmentJson ? (JSON.parse(rx.attachmentJson) as { name?: string }) : null;

      out.push({
        id: rx.id,
        prescriptionNumber: rx.prescriptionNumber,
        patientId: rx.patientId,
        patientName: patient[0]?.name ?? null,
        doctorId: rx.doctorId,
        doctorName: doctor[0]?.name ?? null,
        status: rx.status,
        notes: rx.notes,
        attachmentName: attachment?.name ?? null,
        hasAttachment: Boolean(rx.attachmentJson),
        items: items.map((i) => ({
          id: i.id,
          medicineId: i.medicineId,
          medicineName: i.medicineName,
          dosage: i.dosage,
          quantity: i.quantity,
          dispensedQty: i.dispensedQty,
        })),
        createdAt: rx.createdAt.toISOString(),
        verifiedAt: rx.verifiedAt?.toISOString() ?? null,
        dispensedAt: rx.dispensedAt?.toISOString() ?? null,
      });
    }
    return out;
  }

  async createPrescription(organizationId: string, input: CreatePrescription) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const rxNumber = `RX-${Date.now().toString().slice(-6)}`;
    const attachmentJson =
      input.attachmentName && input.attachmentDataUrl
        ? JSON.stringify({ name: input.attachmentName, dataUrl: input.attachmentDataUrl })
        : null;
    const [rx] = await this.db
      .insert(pharmacyPrescriptions)
      .values({
        organizationId,
        branchId: branch.id,
        prescriptionNumber: rxNumber,
        patientId: input.patientId ?? null,
        doctorId: input.doctorId ?? null,
        status: "Pending",
        notes: input.notes?.trim() || null,
        attachmentJson,
      })
      .returning();
    if (!rx) throw new BadRequestException("Failed to create prescription");

    for (const item of input.items) {
      await this.db.insert(pharmacyPrescriptionItems).values({
        prescriptionId: rx.id,
        medicineId: item.medicineId,
        dosage: item.dosage?.trim() || null,
        quantity: item.quantity,
      });
    }
    return this.listPrescriptions(organizationId, input.branchCode).then((list) => list.find((r) => r.id === rx.id)!);
  }

  async verifyPrescription(organizationId: string, prescriptionId: string) {
    const [rx] = await this.db
      .select()
      .from(pharmacyPrescriptions)
      .where(and(eq(pharmacyPrescriptions.id, prescriptionId), eq(pharmacyPrescriptions.organizationId, organizationId)))
      .limit(1);
    if (!rx) throw new NotFoundException("Prescription not found");
    await this.db
      .update(pharmacyPrescriptions)
      .set({ status: "Verified", verifiedAt: new Date() })
      .where(eq(pharmacyPrescriptions.id, prescriptionId));
    return { ok: true };
  }

  private async deductMedicineStock(
    organizationId: string,
    branchId: string,
    medicineId: string,
    qty: number,
    preferredBatchId?: string,
  ): Promise<string | null> {
    const [med] = await this.db
      .select()
      .from(pharmacyMedicines)
      .where(
        and(
          eq(pharmacyMedicines.id, medicineId),
          eq(pharmacyMedicines.organizationId, organizationId),
          eq(pharmacyMedicines.branchId, branchId),
        ),
      )
      .limit(1);
    if (!med) throw new NotFoundException("Medicine not found for this branch");
    if (med.currentStock < qty) throw new BadRequestException(`Insufficient stock for ${med.name}`);

    let usedBatchId: string | null = null;
    let remaining = qty;

    if (preferredBatchId) {
      const [batch] = await this.db
        .select()
        .from(pharmacyMedicineBatches)
        .where(
          and(
            eq(pharmacyMedicineBatches.id, preferredBatchId),
            eq(pharmacyMedicineBatches.medicineId, medicineId),
            sql`${pharmacyMedicineBatches.quantity} > 0`,
          ),
        )
        .limit(1);
      if (!batch) throw new BadRequestException("Selected batch is unavailable");
      if (batch.quantity < qty) throw new BadRequestException("Insufficient quantity in selected batch");
      await this.db
        .update(pharmacyMedicineBatches)
        .set({ quantity: batch.quantity - qty })
        .where(eq(pharmacyMedicineBatches.id, batch.id));
      usedBatchId = batch.id;
      remaining = 0;
    }

    if (remaining > 0) {
      const batches = await this.db
        .select()
        .from(pharmacyMedicineBatches)
        .where(and(eq(pharmacyMedicineBatches.medicineId, medicineId), sql`${pharmacyMedicineBatches.quantity} > 0`))
        .orderBy(asc(pharmacyMedicineBatches.expiryDate));

      for (const batch of batches) {
        if (remaining <= 0) break;
        const take = Math.min(batch.quantity, remaining);
        await this.db
          .update(pharmacyMedicineBatches)
          .set({ quantity: batch.quantity - take })
          .where(eq(pharmacyMedicineBatches.id, batch.id));
        if (!usedBatchId) usedBatchId = batch.id;
        remaining -= take;
      }
    }

    await this.db
      .update(pharmacyMedicines)
      .set({ currentStock: med.currentStock - qty })
      .where(eq(pharmacyMedicines.id, medicineId));

    return usedBatchId;
  }

  async dispensePrescription(organizationId: string, prescriptionId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const [rx] = await this.db
      .select()
      .from(pharmacyPrescriptions)
      .where(and(eq(pharmacyPrescriptions.id, prescriptionId), eq(pharmacyPrescriptions.organizationId, organizationId)))
      .limit(1);
    if (!rx) throw new NotFoundException("Prescription not found");
    if (rx.branchId !== branch.id) {
      throw new BadRequestException("This prescription belongs to another branch");
    }
    if (rx.status === "Dispensed") throw new BadRequestException("Prescription already dispensed");
    if (rx.status === "Cancelled") throw new BadRequestException("Prescription is cancelled");
    if (rx.status !== "Verified") {
      throw new BadRequestException("Verify the prescription before dispensing");
    }

    const items = await this.db
      .select()
      .from(pharmacyPrescriptionItems)
      .where(eq(pharmacyPrescriptionItems.prescriptionId, prescriptionId));

    const lines = items
      .map((item) => ({ medicineId: item.medicineId, qty: item.quantity - item.dispensedQty }))
      .filter((line) => line.qty > 0);

    if (lines.length === 0) throw new BadRequestException("Nothing left to dispense on this prescription");

    const sale = await this.createSale(organizationId, {
      branchCode,
      patientId: rx.patientId ?? undefined,
      paymentMethod: "Cash",
      discount: 0,
      lines,
    });

    for (const item of items) {
      await this.db
        .update(pharmacyPrescriptionItems)
        .set({ dispensedQty: item.quantity })
        .where(eq(pharmacyPrescriptionItems.id, item.id));
    }

    await this.db
      .update(pharmacyPrescriptions)
      .set({ status: "Dispensed", dispensedAt: new Date() })
      .where(eq(pharmacyPrescriptions.id, prescriptionId));

    return { ok: true, branchCode: branch.code, invoiceNumber: sale.invoiceNumber, saleId: sale.id };
  }

  async listSales(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const sales = await this.db
      .select()
      .from(pharmacySales)
      .where(and(eq(pharmacySales.organizationId, organizationId), eq(pharmacySales.branchId, branch.id)))
      .orderBy(desc(pharmacySales.createdAt))
      .limit(200);

    const out = [];
    for (const sale of sales) {
      const lines = await this.db
        .select({
          id: pharmacySaleLines.id,
          medicineId: pharmacySaleLines.medicineId,
          medicineName: pharmacyMedicines.name,
          batchId: pharmacySaleLines.batchId,
          batchNumber: pharmacyMedicineBatches.batchNumber,
          saleUnit: pharmacySaleLines.saleUnit,
          qty: pharmacySaleLines.qty,
          tabletsQty: pharmacySaleLines.tabletsQty,
          unitPrice: pharmacySaleLines.unitPricePkr,
          lineTotal: pharmacySaleLines.lineTotalPkr,
        })
        .from(pharmacySaleLines)
        .innerJoin(pharmacyMedicines, eq(pharmacyMedicines.id, pharmacySaleLines.medicineId))
        .leftJoin(pharmacyMedicineBatches, eq(pharmacyMedicineBatches.id, pharmacySaleLines.batchId))
        .where(eq(pharmacySaleLines.saleId, sale.id));

      const patient = sale.patientId
        ? await this.db.select().from(pharmacyPatients).where(eq(pharmacyPatients.id, sale.patientId)).limit(1)
        : [];

      const payments = parsePaymentsJson(sale.paymentsJson);
      if (payments.length === 0 && sale.amountPaidPkr > 0) {
        payments.push({ method: sale.paymentMethod, amount: sale.amountPaidPkr });
      }

      out.push({
        id: sale.id,
        invoiceNumber: sale.invoiceNumber,
        patientId: sale.patientId,
        patientName: patient[0]?.name ?? null,
        paymentMethod: sale.paymentMethod as CreatePharmacySale["paymentMethod"],
        payments,
        amountPaid: sale.amountPaidPkr,
        amountDue: sale.amountDuePkr,
        subtotal: sale.subtotalPkr,
        tax: sale.taxPkr,
        discount: sale.discountPkr,
        total: sale.totalPkr,
        lines: lines.map((l) => ({
          id: l.id,
          medicineId: l.medicineId,
          medicineName: l.medicineName,
          batchId: l.batchId,
          batchNumber: l.batchNumber,
          saleUnit: (l.saleUnit as PharmacySaleUnit | null) ?? null,
          qty: l.qty,
          tabletsQty: l.tabletsQty,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
        })),
        createdAt: sale.createdAt.toISOString(),
      });
    }
    return out;
  }

  async createSale(organizationId: string, input: CreatePharmacySale, cashierUserId?: string) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const invoiceNumber = `INV-${Date.now().toString().slice(-6)}`;

    let subtotal = 0;
    let tax = 0;
    let hasControlled = false;
    const lineData: {
      medicineId: string;
      batchId?: string;
      saleUnit: PharmacySaleUnit;
      qty: number;
      tabletsQty: number;
      unitPrice: number;
      lineTotal: number;
      name: string;
      isControlled: boolean;
    }[] = [];

    for (const line of input.lines) {
      const [med] = await this.db
        .select()
        .from(pharmacyMedicines)
        .where(
          and(
            eq(pharmacyMedicines.id, line.medicineId),
            eq(pharmacyMedicines.organizationId, organizationId),
            eq(pharmacyMedicines.branchId, branch.id),
          ),
        )
        .limit(1);
      if (!med) throw new NotFoundException(`Medicine not found: ${line.medicineId}`);

      const pack = {
        sellingPrice: med.sellingPricePkr,
        tabletsPerStrip: med.tabletsPerStrip,
        stripsPerBox: med.stripsPerBox,
        currentStock: med.currentStock,
      };
      const saleUnit: PharmacySaleUnit =
        line.saleUnit ?? (med.tabletsPerStrip > 1 ? "strip" : "piece");
      const tabletsQty = saleQtyToTablets(pack, saleUnit, line.qty);

      if (med.currentStock < tabletsQty) {
        throw new BadRequestException(`Insufficient stock for ${med.name} (need ${tabletsQty} tablets)`);
      }
      if (med.isControlled) hasControlled = true;

      const lineTotal = computeLinePrice(pack, saleUnit, line.qty);
      const lineTax = Math.round((lineTotal * med.taxPct) / 100);
      subtotal += lineTotal;
      tax += lineTax;
      const unitPrice = line.qty > 0 ? Math.round(lineTotal / line.qty) : 0;
      lineData.push({
        medicineId: med.id,
        batchId: line.batchId,
        saleUnit,
        qty: line.qty,
        tabletsQty,
        unitPrice,
        lineTotal,
        name: med.name,
        isControlled: med.isControlled,
      });
    }

    if (hasControlled && !input.controlledApproved) {
      throw new BadRequestException("Pharmacist approval required for controlled substances");
    }

    const discount = Math.round(input.discount ?? 0);
    const total = subtotal + tax - discount;

    let payments = input.payments?.filter((p) => p.amount > 0) ?? [];
    if (payments.length === 0) {
      payments = [{ method: input.paymentMethod, amount: total }];
    }

    const paidFromPayments = payments
      .filter((p) => p.method !== "Khata")
      .reduce((sum, p) => sum + Math.round(p.amount), 0);
    let amountPaid = Math.min(paidFromPayments, total);
    let amountDue = Math.max(total - amountPaid, 0);

    if (input.paymentMethod === "Khata" || payments.some((p) => p.method === "Khata")) {
      if (!input.patientId) throw new BadRequestException("Khata sales require a registered customer");
      amountDue = total - amountPaid;
    }

    if (input.patientId && amountDue > 0) {
      const [patient] = await this.db.select().from(pharmacyPatients).where(eq(pharmacyPatients.id, input.patientId)).limit(1);
      if (patient && patient.creditLimitPkr > 0 && patient.outstandingPkr + amountDue > patient.creditLimitPkr) {
        throw new BadRequestException(`Credit limit exceeded (limit: Rs ${patient.creditLimitPkr.toLocaleString()})`);
      }
    }

    const paymentMethod =
      payments.length > 1 || input.paymentMethod === "Mixed" ? "Mixed" : (payments[0]?.method ?? input.paymentMethod);

    const [sale] = await this.db
      .insert(pharmacySales)
      .values({
        organizationId,
        branchId: branch.id,
        invoiceNumber,
        patientId: input.patientId ?? null,
        prescriptionId: input.prescriptionId ?? null,
        shiftId: input.shiftId ?? null,
        cashierUserId: cashierUserId ?? null,
        paymentMethod,
        paymentsJson: JSON.stringify(payments),
        amountPaidPkr: amountPaid,
        amountDuePkr: amountDue,
        subtotalPkr: subtotal,
        taxPkr: tax,
        discountPkr: discount,
        totalPkr: total,
      })
      .returning();
    if (!sale) throw new BadRequestException("Failed to create sale");

    for (const line of lineData) {
      const batchId = await this.deductMedicineStock(
        organizationId,
        branch.id,
        line.medicineId,
        line.tabletsQty,
        line.batchId,
      );
      await this.db.insert(pharmacySaleLines).values({
        saleId: sale.id,
        medicineId: line.medicineId,
        batchId,
        saleUnit: line.saleUnit,
        qty: line.qty,
        tabletsQty: line.tabletsQty,
        unitPricePkr: line.unitPrice,
        lineTotalPkr: line.lineTotal,
      });

      if (line.isControlled) {
        await this.db.insert(pharmacyControlledDrugLogs).values({
          organizationId,
          branchId: branch.id,
          medicineId: line.medicineId,
          saleId: sale.id,
          patientId: input.patientId ?? null,
          prescriptionId: input.prescriptionId ?? null,
          qty: line.qty,
          approvedByUserId: cashierUserId ?? null,
          buyerInfoJson: input.patientId ? null : JSON.stringify({ walkIn: true }),
        });
      }

      if (input.patientId) {
        const [patient] = await this.db
          .select()
          .from(pharmacyPatients)
          .where(eq(pharmacyPatients.id, input.patientId))
          .limit(1);
        if (patient?.refillReminderEnabled) {
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + 30);
          await this.db.insert(pharmacyRefillReminders).values({
            organizationId,
            branchId: branch.id,
            patientId: input.patientId,
            medicineId: line.medicineId,
            lastSaleId: sale.id,
            refillDueDate: dueDate.toISOString().slice(0, 10),
            channel: patient.refillReminderChannel ?? "sms",
            status: "pending",
          });
        }
      }
    }

    if (input.patientId) {
      const [patient] = await this.db.select().from(pharmacyPatients).where(eq(pharmacyPatients.id, input.patientId)).limit(1);
      if (patient) {
        const newOutstanding = patient.outstandingPkr + amountDue;
        await this.db
          .update(pharmacyPatients)
          .set({
            loyaltyPoints: patient.loyaltyPoints + Math.floor(total / 100),
            outstandingPkr: newOutstanding,
          })
          .where(eq(pharmacyPatients.id, patient.id));

        if (amountDue > 0) {
          await this.db.insert(pharmacyKhataEntries).values({
            organizationId,
            branchId: branch.id,
            patientId: patient.id,
            saleId: sale.id,
            type: "sale",
            amountPkr: amountDue,
            balanceAfterPkr: newOutstanding,
            notes: `Invoice ${invoiceNumber}`,
          });
        }
      }
    }

    if (input.shiftId) {
      const [shift] = await this.db.select().from(pharmacyShifts).where(eq(pharmacyShifts.id, input.shiftId)).limit(1);
      if (shift && shift.status === "open") {
        await this.db
          .update(pharmacyShifts)
          .set({
            totalSalesPkr: shift.totalSalesPkr + total,
            transactionCount: shift.transactionCount + 1,
          })
          .where(eq(pharmacyShifts.id, shift.id));
      }
    }

    await this.taxAuthority.enqueueFromSale({
      organizationId,
      branchId: branch.id,
      branchCode: branch.code,
      sourceType: "pharmacy_sale",
      sourceId: sale.id,
      sourceRef: invoiceNumber,
      taxableAmountPkr: Math.max(0, subtotal - discount),
      taxAmountPkr: tax,
    });

    return this.listSales(organizationId, input.branchCode).then((list) => list.find((s) => s.id === sale.id)!);
  }

  async getPurchaseStatement(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select({
        poNumber: popsPurchaseOrders.poNumber,
        supplierName: popsSuppliers.name,
        status: popsPurchaseOrders.status,
        totalAmount: popsPurchaseOrders.totalAmountPkr,
        createdAt: popsPurchaseOrders.createdAt,
      })
      .from(popsPurchaseOrders)
      .innerJoin(popsSuppliers, eq(popsSuppliers.id, popsPurchaseOrders.supplierId))
      .where(and(eq(popsPurchaseOrders.organizationId, organizationId), eq(popsPurchaseOrders.branchId, branch.id)))
      .orderBy(desc(popsPurchaseOrders.createdAt));
    return rows.map((r) => ({
      poNumber: r.poNumber,
      supplierName: r.supplierName,
      status: r.status,
      totalAmount: r.totalAmount,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async getSupplierPayments(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const suppliers = await this.db
      .select()
      .from(popsSuppliers)
      .where(and(eq(popsSuppliers.organizationId, organizationId), eq(popsSuppliers.branchId, branch.id)));
    const pos = await this.db
      .select({ supplierId: popsPurchaseOrders.supplierId, total: popsPurchaseOrders.totalAmountPkr })
      .from(popsPurchaseOrders)
      .where(and(eq(popsPurchaseOrders.organizationId, organizationId), eq(popsPurchaseOrders.branchId, branch.id)));
    return suppliers.map((s) => {
      const totalPurchases = pos.filter((p) => p.supplierId === s.id).reduce((sum, p) => sum + p.total, 0);
      return {
        id: s.id,
        name: s.name,
        paymentTerms: s.paymentTerms,
        totalPurchases,
        openingBalancePkr: s.openingBalancePkr,
        amountDue: s.openingBalancePkr + totalPurchases,
        lastOrder: null as string | null,
      };
    });
  }

  async getSalesStatement(organizationId: string, branchCode: string) {
    const sales = await this.listSales(organizationId, branchCode);
    return sales.map((s) => ({
      invoiceNumber: s.invoiceNumber,
      patientName: s.patientName,
      paymentMethod: s.paymentMethod,
      total: s.total,
      createdAt: s.createdAt,
    }));
  }

  async getProfitLoss(organizationId: string, branchCode: string, fromIso?: string, toIso?: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const now = new Date();
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
    defaultFrom.setHours(0, 0, 0, 0);

    const from = fromIso ? new Date(fromIso) : defaultFrom;
    const to = toIso ? new Date(toIso) : now;
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException("Invalid date range");
    }
    if (from > to) {
      throw new BadRequestException("Start date must be before end date");
    }

    const sales = await this.db
      .select()
      .from(pharmacySales)
      .where(
        and(
          eq(pharmacySales.organizationId, organizationId),
          eq(pharmacySales.branchId, branch.id),
          gte(pharmacySales.createdAt, from),
          lte(pharmacySales.createdAt, to),
        ),
      );

    const saleLines = await this.db
      .select({
        medicineId: pharmacySaleLines.medicineId,
        medicineName: pharmacyMedicines.name,
        qty: pharmacySaleLines.qty,
        lineTotal: pharmacySaleLines.lineTotalPkr,
        purchasePrice: pharmacyMedicines.purchasePricePkr,
      })
      .from(pharmacySaleLines)
      .innerJoin(pharmacySales, eq(pharmacySales.id, pharmacySaleLines.saleId))
      .innerJoin(pharmacyMedicines, eq(pharmacyMedicines.id, pharmacySaleLines.medicineId))
      .where(
        and(
          eq(pharmacySales.organizationId, organizationId),
          eq(pharmacySales.branchId, branch.id),
          gte(pharmacySales.createdAt, from),
          lte(pharmacySales.createdAt, to),
        ),
      );

    const purchasesRow = await this.db
      .select({ total: sql<number>`coalesce(sum(${popsPurchaseOrders.totalAmountPkr}), 0)` })
      .from(popsPurchaseOrders)
      .where(
        and(
          eq(popsPurchaseOrders.organizationId, organizationId),
          eq(popsPurchaseOrders.branchId, branch.id),
          gte(popsPurchaseOrders.createdAt, from),
          lte(popsPurchaseOrders.createdAt, to),
        ),
      );

    const revenue = sales.reduce((sum, sale) => sum + sale.totalPkr, 0);
    const taxCollected = sales.reduce((sum, sale) => sum + sale.taxPkr, 0);
    const discountsGiven = sales.reduce((sum, sale) => sum + sale.discountPkr, 0);
    const costOfGoods = saleLines.reduce((sum, line) => sum + line.purchasePrice * line.qty, 0);
    const itemsSold = saleLines.reduce((sum, line) => sum + line.qty, 0);
    const purchasesInPeriod = Number(purchasesRow[0]?.total ?? 0);
    const expenses = purchasesInPeriod;
    const grossProfit = revenue - costOfGoods;
    const netProfit = grossProfit - expenses;
    const marginPct = revenue > 0 ? Math.round((netProfit / revenue) * 100) : 0;

    const productMap = new Map<string, { medicineName: string; qtySold: number; revenue: number; cost: number }>();
    for (const line of saleLines) {
      const cur = productMap.get(line.medicineId) ?? {
        medicineName: line.medicineName,
        qtySold: 0,
        revenue: 0,
        cost: 0,
      };
      productMap.set(line.medicineId, {
        medicineName: line.medicineName,
        qtySold: cur.qtySold + line.qty,
        revenue: cur.revenue + line.lineTotal,
        cost: cur.cost + line.purchasePrice * line.qty,
      });
    }

    const topProducts = [...productMap.values()]
      .map((p) => ({ ...p, profit: p.revenue - p.cost }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);

    const periodLabel = `${from.toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" })} – ${to.toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" })}`;

    const statement = [
      { label: "Sales revenue", amount: revenue, type: "income" as const },
      { label: "Tax collected", amount: taxCollected, type: "income" as const },
      { label: "Discounts given", amount: -discountsGiven, type: "expense" as const },
      { label: "Cost of goods sold", amount: -costOfGoods, type: "expense" as const },
      { label: "Gross profit", amount: grossProfit, type: "total" as const },
      { label: "Inventory purchases", amount: -expenses, type: "expense" as const },
      { label: "Net profit / loss", amount: netProfit, type: "total" as const },
    ];

    return {
      periodLabel,
      from: from.toISOString(),
      to: to.toISOString(),
      revenue,
      costOfGoods,
      grossProfit,
      expenses,
      netProfit,
      marginPct,
      transactionCount: sales.length,
      itemsSold,
      taxCollected,
      discountsGiven,
      purchasesInPeriod,
      statement,
      topProducts,
    };
  }

  async getSalesOfMonth(organizationId: string, branchCode: string, fromIso?: string, toIso?: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const now = new Date();
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
    defaultFrom.setHours(0, 0, 0, 0);

    const from = fromIso ? new Date(fromIso) : defaultFrom;
    const to = toIso ? new Date(toIso) : now;
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException("Invalid date range");
    }
    if (from > to) {
      throw new BadRequestException("Start date must be before end date");
    }

    const rows = await this.db
      .select({
        invoiceNumber: pharmacySales.invoiceNumber,
        patientName: pharmacyPatients.name,
        paymentMethod: pharmacySales.paymentMethod,
        total: pharmacySales.totalPkr,
        createdAt: pharmacySales.createdAt,
      })
      .from(pharmacySales)
      .leftJoin(pharmacyPatients, eq(pharmacyPatients.id, pharmacySales.patientId))
      .where(
        and(
          eq(pharmacySales.organizationId, organizationId),
          eq(pharmacySales.branchId, branch.id),
          gte(pharmacySales.createdAt, from),
          lte(pharmacySales.createdAt, to),
        ),
      )
      .orderBy(desc(pharmacySales.createdAt));

    const sameCalendarDay =
      from.getFullYear() === to.getFullYear() &&
      from.getMonth() === to.getMonth() &&
      from.getDate() === to.getDate();
    const byBucket = new Map<string, { amount: number; count: number; label: string }>();

    for (const sale of rows) {
      const created = sale.createdAt;
      const bucketKey = sameCalendarDay
        ? `${String(created.getHours()).padStart(2, "0")}:00`
        : created.toISOString().slice(0, 10);
      const label = sameCalendarDay
        ? bucketKey
        : created.toLocaleDateString("en-PK", { day: "numeric", month: "short" });
      const cur = byBucket.get(bucketKey) ?? { amount: 0, count: 0, label };
      byBucket.set(bucketKey, {
        label,
        amount: cur.amount + sale.total,
        count: cur.count + 1,
      });
    }

    const dailyBreakdown = [...byBucket.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, label: v.label, amount: v.amount, count: v.count }));

    const totalSales = rows.reduce((sum, row) => sum + row.total, 0);
    const transactionCount = rows.length;
    const periodLabel = `${from.toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" })} – ${to.toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" })}`;

    return {
      month: periodLabel,
      from: from.toISOString(),
      to: to.toISOString(),
      totalSales,
      transactionCount,
      averageSale: transactionCount > 0 ? Math.round(totalSales / transactionCount) : 0,
      dailyBreakdown,
      transactions: rows.map((row) => ({
        invoiceNumber: row.invoiceNumber,
        patientName: row.patientName,
        paymentMethod: row.paymentMethod,
        total: row.total,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async getExpiredProducts(organizationId: string, branchCode: string, fromDate?: string, toDate?: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);

    const defaultFrom = "2000-01-01";
    const defaultTo = todayStr;
    const from = fromDate?.slice(0, 10) ?? defaultFrom;
    const to = toDate?.slice(0, 10) ?? defaultTo;

    if (from > to) {
      throw new BadRequestException("Start date must be before end date");
    }

    const rows = await this.db
      .select({
        id: pharmacyMedicineBatches.id,
        medicineName: pharmacyMedicines.name,
        sku: pharmacyMedicines.sku,
        presentation: pharmacyMedicines.presentation,
        category: pharmacyMedicines.category,
        purchasePricePkr: pharmacyMedicines.purchasePricePkr,
        batchNumber: pharmacyMedicineBatches.batchNumber,
        expiryDate: pharmacyMedicineBatches.expiryDate,
        quantity: pharmacyMedicineBatches.quantity,
      })
      .from(pharmacyMedicineBatches)
      .innerJoin(pharmacyMedicines, eq(pharmacyMedicines.id, pharmacyMedicineBatches.medicineId))
      .where(
        and(
          eq(pharmacyMedicines.organizationId, organizationId),
          eq(pharmacyMedicines.branchId, branch.id),
          gte(pharmacyMedicineBatches.expiryDate, from),
          lte(pharmacyMedicineBatches.expiryDate, to),
          sql`${pharmacyMedicineBatches.quantity} > 0`,
        ),
      );

    const products = rows
      .map((r) => {
        const exp = String(r.expiryDate);
        const expTime = new Date(`${exp}T12:00:00`).getTime();
        const todayTime = today.getTime();
        const dayMs = 86400000;
        const daysOverdue = expTime < todayTime ? Math.floor((todayTime - expTime) / dayMs) : 0;
        const daysUntilExpiry = expTime >= todayTime ? Math.floor((expTime - todayTime) / dayMs) : 0;
        const status = daysOverdue > 0 ? ("expired" as const) : ("expiring_soon" as const);
        const estimatedLossPkr = r.purchasePricePkr * r.quantity;
        return {
          id: r.id,
          medicineName: r.medicineName,
          sku: r.sku,
          presentation: r.presentation,
          category: r.category,
          batchNumber: r.batchNumber,
          expiryDate: exp,
          quantity: r.quantity,
          daysOverdue,
          daysUntilExpiry,
          status,
          estimatedLossPkr,
        };
      })
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === "expired" ? -1 : 1;
        return b.daysOverdue - a.daysOverdue || a.daysUntilExpiry - b.daysUntilExpiry;
      });

    const expiredCount = products.filter((p) => p.status === "expired").length;
    const expiringSoonCount = products.filter((p) => p.status === "expiring_soon").length;
    const periodLabel = `${from} – ${to}`;

    return {
      periodLabel,
      from,
      to,
      totalBatches: products.length,
      totalUnits: products.reduce((sum, p) => sum + p.quantity, 0),
      expiredCount,
      expiringSoonCount,
      estimatedLossPkr: products.reduce((sum, p) => sum + p.estimatedLossPkr, 0),
      products,
    };
  }

  async getMedicineBatches(organizationId: string, branchCode: string, medicineId: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const [med] = await this.db
      .select()
      .from(pharmacyMedicines)
      .where(
        and(
          eq(pharmacyMedicines.id, medicineId),
          eq(pharmacyMedicines.organizationId, organizationId),
          eq(pharmacyMedicines.branchId, branch.id),
        ),
      )
      .limit(1);
    if (!med) throw new NotFoundException("Medicine not found");

    const rows = await this.db
      .select()
      .from(pharmacyMedicineBatches)
      .where(and(eq(pharmacyMedicineBatches.medicineId, medicineId), sql`${pharmacyMedicineBatches.quantity} > 0`))
      .orderBy(asc(pharmacyMedicineBatches.expiryDate));

    return rows.map((r) => ({
      id: r.id,
      medicineId: r.medicineId,
      medicineName: med.name,
      batchNumber: r.batchNumber,
      manufacturingDate: r.manufacturingDate ? String(r.manufacturingDate) : null,
      expiryDate: String(r.expiryDate),
      quantity: r.quantity,
    }));
  }

  async lookupBarcode(organizationId: string, branchCode: string, barcode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const code = barcode.trim();
    if (!code) throw new BadRequestException("barcode is required");
    const [med] = await this.db
      .select()
      .from(pharmacyMedicines)
      .where(
        and(
          eq(pharmacyMedicines.organizationId, organizationId),
          eq(pharmacyMedicines.branchId, branch.id),
          eq(pharmacyMedicines.barcode, code),
        ),
      )
      .limit(1);
    if (!med) throw new NotFoundException("No medicine found for this barcode");
    const list = await this.listMedicines(organizationId, branchCode);
    return list.find((m) => m.id === med.id)!;
  }

  async findAlternatives(organizationId: string, branchCode: string, medicineId: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const [med] = await this.db
      .select()
      .from(pharmacyMedicines)
      .where(
        and(
          eq(pharmacyMedicines.id, medicineId),
          eq(pharmacyMedicines.organizationId, organizationId),
          eq(pharmacyMedicines.branchId, branch.id),
        ),
      )
      .limit(1);
    if (!med) throw new NotFoundException("Medicine not found");
    if (!med.genericName) return [];

    const rows = await this.db
      .select()
      .from(pharmacyMedicines)
      .where(
        and(
          eq(pharmacyMedicines.organizationId, organizationId),
          eq(pharmacyMedicines.branchId, branch.id),
          eq(pharmacyMedicines.genericName, med.genericName),
          ne(pharmacyMedicines.id, medicineId),
          sql`${pharmacyMedicines.currentStock} > 0`,
        ),
      )
      .orderBy(pharmacyMedicines.name);

    return rows
      .filter((r) => !med.dosageStrength || r.dosageStrength === med.dosageStrength)
      .map((r) => ({
        id: r.id,
        name: r.name,
        brandName: r.brandName,
        genericName: r.genericName,
        dosageStrength: r.dosageStrength,
        currentStock: r.currentStock,
        sellingPrice: r.sellingPricePkr,
      }));
  }

  async updatePatient(organizationId: string, patientId: string, input: UpdatePatient) {
    const [existing] = await this.db
      .select()
      .from(pharmacyPatients)
      .where(and(eq(pharmacyPatients.id, patientId), eq(pharmacyPatients.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Patient not found");

    const [row] = await this.db
      .update(pharmacyPatients)
      .set({
        name: input.name?.trim() ?? existing.name,
        phone: input.phone !== undefined ? input.phone.trim() || null : existing.phone,
        email: input.email !== undefined ? input.email.trim() || null : existing.email,
        address: input.address !== undefined ? input.address.trim() || null : existing.address,
        dateOfBirth: input.dateOfBirth !== undefined ? input.dateOfBirth || null : existing.dateOfBirth,
        allergiesJson: input.allergies ? stringifyJsonArray(input.allergies) : existing.allergiesJson,
        medicalConditionsJson: input.medicalConditions
          ? stringifyJsonArray(input.medicalConditions)
          : existing.medicalConditionsJson,
        chronicDiseasesJson: input.chronicDiseases
          ? stringifyJsonArray(input.chronicDiseases)
          : existing.chronicDiseasesJson,
        creditLimitPkr: input.creditLimitPkr !== undefined ? Math.round(input.creditLimitPkr) : existing.creditLimitPkr,
        creditDueDate: input.creditDueDate !== undefined ? input.creditDueDate || null : existing.creditDueDate,
        refillReminderEnabled:
          input.refillReminderEnabled !== undefined ? input.refillReminderEnabled : existing.refillReminderEnabled,
        refillReminderChannel:
          input.refillReminderChannel !== undefined ? input.refillReminderChannel : existing.refillReminderChannel,
      })
      .where(eq(pharmacyPatients.id, patientId))
      .returning();
    if (!row) throw new BadRequestException("Failed to update patient");
    const [branchRow] = await this.db.select().from(popsBranches).where(eq(popsBranches.id, existing.branchId)).limit(1);
    if (!branchRow) throw new NotFoundException("Branch not found");
    return this.listPatients(organizationId, branchRow.code).then((list) => list.find((p) => p.id === patientId)!);
  }

  async getPatientHistory(organizationId: string, patientId: string) {
    const [patient] = await this.db
      .select()
      .from(pharmacyPatients)
      .where(and(eq(pharmacyPatients.id, patientId), eq(pharmacyPatients.organizationId, organizationId)))
      .limit(1);
    if (!patient) throw new NotFoundException("Patient not found");

    const [branchRow] = await this.db.select().from(popsBranches).where(eq(popsBranches.id, patient.branchId)).limit(1);
    if (!branchRow) throw new NotFoundException("Branch not found");

    const patientDto = await this.listPatients(organizationId, branchRow.code).then((list) =>
      list.find((p) => p.id === patientId),
    );
    if (!patientDto) throw new NotFoundException("Patient not found");

    const sales = await this.db
      .select({
        id: pharmacySales.id,
        invoiceNumber: pharmacySales.invoiceNumber,
        totalPkr: pharmacySales.totalPkr,
        createdAt: pharmacySales.createdAt,
      })
      .from(pharmacySales)
      .where(and(eq(pharmacySales.patientId, patientId), eq(pharmacySales.organizationId, organizationId)))
      .orderBy(desc(pharmacySales.createdAt))
      .limit(50);

    const saleIds = sales.map((s) => s.id);
    const lineRows =
      saleIds.length > 0
        ? await this.db
            .select({
              saleId: pharmacySaleLines.saleId,
              medicineName: pharmacyMedicines.name,
            })
            .from(pharmacySaleLines)
            .innerJoin(pharmacyMedicines, eq(pharmacyMedicines.id, pharmacySaleLines.medicineId))
            .where(inArray(pharmacySaleLines.saleId, saleIds))
        : [];

    const medsBySale = new Map<string, string[]>();
    for (const row of lineRows) {
      const list = medsBySale.get(row.saleId) ?? [];
      list.push(row.medicineName);
      medsBySale.set(row.saleId, list);
    }

    return {
      patient: patientDto,
      sales: sales.map((s) => ({
        saleId: s.id,
        invoiceNumber: s.invoiceNumber,
        total: s.totalPkr,
        createdAt: s.createdAt.toISOString(),
        medicines: medsBySale.get(s.id) ?? [],
      })),
    };
  }

  async getKhataStatement(organizationId: string, patientId: string) {
    const [patient] = await this.db
      .select()
      .from(pharmacyPatients)
      .where(and(eq(pharmacyPatients.id, patientId), eq(pharmacyPatients.organizationId, organizationId)))
      .limit(1);
    if (!patient) throw new NotFoundException("Patient not found");

    const entries = await this.db
      .select({
        id: pharmacyKhataEntries.id,
        type: pharmacyKhataEntries.type,
        amountPkr: pharmacyKhataEntries.amountPkr,
        balanceAfterPkr: pharmacyKhataEntries.balanceAfterPkr,
        notes: pharmacyKhataEntries.notes,
        createdAt: pharmacyKhataEntries.createdAt,
        invoiceNumber: pharmacySales.invoiceNumber,
      })
      .from(pharmacyKhataEntries)
      .leftJoin(pharmacySales, eq(pharmacySales.id, pharmacyKhataEntries.saleId))
      .where(eq(pharmacyKhataEntries.patientId, patientId))
      .orderBy(desc(pharmacyKhataEntries.createdAt));

    return {
      patientId: patient.id,
      patientName: patient.name,
      outstandingPkr: patient.outstandingPkr,
      creditLimitPkr: patient.creditLimitPkr,
      creditDueDate: patient.creditDueDate ? String(patient.creditDueDate) : null,
      entries: entries.map((e) => ({
        id: e.id,
        type: e.type as "sale" | "payment" | "adjustment",
        amountPkr: e.amountPkr,
        balanceAfterPkr: e.balanceAfterPkr,
        notes: e.notes,
        invoiceNumber: e.invoiceNumber,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  async recordKhataPayment(organizationId: string, patientId: string, input: RecordKhataPayment) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [patient] = await this.db
      .select()
      .from(pharmacyPatients)
      .where(
        and(
          eq(pharmacyPatients.id, patientId),
          eq(pharmacyPatients.organizationId, organizationId),
          eq(pharmacyPatients.branchId, branch.id),
        ),
      )
      .limit(1);
    if (!patient) throw new NotFoundException("Patient not found");
    const amount = Math.round(input.amountPkr);
    if (amount <= 0) throw new BadRequestException("Payment amount must be positive");
    if (amount > patient.outstandingPkr) throw new BadRequestException("Payment exceeds outstanding balance");

    const newBalance = patient.outstandingPkr - amount;
    await this.db.update(pharmacyPatients).set({ outstandingPkr: newBalance }).where(eq(pharmacyPatients.id, patientId));
    await this.db.insert(pharmacyKhataEntries).values({
      organizationId,
      branchId: branch.id,
      patientId,
      type: "payment",
      amountPkr: -amount,
      balanceAfterPkr: newBalance,
      notes: input.notes?.trim() || "Partial payment received",
    });

    return this.getKhataStatement(organizationId, patientId);
  }

  async listShifts(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select()
      .from(pharmacyShifts)
      .where(and(eq(pharmacyShifts.organizationId, organizationId), eq(pharmacyShifts.branchId, branch.id)))
      .orderBy(desc(pharmacyShifts.openedAt))
      .limit(50);
    return rows.map((s) => ({
      id: s.id,
      cashierName: s.cashierName,
      openingCashPkr: s.openingCashPkr,
      closingCashPkr: s.closingCashPkr,
      expectedCashPkr: s.expectedCashPkr,
      cashDifferencePkr: s.cashDifferencePkr,
      totalSalesPkr: s.totalSalesPkr,
      transactionCount: s.transactionCount,
      status: s.status as "open" | "closed",
      openedAt: s.openedAt.toISOString(),
      closedAt: s.closedAt?.toISOString() ?? null,
    }));
  }

  async getOpenShift(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const [shift] = await this.db
      .select()
      .from(pharmacyShifts)
      .where(
        and(
          eq(pharmacyShifts.organizationId, organizationId),
          eq(pharmacyShifts.branchId, branch.id),
          eq(pharmacyShifts.status, "open"),
        ),
      )
      .orderBy(desc(pharmacyShifts.openedAt))
      .limit(1);
    if (!shift) return null;
    return {
      id: shift.id,
      cashierName: shift.cashierName,
      openingCashPkr: shift.openingCashPkr,
      closingCashPkr: shift.closingCashPkr,
      expectedCashPkr: shift.expectedCashPkr,
      cashDifferencePkr: shift.cashDifferencePkr,
      totalSalesPkr: shift.totalSalesPkr,
      transactionCount: shift.transactionCount,
      status: shift.status as "open" | "closed",
      openedAt: shift.openedAt.toISOString(),
      closedAt: shift.closedAt?.toISOString() ?? null,
    };
  }

  async openShift(organizationId: string, input: OpenPharmacyShift) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const existing = await this.getOpenShift(organizationId, input.branchCode);
    if (existing) throw new BadRequestException("A shift is already open");

    const [shift] = await this.db
      .insert(pharmacyShifts)
      .values({
        organizationId,
        branchId: branch.id,
        cashierName: input.cashierName.trim(),
        openingCashPkr: Math.round(input.openingCashPkr ?? 0),
        status: "open",
      })
      .returning();
    if (!shift) throw new BadRequestException("Failed to open shift");
    return this.getOpenShift(organizationId, input.branchCode);
  }

  async closeShift(organizationId: string, shiftId: string, input: ClosePharmacyShift) {
    const [shift] = await this.db
      .select()
      .from(pharmacyShifts)
      .where(and(eq(pharmacyShifts.id, shiftId), eq(pharmacyShifts.organizationId, organizationId)))
      .limit(1);
    if (!shift) throw new NotFoundException("Shift not found");
    if (shift.status === "closed") throw new BadRequestException("Shift already closed");

    const cashSales = await this.db
      .select({ total: sql<number>`coalesce(sum(${pharmacySales.amountPaidPkr}), 0)` })
      .from(pharmacySales)
      .where(and(eq(pharmacySales.shiftId, shiftId), eq(pharmacySales.paymentMethod, "Cash")));

    const expectedCash = shift.openingCashPkr + Number(cashSales[0]?.total ?? 0);
    const closingCash = Math.round(input.closingCashPkr);
    const difference = closingCash - expectedCash;

    await this.db
      .update(pharmacyShifts)
      .set({
        status: "closed",
        closingCashPkr: closingCash,
        expectedCashPkr: expectedCash,
        cashDifferencePkr: difference,
        closedAt: new Date(),
      })
      .where(eq(pharmacyShifts.id, shiftId));

    const [branchRow] = await this.db.select().from(popsBranches).where(eq(popsBranches.id, shift.branchId)).limit(1);
    const list = await this.listShifts(organizationId, branchRow?.code ?? "");
    return list.find((s) => s.id === shiftId)!;
  }

  async listControlledDrugLogs(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select({
        id: pharmacyControlledDrugLogs.id,
        medicineName: pharmacyMedicines.name,
        patientName: pharmacyPatients.name,
        prescriptionNumber: pharmacyPrescriptions.prescriptionNumber,
        qty: pharmacyControlledDrugLogs.qty,
        approvedByUserId: pharmacyControlledDrugLogs.approvedByUserId,
        createdAt: pharmacyControlledDrugLogs.createdAt,
      })
      .from(pharmacyControlledDrugLogs)
      .innerJoin(pharmacyMedicines, eq(pharmacyMedicines.id, pharmacyControlledDrugLogs.medicineId))
      .leftJoin(pharmacyPatients, eq(pharmacyPatients.id, pharmacyControlledDrugLogs.patientId))
      .leftJoin(pharmacyPrescriptions, eq(pharmacyPrescriptions.id, pharmacyControlledDrugLogs.prescriptionId))
      .where(
        and(
          eq(pharmacyControlledDrugLogs.organizationId, organizationId),
          eq(pharmacyControlledDrugLogs.branchId, branch.id),
        ),
      )
      .orderBy(desc(pharmacyControlledDrugLogs.createdAt))
      .limit(200);

    const out = [];
    for (const row of rows) {
      let approvedByName: string | null = null;
      if (row.approvedByUserId) {
        const [user] = await this.db.select().from(users).where(eq(users.id, row.approvedByUserId)).limit(1);
        approvedByName = user?.email ?? null;
      }
      out.push({
        id: row.id,
        medicineName: row.medicineName,
        patientName: row.patientName,
        prescriptionNumber: row.prescriptionNumber,
        qty: row.qty,
        approvedByName,
        createdAt: row.createdAt.toISOString(),
      });
    }
    return out;
  }

  async listRefillReminders(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const rows = await this.db
      .select({
        id: pharmacyRefillReminders.id,
        patientName: pharmacyPatients.name,
        medicineName: pharmacyMedicines.name,
        refillDueDate: pharmacyRefillReminders.refillDueDate,
        channel: pharmacyRefillReminders.channel,
        status: pharmacyRefillReminders.status,
        sentAt: pharmacyRefillReminders.sentAt,
      })
      .from(pharmacyRefillReminders)
      .innerJoin(pharmacyPatients, eq(pharmacyPatients.id, pharmacyRefillReminders.patientId))
      .innerJoin(pharmacyMedicines, eq(pharmacyMedicines.id, pharmacyRefillReminders.medicineId))
      .where(
        and(
          eq(pharmacyRefillReminders.organizationId, organizationId),
          eq(pharmacyRefillReminders.branchId, branch.id),
        ),
      )
      .orderBy(asc(pharmacyRefillReminders.refillDueDate))
      .limit(200);

    return rows.map((r) => ({
      id: r.id,
      patientName: r.patientName,
      medicineName: r.medicineName,
      refillDueDate: String(r.refillDueDate),
      channel: r.channel as "sms" | "email" | "whatsapp",
      status: r.status as "pending" | "sent" | "skipped",
      sentAt: r.sentAt?.toISOString() ?? null,
    }));
  }

  async markRefillReminderSent(organizationId: string, reminderId: string) {
    const [row] = await this.db
      .select()
      .from(pharmacyRefillReminders)
      .where(and(eq(pharmacyRefillReminders.id, reminderId), eq(pharmacyRefillReminders.organizationId, organizationId)))
      .limit(1);
    if (!row) throw new NotFoundException("Reminder not found");
    await this.db
      .update(pharmacyRefillReminders)
      .set({ status: "sent", sentAt: new Date() })
      .where(eq(pharmacyRefillReminders.id, reminderId));
    return { ok: true };
  }

  async getTaxComplianceReport(organizationId: string, branchCode: string, fromIso?: string, toIso?: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const now = new Date();
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
    defaultFrom.setHours(0, 0, 0, 0);
    const from = fromIso ? new Date(fromIso) : defaultFrom;
    const to = toIso ? new Date(toIso) : now;

    const sales = await this.db
      .select()
      .from(pharmacySales)
      .where(
        and(
          eq(pharmacySales.organizationId, organizationId),
          eq(pharmacySales.branchId, branch.id),
          gte(pharmacySales.createdAt, from),
          lte(pharmacySales.createdAt, to),
        ),
      );

    const totalSales = sales.reduce((sum, s) => sum + s.totalPkr, 0);
    const taxCollected = sales.reduce((sum, s) => sum + s.taxPkr, 0);
    const taxableSales = sales.filter((s) => s.taxPkr > 0).reduce((sum, s) => sum + s.totalPkr, 0);
    const taxExemptSales = totalSales - taxableSales;

    return {
      periodLabel: `${from.toLocaleDateString("en-PK")} – ${to.toLocaleDateString("en-PK")}`,
      from: from.toISOString(),
      to: to.toISOString(),
      totalSales,
      taxableSales,
      taxCollected,
      taxExemptSales,
      invoiceCount: sales.length,
      fbrCompliant: true,
      summary: [
        { label: "Gross sales", amount: totalSales },
        { label: "Taxable sales", amount: taxableSales },
        { label: "Tax exempt sales", amount: taxExemptSales },
        { label: "GST/VAT collected", amount: taxCollected },
      ],
    };
  }

  async listReorderSuggestions(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    const medicines = await this.db
      .select()
      .from(pharmacyMedicines)
      .where(and(eq(pharmacyMedicines.organizationId, organizationId), eq(pharmacyMedicines.branchId, branch.id)));

    return medicines
      .filter((m) => m.currentStock <= m.reorderLevel)
      .map((m) => ({
        medicineId: m.id,
        medicineName: m.name,
        currentStock: m.currentStock,
        reorderLevel: m.reorderLevel,
        suggestedReorderQty: m.suggestedReorderQty || m.reorderLevel * 2,
        location: formatMedicineLocation(m),
      }))
      .sort((a, b) => a.currentStock - b.currentStock);
  }

  async getPrescriptionAttachment(organizationId: string, prescriptionId: string) {
    const [rx] = await this.db
      .select()
      .from(pharmacyPrescriptions)
      .where(and(eq(pharmacyPrescriptions.id, prescriptionId), eq(pharmacyPrescriptions.organizationId, organizationId)))
      .limit(1);
    if (!rx) throw new NotFoundException("Prescription not found");
    if (!rx.attachmentJson) throw new NotFoundException("No attachment on this prescription");
    const attachment = JSON.parse(rx.attachmentJson) as { name?: string; dataUrl?: string };
    if (!attachment.dataUrl) throw new NotFoundException("Attachment file missing");
    return { name: attachment.name ?? "prescription", dataUrl: attachment.dataUrl };
  }
}
