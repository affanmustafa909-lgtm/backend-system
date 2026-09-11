import { z } from "zod";

export const popsRoleSchema = z.enum([
  "admin",
  "manager",
  "cashier",
  "waiter",
  "kitchen",
  "accountant",
  "hr",
  "rider",
]);

export const capabilityAccessSchema = z.enum(["allow", "pin", "deny"]);

export const popsCapabilitySchema = z.object({
  id: z.string(),
  label: z.string(),
});

export const roleTemplateSchema = z.object({
  id: popsRoleSchema,
  label: z.string(),
  permissions: z.array(z.string()),
  capabilities: z.record(z.string(), capabilityAccessSchema),
  /**
   * Default sidebar pages for new users of this role.
   * `null` / omitted = all pages allowed by module permissions.
   */
  navAllowlist: z.array(z.string()).nullable().optional(),
});

export const orgUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  role: z.string(),
  branchScope: z.string(),
  pinRequired: z.boolean(),
  permissions: z.array(z.string()).default([]),
  /** When false, the user cannot sign in. Older APIs may omit this. */
  active: z.preprocess(
    (v) => (v === undefined ? true : v),
    z.boolean(),
  ),
  /**
   * Allowed ERP nav paths (e.g. `pos`, `inventory/stock`).
   * `null` = all paths allowed by the user's permissions.
   * Older APIs may omit this.
   */
  navAllowlist: z.preprocess(
    (v) => (v === undefined ? null : v),
    z.array(z.string()).nullable(),
  ),
  lastActivityAt: z.string().nullable(),
});

export const createOrgUserSchema = z.object({
  email: z.string().min(3).max(320),
  password: z.string().min(8).max(128),
  role: popsRoleSchema,
  branchScope: z.string().min(1).max(64),
  pinRequired: z.boolean().default(false),
  staffPin: z.string().regex(/^\d{4}$/).optional(),
});

export const updateOrgUserSchema = z.object({
  role: popsRoleSchema.optional(),
  branchScope: z.string().min(1).max(64).optional(),
  pinRequired: z.boolean().optional(),
  password: z.string().min(8).max(128).optional(),
  staffPin: z.string().regex(/^\d{4}$/).optional(),
  /** Replace membership permissions (module access). */
  permissions: z.array(z.string()).optional(),
  active: z.boolean().optional(),
  /** Pass `null` to clear and allow all permission-gated paths. */
  navAllowlist: z.array(z.string()).nullable().optional(),
});

export const resetUserPasswordSchema = z.object({
  password: z.string().min(8).max(128),
});

/** Self-service PIN management — a staff member creating/updating/removing their own PIN. */
export const setOwnPinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/).nullable(),
});

export const inviteOrgUserSchema = z.object({
  email: z.string().min(3).max(320),
  role: popsRoleSchema,
  branchScope: z.string().min(1).max(64),
  pinRequired: z.boolean().default(false),
});

export const inviteOrgUserResultSchema = z.object({
  email: z.string(),
  emailSent: z.boolean(),
  inviteUrl: z.string().url(),
  expiresAt: z.string(),
});

export const pendingInviteSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  role: z.string(),
  branchScope: z.string(),
  pinRequired: z.boolean(),
  expiresAt: z.string(),
  createdAt: z.string(),
});

export const invitePreviewSchema = z.object({
  email: z.string(),
  role: z.string(),
  branchScope: z.string(),
  organizationName: z.string(),
  expiresAt: z.string(),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(8).max(128),
});

export const accessControlSchema = z.object({
  capabilities: z.array(popsCapabilitySchema),
  roles: z.array(roleTemplateSchema),
});

/** Staff who can be assigned to printer sections (waiters, cashiers, kitchen, …). */
export const assignableStaffOptionSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  name: z.string(),
  role: z.string(),
  branchScope: z.string(),
});

