import { BadRequestException } from "@nestjs/common";
import { and, eq, ne, sql } from "drizzle-orm";
import { popsBills, popsKitchenTickets, type PlatformPgDb } from "@platform/database-pg";

export type TableBooking = {
  orderRef: string | null;
  source: "kitchen" | "bill";
  ticketId?: string;
  billId?: string;
};

export function normalizeTableLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isDineInTableLabel(label: string): boolean {
  return /^table\s+.+/i.test(label.trim());
}

export function dineInTableLabel(tableNumber: string): string {
  return `Table ${tableNumber.trim()}`;
}

function orderRefsMatch(a?: string | null, b?: string | null): boolean {
  if (!a?.trim() || !b?.trim()) return false;
  return a.trim() === b.trim();
}

export async function findTableBooking(
  db: PlatformPgDb,
  branchId: string,
  tableLabel: string,
  opts?: { excludeTicketId?: string; excludeBillId?: string },
): Promise<TableBooking | null> {
  if (!isDineInTableLabel(tableLabel)) return null;
  const normalized = normalizeTableLabel(tableLabel);

  const tickets = await db
    .select({
      id: popsKitchenTickets.id,
      orderRef: popsKitchenTickets.orderRef,
      stationLabel: popsKitchenTickets.stationLabel,
    })
    .from(popsKitchenTickets)
    .where(
      and(
        eq(popsKitchenTickets.branchId, branchId),
        ne(popsKitchenTickets.status, "done"),
        sql`lower(trim(${popsKitchenTickets.stationLabel})) = ${normalized}`,
      ),
    );

  for (const ticket of tickets) {
    if (opts?.excludeTicketId && ticket.id === opts.excludeTicketId) continue;
    return {
      orderRef: ticket.orderRef,
      source: "kitchen",
      ticketId: ticket.id,
    };
  }

  const heldBills = await db
    .select({
      id: popsBills.id,
      orderRef: popsBills.orderRef,
      tableLabel: popsBills.tableLabel,
    })
    .from(popsBills)
    .where(
      and(
        eq(popsBills.branchId, branchId),
        eq(popsBills.status, "held"),
        sql`lower(trim(${popsBills.tableLabel})) = ${normalized}`,
      ),
    );

  for (const bill of heldBills) {
    if (opts?.excludeBillId && bill.id === opts.excludeBillId) continue;
    return {
      orderRef: bill.orderRef,
      source: "bill",
      billId: bill.id,
    };
  }

  return null;
}

export async function loadBranchTableBookings(
  db: PlatformPgDb,
  branchId: string,
): Promise<Map<string, TableBooking>> {
  const map = new Map<string, TableBooking>();

  const tickets = await db
    .select({
      id: popsKitchenTickets.id,
      orderRef: popsKitchenTickets.orderRef,
      stationLabel: popsKitchenTickets.stationLabel,
    })
    .from(popsKitchenTickets)
    .where(
      and(eq(popsKitchenTickets.branchId, branchId), ne(popsKitchenTickets.status, "done")),
    );

  for (const ticket of tickets) {
    if (!isDineInTableLabel(ticket.stationLabel)) continue;
    const key = normalizeTableLabel(ticket.stationLabel);
    if (map.has(key)) continue;
    map.set(key, {
      orderRef: ticket.orderRef,
      source: "kitchen",
      ticketId: ticket.id,
    });
  }

  const heldBills = await db
    .select({
      id: popsBills.id,
      orderRef: popsBills.orderRef,
      tableLabel: popsBills.tableLabel,
    })
    .from(popsBills)
    .where(and(eq(popsBills.branchId, branchId), eq(popsBills.status, "held")));

  for (const bill of heldBills) {
    if (!isDineInTableLabel(bill.tableLabel)) continue;
    const key = normalizeTableLabel(bill.tableLabel);
    if (map.has(key)) continue;
    map.set(key, {
      orderRef: bill.orderRef,
      source: "bill",
      billId: bill.id,
    });
  }

  return map;
}

/**
 * Blocks a new dine-in order on a booked table until the current order is
 * printed/closed (completed bill) or confirmed/completed (kitchen done / held cleared).
 *
 * `intent: "close"` allows settling payment on a table that still has an open kitchen ticket.
 */
export async function assertDineInTableAvailable(
  db: PlatformPgDb,
  branchId: string,
  tableLabel: string,
  opts?: {
    allowOrderRef?: string | null;
    excludeTicketId?: string;
    excludeBillId?: string;
    intent?: "new-order" | "close";
  },
): Promise<void> {
  if (!isDineInTableLabel(tableLabel)) return;

  const booking = await findTableBooking(db, branchId, tableLabel, {
    excludeTicketId: opts?.excludeTicketId,
    excludeBillId: opts?.excludeBillId,
  });
  if (!booking) return;

  if (orderRefsMatch(opts?.allowOrderRef, booking.orderRef)) return;

  if (opts?.intent === "close") {
    if (booking.source === "kitchen") {
      if (
        booking.orderRef &&
        opts.allowOrderRef?.trim() &&
        !orderRefsMatch(opts.allowOrderRef, booking.orderRef)
      ) {
        throw bookedTableError(tableLabel, booking.orderRef);
      }
      return;
    }
    throw bookedTableError(tableLabel, booking.orderRef);
  }

  throw bookedTableError(tableLabel, booking.orderRef);
}

function bookedTableError(tableLabel: string, orderRef: string | null): BadRequestException {
  const ref = orderRef?.trim();
  return new BadRequestException(
    ref
      ? `${tableLabel} is booked by order ${ref}. Close or complete that order before starting a new one.`
      : `${tableLabel} is booked. Close or complete the current order before starting a new one.`,
  );
}
