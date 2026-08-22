import { z } from "zod";

export const MENU_PORTION_VALUES = [
  "full",
  "half",
  "quarter",
  "plate",
  "single",
  "piece",
  "bowl",
  "cup",
  "regular",
  "family",
] as const;

export type MenuPortion = (typeof MENU_PORTION_VALUES)[number];

export const MENU_PORTION_OPTIONS: { value: MenuPortion; label: string }[] = [
  { value: "full", label: "Full" },
  { value: "half", label: "Half" },
  { value: "quarter", label: "Quarter" },
  { value: "plate", label: "Plate" },
  { value: "single", label: "Single" },
  { value: "piece", label: "Piece" },
  { value: "bowl", label: "Bowl" },
  { value: "cup", label: "Cup" },
  { value: "regular", label: "Regular" },
  { value: "family", label: "Family" },
];

export const menuPortionSchema = z.enum(MENU_PORTION_VALUES);

export function menuPortionLabel(portion: MenuPortion): string {
  return MENU_PORTION_OPTIONS.find((o) => o.value === portion)?.label ?? portion;
}

export function formatMenuItemLabel(item: {
  name: string;
  portion?: MenuPortion | null;
  variantLabel?: string | null;
  /** When true, never append size / Standard to the printed name. */
  simplePrice?: boolean | null;
}): string {
  if (item.simplePrice) return item.name;
  const variant = item.variantLabel?.trim() ?? "";
  // Generic single-price labels — do not show on POS / KOT / bill.
  if (variant && !isSilentMenuVariantLabel(variant)) {
    return `${item.name} (${variant})`;
  }
  if (!item.portion) return item.name;
  return `${item.name} (${menuPortionLabel(item.portion)})`;
}

/** Labels that mean "no real size" — hide on tickets when they are the only option. */
export function isSilentMenuVariantLabel(label: string | null | undefined): boolean {
  const t = (label ?? "").trim().toLowerCase();
  return !t || t === "standard" || t === "regular" || t === "default" || t === "normal";
}

/** Kitchen ticket / bill print name — prefers Urdu secondary name when set. */
export function formatMenuItemPrintLabel(item: {
  name: string;
  secondaryName?: string | null;
  portion?: MenuPortion | null;
  variantLabel?: string | null;
  simplePrice?: boolean | null;
}): string {
  const printName = item.secondaryName?.trim() || item.name;
  return formatMenuItemLabel({
    name: printName,
    portion: item.portion,
    variantLabel: item.variantLabel,
    simplePrice: item.simplePrice,
  });
}

export const menuCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  imageUrl: z.string().nullable(),
  sortOrder: z.number(),
  isActive: z.boolean(),
});

export const menuItemVariantSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  price: z.number(),
  barcode: z.string().nullable(),
  happyHour: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number(),
});

export const createMenuItemVariantSchema = z.object({
  label: z.string().min(1).max(32),
  price: z.number().int().positive(),
  barcode: z.string().max(32).optional(),
  happyHour: z.boolean().optional(),
});

export const menuItemSchema = z.object({
  id: z.string().uuid(),
  categoryId: z.string().uuid(),
  name: z.string(),
  /** Secondary name (Urdu) used on kitchen tickets and bills. */
  secondaryName: z.string().nullable().default(null),
  imageUrl: z.string().nullable(),
  portion: menuPortionSchema.nullable(),
  price: z.number(),
  barcode: z.string().nullable(),
  happyHour: z.boolean(),
  featured: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number(),
  variants: z.array(menuItemVariantSchema),
  /** Item participates in bill-level discounts (AND'd with !nonDiscountable). */
  discountable: z.boolean().default(true),
  /** Explicitly excludes this item from discounts, regardless of `discountable`. */
  nonDiscountable: z.boolean().default(false),
  /** Excludes this item's amount from the tax base. */
  nonTaxable: z.boolean().default(false),
  /** POS prompts for unit price when adding this item. */
  askForPrice: z.boolean().default(false),
  /** POS prompts for quantity when adding this item. */
  askForQty: z.boolean().default(false),
  /** POS allows a per-line manual discount (% or PKR) on this item. */
  allowManualDiscount: z.boolean().default(false),
  /** Default line discount % applied when allowManualDiscount is enabled. */
  defaultDiscountPct: z.number().min(0).max(100).default(0),
  /**
   * Single flat price — no size picker on POS; tickets print name only (no Standard/Half).
   */
  simplePrice: z.boolean().default(false),
});

