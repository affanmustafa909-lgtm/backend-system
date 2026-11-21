import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  createEmbroideryCustomerOrderSchema,
  createEmbroideryDeliverySchema,
  createEmbroideryDesignSchema,
  createEmbroideryJobSchema,
  createEmbroideryMachineSchema,
  createEmbroideryMaterialIssueSchema,
  createEmbroideryPieceRateEntrySchema,
  createEmbroideryProductionLogSchema,
  createEmbroideryQcRecordSchema,
  EMBROIDERY_JOB_STAGES,
  updateEmbroideryCustomerOrderSchema,
  updateEmbroideryDesignSchema,
  updateEmbroideryJobSchema,
  updateEmbroideryMachineSchema,
  type CreateEmbroideryCustomerOrder,
  type CreateEmbroideryDelivery,
  type CreateEmbroideryDesign,
  type CreateEmbroideryJob,
  type CreateEmbroideryMachine,
  type CreateEmbroideryMaterialIssue,
  type CreateEmbroideryPieceRateEntry,
  type CreateEmbroideryProductionLog,
  type CreateEmbroideryQcRecord,
  type UpdateEmbroideryCustomerOrder,
  type UpdateEmbroideryDesign,
  type UpdateEmbroideryJob,
  type UpdateEmbroideryMachine,
} from "@platform/contracts";
import {
  embroideryCustomerOrders,
  embroideryDeliveries,
  embroideryDesigns,
  embroideryJobLines,
  embroideryJobs,
  embroideryMachines,
  embroideryMaterialIssues,
  embroideryPieceRateEntries,
  embroideryProductionLogs,
  embroideryQcRecords,
  type PlatformPgDb,
} from "@platform/database-pg";
import { and, desc, eq, sql } from "drizzle-orm";
import { DRIZZLE } from "../drizzle/drizzle.tokens";

function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : String(d);
}

const PRODUCTION_STAGES = new Set(["stitching", "qc", "finishing", "packing", "ready"]);

@Injectable()
export class EmbroideryService {
  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  // ── Designs ──────────────────────────────────────────────

  async listDesigns(organizationId: string, branchId?: string) {
    const rows = await this.db
      .select()
      .from(embroideryDesigns)
      .where(
        branchId
          ? and(
              eq(embroideryDesigns.organizationId, organizationId),
              eq(embroideryDesigns.branchId, branchId),
            )
          : eq(embroideryDesigns.organizationId, organizationId),
      )
      .orderBy(desc(embroideryDesigns.createdAt));
    return rows.map((r) => this.mapDesign(r));
  }

