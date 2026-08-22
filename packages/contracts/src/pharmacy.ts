import { z } from "zod";

export const PHARMACY_ROLES = [
  "admin",
  "pharmacist",
  "cashier",
  "inventory_manager",
  "manager",
] as const;
export const pharmacyRoleSchema = z.enum(PHARMACY_ROLES);

export const MEDICINE_CATEGORIES = [
  "Tablet",
  "Capsule",
  "Syrup",
  "Injection",
  "Cream",
  "Drops",
  "Inhaler",
  "Other",
] as const;
export const medicineCategorySchema = z.enum(MEDICINE_CATEGORIES);

export const PRESCRIPTION_STATUSES = ["Pending", "Verified", "Dispensed", "Cancelled"] as const;
export const prescriptionStatusSchema = z.enum(PRESCRIPTION_STATUSES);

export const PHARMACY_PAYMENT_METHODS = [
  "Cash",
  "Card",
  "EasyPaisa",
  "JazzCash",
  "Bank Transfer",
  "Mixed",
  "Khata",
] as const;
export const pharmacyPaymentMethodSchema = z.enum(PHARMACY_PAYMENT_METHODS);

export const REFILL_CHANNELS = ["sms", "email", "whatsapp"] as const;
export const refillChannelSchema = z.enum(REFILL_CHANNELS);

export const MEDICINE_WARNINGS = [
  "Take after meals",
  "Take before meals",
  "Do not drive after consumption",
  "Avoid alcohol",
  "High dosage warning",
  "Drug interaction alert",
  "Allergy alert",
  "Not for pregnant women",
  "May cause drowsiness",
] as const;

export const CHRONIC_DISEASES = [
  "Diabetes",
  "Hypertension",
  "Asthma",
  "Heart Disease",
  "Kidney Disease",
  "Liver Disease",
  "Thyroid Disorder",
  "Arthritis",
  "Epilepsy",
] as const;

export const PHARMACY_SALE_UNITS = ["tablet", "strip", "box", "piece"] as const;
export const pharmacySaleUnitSchema = z.enum(PHARMACY_SALE_UNITS);
export type PharmacySaleUnit = (typeof PHARMACY_SALE_UNITS)[number];
export type PharmacyPaymentMethod = z.infer<typeof pharmacyPaymentMethodSchema>;
export type PharmacyPaymentLine = z.infer<typeof pharmacyPaymentLineSchema>;

export const pharmacyPaymentLineSchema = z.object({
  method: pharmacyPaymentMethodSchema,
  amount: z.number().min(0),
});

export const medicineSchema = z.object({
  id: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  genericName: z.string().nullable(),
  dosageStrength: z.string().nullable(),
  presentation: z.string().nullable(),
  brandName: z.string().nullable(),
  category: z.string(),
  manufacturer: z.string().nullable(),
  barcode: z.string().nullable(),
  purchasePrice: z.number(),
  sellingPrice: z.number(),
  taxPct: z.number(),
  reorderLevel: z.number(),
  suggestedReorderQty: z.number(),
  currentStock: z.number(),
  unit: z.string(),
  rackLocation: z.string().nullable(),
  shelfLocation: z.string().nullable(),
  aisleLocation: z.string().nullable(),
  tabletsPerStrip: z.number(),
  stripsPerBox: z.number(),
  isControlled: z.boolean(),
  warnings: z.array(z.string()),
  instructions: z.array(z.string()),
  nearestExpiry: z.string().nullable(),
});

export const medicineAlternativeSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  brandName: z.string().nullable(),
  genericName: z.string().nullable(),
  dosageStrength: z.string().nullable(),
  currentStock: z.number(),
  sellingPrice: z.number(),
});

export const medicineBatchSchema = z.object({
  id: z.string().uuid(),
  medicineId: z.string().uuid(),
  medicineName: z.string(),
  batchNumber: z.string(),
  manufacturingDate: z.string().nullable(),
  expiryDate: z.string(),
  quantity: z.number(),
});

