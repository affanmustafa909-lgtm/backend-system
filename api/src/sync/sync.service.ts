import { ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { createStoreSaleSchema, type SyncPushBatch } from "@platform/contracts";
import { StoreService } from "../store/store.service";

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(private readonly store: StoreService) {}

  async push(
    actorOrganizationId: string,
    batch: SyncPushBatch,
  ): Promise<{ accepted: true; processed: number }> {
    if (batch.organizationId !== actorOrganizationId) {
      throw new ForbiddenException("organization mismatch");
    }

    let processed = 0;

    for (const mutation of batch.mutations) {
      try {
        if (mutation.entityType === "store_sale" && mutation.operation === "create") {
          const input = createStoreSaleSchema.parse(mutation.payload);
          await this.store.createSale(actorOrganizationId, input);
          processed += 1;
          continue;
        }

        this.logger.warn(
          `Unsupported sync mutation: ${mutation.entityType}/${mutation.operation} (${mutation.clientMutationId})`,
        );
      } catch (err) {
        this.logger.error(
          `Sync mutation failed: ${mutation.entityType}/${mutation.operation} (${mutation.clientMutationId})`,
          err instanceof Error ? err.stack : String(err),
        );
        throw err;
      }
    }

    return { accepted: true, processed };
  }
}
