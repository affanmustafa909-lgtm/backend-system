import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type { BillLine } from "@platform/contracts";
import {
  popsBills,
  popsIngredients,
  popsInventoryAuditLogs,
  popsMenuItems,
  popsRecipeLines,
  popsRecipes,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../drizzle/drizzle.tokens";
import { AccountingHooksService } from "../accounting/accounting-hooks.service";

@Injectable()
export class InventoryDeductionService {
  private readonly logger = new Logger(InventoryDeductionService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly accountingHooks: AccountingHooksService,
  ) {}

  async deductForCompletedBill(
    organizationId: string,
    bill: typeof popsBills.$inferSelect,
    actorEmail = "pos@system",
  ): Promise<void> {
    if (bill.inventoryDeductedAt || bill.status !== "completed") return;

    let lines: BillLine[];
    try {
      lines = JSON.parse(bill.linesJson) as BillLine[];
    } catch {
      this.logger.warn(`Bill ${bill.billRef}: invalid lines JSON — skipping inventory deduction`);
      return;
    }
    if (!Array.isArray(lines) || lines.length === 0) return;

    const menuItems = await this.db
      .select({
        id: popsMenuItems.id,
        name: popsMenuItems.name,
        portion: popsMenuItems.portion,
      })
      .from(popsMenuItems)
      .where(and(eq(popsMenuItems.branchId, bill.branchId), eq(popsMenuItems.isActive, true)));

    const recipes = await this.db
      .select({
        id: popsRecipes.id,
        menuItemId: popsRecipes.menuItemId,
      })
      .from(popsRecipes)
      .where(
        and(
          eq(popsRecipes.branchId, bill.branchId),
          eq(popsRecipes.organizationId, organizationId),
          eq(popsRecipes.active, true),
        ),
      );

    const recipeByMenuItem = new Map<string, string>();
    for (const recipe of recipes) {
      if (recipe.menuItemId && !recipeByMenuItem.has(recipe.menuItemId)) {
        recipeByMenuItem.set(recipe.menuItemId, recipe.id);
      }
    }

    const recipeLineCache = new Map<string, (typeof popsRecipeLines.$inferSelect)[]>();
    const deductions = new Map<string, number>();
    const detailParts: string[] = [];
    let cogsTotal = 0;

    for (const line of lines) {
      const menuItemId = this.resolveMenuItemId(line, menuItems);
      if (!menuItemId) continue;

      const recipeId = recipeByMenuItem.get(menuItemId);
      if (!recipeId) continue;

      let recipeLines = recipeLineCache.get(recipeId);
      if (!recipeLines) {
        recipeLines = await this.db
          .select()
          .from(popsRecipeLines)
          .where(eq(popsRecipeLines.recipeId, recipeId));
        recipeLineCache.set(recipeId, recipeLines);
      }

      for (const recipeLine of recipeLines) {
        const deductQty = recipeLine.qty * line.qty;
        deductions.set(
          recipeLine.ingredientId,
          (deductions.get(recipeLine.ingredientId) ?? 0) + deductQty,
        );
      }
      detailParts.push(`${line.label} x${line.qty}`);
    }

    if (deductions.size === 0) {
      await this.db
        .update(popsBills)
        .set({ inventoryDeductedAt: new Date() })
        .where(eq(popsBills.id, bill.id));
      return;
    }

    for (const [ingredientId, qty] of deductions) {
      const ingRows = await this.db
        .select()
        .from(popsIngredients)
        .where(
          and(
            eq(popsIngredients.id, ingredientId),
            eq(popsIngredients.organizationId, organizationId),
          ),
        )
        .limit(1);
      const ing = ingRows[0];
      if (!ing) continue;

      const newStock = Math.max(0, ing.currentStock - qty);
      cogsTotal += Math.round(qty * ing.unitCostPkr);
      await this.db
        .update(popsIngredients)
        .set({ currentStock: newStock })
        .where(eq(popsIngredients.id, ingredientId));

      await this.db.insert(popsInventoryAuditLogs).values({
        organizationId,
        branchId: bill.branchId,
        userEmail: actorEmail,
        action: "POS sale deduction",
        module: "Inventory",
        detail: `${bill.billRef}: ${ing.name} −${qty} ${ing.unit} (${lineSummary(detailParts)})`,
      });
    }

    await this.db
      .update(popsBills)
      .set({ inventoryDeductedAt: new Date() })
      .where(eq(popsBills.id, bill.id));

    if (cogsTotal > 0) {
      try {
        await this.accountingHooks.recordCogs(
          organizationId,
          bill.branchId,
          bill.billRef,
          cogsTotal,
          bill.billRef,
        );
      } catch (err) {
        this.logger.warn(
          `COGS entry failed for ${bill.billRef}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private resolveMenuItemId(
    line: BillLine,
    menuItems: { id: string; name: string; portion: string | null }[],
  ): string | null {
    if (line.menuItemId) {
      const direct = menuItems.find((m) => m.id === line.menuItemId);
      if (direct) return direct.id;
    }

    const norm = normalizeMenuLabel(line.label);
    const match = menuItems.find((item) => {
      const itemLabel = formatMenuItemLabel(item.name, item.portion);
      return (
        normalizeMenuLabel(itemLabel) === norm ||
        normalizeMenuLabel(item.name) === norm ||
        norm.includes(normalizeMenuLabel(item.name))
      );
    });
    return match?.id ?? null;
  }
}

function lineSummary(parts: string[]): string {
  return parts.slice(0, 3).join(", ") + (parts.length > 3 ? ` +${parts.length - 3} more` : "");
}

function normalizeMenuLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, " ").trim();
}

function formatMenuItemLabel(name: string, portion: string | null): string {
  if (!portion) return name;
  const label = portion.charAt(0).toUpperCase() + portion.slice(1);
  return `${name} (${label})`;
}
