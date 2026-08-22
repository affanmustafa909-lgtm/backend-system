import { z } from "zod";

// Duplicated (not imported) from ./kitchen to avoid a circular import —
// kitchen.ts already imports deliveryStatusSchema from this file.
const deliveryOrderLineSchema = z.object({
  label: z.string(),
  qty: z.number().int().positive(),
  unitPrice: z.number().int().nonnegative(),
  menuItemId: z.string().uuid().optional(),
});

export const DELIVERY_STATUS_VALUES = [
  "unassigned",
  "assigned",
  "out_for_delivery",
  "delivered",
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUS_VALUES)[number];

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  unassigned: "Unassigned",
  assigned: "Assigned",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
};

export const deliveryStatusSchema = z.enum(DELIVERY_STATUS_VALUES);

export const riderSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  branchCode: z.string(),
  email: z.string().nullable(),
  name: z.string(),
  phone: z.string().nullable(),
  cnic: z.string().nullable(),
  salaryPkr: z.number().int().nonnegative().nullable(),
  fromArea: z.string().nullable(),
  notes: z.string().nullable(),
  active: z.boolean(),
});

export const riderListSchema = z.object({
  branchCode: z.string(),
  riders: z.array(riderSchema),
});

export const createRiderSchema = z.object({
  branchCode: z.string().min(1),
  name: z.string().min(1).max(80),
  email: z.string().email().min(3).max(320),
  password: z.string().min(8).max(128),
  /** 4-digit PIN for mobile rider app quick login. */
  pin: z.string().regex(/^\d{4}$/).optional(),
  phone: z.string().max(32).optional(),
  cnic: z.string().max(20).optional(),
  salaryPkr: z.number().int().min(0).optional(),
  fromArea: z.string().max(120).optional(),
  notes: z.string().max(500).optional(),
});

export const updateRiderSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  phone: z.string().max(32).nullable().optional(),
  cnic: z.string().max(20).nullable().optional(),
  salaryPkr: z.number().int().min(0).nullable().optional(),
  fromArea: z.string().max(120).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  active: z.boolean().optional(),
  email: z.string().email().min(3).max(320).optional(),
  password: z.string().min(8).max(128).optional(),
  /** Set or replace the 4-digit mobile login PIN. */
  pin: z.string().regex(/^\d{4}$/).optional(),
});

export const updateDeliveryOrderSchema = z.object({
  riderId: z.string().uuid().nullable().optional(),
  deliveryChargePkr: z.number().int().min(0).max(50_000).optional(),
  deliveryStatus: deliveryStatusSchema.optional(),
});

export const deliveryOrderSchema = z.object({
  id: z.string().uuid(),
  ticketRef: z.string(),
  orderRef: z.string().nullable(),
  stationLabel: z.string(),
  itemsSummary: z.string(),
  lines: z.array(deliveryOrderLineSchema).optional(),
  notes: z.string().nullable(),
  priority: z.enum(["normal", "priority"]),
  status: z.enum(["new", "cooking", "ready", "done"]),
  mins: z.number().int().nonnegative(),
  startedAt: z.string().nullable(),
  createdAt: z.string(),
  riderId: z.string().uuid().nullable(),
  riderName: z.string().nullable(),
  deliveryChargePkr: z.number(),
  deliveryStatus: deliveryStatusSchema.nullable(),
  customerName: z.string(),
  customerAddress: z.string(),
});

export const deliveryOrderListSchema = z.object({
  branchCode: z.string(),
  orders: z.array(deliveryOrderSchema),
});

export const riderDeliveryStatusUpdateSchema = z.object({
  deliveryStatus: z.enum(["out_for_delivery", "delivered"]),
});

export type Rider = z.infer<typeof riderSchema>;
export type CreateRider = z.infer<typeof createRiderSchema>;
export type UpdateRider = z.infer<typeof updateRiderSchema>;
export type UpdateDeliveryOrder = z.infer<typeof updateDeliveryOrderSchema>;
export type DeliveryOrder = z.infer<typeof deliveryOrderSchema>;
export type RiderDeliveryStatusUpdate = z.infer<typeof riderDeliveryStatusUpdateSchema>;
