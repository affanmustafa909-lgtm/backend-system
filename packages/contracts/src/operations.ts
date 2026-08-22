import { z } from "zod";

export const popsBranchSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  city: z.string(),
});

export const createPopsBranchSchema = z.object({
  name: z.string().min(1),
  city: z.string().min(1),
  code: z.string().min(1).max(16).optional(),
});

export type CreatePopsBranch = z.infer<typeof createPopsBranchSchema>;

/** Partial update — name/city always; code only when unique in the org. */
export const updatePopsBranchSchema = z
  .object({
    name: z.string().min(1).optional(),
    city: z.string().min(1).optional(),
    code: z.string().min(1).max(16).optional(),
  })
  .refine((v) => v.name !== undefined || v.city !== undefined || v.code !== undefined, {
    message: "Provide at least one of name, city, or code",
  });

export type UpdatePopsBranch = z.infer<typeof updatePopsBranchSchema>;

export const dashboardMetricsSchema = z.object({
  liveSales: z.object({
    amountPkr: z.number(),
    changePercent: z.number(),
  }),
  activeOrders: z.object({
    total: z.number(),
    dineIn: z.number(),
    takeaway: z.number(),
    delivery: z.number(),
  }),
  kitchenQueue: z.object({
    total: z.number(),
    priority: z.number(),
    slaStatus: z.enum(["green", "yellow", "red"]),
  }),
  lowStock: z.object({
    skuCount: z.number(),
    criticalCount: z.number(),
  }),
});

export const recentSaleSchema = z.object({
  time: z.string(),
  type: z.enum(["Dine-in", "Takeaway", "Delivery"]),
  ref: z.string(),
  amount: z.number(),
  payment: z.string(),
});

export const dashboardAlertSchema = z.object({
  id: z.string(),
  text: z.string(),
  tone: z.enum(["danger", "warning", "info"]),
});

export const dashboardResponseSchema = z.object({
  branchCode: z.string(),
  metrics: dashboardMetricsSchema,
  recentSales: z.array(recentSaleSchema),
  alerts: z.array(dashboardAlertSchema),
});

export type PopsBranch = z.infer<typeof popsBranchSchema>;
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
export type DashboardMetrics = z.infer<typeof dashboardMetricsSchema>;
export type RecentSale = z.infer<typeof recentSaleSchema>;
export type DashboardAlert = z.infer<typeof dashboardAlertSchema>;
