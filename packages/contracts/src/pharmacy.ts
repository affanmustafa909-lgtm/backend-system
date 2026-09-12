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

export const PRESCRIPTION_STATUSES = [
  "Pending",
  "Verified",
  "Partially Dispensed",
  "Dispensed",
  "Cancelled",
] as const;
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
  alternateBarcode: z.string().nullable().optional(),
  purchasePrice: z.number(),
  sellingPrice: z.number(),
  costPrice: z.number().optional(),
  wholesalePrice: z.number().optional(),
  dealerPrice: z.number().optional(),
  minSalePrice: z.number().optional(),
  maxRetailPrice: z.number().optional(),
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
  prescriptionRequired: z.boolean().optional(),
  companyId: z.string().uuid().nullable().optional(),
  status: z.string().optional(),
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
  code: z.string().nullable().optional(),
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
  code: z.string().nullable().optional(),
  name: z.string(),
  specialization: z.string().nullable(),
  registrationNumber: z.string().nullable().optional(),
  clinic: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  prescriptionCount: z.number(),
  referredSalesPkr: z.number().optional().default(0),
  accruedCommissionPkr: z.number().optional().default(0),
  preferredCount: z.number().optional().default(0),
});

export const pharmacyDoctorRecommendationSchema = z.object({
  id: z.string().uuid(),
  doctorId: z.string().uuid(),
  medicineId: z.string().uuid(),
  medicineName: z.string().optional(),
  medicineSku: z.string().optional(),
  priority: z.number(),
  notes: z.string().nullable().optional(),
  active: z.boolean(),
});

export const pharmacyDoctorCommissionRuleSchema = z.object({
  id: z.string().uuid(),
  doctorId: z.string().uuid(),
  medicineId: z.string().uuid().nullable().optional(),
  companyId: z.string().uuid().nullable().optional(),
  ruleType: z.enum(["percent", "fixed"]),
  rateValue: z.number(),
  active: z.boolean(),
  notes: z.string().nullable().optional(),
});

