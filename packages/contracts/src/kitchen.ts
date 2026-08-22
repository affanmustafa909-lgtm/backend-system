import { z } from "zod";

import { deliveryStatusSchema } from "./delivery";

export const kitchenTicketStatusSchema = z.enum(["new", "cooking", "ready", "done"]);
export const kitchenTicketPrioritySchema = z.enum(["normal", "priority"]);

export const kitchenTicketLineSchema = z.object({
  label: z.string(),
  qty: z.number().int().positive(),
  unitPrice: z.coerce.number().nonnegative().default(0),
  // Coerce blank / non-UUID ids away so one bad line never blanks the whole ticket list.
  menuItemId: z.preprocess(
    (value) => (typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined),
    z.string().uuid().optional(),
  ),
});

export const kitchenTicketSchema = z.object({
  id: z.string().uuid(),
  ticketRef: z.string(),
  orderRef: z.string().nullable(),
  stationLabel: z.string(),
  itemsSummary: z.string(),
  lines: z.array(kitchenTicketLineSchema).optional(),
  notes: z.string().nullable().optional(),
  priority: kitchenTicketPrioritySchema,
  status: kitchenTicketStatusSchema,
  mins: z.coerce.number().int().nonnegative(),
  startedAt: z.string().nullable(),
  createdAt: z.string(),
  riderId: z.string().uuid().nullable(),
  riderName: z.string().nullable(),
  deliveryChargePkr: z.coerce.number(),
  deliveryStatus: deliveryStatusSchema.nullable(),
  /** Waiter/user who took the order. Null for legacy tickets or desktop counter orders. */
  createdById: z.string().uuid().nullable().optional(),
  createdByName: z.string().nullable().optional(),
});

export const kitchenTicketListSchema = z.object({
  branchCode: z.string(),
  tickets: z.array(kitchenTicketSchema),
});

export const createKitchenTicketSchema = z.object({
  branchCode: z.string().min(1),
  orderRef: z.string().max(32).optional(),
  stationLabel: z.string().min(1).max(64),
  lines: z.array(
    z.object({
      label: z.string().min(1),
      qty: z.number().int().positive(),
      unitPrice: z.number().int().nonnegative().optional(),
      menuItemId: z.string().uuid().optional(),
    }),
  ).min(1),
  notes: z.string().max(500).optional(),
  priority: kitchenTicketPrioritySchema.optional(),
  riderId: z.string().uuid().optional(),
  deliveryChargePkr: z.number().int().min(0).max(50_000).optional(),
});

export const updateKitchenTicketSchema = z.object({
  status: kitchenTicketStatusSchema.optional(),
  priority: kitchenTicketPrioritySchema.optional(),
  /** Dine-in table / station label (e.g. "Table T3"). */
  stationLabel: z.string().min(1).max(64).optional(),
  riderId: z.string().uuid().nullable().optional(),
  deliveryChargePkr: z.number().int().min(0).max(50_000).optional(),
  deliveryStatus: deliveryStatusSchema.optional(),
  lines: z
    .array(
      z.object({
        label: z.string().min(1),
        qty: z.number().int().positive(),
        unitPrice: z.number().int().nonnegative().optional(),
        menuItemId: z.string().uuid().optional(),
      }),
    )
    .min(1)
    .optional(),
  notes: z.string().max(500).nullable().optional(),
  /**
   * When true with status "done", log remaining unpaid kitchen lines as cancellations
   * (Latest orders → Close). Kitchen "mark done" must omit this.
   */
  recordAsCancellation: z.boolean().optional(),
});

export type KitchenTicket = z.infer<typeof kitchenTicketSchema>;
export type KitchenTicketStatus = z.infer<typeof kitchenTicketStatusSchema>;
export type CreateKitchenTicket = z.infer<typeof createKitchenTicketSchema>;
export type UpdateKitchenTicket = z.infer<typeof updateKitchenTicketSchema>;

/** Line canceled after it was already sent to kitchen (qty reduced or removed on KOT edit). */
export const kitchenLineCancellationSchema = z.object({
  id: z.string().uuid(),
  ticketId: z.string().uuid(),
  ticketRef: z.string(),
  orderRef: z.string().nullable(),
  stationLabel: z.string(),
  menuItemId: z.string().uuid().nullable(),
  label: z.string(),
  qtyCanceled: z.number().int().positive(),
  unitPricePkr: z.number().int().nonnegative(),
  amountPkr: z.number().int().nonnegative(),
  ticketStatusAtCancel: kitchenTicketStatusSchema,
  canceledByName: z.string().nullable(),
  source: z.string(),
  canceledAt: z.string(),
});

export const kitchenLineCancellationListSchema = z.object({
  branchCode: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  totalQtyCanceled: z.number().int().nonnegative(),
  totalAmountPkr: z.number().int().nonnegative(),
  cancellations: z.array(kitchenLineCancellationSchema),
});

export type KitchenLineCancellation = z.infer<typeof kitchenLineCancellationSchema>;
export type KitchenLineCancellationList = z.infer<typeof kitchenLineCancellationListSchema>;
