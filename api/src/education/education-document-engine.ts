/**
 * EducationFlow document templates + {{token}} merge helpers.
 * Used by generateDocument and bootstrapDefaults.
 */

export type EducationDocTypeCode =
  | "fee_receipt"
  | "fee_challan"
  | "transfer_certificate"
  | "character_certificate"
  | "bonafide_certificate"
  | "experience_certificate"
  | "admission_letter"
  | "report_card"
  | "admit_card"
  | "student_id_card"
  | "payslip";

export type DefaultDocumentTemplate = {
  name: string;
  documentTypeCode: EducationDocTypeCode;
  bodyHtml: string;
};

const LETTER_CSS = `
@page { size: A4 portrait; margin: 14mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; color: #1e293b; font-size: 13px; line-height: 1.45; }
.sheet { border: 2px solid #0f172a; padding: 22px 26px; min-height: 240mm; position: relative; }
.letterhead { text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 18px; }
.letterhead h1 { margin: 0; font-size: 22px; letter-spacing: 0.02em; }
.letterhead .sub { color: #475569; font-size: 12px; margin-top: 4px; }
.doc-title { text-align: center; font-size: 18px; font-weight: 700; text-decoration: underline; margin: 18px 0 22px; text-transform: uppercase; }
.meta { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 16px; font-size: 12px; color: #334155; }
.body { margin: 16px 0; }
.row { margin: 6px 0; }
.label { color: #64748b; display: inline-block; min-width: 140px; }
.table { width: 100%; border-collapse: collapse; margin: 14px 0; }
.table th, .table td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; }
.table th { background: #f1f5f9; }
.signatures { display: flex; justify-content: space-between; margin-top: 48px; gap: 24px; }
.sig { text-align: center; width: 30%; }
.sig .line { border-top: 1px solid #0f172a; margin-top: 48px; padding-top: 6px; font-size: 12px; }
.footer { margin-top: 28px; font-size: 11px; color: #64748b; text-align: center; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #e0e7ff; color: #3730a3; font-size: 11px; font-weight: 600; }
.id-card { width: 86mm; height: 54mm; border: 1.5px solid #0f172a; border-radius: 8px; padding: 10px 12px; }
.id-card h2 { margin: 0 0 4px; font-size: 13px; }
.id-card .name { font-size: 16px; font-weight: 700; margin: 8px 0 4px; }
.amount { font-size: 18px; font-weight: 700; }
`;

