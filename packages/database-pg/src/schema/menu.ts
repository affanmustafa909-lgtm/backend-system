import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { popsBranches } from "./operations";

export const popsMenuCategories = pgTable("pops_menu_categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Public URL path served by the API, e.g. /uploads/menu/... */
  imageUrl: text("image_url"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const popsMenuItems = pgTable("pops_menu_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  categoryId: uuid("category_id")
    .notNull()
    .references(() => popsMenuCategories.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Secondary / Urdu name for kitchen tickets and bills. */
  secondaryName: text("secondary_name"),
  /** Public URL path served by the API, e.g. /uploads/menu/... */
  imageUrl: text("image_url"),
  /** Serving size: full, half, plate, etc. */
  portion: text("portion"),
  pricePkr: integer("price_pkr").notNull(),
  barcode: text("barcode"),
  happyHour: boolean("happy_hour").notNull().default(false),
  /** Highlight on POS and admin menu as a featured dish. */
  featured: boolean("featured").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  /** Participates in bill-level discounts (AND'd with !nonDiscountable). */
  discountable: boolean("discountable").notNull().default(true),
  /** Explicitly excludes this item from discounts, regardless of `discountable`. */
  nonDiscountable: boolean("non_discountable").notNull().default(false),
  /** Excludes this item's amount from the tax base. */
  nonTaxable: boolean("non_taxable").notNull().default(false),
  /** POS prompts for unit price when adding this item. */
  askForPrice: boolean("ask_for_price").notNull().default(false),
  /** POS prompts for quantity when adding this item. */
  askForQty: boolean("ask_for_qty").notNull().default(false),
  /** POS allows a per-line manual discount (% or PKR) on this item. */
  allowManualDiscount: boolean("allow_manual_discount").notNull().default(false),
  /** Default line discount % when allowManualDiscount is enabled. */
  defaultDiscountPct: integer("default_discount_pct").notNull().default(0),
  /** Flat price item — no size picker; tickets omit Standard/size suffix. */
  simplePrice: boolean("simple_price").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Size / portion options for a dish, e.g. Full, Half, Quarter. */
export const popsMenuItemVariants = pgTable("pops_menu_item_variants", {
  id: uuid("id").defaultRandom().primaryKey(),
  menuItemId: uuid("menu_item_id")
    .notNull()
    .references(() => popsMenuItems.id, { onDelete: "cascade" }),
  /** User-defined label, e.g. Full, Half, Quarter, Single */
  label: text("label").notNull(),
  pricePkr: integer("price_pkr").notNull(),
  barcode: text("barcode"),
  happyHour: boolean("happy_hour").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