export const pharmacyDoctorCommissionEntrySchema = z.object({
  id: z.string().uuid(),
  doctorId: z.string().uuid(),
  saleId: z.string().uuid(),
  saleLineId: z.string().uuid().nullable().optional(),
  medicineId: z.string().uuid().nullable().optional(),
  medicineName: z.string().nullable().optional(),
  invoiceNumber: z.string().nullable().optional(),
  basePkr: z.number(),
  rateValue: z.number(),
  ruleType: z.string(),
  amountPkr: z.number(),
  status: z.string(),
  notes: z.string().nullable().optional(),
  createdAt: z.string(),
  paidAt: z.string().nullable().optional(),
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

export const pharmacySaleChannelSchema = z.enum(["counter", "instation", "outstation"]);

export const pharmacySaleSchema = z.object({
  id: z.string().uuid(),
  invoiceNumber: z.string(),
  patientId: z.string().uuid().nullable(),
  patientName: z.string().nullable(),
  prescriptionId: z.string().uuid().nullable().optional(),
  shiftId: z.string().uuid().nullable().optional(),
  saleChannel: pharmacySaleChannelSchema.nullable().optional(),
  areaId: z.string().uuid().nullable().optional(),
  routeId: z.string().uuid().nullable().optional(),
  employeeId: z.string().uuid().nullable().optional(),
  stationLabel: z.string().nullable().optional(),
  employeeName: z.string().nullable().optional(),
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

const pharmacyActivityItemSchema = z.object({
  label: z.string(),
  amount: z.number().optional(),
  at: z.string(),
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
  /** Extended KPI payload */
  totalSales: z.number().default(0),
  totalPurchases: z.number().default(0),
  totalProfit: z.number().default(0),
  grossProfit: z.number().default(0),
  netProfit: z.number().default(0),
  todaySales: z.number().default(0),
  todayPurchases: z.number().default(0),
  todayExpenses: z.number().default(0),
  todayCollections: z.number().default(0),
  todayPayments: z.number().default(0),
  cashInHand: z.number().default(0),
  bankBalance: z.number().default(0),
  customerReceivables: z.number().default(0),
  supplierPayables: z.number().default(0),
  totalCustomers: z.number().default(0),
  totalSuppliers: z.number().default(0),
  totalProducts: z.number().default(0),
  totalStockValue: z.number().default(0),
  outOfStockCount: z.number().default(0),
  expiredCount: z.number().default(0),
  nearExpiryCount: z.number().default(0),
  pendingCustomerPayments: z.number().default(0),
  pendingSupplierPayments: z.number().default(0),
  salesReturnTotal: z.number().default(0),
  purchaseReturnTotal: z.number().default(0),
  distributionSalesMonth: z.number().default(0),
  retailSalesMonth: z.number().default(0),
  wholesaleSalesMonth: z.number().default(0),
  weeklySales: z.array(z.object({ date: z.string(), amount: z.number() })).default([]),
  slowMovingMedicines: z
    .array(z.object({ name: z.string(), qty: z.number(), revenue: z.number() }))
    .default([]),
  recentSales: z.array(pharmacyActivityItemSchema).optional().default([]),
  recentPurchases: z.array(pharmacyActivityItemSchema).optional().default([]),
  recentPayments: z.array(pharmacyActivityItemSchema).optional().default([]),
  recentReceipts: z.array(pharmacyActivityItemSchema).optional().default([]),
  recentActivities: z.array(z.object({ label: z.string(), at: z.string() })).optional().default([]),
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
  alternateBarcode: z.string().optional(),
  purchasePrice: z.number().min(0).default(0),
  sellingPrice: z.number().min(0).default(0),
  costPrice: z.number().min(0).optional(),
  wholesalePrice: z.number().min(0).optional(),
  dealerPrice: z.number().min(0).optional(),
  minSalePrice: z.number().min(0).optional(),
  maxRetailPrice: z.number().min(0).optional(),
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
  prescriptionRequired: z.boolean().optional(),
  companyId: z.string().uuid().optional(),
  genericId: z.string().uuid().optional(),
  brandId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  dosageFormId: z.string().uuid().optional(),
  unitId: z.string().uuid().optional(),
  taxProfileId: z.string().uuid().optional(),
  minStock: z.number().min(0).optional(),
  maxStock: z.number().min(0).optional(),
  batchTrackingEnabled: z.boolean().optional(),
  expiryTrackingEnabled: z.boolean().optional(),
  fefoEnabled: z.boolean().optional(),
  restrictedSale: z.boolean().optional(),
  status: z.string().optional(),
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
  code: z.string().optional(),
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
  code: z.string().optional(),
  name: z.string().min(1),
  specialization: z.string().optional(),
  registrationNumber: z.string().optional(),
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
  saleChannel: pharmacySaleChannelSchema.optional(),
  areaId: z.string().uuid().optional(),
  routeId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
  stationLabel: z.string().optional(),
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
export type PharmacyDoctorRecommendation = z.infer<typeof pharmacyDoctorRecommendationSchema>;
export type PharmacyDoctorCommissionRule = z.infer<typeof pharmacyDoctorCommissionRuleSchema>;
export type PharmacyDoctorCommissionEntry = z.infer<typeof pharmacyDoctorCommissionEntrySchema>;
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

export const FIELD_ROLES = ["Salesman", "MR", "SW", "SNO", "ASM", "RSM", "NSM"] as const;
export const fieldRoleSchema = z.enum(FIELD_ROLES);

export const pharmacyCompanySchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  manufacturerName: z.string().nullable().optional(),
  contactPerson: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  status: z.string(),
});

export const createPharmacyCompanySchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  manufacturerName: z.string().optional(),
  contactPerson: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  licenseInfo: z.string().optional(),
  notes: z.string().optional(),
});

export const pharmacyWarehouseSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  isDefault: z.boolean(),
  status: z.string(),
});