export function activeMenuVariants(item: Pick<MenuItem, "variants">): MenuItemVariant[] {
  return item.variants.filter((v) => v.isActive);
}

export function menuItemHasVariantPicker(item: MenuItem): boolean {
  return activeMenuVariants(item).length > 1;
}

export function menuItemDisplayPrice(item: MenuItem): number {
  const variants = activeMenuVariants(item);
  if (variants.length > 0) {
    return Math.min(...variants.map((v) => v.price));
  }
  return item.price;
}

export const branchMenuSchema = z.object({
  branchCode: z.string(),
  categories: z.array(menuCategorySchema),
  items: z.array(menuItemSchema),
});

export const createMenuCategorySchema = z.object({
  branchCode: z.string().min(1),
  name: z.string().min(1).max(64),
  imageUrl: z.string().max(512).optional(),
  sortOrder: z.number().int().optional(),
});

export const updateMenuCategorySchema = z.object({
  name: z.string().min(1).max(64).optional(),
  imageUrl: z.string().max(512).nullable().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export const createMenuItemSchema = z.object({
  branchCode: z.string().min(1),
  categoryId: z.string().uuid(),
  name: z.string().min(1).max(120),
  secondaryName: z.string().max(120).nullable().optional(),
  imageUrl: z.string().max(512).optional(),
  portion: menuPortionSchema.optional(),
  price: z.number().int().positive().optional(),
  barcode: z.string().max(32).optional(),
  happyHour: z.boolean().optional(),
  featured: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  variants: z.array(createMenuItemVariantSchema).min(1).optional(),
  discountable: z.boolean().optional(),
  nonDiscountable: z.boolean().optional(),
  nonTaxable: z.boolean().optional(),
  askForPrice: z.boolean().optional(),
  askForQty: z.boolean().optional(),
  allowManualDiscount: z.boolean().optional(),
  defaultDiscountPct: z.number().min(0).max(100).optional(),
  simplePrice: z.boolean().optional(),
}).refine(
  (data) => (data.variants?.length ?? 0) > 0 || data.price != null,
  { message: "Provide a price or at least one sub-category" },
);

export const updateMenuItemSchema = z.object({
  categoryId: z.string().uuid().optional(),
  name: z.string().min(1).max(120).optional(),
  secondaryName: z.string().max(120).nullable().optional(),
  imageUrl: z.string().max(512).nullable().optional(),
  portion: menuPortionSchema.nullable().optional(),
  price: z.number().int().positive().optional(),
  barcode: z.string().max(32).nullable().optional(),
  happyHour: z.boolean().optional(),
  featured: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  variants: z.array(createMenuItemVariantSchema).min(1).optional(),
  discountable: z.boolean().optional(),
  nonDiscountable: z.boolean().optional(),
  nonTaxable: z.boolean().optional(),
  askForPrice: z.boolean().optional(),
  askForQty: z.boolean().optional(),
  allowManualDiscount: z.boolean().optional(),
  defaultDiscountPct: z.number().min(0).max(100).optional(),
  simplePrice: z.boolean().optional(),
});

export type MenuCategory = z.infer<typeof menuCategorySchema>;
export type MenuItemVariant = z.infer<typeof menuItemVariantSchema>;
export type CreateMenuItemVariant = z.infer<typeof createMenuItemVariantSchema>;
export type MenuItem = z.infer<typeof menuItemSchema>;
export type BranchMenu = z.infer<typeof branchMenuSchema>;
export type CreateMenuCategory = z.infer<typeof createMenuCategorySchema>;
export type UpdateMenuCategory = z.infer<typeof updateMenuCategorySchema>;
export type CreateMenuItem = z.infer<typeof createMenuItemSchema>;
export type UpdateMenuItem = z.infer<typeof updateMenuItemSchema>;
