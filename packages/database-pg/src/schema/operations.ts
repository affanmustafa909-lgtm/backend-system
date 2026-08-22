import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const popsBranches = pgTable("pops_branches", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  city: text("city").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsSales = pgTable("pops_sales", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  soldAt: timestamp("sold_at", { withTimezone: true }).notNull(),
  channel: text("channel").notNull(),
  ref: text("ref").notNull(),
  amountPkr: integer("amount_pkr").notNull(),
  payment: text("payment").notNull(),
});

export const popsActiveOrders = pgTable("pops_active_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
});

export const popsKitchenTickets = pgTable("pops_kitchen_tickets", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  ticketRef: text("ticket_ref").notNull(),
  orderRef: text("order_ref"),
  stationLabel: text("station_label").notNull().default("Counter"),
  itemsSummary: text("items_summary").notNull().default(""),
  linesJson: text("lines_json"),
  billId: uuid("bill_id"),
  riderId: uuid("rider_id"),
  deliveryChargePkr: integer("delivery_charge_pkr").notNull().default(0),
  /** unassigned | assigned | out_for_delivery | delivered */
  deliveryStatus: text("delivery_status"),
  priority: text("priority").notNull().default("normal"),
  status: text("status").notNull(),
  /** Waiter/user who took the order — only they (or managers) may edit it. */
  createdByUserId: uuid("created_by_user_id"),
  createdByName: text("created_by_name"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Items reduced/removed after they were already sent to kitchen (KOT edit). */
export const popsKitchenLineCancellations = pgTable("pops_kitchen_line_cancellations", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  ticketId: uuid("ticket_id")
    .notNull()
    .references(() => popsKitchenTickets.id, { onDelete: "cascade" }),
  ticketRef: text("ticket_ref").notNull(),
  orderRef: text("order_ref"),
  stationLabel: text("station_label").notNull().default("Counter"),
  menuItemId: uuid("menu_item_id"),
  label: text("label").notNull(),
  qtyCanceled: integer("qty_canceled").notNull(),
  unitPricePkr: integer("unit_price_pkr").notNull().default(0),
  /** Ticket status when the cancel happened: new | cooking | ready */
  ticketStatusAtCancel: text("ticket_status_at_cancel").notNull(),
  canceledByUserId: uuid("canceled_by_user_id"),
  canceledByName: text("canceled_by_name"),
  source: text("source").notNull().default("pos_edit"),
  canceledAt: timestamp("canceled_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsInventoryItems = pgTable("pops_inventory_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  qty: integer("qty").notNull(),
  minQty: integer("min_qty").notNull(),
});

export const popsAlerts = pgTable("pops_alerts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  tone: text("tone").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const popsDailySales = pgTable("pops_daily_sales", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  salesDate: text("sales_date").notNull(),
  amountPkr: integer("amount_pkr").notNull(),
});
