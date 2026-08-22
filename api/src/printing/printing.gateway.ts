import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrintingEvents } from "./printing.events";

/**
 * Socket.IO gateway shim.
 * Socket packages are optional and not bundled — realtime clients use
 * `GET /v1/printing/events` (SSE).
 */
@Injectable()
export class PrintingGateway implements OnModuleInit {
  private readonly logger = new Logger(PrintingGateway.name);

  constructor(private readonly events: PrintingEvents) {}

  async onModuleInit(): Promise<void> {
    this.logger.log("Using SSE /v1/printing/events for print realtime (Socket.IO not bundled)");
    this.events.on("*", (msg) => {
      this.logger.debug(`print event ${(msg as { event?: string }).event ?? "?"}`);
    });
  }
}
