import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { RESTAURANT_REPORT_DEFS } from "@platform/contracts";
import {
  popsBankAccounts,
  popsBankTransactions,
  popsBills,
  popsBranches,
  popsCashMovements,
  popsCashSessions,
  popsCustomerInvoices,
  popsCustomerPayments,
  popsEmployeeAdvances,
  popsEmployees,
  popsExpenses,
  popsGoodsReceipts,
  popsIngredients,
  popsKitchenLineCancellations,
  popsKitchenTickets,
  popsMenuCategories,
  popsMenuItems,
  popsPayrollRuns,
  popsPurchaseOrderLines,
  popsPurchaseOrders,
  popsSeatingSections,
  popsStockAdjustments,
  popsSuppliers,
  popsTables,
  popsVendorBills,
  popsVendorPayments,
  type PlatformPgDb,
} from "@platform/database-pg";
import { DRIZZLE } from "../drizzle/drizzle.tokens";
import { AccountingService } from "../accounting/accounting.service";

type BillLine = {
  label?: string;
  qty?: number;
  unitPrice?: number;
  station?: string;
  kitchen?: string;
  menuItemId?: string;
};

const KITCHEN_SALE_GROUPS = [
  { id: "pakistani", label: "Pakistani Dishes Sales", match: /pakistani|desi|karahi|biryani/i },
  { id: "fast-food", label: "Fast Food Sales", match: /fast\s*food|fastfood|burger|pizza|shawarma/i },
  { id: "outside", label: "Outside Sales", match: /outside|chinese|bbq|grill/i },
] as const;

function resolveKitchenSaleGroupFromCategory(categoryName: string | undefined): (typeof KITCHEN_SALE_GROUPS)[number]["id"] {
  const name = (categoryName ?? "").trim();
  if (name) {
    for (const g of KITCHEN_SALE_GROUPS) {
      if (g.id === "outside") continue;
      if (g.match.test(name)) return g.id;
    }
    for (const g of KITCHEN_SALE_GROUPS) {
      if (g.id === "outside" && g.match.test(name)) return g.id;
    }
  }
  return "outside";
}