export const pharmacyPatientSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  allergies: z.array(z.string()),
  medicalConditions: z.array(z.string()),
  chronicDiseases: z.array(z.string()),
  loyaltyPoints: z.number(),
  outstandingPkr: z.number(),
  creditLimitPkr: z.number(),
  creditDueDate: z.string().nullable(),
  refillReminderEnabled: z.boolean(),
  refillReminderChannel: refillChannelSchema.nullable(),
  totalPurchases: z.number(),
});

export const pharmacyKhataEntrySchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["sale", "payment", "adjustment"]),
  amountPkr: z.number(),
  balanceAfterPkr: z.number(),
  notes: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  createdAt: z.string(),
});

export const pharmacyKhataStatementSchema = z.object({
  patientId: z.string().uuid(),
  patientName: z.string(),
  outstandingPkr: z.number(),
  creditLimitPkr: z.number(),
  creditDueDate: z.string().nullable(),
  entries: z.array(pharmacyKhataEntrySchema),
});

export const pharmacyDoctorSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  specialization: z.string().nullable(),
  clinic: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  prescriptionCount: z.number(),
});

export const prescriptionItemSchema = z.object({
  id: z.string().uuid(),
  medicineId: z.string().uuid(),
  medicineName: z.string(),
  dosage: z.string().nullable(),
  quantity: z.number(),
  dispensedQty: z.number(),
});

export const prescriptionSchema = z.object({
  id: z.string().uuid(),
  prescriptionNumber: z.string(),
  patientId: z.string().uuid().nullable(),
  patientName: z.string().nullable(),
  doctorId: z.string().uuid().nullable(),
  doctorName: z.string().nullable(),
  status: prescriptionStatusSchema,
  notes: z.string().nullable(),
  attachmentName: z.string().nullable(),
  hasAttachment: z.boolean(),
  items: z.array(prescriptionItemSchema),
  createdAt: z.string(),
  verifiedAt: z.string().nullable(),
  dispensedAt: z.string().nullable(),
});

export const pharmacySaleLineSchema = z.object({
  id: z.string().uuid(),
  medicineId: z.string().uuid(),
  medicineName: z.string(),
  batchId: z.string().uuid().nullable(),
  batchNumber: z.string().nullable(),
  saleUnit: pharmacySaleUnitSchema.nullable(),
  qty: z.number(),
  tabletsQty: z.number(),
  unitPrice: z.number(),
  lineTotal: z.number(),
});

export const pharmacySaleSchema = z.object({
  id: z.string().uuid(),
  invoiceNumber: z.string(),
  patientId: z.string().uuid().nullable(),
  patientName: z.string().nullable(),
  paymentMethod: pharmacyPaymentMethodSchema,
  payments: z.array(pharmacyPaymentLineSchema),
  amountPaid: z.number(),
  amountDue: z.number(),
  subtotal: z.number(),
  tax: z.number(),
  discount: z.number(),
  total: z.number(),
  lines: z.array(pharmacySaleLineSchema),
  createdAt: z.string(),
});

export const pharmacyShiftSchema = z.object({
  id: z.string().uuid(),
  cashierName: z.string(),
  openingCashPkr: z.number(),
  closingCashPkr: z.number().nullable(),
  expectedCashPkr: z.number().nullable(),
  cashDifferencePkr: z.number().nullable(),
  totalSalesPkr: z.number(),
  transactionCount: z.number(),
  status: z.enum(["open", "closed"]),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
});

export const pharmacyControlledDrugLogSchema = z.object({
  id: z.string().uuid(),
  medicineName: z.string(),
  patientName: z.string().nullable(),
  prescriptionNumber: z.string().nullable(),
  qty: z.number(),
  approvedByName: z.string().nullable(),
  createdAt: z.string(),
});

export const pharmacyRefillReminderSchema = z.object({
  id: z.string().uuid(),
  patientName: z.string(),
  medicineName: z.string(),
  refillDueDate: z.string(),
  channel: refillChannelSchema,
  status: z.enum(["pending", "sent", "skipped"]),
  sentAt: z.string().nullable(),
});

