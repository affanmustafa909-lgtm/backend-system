/**
 * EducationFlow — full school campus seed (~1000 students + lifecycle).
 *
 * Creates: session, classes/sections, subjects, teachers, staff, guardians,
 * students, admissions, fee structures/invoices/payments, attendance,
 * exams/marks, enquiries, notices, rooms, library, transport, leave samples.
 *
 * Idempotent: tops up to TARGET_STUDENTS for the chosen branch.
 *
 * Usage:
 *   node scripts/seed-education-school-campus.mjs
 *   node scripts/seed-education-school-campus.mjs --students=1000 --branch=EDU-HQ
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadEnv() {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  }),
);
const TARGET_STUDENTS = Math.max(50, Number(args.students || process.env.SEED_STUDENTS || 1000));
const BRANCH_CODE = String(args.branch || process.env.SEED_BRANCH || "MAIN");

const require = createRequire(join(root, "packages/database-pg/package.json"));
const pg = require("pg");

const FIRST = [
  "Ahmed", "Ali", "Hassan", "Hussain", "Bilal", "Usman", "Hamza", "Zain", "Omar", "Ibrahim",
  "Fatima", "Ayesha", "Maryam", "Zainab", "Sana", "Hira", "Noor", "Iqra", "Laiba", "Amina",
  "Sara", "Maham", "Esha", "Rida", "Kinza", "Daniyal", "Arham", "Rayyan", "Yusuf", "Suleman",
];
const LAST = [
  "Khan", "Ahmed", "Ali", "Hussain", "Malik", "Sheikh", "Raza", "Iqbal", "Butt", "Chaudhry",
  "Syed", "Mirza", "Qureshi", "Ansari", "Hashmi", "Farooq", "Nawaz", "Rehman", "Akhtar", "Baig",
];
const FATHER = ["Muhammad", "Abdul", "Ghulam", "Shahid", "Nadeem", "Tariq", "Imran", "Asif", "Javed", "Rashid"];

const GRADES = [
  { name: "Nursery", code: "NUR", level: "0" },
  { name: "Prep", code: "PREP", level: "0" },
  { name: "Class 1", code: "C1", level: "1" },
  { name: "Class 2", code: "C2", level: "2" },
  { name: "Class 3", code: "C3", level: "3" },
  { name: "Class 4", code: "C4", level: "4" },
  { name: "Class 5", code: "C5", level: "5" },
  { name: "Class 6", code: "C6", level: "6" },
  { name: "Class 7", code: "C7", level: "7" },
  { name: "Class 8", code: "C8", level: "8" },
  { name: "Class 9", code: "C9", level: "9" },
  { name: "Class 10", code: "C10", level: "10" },
];
const SECTIONS = ["A", "B", "C"];
const SUBJECTS = [
  { name: "English", code: "ENG" },
  { name: "Urdu", code: "URD" },
  { name: "Mathematics", code: "MATH" },
  { name: "Science", code: "SCI" },
  { name: "Islamiat", code: "ISL" },
  { name: "Pakistan Studies", code: "PST" },
  { name: "Computer", code: "CS" },
  { name: "Arts", code: "ART" },
];

function pick(arr, i) {
  return arr[i % arr.length];
}
function phone(i) {
  return `03${String(100000000 + (i % 899999999)).slice(0, 9)}`;
}
function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function pad(n, w = 4) {
  return String(n).padStart(w, "0");
}

async function upsertReturning(client, selectSql, selectParams, insertSql, insertParams) {
  const existing = await client.query(selectSql, selectParams);
  if (existing.rows[0]) return existing.rows[0];
  const inserted = await client.query(insertSql, insertParams);
  return inserted.rows[0];
}

async function main() {
  console.log(`[campus-seed] target=${TARGET_STUDENTS} branch=${BRANCH_CODE}`);
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const orgRes = await client.query(
      `SELECT id, name FROM organizations
       WHERE licence_key = 'LIC-DEMO-EDUCATION'
          OR (system_type = 'education' AND name ILIKE '%EducationFlow%')
       ORDER BY created_at ASC LIMIT 1`,
    );
    if (!orgRes.rows[0]) throw new Error("EducationFlow org not found");
    const orgId = orgRes.rows[0].id;
    console.log("[campus-seed] org", orgRes.rows[0].name, orgId);

    let branch = (
      await client.query(
        `SELECT id, code, name FROM pops_branches WHERE organization_id = $1 AND code = $2 LIMIT 1`,
        [orgId, BRANCH_CODE],
      )
    ).rows[0];
    if (!branch) {
      branch = (
        await client.query(
          `INSERT INTO pops_branches (organization_id, code, name, city)
           VALUES ($1, $2, 'Main Campus', 'Lahore') RETURNING id, code, name`,
          [orgId, BRANCH_CODE],
        )
      ).rows[0];
      console.log("[campus-seed] created branch", branch.code);
    }
    const branchId = branch.id;

    // Institution settings
    await client.query(
      `INSERT INTO education_settings (organization_id, branch_id, key, value_json)
       SELECT $1, $2, 'institution_type', '"school"'
       WHERE NOT EXISTS (
         SELECT 1 FROM education_settings
         WHERE organization_id = $1 AND key = 'institution_type'
           AND (($2::uuid IS NULL AND branch_id IS NULL) OR branch_id = $2)
       )`,
      [orgId, branchId],
    );
    await client.query(
      `INSERT INTO education_settings (organization_id, branch_id, key, value_json)
       SELECT $1, $2, 'campus_seed_tag', '"school-1000"'
       WHERE NOT EXISTS (
         SELECT 1 FROM education_settings
         WHERE organization_id = $1 AND key = 'campus_seed_tag' AND branch_id = $2
       )`,
      [orgId, branchId],
    );

    const year = new Date().getFullYear();
    const session = await upsertReturning(
      client,
      `SELECT id, name, code FROM education_academic_sessions
       WHERE organization_id = $1 AND branch_id = $2 AND code = $3 LIMIT 1`,
      [orgId, branchId, `AY-${year}`],
      `INSERT INTO education_academic_sessions
        (organization_id, branch_id, name, code, start_date, end_date, is_current, status)
       VALUES ($1, $2, $3, $4, $5, $6, true, 'active') RETURNING id, name, code`,
      [orgId, branchId, `Academic Year ${year}-${year + 1}`, `AY-${year}`, `${year}-04-01`, `${year + 1}-03-31`],
    );
    await client.query(
      `UPDATE education_academic_sessions SET is_current = (id = $1)
       WHERE organization_id = $2 AND branch_id = $3`,
      [session.id, orgId, branchId],
    );
    console.log("[campus-seed] session", session.code);

    // Classes + sections
    const classMap = new Map(); // code -> {id, name}
    const sectionList = []; // {id, classId, classCode, sectionCode, name}
    for (let gi = 0; gi < GRADES.length; gi++) {
      const g = GRADES[gi];
      const cls = await upsertReturning(
        client,
        `SELECT id, name, code FROM education_classes
         WHERE organization_id = $1 AND branch_id = $2 AND code = $3 LIMIT 1`,
        [orgId, branchId, g.code],
        `INSERT INTO education_classes
          (organization_id, branch_id, session_id, name, code, level, sort_order, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active') RETURNING id, name, code`,
        [orgId, branchId, session.id, g.name, g.code, g.level, gi + 1],
      );
      classMap.set(g.code, cls);
      for (const sec of SECTIONS) {
        const section = await upsertReturning(
          client,
          `SELECT id, name, code, class_id AS "classId" FROM education_sections
           WHERE organization_id = $1 AND branch_id = $2 AND class_id = $3 AND code = $4 LIMIT 1`,
          [orgId, branchId, cls.id, sec],
          `INSERT INTO education_sections
            (organization_id, branch_id, class_id, name, code, capacity, status)
           VALUES ($1, $2, $3, $4, $5, 40, 'active') RETURNING id, name, code, class_id AS "classId"`,
          [orgId, branchId, cls.id, sec, sec],
        );
        sectionList.push({
          id: section.id,
          classId: cls.id,
          classCode: g.code,
          className: g.name,
          sectionCode: sec,
        });
      }
    }
    console.log("[campus-seed] classes", classMap.size, "sections", sectionList.length);

    // Subjects
    const subjectIds = [];
    for (const s of SUBJECTS) {
      const row = await upsertReturning(
        client,
        `SELECT id FROM education_subjects WHERE organization_id = $1 AND branch_id = $2 AND code = $3 LIMIT 1`,
        [orgId, branchId, s.code],
        `INSERT INTO education_subjects (organization_id, branch_id, name, code, credit_hours, status)
         VALUES ($1, $2, $3, $4, 3, 'active') RETURNING id`,
        [orgId, branchId, s.name, s.code],
      );
      subjectIds.push(row.id);
    }

    // Teachers (40) + staff (15)
    const teacherCount = (
      await client.query(
        `SELECT count(*)::int n FROM education_teachers
         WHERE organization_id = $1 AND branch_id = $2 AND deleted_at IS NULL`,
        [orgId, branchId],
      )
    ).rows[0].n;
    const teachersToAdd = Math.max(0, 40 - teacherCount);
    for (let i = 0; i < teachersToAdd; i++) {
      const n = teacherCount + i + 1;
      await client.query(
        `INSERT INTO education_teachers
          (organization_id, branch_id, employee_number, first_name, last_name, phone, email,
           designation, employment_type_code, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'full_time', 'active')`,
        [
          orgId,
          branchId,
          `TCH-${year}-${pad(n)}`,
          pick(FIRST, n + 3),
          pick(LAST, n + 7),
          phone(9000 + n),
          `teacher${n}@educationflow.demo`,
          n % 5 === 0 ? "Head Teacher" : "Teacher",
        ],
      );
    }
    const staffCount = (
      await client.query(
        `SELECT count(*)::int n FROM education_staff
         WHERE organization_id = $1 AND branch_id = $2 AND deleted_at IS NULL`,
        [orgId, branchId],
      )
    ).rows[0].n;
    for (let i = 0; i < Math.max(0, 15 - staffCount); i++) {
      const n = staffCount + i + 1;
      await client.query(
        `INSERT INTO education_staff
          (organization_id, branch_id, employee_number, first_name, last_name, phone, email,
           designation, staff_category_code, employment_type_code, salary_pkr, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'full_time', $10, 'active')`,
        [
          orgId,
          branchId,
          `STF-${year}-${pad(n)}`,
          pick(FIRST, n + 11),
          pick(LAST, n + 13),
          phone(8000 + n),
          `staff${n}@educationflow.demo`,
          pick(["Clerk", "Accountant", "Librarian", "Receptionist", "Peon"], n),
          pick(["admin", "accounts", "support"], n),
          35000 + (n % 10) * 2000,
        ],
      );
    }
    console.log("[campus-seed] teachers/staff topped up");

    // Fee structures per class
    for (const [code, cls] of classMap) {
      const amount = 3000 + Number(cls.level || 0) * 500;
      await upsertReturning(
        client,
        `SELECT id FROM education_fee_structures
         WHERE organization_id = $1 AND branch_id = $2 AND class_id = $3 AND fee_type_code = 'tuition' LIMIT 1`,
        [orgId, branchId, cls.id],
        `INSERT INTO education_fee_structures
          (organization_id, branch_id, name, fee_type_code, amount_pkr, frequency, class_id, session_id, status)
         VALUES ($1, $2, $3, 'tuition', $4, 'monthly', $5, $6, 'active') RETURNING id`,
        [orgId, branchId, `${cls.name} Tuition`, amount, cls.id, session.id],
      );
      await upsertReturning(
        client,
        `SELECT id FROM education_fee_structures
         WHERE organization_id = $1 AND branch_id = $2 AND class_id = $3 AND fee_type_code = 'admission' LIMIT 1`,
        [orgId, branchId, cls.id],
        `INSERT INTO education_fee_structures
          (organization_id, branch_id, name, fee_type_code, amount_pkr, frequency, class_id, session_id, status)
         VALUES ($1, $2, $3, 'admission', $4, 'one_time', $5, $6, 'active') RETURNING id`,
        [orgId, branchId, `${cls.name} Admission Fee`, 5000 + Number(cls.level || 0) * 500, cls.id, session.id],
      );
    }

    // Rooms / periods / books / vehicles / notices / enquiries (campus services)
    for (let r = 1; r <= 12; r++) {
      await upsertReturning(
        client,
        `SELECT id FROM education_rooms WHERE organization_id = $1 AND branch_id = $2 AND code = $3 LIMIT 1`,
        [orgId, branchId, `R${100 + r}`],
        `INSERT INTO education_rooms
          (organization_id, branch_id, code, name, capacity, room_type_code, status)
         VALUES ($1, $2, $3, $4, 40, 'classroom', 'active') RETURNING id`,
        [orgId, branchId, `R${100 + r}`, `Room ${100 + r}`],
      );
    }
    for (const [i, p] of [
      ["Period 1", "08:00", "08:45"],
      ["Period 2", "08:50", "09:35"],
      ["Period 3", "09:40", "10:25"],
      ["Period 4", "10:40", "11:25"],
      ["Period 5", "11:30", "12:15"],
      ["Period 6", "12:20", "13:05"],
    ].entries()) {
      await upsertReturning(
        client,
        `SELECT id FROM education_periods WHERE organization_id = $1 AND branch_id = $2 AND name = $3 LIMIT 1`,
        [orgId, branchId, p[0]],
        `INSERT INTO education_periods
          (organization_id, branch_id, name, start_time, end_time, sort_order, is_break, status)
         VALUES ($1, $2, $3, $4, $5, $6, false, 'active') RETURNING id`,
        [orgId, branchId, p[0], p[1], p[2], i + 1],
      );
    }
    for (const title of ["English Grammar", "Urdu Reader", "Math Practice", "Science Lab Manual", "Islamiyat"]) {
      await upsertReturning(
        client,
        `SELECT id FROM education_books WHERE organization_id = $1 AND branch_id = $2 AND title = $3 LIMIT 1`,
        [orgId, branchId, title],
        `INSERT INTO education_books
          (organization_id, branch_id, title, author, category_code, copies_total, copies_available, status)
         VALUES ($1, $2, $3, 'Campus Press', 'textbook', 40, 35, 'active') RETURNING id`,
        [orgId, branchId, title],
      );
    }
    for (let v = 1; v <= 3; v++) {
      await upsertReturning(
        client,
        `SELECT id FROM education_vehicles WHERE organization_id = $1 AND branch_id = $2 AND code = $3 LIMIT 1`,
        [orgId, branchId, `BUS-${v}`],
        `INSERT INTO education_vehicles
          (organization_id, branch_id, code, registration, vehicle_type_code, capacity, driver_name, status)
         VALUES ($1, $2, $3, $4, 'bus', 40, $5, 'active') RETURNING id`,
        [orgId, branchId, `BUS-${v}`, `LE-${1000 + v}`, `Driver ${v}`],
      );
    }
    await upsertReturning(
      client,
      `SELECT id FROM education_notices WHERE organization_id = $1 AND branch_id = $2 AND title = $3 LIMIT 1`,
      [orgId, branchId, "Welcome to the new academic year"],
      `INSERT INTO education_notices
        (organization_id, branch_id, title, body, category_code, audience_code, status, publish_at)
       VALUES ($1, $2, $3, $4, 'general', 'all', 'published', $5) RETURNING id`,
      [
        orgId,
        branchId,
        "Welcome to the new academic year",
        "Parents are requested to complete fee challans by the 10th of each month. PTM schedule will be shared soon.",
        isoDaysAgo(2),
      ],
    );

    // Current student count (campus seed students tagged via admission_number prefix CFS-)
    const existingStudents = (
      await client.query(
        `SELECT count(*)::int n FROM education_students
         WHERE organization_id = $1 AND branch_id = $2 AND deleted_at IS NULL
           AND admission_number LIKE 'CFS-%'`,
        [orgId, branchId],
      )
    ).rows[0].n;
    const toCreate = Math.max(0, TARGET_STUDENTS - existingStudents);
    console.log(`[campus-seed] students existing=${existingStudents} creating=${toCreate}`);

    const feeByClass = new Map(
      (
        await client.query(
          `SELECT class_id AS "classId", amount_pkr AS "amountPkr", fee_type_code AS "feeType"
           FROM education_fee_structures
           WHERE organization_id = $1 AND branch_id = $2 AND fee_type_code = 'tuition'`,
          [orgId, branchId],
        )
      ).rows.map((r) => [r.classId, r.amountPkr]),
    );

    const BATCH = 50;
    let createdStudents = 0;
    let createdInvoices = 0;
    let createdPayments = 0;
    let createdGuardians = 0;
    let createdAdmissions = 0;
    let createdAttendance = 0;

    for (let offset = 0; offset < toCreate; offset += BATCH) {
      const size = Math.min(BATCH, toCreate - offset);
      const studentRows = [];
      const guardianRows = [];
      const linkRows = [];
      const admissionRows = [];
      const invoiceRows = [];
      const paymentRows = [];
      const attendanceRows = [];

      for (let j = 0; j < size; j++) {
        const idx = existingStudents + offset + j + 1;
        const section = sectionList[(idx - 1) % sectionList.length];
        const studentId = randomUUID();
        const guardianId = randomUUID();
        const first = pick(FIRST, idx);
        const last = pick(LAST, idx * 3);
        const father = `${pick(FATHER, idx)} ${pick(LAST, idx + 5)}`;
        const gender = idx % 2 === 0 ? "female" : "male";
        const studentNumber = `STU-${year}-${pad(idx, 5)}`;
        const admissionNumber = `CFS-${year}-${pad(idx, 5)}`;
        const status = idx % 47 === 0 ? "inactive" : "active";

        studentRows.push({
          id: studentId,
          studentNumber,
          admissionNumber,
          first,
          last,
          father,
          gender,
          phone: phone(idx),
          email: `student${idx}@educationflow.demo`,
          classId: section.classId,
          sectionId: section.id,
          status,
          dob: `${2014 - Math.min(10, Number(section.classCode.replace(/\D/g, "") || 0))}-${pad((idx % 12) + 1, 2)}-${pad((idx % 28) + 1, 2)}`,
        });

        guardianRows.push({
          id: guardianId,
          name: father,
          phone: phone(50000 + idx),
          email: `parent${idx}@educationflow.demo`,
        });
        linkRows.push({ studentId, guardianId });

        // Admission record (enrolled)
        admissionRows.push({
          id: randomUUID(),
          appNo: `ADM-${year}-${pad(idx, 5)}`,
          name: `${first} ${last}`,
          father,
          phone: phone(idx),
          classId: section.classId,
          status: "enrolled",
        });

        // Pending applications (~5%)
        if (idx % 20 === 0) {
          admissionRows.push({
            id: randomUUID(),
            appNo: `ADM-P-${year}-${pad(idx, 5)}`,
            name: `${pick(FIRST, idx + 9)} ${pick(LAST, idx + 2)}`,
            father: `${pick(FATHER, idx + 2)} ${pick(LAST, idx + 8)}`,
            phone: phone(70000 + idx),
            classId: section.classId,
            status: "application",
          });
        }

        const tuition = feeByClass.get(section.classId) || 5000;
        const invoiceId = randomUUID();
        const paidFull = idx % 3 !== 0;
        const paidPkr = paidFull ? tuition : Math.floor(tuition * 0.5);
        const invStatus = paidFull ? "paid" : "partial";
        invoiceRows.push({
          id: invoiceId,
          studentId,
          voucher: `FEE-${year}-${pad(idx, 5)}`,
          title: `Tuition ${isoDaysAgo(10).slice(0, 7)}`,
          amount: tuition,
          paid: paidPkr,
          status: invStatus,
        });
        createdInvoices += 1;

        if (paidPkr > 0) {
          paymentRows.push({
            id: randomUUID(),
            invoiceId,
            studentId,
            receipt: `RCPT-${year}-${pad(idx, 5)}`,
            amount: paidPkr,
            method: idx % 4 === 0 ? "bank" : "cash",
          });
          createdPayments += 1;
        }

        // Attendance last 5 weekdays for this student
        for (let d = 1; d <= 5; d++) {
          const date = isoDaysAgo(d + (d > 5 ? 2 : 0));
          const statusCode = idx % 17 === d ? "absent" : idx % 23 === d ? "late" : "present";
          attendanceRows.push({
            id: randomUUID(),
            date,
            studentId,
            classId: section.classId,
            sectionId: section.id,
            statusCode,
          });
          createdAttendance += 1;
        }

        createdStudents += 1;
        createdGuardians += 1;
      }

      createdAdmissions += admissionRows.length;

      await client.query("BEGIN");
      try {
        // Guardians
        if (guardianRows.length) {
          const vals = [];
          const params = [];
          let p = 1;
          for (const g of guardianRows) {
            vals.push(
              `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, 'father', 'active')`,
            );
            params.push(g.id, orgId, branchId, g.name, g.phone, g.email);
          }
          await client.query(
            `INSERT INTO education_guardians
              (id, organization_id, branch_id, full_name, phone, email, relationship_code, status)
             VALUES ${vals.join(",")}`,
            params,
          );
        }

        // Students
        if (studentRows.length) {
          const vals = [];
          const params = [];
          let p = 1;
          for (const s of studentRows) {
            vals.push(
              `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`,
            );
            params.push(
              s.id,
              orgId,
              branchId,
              s.studentNumber,
              s.admissionNumber,
              s.first,
              s.last,
              s.father,
              s.dob,
              s.gender,
              s.phone,
              s.email,
              isoDaysAgo(30 + (createdStudents % 60)),
              s.status,
              s.classId,
              s.sectionId,
              session.id,
            );
          }
          await client.query(
            `INSERT INTO education_students
              (id, organization_id, branch_id, student_number, admission_number, first_name, last_name,
               father_name, date_of_birth, gender_code, phone, email, admission_date, status_code,
               class_id, section_id, session_id)
             VALUES ${vals.join(",")}`,
            params,
          );
        }

        if (linkRows.length) {
          const vals = [];
          const params = [];
          let p = 1;
          for (const l of linkRows) {
            vals.push(`($${p++}, $${p++}, true)`);
            params.push(l.studentId, l.guardianId);
          }
          await client.query(
            `INSERT INTO education_student_guardians (student_id, guardian_id, is_primary) VALUES ${vals.join(",")}`,
            params,
          );
        }

        if (admissionRows.length) {
          const vals = [];
          const params = [];
          let p = 1;
          for (const a of admissionRows) {
            vals.push(
              `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, 'regular', $${p++}, $${p++}, $${p++})`,
            );
            params.push(
              a.id,
              orgId,
              branchId,
              a.appNo,
              a.name,
              a.father,
              a.phone,
              a.status,
              a.classId,
              session.id,
            );
          }
          await client.query(
            `INSERT INTO education_admissions
              (id, organization_id, branch_id, application_number, applicant_name, father_name, phone,
               admission_type_code, status_code, class_id, session_id)
             VALUES ${vals.join(",")}`,
            params,
          );
        }

        if (invoiceRows.length) {
          const vals = [];
          const params = [];
          let p = 1;
          for (const inv of invoiceRows) {
            vals.push(
              `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, 'tuition', $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`,
            );
            params.push(
              inv.id,
              orgId,
              branchId,
              inv.studentId,
              inv.voucher,
              inv.title,
              inv.amount,
              inv.paid,
              isoDaysAgo(5),
              inv.status,
              session.id,
            );
          }
          await client.query(
            `INSERT INTO education_fee_invoices
              (id, organization_id, branch_id, student_id, voucher_number, fee_type_code, title,
               amount_pkr, paid_pkr, due_date, status, session_id)
             VALUES ${vals.join(",")}`,
            params,
          );
        }

        if (paymentRows.length) {
          const vals = [];
          const params = [];
          let p = 1;
          for (const pay of paymentRows) {
            vals.push(
              `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, now())`,
            );
            params.push(
              pay.id,
              orgId,
              branchId,
              pay.invoiceId,
              pay.studentId,
              pay.receipt,
              pay.amount,
              pay.method,
            );
          }
          await client.query(
            `INSERT INTO education_fee_payments
              (id, organization_id, branch_id, invoice_id, student_id, receipt_number, amount_pkr,
               payment_method_code, paid_at)
             VALUES ${vals.join(",")}`,
            params,
          );
        }

        if (attendanceRows.length) {
          const vals = [];
          const params = [];
          let p = 1;
          for (const a of attendanceRows) {
            vals.push(
              `($${p++}, $${p++}, $${p++}, $${p++}, 'student', $${p++}, $${p++}, $${p++}, $${p++})`,
            );
            params.push(a.id, orgId, branchId, a.date, a.studentId, a.classId, a.sectionId, a.statusCode);
          }
          await client.query(
            `INSERT INTO education_attendance
              (id, organization_id, branch_id, date, person_type, person_id, class_id, section_id, status_code)
             VALUES ${vals.join(",")}`,
            params,
          );
        }

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }

      console.log(
        `[campus-seed] batch ${offset + size}/${toCreate} students cumulative=${existingStudents + createdStudents}`,
      );
    }

    // Mid-term exam + marks for first 200 active students (or all if fewer)
    let exam = (
      await client.query(
        `SELECT id FROM education_exams
         WHERE organization_id = $1 AND branch_id = $2 AND name = 'Mid Term Assessment' LIMIT 1`,
        [orgId, branchId],
      )
    ).rows[0];
    if (!exam) {
      exam = (
        await client.query(
          `INSERT INTO education_exams
            (organization_id, branch_id, name, exam_type_code, session_id, start_date, end_date, status)
           VALUES ($1, $2, 'Mid Term Assessment', 'midterm', $3, $4, $5, 'active')
           RETURNING id`,
          [orgId, branchId, session.id, isoDaysAgo(14), isoDaysAgo(7)],
        )
      ).rows[0];
    }
    const examSubjectIds = [];
    for (const sid of subjectIds.slice(0, 5)) {
      const es = await upsertReturning(
        client,
        `SELECT id FROM education_exam_subjects WHERE organization_id = $1 AND exam_id = $2 AND subject_id = $3 LIMIT 1`,
        [orgId, exam.id, sid],
        `INSERT INTO education_exam_subjects
          (organization_id, exam_id, subject_id, total_marks, passing_marks)
         VALUES ($1, $2, $3, 100, 40) RETURNING id`,
        [orgId, exam.id, sid],
      );
      examSubjectIds.push({ id: es.id, subjectId: sid });
    }

    const markStudents = (
      await client.query(
        `SELECT id FROM education_students
         WHERE organization_id = $1 AND branch_id = $2 AND deleted_at IS NULL AND status_code = 'active'
           AND admission_number LIKE 'CFS-%'
         ORDER BY student_number ASC LIMIT 250`,
        [orgId, branchId],
      )
    ).rows;
    let marksCreated = 0;
    const existingMarks = await client.query(
      `SELECT student_id AS "studentId", exam_subject_id AS "examSubjectId"
       FROM education_marks WHERE organization_id = $1 AND exam_id = $2`,
      [orgId, exam.id],
    );
    const markKey = new Set(existingMarks.rows.map((r) => `${r.studentId}:${r.examSubjectId}`));
    const markBatch = [];
    for (const stu of markStudents) {
      for (const es of examSubjectIds) {
        const key = `${stu.id}:${es.id}`;
        if (markKey.has(key)) continue;
        const obtained = 40 + ((stu.id.charCodeAt(0) + es.id.charCodeAt(0)) % 60);
        const grade = obtained >= 80 ? "A" : obtained >= 65 ? "B" : obtained >= 50 ? "C" : "D";
        markBatch.push({
          id: randomUUID(),
          studentId: stu.id,
          examSubjectId: es.id,
          obtained,
          grade,
          passFail: obtained >= 40 ? "pass" : "fail",
        });
      }
    }
    for (let i = 0; i < markBatch.length; i += 100) {
      const chunk = markBatch.slice(i, i + 100);
      const vals = [];
      const params = [];
      let p = 1;
      for (const m of chunk) {
        vals.push(
          `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, 'published')`,
        );
        params.push(
          m.id,
          orgId,
          branchId,
          exam.id,
          m.examSubjectId,
          m.studentId,
          m.obtained,
          m.obtained,
          m.grade,
          m.passFail,
        );
      }
      await client.query(
        `INSERT INTO education_marks
          (id, organization_id, branch_id, exam_id, exam_subject_id, student_id, obtained_marks,
           percentage, grade_code, pass_fail, status)
         VALUES ${vals.join(",")}`,
        params,
      );
      marksCreated += chunk.length;
    }
    console.log("[campus-seed] marks created", marksCreated);

    // Front-desk enquiries (skip if already seeded)
    const enquiryCount = (
      await client.query(
        `SELECT count(*)::int n FROM education_enquiries WHERE organization_id = $1 AND branch_id = $2`,
        [orgId, branchId],
      )
    ).rows[0].n;
    if (enquiryCount < 25) {
      const vals = [];
      const params = [];
      let p = 1;
      for (let e = enquiryCount + 1; e <= 25; e++) {
        vals.push(`($${p++}, $${p++}, $${p++}, $${p++}, 'School admission', 'walk_in', $${p++}, 'Interested in spring intake')`);
        params.push(orgId, branchId, `Walk-in Parent ${e}`, phone(60000 + e), e % 3 === 0 ? "converted" : "new");
      }
      await client.query(
        `INSERT INTO education_enquiries
          (organization_id, branch_id, name, phone, interested_program, source_code, status, remarks)
         VALUES ${vals.join(",")}`,
        params,
      );
    }

    // Sample leave + discipline + lifecycle (batch, skip if present)
    const sampleStudents = (
      await client.query(
        `SELECT id, class_id, section_id FROM education_students
         WHERE organization_id = $1 AND branch_id = $2 AND deleted_at IS NULL AND admission_number LIKE 'CFS-%'
         ORDER BY student_number ASC LIMIT 20`,
        [orgId, branchId],
      )
    ).rows;
    const leaveCount = (
      await client.query(
        `SELECT count(*)::int n FROM education_leave_requests WHERE organization_id = $1 AND branch_id = $2`,
        [orgId, branchId],
      )
    ).rows[0].n;
    if (leaveCount < 10 && sampleStudents.length) {
      const vals = [];
      const params = [];
      let p = 1;
      for (const [i, s] of sampleStudents.entries()) {
        vals.push(
          `($${p++}, $${p++}, 'student', $${p++}, 'casual', $${p++}, $${p++}, 1, 'Family function', $${p++})`,
        );
        params.push(
          orgId,
          branchId,
          s.id,
          isoDaysAgo(3),
          isoDaysAgo(3),
          i % 2 === 0 ? "approved" : "pending",
        );
      }
      await client.query(
        `INSERT INTO education_leave_requests
          (organization_id, branch_id, applicant_type, applicant_id, leave_type_code, start_date, end_date,
           days, reason, status)
         VALUES ${vals.join(",")}`,
        params,
      );
    }
    const discCount = (
      await client.query(
        `SELECT count(*)::int n FROM education_discipline_incidents WHERE organization_id = $1 AND branch_id = $2`,
        [orgId, branchId],
      )
    ).rows[0].n;
    if (discCount < 8) {
      const slice = sampleStudents.slice(0, 8);
      if (slice.length) {
        const vals = [];
        const params = [];
        let p = 1;
        for (const s of slice) {
          vals.push(
            `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, 'conduct', 'Uniform incomplete', 'low', 'warning', 'closed')`,
          );
          params.push(orgId, branchId, s.id, s.class_id, s.section_id, isoDaysAgo(6));
        }
        await client.query(
          `INSERT INTO education_discipline_incidents
            (organization_id, branch_id, student_id, class_id, section_id, incident_date, incident_type_code,
             description, severity_code, action_code, status)
           VALUES ${vals.join(",")}`,
          params,
        );
      }
    }
    const lifeCount = (
      await client.query(
        `SELECT count(*)::int n FROM education_student_lifecycle WHERE organization_id = $1 AND branch_id = $2`,
        [orgId, branchId],
      )
    ).rows[0].n;
    if (lifeCount < 5) {
      const slice = sampleStudents.slice(0, 5);
      if (slice.length) {
        const vals = [];
        const params = [];
        let p = 1;
        for (const s of slice) {
          vals.push(
            `($${p++}, $${p++}, $${p++}, 'promote', $${p++}, $${p++}, $${p++}, $${p++}, 'Annual promotion shortlist', 'pending', $${p++})`,
          );
          params.push(orgId, branchId, s.id, session.id, session.id, s.class_id, s.class_id, `${year + 1}-04-01`);
        }
        await client.query(
          `INSERT INTO education_student_lifecycle
            (organization_id, branch_id, student_id, action_type, from_session_id, to_session_id,
             from_class_id, to_class_id, reason, status, effective_date)
           VALUES ${vals.join(",")}`,
          params,
        );
      }
    }

    await client.query(
      `INSERT INTO education_audit_logs (organization_id, branch_id, action, module_key, detail)
       VALUES ($1, $2, 'campus_seed', 'dashboard', $3)`,
      [orgId, branchId, `students_target=${TARGET_STUDENTS};created=${createdStudents}`],
    );

    // Final counts
    const counts = {};
    for (const t of [
      "education_students",
      "education_teachers",
      "education_staff",
      "education_guardians",
      "education_classes",
      "education_sections",
      "education_admissions",
      "education_fee_invoices",
      "education_fee_payments",
      "education_attendance",
      "education_exams",
      "education_marks",
      "education_enquiries",
      "education_leave_requests",
    ]) {
      const r = await client.query(`SELECT count(*)::int n FROM ${t} WHERE organization_id = $1`, [orgId]);
      counts[t] = r.rows[0].n;
    }

    console.log("\n[campus-seed] DONE");
    console.log(JSON.stringify({
      branch: BRANCH_CODE,
      createdStudents,
      createdGuardians,
      createdAdmissions,
      createdInvoices,
      createdPayments,
      createdAttendance,
      marksCreated,
      counts,
    }, null, 2));
    console.log("\nLogin: admin.education@pops.demo / Owner@12345");
    console.log("Use branch EDU-HQ (Main Campus) in the app.");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("[campus-seed] FAILED", e);
  process.exit(1);
});