export const createPharmacyWarehouseSchema = z.object({
  branchCode: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  address: z.string().optional(),
  city: z.string().optional(),
  area: z.string().optional(),
  managerName: z.string().optional(),
  isDefault: z.boolean().optional(),
});

export const pharmacyTradeCustomerSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  businessName: z.string().nullable().optional(),
  customerType: z.string(),
  phone: z.string().nullable().optional(),
  creditLimitPkr: z.number(),
  outstandingPkr: z.number(),
  priceLevel: z.string(),
  status: z.string(),
});

export const createPharmacyTradeCustomerSchema = z.object({
  branchCode: z.string().optional(),
  code: z.string().min(1),
  name: z.string().min(1),
  businessName: z.string().optional(),
  customerType: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  cityId: z.string().uuid().optional(),
  areaId: z.string().uuid().optional(),
  territoryId: z.string().uuid().optional(),
  routeId: z.string().uuid().optional(),
  salesmanEmployeeId: z.string().uuid().optional(),
  creditLimitPkr: z.number().min(0).optional(),
  creditDays: z.number().min(0).optional(),
  openingBalancePkr: z.number().min(0).optional(),
  priceLevel: z.string().optional(),
  discountPct: z.number().min(0).optional(),
  taxInfo: z.string().optional(),
});

export const createPharmacyPurchaseOrderSchema = z.object({
  branchCode: z.string().min(1),
  supplierId: z.string().uuid().optional(),
  orderDate: z.string().optional(),
  expectedDate: z.string().optional(),
  notes: z.string().optional(),
  taxPkr: z.number().min(0).optional(),
  discountPkr: z.number().min(0).optional(),
  warehouseId: z.string().uuid().optional(),
  paymentTerms: z.string().optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
  submit: z.boolean().optional(),
  lines: z
    .array(
      z.object({
        medicineId: z.string().uuid(),
        quantity: z.number().min(1),
        freeQuantity: z.number().min(0).optional(),
        unitCostPkr: z.number().min(0).default(0),
        discountPkr: z.number().min(0).optional(),
        taxPkr: z.number().min(0).optional(),
        notes: z.string().optional(),
      }),
    )
    .min(1),
});

export const createPharmacyGrnSchema = z.object({
  branchCode: z.string().min(1),
  warehouseId: z.string().uuid().optional(),
  purchaseOrderId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  supplierInvoiceNumber: z.string().optional(),
  receivedDate: z.string().optional(),
  notes: z.string().optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
  skipPoStatusCheck: z.boolean().optional(),
  priceVarianceOverride: z.boolean().optional(),
  priceVarianceReason: z.string().optional(),
  overReceive: z.boolean().optional(),
  overReceiveReason: z.string().optional(),
  blockNearExpiry: z.boolean().optional(),
  lines: z
    .array(
      z.object({
        medicineId: z.string().uuid(),
        batchNumber: z.string().min(1),
        manufacturingDate: z.string().optional(),
        expiryDate: z.string().min(1),
        quantity: z.number().min(1),
        freeQuantity: z.number().min(0).optional(),
        unitCostPkr: z.number().min(0).default(0),
        purchaseOrderLineId: z.string().uuid().optional(),
      }),
    )
    .min(1),
});

export const createPharmacyPurchaseRequisitionSchema = z.object({
  branchCode: z.string().min(1),
  warehouseId: z.string().uuid().optional(),
  priority: z.string().optional(),
  preferredSupplierId: z.string().uuid().optional(),
  requiredDate: z.string().optional(),
  notes: z.string().optional(),
  lines: z
    .array(
      z.object({
        medicineId: z.string().uuid(),
        requestedQty: z.number().min(1),
        suggestedQty: z.number().min(0).optional(),
        preferredSupplierId: z.string().uuid().optional(),
        lastPurchasePricePkr: z.number().min(0).nullable().optional(),
        notes: z.string().optional(),
      }),
    )
    .min(1),
});

