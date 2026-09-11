import {
  Body,
  Controller,
  Get,
  BadRequestException,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  closeCashSessionSchema,
  createBankAccountSchema,
  createBankTransactionSchema,
  createCustomerInvoiceSchema,
  createExpenseSchema,
  createJournalEntrySchema,
  createPayrollRunSchema,
  createPopsCashMovementSchema,
  openCashSessionSchema,
  payPayrollSchema,
  recordPaymentSchema,
  updateTaxSettingsSchema,
} from "@platform/contracts";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { PermissionsGuard } from "../users/permissions.guard";
import { RequirePermissions } from "../users/require-permission.decorator";
import { AccountingService } from "./accounting.service";

@Controller("v1/accounting")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  @Get("dashboard")
  @RequirePermissions("pops.read")
  getDashboard(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.accounting.getDashboard(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("accounts")
  @RequirePermissions("pops.read")
  listAccounts(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.accounting.listAccounts(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("journal")
  @RequirePermissions("pops.read")
  listJournal(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.accounting.listJournal(user.organizationId, branchCode?.trim() ?? "", { from, to });
  }

  @Post("journal")
  @RequirePermissions("pops.accounting.manage", "finance.post")
  createJournal(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.accounting.createJournalEntry(
      user.organizationId,
      user.sub,
      createJournalEntrySchema.parse(body),
    );
  }

  @Get("ledger")
  @RequirePermissions("pops.read", "finance.view")
  listLedger(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("accountId") accountId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("source") source?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.accounting.listGeneralLedger(user.organizationId, branchCode?.trim() ?? "", {
      accountId: accountId?.trim() || undefined,
      from,
      to,
      source: source?.trim() || undefined,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post("journal/:entryId/reverse")
  @RequirePermissions("pops.accounting.manage", "finance.reverse")
  reverseJournal(
    @CurrentUser() user: AccessJwtPayload,
    @Param("entryId") entryId: string,
    @Body() body: unknown,
  ) {
    const reason =
      typeof (body as { reason?: string } | null)?.reason === "string"
        ? (body as { reason: string }).reason
        : "";
    return this.accounting.reverseJournal(user.organizationId, user.sub, entryId, reason);
  }

  @Get("periods")
  @RequirePermissions("pops.read", "finance.view")
  listPeriods(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.accounting.listPeriods(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("periods")
  @RequirePermissions("pops.accounting.manage", "finance.close_period")
  createPeriod(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    const input = body as { branchCode?: string; name?: string; startDate?: string; endDate?: string };
    if (!input.branchCode || !input.name || !input.startDate || !input.endDate) {
      throw new BadRequestException("branchCode, name, startDate, and endDate are required");
    }
    return this.accounting.createPeriod(user.organizationId, user.sub, {
      branchCode: input.branchCode,
      name: input.name,
      startDate: input.startDate,
      endDate: input.endDate,
    });
  }

  @Patch("periods/:periodId/close")
  @RequirePermissions("pops.accounting.manage", "finance.close_period")
  closePeriod(@CurrentUser() user: AccessJwtPayload, @Param("periodId") periodId: string) {
    return this.accounting.closePeriod(user.organizationId, user.sub, periodId);
  }

  @Patch("periods/:periodId/reopen")
  @RequirePermissions("pops.accounting.manage", "finance.reopen_period")
  reopenPeriod(
    @CurrentUser() user: AccessJwtPayload,
    @Param("periodId") periodId: string,
    @Body() body: unknown,
  ) {
    const reason =
      typeof (body as { reason?: string } | null)?.reason === "string"
        ? (body as { reason: string }).reason
        : "";
    return this.accounting.reopenPeriod(user.organizationId, user.sub, periodId, reason);
  }

  @Get("bank-reconciliation")
  @RequirePermissions("pops.read", "finance.view", "finance.reconcile")
  bankReconciliation(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("bankAccountId") bankAccountId: string,
    @Query("statementBalance") statementBalance?: string,
  ) {
    return this.accounting.getBankReconciliation(
      user.organizationId,
      branchCode?.trim() ?? "",
      bankAccountId,
      statementBalance ? Number(statementBalance) : undefined,
    );
  }

  @Patch("bank-transactions/:txnId/match")
  @RequirePermissions("pops.accounting.manage", "finance.reconcile")
  matchBankTxn(
    @CurrentUser() user: AccessJwtPayload,
    @Param("txnId") txnId: string,
    @Body() body: unknown,
  ) {
    const matched = (body as { matched?: boolean })?.matched !== false;
    const statementRef =
      typeof (body as { statementRef?: string })?.statementRef === "string"
        ? (body as { statementRef: string }).statementRef
        : undefined;
    return this.accounting.matchBankTransaction(user.organizationId, user.sub, txnId, matched, statementRef);
  }

  @Get("sales")
  @RequirePermissions("pops.read")
  getSales(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.accounting.getSalesAccounting(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("expenses")
  @RequirePermissions("pops.read")
  listExpenses(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.accounting.listExpenses(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("expenses")
  @RequirePermissions("pops.accounting.manage")
  createExpense(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.accounting.createExpense(
      user.organizationId,
      user.sub,
      createExpenseSchema.parse(body),
    );
  }

  @Patch("expenses/:expenseId/approve")
  @RequirePermissions("pops.accounting.manage")
  approveExpense(
    @CurrentUser() user: AccessJwtPayload,
    @Param("expenseId") expenseId: string,
  ) {
    return this.accounting.approveExpense(user.organizationId, user.sub, expenseId);
  }

  @Get("purchases")
  @RequirePermissions("pops.read")
  listPurchases(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.accounting.listVendorBills(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("vendors")
  @RequirePermissions("pops.read")
  listVendors(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.accounting.listVendorBills(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("payable")
  @RequirePermissions("pops.read")
  listPayable(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.accounting.listVendorBills(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("payable/:billId/payment")
  @RequirePermissions("pops.accounting.manage")
  payVendor(
    @CurrentUser() user: AccessJwtPayload,
    @Param("billId") billId: string,
    @Body() body: unknown,
  ) {
    return this.accounting.payVendorBill(
      user.organizationId,
      user.sub,
      billId,
      recordPaymentSchema.parse(body),
    );
  }

  @Get("receivable")
  @RequirePermissions("pops.read")
  listReceivable(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.accounting.listCustomerInvoices(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("customers")
  @RequirePermissions("pops.read")
  listCustomers(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.accounting.listCustomerInvoices(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("receivable")
  @RequirePermissions("pops.accounting.manage")
  createInvoice(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.accounting.createCustomerInvoice(
      user.organizationId,
      user.sub,
      createCustomerInvoiceSchema.parse(body),
    );
  }

  @Post("receivable/:invoiceId/payment")
  @RequirePermissions("pops.accounting.manage")
  payInvoice(
    @CurrentUser() user: AccessJwtPayload,
    @Param("invoiceId") invoiceId: string,
    @Body() body: unknown,
  ) {
    return this.accounting.payCustomerInvoice(
      user.organizationId,
      user.sub,
      invoiceId,
      recordPaymentSchema.parse(body),
    );
  }

  @Get("inventory")
  @RequirePermissions("pops.read")
  getInventoryAccounting(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
  ) {
    return this.accounting.getInventoryAccounting(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("cash-sessions")
  @RequirePermissions("pops.read")
  listCashSessions(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.accounting.listCashSessions(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("cash-sessions/open")
  @RequirePermissions("pops.read")
  async getOpenCashSession(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    const session = await this.accounting.getOpenCashSession(user.organizationId, branchCode?.trim() ?? "");
    if (!session) throw new NotFoundException("No open cash session");
    return session;
  }

  @Post("cash-sessions/open")
  @RequirePermissions("pops.closing.report", "pops.accounting.manage")
  openCashSession(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    const input = openCashSessionSchema.parse(body);
    return this.accounting.openCashSession(
      user.organizationId,
      user.sub,
      input.branchCode,
      input.openingFloat,
    );
  }

  @Post("cash-sessions/:sessionId/close")
  @RequirePermissions("pops.closing.report", "pops.accounting.manage")
  closeCashSession(
    @CurrentUser() user: AccessJwtPayload,
    @Param("sessionId") sessionId: string,
    @Body() body: unknown,
  ) {
    return this.accounting.closeCashSession(
      user.organizationId,
      user.sub,
      sessionId,
      closeCashSessionSchema.parse(body),
    );
  }

  @Post("cash-movements")
  @RequirePermissions("pops.read")
  recordCashMovement(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.accounting.recordCashMovement(
      user.organizationId,
      user.sub,
      createPopsCashMovementSchema.parse(body),
    );
  }

  @Get("cash-movements")
  @RequirePermissions("pops.read")
  listCashMovements(@CurrentUser() user: AccessJwtPayload, @Query("sessionId") sessionId: string) {
    return this.accounting.listCashMovements(user.organizationId, sessionId?.trim() ?? "");
  }

  @Get("bank-accounts")
  @RequirePermissions("pops.read")
  listBankAccounts(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.accounting.listBankAccounts(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("bank-accounts")
  @RequirePermissions("pops.accounting.manage")
  createBankAccount(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.accounting.createBankAccount(
      user.organizationId,
      user.sub,
      createBankAccountSchema.parse(body),
    );
  }

  @Get("bank-transactions")
  @RequirePermissions("pops.read")
  listBankTransactions(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
  ) {
    return this.accounting.listBankTransactions(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("bank-transactions")
  @RequirePermissions("pops.accounting.manage")
  createBankTransaction(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.accounting.createBankTransaction(
      user.organizationId,
      user.sub,
      createBankTransactionSchema.parse(body),
    );
  }

  @Get("tax")
  @RequirePermissions("pops.read")
  getTax(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.accounting.getTaxSettings(user.organizationId, branchCode?.trim() ?? "");
  }

  @Patch("tax")
  @RequirePermissions("pops.accounting.manage", "pops.menu.manage")
  updateTax(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.accounting.updateTaxSettings(
      user.organizationId,
      updateTaxSettingsSchema.parse(body),
    );
  }

  @Get("payroll")
  @RequirePermissions("pops.read")
  listPayroll(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.accounting.listPayroll(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("payroll")
  @RequirePermissions("pops.accounting.manage")
  createPayroll(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.accounting.createPayrollRun(
      user.organizationId,
      user.sub,
      createPayrollRunSchema.parse(body),
    );
  }

  @Patch("payroll/:payrollId/approve")
  @RequirePermissions("pops.accounting.manage")
  approvePayroll(@CurrentUser() user: AccessJwtPayload, @Param("payrollId") payrollId: string) {
    return this.accounting.approvePayroll(user.organizationId, user.sub, payrollId);
  }

  @Patch("payroll/:payrollId/pay")
  @RequirePermissions("pops.accounting.manage")
  payPayroll(
    @CurrentUser() user: AccessJwtPayload,
    @Param("payrollId") payrollId: string,
    @Body() body: unknown,
  ) {
    const input = payPayrollSchema.parse(body ?? {});
    return this.accounting.payPayroll(user.organizationId, user.sub, payrollId, input);
  }

  @Get("reports/:reportId")
  @RequirePermissions("pops.read")
  getReport(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Param("reportId") reportId: string,
  ) {
    return this.accounting.getReport(user.organizationId, branchCode?.trim() ?? "", reportId);
  }

  @Get("audit-logs")
  @RequirePermissions("pops.read")
  listAuditLogs(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.accounting.listAuditLogs(user.organizationId, branchCode?.trim() ?? "");
  }
}