export type PopsRole = z.infer<typeof popsRoleSchema>;
export type OrgUser = z.infer<typeof orgUserSchema>;
export type CreateOrgUser = z.infer<typeof createOrgUserSchema>;
export type UpdateOrgUser = z.infer<typeof updateOrgUserSchema>;
export type SetOwnPin = z.infer<typeof setOwnPinSchema>;
export type InviteOrgUser = z.infer<typeof inviteOrgUserSchema>;
export type InviteOrgUserResult = z.infer<typeof inviteOrgUserResultSchema>;
export type PendingInvite = z.infer<typeof pendingInviteSchema>;
export type InvitePreview = z.infer<typeof invitePreviewSchema>;
export type AcceptInvite = z.infer<typeof acceptInviteSchema>;
export type RoleTemplate = z.infer<typeof roleTemplateSchema>;
export type AccessControl = z.infer<typeof accessControlSchema>;
export type AssignableStaffOption = z.infer<typeof assignableStaffOptionSchema>;

export const POPS_CAPABILITIES: { id: string; label: string }[] = [
  { id: "pops.pos.void", label: "Void line" },
  { id: "pops.pos.discount", label: "Discount override" },
  { id: "pops.closing.report", label: "Z-report" },
  { id: "pops.kitchen.bump", label: "KOT bump" },
];

const CAP_KEYS = ["pops.pos.void", "pops.pos.discount", "pops.closing.report", "pops.kitchen.bump"] as const;

export const POPS_ROLE_TEMPLATES: RoleTemplate[] = [
  {
    id: "admin",
    label: "Admin",
    permissions: [
      "*",
      "pops.users.manage",
      "pops.menu.manage",
      "pops.inventory.manage",
      "pops.hr.manage",
      "pops.multi_branch.manage",
      "pops.notifications.manage",
      "pops.accounting.manage",
      "pops.read",
      "catalog.read",
      "sync.push",
      "modules.sample.use",
    ],
    capabilities: {
      "pops.pos.void": "allow",
      "pops.pos.discount": "allow",
      "pops.closing.report": "allow",
      "pops.kitchen.bump": "allow",
    },
  },
  {
    id: "manager",
    label: "Manager",
    permissions: [
      "pops.read",
      "pops.users.manage",
      "pops.menu.manage",
      "pops.inventory.manage",
      "pops.hr.manage",
      "pops.multi_branch.manage",
      "pops.notifications.manage",
      "pops.accounting.manage",
      "pops.pos.void",
      "pops.pos.discount",
      "pops.closing.report",
      "pops.kitchen.bump",
      "catalog.read",
    ],
    capabilities: {
      "pops.pos.void": "pin",
      "pops.pos.discount": "pin",
      "pops.closing.report": "allow",
      "pops.kitchen.bump": "allow",
    },
  },
  {
    id: "cashier",
    label: "Cashier",
    /** POS + add-only menu/tables. No reports, settings, void, discount, or closing by default. */
    permissions: ["pops.read", "pops.menu.create"],
    navAllowlist: ["pos", "tables", "menu"],
    capabilities: {
      "pops.pos.void": "deny",
      "pops.pos.discount": "deny",
      "pops.closing.report": "deny",
      "pops.kitchen.bump": "deny",
    },
  },
  {
    id: "waiter",
    label: "Waiter",
    permissions: ["pops.read", "pops.kitchen.bump"],
    capabilities: {
      "pops.pos.void": "deny",
      "pops.pos.discount": "deny",
      "pops.closing.report": "deny",
      "pops.kitchen.bump": "pin",
    },
  },
  {
    id: "kitchen",
    label: "Kitchen",
    permissions: ["pops.read", "pops.kitchen.bump"],
    capabilities: {
      "pops.pos.void": "deny",
      "pops.pos.discount": "deny",
      "pops.closing.report": "deny",
      "pops.kitchen.bump": "allow",
    },
  },
  {
    id: "accountant",
    label: "Accountant",
    permissions: ["pops.read", "pops.accounting.manage", "pops.closing.report"],
    capabilities: {
      "pops.pos.void": "deny",
      "pops.pos.discount": "deny",
      "pops.closing.report": "allow",
      "pops.kitchen.bump": "deny",
    },
  },
  {
    id: "hr",
    label: "HR",
    permissions: ["pops.read", "pops.hr.manage"],
    capabilities: Object.fromEntries(CAP_KEYS.map((k) => [k, "deny" as const])) as Record<string, "deny">,
  },
  {
    id: "rider",
    label: "Rider",
    permissions: ["pops.read", "pops.delivery.manage"],
    capabilities: Object.fromEntries(CAP_KEYS.map((k) => [k, "deny" as const])) as Record<string, "deny">,
  },
];