export const pharmacyAlertSchema = z.object({
  type: z.enum([
    "low_stock",
    "out_of_stock",
    "expiry",
    "near_expiry",
    "expiry_3mo",
    "expiry_2mo",
    "expiry_1mo",
    "payment_due",
    "reorder",
  ]),
  severity: z.enum(["info", "warning", "danger"]),
  message: z.string(),
  medicineId: z.string().uuid().optional(),
});

export const pharmacyDashboardSchema = z.object({
  totalSalesToday: z.number(),
  totalPurchasesMonth: z.number(),
  availableStock: z.number(),
  lowStockCount: z.number(),
  expiringCount: z.number(),
  revenueMonth: z.number(),
  profitMonth: z.number(),
  pendingOrders: z.number(),
  customerCount: z.number(),
  transactionCountToday: z.number(),
  dailySales: z.array(z.object({ date: z.string(), amount: z.number() })),
  monthlyRevenue: z.array(z.object({ month: z.string(), amount: z.number() })),
  topMedicines: z.array(z.object({ name: z.string(), qty: z.number(), revenue: z.number() })),
  purchaseTrends: z.array(z.object({ month: z.string(), amount: z.number() })),
  stockHealth: z.array(z.object({ label: z.string(), value: z.number() })),
  prescriptionBreakdown: z.array(z.object({ label: z.string(), value: z.number() })),
  paymentBreakdown: z.array(z.object({ label: z.string(), value: z.number() })),
  categoryStock: z.array(z.object({ label: z.string(), value: z.number() })),
  alerts: z.array(pharmacyAlertSchema),
});

export const createMedicineSchema = z.object({
  branchCode: z.string().min(1),
  sku: z.string().min(1),
  name: z.string().min(1),
  genericName: z.string().optional(),
  dosageStrength: z.string().optional(),
  presentation: z.string().optional(),
  brandName: z.string().optional(),
  category: medicineCategorySchema.default("Tablet"),
  manufacturer: z.string().optional(),
  barcode: z.string().optional(),
  purchasePrice: z.number().min(0).default(0),
  sellingPrice: z.number().min(0).default(0),
  taxPct: z.number().min(0).max(100).default(0),
  reorderLevel: z.number().min(0).default(10),
  suggestedReorderQty: z.number().min(0).default(0),
  currentStock: z.number().min(0).default(0),
  unit: z.string().default("Piece"),
  aisleLocation: z.string().optional(),
  tabletsPerStrip: z.number().min(1).default(1),
  stripsPerBox: z.number().min(1).default(1),
  rackLocation: z.string().optional(),
  shelfLocation: z.string().optional(),
  isControlled: z.boolean().default(false),
  warnings: z.array(z.string()).optional(),
  instructions: z.array(z.string()).optional(),
  batchNumber: z.string().optional(),
  expiryDate: z.string().optional(),
});

export const updateMedicineSchema = createMedicineSchema.omit({ branchCode: true }).partial();

export const medicineMatchSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  genericName: z.string().nullable(),
  brandName: z.string().nullable(),
  currentStock: z.number(),
  matchScore: z.number(),
});

export const pharmacyPatientHistorySaleSchema = z.object({
  saleId: z.string().uuid(),
  invoiceNumber: z.string(),
  total: z.number(),
  createdAt: z.string(),
  medicines: z.array(z.string()),
});

export const pharmacyPatientHistorySchema = z.object({
  patient: pharmacyPatientSchema,
  sales: z.array(pharmacyPatientHistorySaleSchema),
});

export const createPatientSchema = z.object({
  branchCode: z.string().min(1),
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  dateOfBirth: z.string().optional(),
  allergies: z.array(z.string()).optional(),
  medicalConditions: z.array(z.string()).optional(),
  chronicDiseases: z.array(z.string()).optional(),
  creditLimitPkr: z.number().min(0).optional(),
  creditDueDate: z.string().optional(),
  refillReminderEnabled: z.boolean().optional(),
  refillReminderChannel: refillChannelSchema.optional(),
});