export const updatePharmacyPurchaseRequisitionSchema = z.object({
  priority: z.string().optional(),
  preferredSupplierId: z.string().uuid().nullable().optional(),
  requiredDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  warehouseId: z.string().uuid().nullable().optional(),
  lines: createPharmacyPurchaseRequisitionSchema.shape.lines.optional(),
});

export const purchaseFromReorderSchema = z.object({
  branchCode: z.string().min(1),
  warehouseId: z.string().uuid().optional(),
  medicineIds: z.array(z.string().uuid()).optional(),
  preferredSupplierId: z.string().uuid().optional(),
  notes: z.string().optional(),
});

export const purchaseRequisitionConvertSchema = z.object({
  supplierId: z.string().uuid(),
  warehouseId: z.string().uuid().optional(),
  branchCode: z.string().optional(),
  expectedDate: z.string().optional(),
  notes: z.string().optional(),
  paymentTerms: z.string().optional(),
});

export const purchaseRejectSchema = z.object({
  reason: z.string().min(1),
});

export const purchaseConfirmSchema = z.object({
  confirmedDeliveryDate: z.string().optional(),
  supplierReference: z.string().optional(),
  confirmedQtyNotes: z.string().optional(),
});

export const createPharmacyPurchaseInvoiceSchema = z.object({
  grnId: z.string().uuid(),
  invoiceNumber: z.string().optional(),
  supplierInvoiceNumber: z.string().optional(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
});

export const createPharmacyPurchaseReturnSchema = z.object({
  branchCode: z.string().min(1),
  warehouseId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  grnId: z.string().uuid().optional(),
  reason: z.string().optional(),
  lines: z
    .array(
      z.object({
        medicineId: z.string().uuid(),
        batchId: z.string().uuid().optional(),
        quantity: z.number().min(1),
        unitCostPkr: z.number().min(0).optional(),
      }),
    )
    .min(1),
});

export const purchasePagedFiltersSchema = z.object({
  branchCode: z.string().optional(),
  status: z.string().optional(),
  supplierId: z.string().uuid().optional(),
  q: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.number().min(1).optional(),
  pageSize: z.number().min(1).max(100).optional(),
});

export const createPharmacySaleReturnSchema = z.object({
  branchCode: z.string().min(1),
  originalSaleId: z.string().uuid(),
  reason: z.string().optional(),
  refundMethod: pharmacyPaymentMethodSchema.optional(),
  lines: z
    .array(
      z.object({
        medicineId: z.string().uuid(),
        batchId: z.string().uuid().optional(),
        qty: z.number().min(1),
        tabletsQty: z.number().min(0).optional(),
        unitPricePkr: z.number().min(0).optional(),
      }),
    )
    .min(1),
});

export const createPharmacyDistOrderSchema = z.object({
  branchCode: z.string().min(1),
  warehouseId: z.string().uuid().optional(),
  tradeCustomerId: z.string().uuid(),
  salesmanEmployeeId: z.string().uuid().optional(),
  /** Cash = paid sale (no AR increase on invoice). Credit = default wholesale. */
  paymentMethod: z.enum(["Cash", "Credit"]).optional(),
  creditOverride: z.boolean().optional(),
  creditOverrideReason: z.string().min(1).optional(),
  priceOverrideReason: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
  /** When true, skip Phase 4 availability gate on submit (default false). */
  skipStockCheck: z.boolean().optional(),
  notes: z.string().optional(),
  discountPkr: z.number().min(0).optional(),
  taxPkr: z.number().min(0).optional(),
  submit: z.boolean().optional(),
  lines: z
    .array(
      z.object({
        medicineId: z.string().uuid(),
        quantity: z.number().min(1),
        freeQuantity: z.number().min(0).optional(),
        unitPricePkr: z.number().min(0).optional(),
        discountPkr: z.number().min(0).optional(),
      }),
    )
    .min(1),
});

/** Dist Sale Window cart quote (multi-line pricing + schemes). */
export const pharmacySalesQuoteSchema = z.object({
  branchCode: z.string().min(1),
  tradeCustomerId: z.string().uuid(),
  warehouseId: z.string().uuid().optional(),
  discountPkr: z.number().min(0).optional(),
  taxPkr: z.number().min(0).optional(),
  lines: z
    .array(
      z.object({
        medicineId: z.string().uuid(),
        quantity: z.number().min(1),
        unitPricePkr: z.number().min(0).optional(),
        discountPkr: z.number().min(0).optional(),
        freeQuantity: z.number().min(0).optional(),
      }),
    )
    .min(1),
});

export const pharmacySalesValidateSchema = pharmacySalesQuoteSchema.extend({
  creditOverride: z.boolean().optional(),
  creditOverrideReason: z.string().optional(),
  submit: z.boolean().optional(),
});

export type PharmacySalesQuoteInput = z.infer<typeof pharmacySalesQuoteSchema>;
export type PharmacySalesValidateInput = z.infer<typeof pharmacySalesValidateSchema>;

export const resolvePharmacyPriceSchema = z.object({
  medicineId: z.string().uuid(),
  tradeCustomerId: z.string().uuid().optional(),
  priceLevel: z.string().optional(),
  qty: z.number().min(1).optional(),
});

export const pharmacyResolvedPriceSchema = z.object({
  medicineId: z.string().uuid(),
  unitPricePkr: z.number(),
  source: z.string(),
  priceListId: z.string().uuid().nullable().optional(),
});

export type PharmacyCompany = z.infer<typeof pharmacyCompanySchema>;
export type CreatePharmacyCompany = z.infer<typeof createPharmacyCompanySchema>;
export type PharmacyWarehouse = z.infer<typeof pharmacyWarehouseSchema>;
export type CreatePharmacyWarehouse = z.infer<typeof createPharmacyWarehouseSchema>;
export type PharmacyTradeCustomer = z.infer<typeof pharmacyTradeCustomerSchema>;
export type CreatePharmacyTradeCustomer = z.infer<typeof createPharmacyTradeCustomerSchema>;
export type CreatePharmacyPurchaseOrder = z.infer<typeof createPharmacyPurchaseOrderSchema>;
export type CreatePharmacyGrn = z.infer<typeof createPharmacyGrnSchema>;
export type CreatePharmacySaleReturn = z.infer<typeof createPharmacySaleReturnSchema>;
export type CreatePharmacyDistOrder = z.infer<typeof createPharmacyDistOrderSchema>;
export type ResolvePharmacyPrice = z.infer<typeof resolvePharmacyPriceSchema>;
export type PharmacyResolvedPrice = z.infer<typeof pharmacyResolvedPriceSchema>;
export type CreatePharmacyPurchaseRequisition = z.infer<typeof createPharmacyPurchaseRequisitionSchema>;
export type UpdatePharmacyPurchaseRequisition = z.infer<typeof updatePharmacyPurchaseRequisitionSchema>;
export type CreatePharmacyPurchaseInvoice = z.infer<typeof createPharmacyPurchaseInvoiceSchema>;
export type CreatePharmacyPurchaseReturn = z.infer<typeof createPharmacyPurchaseReturnSchema>;
export type PurchaseFromReorder = z.infer<typeof purchaseFromReorderSchema>;
export type PurchaseRequisitionConvert = z.infer<typeof purchaseRequisitionConvertSchema>;

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

// ── Phase 7 Delivery + Collections + Aging + Recovery ───────────────────────

export const createPharmacyDriverSchema = z.object({
  branchCode: z.string().optional(),
  code: z.string().min(1),
  name: z.string().min(1),
  phone: z.string().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  vehicleId: z.string().uuid().optional(),
  notes: z.string().optional(),
});
export const updatePharmacyDriverSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  vehicleId: z.string().uuid().nullable().optional(),
  notes: z.string().optional(),
});

