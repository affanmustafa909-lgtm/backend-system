import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import {
  createFactoryDailySheetSchema,
  createFactoryInwardChallanSchema,
  createFactoryItemSchema,
  createFactoryJobBillSchema,
  createFactoryLedgerEntrySchema,
  createFactoryOperatorAdvanceSchema,
  createFactoryOperatorSchema,
  createFactoryOutwardChallanSchema,
  createFactoryPackingRecordSchema,
  createFactoryPartySchema,
  createFactoryPrintJobSchema,
  createFactoryPrinterProfileSchema,
  factoryDesignAiAnalyzeSchema,
  factoryStockTxnSchema,
} from "@platform/contracts";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { PermissionsGuard } from "../users/permissions.guard";
import { RequirePermissions } from "../users/require-permission.decorator";
import { SystemTypeGuard } from "../users/system-type.guard";
import { RequireSystemType } from "../users/require-system-type.decorator";
import { FactoryService } from "./factory.service";

@Controller("v1/factory")
@UseGuards(JwtAuthGuard, PermissionsGuard, SystemTypeGuard)
@RequireSystemType("embroidery")
export class FactoryController {
  constructor(private readonly factory: FactoryService) {}

  private orgId(user: AccessJwtPayload): string {
    return user.organizationId;
  }

  @Get("parties")
  @RequirePermissions("embroidery.read", "embroidery.manage", "*")
  listParties(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchId") branchId?: string,
    @Query("kind") kind?: string,
  ) {
    return this.factory.listParties(this.orgId(user), branchId, kind);
  }

  @Post("parties")
  @RequirePermissions("embroidery.manage", "*")
  createParty(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.factory.createParty(this.orgId(user), createFactoryPartySchema.parse(body));
  }

  @Get("items")
  @RequirePermissions("embroidery.read", "embroidery.manage", "*")
  listItems(@CurrentUser() user: AccessJwtPayload, @Query("branchId") branchId: string) {
    if (!branchId) throw new BadRequestException("branchId query is required");
    return this.factory.listItems(this.orgId(user), branchId);
  }

  @Post("items")
  @RequirePermissions("embroidery.manage", "*")
  createItem(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.factory.createItem(this.orgId(user), createFactoryItemSchema.parse(body));
  }

  @Post("stock")
  @RequirePermissions("embroidery.manage", "*")
  postStockTxn(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.factory.postStockTxn(this.orgId(user), factoryStockTxnSchema.parse(body));
  }

  @Get("inward-challans")
  @RequirePermissions("embroidery.read", "embroidery.manage", "*")
  listInwardChallans(@CurrentUser() user: AccessJwtPayload, @Query("branchId") branchId?: string) {
    return this.factory.listInwardChallans(this.orgId(user), branchId);
  }

  @Post("inward-challans")
  @RequirePermissions("embroidery.manage", "*")
  createInwardChallan(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.factory.createInwardChallan(this.orgId(user), createFactoryInwardChallanSchema.parse(body));
  }

  @Get("outward-challans")
  @RequirePermissions("embroidery.read", "embroidery.manage", "*")
  listOutwardChallans(@CurrentUser() user: AccessJwtPayload, @Query("branchId") branchId?: string) {
    return this.factory.listOutwardChallans(this.orgId(user), branchId);
  }

  @Post("outward-challans")
  @RequirePermissions("embroidery.manage", "*")
  createOutwardChallan(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.factory.createOutwardChallan(this.orgId(user), createFactoryOutwardChallanSchema.parse(body));
  }

  @Get("operators")
  @RequirePermissions("embroidery.read", "embroidery.manage", "*")
  listOperators(@CurrentUser() user: AccessJwtPayload, @Query("branchId") branchId?: string) {
    return this.factory.listOperators(this.orgId(user), branchId);
  }

  @Post("operators")
  @RequirePermissions("embroidery.manage", "*")
  createOperator(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.factory.createOperator(this.orgId(user), createFactoryOperatorSchema.parse(body));
  }