export const updatePatientSchema = createPatientSchema.omit({ branchCode: true }).partial();

export const recordKhataPaymentSchema = z.object({
  branchCode: z.string().min(1),
  amountPkr: z.number().min(1),
  notes: z.string().optional(),
});

export const createDoctorSchema = z.object({
  branchCode: z.string().min(1),
  name: z.string().min(1),
  specialization: z.string().optional(),
  clinic: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
});

export const createPrescriptionSchema = z.object({
  branchCode: z.string().min(1),
  patientId: z.string().uuid().optional(),
  doctorId: z.string().uuid().optional(),
  notes: z.string().optional(),
  attachmentName: z.string().optional(),
  attachmentDataUrl: z.string().optional(),
  items: z.array(
    z.object({
      medicineId: z.string().uuid(),
      dosage: z.string().optional(),
      quantity: z.number().min(1),
    }),
  ).min(1),
});

export const createPharmacySaleSchema = z.object({
  branchCode: z.string().min(1),
  patientId: z.string().uuid().optional(),
  prescriptionId: z.string().uuid().optional(),
  shiftId: z.string().uuid().optional(),
  paymentMethod: pharmacyPaymentMethodSchema,
  payments: z.array(pharmacyPaymentLineSchema).optional(),
  discount: z.number().min(0).default(0),
  controlledApproved: z.boolean().optional(),
  lines: z.array(
    z.object({
      medicineId: z.string().uuid(),
      qty: z.number().min(1),
      batchId: z.string().uuid().optional(),
      saleUnit: pharmacySaleUnitSchema.optional(),
    }),
  ).min(1),
});

export const pharmacyReorderSuggestionSchema = z.object({
  medicineId: z.string().uuid(),
  medicineName: z.string(),
  currentStock: z.number(),
  reorderLevel: z.number(),
  suggestedReorderQty: z.number(),
  location: z.string().nullable(),
});

export const openPharmacyShiftSchema = z.object({
  branchCode: z.string().min(1),
  cashierName: z.string().min(1),
  openingCashPkr: z.number().min(0).default(0),
});

export const closePharmacyShiftSchema = z.object({
  closingCashPkr: z.number().min(0),
});

export type PharmacyReorderSuggestion = z.infer<typeof pharmacyReorderSuggestionSchema>;
export type Medicine = z.infer<typeof medicineSchema>;
export type MedicineAlternative = z.infer<typeof medicineAlternativeSchema>;
export type MedicineBatch = z.infer<typeof medicineBatchSchema>;
export type PharmacyPatient = z.infer<typeof pharmacyPatientSchema>;
export type PharmacyKhataEntry = z.infer<typeof pharmacyKhataEntrySchema>;
export type PharmacyDoctor = z.infer<typeof pharmacyDoctorSchema>;
export type Prescription = z.infer<typeof prescriptionSchema>;
export type PharmacySale = z.infer<typeof pharmacySaleSchema>;
export type PharmacyShift = z.infer<typeof pharmacyShiftSchema>;
export type PharmacyControlledDrugLog = z.infer<typeof pharmacyControlledDrugLogSchema>;
export type PharmacyRefillReminder = z.infer<typeof pharmacyRefillReminderSchema>;
export type PharmacyDashboard = z.infer<typeof pharmacyDashboardSchema>;
export type CreateMedicine = z.infer<typeof createMedicineSchema>;
export type UpdateMedicine = z.infer<typeof updateMedicineSchema>;
export type MedicineMatch = z.infer<typeof medicineMatchSchema>;
export type PharmacyPatientHistory = z.infer<typeof pharmacyPatientHistorySchema>;
export type CreatePatient = z.infer<typeof createPatientSchema>;
export type UpdatePatient = z.infer<typeof updatePatientSchema>;
export type CreateDoctor = z.infer<typeof createDoctorSchema>;
export type CreatePrescription = z.infer<typeof createPrescriptionSchema>;
export type CreatePharmacySale = z.infer<typeof createPharmacySaleSchema>;
export type OpenPharmacyShift = z.infer<typeof openPharmacyShiftSchema>;
export type ClosePharmacyShift = z.infer<typeof closePharmacyShiftSchema>;
export type RecordKhataPayment = z.infer<typeof recordKhataPaymentSchema>;

