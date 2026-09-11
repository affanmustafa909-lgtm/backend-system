import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import {
  createPharmacyDistOrderSchema,
  pharmacySalesQuoteSchema,
  pharmacySalesValidateSchema,
} from "@platform/contracts";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { CurrentUser } from "../../auth/current-user.decorator";
import type { AccessJwtPayload } from "../../auth/jwt.types";
import { PermissionsGuard } from "../../users/permissions.guard";
import { RequirePermissions } from "../../users/require-permission.decorator";
import { SystemTypeGuard } from "../../users/system-type.guard";
import { RequireSystemType } from "../../users/require-system-type.decorator";
import { PharmacyErpService } from "../pharmacy-erp.service";
import { SalesPricingService } from "./sales-pricing.service";
import { SalesSearchService } from "./sales-search.service";
import { SalesValidationService } from "./sales-validation.service";

type Q = Record<string, string | undefined>;

/**
 * Phase 5 Dist Sale Window support APIs.
 * Booking still posts through createDistOrder (here via /book, and via
 * POST /v1/pharmacy/distribution/orders). Retail POST /sales is untouched.
 */
@Controller("v1/pharmacy/sales")
@UseGuards(JwtAuthGuard, PermissionsGuard, SystemTypeGuard)
@RequireSystemType("pharmacy", "distribution")
export class SalesController {
  constructor(
    private readonly search: SalesSearchService,
    private readonly pricing: SalesPricingService,
    private readonly validation: SalesValidationService,
    private readonly erp: PharmacyErpService,
  ) {}

  private num(raw?: string) {
    if (raw === undefined || raw === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }

  @Get("products/search")
  @RequirePermissions("sales.view", "distribution.orders", "pharmacy.view", "pops.read")
  searchProducts(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.search.searchProducts(user.organizationId, q.branchCode ?? "", q.q ?? "", {
      page: this.num(q.page),
      pageSize: this.num(q.pageSize),
      warehouseId: q.warehouseId,
    });
  }

  @Get("products/barcode")
  @RequirePermissions("sales.view", "distribution.orders", "pharmacy.view", "pops.read")
  lookupBarcode(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.search.lookupBarcode(
      user.organizationId,
      q.branchCode ?? "",
      q.barcode ?? "",
      q.warehouseId,
    );
  }

  @Get("customers/search")
  @RequirePermissions("sales.view", "distribution.orders", "pharmacy.view", "pops.read")
  searchCustomers(@CurrentUser() user: AccessJwtPayload, @Query() q: Q) {
    return this.search.searchCustomers(user.organizationId, q.q ?? "", {
      page: this.num(q.page),
      pageSize: this.num(q.pageSize),
      customerType: q.customerType,
    });
  }

  @Post("pricing/quote")
  @RequirePermissions("sales.view", "distribution.orders", "distribution.pricing", "pops.read")
  quote(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.pricing.quoteCart(user.organizationId, pharmacySalesQuoteSchema.parse(body));
  }

  @Post("validate")
  @RequirePermissions("sales.book", "distribution.orders", "pops.inventory.manage")
  validate(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.validation.validate(
      user.organizationId,
      user.sub,
      pharmacySalesValidateSchema.parse(body),
    );
  }

  @Get("held")
  @RequirePermissions("sales.hold", "sales.resume", "distribution.orders")
  listHeld(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode?: string) {
    return this.erp.listHeldDistOrders(user.organizationId, branchCode?.trim());
  }

  @Delete("held/:orderId")
  @RequirePermissions("sales.hold", "distribution.orders")
  cancelHeld(@CurrentUser() user: AccessJwtPayload, @Param("orderId") orderId: string) {
    return this.erp.cancelHeldDistOrder(user.organizationId, orderId, user.sub);
  }

  /**
   * Thin book wrapper: validate then createDistOrder(submit:true).
   * Idempotent when idempotencyKey is supplied.
   */
  @Post("book")
  @RequirePermissions("sales.book", "distribution.orders", "pops.inventory.manage")
  async book(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    const input = createPharmacyDistOrderSchema.parse({
      ...(typeof body === "object" && body ? body : {}),
      submit: true,
    });

    const validation = await this.validation.validate(user.organizationId, user.sub, {
      branchCode: input.branchCode,
      tradeCustomerId: input.tradeCustomerId,
      warehouseId: input.warehouseId,
      discountPkr: input.discountPkr,
      taxPkr: input.taxPkr,
      creditOverride: input.creditOverride,
      creditOverrideReason: input.creditOverrideReason,
      submit: true,
      lines: input.lines,
    });
    if (!validation.valid) {
      return { booked: false, validation };
    }

    const order = await this.erp.createDistOrder(user.organizationId, input, user.sub);
    return { booked: true, order, validation };
  }
}