export const createPharmacyVehicleSchema = z.object({
  branchCode: z.string().optional(),
  code: z.string().min(1),
  registrationNo: z.string().min(1),
  vehicleType: z.string().optional(),
  status: z.enum(["available", "assigned", "on_route", "maintenance", "inactive"]).optional(),
  notes: z.string().optional(),
});
export const updatePharmacyVehicleSchema = z.object({
  registrationNo: z.string().min(1).optional(),
  vehicleType: z.string().optional(),
  status: z.enum(["available", "assigned", "on_route", "maintenance", "inactive"]).optional(),
  notes: z.string().optional(),
});

export const createPharmacyDeliverySchema = z
  .object({
    branchCode: z.string().min(1),
    orderId: z.string().uuid().optional(),
    invoiceId: z.string().uuid().optional(),
    tradeCustomerId: z.string().uuid().optional(),
    riderName: z.string().optional(),
    driverId: z.string().uuid().optional(),
    vehicleId: z.string().uuid().optional(),
    routeId: z.string().uuid().optional(),
    warehouseId: z.string().uuid().optional(),
    priority: z.string().optional(),
    address: z.string().optional(),
    contactName: z.string().optional(),
    contactPhone: z.string().optional(),
    idempotencyKey: z.string().min(1).max(128).optional(),
  })
  .refine((v) => Boolean(v.invoiceId || v.orderId || v.tradeCustomerId), {
    message: "invoiceId, orderId, or tradeCustomerId is required",
  });

