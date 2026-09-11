import { ForbiddenException, Inject, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  createStoreSaleSchema,
  type SyncPushBatch,
  type SyncRegisterDevice,
} from "@platform/contracts";
import {
  organizations,
  pharmacyMedicines,
  popsBranches,
  storeProducts,
  syncAppliedMutations,
  syncDevices,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../drizzle/drizzle.tokens";
import { StoreService } from "../store/store.service";

const PROTOCOL = 1;
const PULL_LIMIT = 200;

export type SyncMutationResult = {
  clientMutationId: string;
  status: "synced" | "failed" | "conflict" | "duplicate" | "unsupported";
  error?: string;
};

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly store: StoreService,
  ) {}

  async push(
    actorOrganizationId: string,
    actorUserId: string,
    batch: SyncPushBatch,
  ): Promise<{ accepted: true; protocolVersion: number; processed: number; results: SyncMutationResult[] }> {
    if (batch.organizationId !== actorOrganizationId) {
      throw new ForbiddenException("organization mismatch");
    }
    if (batch.deviceId) {
      await this.assertDeviceActive(actorOrganizationId, batch.deviceId);
    }

    const results: SyncMutationResult[] = [];
    let processed = 0;

    for (const mutation of batch.mutations) {
      const already = await this.db
        .select({ id: syncAppliedMutations.id })
        .from(syncAppliedMutations)
        .where(
          and(
            eq(syncAppliedMutations.organizationId, actorOrganizationId),
            eq(syncAppliedMutations.clientMutationId, mutation.clientMutationId),
          ),
        )
        .limit(1);
      if (already[0]) {
        results.push({ clientMutationId: mutation.clientMutationId, status: "duplicate" });
        continue;
      }

      try {
        if (mutation.entityType === "store_sale" && mutation.operation === "create") {
          const input = createStoreSaleSchema.parse(mutation.payload);
          await this.store.createSale(actorOrganizationId, input);
          await this.rememberApplied(actorOrganizationId, batch.idempotencyKey, mutation, input as { id?: string });
          processed += 1;
          results.push({ clientMutationId: mutation.clientMutationId, status: "synced" });
          continue;
        }

        results.push({
          clientMutationId: mutation.clientMutationId,
          status: "unsupported",
          error: `${mutation.entityType}/${mutation.operation} is not on the sync gateway. Use the domain API.`,
        });
        this.logger.warn(`Unsupported sync mutation: ${mutation.entityType}/${mutation.operation}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Sync mutation failed: ${mutation.entityType}/${mutation.operation}`, message);
        results.push({ clientMutationId: mutation.clientMutationId, status: "failed", error: message });
      }
    }

    if (batch.deviceId) {
      await this.touchDevice(actorOrganizationId, actorUserId, batch.deviceId);
    }

    return { accepted: true, protocolVersion: PROTOCOL, processed, results };
  }

  async pull(organizationId: string, cursor?: string) {
    const since = cursor && !Number.isNaN(Date.parse(cursor)) ? new Date(cursor) : null;
    const changes: Array<{
      entityType: string;
      operation: "upsert";
      id: string;
      payload: Record<string, unknown>;
      serverUpdatedAt: string;
    }> = [];

    const [org] = await this.db
      .select({
        id: organizations.id,
        name: organizations.name,
        systemType: organizations.systemType,
        status: organizations.status,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (org) {
      changes.push({
        entityType: "organization",
        operation: "upsert",
        id: org.id,
        payload: org,
        serverUpdatedAt: new Date().toISOString(),
      });
    }

    const branchRows = await this.db
      .select({
        id: popsBranches.id,
        code: popsBranches.code,
        name: popsBranches.name,
        city: popsBranches.city,
        createdAt: popsBranches.createdAt,
      })
      .from(popsBranches)
      .where(
        since
          ? and(eq(popsBranches.organizationId, organizationId), gte(popsBranches.createdAt, since))
          : eq(popsBranches.organizationId, organizationId),
      )
      .orderBy(desc(popsBranches.createdAt))
      .limit(PULL_LIMIT);
    for (const row of branchRows) {
      changes.push({
        entityType: "branch",
        operation: "upsert",
        id: row.id,
        payload: row,
        serverUpdatedAt: row.createdAt.toISOString(),
      });
    }

    const medicineRows = await this.db
      .select({
        id: pharmacyMedicines.id,
        sku: pharmacyMedicines.sku,
        name: pharmacyMedicines.name,
        barcode: pharmacyMedicines.barcode,
        status: pharmacyMedicines.status,
        createdAt: pharmacyMedicines.createdAt,
      })
      .from(pharmacyMedicines)
      .where(
        since
          ? and(eq(pharmacyMedicines.organizationId, organizationId), gte(pharmacyMedicines.createdAt, since))
          : eq(pharmacyMedicines.organizationId, organizationId),
      )
      .orderBy(desc(pharmacyMedicines.createdAt))
      .limit(PULL_LIMIT);
    for (const row of medicineRows) {
      changes.push({
        entityType: "medicine",
        operation: "upsert",
        id: row.id,
        payload: row,
        serverUpdatedAt: row.createdAt.toISOString(),
      });
    }

    const productRows = await this.db
      .select({
        id: storeProducts.id,
        sku: storeProducts.sku,
        name: storeProducts.name,
        barcode: storeProducts.barcode,
        createdAt: storeProducts.createdAt,
      })
      .from(storeProducts)
      .where(
        since
          ? and(eq(storeProducts.organizationId, organizationId), gte(storeProducts.createdAt, since))
          : eq(storeProducts.organizationId, organizationId),
      )
      .orderBy(desc(storeProducts.createdAt))
      .limit(PULL_LIMIT);
    for (const row of productRows) {
      changes.push({
        entityType: "store_product",
        operation: "upsert",
        id: row.id,
        payload: row,
        serverUpdatedAt: row.createdAt.toISOString(),
      });
    }

    return {
      protocolVersion: PROTOCOL,
      cursor: new Date().toISOString(),
      changes,
      truncated: branchRows.length >= PULL_LIMIT || medicineRows.length >= PULL_LIMIT || productRows.length >= PULL_LIMIT,
    };
  }

  async status(organizationId: string) {
    const [applied] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(syncAppliedMutations)
      .where(eq(syncAppliedMutations.organizationId, organizationId));
    const devices = await this.db
      .select({
        deviceId: syncDevices.deviceId,
        status: syncDevices.status,
        lastSeenAt: syncDevices.lastSeenAt,
        deviceName: syncDevices.deviceName,
      })
      .from(syncDevices)
      .where(eq(syncDevices.organizationId, organizationId));
    return {
      protocolVersion: PROTOCOL,
      appliedMutations: applied?.n ?? 0,
      devices,
    };
  }

  async registerDevice(organizationId: string, userId: string, input: SyncRegisterDevice) {
    const existing = await this.db
      .select()
      .from(syncDevices)
      .where(and(eq(syncDevices.organizationId, organizationId), eq(syncDevices.deviceId, input.deviceId)))
      .limit(1);
    if (existing[0]?.status === "revoked") {
      throw new UnauthorizedException("Device authorization revoked. Sign in online again.");
    }
    if (existing[0]) {
      await this.db
        .update(syncDevices)
        .set({
          userId,
          deviceName: input.deviceName ?? existing[0].deviceName,
          appVersion: input.appVersion ?? existing[0].appVersion,
          platform: input.platform ?? existing[0].platform,
          lastSeenAt: new Date(),
        })
        .where(eq(syncDevices.id, existing[0].id));
      return { deviceId: input.deviceId, status: "active" as const, created: false };
    }
    await this.db.insert(syncDevices).values({
      organizationId,
      userId,
      deviceId: input.deviceId,
      deviceName: input.deviceName,
      appVersion: input.appVersion,
      platform: input.platform,
      status: "active",
    });
    return { deviceId: input.deviceId, status: "active" as const, created: true };
  }

  async initialize(organizationId: string, userId: string, deviceId?: string) {
    if (deviceId) await this.registerDevice(organizationId, userId, { deviceId });
    const pull = await this.pull(organizationId);
    return {
      ...pull,
      offlineReadyHint: "Initial catalog slice downloaded. Scoped pull — not the entire ERP.",
    };
  }

  async resolve(_organizationId: string, conflictId: string, choice: "keep_local" | "keep_cloud") {
    return { conflictId, choice, recorded: true };
  }

  private async rememberApplied(
    organizationId: string,
    idempotencyKey: string,
    mutation: SyncPushBatch["mutations"][number],
    payload: { id?: string },
  ) {
    try {
      await this.db.insert(syncAppliedMutations).values({
        organizationId,
        idempotencyKey: `${idempotencyKey}:${mutation.clientMutationId}`,
        clientMutationId: mutation.clientMutationId,
        entityType: mutation.entityType,
        entityId: typeof payload.id === "string" ? payload.id : null,
        resultJson: JSON.stringify({ ok: true }),
      });
    } catch {
      /* unique race — treat as duplicate */
    }
  }

  private async assertDeviceActive(organizationId: string, deviceId: string) {
    const [row] = await this.db
      .select({ status: syncDevices.status })
      .from(syncDevices)
      .where(and(eq(syncDevices.organizationId, organizationId), eq(syncDevices.deviceId, deviceId)))
      .limit(1);
    if (row?.status === "revoked") {
      throw new UnauthorizedException("Device authorization revoked. Sign in online again.");
    }
  }

  private async touchDevice(organizationId: string, userId: string, deviceId: string) {
    const [row] = await this.db
      .select({ id: syncDevices.id })
      .from(syncDevices)
      .where(and(eq(syncDevices.organizationId, organizationId), eq(syncDevices.deviceId, deviceId)))
      .limit(1);
    if (row) {
      await this.db.update(syncDevices).set({ lastSeenAt: new Date(), userId }).where(eq(syncDevices.id, row.id));
    }
  }
}
