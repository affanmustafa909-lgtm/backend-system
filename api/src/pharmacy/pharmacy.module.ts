import { Module } from "@nestjs/common";
import { AccountingModule } from "../accounting/accounting.module";
import { PermissionsGuard } from "../users/permissions.guard";
import { SystemTypeGuard } from "../users/system-type.guard";
import { TaxAuthorityModule } from "../tax-authority/tax-authority.module";
import { PharmacyController } from "./pharmacy.controller";
import { PharmacyDashboardService } from "./pharmacy-dashboard.service";
import { PharmacyErpController } from "./pharmacy-erp.controller";
import { PharmacyErpService } from "./pharmacy-erp.service";
import { PharmacyMastersController } from "./pharmacy-masters.controller";
import { PharmacyMastersService } from "./pharmacy-masters.service";
import { PharmacyService } from "./pharmacy.service";
import { PharmacyStockEngine } from "./pharmacy-stock.engine";
import { PharmacyInventoryController } from "./inventory/inventory.controller";
import { InventoryService } from "./inventory/inventory.service";
import { InventorySettingsService } from "./inventory/inventory-settings.service";
import { InventoryValuationService } from "./inventory/inventory-valuation.service";
import { BatchStockService } from "./inventory/batch-stock.service";
import { FefoService } from "./inventory/fefo.service";
import { StockAdjustmentService } from "./inventory/stock-adjustment.service";
import { StockAvailabilityService } from "./inventory/stock-availability.service";
import { StockCountService } from "./inventory/stock-count.service";
import { StockLedgerService } from "./inventory/stock-ledger.service";
import { StockTransferService } from "./inventory/stock-transfer.service";
import { InventoryNumberingService } from "./inventory/inventory-numbering.service";
import { SalesController } from "./sales/sales.controller";
import { SalesSearchService } from "./sales/sales-search.service";
import { SalesPricingService } from "./sales/sales-pricing.service";
import { SalesCreditService } from "./sales/sales-credit.service";
import { SalesValidationService } from "./sales/sales-validation.service";
import { PurchaseController } from "./purchase/purchase.controller";
import { PurchaseNumberingService } from "./purchase/purchase-numbering.service";
import { PurchaseOrderService } from "./purchase/purchase-order.service";
import { PurchaseGrnService } from "./purchase/purchase-grn.service";
import { PurchaseRequisitionService } from "./purchase/purchase-requisition.service";
import { PurchaseInvoiceService } from "./purchase/purchase-invoice.service";
import { PurchaseReturnService } from "./purchase/purchase-return.service";
import { PurchaseDashboardService } from "./purchase/purchase-dashboard.service";
import { SupplierPerformanceService } from "./purchase/supplier-performance.service";
import { DeliveryController } from "./delivery/delivery.controller";
import { DeliveryNumberingService } from "./delivery/delivery-numbering.service";
import { DeliveryService } from "./delivery/delivery.service";
import { DeliveryDashboardService } from "./delivery/delivery-dashboard.service";
import { DriverService } from "./delivery/driver.service";
import { VehicleService } from "./delivery/vehicle.service";
import { CollectionsController } from "./collections/collections.controller";
import { CollectionService } from "./collections/collection.service";
import { AgingService } from "./collections/aging.service";
import { RecoveryService } from "./collections/recovery.service";

@Module({
  imports: [TaxAuthorityModule, AccountingModule],
  controllers: [
    PharmacyController,
    PharmacyErpController,
    PharmacyMastersController,
    PharmacyInventoryController,
    SalesController,
    PurchaseController,
    DeliveryController,
    CollectionsController,
  ],
  providers: [
    PharmacyService,
    // Phase 5 pricing lives here so Erp injects SalesPricing (no circular DI).
    SalesPricingService,
    // Phase 6 purchase — register before Erp so Erp can delegate GRN/PO.
    PurchaseNumberingService,
    PurchaseOrderService,
    PurchaseGrnService,
    PurchaseRequisitionService,
    PurchaseInvoiceService,
    PurchaseReturnService,
    PurchaseDashboardService,
    SupplierPerformanceService,
    // Phase 7 delivery/collections — standalone before Erp (Erp thin-delegates createCollection).
    DeliveryNumberingService,
    DriverService,
    VehicleService,
    DeliveryService,
    DeliveryDashboardService,
    CollectionService,
    AgingService,
    RecoveryService,
    PharmacyErpService,
    PharmacyMastersService,
    PharmacyDashboardService,
    PharmacyStockEngine,
    // Phase 4 inventory layer
    InventorySettingsService,
    InventoryNumberingService,
    StockLedgerService,
    FefoService,
    StockAvailabilityService,
    BatchStockService,
    InventoryValuationService,
    InventoryService,
    StockTransferService,
    StockAdjustmentService,
    StockCountService,
    // Phase 5 Dist Sale Window
    SalesSearchService,
    SalesCreditService,
    SalesValidationService,
    PermissionsGuard,
    SystemTypeGuard,
  ],
  exports: [
    PharmacyService,
    PharmacyErpService,
    PharmacyMastersService,
    PharmacyDashboardService,
    PharmacyStockEngine,
    InventorySettingsService,
    StockLedgerService,
    FefoService,
    StockAvailabilityService,
    BatchStockService,
    InventoryValuationService,
    InventoryService,
    StockTransferService,
    StockAdjustmentService,
    StockCountService,
    SalesPricingService,
    SalesSearchService,
    SalesCreditService,
    SalesValidationService,
    PurchaseOrderService,
    PurchaseGrnService,
    PurchaseRequisitionService,
    DeliveryService,
    DeliveryDashboardService,
    CollectionService,
    AgingService,
    RecoveryService,
  ],
})
export class PharmacyModule {}