export const pharmacyPurchaseLineSchema = z.object({
  poNumber: z.string(),
  supplierName: z.string(),
  status: z.string(),
  totalAmount: z.number(),
  createdAt: z.string(),
});

export const pharmacySupplierPaymentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  paymentTerms: z.string().nullable(),
  totalPurchases: z.number(),
  openingBalancePkr: z.number(),
  amountDue: z.number(),
  lastOrder: z.string().nullable(),
});

export const pharmacySalesStatementSchema = z.object({
  invoiceNumber: z.string(),
  patientName: z.string().nullable(),
  paymentMethod: z.string(),
  total: z.number(),
  createdAt: z.string(),
});

export const pharmacyProfitLossLineSchema = z.object({
  label: z.string(),
  amount: z.number(),
  type: z.enum(["income", "expense", "total"]),
});

export const pharmacyProfitLossTopProductSchema = z.object({
  medicineName: z.string(),
  qtySold: z.number(),
  revenue: z.number(),
  cost: z.number(),
  profit: z.number(),
});

export const pharmacyProfitLossSchema = z.object({
  periodLabel: z.string(),
  from: z.string(),
  to: z.string(),
  revenue: z.number(),
  costOfGoods: z.number(),
  grossProfit: z.number(),
  expenses: z.number(),
  netProfit: z.number(),
  marginPct: z.number(),
  transactionCount: z.number(),
  itemsSold: z.number(),
  taxCollected: z.number(),
  discountsGiven: z.number(),
  purchasesInPeriod: z.number(),
  statement: z.array(pharmacyProfitLossLineSchema),
  topProducts: z.array(pharmacyProfitLossTopProductSchema),
});

export const pharmacySalesOfMonthSchema = z.object({
  month: z.string(),
  from: z.string(),
  to: z.string(),
  totalSales: z.number(),
  transactionCount: z.number(),
  averageSale: z.number(),
  dailyBreakdown: z.array(
    z.object({
      date: z.string(),
      label: z.string(),
      amount: z.number(),
      count: z.number(),
    }),
  ),
  transactions: z.array(pharmacySalesStatementSchema),
});

export const pharmacyExpiredProductSchema = z.object({
  id: z.string().uuid(),
  medicineName: z.string(),
  sku: z.string(),
  presentation: z.string().nullable(),
  category: z.string(),
  batchNumber: z.string(),
  expiryDate: z.string(),
  quantity: z.number(),
  daysOverdue: z.number(),
  daysUntilExpiry: z.number(),
  status: z.enum(["expired", "expiring_soon"]),
  estimatedLossPkr: z.number(),
});

export const pharmacyExpiredProductsReportSchema = z.object({
  periodLabel: z.string(),
  from: z.string(),
  to: z.string(),
  totalBatches: z.number(),
  totalUnits: z.number(),
  expiredCount: z.number(),
  expiringSoonCount: z.number(),
  estimatedLossPkr: z.number(),
  products: z.array(pharmacyExpiredProductSchema),
});

export const pharmacyTaxComplianceSchema = z.object({
  periodLabel: z.string(),
  from: z.string(),
  to: z.string(),
  totalSales: z.number(),
  taxableSales: z.number(),
  taxCollected: z.number(),
  taxExemptSales: z.number(),
  invoiceCount: z.number(),
  fbrCompliant: z.boolean(),
  summary: z.array(
    z.object({
      label: z.string(),
      amount: z.number(),
    }),
  ),
});
