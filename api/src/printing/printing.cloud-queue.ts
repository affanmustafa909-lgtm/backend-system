import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";

type CloudPrintJobPayload = {
  organizationId: string;
  jobId: string;
  branchCode: string;
};

/**
 * Optional Redis/BullMQ cloud orchestration.
 * BullMQ is not a hard dependency — jobs stay Postgres/in-memory so the API builds
 * and boots without redis/bullmq installed. Branch server still executes locally.
 */
@Injectable()
export class PrintingCloudQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrintingCloudQueue.name);
  private ready = false;
  private memory: CloudPrintJobPayload[] = [];

  async onModuleInit(): Promise<void> {
    const redisUrl = process.env.REDIS_URL?.trim();
    if (redisUrl) {
      this.logger.log(
        "REDIS_URL set but bullmq is not bundled — using in-memory cloud print queue fallback",
      );
    } else {
      this.logger.log("REDIS_URL not set — using in-memory cloud print queue fallback");
    }
    this.ready = true;
  }

  async onModuleDestroy(): Promise<void> {
    this.memory = [];
  }

  isReady(): boolean {
    return this.ready;
  }

  async enqueue(payload: CloudPrintJobPayload): Promise<void> {
    this.memory.push(payload);
    if (this.memory.length > 500) this.memory.shift();
  }
}
