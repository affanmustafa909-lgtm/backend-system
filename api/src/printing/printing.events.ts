import { Injectable } from "@nestjs/common";
import { EventEmitter } from "node:events";
import type { PrintWsEvent } from "@platform/contracts";

export type PrintingEventPayload = Record<string, unknown> & {
  organizationId: string;
};

/**
 * In-process + Socket.IO fan-out for printing realtime events.
 * Socket.IO gateway (when available) subscribes via `on`.
 */
@Injectable()
export class PrintingEvents {
  private readonly bus = new EventEmitter();

  constructor() {
    this.bus.setMaxListeners(50);
  }

  emit(event: PrintWsEvent, payload: PrintingEventPayload): void {
    this.bus.emit(event, payload);
    this.bus.emit("*", { event, payload });
  }

  on(event: PrintWsEvent | "*", listener: (payload: PrintingEventPayload | { event: PrintWsEvent; payload: PrintingEventPayload }) => void): void {
    this.bus.on(event, listener as (...args: unknown[]) => void);
  }

  off(event: PrintWsEvent | "*", listener: (...args: unknown[]) => void): void {
    this.bus.off(event, listener);
  }
}
