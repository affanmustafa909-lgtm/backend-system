import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  createFactoryDailySheetSchema,
  createFactoryInwardChallanSchema,
  createFactoryItemSchema,
  createFactoryJobBillSchema,
  createFactoryLedgerEntrySchema,
  createFactoryOperatorAdvanceSchema,
  createFactoryOperatorSchema,
  createFactoryOutwardChallanSchema,
  createFactoryPackingRecordSchema,
  createFactoryPartySchema,
  createFactoryPrintJobSchema,
  createFactoryPrinterProfileSchema,
  createFactoryExtraRecordSchema,
  factoryDesignAiAnalyzeSchema,
  factoryExtraModuleKindSchema,
  factoryStockTxnSchema,
  type CreateFactoryDailySheet,
  type CreateFactoryInwardChallan,
  type CreateFactoryItem,
  type CreateFactoryJobBill,
  type CreateFactoryLedgerEntry,
  type CreateFactoryOperator,
  type CreateFactoryOperatorAdvance,
  type CreateFactoryOutwardChallan,
  type CreateFactoryPackingRecord,
  type CreateFactoryParty,
  type CreateFactoryPrintJob,
  type CreateFactoryPrinterProfile,
  type CreateFactoryExtraRecord,
  type FactoryDesignAiAnalyze,
  type FactoryExtraModuleKind,
  type FactoryStockTxn,
} from "@platform/contracts";
import {
  factoryDailySheetLines,
  factoryDailySheets,
  factoryInwardChallanLines,
  factoryInwardChallans,
  factoryItems,
  factoryJobBills,
  factoryLedgerEntries,
  factoryOperatorAdvances,
  factoryOperators,
  factoryOutwardChallanLines,
  factoryOutwardChallans,
  factoryPackingRecords,
  factoryParties,
  factoryPrintJobs,
  factoryPrinterProfiles,
  factoryStockBalances,
  factoryStockLedger,
  factoryAttendance,
  factoryBrokerMasters,
  factoryDefectReturns,
  factoryEwayRecords,
  factoryExpenses,
  factoryHandworkIssues,
  factoryHandworkReturns,
  factoryJobOut,
  factoryLeave,
  factoryMaintenanceLogs,
  factoryPurchaseOrders,
  factoryPurchaseReceipts,
  factorySalarySlips,
  factoryStitchRates,
  factoryThreadConsumption,
  type PlatformPgDb,
} from "@platform/database-pg";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { DRIZZLE } from "../drizzle/drizzle.tokens";

function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : String(d);
}