export function permissionsForPopsRole(role: string): string[] {
  const template = POPS_ROLE_TEMPLATES.find((r) => r.id === role);
  return template?.permissions ?? ["pops.read"];
}

/** Default nav allowlist for a role (`null` = all permission-gated pages). */
export function navAllowlistForPopsRole(role: string): string[] | null {
  const template = POPS_ROLE_TEMPLATES.find((r) => r.id === role);
  if (!template || template.navAllowlist === undefined) return null;
  return template.navAllowlist == null ? null : [...template.navAllowlist];
}

export function accessDefaultsForPopsRole(role: string): {
  permissions: string[];
  navAllowlist: string[] | null;
} {
  return {
    permissions: permissionsForPopsRole(role),
    navAllowlist: navAllowlistForPopsRole(role),
  };
}

export function canManageOrgUsers(permissions: readonly string[]): boolean {
  return permissions.includes("*") || permissions.includes("pops.users.manage");
}

/** Full menu/tables mutate (edit + delete), or admin wildcard. */
export function canManageMenuCatalog(permissions: readonly string[]): boolean {
  return permissions.includes("*") || permissions.includes("pops.menu.manage");
}

/** Add menu items / tables (create-only or full manage). */
export function canCreateMenuCatalog(permissions: readonly string[]): boolean {
  return (
    canManageMenuCatalog(permissions) ||
    permissions.includes("pops.menu.create")
  );
}

