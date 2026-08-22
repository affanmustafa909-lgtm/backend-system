import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  closePharmacyShiftSchema,
  createDoctorSchema,
  createMedicineSchema,
  createPatientSchema,
  createPharmacySaleSchema,
  createPrescriptionSchema,
  openPharmacyShiftSchema,
  recordKhataPaymentSchema,
  updateMedicineSchema,
  updatePatientSchema,
} from "@platform/contracts";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AccessJwtPayload } from "../auth/jwt.types";
import { PermissionsGuard } from "../users/permissions.guard";
import { RequirePermissions } from "../users/require-permission.decorator";
import { SystemTypeGuard } from "../users/system-type.guard";
import { RequireSystemType } from "../users/require-system-type.decorator";
import { PharmacyService } from "./pharmacy.service";

@Controller("v1/pharmacy")
@UseGuards(JwtAuthGuard, PermissionsGuard, SystemTypeGuard)
@RequireSystemType("pharmacy")
export class PharmacyController {
  constructor(private readonly pharmacy: PharmacyService) {}

  @Get("dashboard")
  @RequirePermissions("pops.read")
  getDashboard(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.pharmacy.getDashboard(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("medicines")
  @RequirePermissions("pops.read")
  listMedicines(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.pharmacy.listMedicines(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("medicines/barcode/:barcode")
  @RequirePermissions("pops.read")
  lookupBarcode(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Param("barcode") barcode: string,
  ) {
    return this.pharmacy.lookupBarcode(user.organizationId, branchCode?.trim() ?? "", barcode);
  }

  @Get("medicines/match")
  @RequirePermissions("pops.read")
  matchMedicines(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("q") q: string,
  ) {
    return this.pharmacy.matchMedicines(user.organizationId, branchCode?.trim() ?? "", q?.trim() ?? "");
  }

  @Get("medicines/:medicineId/batches")
  @RequirePermissions("pops.read")
  getMedicineBatches(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Param("medicineId") medicineId: string,
  ) {
    return this.pharmacy.getMedicineBatches(user.organizationId, branchCode?.trim() ?? "", medicineId);
  }

  @Get("medicines/:medicineId/alternatives")
  @RequirePermissions("pops.read")
  findAlternatives(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Param("medicineId") medicineId: string,
  ) {
    return this.pharmacy.findAlternatives(user.organizationId, branchCode?.trim() ?? "", medicineId);
  }

  @Post("medicines")
  @RequirePermissions("pops.inventory.manage")
  createMedicine(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.pharmacy.createMedicine(user.organizationId, createMedicineSchema.parse(body));
  }

  @Patch("medicines/:medicineId")
  @RequirePermissions("pops.inventory.manage")
  updateMedicine(
    @CurrentUser() user: AccessJwtPayload,
    @Param("medicineId") medicineId: string,
    @Query("branchCode") branchCode: string,
    @Body() body: unknown,
  ) {
    return this.pharmacy.updateMedicine(
      user.organizationId,
      medicineId,
      branchCode?.trim() ?? "",
      updateMedicineSchema.parse(body),
    );
  }

  @Delete("medicines/:medicineId")
  @RequirePermissions("pops.inventory.manage")
  deleteMedicine(@CurrentUser() user: AccessJwtPayload, @Param("medicineId") medicineId: string) {
    return this.pharmacy.deleteMedicine(user.organizationId, medicineId);
  }

  @Get("batches")
  @RequirePermissions("pops.read")
  listBatches(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.pharmacy.listBatches(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("patients")
  @RequirePermissions("pops.read")
  listPatients(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.pharmacy.listPatients(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("patients")
  @RequirePermissions("pops.read")
  createPatient(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.pharmacy.createPatient(user.organizationId, createPatientSchema.parse(body));
  }

  @Patch("patients/:patientId")
  @RequirePermissions("pops.read")
  updatePatient(
    @CurrentUser() user: AccessJwtPayload,
    @Param("patientId") patientId: string,
    @Body() body: unknown,
  ) {
    return this.pharmacy.updatePatient(user.organizationId, patientId, updatePatientSchema.parse(body));
  }

  @Get("patients/:patientId/history")
  @RequirePermissions("pops.read")
  getPatientHistory(@CurrentUser() user: AccessJwtPayload, @Param("patientId") patientId: string) {
    return this.pharmacy.getPatientHistory(user.organizationId, patientId);
  }

  @Get("patients/:patientId/khata")
  @RequirePermissions("pops.read")
  getKhataStatement(@CurrentUser() user: AccessJwtPayload, @Param("patientId") patientId: string) {
    return this.pharmacy.getKhataStatement(user.organizationId, patientId);
  }

  @Post("patients/:patientId/khata-payment")
  @RequirePermissions("pops.read")
  recordKhataPayment(
    @CurrentUser() user: AccessJwtPayload,
    @Param("patientId") patientId: string,
    @Body() body: unknown,
  ) {
    return this.pharmacy.recordKhataPayment(user.organizationId, patientId, recordKhataPaymentSchema.parse(body));
  }

  @Get("doctors")
  @RequirePermissions("pops.read")
  listDoctors(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.pharmacy.listDoctors(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("doctors")
  @RequirePermissions("pops.read")
  createDoctor(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.pharmacy.createDoctor(user.organizationId, createDoctorSchema.parse(body));
  }

  @Get("prescriptions")
  @RequirePermissions("pops.read")
  listPrescriptions(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.pharmacy.listPrescriptions(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("prescriptions")
  @RequirePermissions("pops.read")
  createPrescription(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.pharmacy.createPrescription(user.organizationId, createPrescriptionSchema.parse(body));
  }

  @Patch("prescriptions/:prescriptionId/verify")
  @RequirePermissions("pops.read")
  verifyPrescription(@CurrentUser() user: AccessJwtPayload, @Param("prescriptionId") prescriptionId: string) {
    return this.pharmacy.verifyPrescription(user.organizationId, prescriptionId);
  }

  @Post("prescriptions/:prescriptionId/dispense")
  @RequirePermissions("pops.read")
  dispensePrescription(
    @CurrentUser() user: AccessJwtPayload,
    @Param("prescriptionId") prescriptionId: string,
    @Query("branchCode") branchCode: string,
  ) {
    return this.pharmacy.dispensePrescription(user.organizationId, prescriptionId, branchCode?.trim() ?? "");
  }

  @Get("sales")
  @RequirePermissions("pops.read")
  listSales(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.pharmacy.listSales(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("sales")
  @RequirePermissions("pops.read")
  createSale(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.pharmacy.createSale(user.organizationId, createPharmacySaleSchema.parse(body), user.sub);
  }

  @Get("shifts")
  @RequirePermissions("pops.read")
  listShifts(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.pharmacy.listShifts(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("shifts/open")
  @RequirePermissions("pops.read")
  getOpenShift(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.pharmacy.getOpenShift(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("shifts/open")
  @RequirePermissions("pops.read")
  openShift(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.pharmacy.openShift(user.organizationId, openPharmacyShiftSchema.parse(body));
  }

  @Post("shifts/:shiftId/close")
  @RequirePermissions("pops.read")
  closeShift(
    @CurrentUser() user: AccessJwtPayload,
    @Param("shiftId") shiftId: string,
    @Body() body: unknown,
  ) {
    return this.pharmacy.closeShift(user.organizationId, shiftId, closePharmacyShiftSchema.parse(body));
  }

  @Get("controlled-drugs")
  @RequirePermissions("pops.read")
  listControlledDrugLogs(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.pharmacy.listControlledDrugLogs(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("refill-reminders")
  @RequirePermissions("pops.read")
  listRefillReminders(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.pharmacy.listRefillReminders(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("refill-reminders/:reminderId/sent")
  @RequirePermissions("pops.read")
  markRefillReminderSent(@CurrentUser() user: AccessJwtPayload, @Param("reminderId") reminderId: string) {
    return this.pharmacy.markRefillReminderSent(user.organizationId, reminderId);
  }

  @Get("reports/purchase-statement")
  @RequirePermissions("pops.read")
  getPurchaseStatement(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.pharmacy.getPurchaseStatement(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("reports/supplier-payments")
  @RequirePermissions("pops.read")
  getSupplierPayments(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.pharmacy.getSupplierPayments(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("reports/sales-statement")
  @RequirePermissions("pops.read")
  getSalesStatement(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.pharmacy.getSalesStatement(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("reports/profit-loss")
  @RequirePermissions("pops.read")
  getProfitLoss(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.pharmacy.getProfitLoss(user.organizationId, branchCode?.trim() ?? "", from?.trim(), to?.trim());
  }

  @Get("reports/sales-of-month")
  @RequirePermissions("pops.read")
  getSalesOfMonth(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.pharmacy.getSalesOfMonth(user.organizationId, branchCode?.trim() ?? "", from?.trim(), to?.trim());
  }

  @Get("reports/expired-products")
  @RequirePermissions("pops.read")
  getExpiredProducts(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.pharmacy.getExpiredProducts(user.organizationId, branchCode?.trim() ?? "", from?.trim(), to?.trim());
  }

  @Get("reports/reorder-suggestions")
  @RequirePermissions("pops.read")
  getReorderSuggestions(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.pharmacy.listReorderSuggestions(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("prescriptions/:prescriptionId/attachment")
  @RequirePermissions("pops.read")
  getPrescriptionAttachment(
    @CurrentUser() user: AccessJwtPayload,
    @Param("prescriptionId") prescriptionId: string,
  ) {
    return this.pharmacy.getPrescriptionAttachment(user.organizationId, prescriptionId);
  }

  @Get("reports/tax-compliance")
  @RequirePermissions("pops.read")
  getTaxCompliance(
    @CurrentUser() user: AccessJwtPayload,
    @Query("branchCode") branchCode: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.pharmacy.getTaxComplianceReport(user.organizationId, branchCode?.trim() ?? "", from?.trim(), to?.trim());
  }
}