  async createDesign(organizationId: string, input: CreateEmbroideryDesign) {
    const data = createEmbroideryDesignSchema.parse(input);
    const fileContent = data.fileContentBase64?.replace(/\s/g, "") || null;
    const [row] = await this.db
      .insert(embroideryDesigns)
      .values({
        organizationId,
        branchId: data.branchId,
        code: data.code,
        name: data.name,
        customerId: data.customerId ?? null,
        stitchCount: data.stitchCount ?? 0,
        colorways: data.colorways ?? null,
        fileName: data.fileName ?? null,
        fileContentBase64: fileContent,
        fileMimeType: data.fileMimeType ?? null,
        notes: data.notes ?? null,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create design");
    return this.mapDesign(row);
  }

  async updateDesign(organizationId: string, id: string, input: UpdateEmbroideryDesign) {
    const data = updateEmbroideryDesignSchema.parse(input);
    const fileContent =
      data.fileContentBase64 !== undefined
        ? data.fileContentBase64?.replace(/\s/g, "") || null
        : undefined;
    const [row] = await this.db
      .update(embroideryDesigns)
      .set({
        ...(data.code !== undefined ? { code: data.code } : {}),
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.customerId !== undefined ? { customerId: data.customerId } : {}),
        ...(data.stitchCount !== undefined ? { stitchCount: data.stitchCount } : {}),
        ...(data.colorways !== undefined ? { colorways: data.colorways } : {}),
        ...(data.fileName !== undefined ? { fileName: data.fileName } : {}),
        ...(fileContent !== undefined ? { fileContentBase64: fileContent } : {}),
        ...(data.fileMimeType !== undefined ? { fileMimeType: data.fileMimeType } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(embroideryDesigns.id, id), eq(embroideryDesigns.organizationId, organizationId)))
      .returning();
    if (!row) throw new NotFoundException("Design not found");
    return this.mapDesign(row);
  }

  async getDesignFile(organizationId: string, id: string) {
    const [row] = await this.db
      .select({
        id: embroideryDesigns.id,
        fileName: embroideryDesigns.fileName,
        fileMimeType: embroideryDesigns.fileMimeType,
        fileContentBase64: embroideryDesigns.fileContentBase64,
      })
      .from(embroideryDesigns)
      .where(and(eq(embroideryDesigns.id, id), eq(embroideryDesigns.organizationId, organizationId)))
      .limit(1);
    if (!row) throw new NotFoundException("Design not found");
    if (!row.fileContentBase64) throw new NotFoundException("No design file uploaded");
    return {
      id: row.id,
      fileName: row.fileName,
      fileMimeType: row.fileMimeType,
      fileContentBase64: row.fileContentBase64,
    };
  }

  async deleteDesign(organizationId: string, id: string) {
    const [row] = await this.db
      .delete(embroideryDesigns)
      .where(and(eq(embroideryDesigns.id, id), eq(embroideryDesigns.organizationId, organizationId)))
      .returning({ id: embroideryDesigns.id });
    if (!row) throw new NotFoundException("Design not found");
    return { ok: true };
  }

  // ── Machines ─────────────────────────────────────────────

  async listMachines(organizationId: string, branchId?: string) {
    const rows = await this.db
      .select()
      .from(embroideryMachines)
      .where(
        branchId
          ? and(
              eq(embroideryMachines.organizationId, organizationId),
              eq(embroideryMachines.branchId, branchId),
            )
          : eq(embroideryMachines.organizationId, organizationId),
      )
      .orderBy(desc(embroideryMachines.createdAt));
    return rows.map((r) => this.mapMachine(r));
  }

  async createMachine(organizationId: string, input: CreateEmbroideryMachine) {
    const data = createEmbroideryMachineSchema.parse(input);
    const [row] = await this.db
      .insert(embroideryMachines)
      .values({
        organizationId,
        branchId: data.branchId,
        code: data.code,
        name: data.name,
        heads: data.heads ?? 1,
        status: data.status ?? "idle",
        operatorUserId: data.operatorUserId ?? null,
        notes: data.notes ?? null,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create machine");
    return this.mapMachine(row);
  }

  async updateMachine(organizationId: string, id: string, input: UpdateEmbroideryMachine) {
    const data = updateEmbroideryMachineSchema.parse(input);
    const [row] = await this.db
      .update(embroideryMachines)
      .set({
        ...(data.code !== undefined ? { code: data.code } : {}),
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.heads !== undefined ? { heads: data.heads } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.operatorUserId !== undefined ? { operatorUserId: data.operatorUserId } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(embroideryMachines.id, id), eq(embroideryMachines.organizationId, organizationId)))
      .returning();
    if (!row) throw new NotFoundException("Machine not found");
    return this.mapMachine(row);
  }

  async deleteMachine(organizationId: string, id: string) {
    const [row] = await this.db
      .delete(embroideryMachines)
      .where(and(eq(embroideryMachines.id, id), eq(embroideryMachines.organizationId, organizationId)))
      .returning({ id: embroideryMachines.id });
    if (!row) throw new NotFoundException("Machine not found");
    return { ok: true };
  }

  // ── Customer orders ──────────────────────────────────────

  async listCustomerOrders(
    organizationId: string,
    opts?: { branchId?: string; status?: string; customerId?: string },
  ) {
    const conditions = [eq(embroideryCustomerOrders.organizationId, organizationId)];
    if (opts?.branchId) conditions.push(eq(embroideryCustomerOrders.branchId, opts.branchId));
    if (opts?.status) conditions.push(eq(embroideryCustomerOrders.status, opts.status));
    if (opts?.customerId) conditions.push(eq(embroideryCustomerOrders.customerId, opts.customerId));
    const rows = await this.db
      .select()
      .from(embroideryCustomerOrders)
      .where(and(...conditions))
      .orderBy(desc(embroideryCustomerOrders.createdAt));
    return rows.map((r) => this.mapCustomerOrder(r));
  }

  async createCustomerOrder(organizationId: string, input: CreateEmbroideryCustomerOrder) {
    const data = createEmbroideryCustomerOrderSchema.parse(input);
    const orderNumber =
      data.orderNumber?.trim() ||
      `ORD-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 9000 + 1000)}`;
    const [row] = await this.db
      .insert(embroideryCustomerOrders)
      .values({
        organizationId,
        branchId: data.branchId,
        orderNumber,
        customerId: data.customerId,
        designId: data.designId ?? null,
        status: data.status ?? "draft",
        dueDate: data.dueDate ?? null,
        quantity: data.quantity ?? 1,
        notes: data.notes ?? null,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create customer order");
    return this.mapCustomerOrder(row);
  }

  async updateCustomerOrder(
    organizationId: string,
    id: string,
    input: UpdateEmbroideryCustomerOrder,
  ) {
    const data = updateEmbroideryCustomerOrderSchema.parse(input);
    const [row] = await this.db
      .update(embroideryCustomerOrders)
      .set({
        ...(data.customerId !== undefined ? { customerId: data.customerId } : {}),
        ...(data.designId !== undefined ? { designId: data.designId } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.dueDate !== undefined ? { dueDate: data.dueDate } : {}),
        ...(data.quantity !== undefined ? { quantity: data.quantity } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(embroideryCustomerOrders.id, id),
          eq(embroideryCustomerOrders.organizationId, organizationId),
        ),
      )
      .returning();
    if (!row) throw new NotFoundException("Customer order not found");
    return this.mapCustomerOrder(row);
  }

  // ── Jobs ─────────────────────────────────────────────────

  async listJobs(organizationId: string, branchId?: string, stage?: string) {
    const conditions = [eq(embroideryJobs.organizationId, organizationId)];
    if (branchId) conditions.push(eq(embroideryJobs.branchId, branchId));
    if (stage) conditions.push(eq(embroideryJobs.stage, stage));
    const rows = await this.db
      .select()
      .from(embroideryJobs)
      .where(and(...conditions))
      .orderBy(desc(embroideryJobs.createdAt));
    const result = [];
    for (const row of rows) {
      result.push(await this.mapJob(row));
    }
    return result;
  }

  async getJob(organizationId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(embroideryJobs)
      .where(and(eq(embroideryJobs.id, id), eq(embroideryJobs.organizationId, organizationId)))
      .limit(1);
    if (!row) throw new NotFoundException("Job not found");
    return this.mapJob(row);
  }

  async getJobCosting(organizationId: string, id: string) {
    const [row] = await this.db
      .select({
        materialCostPkr: embroideryJobs.materialCostPkr,
        laborCostPkr: embroideryJobs.laborCostPkr,
        overheadCostPkr: embroideryJobs.overheadCostPkr,
        invoiceAmountPkr: embroideryJobs.invoiceAmountPkr,
      })
      .from(embroideryJobs)
      .where(and(eq(embroideryJobs.id, id), eq(embroideryJobs.organizationId, organizationId)))
      .limit(1);
    if (!row) throw new NotFoundException("Job not found");
    const material = row.materialCostPkr ?? 0;
    const labor = row.laborCostPkr ?? 0;
    const overhead = row.overheadCostPkr ?? 0;
    return {
      material,
      labor,
      overhead,
      total: material + labor + overhead,
      invoiceAmount: row.invoiceAmountPkr ?? 0,
    };
  }

  async createJob(organizationId: string, input: CreateEmbroideryJob) {
    const data = createEmbroideryJobSchema.parse(input);
    if (data.customerOrderId) {
      await this.assertCustomerOrder(organizationId, data.customerOrderId);
    }
    const jobNumber =
      data.jobNumber?.trim() ||
      `JOB-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 9000 + 1000)}`;
    const stage = data.stage ?? "draft";
    const [row] = await this.db
      .insert(embroideryJobs)
      .values({
        organizationId,
        branchId: data.branchId,
        jobNumber,
        customerId: data.customerId ?? null,
        customerOrderId: data.customerOrderId ?? null,
        designId: data.designId ?? null,
        machineId: data.machineId ?? null,
        operatorUserId: data.operatorUserId ?? null,
        stage,
        dueDate: data.dueDate ?? null,
        pieceRatePkr: data.pieceRatePkr ?? 0,
        materialCostPkr: data.materialCostPkr ?? 0,
        laborCostPkr: data.laborCostPkr ?? 0,
        overheadCostPkr: data.overheadCostPkr ?? 0,
        invoiceAmountPkr: data.invoiceAmountPkr ?? 0,
        invoiceRef: data.invoiceRef ?? null,
        notes: data.notes ?? null,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create job");
    for (const line of data.lines) {
      await this.db.insert(embroideryJobLines).values({
        jobId: row.id,
        sizeLabel: line.sizeLabel,
        colorLabel: line.colorLabel ?? "Default",
        quantity: line.quantity,
        completedQty: 0,
      });
    }
    await this.syncLinkedOrderStatus(organizationId, row.customerOrderId, stage);
    return this.mapJob(row);
  }

  async updateJob(organizationId: string, id: string, input: UpdateEmbroideryJob) {
    const data = updateEmbroideryJobSchema.parse(input);
    if (data.customerOrderId) {
      await this.assertCustomerOrder(organizationId, data.customerOrderId);
    }
    const [existing] = await this.db
      .select()
      .from(embroideryJobs)
      .where(and(eq(embroideryJobs.id, id), eq(embroideryJobs.organizationId, organizationId)))
      .limit(1);
    if (!existing) throw new NotFoundException("Job not found");

    const [row] = await this.db
      .update(embroideryJobs)
      .set({
        ...(data.customerId !== undefined ? { customerId: data.customerId } : {}),
        ...(data.customerOrderId !== undefined ? { customerOrderId: data.customerOrderId } : {}),
        ...(data.designId !== undefined ? { designId: data.designId } : {}),
        ...(data.machineId !== undefined ? { machineId: data.machineId } : {}),
        ...(data.operatorUserId !== undefined ? { operatorUserId: data.operatorUserId } : {}),
        ...(data.stage !== undefined ? { stage: data.stage } : {}),
        ...(data.dueDate !== undefined ? { dueDate: data.dueDate } : {}),
        ...(data.pieceRatePkr !== undefined ? { pieceRatePkr: data.pieceRatePkr } : {}),
        ...(data.materialCostPkr !== undefined ? { materialCostPkr: data.materialCostPkr } : {}),
        ...(data.laborCostPkr !== undefined ? { laborCostPkr: data.laborCostPkr } : {}),
        ...(data.overheadCostPkr !== undefined ? { overheadCostPkr: data.overheadCostPkr } : {}),
        ...(data.invoiceAmountPkr !== undefined ? { invoiceAmountPkr: data.invoiceAmountPkr } : {}),
        ...(data.invoiceRef !== undefined ? { invoiceRef: data.invoiceRef } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(embroideryJobs.id, id), eq(embroideryJobs.organizationId, organizationId)))
      .returning();
    if (!row) throw new NotFoundException("Job not found");

    const orderId = row.customerOrderId ?? existing.customerOrderId;
    await this.syncLinkedOrderStatus(organizationId, orderId, row.stage);
    return this.mapJob(row);
  }

  async deleteJob(organizationId: string, id: string) {
    const [row] = await this.db
      .delete(embroideryJobs)
      .where(and(eq(embroideryJobs.id, id), eq(embroideryJobs.organizationId, organizationId)))
      .returning({ id: embroideryJobs.id });
    if (!row) throw new NotFoundException("Job not found");
    return { ok: true };
  }

  // ── Production board ─────────────────────────────────────

  async productionBoard(organizationId: string, branchId?: string) {
    const jobs = await this.listJobs(organizationId, branchId);
    const machines = await this.listMachines(organizationId, branchId);
    const stages = EMBROIDERY_JOB_STAGES.map((stage) => {
      const stageJobs = jobs.filter((j) => j.stage === stage);
      return { stage, count: stageJobs.length, jobs: stageJobs };
    });
    return { stages, machines };
  }

  // ── Production logs ──────────────────────────────────────

  async listProductionLogs(organizationId: string, jobId?: string, machineId?: string) {
    const conditions = [eq(embroideryProductionLogs.organizationId, organizationId)];
    if (jobId) conditions.push(eq(embroideryProductionLogs.jobId, jobId));
    if (machineId) conditions.push(eq(embroideryProductionLogs.machineId, machineId));
    const rows = await this.db
      .select()
      .from(embroideryProductionLogs)
      .where(and(...conditions))
      .orderBy(desc(embroideryProductionLogs.loggedAt));
    return rows.map((r) => this.mapProductionLog(r));
  }

  async createProductionLog(organizationId: string, input: CreateEmbroideryProductionLog) {
    const data = createEmbroideryProductionLogSchema.parse(input);
    await this.assertJob(organizationId, data.jobId);
    const [row] = await this.db
      .insert(embroideryProductionLogs)
      .values({
        organizationId,
        branchId: data.branchId,
        jobId: data.jobId,
        machineId: data.machineId ?? null,
        operatorUserId: data.operatorUserId ?? null,
        stage: data.stage,
        piecesCompleted: data.piecesCompleted ?? 0,
        hoursWorked: String(data.hoursWorked ?? 0),
        notes: data.notes ?? null,
        loggedAt: data.loggedAt ? new Date(data.loggedAt) : new Date(),
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create production log");
    return this.mapProductionLog(row);
  }

  // ── Materials ────────────────────────────────────────────

  async listMaterialIssues(organizationId: string, jobId?: string) {
    const conditions = [eq(embroideryMaterialIssues.organizationId, organizationId)];
    if (jobId) conditions.push(eq(embroideryMaterialIssues.jobId, jobId));
    const rows = await this.db
      .select()
      .from(embroideryMaterialIssues)
      .where(and(...conditions))
      .orderBy(desc(embroideryMaterialIssues.createdAt));
    return rows.map((r) => this.mapMaterialIssue(r));
  }

  async createMaterialIssue(organizationId: string, input: CreateEmbroideryMaterialIssue) {
    const data = createEmbroideryMaterialIssueSchema.parse(input);
    await this.assertJob(organizationId, data.jobId);
    const customerOwned = data.customerOwned ?? "no";
    const unitCostPkr = data.unitCostPkr ?? 0;
    const [row] = await this.db
      .insert(embroideryMaterialIssues)
      .values({
        organizationId,
        branchId: data.branchId,
        jobId: data.jobId,
        productId: data.productId ?? null,
        itemName: data.itemName,
        quantity: String(data.quantity),
        unit: data.unit ?? "pc",
        customerOwned,
        unitCostPkr,
        notes: data.notes ?? null,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to issue material");

    if (customerOwned !== "yes") {
      const addCost = Math.round(Number(data.quantity) * unitCostPkr);
      if (addCost > 0) {
        await this.db
          .update(embroideryJobs)
          .set({
            materialCostPkr: sql`${embroideryJobs.materialCostPkr} + ${addCost}`,
            updatedAt: new Date(),
          })
          .where(
            and(eq(embroideryJobs.id, data.jobId), eq(embroideryJobs.organizationId, organizationId)),
          );
      }
    }

    return this.mapMaterialIssue(row);
  }

  // ── QC ───────────────────────────────────────────────────

  async listQc(organizationId: string, jobId?: string) {
    const conditions = [eq(embroideryQcRecords.organizationId, organizationId)];
    if (jobId) conditions.push(eq(embroideryQcRecords.jobId, jobId));
    const rows = await this.db
      .select()
      .from(embroideryQcRecords)
      .where(and(...conditions))
      .orderBy(desc(embroideryQcRecords.createdAt));
    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      branchId: r.branchId,
      jobId: r.jobId,
      result: r.result,
      defectCode: r.defectCode,
      quantity: r.quantity,
      notes: r.notes,
      createdAt: iso(r.createdAt)!,
    }));
  }

  async createQc(organizationId: string, input: CreateEmbroideryQcRecord) {
    const data = createEmbroideryQcRecordSchema.parse(input);
    await this.assertJob(organizationId, data.jobId);
    const [row] = await this.db
      .insert(embroideryQcRecords)
      .values({
        organizationId,
        branchId: data.branchId,
        jobId: data.jobId,
        result: data.result,
        defectCode: data.defectCode ?? null,
        quantity: data.quantity ?? 1,
        notes: data.notes ?? null,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create QC record");
    if (data.result === "rework") {
      await this.db
        .update(embroideryJobs)
        .set({ stage: "stitching", updatedAt: new Date() })
        .where(and(eq(embroideryJobs.id, data.jobId), eq(embroideryJobs.organizationId, organizationId)));
      const [job] = await this.db
        .select({ customerOrderId: embroideryJobs.customerOrderId })
        .from(embroideryJobs)
        .where(and(eq(embroideryJobs.id, data.jobId), eq(embroideryJobs.organizationId, organizationId)))
        .limit(1);
      await this.syncLinkedOrderStatus(organizationId, job?.customerOrderId ?? null, "stitching");
    } else if (data.result === "pass") {
      await this.db
        .update(embroideryJobs)
        .set({ stage: "finishing", updatedAt: new Date() })
        .where(and(eq(embroideryJobs.id, data.jobId), eq(embroideryJobs.organizationId, organizationId)));
      const [job] = await this.db
        .select({ customerOrderId: embroideryJobs.customerOrderId })
        .from(embroideryJobs)
        .where(and(eq(embroideryJobs.id, data.jobId), eq(embroideryJobs.organizationId, organizationId)))
        .limit(1);
      await this.syncLinkedOrderStatus(organizationId, job?.customerOrderId ?? null, "finishing");
    }
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      jobId: row.jobId,
      result: row.result,
      defectCode: row.defectCode,
      quantity: row.quantity,
      notes: row.notes,
      createdAt: iso(row.createdAt)!,
    };
  }

  // ── Delivery ─────────────────────────────────────────────

  async listDeliveries(organizationId: string, jobId?: string) {
    const conditions = [eq(embroideryDeliveries.organizationId, organizationId)];
    if (jobId) conditions.push(eq(embroideryDeliveries.jobId, jobId));
    const rows = await this.db
      .select()
      .from(embroideryDeliveries)
      .where(and(...conditions))
      .orderBy(desc(embroideryDeliveries.createdAt));
    return rows.map((r) => this.mapDelivery(r));
  }

  async createDelivery(
    organizationId: string,
    input: CreateEmbroideryDelivery,
    userEmail = "system",
  ) {
    const data = createEmbroideryDeliverySchema.parse(input);
    const job = await this.getJobRow(organizationId, data.jobId);
    const challanNumber =
      data.challanNumber?.trim() ||
      `CH-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 9000 + 1000)}`;
    // Factory-native billing posts via job bills / party ledger — never restaurant AR.
    const invoiceRef = data.invoiceRef?.trim() || null;
    const invoiceAmountPkr = data.invoiceAmountPkr ?? 0;
    void userEmail;
    void data.postInvoiceToAccounting;

    const [row] = await this.db
      .insert(embroideryDeliveries)
      .values({
        organizationId,
        branchId: data.branchId,
        jobId: data.jobId,
        challanNumber,
        deliveredQty: data.deliveredQty,
        deliveredAt: data.deliveredAt ? new Date(data.deliveredAt) : new Date(),
        invoiceRef,
        invoiceAmountPkr,
        notes: data.notes ?? null,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create delivery");
    await this.db
      .update(embroideryJobs)
      .set({
        stage: "delivered",
        invoiceRef,
        invoiceAmountPkr,
        updatedAt: new Date(),
      })
      .where(and(eq(embroideryJobs.id, data.jobId), eq(embroideryJobs.organizationId, organizationId)));
    await this.syncLinkedOrderStatus(organizationId, job.customerOrderId, "delivered");
    return this.mapDelivery(row);
  }

  // ── Piece rate ───────────────────────────────────────────

  async listPieceRates(organizationId: string, jobId?: string) {
    const conditions = [eq(embroideryPieceRateEntries.organizationId, organizationId)];
    if (jobId) conditions.push(eq(embroideryPieceRateEntries.jobId, jobId));
    const rows = await this.db
      .select()
      .from(embroideryPieceRateEntries)
      .where(and(...conditions))
      .orderBy(desc(embroideryPieceRateEntries.createdAt));
    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      branchId: r.branchId,
      jobId: r.jobId,
      operatorUserId: r.operatorUserId,
      pieces: r.pieces,
      ratePkr: r.ratePkr,
      amountPkr: r.amountPkr,
      workDate: r.workDate,
      notes: r.notes,
      createdAt: iso(r.createdAt)!,
    }));
  }

  async createPieceRate(organizationId: string, input: CreateEmbroideryPieceRateEntry) {
    const data = createEmbroideryPieceRateEntrySchema.parse(input);
    await this.assertJob(organizationId, data.jobId);
    const amountPkr = data.pieces * data.ratePkr;
    const workDate = data.workDate?.trim() || new Date().toISOString().slice(0, 10);
    const [row] = await this.db
      .insert(embroideryPieceRateEntries)
      .values({
        organizationId,
        branchId: data.branchId,
        jobId: data.jobId,
        operatorUserId: data.operatorUserId ?? null,
        pieces: data.pieces,
        ratePkr: data.ratePkr,
        amountPkr,
        workDate,
        notes: data.notes ?? null,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create piece-rate entry");
    if (amountPkr > 0) {
      await this.db
        .update(embroideryJobs)
        .set({
          laborCostPkr: sql`${embroideryJobs.laborCostPkr} + ${amountPkr}`,
          updatedAt: new Date(),
        })
        .where(
          and(eq(embroideryJobs.id, data.jobId), eq(embroideryJobs.organizationId, organizationId)),
        );
    }
    return {
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      jobId: row.jobId,
      operatorUserId: row.operatorUserId,
      pieces: row.pieces,
      ratePkr: row.ratePkr,
      amountPkr: row.amountPkr,
      workDate: row.workDate,
      notes: row.notes,
      createdAt: iso(row.createdAt)!,
    };
  }

  // ── Reports summary ──────────────────────────────────────

  async reportsSummary(organizationId: string, branchId?: string) {
    const jobs = await this.listJobs(organizationId, branchId);
    const machines = await this.listMachines(organizationId, branchId);
    const pieceRates = await this.listPieceRates(organizationId);
    const openJobs = jobs.filter((j) => !["delivered", "cancelled", "ready"].includes(j.stage));
    const totalPieces = jobs.reduce(
      (sum, j) => sum + j.lines.reduce((s, l) => s + l.quantity, 0),
      0,
    );
    const completedPieces = jobs.reduce(
      (sum, j) => sum + j.lines.reduce((s, l) => s + l.completedQty, 0),
      0,
    );
    const pieceRateTotal = pieceRates.reduce((sum, p) => sum + p.amountPkr, 0);
    return {
      jobCount: jobs.length,
      openJobCount: openJobs.length,
      machineCount: machines.length,
      runningMachines: machines.filter((m) => m.status === "running").length,
      totalPieces,
      completedPieces,
      pieceRateTotalPkr: pieceRateTotal,
      byStage: EMBROIDERY_JOB_STAGES.map((stage) => ({
        stage,
        count: jobs.filter((j) => j.stage === stage).length,
      })),
    };
  }

  // ── Helpers ──────────────────────────────────────────────

  private async assertJob(organizationId: string, jobId: string) {
    await this.getJobRow(organizationId, jobId);
  }

  private async getJobRow(organizationId: string, jobId: string) {
    const [row] = await this.db
      .select()
      .from(embroideryJobs)
      .where(and(eq(embroideryJobs.id, jobId), eq(embroideryJobs.organizationId, organizationId)))
      .limit(1);
    if (!row) throw new NotFoundException("Job not found");
    return row;
  }

  private async assertCustomerOrder(organizationId: string, orderId: string) {
    const [row] = await this.db
      .select({ id: embroideryCustomerOrders.id })
      .from(embroideryCustomerOrders)
      .where(
        and(
          eq(embroideryCustomerOrders.id, orderId),
          eq(embroideryCustomerOrders.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException("Customer order not found");
  }

  private async syncLinkedOrderStatus(
    organizationId: string,
    customerOrderId: string | null | undefined,
    jobStage: string,
  ) {
    if (!customerOrderId) return;
    let status: string | null = null;
    if (jobStage === "delivered") status = "completed";
    else if (PRODUCTION_STAGES.has(jobStage) || jobStage === "stitching") status = "in_production";
    if (!status) return;
    await this.db
      .update(embroideryCustomerOrders)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(embroideryCustomerOrders.id, customerOrderId),
          eq(embroideryCustomerOrders.organizationId, organizationId),
        ),
      );
  }

  private mapDesign(r: typeof embroideryDesigns.$inferSelect) {
    return {
      id: r.id,
      organizationId: r.organizationId,
      branchId: r.branchId,
      code: r.code,
      name: r.name,
      customerId: r.customerId,
      stitchCount: r.stitchCount,
      colorways: r.colorways,
      fileName: r.fileName,
      hasFile: Boolean(r.fileContentBase64),
      fileMimeType: r.fileMimeType ?? null,
      notes: r.notes,
      createdAt: iso(r.createdAt)!,
      updatedAt: iso(r.updatedAt)!,
    };
  }

  private mapMachine(r: typeof embroideryMachines.$inferSelect) {
    return {
      id: r.id,
      organizationId: r.organizationId,
      branchId: r.branchId,
      code: r.code,
      name: r.name,
      heads: r.heads,
      status: r.status,
      operatorUserId: r.operatorUserId,
      notes: r.notes,
      createdAt: iso(r.createdAt)!,
      updatedAt: iso(r.updatedAt)!,
    };
  }

  private mapCustomerOrder(r: typeof embroideryCustomerOrders.$inferSelect) {
    return {
      id: r.id,
      organizationId: r.organizationId,
      branchId: r.branchId,
      orderNumber: r.orderNumber,
      customerId: r.customerId,
      designId: r.designId,
      status: r.status,
      dueDate: r.dueDate,
      quantity: r.quantity,
      notes: r.notes,
      createdAt: iso(r.createdAt)!,
      updatedAt: iso(r.updatedAt)!,
    };
  }

  private mapMaterialIssue(r: typeof embroideryMaterialIssues.$inferSelect) {
    return {
      id: r.id,
      organizationId: r.organizationId,
      branchId: r.branchId,
      jobId: r.jobId,
      productId: r.productId,
      itemName: r.itemName,
      quantity: Number(r.quantity),
      unit: r.unit,
      customerOwned: r.customerOwned,
      unitCostPkr: r.unitCostPkr,
      notes: r.notes,
      createdAt: iso(r.createdAt)!,
    };
  }

  private mapDelivery(r: typeof embroideryDeliveries.$inferSelect) {
    return {
      id: r.id,
      organizationId: r.organizationId,
      branchId: r.branchId,
      jobId: r.jobId,
      challanNumber: r.challanNumber,
      deliveredQty: r.deliveredQty,
      deliveredAt: iso(r.deliveredAt)!,
      invoiceRef: r.invoiceRef,
      invoiceAmountPkr: r.invoiceAmountPkr,
      notes: r.notes,
      createdAt: iso(r.createdAt)!,
    };
  }

  private mapProductionLog(r: typeof embroideryProductionLogs.$inferSelect) {
    return {
      id: r.id,
      organizationId: r.organizationId,
      branchId: r.branchId,
      jobId: r.jobId,
      machineId: r.machineId,
      operatorUserId: r.operatorUserId,
      stage: r.stage,
      piecesCompleted: r.piecesCompleted,
      hoursWorked: Number(r.hoursWorked),
      notes: r.notes,
      loggedAt: iso(r.loggedAt)!,
    };
  }

  private async mapJob(r: typeof embroideryJobs.$inferSelect) {
    const lines = await this.db
      .select()
      .from(embroideryJobLines)
      .where(eq(embroideryJobLines.jobId, r.id));
    return {
      id: r.id,
      organizationId: r.organizationId,
      branchId: r.branchId,
      jobNumber: r.jobNumber,
      customerId: r.customerId,
      customerOrderId: r.customerOrderId,
      designId: r.designId,
      machineId: r.machineId,
      operatorUserId: r.operatorUserId,
      stage: r.stage,
      dueDate: r.dueDate,
      pieceRatePkr: r.pieceRatePkr,
      materialCostPkr: r.materialCostPkr,
      laborCostPkr: r.laborCostPkr,
      overheadCostPkr: r.overheadCostPkr,
      invoiceAmountPkr: r.invoiceAmountPkr,
      invoiceRef: r.invoiceRef,
      notes: r.notes,
      createdAt: iso(r.createdAt)!,
      updatedAt: iso(r.updatedAt)!,
      lines: lines.map((l) => ({
        id: l.id,
        jobId: l.jobId,
        sizeLabel: l.sizeLabel,
        colorLabel: l.colorLabel,
        quantity: l.quantity,
        completedQty: l.completedQty,
      })),
    };
  }
}
