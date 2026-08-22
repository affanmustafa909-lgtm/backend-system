import { boolean, date, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { popsBranches } from "./operations";
import { users } from "./users";

export const pharmacyMedicines = pgTable("pharmacy_medicines", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  genericName: text("generic_name"),
  dosageStrength: text("dosage_strength"),
  presentation: text("presentation"),
  brandName: text("brand_name"),
  category: text("category").notNull().default("Tablet"),
  manufacturer: text("manufacturer"),
  barcode: text("barcode"),
  purchasePricePkr: integer("purchase_price_pkr").notNull().default(0),
  sellingPricePkr: integer("selling_price_pkr").notNull().default(0),
  taxPct: integer("tax_pct").notNull().default(0),
  reorderLevel: integer("reorder_level").notNull().default(10),
  suggestedReorderQty: integer("suggested_reorder_qty").notNull().default(0),
  currentStock: integer("current_stock").notNull().default(0),
  unit: text("unit").notNull().default("Piece"),
  rackLocation: text("rack_location"),
  shelfLocation: text("shelf_location"),
  aisleLocation: text("aisle_location"),
  /** Stock is tracked in tablets (base unit) when pack fields are set. */
  tabletsPerStrip: integer("tablets_per_strip").notNull().default(1),
  stripsPerBox: integer("strips_per_box").notNull().default(1),
  /** sellingPricePkr is the price per strip when tabletsPerStrip > 1, else per piece. */
  isControlled: boolean("is_controlled").notNull().default(false),
  warningsJson: text("warnings_json"),
  instructionsJson: text("instructions_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyMedicineBatches = pgTable("pharmacy_medicine_batches", {
  id: uuid("id").defaultRandom().primaryKey(),
  medicineId: uuid("medicine_id")
    .notNull()
    .references(() => pharmacyMedicines.id, { onDelete: "cascade" }),
  batchNumber: text("batch_number").notNull(),
  manufacturingDate: date("manufacturing_date"),
  expiryDate: date("expiry_date").notNull(),
  quantity: integer("quantity").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyPatients = pgTable("pharmacy_patients", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  dateOfBirth: date("date_of_birth"),
  allergiesJson: text("allergies_json"),
  medicalConditionsJson: text("medical_conditions_json"),
  chronicDiseasesJson: text("chronic_diseases_json"),
  loyaltyPoints: integer("loyalty_points").notNull().default(0),
  outstandingPkr: integer("outstanding_pkr").notNull().default(0),
  creditLimitPkr: integer("credit_limit_pkr").notNull().default(0),
  creditDueDate: date("credit_due_date"),
  refillReminderEnabled: boolean("refill_reminder_enabled").notNull().default(false),
  refillReminderChannel: text("refill_reminder_channel"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyDoctors = pgTable("pharmacy_doctors", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  specialization: text("specialization"),
  clinic: text("clinic"),
  phone: text("phone"),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyPrescriptions = pgTable("pharmacy_prescriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  prescriptionNumber: text("prescription_number").notNull(),
  patientId: uuid("patient_id").references(() => pharmacyPatients.id, { onDelete: "set null" }),
  doctorId: uuid("doctor_id").references(() => pharmacyDoctors.id, { onDelete: "set null" }),
  status: text("status").notNull().default("Pending"),
  notes: text("notes"),
  attachmentJson: text("attachment_json"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  dispensedAt: timestamp("dispensed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyPrescriptionItems = pgTable("pharmacy_prescription_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  prescriptionId: uuid("prescription_id")
    .notNull()
    .references(() => pharmacyPrescriptions.id, { onDelete: "cascade" }),
  medicineId: uuid("medicine_id")
    .notNull()
    .references(() => pharmacyMedicines.id, { onDelete: "restrict" }),
  dosage: text("dosage"),
  quantity: integer("quantity").notNull(),
  dispensedQty: integer("dispensed_qty").notNull().default(0),
});

export const pharmacySales = pgTable("pharmacy_sales", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  invoiceNumber: text("invoice_number").notNull(),
  patientId: uuid("patient_id").references(() => pharmacyPatients.id, { onDelete: "set null" }),
  prescriptionId: uuid("prescription_id").references(() => pharmacyPrescriptions.id, { onDelete: "set null" }),
  shiftId: uuid("shift_id"),
  cashierUserId: uuid("cashier_user_id").references(() => users.id, { onDelete: "set null" }),
  paymentMethod: text("payment_method").notNull().default("Cash"),
  paymentsJson: text("payments_json"),
  amountPaidPkr: integer("amount_paid_pkr").notNull().default(0),
  amountDuePkr: integer("amount_due_pkr").notNull().default(0),
  subtotalPkr: integer("subtotal_pkr").notNull().default(0),
  taxPkr: integer("tax_pkr").notNull().default(0),
  discountPkr: integer("discount_pkr").notNull().default(0),
  totalPkr: integer("total_pkr").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacySaleLines = pgTable("pharmacy_sale_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  saleId: uuid("sale_id")
    .notNull()
    .references(() => pharmacySales.id, { onDelete: "cascade" }),
  medicineId: uuid("medicine_id")
    .notNull()
    .references(() => pharmacyMedicines.id, { onDelete: "restrict" }),
  batchId: uuid("batch_id").references(() => pharmacyMedicineBatches.id, { onDelete: "set null" }),
  saleUnit: text("sale_unit"),
  qty: integer("qty").notNull(),
  tabletsQty: integer("tablets_qty").notNull().default(0),
  unitPricePkr: integer("unit_price_pkr").notNull(),
  lineTotalPkr: integer("line_total_pkr").notNull(),
});

export const pharmacyKhataEntries = pgTable("pharmacy_khata_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => pharmacyPatients.id, { onDelete: "cascade" }),
  saleId: uuid("sale_id").references(() => pharmacySales.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  amountPkr: integer("amount_pkr").notNull(),
  balanceAfterPkr: integer("balance_after_pkr").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyControlledDrugLogs = pgTable("pharmacy_controlled_drug_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  medicineId: uuid("medicine_id")
    .notNull()
    .references(() => pharmacyMedicines.id, { onDelete: "restrict" }),
  saleId: uuid("sale_id").references(() => pharmacySales.id, { onDelete: "set null" }),
  patientId: uuid("patient_id").references(() => pharmacyPatients.id, { onDelete: "set null" }),
  prescriptionId: uuid("prescription_id").references(() => pharmacyPrescriptions.id, { onDelete: "set null" }),
  qty: integer("qty").notNull(),
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  buyerInfoJson: text("buyer_info_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pharmacyShifts = pgTable("pharmacy_shifts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  cashierUserId: uuid("cashier_user_id").references(() => users.id, { onDelete: "set null" }),
  cashierName: text("cashier_name").notNull(),
  openingCashPkr: integer("opening_cash_pkr").notNull().default(0),
  closingCashPkr: integer("closing_cash_pkr"),
  expectedCashPkr: integer("expected_cash_pkr"),
  cashDifferencePkr: integer("cash_difference_pkr"),
  totalSalesPkr: integer("total_sales_pkr").notNull().default(0),
  transactionCount: integer("transaction_count").notNull().default(0),
  status: text("status").notNull().default("open"),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

export const pharmacyRefillReminders = pgTable("pharmacy_refill_reminders", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => popsBranches.id, { onDelete: "cascade" }),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => pharmacyPatients.id, { onDelete: "cascade" }),
  medicineId: uuid("medicine_id")
    .notNull()
    .references(() => pharmacyMedicines.id, { onDelete: "cascade" }),
  lastSaleId: uuid("last_sale_id").references(() => pharmacySales.id, { onDelete: "set null" }),
  refillDueDate: date("refill_due_date").notNull(),
  channel: text("channel").notNull().default("sms"),
  status: text("status").notNull().default("pending"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
