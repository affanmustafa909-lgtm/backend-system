/**
 * Canonical business codes for Pharmacy + Distribution ERP.
 * Every master / document uses a stable prefix so users can find records quickly.
 */
export const PHARMACY_CODE_PREFIXES = {
  medicine: "MED",
  sku: "SKU",
  company: "COM",
  warehouse: "WH",
  patient: "PAT",
  doctor: "DOC",
  tradeCustomer: "CUS",
  territory: "TER",
  city: "CTY",
  area: "ARA",
  route: "RTE",
  salesForce: "SF",
  prescription: "RX",
  saleInvoice: "INV",
  saleReturn: "SRN",
  purchaseOrder: "PO",
  grn: "GRN",
  purchaseReturn: "PRN",
  distOrder: "DO",
  distInvoice: "WINV",
  delivery: "DLV",
  collection: "COL",
  transfer: "TRF",
  shift: "SHF",
  priceList: "PL",
  scheme: "SCH",
  assignment: "ASN",
  visit: "VIS",
  target: "TGT",
  batch: "BAT",
  wholesaleReturn: "WRN",
  doctorCommission: "DCR",
} as const;

export type PharmacyCodeModule = keyof typeof PHARMACY_CODE_PREFIXES;

export const PHARMACY_CODE_CATALOG: {
  module: PharmacyCodeModule;
  prefix: string;
  label: string;
  path: string;
}[] = [
  { module: "medicine", prefix: "MED / SKU", label: "Medicines / products", path: "/pops/pharmacy/medicines" },
  { module: "company", prefix: "COM", label: "Companies", path: "/pops/pharmacy/companies" },
  { module: "warehouse", prefix: "WH", label: "Warehouses", path: "/pops/pharmacy/warehouses" },
  { module: "patient", prefix: "PAT", label: "Patients", path: "/pops/pharmacy/customers" },
  { module: "doctor", prefix: "DOC", label: "Doctors", path: "/pops/pharmacy/doctors" },
  { module: "tradeCustomer", prefix: "CUS", label: "Trade customers", path: "/pops/pharmacy/trade-customers" },
  { module: "territory", prefix: "TER", label: "Territories", path: "/pops/pharmacy/geo" },
  { module: "city", prefix: "CTY", label: "Cities", path: "/pops/pharmacy/geo" },
  { module: "area", prefix: "ARA", label: "Areas", path: "/pops/pharmacy/geo" },
  { module: "route", prefix: "RTE", label: "Routes", path: "/pops/pharmacy/geo" },
  { module: "prescription", prefix: "RX", label: "Prescriptions", path: "/pops/pharmacy/prescriptions" },
  { module: "saleInvoice", prefix: "INV", label: "Retail invoices", path: "/pops/pharmacy/sales" },
  { module: "saleReturn", prefix: "SRN", label: "Sale returns", path: "/pops/pharmacy/sale-returns" },
  { module: "purchaseOrder", prefix: "PO", label: "Purchase orders", path: "/pops/pharmacy/purchase-orders" },
  { module: "grn", prefix: "GRN", label: "Goods receipts", path: "/pops/pharmacy/purchase-orders" },
  { module: "purchaseReturn", prefix: "PRN", label: "Purchase returns", path: "/pops/pharmacy/purchase-orders" },
  { module: "distOrder", prefix: "DO", label: "Distribution orders", path: "/pops/pharmacy/distribution/orders" },
  { module: "distInvoice", prefix: "WINV", label: "Wholesale invoices", path: "/pops/pharmacy/distribution/orders" },
  { module: "delivery", prefix: "DLV", label: "Deliveries", path: "/pops/pharmacy/distribution/deliveries" },
  { module: "collection", prefix: "COL", label: "Collections", path: "/pops/pharmacy/distribution/collections" },
  { module: "priceList", prefix: "PL", label: "Price lists", path: "/pops/pharmacy/pricing" },
  { module: "scheme", prefix: "SCH", label: "Schemes", path: "/pops/pharmacy/pricing" },
  { module: "assignment", prefix: "ASN", label: "Assignments", path: "/pops/pharmacy/distribution/assignments" },
  { module: "wholesaleReturn", prefix: "WRN", label: "Wholesale returns", path: "/pops/pharmacy/distribution/wholesale-returns" },
  { module: "doctorCommission", prefix: "DCR", label: "Doctor commission", path: "/pops/pharmacy/doctors" },
];

/** Build DOC-000042 style codes. */
export function formatPharmacyCode(prefix: string, seq: number, width = 6): string {
  const n = Math.max(1, Math.floor(seq));
  return `${prefix}-${String(n).padStart(width, "0")}`;
}

export function normalizeLookupCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}
