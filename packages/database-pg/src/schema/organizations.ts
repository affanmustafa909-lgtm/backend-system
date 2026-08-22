import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * A business / client installation.
 * `systemType` permanently binds the tenant to one business system module.
 */
export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  /** restaurant | pharmacy | general_store | grocery | retail | … */
  systemType: text("system_type").notNull().default("restaurant"),
  /** active | inactive | suspended | deleted */
  status: text("status").notNull().default("active"),
  licenceKey: text("licence_key"),
  /** trial_5 | monthly_30 | standard | demo | custom… */
  licencePlan: text("licence_plan"),
  licenceExpiresAt: timestamp("licence_expires_at", { withTimezone: true }),
  /**
   * Super Admin module ceiling for this business (POPS_MODULE_ACCESS ids).
   * null = all modules allowed; [] = lock down to basic ERP only.
   */
  enabledModules: jsonb("enabled_modules").$type<string[] | null>(),
  /** Super Admin: show FBR section to this business (Admin controls Active). */
  fbrAllowed: boolean("fbr_allowed").notNull().default(false),
  /** Super Admin: show FPRA section (Admin controls Active). */
  praFakeAllowed: boolean("pra_fake_allowed").notNull().default(false),
  /** Super Admin: show Real PRA section (Admin controls Active). */
  praRealAllowed: boolean("pra_real_allowed").notNull().default(false),
  /** Org Admin Active: FBR integration on/off. */
  fbrEnabled: boolean("fbr_enabled").notNull().default(false),
  /**
   * Legacy “any PRA” Active flag. Kept in sync as (praFakeEnabled || praRealEnabled).
   */
  praEnabled: boolean("pra_enabled").notNull().default(false),
  /** Org Admin Active: FPRA (local fiscal slip + QR). */
  praFakeEnabled: boolean("pra_fake_enabled").notNull().default(false),
  /** Org Admin Active: Real PRA (e-IMS / live submit). */
  praRealEnabled: boolean("pra_real_enabled").notNull().default(false),
  /** Monotonic FPRA invoice sequence (used to build real-looking alphanumeric Invoice #). */
  praFakeInvoiceSeq: integer("pra_fake_invoice_seq").notNull().default(0),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