/** Module toggles for Head Office access control (maps to JWT permission strings). */
export const POPS_MODULE_ACCESS: { id: string; label: string; description: string }[] = [
  { id: "pops.read", label: "ERP access", description: "Sign in and use basic restaurant modules" },
  { id: "pops.users.manage", label: "Users & access", description: "Create and edit other users" },
  {
    id: "pops.menu.create",
    label: "Menu & tables (add only)",
    description: "Add menu items and tables — no edit or delete",
  },
  {
    id: "pops.menu.manage",
    label: "Menu & tables (full)",
    description: "Add, edit, and delete menu items, categories, and tables",
  },
  { id: "pops.inventory.manage", label: "Inventory", description: "Stock, purchases, and adjustments" },
  { id: "pops.accounting.manage", label: "Accounting", description: "Ledgers, expenses, and finance reports" },
  { id: "pops.hr.manage", label: "HR & payroll", description: "Employees, attendance, and payroll" },
  { id: "pops.multi_branch.manage", label: "Multi-branch", description: "Network monitoring, transfers, pricing" },
  { id: "pops.notifications.manage", label: "Notifications", description: "Templates and notification settings" },
  { id: "pops.closing.report", label: "Day closing", description: "Z-report and business day close" },
  { id: "pops.pos.void", label: "POS void", description: "Void lines on the register" },
  { id: "pops.pos.discount", label: "POS discount", description: "Apply discounts on the register" },
  { id: "pops.kitchen.bump", label: "Kitchen / waiter", description: "KOT bump and floor service tools" },
  { id: "pops.delivery.manage", label: "Delivery", description: "Riders and delivery orders" },
  { id: "pharmacy.view", label: "Pharmacy view", description: "View pharmacy dashboards and catalogs" },
  { id: "pharmacy.pos", label: "Pharmacy POS", description: "Operate the pharmacy register" },
  { id: "pharmacy.sale.create", label: "Pharmacy sales", description: "Create retail pharmacy sales" },
  { id: "pharmacy.sale.return", label: "Pharmacy sale returns", description: "Process customer medicine returns" },
  { id: "pharmacy.purchase.view", label: "Pharmacy purchase view", description: "View purchase orders and GRNs" },
  { id: "pharmacy.purchase.manage", label: "Pharmacy purchase manage", description: "Create and approve POs and GRNs" },
  { id: "purchase.view", label: "Purchase view", description: "View Dist purchase dashboard, POs, GRNs, and invoices" },
  { id: "purchase.requisition", label: "Purchase requisitions", description: "Create and submit purchase requisitions" },
  { id: "purchase.requisition.approve", label: "Approve requisitions", description: "Approve or reject purchase requisitions" },
  { id: "purchase.order", label: "Purchase orders", description: "Create, send, and confirm purchase orders" },
  { id: "purchase.order.approve", label: "Approve purchase orders", description: "Approve submitted purchase orders" },
  { id: "purchase.grn", label: "Goods receipts", description: "Create and view GRNs" },
  { id: "purchase.grn.post", label: "Post GRNs", description: "Post goods receipts into stock" },
  { id: "purchase.invoice", label: "Purchase invoices", description: "Create and post purchase invoices / match" },
  { id: "purchase.return", label: "Purchase returns", description: "Create purchase returns to suppliers" },
  { id: "purchase.supplier", label: "Purchase suppliers", description: "Search suppliers and view performance" },
  { id: "purchase.reports", label: "Purchase reports", description: "Purchase dashboard and supplier performance" },
  { id: "pharmacy.inventory.view", label: "Pharmacy inventory view", description: "View stock and warehouses" },
  { id: "pharmacy.inventory.manage", label: "Pharmacy inventory manage", description: "Adjust stock and warehouses" },
  { id: "pharmacy.batch.manage", label: "Pharmacy batches", description: "Manage medicine batches and expiry" },
  { id: "pharmacy.prescription.view", label: "Prescriptions view", description: "View prescriptions" },
  { id: "pharmacy.prescription.manage", label: "Prescriptions manage", description: "Create, verify, and dispense prescriptions" },
  { id: "pharmacy.controlled.approve", label: "Controlled drugs", description: "Approve controlled substance sales" },
  { id: "pharmacy.khata.view", label: "Khata view", description: "View patient credit statements" },
  { id: "pharmacy.khata.manage", label: "Khata manage", description: "Record khata payments and adjustments" },
  { id: "pharmacy.report.view", label: "Pharmacy reports", description: "View pharmacy financial and stock reports" },
  { id: "distribution.orders", label: "Distribution orders", description: "Create and approve wholesale/distribution orders" },
  { id: "distribution.deliveries", label: "Distribution deliveries", description: "Manage delivery and POD" },
  { id: "distribution.collections", label: "Distribution collections", description: "Record trade customer collections" },
  { id: "distribution.field", label: "Field force", description: "Assignments, visits, and sales targets" },
  { id: "distribution.pricing", label: "Distribution pricing", description: "Price lists and schemes" },
  { id: "distribution.masters", label: "Distribution masters", description: "Companies, geo, trade customers, sales force" },
  // Phase 7 delivery / collections / recovery — OR with distribution.deliveries|collections
  { id: "delivery.view", label: "Delivery view", description: "View Dist delivery dashboard and tickets" },
  { id: "delivery.manage", label: "Delivery manage", description: "Create deliveries and manage drivers/vehicles" },
  { id: "delivery.dispatch", label: "Delivery dispatch", description: "Assign drivers and dispatch deliveries" },
  { id: "delivery.pod", label: "Delivery POD", description: "Complete proof of delivery outcomes" },
  { id: "collection.view", label: "Collection view", description: "View collections, aging, and collection dashboard" },
  { id: "collection.create", label: "Collection create", description: "Post trade customer collections" },
  { id: "collection.allocate", label: "Collection allocate", description: "Allocate advances and update cheque status" },
  { id: "recovery.view", label: "Recovery view", description: "View recovery work queue and promises" },
  { id: "recovery.action", label: "Recovery action", description: "Create promises and act on recovery items" },
  // Phase 4 inventory control. These extend the existing RBAC catalogue; the
  // older pharmacy.inventory.* / pops.inventory.manage ids still grant access.
  { id: "inventory.view", label: "Inventory view", description: "View stock, batches, expiry, and the stock ledger" },
  { id: "inventory.manage", label: "Inventory manage", description: "Hold and release batches, edit inventory records" },
  { id: "inventory.transfer", label: "Stock transfers", description: "Create, dispatch, and receive stock transfers" },
  { id: "inventory.transfer.approve", label: "Approve transfers", description: "Approve submitted stock transfers" },
  { id: "inventory.adjust", label: "Stock adjustments", description: "Raise stock adjustments, damage, and write-offs" },
  { id: "inventory.adjust.approve", label: "Approve adjustments", description: "Approve and post stock adjustments" },
  { id: "inventory.count", label: "Stock counts", description: "Run physical and cycle counts" },
  { id: "inventory.count.post", label: "Post stock counts", description: "Post counted variances to stock" },
  { id: "inventory.valuation", label: "Inventory valuation", description: "View stock valuation and costing reports" },
  { id: "inventory.settings", label: "Inventory settings", description: "Change negative stock, expiry, and reorder policy" },
  // Phase 5 Dist Sale Window — OR with distribution.orders for backwards compatibility
  { id: "sales.view", label: "Sales view", description: "View distribution Sale Window and held drafts" },
  { id: "sales.create", label: "Sales create", description: "Build carts and create draft distribution orders" },
  { id: "sales.book", label: "Sales book", description: "Book / submit distribution Sale Window orders" },
  { id: "sales.hold", label: "Sales hold", description: "Hold Sale Window carts as server drafts" },
  { id: "sales.resume", label: "Sales resume", description: "Resume held Sale Window drafts" },
  { id: "sales.print", label: "Sales print", description: "Print booking slips and invoices from Sale Window" },
  { id: "sales.price_override", label: "Sales price override", description: "Override unit prices on Sale Window lines" },
  { id: "sales.credit_override", label: "Sales credit override", description: "Override credit limit blocks with a reason" },
  { id: "sales.fefo_override", label: "Sales FEFO override", description: "Override FEFO batch allocations" },
  { id: "sales.batch_override", label: "Sales batch override", description: "Manually pick batches on Sale Window lines" },
  { id: "sales.discount_override", label: "Sales discount override", description: "Apply line/document discounts beyond defaults" },
  { id: "sales.scheme_override", label: "Sales scheme override", description: "Override scheme free quantities" },
  { id: "sales.view_customer_credit", label: "Sales view customer credit", description: "View credit limit and outstanding on Sale Window" },
  { id: "sales.view_margin", label: "Sales view margin", description: "View margin / cost on Sale Window lines" },
  // Phase 7 delivery / collections / recovery — OR with distribution.deliveries|collections
  { id: "delivery.view", label: "Delivery view", description: "View delivery dashboard, tickets, and POD status" },
  { id: "delivery.manage", label: "Delivery manage", description: "Create deliveries and assign drivers/routes" },
  { id: "delivery.dispatch", label: "Delivery dispatch", description: "Dispatch deliveries to drivers" },
  { id: "delivery.pod", label: "Proof of delivery", description: "Complete POD, partial, failed, or refused" },
  { id: "collection.view", label: "Collection view", description: "View collections, aging, and recovery queue" },
  { id: "collection.create", label: "Collection create", description: "Record customer collections" },
  { id: "collection.allocate", label: "Collection allocate", description: "Allocate collections across invoices" },
  { id: "recovery.view", label: "Recovery view", description: "View recovery work queue" },
  { id: "recovery.action", label: "Recovery action", description: "Record recovery follow-ups and promises to pay" },
];

export function hasModuleAccess(permissions: readonly string[], moduleId: string): boolean {
  if (permissions.includes("*")) return true;
  return permissions.includes(moduleId);
}

export function toggleModulePermission(
  permissions: readonly string[],
  moduleId: string,
  enabled: boolean,
): string[] {
  const next = new Set(permissions.filter((p) => p !== "*"));
  if (enabled) next.add(moduleId);
  else next.delete(moduleId);
  if (!next.has("pops.read") && enabled) next.add("pops.read");
  return [...next];
}