export const pharmacyDeliveryAssignSchema = z.object({
  driverId: z.string().uuid().nullable().optional(),
  vehicleId: z.string().uuid().nullable().optional(),
  routeId: z.string().uuid().nullable().optional(),
  riderName: z.string().nullable().optional(),
  priority: z.string().optional(),
});

export const pharmacyDeliveryDispatchSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
});

export const pharmacyDeliveryPodSchema = z.object({
  status: z.enum(["delivered", "partial", "failed", "refused"]),
  receiverName: z.string().optional(),
  signatureRef: z.string().optional(),
  photoRef: z.string().optional(),
  failedReason: z.string().optional(),
  refusalReason: z.string().optional(),
  podNotes: z.string().optional(),
  collectedPkr: z.number().min(0).optional(),
  requireReceiverName: z.boolean().optional(),
  lines: z
    .array(
      z.object({
        lineId: z.string().uuid(),
        deliveredQty: z.number().int().min(0).optional(),
        returnedQty: z.number().int().min(0).optional(),
        notes: z.string().optional(),
      }),
    )
    .optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
});

export const pharmacyCollectionAllocationSchema = z.object({
  invoiceId: z.string().uuid(),
  amountPkr: z.number().positive(),
});

export const createPharmacyCollectionSchema = z
  .object({
    branchCode: z.string().min(1),
    tradeCustomerId: z.string().uuid(),
    amountPkr: z.number().positive(),
    paymentMethod: z.string().optional(),
    invoiceId: z.string().uuid().optional(),
    patientId: z.string().uuid().optional(),
    salesmanEmployeeId: z.string().uuid().optional(),
    notes: z.string().optional(),
    allocations: z.array(pharmacyCollectionAllocationSchema).optional(),
    /** Hold as unallocated advance — does not reduce outstanding until allocate. */
    advance: z.boolean().optional(),
    chequeNumber: z.string().optional(),
    chequeBank: z.string().optional(),
    chequeDate: z.string().optional(),
    chequeStatus: z.enum(["pending", "deposited", "cleared", "bounced", "cancelled"]).optional(),
    idempotencyKey: z.string().min(1).max(128).optional(),
  })
  .superRefine((v, ctx) => {
    const hasAlloc = (v.allocations?.length ?? 0) > 0 || Boolean(v.invoiceId);
    if (!hasAlloc && !v.advance) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "allocations (or invoiceId) required, or set advance=true",
      });
    }
  });

