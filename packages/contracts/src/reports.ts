import { z } from "zod";

/** Canonical restaurant report catalog — keep in sync with backend ReportsService. */
export const RESTAURANT_REPORT_DEFS = [
  { id: "sales-by-item", name: "Sales by item", category: "Sales" },
  { id: "cashier-out", name: "Cashier out", category: "Cash" },
  { id: "cash-report", name: "Cash Report", category: "Cash" },
  { id: "sales-by-kitchen", name: "Sales by kitchen", category: "Sales" },
  { id: "kitchen-sale", name: "Kitchen Sale Report", category: "Sales" },
  { id: "sales-by-employee", name: "Sales by employee", category: "Sales" },
  { id: "sales-by-order-type", name: "Sales by order type", category: "Sales" },
  { id: "delivery", name: "Delivery report", category: "Operations" },
  { id: "discount", name: "Discount report", category: "Sales" },
  { id: "canceled-orders", name: "Canceled orders", category: "Operations" },
  { id: "item-remove", name: "Item remove", category: "Operations" },
  { id: "cashier-overshort", name: "Cashier over/short", category: "Cash" },
  { id: "profit-loss", name: "Profit & loss", category: "Finance" },
  { id: "expense", name: "Expense report", category: "Finance" },
  { id: "sales-by-hall", name: "Sales by hall", category: "Sales" },
  { id: "cash-drawer", name: "Cash drawer report", category: "Cash" },
  { id: "kitchen-printing-logs", name: "Kitchen printing logs", category: "Kitchen" },
  { id: "kitchen-missing-log", name: "Kitchen missing log", category: "Kitchen" },
  { id: "table-server-change", name: "Table server change", category: "Operations" },
  { id: "customer-ledger", name: "Customer ledger", category: "Ledgers" },
  { id: "employee-ledger", name: "Employees ledger", category: "Ledgers" },
  { id: "vendor-ledger", name: "Vendor ledger", category: "Vendors" },
  { id: "vendors-balance", name: "All vendor list with balance", category: "Vendors" },
  { id: "day-book", name: "Day Book Report", category: "Finance" },
  { id: "in-out", name: "In-Out Report", category: "Cash" },
  { id: "kitchen-wise-purchase", name: "Kitchen wise purchase", category: "Purchase" },
  { id: "sale-purchase-by-party", name: "Sale Purchase By Party", category: "Parties" },
  { id: "party-report", name: "Party Report", category: "Parties" },
  { id: "universal-ledger", name: "Universal Ledger", category: "Ledgers" },
  { id: "ingredients-usage", name: "Ingredients usage", category: "Inventory" },
  { id: "ingredients-stock", name: "Ingredients stock", category: "Inventory" },
] as const;

export type RestaurantReportId = (typeof RESTAURANT_REPORT_DEFS)[number]["id"];
export type RestaurantReportCategory = (typeof RESTAURANT_REPORT_DEFS)[number]["category"];

export const restaurantReportRowSchema = z.object({
  label: z.string(),
  qty: z.number().optional(),
  amount: z.number().optional(),
  meta: z.string().optional(),
  debit: z.number().optional(),
  credit: z.number().optional(),
  balance: z.number().optional(),
  /** Stable section id for cash-report cards / drill-down (e.g. serviceCharges). */
  section: z.string().optional(),
}).passthrough();

export const restaurantReportSchema = z.object({
  reportId: z.string(),
  title: z.string(),
  category: z.string(),
  description: z.string(),
  generatedAt: z.string(),
  from: z.string().nullable().optional(),
  to: z.string().nullable().optional(),
  rows: z.array(restaurantReportRowSchema),
  totals: z.record(z.number()).optional(),
  empty: z.boolean().optional(),
});

export const restaurantReportCatalogSchema = z.object({
  reports: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      category: z.string(),
    }),
  ),
});

export type RestaurantReport = z.infer<typeof restaurantReportSchema>;
export type RestaurantReportCatalog = z.infer<typeof restaurantReportCatalogSchema>;
