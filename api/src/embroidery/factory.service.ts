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
  factoryDesignAiAnalyzeSchema,
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
  type FactoryDesignAiAnalyze,
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
  type PlatformPgDb,
} from "@platform/database-pg";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
    table:
      | typeof factoryParties
      | typeof factoryItems
      | typeof factoryInwardChallans
      | typeof factoryOutwardChallans
      | typeof factoryOperators
      | typeof factoryJobBills,
    codeColumn:
      | typeof factoryParties.code
      | typeof factoryItems.sku
      | typeof factoryInwardChallans.cnNumber
      | typeof factoryOutwardChallans.cnNumber
      | typeof factoryOperators.code
      | typeof factoryJobBills.billNumber,
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