@Injectable()
export class ReportsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PlatformPgDb,
    private readonly accounting: AccountingService,
  ) {}

  catalog() {
    return { reports: RESTAURANT_REPORT_DEFS.map((r) => ({ id: r.id, name: r.name, category: r.category })) };
  }

  async getReport(
    organizationId: string,
    branchCode: string,
    reportId: string,
    query: { from?: string; to?: string; fromTime?: string; toTime?: string } = {},
  ) {
    const def = RESTAURANT_REPORT_DEFS.find((r) => r.id === reportId);
    if (!def) throw new NotFoundException(`Unknown report: ${reportId}`);

    const branch = await this.resolveBranch(organizationId, branchCode);
    const today = new Date().toISOString().slice(0, 10);
    const from = query.from?.trim() || today;
    const to = query.to?.trim() || today;
    const fromTime = this.normalizeTime(query.fromTime, "00:00");
    const toTime = this.normalizeTime(query.toTime, "23:59");
    if (from > to) throw new BadRequestException("`from` must be on or before `to`");

    const generatedAt = new Date().toISOString();
    const base = {
      reportId: def.id,
      title: def.name,
      category: def.category,
      description: `${def.name} for ${branch.name}`,
      generatedAt,
      from,
      to,
      fromTime,
      toTime,
    };

    const range = { from, to, fromTime, toTime };

    switch (def.id) {
      case "sales-by-item":
        return { ...base, ...this.salesByItem(await this.completedBills(organizationId, branch.id, range)) };
      case "sales-by-kitchen":
        return { ...base, ...this.salesByKitchen(await this.completedBills(organizationId, branch.id, range)) };
      case "kitchen-sale":
        return {
          ...base,
          description:
            "Pakistani / Fast Food / Outside sales — map categories via Print sections (desktop) or category names.",
          ...(await this.kitchenSaleReport(organizationId, branch.id, range)),
        };
      case "sales-by-employee":
        return { ...base, ...this.salesByEmployee(await this.completedBills(organizationId, branch.id, range)) };
      case "sales-by-order-type":
        return { ...base, ...this.salesByOrderType(await this.completedBills(organizationId, branch.id, range)) };
      case "sales-by-hall":
        return {
          ...base,
          ...(await this.salesByHall(organizationId, branch.id, range)),
        };
      case "delivery":
        return { ...base, ...this.deliveryReport(await this.completedBills(organizationId, branch.id, range)) };
      case "discount":
        return { ...base, ...this.discountReport(await this.completedBills(organizationId, branch.id, range)) };
      case "canceled-orders":
        return {
          ...base,
          ...(await this.canceledOrders(organizationId, branch.id, range)),
        };
      case "item-remove":
        return {
          ...base,
          ...(await this.itemRemove(organizationId, branch.id, range)),
        };
      case "cashier-out":
      case "cashier-overshort":
      case "cash-drawer":
        return {
          ...base,
          ...(await this.cashSessionReport(organizationId, branch.id, range, def.id)),
        };
      case "cash-report":
        return {
          ...base,
          ...(await this.cashReport(organizationId, branch.id, range)),
        };
      case "profit-loss": {
        const pl = await this.accounting.getReport(organizationId, branchCode, "profit-loss");
        const rows = (pl.rows ?? []).map((r) => {
          const row = r as {
            label: string;
            amount?: number;
            indent?: number;
            debit?: number;
            credit?: number;
            balance?: number;
          };
          return {
            label: row.label,
            amount: row.amount ?? row.balance,
            debit: row.debit,
            credit: row.credit,
            balance: row.balance,
            meta: row.indent != null ? `indent:${row.indent}` : undefined,
          };
        });
        const empty = !rows.some((r) => Math.abs(Number(r.amount ?? r.balance ?? 0)) > 0);
        return { ...base, rows, totals: pl.totals, empty };
      }
      case "expense":
        return { ...base, ...(await this.expenseReport(organizationId, branch.id, range)) };
      case "kitchen-printing-logs":
        return {
          ...base,
          ...(await this.kitchenPrintingLogs(organizationId, branch.id, range)),
        };
      case "kitchen-missing-log":
        return {
          ...base,
          ...(await this.kitchenMissingLog(organizationId, branch.id, range)),
        };
      case "table-server-change":
        return {
          ...base,
          ...(await this.tableServerChange(organizationId, branch.id, range)),
        };
      case "vendor-ledger":
        return { ...base, ...(await this.vendorLedger(organizationId, branch.id, range)) };
      case "vendors-balance":
        return { ...base, ...(await this.vendorsBalance(organizationId, branch.id)) };
      case "customer-ledger":
        return { ...base, ...(await this.customerLedger(organizationId, branch.id, range)) };
      case "employee-ledger":
        return { ...base, ...(await this.employeeLedger(organizationId, branch.id, range)) };
      case "ingredients-usage":
        return { ...base, ...(await this.ingredientsUsage(organizationId, branch.id, range)) };
      case "ingredients-stock":
        return { ...base, ...(await this.ingredientsStock(organizationId, branch.id)) };
      case "day-book":
        return { ...base, ...(await this.dayBook(organizationId, branch.id, range)) };
      case "in-out":
        return {
          ...base,
          description:
            "Cash In (total sale) vs Cash Out (expenses, salaries, advances, supplier payments, purchasing) with Net Cash.",
          ...(await this.inOutReport(organizationId, branch.id, range)),
        };
      case "kitchen-wise-purchase":
        return { ...base, ...(await this.kitchenWisePurchase(organizationId, branch.id, range)) };
      case "sale-purchase-by-party":
        return { ...base, ...(await this.salePurchaseByParty(organizationId, branch.id, range)) };
      case "party-report":
        return { ...base, ...(await this.partyReport(organizationId, branch.id)) };
      case "universal-ledger":
        return {
          ...base,
          description:
            "Interactive Universal Ledger (Sale / Purchase / Expense / Item / Customer / Supplier) — open in desktop Reports.",
          rows: [],
          empty: true,
        };
      default:
        throw new NotFoundException(`Unknown report: ${reportId}`);
    }
  }

  private normalizeTime(value: string | undefined, fallback: string): string {
    if (value && /^\d{2}:\d{2}$/.test(value)) return value;
    return fallback;
  }

  private async resolveBranch(organizationId: string, branchCode: string) {
    const code = branchCode.trim();
    if (!code) throw new BadRequestException("branchCode is required");
    const [branch] = await this.db
      .select()
      .from(popsBranches)
      .where(and(eq(popsBranches.organizationId, organizationId), eq(popsBranches.code, code)))
      .limit(1);
    if (!branch) throw new NotFoundException(`Branch not found: ${code}`);
    return branch;
  }

  private rangeStart(range: { from: string; fromTime: string }): Date {
    return new Date(`${range.from}T${range.fromTime}:00+05:00`);
  }

  private rangeEnd(range: { to: string; toTime: string }): Date {
    return new Date(`${range.to}T${range.toTime}:59.999+05:00`);
  }

  private parseLines(linesJson: string | null): BillLine[] {
    if (!linesJson) return [];
    try {
      const parsed = JSON.parse(linesJson) as BillLine[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private inferOrderType(tableLabel: string, notes: string | null): string {
    const t = (tableLabel ?? "").toLowerCase();
    const n = (notes ?? "").toLowerCase();
    if (t.includes("delivery") || n.startsWith("delivery") || n.includes(" · delivery")) return "Delivery";
    if (t.includes("takeaway") || t.includes("tw-") || n.startsWith("takeaway")) return "Takeaway";
    if (t.includes("online") || n.includes("online")) return "Online";
    if (t.includes("foodpanda") || n.includes("foodpanda")) return "Foodpanda";
    if (t.includes("staff")) return "Staff food";
    return "Dine-in";
  }

  private async completedBills(
    organizationId: string,
    branchId: string,
    range: { from: string; to: string; fromTime: string; toTime: string },
  ) {
    return this.db
      .select()
      .from(popsBills)
      .where(
        and(
          eq(popsBills.organizationId, organizationId),
          eq(popsBills.branchId, branchId),
          eq(popsBills.status, "completed"),
          gte(popsBills.createdAt, this.rangeStart(range)),
          lte(popsBills.createdAt, this.rangeEnd(range)),
        ),
      )
      .orderBy(desc(popsBills.createdAt));
  }

  private salesByItem(bills: Awaited<ReturnType<ReportsService["completedBills"]>>) {
    const map = new Map<string, { qty: number; amount: number }>();
    for (const bill of bills) {
      for (const line of this.parseLines(bill.linesJson)) {
        const label = (line.label ?? "Item").trim() || "Item";
        const qty = Number(line.qty ?? 0);
        const amount = qty * Number(line.unitPrice ?? 0);
        const cur = map.get(label) ?? { qty: 0, amount: 0 };
        cur.qty += qty;
        cur.amount += amount;
        map.set(label, cur);
      }
    }
    const rows = [...map.entries()]
      .map(([label, v]) => ({ label, qty: v.qty, amount: v.amount }))
      .sort((a, b) => b.amount - a.amount);
    return {
      rows,
      totals: {
        lines: rows.length,
        qty: rows.reduce((s, r) => s + r.qty, 0),
        amount: rows.reduce((s, r) => s + r.amount, 0),
      },
      empty: rows.length === 0,
    };
  }

  private salesByKitchen(bills: Awaited<ReturnType<ReportsService["completedBills"]>>) {
    const map = new Map<string, { qty: number; amount: number }>();
    for (const bill of bills) {
      for (const line of this.parseLines(bill.linesJson)) {
        const kitchen = (line.kitchen || line.station || "Main kitchen").trim() || "Main kitchen";
        const qty = Number(line.qty ?? 0);
        const amount = qty * Number(line.unitPrice ?? 0);
        const cur = map.get(kitchen) ?? { qty: 0, amount: 0 };
        cur.qty += qty;
        cur.amount += amount;
        map.set(kitchen, cur);
      }
    }
    // Fallback: if lines lack kitchen tags, bucket by station on bills via table mode
    if (map.size === 0) {
      for (const bill of bills) {
        const kitchen = "Main kitchen";
        const cur = map.get(kitchen) ?? { qty: 0, amount: 0 };
        cur.qty += 1;
        cur.amount += bill.totalPkr;
        map.set(kitchen, cur);
      }
    }
    const rows = [...map.entries()]
      .map(([label, v]) => ({ label, qty: v.qty, amount: v.amount }))
      .sort((a, b) => b.amount - a.amount);
    return {
      rows,
      totals: { amount: rows.reduce((s, r) => s + r.amount, 0) },
      empty: rows.length === 0,
    };
  }

  /** Category-wise kitchen sale: Pakistani / Fast Food / Outside. */
  private async kitchenSaleReport(
    organizationId: string,
    branchId: string,
    range: { from: string; to: string; fromTime: string; toTime: string },
  ) {
    const bills = await this.completedBills(organizationId, branchId, range);
    const menuRows = await this.db
      .select({
        itemId: popsMenuItems.id,
        categoryName: popsMenuCategories.name,
      })
      .from(popsMenuItems)
      .innerJoin(popsMenuCategories, eq(popsMenuCategories.id, popsMenuItems.categoryId))
      .where(and(eq(popsMenuItems.organizationId, organizationId), eq(popsMenuItems.branchId, branchId)));

    const categoryByItem = new Map(menuRows.map((r) => [r.itemId, r.categoryName]));
    const buckets: Record<(typeof KITCHEN_SALE_GROUPS)[number]["id"], { qty: number; amount: number }> = {
      pakistani: { qty: 0, amount: 0 },
      "fast-food": { qty: 0, amount: 0 },
      outside: { qty: 0, amount: 0 },
    };

    for (const bill of bills) {
      for (const line of this.parseLines(bill.linesJson)) {
        const qty = Number(line.qty ?? 0);
        const amount = qty * Number(line.unitPrice ?? 0);
        if (qty <= 0 && amount <= 0) continue;
        const categoryName = line.menuItemId ? categoryByItem.get(line.menuItemId) : undefined;
        const group = resolveKitchenSaleGroupFromCategory(categoryName);
        buckets[group].qty += qty;
        buckets[group].amount += amount;
      }
    }

    const rows = KITCHEN_SALE_GROUPS.map((g) => ({
      label: g.label,
      qty: buckets[g.id].qty,
      amount: buckets[g.id].amount,
      meta: g.id,
    }));
    const totalAmount = rows.reduce((s, r) => s + r.amount, 0);
    return {
      rows,
      totals: {
        amount: totalAmount,
        pakistani: buckets.pakistani.amount,
        fastFood: buckets["fast-food"].amount,
        outside: buckets.outside.amount,
      },
      empty: totalAmount <= 0,
    };
  }

  private salesByEmployee(bills: Awaited<ReturnType<ReportsService["completedBills"]>>) {
    const map = new Map<string, { qty: number; amount: number }>();
    for (const bill of bills) {
      const label = (bill.waiterName || "Unassigned").trim() || "Unassigned";
      const cur = map.get(label) ?? { qty: 0, amount: 0 };
      cur.qty += 1;
      cur.amount += bill.totalPkr;
      map.set(label, cur);
    }
    const rows = [...map.entries()]
      .map(([label, v]) => ({ label, qty: v.qty, amount: v.amount, meta: `${v.qty} orders` }))
      .sort((a, b) => b.amount - a.amount);
    return {
      rows,
      totals: { orders: rows.reduce((s, r) => s + (r.qty ?? 0), 0), amount: rows.reduce((s, r) => s + r.amount, 0) },
      empty: rows.length === 0,
    };
  }

  private salesByOrderType(bills: Awaited<ReturnType<ReportsService["completedBills"]>>) {
    const map = new Map<string, { qty: number; amount: number }>();
    for (const bill of bills) {
      const label = this.inferOrderType(bill.tableLabel, bill.notes);
      const cur = map.get(label) ?? { qty: 0, amount: 0 };
      cur.qty += 1;
      cur.amount += bill.totalPkr;
      map.set(label, cur);
    }
    const rows = [...map.entries()]
      .map(([label, v]) => ({ label, qty: v.qty, amount: v.amount }))
      .sort((a, b) => b.amount - a.amount);
    return {
      rows,
      totals: { amount: rows.reduce((s, r) => s + r.amount, 0) },
      empty: rows.length === 0,
    };
  }

  private async salesByHall(organizationId: string, branchId: string, range: { from: string; to: string; fromTime: string; toTime: string }) {
    const bills = await this.completedBills(organizationId, branchId, range);
    const tables = await this.db
      .select({
        tableNumber: popsTables.tableNumber,
        sectionName: popsSeatingSections.name,
      })
      .from(popsTables)
      .leftJoin(popsSeatingSections, eq(popsTables.sectionId, popsSeatingSections.id))
      .where(and(eq(popsTables.organizationId, organizationId), eq(popsTables.branchId, branchId)));

    const tableToHall = new Map<string, string>();
    for (const t of tables) {
      tableToHall.set(String(t.tableNumber), t.sectionName?.trim() || "Main hall");
    }

    const map = new Map<string, { qty: number; amount: number }>();
    for (const bill of bills) {
      const type = this.inferOrderType(bill.tableLabel, bill.notes);
      let hall = type === "Dine-in" ? "Main hall" : type;
      if (type === "Dine-in") {
        const num = (bill.tableLabel.match(/\d+/) ?? [])[0];
        if (num && tableToHall.has(num)) hall = tableToHall.get(num)!;
        else if (bill.tableLabel.includes("·")) {
          hall = bill.tableLabel.split("·")[0]?.trim() || hall;
        }
      }
      const cur = map.get(hall) ?? { qty: 0, amount: 0 };
      cur.qty += 1;
      cur.amount += bill.totalPkr;
      map.set(hall, cur);
    }
    const rows = [...map.entries()]
      .map(([label, v]) => ({ label, qty: v.qty, amount: v.amount }))
      .sort((a, b) => b.amount - a.amount);
    return {
      rows,
      totals: { amount: rows.reduce((s, r) => s + r.amount, 0) },
      empty: rows.length === 0,
    };
  }

  private deliveryReport(bills: Awaited<ReturnType<ReportsService["completedBills"]>>) {
    const delivery = bills.filter((b) => this.inferOrderType(b.tableLabel, b.notes) === "Delivery");
    const rows = delivery.map((b) => ({
      label: b.billRef,
      amount: b.totalPkr,
      qty: 1,
      meta: [b.notes, b.orderRef].filter(Boolean).join(" · "),
    }));
    return {
      rows,
      totals: {
        orders: rows.length,
        deliveryCharge: delivery.reduce((s, b) => s + (b.deliveryChargePkr ?? 0), 0),
        amount: rows.reduce((s, r) => s + (r.amount ?? 0), 0),
      },
      empty: rows.length === 0,
    };
  }

  private discountReport(bills: Awaited<ReturnType<ReportsService["completedBills"]>>) {
    const discounted = bills.filter((b) => (b.discountPkr ?? 0) > 0);
    const rows = discounted.map((b) => ({
      label: b.billRef,
      amount: b.discountPkr,
      meta: `${b.waiterName} · total ${b.totalPkr}`,
    }));
    return {
      rows,
      totals: { orders: rows.length, discount: rows.reduce((s, r) => s + (r.amount ?? 0), 0) },
      empty: rows.length === 0,
    };
  }

  private async canceledOrders(organizationId: string, branchId: string, range: { from: string; to: string; fromTime: string; toTime: string }) {
    const voids = await this.db
      .select()
      .from(popsBills)
      .where(
        and(
          eq(popsBills.organizationId, organizationId),
          eq(popsBills.branchId, branchId),
          eq(popsBills.status, "void"),
          gte(popsBills.createdAt, this.rangeStart(range)),
          lte(popsBills.createdAt, this.rangeEnd(range)),
        ),
      )
      .orderBy(desc(popsBills.createdAt));

    const rows = voids.map((b) => ({
      label: b.billRef,
      amount: b.totalPkr,
      meta: `${b.tableLabel} · ${b.waiterName}`,
    }));
    return {
      rows,
      totals: { orders: rows.length, amount: rows.reduce((s, r) => s + (r.amount ?? 0), 0) },
      empty: rows.length === 0,
    };
  }

  private async itemRemove(organizationId: string, branchId: string, range: { from: string; to: string; fromTime: string; toTime: string }) {
    const rowsDb = await this.db
      .select()
      .from(popsKitchenLineCancellations)
      .where(
        and(
          eq(popsKitchenLineCancellations.organizationId, organizationId),
          eq(popsKitchenLineCancellations.branchId, branchId),
          gte(popsKitchenLineCancellations.canceledAt, this.rangeStart(range)),
          lte(popsKitchenLineCancellations.canceledAt, this.rangeEnd(range)),
        ),
      )
      .orderBy(desc(popsKitchenLineCancellations.canceledAt))
      .limit(500);

    const rows = rowsDb.map((r) => ({
      label: r.label,
      qty: r.qtyCanceled,
      amount: r.qtyCanceled * (r.unitPricePkr ?? 0),
      meta: `${r.ticketRef} · ${r.source} · ${r.canceledAt.toISOString()}`,
    }));
    return {
      rows,
      totals: {
        lines: rows.length,
        qty: rows.reduce((s, r) => s + (r.qty ?? 0), 0),
        amount: rows.reduce((s, r) => s + (r.amount ?? 0), 0),
      },
      empty: rows.length === 0,
    };
  }

  private async cashSessionReport(
    organizationId: string,
    branchId: string,
    range: { from: string; to: string; fromTime: string; toTime: string },
    mode: "cashier-out" | "cashier-overshort" | "cash-drawer",
  ) {
    const sessions = await this.db
      .select()
      .from(popsCashSessions)
      .where(
        and(
          eq(popsCashSessions.organizationId, organizationId),
          eq(popsCashSessions.branchId, branchId),
          gte(popsCashSessions.openedAt, this.rangeStart(range)),
          lte(popsCashSessions.openedAt, this.rangeEnd(range)),
        ),
      )
      .orderBy(desc(popsCashSessions.openedAt));

    let filtered = sessions;
    if (mode === "cashier-out") filtered = sessions.filter((s) => s.status === "closed");
    if (mode === "cashier-overshort") {
      filtered = sessions.filter((s) => s.status === "closed" && (s.variancePkr ?? 0) !== 0);
    }

    const rows = filtered.map((s) => ({
      label: s.sessionRef,
      amount: mode === "cashier-overshort" ? s.variancePkr ?? 0 : s.countedCashPkr ?? s.expectedCashPkr ?? 0,
      meta: [
        s.openedBy,
        s.closedBy ? `closed by ${s.closedBy}` : "open",
        s.variancePkr != null ? `var ${s.variancePkr}` : null,
        s.openingFloatPkr != null ? `float ${s.openingFloatPkr}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      qty: s.variancePkr ?? undefined,
    }));

    return {
      rows,
      totals: {
        sessions: rows.length,
        variance: filtered.reduce((s, r) => s + (r.variancePkr ?? 0), 0),
        counted: filtered.reduce((s, r) => s + (r.countedCashPkr ?? 0), 0),
      },
      empty: rows.length === 0,
    };
  }

  /**
   * Cash report — service charges, tax by rate (16% cash / 8% card·online),
   * remaining cash on hand, and bank receipts per account.
   */
  private async cashReport(
    organizationId: string,
    branchId: string,
    range: { from: string; to: string; fromTime: string; toTime: string },
  ) {
    const bills = await this.completedBills(organizationId, branchId, range);
    const voidBills = await this.db
      .select()
      .from(popsBills)
      .where(
        and(
          eq(popsBills.organizationId, organizationId),
          eq(popsBills.branchId, branchId),
          eq(popsBills.status, "void"),
          gte(popsBills.createdAt, this.rangeStart(range)),
          lte(popsBills.createdAt, this.rangeEnd(range)),
        ),
      );

    let serviceCharges = 0;
    let deliveryCharges = 0;
    let discountTotal = 0;
    let tax16 = 0;
    let tax8 = 0;
    let taxOther = 0;
    let cashReceived = 0;
    let cardReceived = 0;
    let walletReceived = 0;
    let bankPosReceived = 0;
    let serviceQty = 0;
    let deliveryQty = 0;
    let discountQty = 0;
    let tax16Qty = 0;
    let tax8Qty = 0;
    let taxOtherQty = 0;
    let cashQty = 0;
    let cardQty = 0;
    let walletQty = 0;
    let bankPosQty = 0;
    let canceledAmount = 0;

    for (const bill of bills) {
      const service = bill.servicePkr ?? 0;
      if (service > 0) {
        serviceCharges += service;
        serviceQty += 1;
      }
      const delivery = bill.deliveryChargePkr ?? 0;
      if (delivery > 0) {
        deliveryCharges += delivery;
        deliveryQty += 1;
      }
      const discount = bill.discountPkr ?? 0;
      if (discount > 0) {
        discountTotal += discount;
        discountQty += 1;
      }
      const tax = bill.taxPkr ?? 0;
      const pct = bill.taxPct ?? 0;
      if (tax > 0) {
        if (pct >= 12) {
          tax16 += tax;
          tax16Qty += 1;
        } else if (pct > 0) {
          tax8 += tax;
          tax8Qty += 1;
        } else {
          taxOther += tax;
          taxOtherQty += 1;
        }
      }

      let payments: { method?: string; amount?: number }[] = [];
      if (bill.paymentsJson) {
        try {
          const parsed = JSON.parse(bill.paymentsJson) as { method?: string; amount?: number }[];
          if (Array.isArray(parsed)) payments = parsed;
        } catch {
          payments = [];
        }
      }
      let billCash = 0;
      let billCard = 0;
      let billWallet = 0;
      let billBank = 0;
      for (const p of payments) {
        const amount = Math.max(0, Math.round(Number(p.amount ?? 0)));
        const method = String(p.method ?? "").toLowerCase();
        if (method === "cash") billCash += amount;
        else if (method === "card") billCard += amount;
        else if (method === "wallet") billWallet += amount;
        else if (method === "bank") billBank += amount;
      }
      if (billCash > 0) {
        cashReceived += billCash;
        cashQty += 1;
      }
      if (billCard > 0) {
        cardReceived += billCard;
        cardQty += 1;
      }
      if (billWallet > 0) {
        walletReceived += billWallet;
        walletQty += 1;
      }
      if (billBank > 0) {
        bankPosReceived += billBank;
        bankPosQty += 1;
      }
    }

    for (const bill of voidBills) {
      canceledAmount += bill.totalPkr ?? 0;
    }

    const movements = await this.db
      .select()
      .from(popsCashMovements)
      .where(
        and(
          eq(popsCashMovements.organizationId, organizationId),
          eq(popsCashMovements.branchId, branchId),
          gte(popsCashMovements.createdAt, this.rangeStart(range)),
          lte(popsCashMovements.createdAt, this.rangeEnd(range)),
        ),
      );

    let paidIn = 0;
    let paidOut = 0;
    let paidInQty = 0;
    let paidOutQty = 0;
    for (const m of movements) {
      if (m.type === "paid_in") {
        paidIn += m.amountPkr;
        paidInQty += 1;
      } else if (m.type === "paid_out") {
        paidOut += m.amountPkr;
        paidOutQty += 1;
      }
    }

    const remainingCash = cashReceived + paidIn - paidOut;

    const accounts = await this.db
      .select()
      .from(popsBankAccounts)
      .where(
        and(eq(popsBankAccounts.organizationId, organizationId), eq(popsBankAccounts.branchId, branchId)),
      )
      .orderBy(popsBankAccounts.name);

    const txns = await this.db
      .select()
      .from(popsBankTransactions)
      .where(
        and(
          eq(popsBankTransactions.organizationId, organizationId),
          eq(popsBankTransactions.branchId, branchId),
          gte(popsBankTransactions.txnDate, range.from),
          lte(popsBankTransactions.txnDate, range.to),
        ),
      );

    const depositsByAccount = new Map<string, { amount: number; qty: number }>();
    for (const t of txns) {
      if (t.type !== "deposit") continue;
      const cur = depositsByAccount.get(t.bankAccountId) ?? { amount: 0, qty: 0 };
      cur.amount += t.amountPkr;
      cur.qty += 1;
      depositsByAccount.set(t.bankAccountId, cur);
    }

    const rows: {
      label: string;
      amount: number;
      qty: number;
      meta?: string;
      section: string;
    }[] = [
      {
        section: "serviceCharges",
        label: "Total Service Charges collected",
        amount: serviceCharges,
        qty: serviceQty,
        meta: "Click to see bills",
      },
      {
        section: "tax16",
        label: "Total 16% tax collected",
        amount: tax16,
        qty: tax16Qty,
        meta: "Cash payment rate · click for bills",
      },
      {
        section: "tax8",
        label: "Total 8% tax collected",
        amount: tax8,
        qty: tax8Qty,
        meta: "Card / online / bank rate · click for bills",
      },
      {
        section: "remainingCash",
        label: "Remaining cash available",
        amount: remainingCash,
        qty: cashQty + paidInQty + paidOutQty,
        meta: `Cash ${cashReceived} + paid in ${paidIn} − paid out ${paidOut}`,
      },
      {
        section: "deliveryCharges",
        label: "Total delivery charges",
        amount: deliveryCharges,
        qty: deliveryQty,
        meta: "Click to see delivery bills",
      },
    ];
    if (taxOther > 0 || taxOtherQty > 0) {
      rows.push({
        section: "taxOther",
        label: "Other tax collected",
        amount: taxOther,
        qty: taxOtherQty,
        meta: "Non 8%/16% bills",
      });
    }
    rows.push(
      {
        section: "discount",
        label: "Discount given",
        amount: discountTotal,
        qty: discountQty,
        meta: "Click to see discounted bills",
      },
      {
        section: "canceledOrders",
        label: "Canceled orders",
        amount: canceledAmount,
        qty: voidBills.length,
        meta: "Void bills in range",
      },
      {
        section: "cashReceived",
        label: "Cash received (POS)",
        amount: cashReceived,
        qty: cashQty,
        meta: "Click to see cash bills",
      },
      {
        section: "cardReceived",
        label: "Card received",
        amount: cardReceived,
        qty: cardQty,
        meta: "Click to see card bills",
      },
      {
        section: "walletReceived",
        label: "Wallet / online received",
        amount: walletReceived,
        qty: walletQty,
        meta: "Click to see wallet bills",
      },
    );

    let bankDepositsTotal = 0;
    let bankDepositQty = 0;
    for (const acct of accounts) {
      const received = depositsByAccount.get(acct.id) ?? { amount: 0, qty: 0 };
      bankDepositsTotal += received.amount;
      bankDepositQty += received.qty;
      rows.push({
        section: `bank:${acct.id}`,
        label: `Bank · ${acct.name}`,
        amount: received.amount,
        qty: received.qty,
        meta: [acct.bankName, acct.accountNumber, `balance ${acct.balancePkr}`].filter(Boolean).join(" · "),
      });
    }
    if (bankPosReceived > 0 || bankPosQty > 0) {
      rows.push({
        section: "bankPos",
        label: "Bank transfer (POS sales)",
        amount: bankPosReceived,
        qty: bankPosQty,
        meta: "Not linked to a specific bank account",
      });
      bankDepositsTotal += bankPosReceived;
      bankDepositQty += bankPosQty;
    }

    const empty = false; // summary cards always returned

    return {
      rows,
      totals: {
        deliveryCharges,
        serviceCharges,
        tax16,
        tax8,
        taxOther,
        discount: discountTotal,
        canceledOrders: canceledAmount,
        canceledQty: voidBills.length,
        cashReceived,
        remainingCash,
        cardReceived,
        walletReceived,
        bankReceived: bankDepositsTotal,
        bills: bills.length,
        serviceQty,
        deliveryQty,
        discountQty,
        tax16Qty,
        tax8Qty,
        cashQty,
        cardQty,
        walletQty,
        bankDepositQty,
      },
      // Keep rows so Cash received method UI always renders the summary cards.
      empty,
    };
  }

  private async expenseReport(organizationId: string, branchId: string, range: { from: string; to: string; fromTime: string; toTime: string }) {
    const rowsDb = await this.db
      .select()
      .from(popsExpenses)
      .where(
        and(
          eq(popsExpenses.organizationId, organizationId),
          eq(popsExpenses.branchId, branchId),
          gte(popsExpenses.expenseDate, range.from),
          lte(popsExpenses.expenseDate, range.to),
        ),
      )
      .orderBy(desc(popsExpenses.expenseDate));

    const rows = rowsDb.map((e) => ({
      label: e.category,
      amount: e.amountPkr,
      meta: [e.expenseDate, e.vendor, e.description].filter(Boolean).join(" · "),
    }));
    return {
      rows,
      totals: { amount: rows.reduce((s, r) => s + (r.amount ?? 0), 0), count: rows.length },
      empty: rows.length === 0,
    };
  }

  private async kitchenPrintingLogs(organizationId: string, branchId: string, range: { from: string; to: string; fromTime: string; toTime: string }) {
    const tickets = await this.db
      .select()
      .from(popsKitchenTickets)
      .where(
        and(
          eq(popsKitchenTickets.organizationId, organizationId),
          eq(popsKitchenTickets.branchId, branchId),
          gte(popsKitchenTickets.createdAt, this.rangeStart(range)),
          lte(popsKitchenTickets.createdAt, this.rangeEnd(range)),
        ),
      )
      .orderBy(desc(popsKitchenTickets.createdAt))
      .limit(500);

    const rows = tickets.map((t) => ({
      label: t.ticketRef,
      meta: [t.orderRef, t.stationLabel, t.status, t.createdByName, t.createdAt.toISOString()].filter(Boolean).join(" · "),
      amount: undefined,
      qty: 1,
    }));
    return { rows, totals: { tickets: rows.length }, empty: rows.length === 0 };
  }

  private async kitchenMissingLog(organizationId: string, branchId: string, range: { from: string; to: string; fromTime: string; toTime: string }) {
    // Tickets closed/canceled without a linked bill, plus line cancellations after KOT.
    const tickets = await this.db
      .select()
      .from(popsKitchenTickets)
      .where(
        and(
          eq(popsKitchenTickets.organizationId, organizationId),
          eq(popsKitchenTickets.branchId, branchId),
          gte(popsKitchenTickets.createdAt, this.rangeStart(range)),
          lte(popsKitchenTickets.createdAt, this.rangeEnd(range)),
        ),
      )
      .orderBy(desc(popsKitchenTickets.createdAt))
      .limit(500);

    const missing = tickets.filter(
      (t) => !t.billId && (t.status === "canceled" || t.status === "closed" || t.status === "void"),
    );
    const rows = missing.map((t) => ({
      label: t.ticketRef,
      meta: [t.orderRef, t.stationLabel, t.status, t.itemsSummary?.slice(0, 80)].filter(Boolean).join(" · "),
    }));
    return { rows, totals: { tickets: rows.length }, empty: rows.length === 0 };
  }

  private async tableServerChange(
    organizationId: string,
    branchId: string,
    range: { from: string; to: string; fromTime: string; toTime: string },
  ) {
    // Proxy: bills where table/waiter pairing is recorded — list dine-in bills as server assignments in range.
    // Dedicated audit table is not yet persisted; this surfaces active server coverage for the period.
    const bills = await this.completedBills(organizationId, branchId, range);
    const dineIn = bills.filter((b) => this.inferOrderType(b.tableLabel, b.notes) === "Dine-in");
    const rows = dineIn.map((b) => ({
      label: b.tableLabel,
      meta: `${b.waiterName} · ${b.billRef} · ${b.createdAt.toISOString()}`,
      amount: b.totalPkr,
    }));
    return { rows, totals: { assignments: rows.length }, empty: rows.length === 0 };
  }

  private async vendorLedger(organizationId: string, branchId: string, range: { from: string; to: string; fromTime: string; toTime: string }) {
    const bills = await this.db
      .select({
        billRef: popsVendorBills.billRef,
        amountPkr: popsVendorBills.amountPkr,
        createdAt: popsVendorBills.createdAt,
        supplierName: popsSuppliers.name,
      })
      .from(popsVendorBills)
      .leftJoin(popsSuppliers, eq(popsVendorBills.supplierId, popsSuppliers.id))
      .where(
        and(
          eq(popsVendorBills.organizationId, organizationId),
          eq(popsVendorBills.branchId, branchId),
          gte(popsVendorBills.createdAt, this.rangeStart(range)),
          lte(popsVendorBills.createdAt, this.rangeEnd(range)),
        ),
      )
      .orderBy(desc(popsVendorBills.createdAt));

    const payments = await this.db
      .select({
        paymentRef: popsVendorPayments.paymentRef,
        amountPkr: popsVendorPayments.amountPkr,
        paymentDate: popsVendorPayments.paymentDate,
        supplierName: popsSuppliers.name,
      })
      .from(popsVendorPayments)
      .innerJoin(popsVendorBills, eq(popsVendorPayments.vendorBillId, popsVendorBills.id))
      .leftJoin(popsSuppliers, eq(popsVendorBills.supplierId, popsSuppliers.id))
      .where(
        and(
          eq(popsVendorBills.organizationId, organizationId),
          eq(popsVendorBills.branchId, branchId),
          gte(popsVendorPayments.paymentDate, range.from),
          lte(popsVendorPayments.paymentDate, range.to),
        ),
      )
      .orderBy(desc(popsVendorPayments.paymentDate));

    const rows = [
      ...bills.map((b) => ({
        label: b.supplierName || "Vendor",
        debit: b.amountPkr,
        credit: 0,
        amount: b.amountPkr,
        meta: `Bill ${b.billRef} · ${b.createdAt.toISOString().slice(0, 10)}`,
      })),
      ...payments.map((p) => ({
        label: p.supplierName || "Vendor",
        debit: 0,
        credit: p.amountPkr,
        amount: -p.amountPkr,
        meta: `Payment ${p.paymentRef} · ${p.paymentDate}`,
      })),
    ];
    return {
      rows,
      totals: {
        bills: bills.reduce((s, b) => s + b.amountPkr, 0),
        payments: payments.reduce((s, p) => s + p.amountPkr, 0),
      },
      empty: rows.length === 0,
    };
  }

  private async vendorsBalance(organizationId: string, branchId: string) {
    const suppliers = await this.db
      .select()
      .from(popsSuppliers)
      .where(and(eq(popsSuppliers.organizationId, organizationId), eq(popsSuppliers.branchId, branchId)));

    const billSums = await this.db
      .select({
        supplierId: popsVendorBills.supplierId,
        total: sql<number>`coalesce(sum(${popsVendorBills.amountPkr}), 0)`,
        paid: sql<number>`coalesce(sum(${popsVendorBills.paidPkr}), 0)`,
      })
      .from(popsVendorBills)
      .where(and(eq(popsVendorBills.organizationId, organizationId), eq(popsVendorBills.branchId, branchId)))
      .groupBy(popsVendorBills.supplierId);

    const billMap = new Map(
      billSums.map((r) => [r.supplierId, { total: Number(r.total), paid: Number(r.paid) }]),
    );

    const rows = suppliers
      .map((s) => {
        const sums = billMap.get(s.id) ?? { total: 0, paid: 0 };
        const balance = sums.total - sums.paid;
        return {
          label: s.name,
          amount: balance,
          debit: sums.total,
          credit: sums.paid,
          balance,
          meta: s.phone ?? s.email ?? undefined,
        };
      })
      .sort((a, b) => Math.abs(b.balance ?? 0) - Math.abs(a.balance ?? 0));

    return {
      rows,
      totals: { outstanding: rows.reduce((s, r) => s + (r.balance ?? 0), 0), vendors: rows.length },
      empty: rows.length === 0,
    };
  }

  private async customerLedger(
    organizationId: string,
    branchId: string,
    range: { from: string; to: string; fromTime: string; toTime: string },
  ) {
    // Full branch invoices (for open balances) + period payments.
    const invoices = await this.db
      .select()
      .from(popsCustomerInvoices)
      .where(
        and(
          eq(popsCustomerInvoices.organizationId, organizationId),
          eq(popsCustomerInvoices.branchId, branchId),
        ),
      )
      .orderBy(desc(popsCustomerInvoices.createdAt));

    const payments = await this.db
      .select({
        paymentRef: popsCustomerPayments.paymentRef,
        amountPkr: popsCustomerPayments.amountPkr,
        paymentDate: popsCustomerPayments.paymentDate,
        customerName: popsCustomerInvoices.customerName,
        customerPhone: popsCustomerInvoices.customerPhone,
      })
      .from(popsCustomerPayments)
      .innerJoin(popsCustomerInvoices, eq(popsCustomerPayments.invoiceId, popsCustomerInvoices.id))
      .where(
        and(
          eq(popsCustomerInvoices.organizationId, organizationId),
          eq(popsCustomerInvoices.branchId, branchId),
          gte(popsCustomerPayments.paymentDate, range.from),
          lte(popsCustomerPayments.paymentDate, range.to),
        ),
      )
      .orderBy(desc(popsCustomerPayments.paymentDate));

    const start = this.rangeStart(range);
    const end = this.rangeEnd(range);

    const map = new Map<
      string,
      { debit: number; credit: number; balance: number; qty: number; phone: string | null }
    >();

    for (const inv of invoices) {
      const openBal = Math.max(0, inv.amountPkr - inv.paidPkr);
      const createdInRange = inv.createdAt >= start && inv.createdAt <= end;
      // Show customers with activity in range, or any open receivable.
      if (!createdInRange && openBal <= 0) continue;

      const key = `${inv.customerName}|${inv.customerPhone ?? ""}`;
      const cur = map.get(key) ?? {
        debit: 0,
        credit: 0,
        balance: 0,
        qty: 0,
        phone: inv.customerPhone,
      };
      if (createdInRange) {
        cur.debit += inv.amountPkr;
        cur.credit += inv.paidPkr;
        cur.qty += 1;
      }
      cur.balance += openBal;
      map.set(key, cur);
    }

    // Payments in range for invoices created outside the window.
    for (const p of payments) {
      const key = `${p.customerName}|${p.customerPhone ?? ""}`;
      const cur = map.get(key) ?? {
        debit: 0,
        credit: 0,
        balance: 0,
        qty: 0,
        phone: p.customerPhone,
      };
      cur.credit += p.amountPkr;
      map.set(key, cur);
    }

    const rows = [...map.entries()]
      .map(([key, v]) => {
        const label = key.split("|")[0] || "Customer";
        return {
          label,
          debit: v.debit,
          credit: v.credit,
          balance: v.balance,
          amount: v.balance,
          qty: v.qty,
          meta: [v.phone, v.qty ? `${v.qty} invoice(s) in range` : "open balance", `outstanding ${v.balance}`]
            .filter(Boolean)
            .join(" · "),
        };
      })
      .sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0));

    return {
      rows,
      totals: {
        debit: rows.reduce((s, r) => s + (r.debit ?? 0), 0),
        credit: rows.reduce((s, r) => s + (r.credit ?? 0), 0),
        balance: rows.reduce((s, r) => s + (r.balance ?? 0), 0),
        customers: rows.length,
      },
      empty: rows.length === 0,
    };
  }

  private async employeeLedger(
    organizationId: string,
    branchId: string,
    range: { from: string; to: string; fromTime: string; toTime: string },
  ) {
    const employees = await this.db
      .select()
      .from(popsEmployees)
      .where(and(eq(popsEmployees.organizationId, organizationId), eq(popsEmployees.branchId, branchId)))
      .orderBy(popsEmployees.displayName);

    const advances = await this.db
      .select()
      .from(popsEmployeeAdvances)
      .where(
        and(
          eq(popsEmployeeAdvances.organizationId, organizationId),
          eq(popsEmployeeAdvances.branchId, branchId),
        ),
      );

    const openByEmployee = new Map<string, { amount: number; count: number }>();
    for (const a of advances) {
      if (a.status !== "open" && a.status !== "reserved") continue;
      const cur = openByEmployee.get(a.employeeId) ?? { amount: 0, count: 0 };
      cur.amount += a.amountPkr;
      cur.count += 1;
      openByEmployee.set(a.employeeId, cur);
    }

    const bills = await this.completedBills(organizationId, branchId, range);
    const salesByName = new Map<string, { qty: number; amount: number }>();
    for (const bill of bills) {
      const name = (bill.waiterName || "").trim().toLowerCase();
      if (!name) continue;
      const cur = salesByName.get(name) ?? { qty: 0, amount: 0 };
      cur.qty += 1;
      cur.amount += bill.totalPkr;
      salesByName.set(name, cur);
    }

    const rows = employees
      .filter((e) => e.employmentStatus !== "terminated")
      .map((e) => {
        const adv = openByEmployee.get(e.id) ?? { amount: 0, count: 0 };
        const sales = salesByName.get(e.displayName.trim().toLowerCase()) ?? { qty: 0, amount: 0 };
        const remaining = Math.max(0, e.baseSalaryPkr - adv.amount);
        return {
          label: e.displayName,
          debit: e.baseSalaryPkr,
          credit: adv.amount,
          balance: remaining,
          amount: sales.amount,
          qty: sales.qty,
          meta: [
            e.jobTitle,
            e.employeeCode,
            `advances ${adv.count}`,
            sales.qty > 0 ? `${sales.qty} sales` : null,
          ]
            .filter(Boolean)
            .join(" · "),
        };
      });

    return {
      rows,
      totals: {
        salary: rows.reduce((s, r) => s + (r.debit ?? 0), 0),
        advances: rows.reduce((s, r) => s + (r.credit ?? 0), 0),
        remaining: rows.reduce((s, r) => s + (r.balance ?? 0), 0),
        sales: rows.reduce((s, r) => s + (r.amount ?? 0), 0),
        employees: rows.length,
      },
      empty: rows.length === 0,
    };
  }

  private async ingredientsUsage(organizationId: string, branchId: string, range: { from: string; to: string; fromTime: string; toTime: string }) {
    const adjustments = await this.db
      .select({
        type: popsStockAdjustments.type,
        qty: popsStockAdjustments.qty,
        reason: popsStockAdjustments.reason,
        createdAt: popsStockAdjustments.createdAt,
        name: popsIngredients.name,
        unitCostPkr: popsIngredients.unitCostPkr,
        unit: popsStockAdjustments.unit,
      })
      .from(popsStockAdjustments)
      .leftJoin(popsIngredients, eq(popsStockAdjustments.ingredientId, popsIngredients.id))
      .where(
        and(
          eq(popsStockAdjustments.organizationId, organizationId),
          eq(popsStockAdjustments.branchId, branchId),
          gte(popsStockAdjustments.createdAt, this.rangeStart(range)),
          lte(popsStockAdjustments.createdAt, this.rangeEnd(range)),
        ),
      )
      .orderBy(desc(popsStockAdjustments.createdAt))
      .limit(500);

    const usage = adjustments.filter((a) => a.type === "Remove" || /consume|usage|recipe/i.test(a.reason ?? ""));
    const rows = usage.map((a) => ({
      label: a.name || "Ingredient",
      qty: a.qty,
      amount: a.qty * (a.unitCostPkr ?? 0),
      meta: [a.type, a.unit, a.reason, a.createdAt.toISOString()].filter(Boolean).join(" · "),
    }));
    return {
      rows,
      totals: { qty: rows.reduce((s, r) => s + (r.qty ?? 0), 0), amount: rows.reduce((s, r) => s + (r.amount ?? 0), 0) },
      empty: rows.length === 0,
    };
  }

  private async ingredientsStock(organizationId: string, branchId: string) {
    const ingredients = await this.db
      .select()
      .from(popsIngredients)
      .where(and(eq(popsIngredients.organizationId, organizationId), eq(popsIngredients.branchId, branchId)))
      .orderBy(popsIngredients.name);

    const rows = ingredients.map((i) => ({
      label: i.name,
      qty: i.currentStock,
      amount: i.currentStock * i.unitCostPkr,
      meta: `${i.sku} · ${i.unit} · reorder ${i.reorderLevel}`,
    }));
    return {
      rows,
      totals: {
        items: rows.length,
        value: rows.reduce((s, r) => s + (r.amount ?? 0), 0),
      },
      empty: rows.length === 0,
    };
  }

  /** Extract party/customer name from POS notes (`Channel · Name · phone · …`) or table label. */
  private partyNameFromBill(notes: string | null, tableLabel: string, waiterName: string): string {
    const n = (notes ?? "").trim();
    if (n) {
      const parts = n.split("·").map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const candidate = parts[1]!;
        if (candidate && !/^\+?\d[\d\s-]{5,}$/.test(candidate)) return candidate;
      }
      if (parts.length === 1 && parts[0] && !/^(delivery|takeaway|online|foodpanda)/i.test(parts[0])) {
        return parts[0];
      }
    }
    const t = (tableLabel ?? "").trim();
    if (/staff food/i.test(t)) {
      const after = t.split("·").map((p) => p.trim()).filter(Boolean);
      if (after.length >= 2) return after[after.length - 1]!.replace(/^Guest:\s*/i, "");
    }
    if (t && !/^(dine-in|takeaway|delivery|online|foodpanda)/i.test(t)) return t;
    return waiterName?.trim() || "Walk-in";
  }

  private async dayBook(
    organizationId: string,
    branchId: string,
    range: { from: string; to: string; fromTime: string; toTime: string },
  ) {
    const bills = await this.completedBills(organizationId, branchId, range);

    const expenses = await this.db
      .select()
      .from(popsExpenses)
      .where(
        and(
          eq(popsExpenses.organizationId, organizationId),
          eq(popsExpenses.branchId, branchId),
          gte(popsExpenses.expenseDate, range.from),
          lte(popsExpenses.expenseDate, range.to),
        ),
      );

    const vendorPayments = await this.db
      .select({
        paymentRef: popsVendorPayments.paymentRef,
        amountPkr: popsVendorPayments.amountPkr,
        paymentDate: popsVendorPayments.paymentDate,
        supplierName: popsSuppliers.name,
      })
      .from(popsVendorPayments)
      .innerJoin(popsVendorBills, eq(popsVendorPayments.vendorBillId, popsVendorBills.id))
      .leftJoin(popsSuppliers, eq(popsVendorBills.supplierId, popsSuppliers.id))
      .where(
        and(
          eq(popsVendorBills.organizationId, organizationId),
          eq(popsVendorBills.branchId, branchId),
          gte(popsVendorPayments.paymentDate, range.from),
          lte(popsVendorPayments.paymentDate, range.to),
        ),
      );

    const cashMoves = await this.db
      .select()
      .from(popsCashMovements)
      .where(
        and(
          eq(popsCashMovements.organizationId, organizationId),
          eq(popsCashMovements.branchId, branchId),
          gte(popsCashMovements.createdAt, this.rangeStart(range)),
          lte(popsCashMovements.createdAt, this.rangeEnd(range)),
        ),
      );

    type DayRow = {
      label: string;
      meta: string;
      amount: number;
      debit: number;
      credit: number;
      sortKey: string;
    };

    const rows: DayRow[] = [];

    for (const b of bills) {
      const name = this.partyNameFromBill(b.notes, b.tableLabel, b.waiterName);
      const moneyIn = b.totalPkr;
      rows.push({
        label: name,
        meta: `${b.billRef} · Sale`,
        amount: moneyIn,
        debit: moneyIn,
        credit: 0,
        sortKey: b.createdAt.toISOString(),
      });
    }

    for (const e of expenses) {
      rows.push({
        label: e.vendor?.trim() || e.category,
        meta: `${e.expenseDate} · Expense · ${e.category}`,
        amount: e.amountPkr,
        debit: 0,
        credit: e.amountPkr,
        sortKey: `${e.expenseDate}T12:00:00+05:00`,
      });
    }

    for (const p of vendorPayments) {
      rows.push({
        label: p.supplierName || "Vendor",
        meta: `${p.paymentRef} · Vendor payment`,
        amount: p.amountPkr,
        debit: 0,
        credit: p.amountPkr,
        sortKey: `${p.paymentDate}T12:00:00+05:00`,
      });
    }

    for (const m of cashMoves) {
      const isOut = m.type === "paid_out";
      rows.push({
        label: m.reason || (isOut ? "Cash out" : "Cash in"),
        meta: `${m.createdAt.toISOString().slice(0, 10)} · Cash ${isOut ? "out" : "in"}`,
        amount: m.amountPkr,
        debit: isOut ? 0 : m.amountPkr,
        credit: isOut ? m.amountPkr : 0,
        sortKey: m.createdAt.toISOString(),
      });
    }

    rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    const moneyIn = rows.reduce((s, r) => s + r.debit, 0);
    const moneyOut = rows.reduce((s, r) => s + r.credit, 0);

    return {
      rows: rows.map(({ sortKey: _s, ...r }) => r),
      totals: { moneyIn, moneyOut, net: moneyIn - moneyOut, count: rows.length },
      empty: rows.length === 0,
    };
  }

  private async inOutReport(
    organizationId: string,
    branchId: string,
    range: { from: string; to: string; fromTime: string; toTime: string },
  ) {
    const bills = await this.completedBills(organizationId, branchId, range);
    const cashIn = bills.reduce((s, b) => s + (b.totalPkr ?? 0), 0);

    const expenses = await this.db
      .select()
      .from(popsExpenses)
      .where(
        and(
          eq(popsExpenses.organizationId, organizationId),
          eq(popsExpenses.branchId, branchId),
          gte(popsExpenses.expenseDate, range.from),
          lte(popsExpenses.expenseDate, range.to),
        ),
      );
    const expenseRows = expenses.filter((e) => e.status !== "Rejected");
    const expensesTotal = expenseRows.reduce((s, e) => s + e.amountPkr, 0);

    const payrolls = await this.db
      .select()
      .from(popsPayrollRuns)
      .where(
        and(
          eq(popsPayrollRuns.organizationId, organizationId),
          eq(popsPayrollRuns.branchId, branchId),
          eq(popsPayrollRuns.status, "paid"),
        ),
      );
    const paidPayrolls = payrolls.filter((p) => {
      const when = p.paidAt ?? p.createdAt;
      return when >= this.rangeStart(range) && when <= this.rangeEnd(range);
    });
    const salariesTotal = paidPayrolls.reduce((s, p) => s + Math.max(0, p.totalNetPkr ?? 0), 0);

    const advances = await this.db
      .select()
      .from(popsEmployeeAdvances)
      .where(
        and(
          eq(popsEmployeeAdvances.organizationId, organizationId),
          eq(popsEmployeeAdvances.branchId, branchId),
          gte(popsEmployeeAdvances.createdAt, this.rangeStart(range)),
          lte(popsEmployeeAdvances.createdAt, this.rangeEnd(range)),
        ),
      );
    const advancesTotal = advances.reduce((s, a) => s + a.amountPkr, 0);

    const vendorPayments = await this.db
      .select({
        amountPkr: popsVendorPayments.amountPkr,
      })
      .from(popsVendorPayments)
      .innerJoin(popsVendorBills, eq(popsVendorPayments.vendorBillId, popsVendorBills.id))
      .where(
        and(
          eq(popsVendorBills.organizationId, organizationId),
          eq(popsVendorBills.branchId, branchId),
          gte(popsVendorPayments.paymentDate, range.from),
          lte(popsVendorPayments.paymentDate, range.to),
        ),
      );

    const cashSupplierMoves = await this.db
      .select()
      .from(popsCashMovements)
      .where(
        and(
          eq(popsCashMovements.organizationId, organizationId),
          eq(popsCashMovements.branchId, branchId),
          eq(popsCashMovements.type, "paid_out"),
          gte(popsCashMovements.createdAt, this.rangeStart(range)),
          lte(popsCashMovements.createdAt, this.rangeEnd(range)),
        ),
      );
    const supplierFromCash = cashSupplierMoves
      .filter((m) => m.partyKind === "supplier")
      .reduce((s, m) => s + m.amountPkr, 0);
    const supplierFromPayments = vendorPayments.reduce((s, p) => s + p.amountPkr, 0);
    const supplierPayments = supplierFromCash > 0 ? supplierFromCash : supplierFromPayments;
    const supplierQty =
      supplierFromCash > 0
        ? cashSupplierMoves.filter((m) => m.partyKind === "supplier").length
        : vendorPayments.length;

    const grns = await this.db
      .select()
      .from(popsGoodsReceipts)
      .where(
        and(
          eq(popsGoodsReceipts.organizationId, organizationId),
          eq(popsGoodsReceipts.branchId, branchId),
          gte(popsGoodsReceipts.deliveryDate, range.from),
          lte(popsGoodsReceipts.deliveryDate, range.to),
        ),
      );
    const purchasingTotal = grns.reduce((s, g) => s + (g.totalCostPkr ?? 0), 0);

    const cashOut =
      expensesTotal + salariesTotal + advancesTotal + supplierPayments + purchasingTotal;
    const net = cashIn - cashOut;

    const rows = [
      {
        section: "cashIn",
        label: "Total Sale (Cash In)",
        amount: cashIn,
        qty: bills.length,
        debit: cashIn,
        credit: 0,
        meta: "Completed bills · all payment methods",
      },
      {
        section: "expenses",
        label: "Expenses",
        amount: expensesTotal,
        qty: expenseRows.length,
        debit: 0,
        credit: expensesTotal,
        meta: "Daily expenses in range",
      },
      {
        section: "salaries",
        label: "Salaries",
        amount: salariesTotal,
        qty: paidPayrolls.length,
        debit: 0,
        credit: salariesTotal,
        meta: "Paid payroll net",
      },
      {
        section: "advances",
        label: "Employees Advance",
        amount: advancesTotal,
        qty: advances.length,
        debit: 0,
        credit: advancesTotal,
        meta: "Staff advances given",
      },
      {
        section: "supplierPayments",
        label: "Supplier Payments",
        amount: supplierPayments,
        qty: supplierQty,
        debit: 0,
        credit: supplierPayments,
        meta: supplierFromCash > 0 ? "Cash pay-outs to suppliers" : "Vendor payments recorded",
      },
      {
        section: "purchasing",
        label: "Purchasing",
        amount: purchasingTotal,
        qty: grns.length,
        debit: 0,
        credit: purchasingTotal,
        meta: "Goods received (GRN) stock value",
      },
      {
        section: "cashOut",
        label: "Total Cash Out",
        amount: cashOut,
        qty: expenseRows.length + paidPayrolls.length + advances.length + supplierQty + grns.length,
        debit: 0,
        credit: cashOut,
        meta: "Expenses + Salaries + Advances + Supplier + Purchasing",
      },
      {
        section: "net",
        label: "Net Cash",
        amount: net,
        qty: 1,
        debit: net >= 0 ? net : 0,
        credit: net < 0 ? Math.abs(net) : 0,
        balance: net,
        meta: "Cash In − Cash Out",
      },
    ];

    return {
      rows,
      totals: {
        cashIn,
        cashOut,
        net,
        sale: cashIn,
        expenses: expensesTotal,
        salaries: salariesTotal,
        advances: advancesTotal,
        supplierPayments,
        purchasing: purchasingTotal,
      },
      empty: cashIn === 0 && cashOut === 0,
    };
  }

  private async kitchenWisePurchase(
    organizationId: string,
    branchId: string,
    range: { from: string; to: string; fromTime: string; toTime: string },
  ) {
    const pos = await this.db
      .select({
        id: popsPurchaseOrders.id,
        poNumber: popsPurchaseOrders.poNumber,
        totalAmountPkr: popsPurchaseOrders.totalAmountPkr,
        chef: popsPurchaseOrders.chef,
        requestedBy: popsPurchaseOrders.requestedBy,
        createdAt: popsPurchaseOrders.createdAt,
        supplierName: popsSuppliers.name,
      })
      .from(popsPurchaseOrders)
      .leftJoin(popsSuppliers, eq(popsPurchaseOrders.supplierId, popsSuppliers.id))
      .where(
        and(
          eq(popsPurchaseOrders.organizationId, organizationId),
          eq(popsPurchaseOrders.branchId, branchId),
          gte(popsPurchaseOrders.createdAt, this.rangeStart(range)),
          lte(popsPurchaseOrders.createdAt, this.rangeEnd(range)),
        ),
      )
      .orderBy(desc(popsPurchaseOrders.createdAt));

    const lines =
      pos.length === 0
        ? []
        : await this.db
            .select({
              purchaseOrderId: popsPurchaseOrderLines.purchaseOrderId,
              qty: popsPurchaseOrderLines.qty,
              ingredientName: popsIngredients.name,
            })
            .from(popsPurchaseOrderLines)
            .leftJoin(popsIngredients, eq(popsPurchaseOrderLines.ingredientId, popsIngredients.id))
            .where(inArray(popsPurchaseOrderLines.purchaseOrderId, pos.map((p) => p.id)));

    const linesByPo = new Map<string, { qty: number; items: string[] }>();
    for (const line of lines) {
      const cur = linesByPo.get(line.purchaseOrderId) ?? { qty: 0, items: [] };
      cur.qty += line.qty;
      if (line.ingredientName) cur.items.push(`${line.ingredientName}×${line.qty}`);
      linesByPo.set(line.purchaseOrderId, cur);
    }

    const rows = pos
      .map((po) => {
        const kitchen = (po.chef?.trim() || po.requestedBy?.trim() || "Unassigned").trim();
        const lineInfo = linesByPo.get(po.id);
        const itemSummary = lineInfo?.items.slice(0, 4).join(", ") ?? "";
        const more = (lineInfo?.items.length ?? 0) > 4 ? "…" : "";
        return {
          label: kitchen,
          qty: lineInfo?.qty ?? 0,
          amount: po.totalAmountPkr,
          meta: `${po.poNumber} · ${po.supplierName || "Supplier"}${itemSummary ? ` · ${itemSummary}${more}` : ""}`,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label) || (b.amount ?? 0) - (a.amount ?? 0));

    return {
      rows,
      totals: {
        amount: rows.reduce((s, r) => s + (r.amount ?? 0), 0),
        orders: rows.length,
      },
      empty: rows.length === 0,
    };
  }

  private async salePurchaseByParty(
    organizationId: string,
    branchId: string,
    range: { from: string; to: string; fromTime: string; toTime: string },
  ) {
    const bills = await this.completedBills(organizationId, branchId, range);
    const saleMap = new Map<string, number>();
    for (const b of bills) {
      const name = this.partyNameFromBill(b.notes, b.tableLabel, b.waiterName);
      saleMap.set(name, (saleMap.get(name) ?? 0) + b.totalPkr);
    }

    // Credit invoices also count as party sales in the period.
    const invoices = await this.db
      .select()
      .from(popsCustomerInvoices)
      .where(
        and(
          eq(popsCustomerInvoices.organizationId, organizationId),
          eq(popsCustomerInvoices.branchId, branchId),
          gte(popsCustomerInvoices.createdAt, this.rangeStart(range)),
          lte(popsCustomerInvoices.createdAt, this.rangeEnd(range)),
        ),
      );
    for (const inv of invoices) {
      const name = inv.customerName.trim() || "Customer";
      saleMap.set(name, (saleMap.get(name) ?? 0) + inv.amountPkr);
    }

    const vendorBills = await this.db
      .select({
        amountPkr: popsVendorBills.amountPkr,
        supplierName: popsSuppliers.name,
      })
      .from(popsVendorBills)
      .leftJoin(popsSuppliers, eq(popsVendorBills.supplierId, popsSuppliers.id))
      .where(
        and(
          eq(popsVendorBills.organizationId, organizationId),
          eq(popsVendorBills.branchId, branchId),
          gte(popsVendorBills.createdAt, this.rangeStart(range)),
          lte(popsVendorBills.createdAt, this.rangeEnd(range)),
        ),
      );

    const purchaseMap = new Map<string, number>();
    for (const vb of vendorBills) {
      const name = vb.supplierName?.trim() || "Vendor";
      purchaseMap.set(name, (purchaseMap.get(name) ?? 0) + vb.amountPkr);
    }

    const names = new Set([...saleMap.keys(), ...purchaseMap.keys()]);
    const rows = [...names]
      .map((name) => {
        const sale = saleMap.get(name) ?? 0;
        const purchase = purchaseMap.get(name) ?? 0;
        return {
          label: name,
          debit: sale,
          credit: purchase,
          amount: sale,
          balance: purchase,
          meta: `Sale ${sale} · Purchase ${purchase}`,
        };
      })
      .sort((a, b) => b.debit + b.credit - (a.debit + a.credit));

    const saleTotal = rows.reduce((s, r) => s + (r.debit ?? 0), 0);
    const purchaseTotal = rows.reduce((s, r) => s + (r.credit ?? 0), 0);

    return {
      rows,
      totals: { saleTotal, purchaseTotal, parties: rows.length },
      empty: rows.length === 0,
    };
  }

  private async partyReport(organizationId: string, branchId: string) {
    const invoices = await this.db
      .select()
      .from(popsCustomerInvoices)
      .where(
        and(
          eq(popsCustomerInvoices.organizationId, organizationId),
          eq(popsCustomerInvoices.branchId, branchId),
        ),
      );

    const customers = new Map<
      string,
      { name: string; phone: string | null; email: string | null; receivable: number }
    >();
    for (const inv of invoices) {
      const key = `${inv.customerName}|${inv.customerPhone ?? ""}`;
      const open = Math.max(0, inv.amountPkr - inv.paidPkr);
      const cur = customers.get(key) ?? {
        name: inv.customerName,
        phone: inv.customerPhone,
        email: null,
        receivable: 0,
      };
      cur.receivable += open;
      customers.set(key, cur);
    }

    const suppliers = await this.db
      .select()
      .from(popsSuppliers)
      .where(and(eq(popsSuppliers.organizationId, organizationId), eq(popsSuppliers.branchId, branchId)));

    const billSums = await this.db
      .select({
        supplierId: popsVendorBills.supplierId,
        total: sql<number>`coalesce(sum(${popsVendorBills.amountPkr}), 0)`,
        paid: sql<number>`coalesce(sum(${popsVendorBills.paidPkr}), 0)`,
      })
      .from(popsVendorBills)
      .where(and(eq(popsVendorBills.organizationId, organizationId), eq(popsVendorBills.branchId, branchId)))
      .groupBy(popsVendorBills.supplierId);

    const billMap = new Map(
      billSums.map((r) => [r.supplierId, { total: Number(r.total), paid: Number(r.paid) }]),
    );

    const rows = [
      ...[...customers.values()]
        .filter((c) => c.receivable > 0 || Boolean(c.phone))
        .map((c) => ({
          label: c.name,
          debit: c.receivable,
          credit: 0,
          balance: c.receivable,
          amount: c.receivable,
          meta: [c.email || "—", c.phone || "—"].join(" · "),
        })),
      ...suppliers.map((s) => {
        const sums = billMap.get(s.id) ?? { total: 0, paid: 0 };
        const payable = Math.max(0, sums.total - sums.paid + (s.openingBalancePkr ?? 0));
        return {
          label: s.name,
          debit: 0,
          credit: payable,
          balance: -payable,
          amount: payable,
          meta: [s.email || "—", s.phone || "—"].join(" · "),
        };
      }),
    ].sort((a, b) => Math.abs(b.debit ?? 0) + Math.abs(b.credit ?? 0) - (Math.abs(a.debit ?? 0) + Math.abs(a.credit ?? 0)));

    return {
      rows,
      totals: {
        receivable: rows.reduce((s, r) => s + (r.debit ?? 0), 0),
        payable: rows.reduce((s, r) => s + (r.credit ?? 0), 0),
        parties: rows.length,
      },
      empty: rows.length === 0,
    };
  }
}