function todayDateText(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

@Injectable()
export class FactoryService {
  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  private async nextSeq(
    organizationId: string,
    prefix: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    codeColumn: any,
  ): Promise<string> {
    const pattern = `${prefix}-%`;
    const [row] = await this.db
      .select({
        maxSeq: sql<number>`coalesce(max(nullif(regexp_replace(${codeColumn}, '^.*-', ''), '')::bigint), 0)`,
      })
      .from(table)
      .where(and(eq(table.organizationId, organizationId), sql`${codeColumn} like ${pattern}`));
    const seq = Number(row?.maxSeq ?? 0) + 1;
    return `${prefix}-${String(seq).padStart(4, "0")}`;
  }

  /** Stable human-readable refs for extra modules (avoid nextSeq on free-text columns). */
  private extraDocRef(prefix: string): string {
    return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
  }

  private async postFactoryStockDeltaInTx(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
    organizationId: string,
    branchId: string,
    itemId: string,
    qtyDelta: number,
    refType: string,
    refId: string,
    notes?: string | null,
  ) {
    const [item] = await tx
      .select()
      .from(factoryItems)
      .where(and(eq(factoryItems.id, itemId), eq(factoryItems.organizationId, organizationId)))
      .limit(1);
    if (!item) throw new NotFoundException("Item not found");
    if (item.branchId !== branchId) throw new BadRequestException("Item branch mismatch");

    await tx.insert(factoryStockLedger).values({
      organizationId,
      branchId,
      itemId,
      txnType: "issue",
      qtyDelta: String(qtyDelta),
      refType,
      refId,
      notes: notes ?? null,
    });
    await tx
      .insert(factoryStockBalances)
      .values({
        organizationId,
        branchId,
        itemId,
        qtyOnHand: String(qtyDelta),
      })
      .onConflictDoUpdate({
        target: [
          factoryStockBalances.organizationId,
          factoryStockBalances.branchId,
          factoryStockBalances.itemId,
        ],
        set: {
          qtyOnHand: sql`${factoryStockBalances.qtyOnHand} + ${String(qtyDelta)}`,
          updatedAt: new Date(),
        },
      });
  }

  // ── Parties ────────────────────────────────────────────

  async listParties(organizationId: string, branchId?: string, kind?: string) {
    const conds = [eq(factoryParties.organizationId, organizationId)];
    if (branchId) conds.push(eq(factoryParties.branchId, branchId));
    if (kind) conds.push(eq(factoryParties.kind, kind));
    const rows = await this.db
      .select()
      .from(factoryParties)
      .where(and(...conds))
      .orderBy(desc(factoryParties.createdAt));
    return rows.map((r) => this.mapParty(r));
  }

  async createParty(organizationId: string, input: CreateFactoryParty) {
    const data = createFactoryPartySchema.parse(input);
    const code = data.code?.trim() || (await this.nextSeq(organizationId, "PAR", factoryParties, factoryParties.code));
    const [row] = await this.db
      .insert(factoryParties)
      .values({
        organizationId,
        branchId: data.branchId ?? null,
        kind: data.kind,
        code,
        name: data.name,
        phone: data.phone ?? null,
        address: data.address ?? null,
        notes: data.notes ?? null,
        gstin: data.gstin ?? null,
        ntnCnic: data.ntnCnic ?? null,
        whatsapp: data.whatsapp ?? null,
        city: data.city ?? null,
        billingAddress: data.billingAddress ?? null,
        shippingAddress: data.shippingAddress ?? null,
        contactPersons: data.contactPersons ?? null,
        paymentTerms: data.paymentTerms ?? null,
        creditLimitPkr: data.creditLimitPkr,
        openingBalancePkr: data.openingBalancePkr,
        rateType: data.rateType,
        defaultStitchRatePkr: data.defaultStitchRatePkr,
        industrySegment: data.industrySegment ?? null,
        bankDetails: data.bankDetails ?? null,
        detailsJson: data.detailsJson ?? null,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create party");
    return this.mapParty(row);
  }

  // ── Items & stock ──────────────────────────────────────

  async listItems(organizationId: string, branchId: string) {
    const rows = await this.db
      .select({
        item: factoryItems,
        qtyOnHand: factoryStockBalances.qtyOnHand,
      })
      .from(factoryItems)
      .leftJoin(
        factoryStockBalances,
        and(
          eq(factoryStockBalances.itemId, factoryItems.id),
          eq(factoryStockBalances.branchId, branchId),
          eq(factoryStockBalances.organizationId, organizationId),
        ),
      )
      .where(and(eq(factoryItems.organizationId, organizationId), eq(factoryItems.branchId, branchId)))
      .orderBy(desc(factoryItems.createdAt));
    return rows.map(({ item, qtyOnHand }) => this.mapItem(item, qtyOnHand));
  }

  async createItem(organizationId: string, input: CreateFactoryItem) {
    const data = createFactoryItemSchema.parse(input);
    const sku = data.sku?.trim() || (await this.nextSeq(organizationId, "ITM", factoryItems, factoryItems.sku));
     return await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(factoryItems)
        .values({
          organizationId,
          branchId: data.branchId,
          sku,
          name: data.name,
          category: data.category,
          unit: data.unit,
          reorderLevel: data.reorderLevel,
          unitCostPkr: data.unitCostPkr,
          notes: data.notes ?? null,
          brand: data.brand ?? null,
          colour: data.colour ?? null,
          sizeLabel: data.sizeLabel ?? null,
          location: data.location ?? null,
          supplierPartyId: data.supplierPartyId ?? null,
          batchLot: data.batchLot ?? null,
          detailsJson: data.detailsJson ?? null,
        })
        .returning();
      if (!row) throw new BadRequestException("Failed to create item");
      await tx.insert(factoryStockBalances).values({
        organizationId,
        branchId: data.branchId,
        itemId: row.id,
        qtyOnHand: "0",
      });
      return this.mapItem(row, "0");
    });
  }

  async postStockTxn(organizationId: string, input: FactoryStockTxn) {
    const data = factoryStockTxnSchema.parse(input);
    const [item] = await this.db
      .select()
      .from(factoryItems)
      .where(and(eq(factoryItems.id, data.itemId), eq(factoryItems.organizationId, organizationId)))
      .limit(1);
    if (!item) throw new NotFoundException("Item not found");
    if (item.branchId !== data.branchId) throw new BadRequestException("Item branch mismatch");

    await this.db.transaction(async (tx) => {
      await tx.insert(factoryStockLedger).values({
        organizationId,
        branchId: data.branchId,
        itemId: data.itemId,
        txnType: data.txnType,
        qtyDelta: String(data.qtyDelta),
        refType: data.refType ?? null,
        refId: data.refId ?? null,
        notes: data.notes ?? null,
      });
      await tx
        .insert(factoryStockBalances)
        .values({
          organizationId,
          branchId: data.branchId,
          itemId: data.itemId,
          qtyOnHand: String(data.qtyDelta),
        })
        .onConflictDoUpdate({
          target: [
            factoryStockBalances.organizationId,
            factoryStockBalances.branchId,
            factoryStockBalances.itemId,
          ],
          set: {
            qtyOnHand: sql`${factoryStockBalances.qtyOnHand} + ${String(data.qtyDelta)}`,
            updatedAt: new Date(),
          },
        });
    });

    const [bal] = await this.db
      .select()
      .from(factoryStockBalances)
      .where(
        and(
          eq(factoryStockBalances.organizationId, organizationId),
          eq(factoryStockBalances.branchId, data.branchId),
          eq(factoryStockBalances.itemId, data.itemId),
        ),
      )
      .limit(1);
    return {
      itemId: data.itemId,
      branchId: data.branchId,
      txnType: data.txnType,
      qtyDelta: data.qtyDelta,
      qtyOnHand: Number(bal?.qtyOnHand ?? 0),
    };
  }

  // ── Inward challans ────────────────────────────────────

  async listInwardChallans(organizationId: string, branchId?: string) {
    const conds = [eq(factoryInwardChallans.organizationId, organizationId)];
    if (branchId) conds.push(eq(factoryInwardChallans.branchId, branchId));
    const headers = await this.db
      .select({
        challan: factoryInwardChallans,
        partyName: factoryParties.name,
      })
      .from(factoryInwardChallans)
      .innerJoin(factoryParties, eq(factoryParties.id, factoryInwardChallans.partyId))
      .where(and(...conds))
      .orderBy(desc(factoryInwardChallans.createdAt));
    if (!headers.length) return [];
    const ids = headers.map((h) => h.challan.id);
    const lineRows = await this.db
      .select()
      .from(factoryInwardChallanLines)
      .where(inArray(factoryInwardChallanLines.challanId, ids));
    const byChallan = new Map<string, typeof lineRows>();
    for (const l of lineRows) {
      const arr = byChallan.get(l.challanId) ?? [];
      arr.push(l);
      byChallan.set(l.challanId, arr);
    }
    return headers.map(({ challan, partyName }) =>
      this.mapInwardChallan(challan, partyName, byChallan.get(challan.id) ?? []),
    );
  }

  async createInwardChallan(organizationId: string, input: CreateFactoryInwardChallan) {
    const data = createFactoryInwardChallanSchema.parse(input);
    const [party] = await this.db
      .select()
      .from(factoryParties)
      .where(and(eq(factoryParties.id, data.partyId), eq(factoryParties.organizationId, organizationId)))
      .limit(1);
    if (!party) throw new NotFoundException("Party not found");

    const cnNumber =
      data.cnNumber?.trim() ||
      (await this.nextSeq(organizationId, "CN-IN", factoryInwardChallans, factoryInwardChallans.cnNumber));

    const challan = await this.db.transaction(async (tx) => {
      const [head] = await tx
        .insert(factoryInwardChallans)
        .values({
          organizationId,
          branchId: data.branchId,
          cnNumber,
          partyId: data.partyId,
          challanDate: data.challanDate,
          notes: data.notes ?? null,
          partyCnNumber: data.partyCnNumber ?? null,
          vehicle: data.vehicle ?? null,
          receivedBy: data.receivedBy ?? null,
        })
        .returning();
      if (!head) throw new BadRequestException("Failed to create inward challan");
      if (data.lines.length) {
        await tx.insert(factoryInwardChallanLines).values(
          data.lines.map((l) => ({
            challanId: head.id,
            description: l.description,
            designId: l.designId ?? null,
            qty: l.qty,
            unit: l.unit,
            colour: l.colour ?? null,
            fabric: l.fabric ?? null,
            lotNumber: l.lotNumber ?? null,
            conditionNote: l.conditionNote ?? null,
          })),
        );
      }
      return head;
    });

    const lines = await this.db
      .select()
      .from(factoryInwardChallanLines)
      .where(eq(factoryInwardChallanLines.challanId, challan.id));
    return this.mapInwardChallan(challan, party.name, lines);
  }

  // ── Outward challans ───────────────────────────────────

  async listOutwardChallans(organizationId: string, branchId?: string) {
    const conds = [eq(factoryOutwardChallans.organizationId, organizationId)];
    if (branchId) conds.push(eq(factoryOutwardChallans.branchId, branchId));
    const headers = await this.db
      .select({
        challan: factoryOutwardChallans,
        partyName: factoryParties.name,
      })
      .from(factoryOutwardChallans)
      .innerJoin(factoryParties, eq(factoryParties.id, factoryOutwardChallans.partyId))
      .where(and(...conds))
      .orderBy(desc(factoryOutwardChallans.createdAt));
    if (!headers.length) return [];
    const ids = headers.map((h) => h.challan.id);
    const lineRows = await this.db
      .select()
      .from(factoryOutwardChallanLines)
      .where(inArray(factoryOutwardChallanLines.challanId, ids));
    const byChallan = new Map<string, typeof lineRows>();
    for (const l of lineRows) {
      const arr = byChallan.get(l.challanId) ?? [];
      arr.push(l);
      byChallan.set(l.challanId, arr);
    }
    return headers.map(({ challan, partyName }) =>
      this.mapOutwardChallan(challan, partyName, byChallan.get(challan.id) ?? []),
    );
  }

  async createOutwardChallan(organizationId: string, input: CreateFactoryOutwardChallan) {
    const data = createFactoryOutwardChallanSchema.parse(input);
    const [party] = await this.db
      .select()
      .from(factoryParties)
      .where(and(eq(factoryParties.id, data.partyId), eq(factoryParties.organizationId, organizationId)))
      .limit(1);
    if (!party) throw new NotFoundException("Party not found");

    const cnNumber =
      data.cnNumber?.trim() ||
      (await this.nextSeq(organizationId, "CN-OUT", factoryOutwardChallans, factoryOutwardChallans.cnNumber));

    const challan = await this.db.transaction(async (tx) => {
      const [head] = await tx
        .insert(factoryOutwardChallans)
        .values({
          organizationId,
          branchId: data.branchId,
          cnNumber,
          partyId: data.partyId,
          inwardChallanId: data.inwardChallanId ?? null,
          jobId: data.jobId ?? null,
          challanDate: data.challanDate,
          invoiceAmountPkr: data.invoiceAmountPkr,
          notes: data.notes ?? null,
          vehicle: data.vehicle ?? null,
          driverName: data.driverName ?? null,
          ewayRef: data.ewayRef ?? null,
        })
        .returning();
      if (!head) throw new BadRequestException("Failed to create outward challan");

      await tx.insert(factoryOutwardChallanLines).values(
        data.lines.map((l) => ({
          challanId: head.id,
          inwardLineId: l.inwardLineId ?? null,
          description: l.description,
          qty: l.qty,
          unit: l.unit,
        })),
      );

      for (const l of data.lines) {
        if (!l.inwardLineId) continue;
        const [inLine] = await tx
          .select({ id: factoryInwardChallanLines.id })
          .from(factoryInwardChallanLines)
          .innerJoin(factoryInwardChallans, eq(factoryInwardChallans.id, factoryInwardChallanLines.challanId))
          .where(
            and(
              eq(factoryInwardChallanLines.id, l.inwardLineId),
              eq(factoryInwardChallans.organizationId, organizationId),
            ),
          )
          .limit(1);
        if (!inLine) throw new BadRequestException(`Inward line ${l.inwardLineId} not found`);
        await tx
          .update(factoryInwardChallanLines)
          .set({ qtyDispatched: sql`${factoryInwardChallanLines.qtyDispatched} + ${l.qty}` })
          .where(eq(factoryInwardChallanLines.id, l.inwardLineId));
      }
      return head;
    });

    const lines = await this.db
      .select()
      .from(factoryOutwardChallanLines)
      .where(eq(factoryOutwardChallanLines.challanId, challan.id));
    return this.mapOutwardChallan(challan, party.name, lines);
  }

  // ── Operators ──────────────────────────────────────────

  async listOperators(organizationId: string, branchId?: string) {
    const conds = [eq(factoryOperators.organizationId, organizationId)];
    if (branchId) conds.push(eq(factoryOperators.branchId, branchId));
    const rows = await this.db
      .select()
      .from(factoryOperators)
      .where(and(...conds))
      .orderBy(desc(factoryOperators.createdAt));
    return rows.map((r) => this.mapOperator(r));
  }

  async createOperator(organizationId: string, input: CreateFactoryOperator) {
    const data = createFactoryOperatorSchema.parse(input);
    const code =
      data.code?.trim() ||
      (await this.nextSeq(organizationId, "OPR", factoryOperators, factoryOperators.code));
    const [row] = await this.db
      .insert(factoryOperators)
      .values({
        organizationId,
        branchId: data.branchId,
        code,
        name: data.name,
        phone: data.phone ?? null,
        ratePer1kStitchesPkr: data.ratePer1kStitchesPkr,
        ratePerPiecePkr: data.ratePerPiecePkr,
        notes: data.notes ?? null,
        cnic: data.cnic ?? null,
        address: data.address ?? null,
        joinDate: data.joinDate ?? null,
        payType: data.payType,
        bankDetails: data.bankDetails ?? null,
        photoBase64: data.photoBase64 ?? null,
        detailsJson: data.detailsJson ?? null,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create operator");
    return this.mapOperator(row);
  }

  // ── Daily sheets ───────────────────────────────────────

  async listDailySheets(organizationId: string, branchId?: string) {
    const conds = [eq(factoryDailySheets.organizationId, organizationId)];
    if (branchId) conds.push(eq(factoryDailySheets.branchId, branchId));
    const sheets = await this.db
      .select()
      .from(factoryDailySheets)
      .where(and(...conds))
      .orderBy(desc(factoryDailySheets.sheetDate), desc(factoryDailySheets.createdAt));
    if (!sheets.length) return [];
    const ids = sheets.map((s) => s.id);
    const lineRows = await this.db
      .select()
      .from(factoryDailySheetLines)
      .where(inArray(factoryDailySheetLines.sheetId, ids));
    const bySheet = new Map<string, typeof lineRows>();
    for (const l of lineRows) {
      const arr = bySheet.get(l.sheetId) ?? [];
      arr.push(l);
      bySheet.set(l.sheetId, arr);
    }
    return sheets.map((s) => this.mapDailySheet(s, bySheet.get(s.id) ?? []));
  }

  async createDailySheet(organizationId: string, input: CreateFactoryDailySheet) {
    const data = createFactoryDailySheetSchema.parse(input);
    const operatorIds = [
      ...new Set(data.lines.map((l) => l.operatorId).filter((id): id is string => Boolean(id))),
    ];
    const operatorRates = new Map<
      string,
      { ratePer1kStitchesPkr: number; ratePerPiecePkr: number }
    >();
    if (operatorIds.length) {
      const ops = await this.db
        .select()
        .from(factoryOperators)
        .where(
          and(
            eq(factoryOperators.organizationId, organizationId),
            inArray(factoryOperators.id, operatorIds),
          ),
        );
      for (const o of ops) {
        operatorRates.set(o.id, {
          ratePer1kStitchesPkr: o.ratePer1kStitchesPkr,
          ratePerPiecePkr: o.ratePerPiecePkr,
        });
      }
    }

    const sheet = await this.db.transaction(async (tx) => {
      const [head] = await tx
        .insert(factoryDailySheets)
        .values({
          organizationId,
          branchId: data.branchId,
          sheetDate: data.sheetDate,
          shift: data.shift,
          notes: data.notes ?? null,
        })
        .returning();
      if (!head) throw new BadRequestException("Failed to create daily sheet");

      if (data.lines.length) {
        await tx.insert(factoryDailySheetLines).values(
          data.lines.map((l) => {
            const rates = l.operatorId ? operatorRates.get(l.operatorId) : undefined;
            const wagePkr = this.computeWagePkr(l, rates);
            return {
              sheetId: head.id,
              machineId: l.machineId ?? null,
              operatorId: l.operatorId ?? null,
              jobId: l.jobId ?? null,
              designId: l.designId ?? null,
              stitches: l.stitches,
              frames: l.frames,
              pieces: l.pieces,
              downtimeMinutes: l.downtimeMinutes,
              bonusPkr: l.bonusPkr,
              wagePkr,
              notes: l.notes ?? null,
              threadBreaks: l.threadBreaks,
              runMinutes: l.runMinutes,
              stopReason: l.stopReason ?? null,
            };
          }),
        );
      }
      return head;
    });

    const lines = await this.db
      .select()
      .from(factoryDailySheetLines)
      .where(eq(factoryDailySheetLines.sheetId, sheet.id));
    return this.mapDailySheet(sheet, lines);
  }

  private computeWagePkr(
    line: {
      stitches: number;
      pieces: number;
      bonusPkr: number;
    },
    rates?: { ratePer1kStitchesPkr: number; ratePerPiecePkr: number },
  ): number {
    const r1k = rates?.ratePer1kStitchesPkr ?? 0;
    const rPiece = rates?.ratePerPiecePkr ?? 0;
    const stitchPart = Math.round((line.stitches / 1000) * r1k);
    const piecePart = line.pieces * rPiece;
    return stitchPart + piecePart + line.bonusPkr;
  }

  // ── Job bills & ledger ─────────────────────────────────

  async listJobBills(organizationId: string, branchId?: string) {
    const conds = [eq(factoryJobBills.organizationId, organizationId)];
    if (branchId) conds.push(eq(factoryJobBills.branchId, branchId));
    const rows = await this.db
      .select({
        bill: factoryJobBills,
        partyName: factoryParties.name,
      })
      .from(factoryJobBills)
      .innerJoin(factoryParties, eq(factoryParties.id, factoryJobBills.partyId))
      .where(and(...conds))
      .orderBy(desc(factoryJobBills.createdAt));
    return rows.map(({ bill, partyName }) => this.mapJobBill(bill, partyName));
  }

  async createJobBill(organizationId: string, input: CreateFactoryJobBill) {
    const data = createFactoryJobBillSchema.parse(input);
    const [party] = await this.db
      .select()
      .from(factoryParties)
      .where(and(eq(factoryParties.id, data.partyId), eq(factoryParties.organizationId, organizationId)))
      .limit(1);
    if (!party) throw new NotFoundException("Party not found");

    const billNumber =
      data.billNumber?.trim() ||
      (await this.nextSeq(organizationId, "JB", factoryJobBills, factoryJobBills.billNumber));

    const bill = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(factoryJobBills)
        .values({
          organizationId,
          branchId: data.branchId,
          billNumber,
          partyId: data.partyId,
          outwardChallanId: data.outwardChallanId ?? null,
          billDate: data.billDate,
          amountPkr: data.amountPkr,
          taxPkr: data.taxPkr,
          defectDeductionPkr: data.defectDeductionPkr,
          discountPkr: data.discountPkr,
          notes: data.notes ?? null,
        })
        .returning();
      if (!row) throw new BadRequestException("Failed to create job bill");

      const net =
        Math.max(0, data.amountPkr + data.taxPkr - data.defectDeductionPkr - data.discountPkr);
      await tx.insert(factoryLedgerEntries).values({
        organizationId,
        branchId: data.branchId,
        entryDate: data.billDate,
        accountKind: "party",
        partyId: data.partyId,
        debitPkr: net,
        creditPkr: 0,
        refType: "job_bill",
        refId: row.id,
        narration: data.notes ?? `Job bill ${billNumber}`,
      });
      return row;
    });

    return this.mapJobBill(bill, party.name);
  }

  async listLedger(organizationId: string, branchId?: string, accountKind?: string) {
    const conds = [eq(factoryLedgerEntries.organizationId, organizationId)];
    if (branchId) conds.push(eq(factoryLedgerEntries.branchId, branchId));
    if (accountKind) conds.push(eq(factoryLedgerEntries.accountKind, accountKind));
    const rows = await this.db
      .select({
        entry: factoryLedgerEntries,
        partyName: factoryParties.name,
      })
      .from(factoryLedgerEntries)
      .leftJoin(factoryParties, eq(factoryParties.id, factoryLedgerEntries.partyId))
      .where(and(...conds))
      .orderBy(desc(factoryLedgerEntries.entryDate), desc(factoryLedgerEntries.createdAt));
    return rows.map(({ entry, partyName }) => this.mapLedgerEntry(entry, partyName));
  }

  async createLedgerEntry(organizationId: string, input: CreateFactoryLedgerEntry) {
    const data = createFactoryLedgerEntrySchema.parse(input);
    if (data.accountKind === "party" && !data.partyId) {
      throw new BadRequestException("partyId required for party ledger entry");
    }
    const [row] = await this.db
      .insert(factoryLedgerEntries)
      .values({
        organizationId,
        branchId: data.branchId,
        entryDate: data.entryDate,
        accountKind: data.accountKind,
        partyId: data.partyId ?? null,
        debitPkr: data.debitPkr,
        creditPkr: data.creditPkr,
        refType: data.refType ?? null,
        refId: data.refId ?? null,
        narration: data.narration ?? null,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create ledger entry");
    let partyName: string | null = null;
    if (row.partyId) {
      const [p] = await this.db.select().from(factoryParties).where(eq(factoryParties.id, row.partyId)).limit(1);
      partyName = p?.name ?? null;
    }
    return this.mapLedgerEntry(row, partyName);
  }

  // ── Operator advances ──────────────────────────────────

  async listAdvances(organizationId: string, branchId?: string) {
    const conds = [eq(factoryOperatorAdvances.organizationId, organizationId)];
    if (branchId) conds.push(eq(factoryOperatorAdvances.branchId, branchId));
    const rows = await this.db
      .select()
      .from(factoryOperatorAdvances)
      .where(and(...conds))
      .orderBy(desc(factoryOperatorAdvances.advanceDate), desc(factoryOperatorAdvances.createdAt));
    return rows.map((r) => this.mapAdvance(r));
  }

  async createAdvance(organizationId: string, input: CreateFactoryOperatorAdvance) {
    const data = createFactoryOperatorAdvanceSchema.parse(input);
    const [op] = await this.db
      .select()
      .from(factoryOperators)
      .where(and(eq(factoryOperators.id, data.operatorId), eq(factoryOperators.organizationId, organizationId)))
      .limit(1);
    if (!op) throw new NotFoundException("Operator not found");
    const [row] = await this.db
      .insert(factoryOperatorAdvances)
      .values({
        organizationId,
        branchId: data.branchId,
        operatorId: data.operatorId,
        advanceDate: data.advanceDate,
        amountPkr: data.amountPkr,
        notes: data.notes ?? null,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create advance");
    return this.mapAdvance(row);
  }

  // ── MIS ────────────────────────────────────────────────

  async misSummary(organizationId: string, branchId?: string) {
    const partyConds = [eq(factoryParties.organizationId, organizationId)];
    const itemConds = [eq(factoryItems.organizationId, organizationId)];
    const inwardConds = [
      eq(factoryInwardChallans.organizationId, organizationId),
      eq(factoryInwardChallans.status, "open"),
    ];
    const billConds = [eq(factoryJobBills.organizationId, organizationId), eq(factoryJobBills.status, "open")];
    const sheetConds = [
      eq(factoryDailySheets.organizationId, organizationId),
      eq(factoryDailySheets.sheetDate, todayDateText()),
    ];
    const ledgerConds = [
      eq(factoryLedgerEntries.organizationId, organizationId),
      eq(factoryLedgerEntries.accountKind, "party"),
    ];
    if (branchId) {
      partyConds.push(eq(factoryParties.branchId, branchId));
      itemConds.push(eq(factoryItems.branchId, branchId));
      inwardConds.push(eq(factoryInwardChallans.branchId, branchId));
      billConds.push(eq(factoryJobBills.branchId, branchId));
      sheetConds.push(eq(factoryDailySheets.branchId, branchId));
      ledgerConds.push(eq(factoryLedgerEntries.branchId, branchId));
    }

    const [[partiesRow], [itemsRow], [inwardRow], [billsRow], [stitchesRow], [receivableRow]] = await Promise.all([
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(factoryParties)
        .where(and(...partyConds)),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(factoryItems)
        .where(and(...itemConds)),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(factoryInwardChallans)
        .where(and(...inwardConds)),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(factoryJobBills)
        .where(and(...billConds)),
      this.db
        .select({
          stitches: sql<number>`coalesce(sum(${factoryDailySheetLines.stitches}), 0)::int`,
        })
        .from(factoryDailySheetLines)
        .innerJoin(factoryDailySheets, eq(factoryDailySheets.id, factoryDailySheetLines.sheetId))
        .where(and(...sheetConds)),
      this.db
        .select({
          receivable: sql<number>`coalesce(sum(${factoryLedgerEntries.debitPkr} - ${factoryLedgerEntries.creditPkr}), 0)::int`,
        })
        .from(factoryLedgerEntries)
        .where(and(...ledgerConds)),
    ]);

    return {
      parties: partiesRow?.n ?? 0,
      items: itemsRow?.n ?? 0,
      openInwardChallans: inwardRow?.n ?? 0,
      todayStitches: stitchesRow?.stitches ?? 0,
      openBills: billsRow?.n ?? 0,
      partyReceivablePkr: receivableRow?.receivable ?? 0,
    };
  }

  // ── Printers / print jobs / packing / AI ────────────────

  async listPrinters(organizationId: string, branchId?: string) {
    const conds = [eq(factoryPrinterProfiles.organizationId, organizationId)];
    if (branchId) conds.push(eq(factoryPrinterProfiles.branchId, branchId));
    const rows = await this.db
      .select()
      .from(factoryPrinterProfiles)
      .where(and(...conds))
      .orderBy(desc(factoryPrinterProfiles.createdAt));
    return rows.map((r) => ({
      id: r.id,
      branchId: r.branchId,
      name: r.name,
      printerType: r.printerType,
      paperWidthMm: r.paperWidthMm,
      copies: r.copies,
      defaultFor: r.defaultFor,
      margins: r.margins,
      active: r.active,
      createdAt: iso(r.createdAt)!,
    }));
  }

  async createPrinter(organizationId: string, input: CreateFactoryPrinterProfile) {
    const data = createFactoryPrinterProfileSchema.parse(input);
    const [row] = await this.db
      .insert(factoryPrinterProfiles)
      .values({
        organizationId,
        branchId: data.branchId,
        name: data.name,
        printerType: data.printerType,
        paperWidthMm: data.paperWidthMm,
        copies: data.copies,
        defaultFor: data.defaultFor,
        margins: data.margins ?? null,
        detailsJson: data.detailsJson ?? null,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create printer profile");
    return this.listPrinters(organizationId, data.branchId).then((list) =>
      list.find((p) => p.id === row.id),
    );
  }

  async listPrintJobs(organizationId: string, branchId?: string) {
    const conds = [eq(factoryPrintJobs.organizationId, organizationId)];
    if (branchId) conds.push(eq(factoryPrintJobs.branchId, branchId));
    const rows = await this.db
      .select()
      .from(factoryPrintJobs)
      .where(and(...conds))
      .orderBy(desc(factoryPrintJobs.createdAt));
    return rows.map((r) => ({
      id: r.id,
      jobNumber: r.jobNumber,
      partyId: r.partyId,
      designId: r.designId,
      embroideryJobId: r.embroideryJobId,
      printType: r.printType,
      sizeLabel: r.sizeLabel,
      qty: r.qty,
      printerProfileId: r.printerProfileId,
      status: r.status,
      notes: r.notes,
      createdAt: iso(r.createdAt)!,
    }));
  }

  async createPrintJob(organizationId: string, input: CreateFactoryPrintJob) {
    const data = createFactoryPrintJobSchema.parse(input);
    const jobNumber =
      data.jobNumber?.trim() ||
      `PJ-${Date.now().toString(36).toUpperCase()}`;
    const [row] = await this.db
      .insert(factoryPrintJobs)
      .values({
        organizationId,
        branchId: data.branchId,
        jobNumber,
        partyId: data.partyId ?? null,
        designId: data.designId ?? null,
        embroideryJobId: data.embroideryJobId ?? null,
        printType: data.printType,
        sizeLabel: data.sizeLabel ?? null,
        qty: data.qty,
        printerProfileId: data.printerProfileId ?? null,
        status: data.status,
        notes: data.notes ?? null,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create print job");
    return {
      id: row.id,
      jobNumber: row.jobNumber,
      printType: row.printType,
      qty: row.qty,
      status: row.status,
      createdAt: iso(row.createdAt)!,
    };
  }

  async listPacking(organizationId: string, branchId?: string) {
    const conds = [eq(factoryPackingRecords.organizationId, organizationId)];
    if (branchId) conds.push(eq(factoryPackingRecords.branchId, branchId));
    const rows = await this.db
      .select()
      .from(factoryPackingRecords)
      .where(and(...conds))
      .orderBy(desc(factoryPackingRecords.createdAt));
    return rows.map((r) => ({
      id: r.id,
      jobId: r.jobId,
      cartonNumber: r.cartonNumber,
      pieces: r.pieces,
      weightKg: Number(r.weightKg),
      labels: r.labels,
      sealNumber: r.sealNumber,
      notes: r.notes,
      createdAt: iso(r.createdAt)!,
    }));
  }

  async createPacking(organizationId: string, input: CreateFactoryPackingRecord) {
    const data = createFactoryPackingRecordSchema.parse(input);
    const [row] = await this.db
      .insert(factoryPackingRecords)
      .values({
        organizationId,
        branchId: data.branchId,
        jobId: data.jobId,
        cartonNumber: data.cartonNumber,
        pieces: data.pieces,
        weightKg: String(data.weightKg),
        labels: data.labels ?? null,
        sealNumber: data.sealNumber ?? null,
        notes: data.notes ?? null,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create packing record");
    return {
      id: row.id,
      cartonNumber: row.cartonNumber,
      pieces: row.pieces,
      weightKg: Number(row.weightKg),
      createdAt: iso(row.createdAt)!,
    };
  }

  async analyzeDesignAi(_organizationId: string, input: FactoryDesignAiAnalyze) {
    const data = factoryDesignAiAnalyzeSchema.parse(input);
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    const bytesApprox = Math.floor((data.fileContentBase64.length * 3) / 4);
    const heuristic = {
      stitchEstimate: Math.max(5000, Math.min(250_000, Math.round(bytesApprox / 40))),
      colourways: ["Black", "White", "Red", "Gold"],
      suggestedNeedles: [
        { needle: 1, colour: "Black", threadCode: "M-1000" },
        { needle: 2, colour: "White", threadCode: "M-1800" },
        { needle: 3, colour: "Red", threadCode: "M-1900" },
      ],
      underlayNotes: "Run edge walk + zigzag underlay; density ~0.40 mm for logo fills.",
      workType: "flat" as const,
      widthMm: 80,
      heightMm: 60,
      confidence: "heuristic",
      source: apiKey ? "openai-pending-fallback" : "local-heuristic",
      hint: data.hint ?? null,
    };

    if (!apiKey) {
      return { analysis: heuristic, message: "OPENAI_API_KEY not set — returned local stitch estimate." };
    }

    try {
      const mime = data.fileMimeType || "image/png";
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You assist embroidery digitizers. Return JSON with stitchEstimate (int), colourways (string[]), suggestedNeedles ({needle,colour,threadCode}[]), underlayNotes (string), workType (flat|sequin|cording|mixed), widthMm, heightMm.",
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Estimate embroidery digitizing for this artwork. Hint: ${data.hint ?? "logo/crest"}`,
                },
                {
                  type: "image_url",
                  image_url: { url: `data:${mime};base64,${data.fileContentBase64}` },
                },
              ],
            },
          ],
        }),
      });
      if (!res.ok) {
        return { analysis: heuristic, message: `OpenAI error ${res.status} — heuristic used.` };
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const raw = json.choices?.[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return {
        analysis: { ...heuristic, ...parsed, source: "openai", confidence: "model" },
        message: "AI analysis complete — attach DST/PES for production.",
      };
    } catch {
      return { analysis: heuristic, message: "AI call failed — heuristic used." };
    }
  }

  // ── Extra factory modules ───────────────────────────────

  async listExtra(organizationId: string, kind: FactoryExtraModuleKind, branchId?: string) {
    factoryExtraModuleKindSchema.parse(kind);
    switch (kind) {
      case "purchase-orders":
        return this.listExtraFrom(factoryPurchaseOrders, organizationId, branchId);
      case "purchase-receipts":
        return this.listExtraFrom(factoryPurchaseReceipts, organizationId, branchId);
      case "defect-returns":
        return this.listExtraFrom(factoryDefectReturns, organizationId, branchId);
      case "handwork-issue":
        return this.listExtraFrom(factoryHandworkIssues, organizationId, branchId);
      case "handwork-return":
        return this.listExtraFrom(factoryHandworkReturns, organizationId, branchId);
      case "attendance":
        return this.listExtraFrom(factoryAttendance, organizationId, branchId);
      case "leave":
        return this.listExtraFrom(factoryLeave, organizationId, branchId);
      case "thread-consumption":
        return this.listExtraFrom(factoryThreadConsumption, organizationId, branchId);
      case "stitch-rates":
        return this.listExtraFrom(factoryStitchRates, organizationId, branchId);
      case "job-out":
        return this.listExtraFrom(factoryJobOut, organizationId, branchId);
      case "expenses":
        return this.listExtraFrom(factoryExpenses, organizationId, branchId);
      case "maintenance-logs":
        return this.listExtraFrom(factoryMaintenanceLogs, organizationId, branchId);
      case "salary-slips":
        return this.listExtraFrom(factorySalarySlips, organizationId, branchId);
      case "eway-records":
        return this.listExtraFrom(factoryEwayRecords, organizationId, branchId);
      case "brokers":
        return this.listExtraFrom(factoryBrokerMasters, organizationId, branchId);
      default: {
        const _exhaustive: never = kind;
        throw new BadRequestException(`Unknown extra module: ${_exhaustive}`);
      }
    }
  }

  async createExtra(organizationId: string, kind: FactoryExtraModuleKind, input: CreateFactoryExtraRecord) {
    factoryExtraModuleKindSchema.parse(kind);
    const body = createFactoryExtraRecordSchema.parse(input);
    const p = body.payload ?? {};
    const branchId = this.extraBranchId(body.branchId, p, kind);
    const detailsJson =
      typeof p.detailsJson === "string"
        ? p.detailsJson
        : p.detailsJson && typeof p.detailsJson === "object"
          ? JSON.stringify(p.detailsJson)
          : null;

    switch (kind) {
      case "purchase-orders": {
        const poNumber =
          this.extraStr(p, "poNumber") ||
          (await this.nextSeq(organizationId, "PO", factoryPurchaseOrders, factoryPurchaseOrders.poNumber));
        const [row] = await this.db
          .insert(factoryPurchaseOrders)
          .values({
            organizationId,
            branchId: branchId!,
            poNumber,
            vendorPartyId: this.extraUuid(p, "vendorPartyId"),
            poDate: this.extraStr(p, "poDate") ?? todayDateText(),
            status: this.extraStr(p, "status") ?? "open",
            expectedDate: this.extraStr(p, "expectedDate"),
            amountPkr: this.extraInt(p, "amountPkr", 0),
            notes: this.extraStr(p, "notes"),
            detailsJson,
          })
          .returning();
        if (!row) throw new BadRequestException("Failed to create record");
        return this.mapExtraDto(row);
      }
      case "purchase-receipts": {
        const receiptNumber =
          this.extraStr(p, "receiptNumber") ||
          (await this.nextSeq(
            organizationId,
            "PR",
            factoryPurchaseReceipts,
            factoryPurchaseReceipts.receiptNumber,
          ));
        const [row] = await this.db
          .insert(factoryPurchaseReceipts)
          .values({
            organizationId,
            branchId: branchId!,
            receiptNumber,
            vendorPartyId: this.extraUuid(p, "vendorPartyId"),
            poId: this.extraUuid(p, "poId"),
            receiptDate: this.extraStr(p, "receiptDate") ?? todayDateText(),
            status: this.extraStr(p, "status") ?? "received",
            notes: this.extraStr(p, "notes"),
            detailsJson,
          })
          .returning();
        if (!row) throw new BadRequestException("Failed to create record");
        return this.mapExtraDto(row);
      }
      case "defect-returns": {
        const returnNumber =
          this.extraStr(p, "returnNumber") ||
          (await this.nextSeq(organizationId, "DR", factoryDefectReturns, factoryDefectReturns.returnNumber));
        const [row] = await this.db
          .insert(factoryDefectReturns)
          .values({
            organizationId,
            branchId: branchId!,
            returnNumber,
            claimSide: this.extraStr(p, "claimSide") ?? "party",
            partyId: this.extraUuid(p, "partyId"),
            operatorId: this.extraUuid(p, "operatorId"),
            jobId: this.extraUuid(p, "jobId"),
            returnDate: this.extraStr(p, "returnDate") ?? todayDateText(),
            qty: this.extraInt(p, "qty", 1),
            defectCode: this.extraStr(p, "defectCode"),
            amountPkr: this.extraInt(p, "amountPkr", 0),
            status: this.extraStr(p, "status") ?? "open",
            notes: this.extraStr(p, "notes"),
            detailsJson,
          })
          .returning();
        if (!row) throw new BadRequestException("Failed to create record");
        return this.mapExtraDto(row);
      }
      case "handwork-issue": {
        const issueNumber =
          this.extraStr(p, "issueNumber") ||
          (await this.nextSeq(organizationId, "HW", factoryHandworkIssues, factoryHandworkIssues.issueNumber));
        const [row] = await this.db
          .insert(factoryHandworkIssues)
          .values({
            organizationId,
            branchId: branchId!,
            issueNumber,
            karigarPartyId: this.extraUuid(p, "karigarPartyId"),
            jobId: this.extraUuid(p, "jobId"),
            designId: this.extraUuid(p, "designId"),
            issueDate: this.extraStr(p, "issueDate") ?? todayDateText(),
            dueDate: this.extraStr(p, "dueDate"),
            qty: this.extraInt(p, "qty", 1),
            ratePkr: this.extraInt(p, "ratePkr", 0),
            status: this.extraStr(p, "status") ?? "issued",
            notes: this.extraStr(p, "notes"),
            detailsJson,
          })
          .returning();
        if (!row) throw new BadRequestException("Failed to create record");
        return this.mapExtraDto(row);
      }
      case "handwork-return": {
        const returnNumber =
          this.extraStr(p, "returnNumber") ||
          (await this.nextSeq(
            organizationId,
            "HR",
            factoryHandworkReturns,
            factoryHandworkReturns.returnNumber,
          ));
        const [row] = await this.db
          .insert(factoryHandworkReturns)
          .values({
            organizationId,
            branchId: branchId!,
            returnNumber,
            issueId: this.extraUuid(p, "issueId"),
            returnDate: this.extraStr(p, "returnDate") ?? todayDateText(),
            qty: this.extraInt(p, "qty", 1),
            lossQty: this.extraInt(p, "lossQty", 0),
            status: this.extraStr(p, "status") ?? "received",
            notes: this.extraStr(p, "notes"),
            detailsJson,
          })
          .returning();
        if (!row) throw new BadRequestException("Failed to create record");
        return this.mapExtraDto(row);
      }
      case "attendance": {
        const operatorId = this.extraUuid(p, "operatorId");
        if (!operatorId) throw new BadRequestException("payload.operatorId is required");
        const [row] = await this.db
          .insert(factoryAttendance)
          .values({
            organizationId,
            branchId: branchId!,
            operatorId,
            attendDate: this.extraStr(p, "attendDate") ?? todayDateText(),
            shift: this.extraStr(p, "shift") ?? "day",
            status: this.extraStr(p, "status") ?? "present",
            hours: String(this.extraNum(p, "hours", 8)),
            notes: this.extraStr(p, "notes"),
          })
          .returning();
        if (!row) throw new BadRequestException("Failed to create record");
        return this.mapExtraDto(row);
      }
      case "leave": {
        const operatorId = this.extraUuid(p, "operatorId");
        if (!operatorId) throw new BadRequestException("payload.operatorId is required");
        const fromDate = this.extraStr(p, "fromDate") ?? todayDateText();
        const [row] = await this.db
          .insert(factoryLeave)
          .values({
            organizationId,
            branchId: branchId!,
            operatorId,
            fromDate,
            toDate: this.extraStr(p, "toDate") ?? fromDate,
            leaveType: this.extraStr(p, "leaveType") ?? "casual",
            status: this.extraStr(p, "status") ?? "approved",
            notes: this.extraStr(p, "notes"),
          })
          .returning();
        if (!row) throw new BadRequestException("Failed to create record");
        return this.mapExtraDto(row);
      }
      case "thread-consumption": {
        const itemId = this.extraUuid(p, "itemId");
        const qty = this.extraNum(p, "qty", 0);
        const row = await this.db.transaction(async (tx) => {
          const [inserted] = await tx
            .insert(factoryThreadConsumption)
            .values({
              organizationId,
              branchId: branchId!,
              entryDate: this.extraStr(p, "entryDate") ?? todayDateText(),
              designId: this.extraUuid(p, "designId"),
              jobId: this.extraUuid(p, "jobId"),
              itemId: itemId ?? null,
              qty: String(qty),
              unit: this.extraStr(p, "unit") ?? "cone",
              notes: this.extraStr(p, "notes"),
            })
            .returning();
          if (!inserted) throw new BadRequestException("Failed to create record");
          if (itemId && qty > 0) {
            await this.postFactoryStockDeltaInTx(
              tx,
              organizationId,
              branchId!,
              itemId,
              -qty,
              "thread_consumption",
              inserted.id,
              this.extraStr(p, "notes"),
            );
          }
          return inserted;
        });
        return this.mapExtraDto(row);
      }
      case "stitch-rates": {
        const name = this.extraStr(p, "name");
        if (!name) throw new BadRequestException("payload.name is required");
        const code =
          this.extraStr(p, "code") ||
          (await this.nextSeq(organizationId, "STR", factoryStitchRates, factoryStitchRates.code));
        const [row] = await this.db
          .insert(factoryStitchRates)
          .values({
            organizationId,
            branchId: branchId,
            code,
            name,
            headArrangement: this.extraStr(p, "headArrangement") ?? "1-7-11-B",
            workType: this.extraStr(p, "workType") ?? "flat",
            ratePer1kPkr: this.extraInt(p, "ratePer1kPkr", 0),
            notes: this.extraStr(p, "notes"),
            active: this.extraStr(p, "active") ?? "yes",
          })
          .returning();
        if (!row) throw new BadRequestException("Failed to create record");
        return this.mapExtraDto(row);
      }
      case "job-out": {
        const outNumber =
          this.extraStr(p, "outNumber") ||
          (await this.nextSeq(organizationId, "JO", factoryJobOut, factoryJobOut.outNumber));
        const [row] = await this.db
          .insert(factoryJobOut)
          .values({
            organizationId,
            branchId: branchId!,
            outNumber,
            vendorPartyId: this.extraUuid(p, "vendorPartyId"),
            jobId: this.extraUuid(p, "jobId"),
            outDate: this.extraStr(p, "outDate") ?? todayDateText(),
            dueDate: this.extraStr(p, "dueDate"),
            qty: this.extraInt(p, "qty", 1),
            processName: this.extraStr(p, "processName") ?? "embroidery",
            status: this.extraStr(p, "status") ?? "out",
            notes: this.extraStr(p, "notes"),
            detailsJson,
          })
          .returning();
        if (!row) throw new BadRequestException("Failed to create record");
        return this.mapExtraDto(row);
      }
      case "expenses": {
        const narration =
          this.extraStr(p, "narration") ??
          this.extraStr(p, "expenseRef") ??
          this.extraDocRef("EX");
        const [row] = await this.db
          .insert(factoryExpenses)
          .values({
            organizationId,
            branchId: branchId!,
            expenseDate: this.extraStr(p, "expenseDate") ?? todayDateText(),
            category: this.extraStr(p, "category") ?? "general",
            amountPkr: this.extraInt(p, "amountPkr", 0),
            payMode: this.extraStr(p, "payMode") ?? "cash",
            vendorName: this.extraStr(p, "vendorName"),
            narration,
            status: this.extraStr(p, "status") ?? "posted",
          })
          .returning();
        if (!row) throw new BadRequestException("Failed to create record");
        return this.mapExtraDto(row);
      }
      case "maintenance-logs": {
        const notes =
          this.extraStr(p, "notes") ?? this.extraStr(p, "logRef") ?? this.extraDocRef("ML");
        const [row] = await this.db
          .insert(factoryMaintenanceLogs)
          .values({
            organizationId,
            branchId: branchId!,
            machineId: this.extraUuid(p, "machineId"),
            serviceDate: this.extraStr(p, "serviceDate") ?? todayDateText(),
            serviceType: this.extraStr(p, "serviceType") ?? "preventive",
            costPkr: this.extraInt(p, "costPkr", 0),
            nextDueDate: this.extraStr(p, "nextDueDate"),
            notes,
            status: this.extraStr(p, "status") ?? "done",
          })
          .returning();
        if (!row) throw new BadRequestException("Failed to create record");
        return this.mapExtraDto(row);
      }
      case "salary-slips": {
        const operatorId = this.extraUuid(p, "operatorId");
        if (!operatorId) throw new BadRequestException("payload.operatorId is required");
        const d = new Date();
        const periodMonth =
          this.extraStr(p, "periodMonth") ?? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const notes =
          this.extraStr(p, "notes") ?? this.extraStr(p, "slipRef") ?? this.extraDocRef("SS");
        const [row] = await this.db
          .insert(factorySalarySlips)
          .values({
            organizationId,
            branchId: branchId!,
            operatorId,
            periodMonth,
            grossPkr: this.extraInt(p, "grossPkr", 0),
            advancesPkr: this.extraInt(p, "advancesPkr", 0),
            bonusPkr: this.extraInt(p, "bonusPkr", 0),
            cutsPkr: this.extraInt(p, "cutsPkr", 0),
            netPkr: this.extraInt(p, "netPkr", 0),
            status: this.extraStr(p, "status") ?? "draft",
            notes,
          })
          .returning();
        if (!row) throw new BadRequestException("Failed to create record");
        return this.mapExtraDto(row);
      }
      case "eway-records": {
        const ewayNumber =
          this.extraStr(p, "ewayNumber") ||
          (await this.nextSeq(organizationId, "EW", factoryEwayRecords, factoryEwayRecords.ewayNumber));
        const [row] = await this.db
          .insert(factoryEwayRecords)
          .values({
            organizationId,
            branchId: branchId!,
            ewayNumber,
            docType: this.extraStr(p, "docType") ?? "outward_cn",
            docRef: this.extraStr(p, "docRef"),
            partyId: this.extraUuid(p, "partyId"),
            ewayDate: this.extraStr(p, "ewayDate") ?? todayDateText(),
            vehicle: this.extraStr(p, "vehicle"),
            amountPkr: this.extraInt(p, "amountPkr", 0),
            status: this.extraStr(p, "status") ?? "active",
            notes: this.extraStr(p, "notes"),
          })
          .returning();
        if (!row) throw new BadRequestException("Failed to create record");
        return this.mapExtraDto(row);
      }
      case "brokers": {
        const name = this.extraStr(p, "name");
        if (!name) throw new BadRequestException("payload.name is required");
        const code =
          this.extraStr(p, "code") ||
          (await this.nextSeq(organizationId, "BR", factoryBrokerMasters, factoryBrokerMasters.code));
        const [row] = await this.db
          .insert(factoryBrokerMasters)
          .values({
            organizationId,
            branchId: branchId,
            code,
            name,
            phone: this.extraStr(p, "phone"),
            commissionPct: String(this.extraNum(p, "commissionPct", 0)),
            notes: this.extraStr(p, "notes"),
            active: this.extraStr(p, "active") ?? "yes",
          })
          .returning();
        if (!row) throw new BadRequestException("Failed to create record");
        return this.mapExtraDto(row);
      }
      default: {
        const _exhaustive: never = kind;
        throw new BadRequestException(`Unknown extra module: ${_exhaustive}`);
      }
    }
  }

  private async listExtraFrom(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table: any,
    organizationId: string,
    branchId?: string,
  ) {
    const conds = [eq(table.organizationId, organizationId)];
    if (branchId) conds.push(eq(table.branchId, branchId));
    const rows = await this.db
      .select()
      .from(table)
      .where(and(...conds))
      .orderBy(desc(table.createdAt));
    return rows.map((r) => this.mapExtraDto(r as Record<string, unknown>));
  }

  private extraBranchId(
    bodyBranchId: string | null | undefined,
    p: Record<string, unknown>,
    kind: FactoryExtraModuleKind,
  ): string | null {
    const fromPayload = this.extraUuid(p, "branchId");
    const id = bodyBranchId ?? fromPayload ?? null;
    const optionalBranch = kind === "stitch-rates" || kind === "brokers";
    if (!id && !optionalBranch) {
      throw new BadRequestException("branchId is required (body or payload)");
    }
    return id;
  }

  private extraStr(p: Record<string, unknown>, key: string): string | null | undefined {
    const v = p[key];
    if (v === null || v === undefined) return null;
    if (typeof v === "string") {
      const t = v.trim();
      return t.length ? t : null;
    }
    return String(v);
  }

  private extraUuid(p: Record<string, unknown>, key: string): string | null {
    const v = p[key];
    if (v === null || v === undefined) return null;
    if (typeof v !== "string") {
      throw new BadRequestException(`payload.${key} must be a UUID string`);
    }
    const t = v.trim();
    if (!t.length) return null;
    const parsed = z.string().uuid().safeParse(t);
    if (!parsed.success) {
      throw new BadRequestException(`payload.${key} must be a valid UUID`);
    }
    return parsed.data;
  }

  private extraInt(p: Record<string, unknown>, key: string, def: number): number {
    const v = p[key];
    if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
    if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return parseInt(v, 10);
    return def;
  }

  private extraNum(p: Record<string, unknown>, key: string, def: number): number {
    const v = p[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) return parseFloat(v);
    return def;
  }

  private mapExtraDto(row: Record<string, unknown>) {
    const dto: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (v instanceof Date) dto[k] = iso(v);
      else if (k === "createdAt" || k === "updatedAt") dto[k] = iso(v as Date | string | null | undefined);
      else if (typeof v === "string" && (k === "hours" || k === "qty" || k === "commissionPct" || k === "weightKg"))
        dto[k] = Number(v);
      else dto[k] = v;
    }
    return dto;
  }

  // ── Mappers ────────────────────────────────────────────

  private mapParty(r: typeof factoryParties.$inferSelect) {
    return {
      id: r.id,
      organizationId: r.organizationId,
      branchId: r.branchId,
      kind: r.kind,
      code: r.code,
      name: r.name,
      phone: r.phone,
      address: r.address,
      notes: r.notes,
      gstin: r.gstin,
      ntnCnic: r.ntnCnic,
      whatsapp: r.whatsapp,
      city: r.city,
      billingAddress: r.billingAddress,
      shippingAddress: r.shippingAddress,
      contactPersons: r.contactPersons,
      paymentTerms: r.paymentTerms,
      creditLimitPkr: r.creditLimitPkr,
      openingBalancePkr: r.openingBalancePkr,
      rateType: r.rateType,
      defaultStitchRatePkr: r.defaultStitchRatePkr,
      industrySegment: r.industrySegment,
      bankDetails: r.bankDetails,
      createdAt: iso(r.createdAt)!,
      updatedAt: iso(r.updatedAt)!,
    };
  }

  private mapItem(r: typeof factoryItems.$inferSelect, qtyOnHand: string | null | undefined) {
    return {
      id: r.id,
      organizationId: r.organizationId,
      branchId: r.branchId,
      sku: r.sku,
      name: r.name,
      category: r.category,
      unit: r.unit,
      reorderLevel: r.reorderLevel,
      unitCostPkr: r.unitCostPkr,
      active: r.active,
      notes: r.notes,
      brand: r.brand,
      colour: r.colour,
      sizeLabel: r.sizeLabel,
      location: r.location,
      supplierPartyId: r.supplierPartyId,
      batchLot: r.batchLot,
      qtyOnHand: Number(qtyOnHand ?? 0),
      createdAt: iso(r.createdAt)!,
      updatedAt: iso(r.updatedAt)!,
    };
  }

  private mapInwardChallan(
    r: typeof factoryInwardChallans.$inferSelect,
    partyName: string,
    lines: (typeof factoryInwardChallanLines.$inferSelect)[],
  ) {
    return {
      id: r.id,
      organizationId: r.organizationId,
      branchId: r.branchId,
      cnNumber: r.cnNumber,
      partyId: r.partyId,
      partyName,
      challanDate: r.challanDate,
      status: r.status,
      notes: r.notes,
      partyCnNumber: r.partyCnNumber,
      vehicle: r.vehicle,
      receivedBy: r.receivedBy,
      lines: lines.map((l) => ({
        id: l.id,
        description: l.description,
        designId: l.designId,
        qty: l.qty,
        unit: l.unit,
        colour: l.colour,
        qtyDispatched: l.qtyDispatched,
        fabric: l.fabric,
        lotNumber: l.lotNumber,
        conditionNote: l.conditionNote,
      })),
      createdAt: iso(r.createdAt)!,
      updatedAt: iso(r.updatedAt)!,
    };
  }

  private mapOutwardChallan(
    r: typeof factoryOutwardChallans.$inferSelect,
    partyName: string,
    lines: (typeof factoryOutwardChallanLines.$inferSelect)[],
  ) {
    return {
      id: r.id,
      organizationId: r.organizationId,
      branchId: r.branchId,
      cnNumber: r.cnNumber,
      partyId: r.partyId,
      partyName,
      inwardChallanId: r.inwardChallanId,
      jobId: r.jobId,
      challanDate: r.challanDate,
      status: r.status,
      invoiceAmountPkr: r.invoiceAmountPkr,
      notes: r.notes,
      vehicle: r.vehicle,
      driverName: r.driverName,
      ewayRef: r.ewayRef,
      lines: lines.map((l) => ({
        id: l.id,
        inwardLineId: l.inwardLineId,
        description: l.description,
        qty: l.qty,
        unit: l.unit,
      })),
      createdAt: iso(r.createdAt)!,
      updatedAt: iso(r.updatedAt)!,
    };
  }

  private mapOperator(r: typeof factoryOperators.$inferSelect) {
    return {
      id: r.id,
      organizationId: r.organizationId,
      branchId: r.branchId,
      code: r.code,
      name: r.name,
      phone: r.phone,
      ratePer1kStitchesPkr: r.ratePer1kStitchesPkr,
      ratePerPiecePkr: r.ratePerPiecePkr,
      active: r.active,
      notes: r.notes,
      cnic: r.cnic,
      address: r.address,
      joinDate: r.joinDate,
      payType: r.payType,
      bankDetails: r.bankDetails,
      createdAt: iso(r.createdAt)!,
      updatedAt: iso(r.updatedAt)!,
    };
  }

  private mapDailySheet(
    r: typeof factoryDailySheets.$inferSelect,
    lines: (typeof factoryDailySheetLines.$inferSelect)[],
  ) {
    const totalStitches = lines.reduce((s, l) => s + l.stitches, 0);
    const totalWagePkr = lines.reduce((s, l) => s + l.wagePkr, 0);
    return {
      id: r.id,
      organizationId: r.organizationId,
      branchId: r.branchId,
      sheetDate: r.sheetDate,
      shift: r.shift,
      status: r.status,
      notes: r.notes,
      totalStitches,
      totalWagePkr,
      lines: lines.map((l) => ({
        id: l.id,
        machineId: l.machineId,
        operatorId: l.operatorId,
        jobId: l.jobId,
        designId: l.designId,
        stitches: l.stitches,
        frames: l.frames,
        pieces: l.pieces,
        downtimeMinutes: l.downtimeMinutes,
        bonusPkr: l.bonusPkr,
        wagePkr: l.wagePkr,
        threadBreaks: l.threadBreaks,
        runMinutes: l.runMinutes,
        stopReason: l.stopReason,
        notes: l.notes,
      })),
      createdAt: iso(r.createdAt)!,
      updatedAt: iso(r.updatedAt)!,
    };
  }

  private mapJobBill(r: typeof factoryJobBills.$inferSelect, partyName: string) {
    return {
      id: r.id,
      organizationId: r.organizationId,
      branchId: r.branchId,
      billNumber: r.billNumber,
      partyId: r.partyId,
      partyName,
      outwardChallanId: r.outwardChallanId,
      billDate: r.billDate,
      amountPkr: r.amountPkr,
      taxPkr: r.taxPkr,
      defectDeductionPkr: r.defectDeductionPkr,
      discountPkr: r.discountPkr,
      status: r.status,
      notes: r.notes,
      createdAt: iso(r.createdAt)!,
      updatedAt: iso(r.updatedAt)!,
    };
  }

  private mapLedgerEntry(
    r: typeof factoryLedgerEntries.$inferSelect,
    partyName: string | null | undefined,
  ) {
    return {
      id: r.id,
      organizationId: r.organizationId,
      branchId: r.branchId,
      entryDate: r.entryDate,
      accountKind: r.accountKind,
      partyId: r.partyId,
      partyName: partyName ?? null,
      debitPkr: r.debitPkr,
      creditPkr: r.creditPkr,
      narration: r.narration,
      refType: r.refType,
      refId: r.refId,
      createdAt: iso(r.createdAt)!,
    };
  }

  private mapAdvance(r: typeof factoryOperatorAdvances.$inferSelect) {
    return {
      id: r.id,
      organizationId: r.organizationId,
      branchId: r.branchId,
      operatorId: r.operatorId,
      advanceDate: r.advanceDate,
      amountPkr: r.amountPkr,
      notes: r.notes,
      createdAt: iso(r.createdAt)!,
    };
  }
}