export const pharmacyCollectionAllocateSchema = z.object({
  allocations: z.array(pharmacyCollectionAllocationSchema).min(1),
});

export const pharmacyCollectionChequeStatusSchema = z.object({
  chequeStatus: z.enum(["pending", "deposited", "cleared", "bounced", "cancelled"]),
});

export const pharmacyAgingQuerySchema = z.object({
  branchCode: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  minOutstanding: z.coerce.number().min(0).optional(),
});

export const createPharmacyPromiseToPaySchema = z.object({
  branchCode: z.string().optional(),
  tradeCustomerId: z.string().uuid(),
  invoiceId: z.string().uuid().optional(),
  promisedAmountPkr: z.number().positive(),
  promiseDate: z.string().min(1),
  notes: z.string().optional(),
});

export const updatePharmacyPromiseStatusSchema = z.object({
  status: z.enum(["open", "kept", "broken", "cancelled"]),
});

export type CreatePharmacyDriver = z.infer<typeof createPharmacyDriverSchema>;
export type CreatePharmacyVehicle = z.infer<typeof createPharmacyVehicleSchema>;
export type CreatePharmacyDelivery = z.infer<typeof createPharmacyDeliverySchema>;
export type CreatePharmacyCollection = z.infer<typeof createPharmacyCollectionSchema>;
export type CreatePharmacyPromiseToPay = z.infer<typeof createPharmacyPromiseToPaySchema>;

// ─── Phase 8 field force ───────────────────────────────────────────────────

export const fieldForceSalesmanStatusSchema = z.enum(["active", "inactive", "suspended", "on_leave"]);
export const fieldForceVisitStatusSchema = z.enum([
  "planned",
  "started",
  "completed",
  "missed",
  "cancelled",
  "rescheduled",
]);
export const fieldForceVisitOutcomeSchema = z.enum([
  "order_taken",
  "collection_received",
  "order_and_collection",
  "follow_up_required",
  "customer_not_available",
  "customer_closed",
  "customer_refused",
  "no_order",
  "other",
]);
export const fieldForcePjpFrequencySchema = z.enum(["daily", "weekly", "biweekly", "monthly", "custom"]);
export const fieldForceTargetScopeSchema = z.enum(["salesman", "territory", "route", "branch"]);

export const upsertFieldForceSalesmanSchema = z.object({
  employeeId: z.string().uuid(),
  fieldRole: z.string().optional(),
  branchCode: z.string().optional(),
  territoryId: z.string().uuid().nullable().optional(),
  cityId: z.string().uuid().nullable().optional(),
  areaId: z.string().uuid().nullable().optional(),
  geoTerritoryId: z.string().uuid().nullable().optional(),
  primaryRouteId: z.string().uuid().nullable().optional(),
  extraRouteIds: z.array(z.string().uuid()).optional(),
  managerEmployeeId: z.string().uuid().nullable().optional(),
  dailyVisitTarget: z.number().int().min(0).optional(),
  monthlySalesTargetPkr: z.number().int().min(0).optional(),
  monthlyCollectionTargetPkr: z.number().int().min(0).optional(),
  visitFrequency: z.string().optional(),
  workingDays: z.string().optional(),
  notes: z.string().optional(),
  status: fieldForceSalesmanStatusSchema.optional(),
});

export const fieldForceAssignCustomerSchema = z.object({
  tradeCustomerId: z.string().uuid(),
  salesmanEmployeeId: z.string().uuid().nullable().optional(),
  territoryId: z.string().uuid().nullable().optional(),
  routeId: z.string().uuid().nullable().optional(),
  reason: z.string().optional(),
});