function wrap(title: string, inner: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${title}</title><style>${LETTER_CSS}</style></head><body><div class="sheet">${inner}</div></body></html>`;
}

const letterhead = `
<div class="letterhead">
  <h1>{{institutionName}}</h1>
  <div class="sub">{{institutionAddress}}</div>
  <div class="sub">{{branchName}} · Phone: {{institutionPhone}} · {{institutionEmail}}</div>
</div>`;

export const DEFAULT_EDUCATION_DOCUMENT_TEMPLATES: DefaultDocumentTemplate[] = [
  {
    name: "Fee Receipt",
    documentTypeCode: "fee_receipt",
    bodyHtml: wrap(
      "Fee Receipt",
      `${letterhead}
      <div class="doc-title">Fee Receipt</div>
      <div class="meta"><span>Receipt #: <strong>{{receiptNumber}}</strong></span><span>Date: {{paidAt}}</span></div>
      <div class="body">
        <div class="row"><span class="label">Student</span> {{studentName}}</div>
        <div class="row"><span class="label">Student No.</span> {{studentNumber}}</div>
        <div class="row"><span class="label">Class / Section</span> {{className}} / {{sectionName}}</div>
        <div class="row"><span class="label">Invoice / Voucher</span> {{voucherNumber}}</div>
        <div class="row"><span class="label">Fee type</span> {{feeType}}</div>
        <div class="row"><span class="label">Payment method</span> {{paymentMethod}}</div>
        <div class="row"><span class="label">Amount paid</span> <span class="amount">PKR {{amountPkr}}</span></div>
        <div class="row"><span class="label">Notes</span> {{notes}}</div>
      </div>
      <div class="signatures"><div class="sig"><div class="line">Cashier</div></div><div class="sig"><div class="line">Authorized</div></div></div>
      <div class="footer">Computer-generated receipt · {{generatedAt}}</div>`,
    ),
  },
  {
    name: "Fee Challan / Invoice",
    documentTypeCode: "fee_challan",
    bodyHtml: wrap(
      "Fee Challan",
      `${letterhead}
      <div class="doc-title">Fee Challan / Invoice</div>
      <div class="meta"><span>Voucher #: <strong>{{voucherNumber}}</strong></span><span>Due: {{dueDate}}</span></div>
      <div class="body">
        <div class="row"><span class="label">Student</span> {{studentName}}</div>
        <div class="row"><span class="label">Student No.</span> {{studentNumber}}</div>
        <div class="row"><span class="label">Class / Section</span> {{className}} / {{sectionName}}</div>
        <div class="row"><span class="label">Title</span> {{invoiceTitle}}</div>
        <div class="row"><span class="label">Fee type</span> {{feeType}}</div>
        <div class="row"><span class="label">Amount</span> <span class="amount">PKR {{amountPkr}}</span></div>
        <div class="row"><span class="label">Paid</span> PKR {{paidPkr}}</div>
        <div class="row"><span class="label">Balance</span> PKR {{balancePkr}}</div>
        <div class="row"><span class="label">Status</span> <span class="badge">{{status}}</span></div>
      </div>
      <div class="signatures"><div class="sig"><div class="line">Accounts</div></div><div class="sig"><div class="line">Parent / Guardian</div></div></div>
      <div class="footer">Pay before due date · {{generatedAt}}</div>`,
    ),
  },
  {
    name: "Transfer Certificate",
    documentTypeCode: "transfer_certificate",
    bodyHtml: wrap(
      "Transfer Certificate",
      `${letterhead}
      <div class="doc-title">Transfer Certificate</div>
      <div class="meta"><span>TC No: {{documentNumber}}</span><span>Date: {{issueDate}}</span></div>
      <div class="body">
        <p>This is to certify that <strong>{{studentName}}</strong> (Student No. {{studentNumber}}),
        son/daughter of <strong>{{fatherName}}</strong>, was a bona fide student of this institution
        in <strong>{{className}}</strong> (Section {{sectionName}}) during session <strong>{{sessionName}}</strong>.</p>
        <p>He/She is leaving the institution with effect from <strong>{{effectiveDate}}</strong>.
        Reason: {{reason}}. Conduct during stay was satisfactory.</p>
        <p>We wish him/her success in future studies.</p>
      </div>
      <div class="signatures"><div class="sig"><div class="line">Class Teacher</div></div><div class="sig"><div class="line">Principal</div></div></div>
      <div class="footer">{{institutionName}} · {{generatedAt}}</div>`,
    ),
  },
  {
    name: "Character Certificate",
    documentTypeCode: "character_certificate",
    bodyHtml: wrap(
      "Character Certificate",
      `${letterhead}
      <div class="doc-title">Character Certificate</div>
      <div class="meta"><span>Ref: {{documentNumber}}</span><span>Date: {{issueDate}}</span></div>
      <div class="body">
        <p>This is to certify that <strong>{{studentName}}</strong> (Student No. {{studentNumber}}),
        son/daughter of <strong>{{fatherName}}</strong>, is/was a student of
        <strong>{{className}}</strong> at {{institutionName}}.</p>
        <p>To the best of our knowledge his/her character and conduct have been <strong>good</strong>.</p>
      </div>
      <div class="signatures"><div class="sig"><div class="line">Principal</div></div></div>
      <div class="footer">{{institutionName}} · {{generatedAt}}</div>`,
    ),
  },
  {
    name: "Bonafide Certificate",
    documentTypeCode: "bonafide_certificate",
    bodyHtml: wrap(
      "Bonafide Certificate",
      `${letterhead}
      <div class="doc-title">Bonafide Certificate</div>
      <div class="meta"><span>Ref: {{documentNumber}}</span><span>Date: {{issueDate}}</span></div>
      <div class="body">
        <p>This is to certify that <strong>{{studentName}}</strong> (Student No. {{studentNumber}}),
        son/daughter of <strong>{{fatherName}}</strong>, is a bona fide student of
        <strong>{{institutionName}}</strong> studying in <strong>{{className}}</strong>
        (Section {{sectionName}}) for the academic session <strong>{{sessionName}}</strong>.</p>
        <p>This certificate is issued on request for {{purpose}}.</p>
      </div>
      <div class="signatures"><div class="sig"><div class="line">Principal / Admin</div></div></div>
      <div class="footer">{{institutionName}} · {{generatedAt}}</div>`,
    ),
  },
  {
    name: "Experience Certificate",
    documentTypeCode: "experience_certificate",
    bodyHtml: wrap(
      "Experience Certificate",
      `${letterhead}
      <div class="doc-title">Experience Certificate</div>
      <div class="meta"><span>Ref: {{documentNumber}}</span><span>Date: {{issueDate}}</span></div>
      <div class="body">
        <p>This is to certify that <strong>{{personName}}</strong> (Employee No. {{employeeNumber}})
        worked at {{institutionName}} as <strong>{{designation}}</strong>
        from <strong>{{joiningDate}}</strong> to <strong>{{leavingDate}}</strong>.</p>
        <p>During this period his/her performance and conduct were satisfactory.</p>
      </div>
      <div class="signatures"><div class="sig"><div class="line">HR / Admin</div></div><div class="sig"><div class="line">Principal</div></div></div>
      <div class="footer">{{institutionName}} · {{generatedAt}}</div>`,
    ),
  },
  {
    name: "Admission Offer Letter",
    documentTypeCode: "admission_letter",
    bodyHtml: wrap(
      "Admission Letter",
      `${letterhead}
      <div class="doc-title">Admission Offer / Acknowledgment</div>
      <div class="meta"><span>Application #: {{applicationNumber}}</span><span>Date: {{issueDate}}</span></div>
      <div class="body">
        <p>Dear <strong>{{applicantName}}</strong>,</p>
        <p>We are pleased to acknowledge your admission application
        (Father/Guardian: {{fatherName}}, Phone: {{phone}}) for
        <strong>{{className}}</strong> for session <strong>{{sessionName}}</strong>.</p>
        <p>Status: <span class="badge">{{status}}</span>. {{notes}}</p>
        <p>Please complete fee payment and document submission as advised by the admissions office.</p>
      </div>
      <div class="signatures"><div class="sig"><div class="line">Admissions Office</div></div></div>
      <div class="footer">{{institutionName}} · {{generatedAt}}</div>`,
    ),
  },
  {
    name: "Report Card / Marksheet",
    documentTypeCode: "report_card",
    bodyHtml: wrap(
      "Report Card",
      `${letterhead}
      <div class="doc-title">Report Card / Marksheet</div>
      <div class="meta"><span>Exam: {{examName}}</span><span>Session: {{sessionName}}</span></div>
      <div class="body">
        <div class="row"><span class="label">Student</span> {{studentName}}</div>
        <div class="row"><span class="label">Student No.</span> {{studentNumber}}</div>
        <div class="row"><span class="label">Class / Section</span> {{className}} / {{sectionName}}</div>
        {{marksTableHtml}}
        <div class="row"><span class="label">Total</span> {{totalObtained}} / {{totalMarks}}</div>
        <div class="row"><span class="label">Percentage</span> {{percentage}}%</div>
        <div class="row"><span class="label">Grade</span> {{grade}}</div>
        <div class="row"><span class="label">Result</span> <span class="badge">{{passFail}}</span></div>
      </div>
      <div class="signatures"><div class="sig"><div class="line">Class Teacher</div></div><div class="sig"><div class="line">Principal</div></div></div>
      <div class="footer">{{institutionName}} · {{generatedAt}}</div>`,
    ),
  },
  {
    name: "Exam Admit Card",
    documentTypeCode: "admit_card",
    bodyHtml: wrap(
      "Admit Card",
      `${letterhead}
      <div class="doc-title">Admit Card</div>
      <div class="meta"><span>Exam: {{examName}}</span><span>{{examType}}</span></div>
      <div class="body">
        <div class="row"><span class="label">Student</span> {{studentName}}</div>
        <div class="row"><span class="label">Student No.</span> {{studentNumber}}</div>
        <div class="row"><span class="label">Class / Section</span> {{className}} / {{sectionName}}</div>
        <div class="row"><span class="label">Exam dates</span> {{startDate}} — {{endDate}}</div>
        <p>Instructions: Bring this admit card and a valid ID. Electronic devices are not allowed.</p>
      </div>
      <div class="signatures"><div class="sig"><div class="line">Controller of Exams</div></div></div>
      <div class="footer">{{institutionName}} · {{generatedAt}}</div>`,
    ),
  },
  {
    name: "Student ID Card",
    documentTypeCode: "student_id_card",
    bodyHtml: `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Student ID</title><style>${LETTER_CSS}</style></head><body>
      <div class="id-card">
        <h2>{{institutionName}}</h2>
        <div style="font-size:11px;color:#64748b">{{branchName}} · Student ID</div>
        <div class="name">{{studentName}}</div>
        <div style="font-size:12px">No: {{studentNumber}}</div>
        <div style="font-size:12px">{{className}} · {{sectionName}}</div>
        <div style="font-size:11px;margin-top:8px;color:#64748b">Session {{sessionName}}</div>
      </div>
    </body></html>`,
  },
  {
    name: "Payslip",
    documentTypeCode: "payslip",
    bodyHtml: wrap(
      "Payslip",
      `${letterhead}
      <div class="doc-title">Payslip</div>
      <div class="meta"><span>Period: {{periodLabel}}</span><span>Status: {{status}}</span></div>
      <div class="body">
        <div class="row"><span class="label">Employee</span> {{personName}}</div>
        <div class="row"><span class="label">Type</span> {{personType}}</div>
        <div class="row"><span class="label">Basic</span> PKR {{basicPkr}}</div>
        <div class="row"><span class="label">Allowances</span> PKR {{allowancesPkr}}</div>
        <div class="row"><span class="label">Deductions</span> PKR {{deductionsPkr}}</div>
        <div class="row"><span class="label">Net pay</span> <span class="amount">PKR {{netPkr}}</span></div>
      </div>
      <div class="signatures"><div class="sig"><div class="line">Accounts</div></div><div class="sig"><div class="line">Employee</div></div></div>
      <div class="footer">{{institutionName}} · {{generatedAt}}</div>`,
    ),
  },
];

/** Replace {{token}} placeholders. Unknown tokens become empty string. HTML values may be passed unescaped via keys ending in Html. */
export function mergeEducationTemplate(
  templateHtml: string,
  tokens: Record<string, string | number | null | undefined>,
): string {
  const map: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens)) {
    if (value == null) {
      map[key] = "";
      continue;
    }
    const raw = String(value);
    map[key] = key.toLowerCase().endsWith("html") ? raw : escapeHtml(raw);
  }
  return templateHtml.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => map[key] ?? "");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function parsePayloadJson(payloadJson?: string | null): Record<string, string | number | null | undefined> {
  if (!payloadJson?.trim()) return {};
  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string | number | null | undefined> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v == null || typeof v === "string" || typeof v === "number") out[k] = v as string | number | null;
      else out[k] = String(v);
    }
    return out;
  } catch {
    return {};
  }
}