  @Get("daily-sheets")
  @RequirePermissions("embroidery.read", "embroidery.manage", "*")
  listDailySheets(@CurrentUser() user: AccessJwtPayload, @Query("branchId") branchId?: string) {
    return this.factory.listDailySheets(this.orgId(user), branchId);
  }

  @Post("daily-sheets")
  @RequirePermissions("embroidery.manage", "*")
  createDailySheet(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.factory.createDailySheet(this.orgId(user), createFactoryDailySheetSchema.parse(body));
  }

  @Get("job-bills")
  @RequirePermissions("embroidery.read", "embroidery.manage", "*")
  listJobBills(@CurrentUser() user: AccessJwtPayload, @Query("branchId") branchId?: string) {
    return this.factory.listJobBills(this.orgId(user), branchId);
  }

  @Post("job-bills")
  @RequirePermissions("embroidery.manage", "*")
  createJobBill(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.factory.createJobBill(this.orgId(user), createFactoryJobBillSchema.parse(body));
  }

  @Get("ledger")
  @RequirePermissions("embroidery.read", "embroidery.manage", "*")
  listLedger(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchId") branchId?: string,
    @Query("accountKind") accountKind?: string,
  ) {
    return this.factory.listLedger(this.orgId(user), branchId, accountKind);
  }

  @Post("ledger")
  @RequirePermissions("embroidery.manage", "*")
  createLedgerEntry(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.factory.createLedgerEntry(this.orgId(user), createFactoryLedgerEntrySchema.parse(body));
  }

  @Get("advances")
  @RequirePermissions("embroidery.read", "embroidery.manage", "*")
  listAdvances(@CurrentUser() user: AccessJwtPayload, @Query("branchId") branchId?: string) {
    return this.factory.listAdvances(this.orgId(user), branchId);
  }

  @Post("advances")
  @RequirePermissions("embroidery.manage", "*")
  createAdvance(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.factory.createAdvance(this.orgId(user), createFactoryOperatorAdvanceSchema.parse(body));
  }

  @Get("mis/summary")
  @RequirePermissions("embroidery.read", "embroidery.manage", "*")
  misSummary(@CurrentUser() user: AccessJwtPayload, @Query("branchId") branchId?: string) {
    return this.factory.misSummary(this.orgId(user), branchId);
  }

  @Get("printers")
  @RequirePermissions("embroidery.read", "embroidery.manage", "*")
  listPrinters(@CurrentUser() user: AccessJwtPayload, @Query("branchId") branchId?: string) {
    return this.factory.listPrinters(this.orgId(user), branchId);
  }

  @Post("printers")
  @RequirePermissions("embroidery.manage", "*")
  createPrinter(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.factory.createPrinter(this.orgId(user), createFactoryPrinterProfileSchema.parse(body));
  }

  @Get("print-jobs")
  @RequirePermissions("embroidery.read", "embroidery.manage", "*")
  listPrintJobs(@CurrentUser() user: AccessJwtPayload, @Query("branchId") branchId?: string) {
    return this.factory.listPrintJobs(this.orgId(user), branchId);
  }

  @Post("print-jobs")
  @RequirePermissions("embroidery.manage", "*")
  createPrintJob(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.factory.createPrintJob(this.orgId(user), createFactoryPrintJobSchema.parse(body));
  }

  @Get("packing")
  @RequirePermissions("embroidery.read", "embroidery.manage", "*")
  listPacking(@CurrentUser() user: AccessJwtPayload, @Query("branchId") branchId?: string) {
    return this.factory.listPacking(this.orgId(user), branchId);
  }

  @Post("packing")
  @RequirePermissions("embroidery.manage", "*")
  createPacking(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.factory.createPacking(this.orgId(user), createFactoryPackingRecordSchema.parse(body));
  }

  @Post("designs/ai-analyze")
  @RequirePermissions("embroidery.manage", "embroidery.read", "*")
  analyzeDesign(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.factory.analyzeDesignAi(this.orgId(user), factoryDesignAiAnalyzeSchema.parse(body));
  }
}