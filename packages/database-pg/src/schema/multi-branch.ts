import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { popsIngredients } from "./inventory";
import { popsBranches } from "./operations";
import { organizations } from "./organizations";
import { popsMenuItems } from "./menu";

export const popsBranchTransfers = pgTable("pops_branch_transfers", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  fromBranchId: uuid("from_branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "restrict" }),
  toBranchId: uuid("to_branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "restrict" }),
  transferRef: text("transfer_ref").notNull(),
  ingredientId: uuid("ingredient_id")
    .notNull()
    .references(() => popsIngredients.id, { onDelete: "restrict" }),
  ingredientSku: text("ingredient_sku").notNull(),
  ingredientName: text("ingredient_name").notNull(),
  qty: integer("qty").notNull(),
  unit: text("unit").notNull(),
  status: text("status").notNull().default("pending"), // pending | dispatched | received | cancelled
  notes: text("notes"),
  createdBy: text("created_by"),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsBranchPriceOverrides = pgTable("pops_branch_price_overrides", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  menuItemId: uuid("menu_item_id")
    .notNull()
    .references(() => popsMenuItems.id, { onDelete: "cascade" }),
  pricePkr: integer("price_pkr").notNull(),
  notes: text("notes"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
