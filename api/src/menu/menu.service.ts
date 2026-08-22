import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { and, asc, eq, inArray } from "drizzle-orm";
import type {
  CreateMenuCategory,
  CreateMenuItem,
  CreateMenuItemVariant,
  UpdateMenuCategory,
  UpdateMenuItem,
} from "@platform/contracts";
import {
  popsBranches,
  popsMenuCategories,
  popsMenuItemVariants,
  popsMenuItems,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../drizzle/drizzle.tokens";

import type { MenuPortion } from "@platform/contracts";

const DEFAULT_MENU: {
  category: string;
  items: {
    name: string;
    variants?: { label: string; price: number; barcode?: string; happyHour?: boolean }[];
    portion?: MenuPortion;
    price?: number;
    barcode?: string;
    happyHour?: boolean;
    featured?: boolean;
  }[];
}[] = [
  {
    category: "Mains",
    items: [
      {
        name: "Chicken Karahi",
        variants: [
          { label: "Full", price: 2890, barcode: "8901123001" },
          { label: "Half", price: 1650 },
        ],
      },
      { name: "Mutton Handi", variants: [{ label: "Half", price: 3200 }] },
      { name: "Chicken Biryani", variants: [{ label: "Plate", price: 450, happyHour: true }] },
    ],
  },
  {
    category: "Grill",
    items: [
      { name: "Seekh Kabab (6pc)", price: 980, barcode: "8901123002" },
      { name: "Malai Boti", price: 1100 },
    ],
  },
  {
    category: "Beverages",
    items: [
      { name: "Mint Margarita", price: 280 },
      { name: "Soft drink", price: 120 },
    ],
  },
  {
    category: "Sides",
    items: [{ name: "Raita", price: 80 }],
  },
  {
    category: "Combos",
    items: [{ name: "Family Combo 4", price: 4999 }],
  },
];

@Injectable()
export class MenuService implements OnModuleInit {
  constructor(@Inject(DRIZZLE) private readonly db: PlatformPgDb) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.seedDefaultMenus();
    } catch {
      /* schema may not be ready yet */
    }
  }

  async seedDefaultMenus(): Promise<void> {
    const branches = await this.db.select().from(popsBranches);
    for (const branch of branches) {
      await this.seedBranchMenuIfEmpty(branch);
    }
  }

  private async seedBranchMenuIfEmpty(branch: typeof popsBranches.$inferSelect): Promise<void> {
    const existing = await this.db
      .select({ id: popsMenuCategories.id })
      .from(popsMenuCategories)
      .where(eq(popsMenuCategories.branchId, branch.id))
      .limit(1);
    if (existing.length > 0) return;

    let sort = 0;
    for (const block of DEFAULT_MENU) {
      const [cat] = await this.db
        .insert(popsMenuCategories)
        .values({
          organizationId: branch.organizationId,
          branchId: branch.id,
          name: block.category,
          sortOrder: sort++,
        })
        .returning();
      if (!cat) continue;

      let itemSort = 0;
      for (const item of block.items) {
        const variants = item.variants ?? [];
        const basePrice = variants.length > 0 ? variants[0].price : (item.price ?? 0);
        const [row] = await this.db
          .insert(popsMenuItems)
          .values({
            organizationId: branch.organizationId,
            branchId: branch.id,
            categoryId: cat.id,
            name: item.name,
            portion: variants.length > 0 ? null : (item.portion ?? null),
            pricePkr: basePrice,
            barcode: variants.length > 0 ? null : (item.barcode ?? null),
            happyHour: variants.length > 0 ? false : (item.happyHour ?? false),
            featured: item.featured ?? false,
            sortOrder: itemSort++,
          })
          .returning();
        if (!row) continue;
        if (variants.length > 0) {
          await this.insertVariants(row.id, variants);
        }
      }
    }
  }

  async getBranchMenu(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    await this.seedBranchMenuIfEmpty(branch);

    const categories = await this.db
      .select()
      .from(popsMenuCategories)
      .where(
        and(
          eq(popsMenuCategories.branchId, branch.id),
          eq(popsMenuCategories.isActive, true),
        ),
      )
      .orderBy(asc(popsMenuCategories.sortOrder), asc(popsMenuCategories.name));

    const items = await this.db
      .select()
      .from(popsMenuItems)
      .where(and(eq(popsMenuItems.branchId, branch.id), eq(popsMenuItems.isActive, true)))
      .orderBy(asc(popsMenuItems.sortOrder), asc(popsMenuItems.name));

    return this.buildBranchMenu(branch.code, categories, items);
  }

  async getBranchMenuAdmin(organizationId: string, branchCode: string) {
    const branch = await this.resolveBranch(organizationId, branchCode);
    await this.seedBranchMenuIfEmpty(branch);

    const categories = await this.db
      .select()
      .from(popsMenuCategories)
      .where(eq(popsMenuCategories.branchId, branch.id))
      .orderBy(asc(popsMenuCategories.sortOrder), asc(popsMenuCategories.name));

    const items = await this.db
      .select()
      .from(popsMenuItems)
      .where(eq(popsMenuItems.branchId, branch.id))
      .orderBy(asc(popsMenuItems.sortOrder), asc(popsMenuItems.name));

    return this.buildBranchMenu(branch.code, categories, items);
  }

  async createCategory(organizationId: string, input: CreateMenuCategory) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    const [row] = await this.db
      .insert(popsMenuCategories)
      .values({
        organizationId,
        branchId: branch.id,
        name: input.name.trim(),
        imageUrl: input.imageUrl?.trim() || null,
        sortOrder: input.sortOrder ?? 0,
      })
      .returning();
    if (!row) throw new BadRequestException("Failed to create category");
    return {
      id: row.id,
      name: row.name,
      imageUrl: row.imageUrl ?? null,
      sortOrder: row.sortOrder,
      isActive: row.isActive,
    };
  }

  async updateCategory(organizationId: string, categoryId: string, input: UpdateMenuCategory) {
    await this.getCategory(organizationId, categoryId);
    const [row] = await this.db
      .update(popsMenuCategories)
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      })
      .where(eq(popsMenuCategories.id, categoryId))
      .returning();
    if (!row) throw new NotFoundException("Category not found");
    return {
      id: row.id,
      name: row.name,
      imageUrl: row.imageUrl ?? null,
      sortOrder: row.sortOrder,
      isActive: row.isActive,
    };
  }

  async deleteCategory(organizationId: string, categoryId: string) {
    await this.getCategory(organizationId, categoryId);
    await this.db.delete(popsMenuCategories).where(eq(popsMenuCategories.id, categoryId));
    return { ok: true };
  }

  async createItem(organizationId: string, input: CreateMenuItem) {
    const branch = await this.resolveBranch(organizationId, input.branchCode);
    await this.getCategory(organizationId, input.categoryId, branch.id);

    const variants = input.variants ?? [];
    const basePrice =
      variants.length > 0
        ? Math.min(...variants.map((v) => v.price))
        : (input.price ?? null);
    if (basePrice == null) {
      throw new BadRequestException("Provide a price or at least one sub-category");
    }

    const [row] = await this.db
      .insert(popsMenuItems)
      .values({
        organizationId,
        branchId: branch.id,
        categoryId: input.categoryId,
        name: input.name.trim(),
        secondaryName: input.secondaryName?.trim() || null,
        imageUrl: input.imageUrl?.trim() || null,
        portion: variants.length > 0 ? null : (input.portion ?? null),
        pricePkr: basePrice,
        barcode: variants.length > 0 ? null : (input.barcode?.trim() || null),
        happyHour: variants.length > 0 ? false : (input.happyHour ?? false),
        featured: input.featured ?? false,
        sortOrder: input.sortOrder ?? 0,
        discountable: input.discountable ?? true,
        nonDiscountable: input.nonDiscountable ?? false,
        nonTaxable: input.nonTaxable ?? false,
        askForPrice: input.askForPrice ?? false,
        askForQty: input.askForQty ?? false,
        allowManualDiscount: input.allowManualDiscount ?? false,
        defaultDiscountPct: input.defaultDiscountPct ?? 0,
        simplePrice: input.simplePrice ?? false,
      })
      .returning();

    if (!row) throw new BadRequestException("Failed to create menu item");
    if (variants.length > 0) {
      await this.insertVariants(row.id, variants);
    }
    return this.mapItemWithVariants(row, await this.loadVariantsForItem(row.id));
  }

  async updateItem(organizationId: string, itemId: string, input: UpdateMenuItem) {
    const existing = await this.getItem(organizationId, itemId);
    if (input.categoryId) {
      await this.getCategory(organizationId, input.categoryId, existing.branchId);
    }

    const variants = input.variants;
    const nextPrice =
      variants && variants.length > 0
        ? Math.min(...variants.map((v) => v.price))
        : input.price;

    const [row] = await this.db
      .update(popsMenuItems)
      .set({
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.secondaryName !== undefined
          ? { secondaryName: input.secondaryName?.trim() || null }
          : {}),
        ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
        ...(variants && variants.length > 0
          ? { portion: null, barcode: null, happyHour: false }
          : {
              ...(input.portion !== undefined ? { portion: input.portion } : {}),
              ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
              ...(input.happyHour !== undefined ? { happyHour: input.happyHour } : {}),
            }),
        ...(input.featured !== undefined ? { featured: input.featured } : {}),
        ...(nextPrice !== undefined ? { pricePkr: nextPrice } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.discountable !== undefined ? { discountable: input.discountable } : {}),
        ...(input.nonDiscountable !== undefined ? { nonDiscountable: input.nonDiscountable } : {}),
        ...(input.nonTaxable !== undefined ? { nonTaxable: input.nonTaxable } : {}),
        ...(input.askForPrice !== undefined ? { askForPrice: input.askForPrice } : {}),
        ...(input.askForQty !== undefined ? { askForQty: input.askForQty } : {}),
        ...(input.allowManualDiscount !== undefined
          ? { allowManualDiscount: input.allowManualDiscount }
          : {}),
        ...(input.defaultDiscountPct !== undefined
          ? { defaultDiscountPct: input.defaultDiscountPct }
          : {}),
        ...(input.simplePrice !== undefined ? { simplePrice: input.simplePrice } : {}),
      })
      .where(eq(popsMenuItems.id, itemId))
      .returning();

    if (!row) throw new NotFoundException("Menu item not found");

    if (variants) {
      await this.db.delete(popsMenuItemVariants).where(eq(popsMenuItemVariants.menuItemId, itemId));
      if (variants.length > 0) {
        await this.insertVariants(itemId, variants);
      }
    }

    return this.mapItemWithVariants(row, await this.loadVariantsForItem(itemId));
  }

  async deleteItem(organizationId: string, itemId: string) {
    await this.getItem(organizationId, itemId);
    await this.db.delete(popsMenuItems).where(eq(popsMenuItems.id, itemId));
    return { ok: true };
  }

  private async buildBranchMenu(
    branchCode: string,
    categories: (typeof popsMenuCategories.$inferSelect)[],
    items: (typeof popsMenuItems.$inferSelect)[],
  ) {
    const variantMap = await this.loadVariantsForItems(items.map((i) => i.id));
    return {
      branchCode,
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        imageUrl: c.imageUrl ?? null,
        sortOrder: c.sortOrder,
        isActive: c.isActive,
      })),
      items: items.map((i) => this.mapItemWithVariants(i, variantMap.get(i.id) ?? [])),
    };
  }

  private mapItemWithVariants(
    row: typeof popsMenuItems.$inferSelect,
    variants: (typeof popsMenuItemVariants.$inferSelect)[],
  ) {
    const mappedVariants = variants.map((v) => ({
      id: v.id,
      label: v.label,
      price: v.pricePkr,
      barcode: v.barcode,
      happyHour: v.happyHour,
      isActive: v.isActive,
      sortOrder: v.sortOrder,
    }));
    const minVariantPrice =
      mappedVariants.length > 0 ? Math.min(...mappedVariants.map((v) => v.price)) : null;

    return {
      id: row.id,
      categoryId: row.categoryId,
      name: row.name,
      secondaryName: row.secondaryName ?? null,
      imageUrl: row.imageUrl ?? null,
      portion: row.portion as MenuPortion | null,
      price: minVariantPrice ?? row.pricePkr,
      barcode: row.barcode,
      happyHour: row.happyHour,
      featured: row.featured,
      isActive: row.isActive,
      sortOrder: row.sortOrder,
      variants: mappedVariants,
      discountable: row.discountable,
      nonDiscountable: row.nonDiscountable,
      nonTaxable: row.nonTaxable,
      askForPrice: row.askForPrice,
      askForQty: row.askForQty,
      allowManualDiscount: row.allowManualDiscount,
      defaultDiscountPct: row.defaultDiscountPct ?? 0,
      simplePrice: row.simplePrice ?? false,
    };
  }

  private async loadVariantsForItem(itemId: string) {
    const map = await this.loadVariantsForItems([itemId]);
    return map.get(itemId) ?? [];
  }

  private async loadVariantsForItems(itemIds: string[]) {
    const map = new Map<string, (typeof popsMenuItemVariants.$inferSelect)[]>();
    if (itemIds.length === 0) return map;

    const rows = await this.db
      .select()
      .from(popsMenuItemVariants)
      .where(inArray(popsMenuItemVariants.menuItemId, itemIds))
      .orderBy(asc(popsMenuItemVariants.sortOrder), asc(popsMenuItemVariants.label));

    for (const row of rows) {
      const list = map.get(row.menuItemId) ?? [];
      list.push(row);
      map.set(row.menuItemId, list);
    }
    return map;
  }

  private async insertVariants(itemId: string, variants: CreateMenuItemVariant[]) {
    let sort = 0;
    for (const variant of variants) {
      await this.db.insert(popsMenuItemVariants).values({
        menuItemId: itemId,
        label: variant.label.trim(),
        pricePkr: variant.price,
        barcode: variant.barcode?.trim() || null,
        happyHour: variant.happyHour ?? false,
        sortOrder: sort++,
      });
    }
  }

  private async resolveBranch(organizationId: string, branchCode: string) {
    const code = branchCode.trim();
    const rows = await this.db
      .select()
      .from(popsBranches)
      .where(and(eq(popsBranches.organizationId, organizationId), eq(popsBranches.code, code)))
      .limit(1);
    const branch = rows[0];
    if (!branch) throw new NotFoundException(`Branch not found: ${code}`);
    return branch;
  }

  private async getCategory(organizationId: string, categoryId: string, branchId?: string) {
    const rows = await this.db
      .select()
      .from(popsMenuCategories)
      .where(eq(popsMenuCategories.id, categoryId))
      .limit(1);
    const cat = rows[0];
    if (!cat || cat.organizationId !== organizationId) {
      throw new NotFoundException("Category not found");
    }
    if (branchId && cat.branchId !== branchId) throw new NotFoundException("Category not found");
    return cat;
  }

  private async getItem(organizationId: string, itemId: string) {
    const rows = await this.db
      .select()
      .from(popsMenuItems)
      .where(eq(popsMenuItems.id, itemId))
      .limit(1);
    const item = rows[0];
    if (!item || item.organizationId !== organizationId) {
      throw new NotFoundException("Menu item not found");
    }
    return item;
  }
}
