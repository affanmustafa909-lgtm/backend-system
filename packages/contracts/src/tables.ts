import { z } from "zod";

export const seatingSectionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  sortOrder: z.number(),
  isActive: z.boolean(),
});

export const tableBookingStatusSchema = z.enum(["free", "booked"]);

export const restaurantTableSchema = z.object({
  id: z.string().uuid(),
  sectionId: z.string().uuid(),
  tableNumber: z.string(),
  seats: z.number().int().positive(),
  sortOrder: z.number(),
  isActive: z.boolean(),
  /** Present on floor reads — table is booked while an open order occupies it. */
  bookingStatus: tableBookingStatusSchema.optional().default("free"),
  bookedOrderRef: z.string().nullable().optional(),
});

export const branchFloorSchema = z.object({
  branchCode: z.string(),
  sections: z.array(seatingSectionSchema),
  tables: z.array(restaurantTableSchema),
});

export const createSeatingSectionSchema = z.object({
  branchCode: z.string().min(1),
  name: z.string().min(1).max(64),
  sortOrder: z.number().int().optional(),
});

export const updateSeatingSectionSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export const createRestaurantTableSchema = z.object({
  branchCode: z.string().min(1),
  sectionId: z.string().uuid(),
  tableNumber: z.string().min(1).max(16),
  seats: z.number().int().min(1).max(24).optional(),
  sortOrder: z.number().int().optional(),
});

export const updateRestaurantTableSchema = z.object({
  tableNumber: z.string().min(1).max(16).optional(),
  seats: z.number().int().min(1).max(24).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  sectionId: z.string().uuid().optional(),
});

export type SeatingSection = z.infer<typeof seatingSectionSchema>;
export type RestaurantTable = z.infer<typeof restaurantTableSchema>;
export type TableBookingStatus = z.infer<typeof tableBookingStatusSchema>;
export type BranchFloor = z.infer<typeof branchFloorSchema>;
export type CreateSeatingSection = z.infer<typeof createSeatingSectionSchema>;
export type UpdateSeatingSection = z.infer<typeof updateSeatingSectionSchema>;
export type CreateRestaurantTable = z.infer<typeof createRestaurantTableSchema>;
export type UpdateRestaurantTable = z.infer<typeof updateRestaurantTableSchema>;
