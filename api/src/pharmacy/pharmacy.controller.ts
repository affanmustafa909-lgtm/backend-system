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
@RequireSystemType("pharmacy", "distribution")
export class PharmacyController {
  constructor(private readonly pharmacy: PharmacyService) {}

  @Get("dashboard")
  @RequireSystemType("pharmacy")
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
  @RequireSystemType("pharmacy")
  @RequirePermissions("pops.read")
  listPatients(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.pharmacy.listPatients(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("patients")
  @RequireSystemType("pharmacy")
  @RequirePermissions("pops.read")
  createPatient(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.pharmacy.createPatient(user.organizationId, createPatientSchema.parse(body));
  }

  @Patch("patients/:patientId")
  @RequireSystemType("pharmacy")
  @RequirePermissions("pops.read")
  updatePatient(
    @CurrentUser() user: AccessJwtPayload,
    @Param("patientId") patientId: string,
    @Body() body: unknown,
  ) {
    return this.pharmacy.updatePatient(user.organizationId, patientId, updatePatientSchema.parse(body));
  }

  @Get("patients/:patientId/history")
  @RequireSystemType("pharmacy")
  @RequirePermissions("pops.read")
  getPatientHistory(@CurrentUser() user: AccessJwtPayload, @Param("patientId") patientId: string) {
    return this.pharmacy.getPatientHistory(user.organizationId, patientId);
  }

  @Get("patients/:patientId/khata")
  @RequireSystemType("pharmacy")
  @RequirePermissions("pops.read")
  getKhataStatement(@CurrentUser() user: AccessJwtPayload, @Param("patientId") patientId: string) {
    return this.pharmacy.getKhataStatement(user.organizationId, patientId);
  }

  @Post("patients/:patientId/khata-payment")
  @RequireSystemType("pharmacy")
  @RequirePermissions("pops.read")
  recordKhataPayment(
    @CurrentUser() user: AccessJwtPayload,
    @Param("patientId") patientId: string,
    @Body() body: unknown,
  ) {
    return this.pharmacy.recordKhataPayment(user.organizationId, patientId, recordKhataPaymentSchema.parse(body));
  }

  @Get("doctors")
  @RequireSystemType("pharmacy")
  @RequirePermissions("pops.read")
  listDoctors(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.pharmacy.listDoctors(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("doctors")
  @RequireSystemType("pharmacy")
  @RequirePermissions("pops.read")
  createDoctor(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.pharmacy.createDoctor(user.organizationId, createDoctorSchema.parse(body));
  }

  @Get("doctors/:doctorId/recommendations")
  @RequireSystemType("pharmacy")
  @RequirePermissions("pops.read")
  listDoctorRecommendations(@CurrentUser() user: AccessJwtPayload, @Param("doctorId") doctorId: string) {
    return this.pharmacy.listDoctorRecommendations(user.organizationId, doctorId);
  }

  @Post("doctors/:doctorId/recommendations")
  @RequireSystemType("pharmacy")
  @RequirePermissions("pops.read")
  addDoctorRecommendation(
    @CurrentUser() user: AccessJwtPayload,
    @Param("doctorId") doctorId: string,
    @Body() body: { medicineId: string; priority?: number; notes?: string },
  ) {
    return this.pharmacy.addDoctorRecommendation(user.organizationId, doctorId, body);
  }

  @Delete("doctors/recommendations/:recommendationId")
  @RequireSystemType("pharmacy")
  @RequirePermissions("pops.read")
  removeDoctorRecommendation(
    @CurrentUser() user: AccessJwtPayload,
    @Param("recommendationId") recommendationId: string,
  ) {
    return this.pharmacy.removeDoctorRecommendation(user.organizationId, recommendationId);
  }

  @Get("doctors/:doctorId/commission-rules")
  @RequireSystemType("pharmacy")
  @RequirePermissions("pops.read")
  listDoctorCommissionRules(@CurrentUser() user: AccessJwtPayload, @Param("doctorId") doctorId: string) {
    return this.pharmacy.listDoctorCommissionRules(user.organizationId, doctorId);
  }

  @Post("doctors/:doctorId/commission-rules")
  @RequireSystemType("pharmacy")
  @RequirePermissions("pops.read")
  upsertDoctorCommissionRule(
    @CurrentUser() user: AccessJwtPayload,
    @Param("doctorId") doctorId: string,
    @Body()
    body: {
      medicineId?: string;
      companyId?: string;
      ruleType?: "percent" | "fixed";
      rateValue: number;
      notes?: string;
    },
  ) {
    return this.pharmacy.upsertDoctorCommissionRule(user.organizationId, doctorId, body);
  }

  @Get("doctors/:doctorId/commission-entries")
  @RequireSystemType("pharmacy")
  @RequirePermissions("pops.read")
  listDoctorCommissionEntries(@CurrentUser() user: AccessJwtPayload, @Param("doctorId") doctorId: string) {
    return this.pharmacy.listDoctorCommissionEntries(user.organizationId, doctorId);
  }

  @Post("doctors/commission-entries/mark-paid")
  @RequireSystemType("pharmacy")
  @RequirePermissions("pops.read")
  markDoctorCommissionPaid(@CurrentUser() user: AccessJwtPayload, @Body() body: { entryIds: string[] }) {
    return this.pharmacy.markDoctorCommissionPaid(user.organizationId, body.entryIds ?? []);
  }

  @Get("prescriptions")
  @RequireSystemType("pharmacy")
  @RequirePermissions("pops.read")
  listPrescriptions(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.pharmacy.listPrescriptions(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("prescriptions")
  @RequireSystemType("pharmacy")
  @RequirePermissions("pops.read")
  createPrescription(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.pharmacy.createPrescription(user.organizationId, createPrescriptionSchema.parse(body));
  }

  @Patch("prescriptions/:prescriptionId/verify")
  @RequireSystemType("pharmacy")
  @RequirePermissions("pops.read")
  verifyPrescription(@CurrentUser() user: AccessJwtPayload, @Param("prescriptionId") prescriptionId: string) {
    return this.pharmacy.verifyPrescription(user.organizationId, prescriptionId);
  }

  @Post("prescriptions/:prescriptionId/dispense")
  @RequireSystemType("pharmacy")
  @RequirePermissions("pops.read")
  dispensePrescription(
    @CurrentUser() user: AccessJwtPayload,
    @Param("prescriptionId") prescriptionId: string,
    @Query("branchCode") branchCode: string,
  ) {
    return this.pharmacy.dispensePrescription(user.organizationId, prescriptionId, branchCode?.trim() ?? "");
  }

  @Get("sales")
  @RequireSystemType("pharmacy")
  @RequirePermissions("pops.read")
  listSales(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.pharmacy.listSales(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("sales")
  @RequireSystemType("pharmacy")
  @RequirePermissions("pops.read")
  createSale(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.pharmacy.createSale(user.organizationId, createPharmacySaleSchema.parse(body), user.sub);
  }

  @Get("shifts")
  @RequireSystemType("pharmacy")
  @RequirePermissions("pops.read")
  listShifts(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.pharmacy.listShifts(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("shifts/open")
  @RequireSystemType("pharmacy")
  @RequirePermissions("pops.read")
  getOpenShift(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.pharmacy.getOpenShift(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("shifts/open")
  @RequireSystemType("pharmacy")
  @RequirePermissions("pops.read")
  openShift(@CurrentUser() user: AccessJwtPayload, @Body() body: unknown) {
    return this.pharmacy.openShift(user.organizationId, openPharmacyShiftSchema.parse(body));
  }

  @Post("shifts/:shiftId/close")
  @RequireSystemType("pharmacy")
  @RequirePermissions("pops.read")
  closeShift(
    @CurrentUser() user: AccessJwtPayload,
    @Param("shiftId") shiftId: string,
    @Body() body: unknown,
  ) {
    return this.pharmacy.closeShift(user.organizationId, shiftId, closePharmacyShiftSchema.parse(body));
  }

  @Get("controlled-drugs")
  @RequireSystemType("pharmacy")
  @RequirePermissions("pops.read")
  listControlledDrugLogs(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.pharmacy.listControlledDrugLogs(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("refill-reminders")
  @RequireSystemType("pharmacy")
  @RequirePermissions("pops.read")
  listRefillReminders(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.pharmacy.listRefillReminders(user.organizationId, branchCode?.trim() ?? "");
  }

  @Post("refill-reminders/:reminderId/sent")
  @RequireSystemType("pharmacy")
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
  @RequireSystemType("pharmacy")
  @RequirePermissions("pops.read")
  getSalesStatement(@CurrentUser() user: AccessJwtPayload, @Query("branchCode") branchCode: string) {
    return this.pharmacy.getSalesStatement(user.organizationId, branchCode?.trim() ?? "");
  }

  @Get("reports/profit-loss")
  @RequireSystemType("pharmacy")
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
  @RequireSystemType("pharmacy")
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
  @RequireSystemType("pharmacy")
  @RequirePermissions("pops.read")
  getPrescriptionAttachment(
    @CurrentUser() user: AccessJwtPayload,
    @Param("prescriptionId") prescriptionId: string,
  ) {
    return this.pharmacy.getPrescriptionAttachment(user.organizationId, prescriptionId);
  }

  @Get("reports/tax-compliance")
  @RequireSystemType("pharmacy")
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