export const fieldForceRouteCustomerSchema = z.object({
  tradeCustomerId: z.string().uuid(),
  sequenceNo: z.number().int().min(0).optional(),
  preferredVisitDay: z.number().int().min(0).max(6).nullable().optional(),
  visitFrequency: z.string().optional(),
  priority: z.string().optional(),
  notes: z.string().optional(),
});

export const fieldForceReorderRouteSchema = z.object({
  customerIds: z.array(z.string().uuid()).min(1),
});

export const createFieldForcePjpSchema = z.object({
  branchCode: z.string().optional(),
  name: z.string().min(1),
  employeeId: z.string().uuid(),
  territoryId: z.string().uuid().optional(),
  routeId: z.string().uuid().optional(),
  effectiveFrom: z.string().min(1),
  effectiveTo: z.string().optional(),
  frequency: fieldForcePjpFrequencySchema.optional(),
  workingDays: z.string().optional(),
  notes: z.string().optional(),
  lines: z
    .array(
      z.object({
        dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
        tradeCustomerId: z.string().uuid(),
        routeId: z.string().uuid().optional(),
        sequenceNo: z.number().int().min(0).optional(),
        visitType: z.string().optional(),
        priority: z.string().optional(),
        plannedDurationMin: z.number().int().positive().optional(),
        notes: z.string().optional(),
      }),
    )
    .min(1),
});

export const reviseFieldForcePjpSchema = createFieldForcePjpSchema.extend({
  changeReason: z.string().min(1),
});

export const generateFieldForceVisitsSchema = z.object({
  date: z.string().min(1),
  employeeId: z.string().uuid().optional(),
  pjpId: z.string().uuid().optional(),
  branchCode: z.string().optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
});

export const startFieldForceVisitSchema = z.object({
  latitude: z.string().optional(),
  longitude: z.string().optional(),
  locationAccuracy: z.string().optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
});

export const completeFieldForceVisitSchema = z.object({
  outcome: fieldForceVisitOutcomeSchema,
  notes: z.string().optional(),
  contactPerson: z.string().optional(),
  customerFeedback: z.string().optional(),
  orderId: z.string().uuid().optional(),
  collectionId: z.string().uuid().optional(),
  followUpRequired: z.boolean().optional(),
  followUpDate: z.string().optional(),
  followUpAction: z.string().optional(),
  nextVisitDate: z.string().optional(),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
  locationAccuracy: z.string().optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
});

export const rescheduleFieldForceVisitSchema = z.object({
  newDate: z.string().min(1),
  reason: z.string().min(1),
});

export const missFieldForceVisitSchema = z.object({
  reason: z.string().optional(),
});

export const closeFieldForceDaySchema = z.object({
  date: z.string().min(1),
  employeeId: z.string().uuid().optional(),
  branchCode: z.string().optional(),
});

export const createFieldForceTargetSchema = z.object({
  periodType: z.enum(["daily", "weekly", "monthly", "quarterly", "custom"]).optional(),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  scopeType: fieldForceTargetScopeSchema.optional(),
  employeeId: z.string().uuid().optional(),
  territoryId: z.string().uuid().optional(),
  routeId: z.string().uuid().optional(),
  branchCode: z.string().optional(),
  targetSalesPkr: z.number().int().min(0).optional(),
  targetCollectionPkr: z.number().int().min(0).optional(),
  targetVisits: z.number().int().min(0).optional(),
  changeReason: z.string().optional(),
});

export type UpsertFieldForceSalesman = z.infer<typeof upsertFieldForceSalesmanSchema>;
export type FieldForceRouteCustomer = z.infer<typeof fieldForceRouteCustomerSchema>;
export type CreateFieldForcePjp = z.infer<typeof createFieldForcePjpSchema>;
export type GenerateFieldForceVisits = z.infer<typeof generateFieldForceVisitsSchema>;
export type CompleteFieldForceVisit = z.infer<typeof completeFieldForceVisitSchema>;
export type CreateFieldForceTarget = z.infer<typeof createFieldForceTargetSchema>;
