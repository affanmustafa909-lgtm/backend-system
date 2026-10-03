/**
 * Seed EducationFlow demo users for all roles (idempotent).
 * Usage: node scripts/seed-education-users.mjs
 * Requires local API at http://127.0.0.1:3000 and DATABASE_URL in backend .env
 */
import bcrypt from "bcryptjs";
import pg from "pg";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://platform:platform@localhost:15432/platform";
const STAFF_PASSWORD = process.env.SEED_STAFF_PASSWORD ?? "Staff@12345";
const OWNER_PASSWORD = process.env.SEED_USER_PASSWORD ?? "Owner@12345";

const ROLE_USERS = [
  { email: "admin.education@pops.demo", name: "Education Admin", role: "admin", password: OWNER_PASSWORD, perms: ["*"] },
  { email: "principal.education@pops.demo", name: "Principal", role: "manager", password: STAFF_PASSWORD, perms: ["pops.read", "pops.inventory.manage", "pops.users.manage", "pops.hr.manage"] },
  { email: "teacher.education@pops.demo", name: "Teacher Demo", role: "teacher", password: STAFF_PASSWORD, perms: ["pops.read", "pops.inventory.manage"] },
  { email: "accountant.education@pops.demo", name: "Accountant Demo", role: "accountant", password: STAFF_PASSWORD, perms: ["pops.read", "pops.accounting.manage", "finance.view", "finance.post"] },
  { email: "hr.education@pops.demo", name: "HR Demo", role: "hr", password: STAFF_PASSWORD, perms: ["pops.read", "pops.hr.manage"] },
  { email: "reception.education@pops.demo", name: "Receptionist", role: "cashier", password: STAFF_PASSWORD, perms: ["pops.read"] },
  { email: "librarian.education@pops.demo", name: "Librarian", role: "hr", password: STAFF_PASSWORD, perms: ["pops.read"] },
  { email: "transport.education@pops.demo", name: "Transport Manager", role: "manager", password: STAFF_PASSWORD, perms: ["pops.read", "pops.inventory.manage"] },
  { email: "student.education@pops.demo", name: "Student Demo", role: "student", password: STAFF_PASSWORD, perms: ["pops.read"] },
  { email: "parent.education@pops.demo", name: "Parent Demo", role: "parent", password: STAFF_PASSWORD, perms: ["pops.read"] },
];

const NAV = {
  teacher: ["education/dashboard", "education/students", "education/attendance", "education/assignments", "education/examinations", "education/results", "education/timetable", "education/leave", "education/communication"],
  student: ["education/dashboard", "education/timetable", "education/attendance", "education/assignments", "education/examinations", "education/results", "education/fees", "education/communication", "education/documents", "education/leave"],
  parent: ["education/dashboard", "education/students", "education/attendance", "education/assignments", "education/results", "education/fees", "education/communication", "education/documents", "education/leave", "education/timetable"],
  cashier: ["education/dashboard", "education/admissions", "education/front-desk", "education/students", "education/communication"],
};

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const org = await client.query(
      `SELECT id FROM organizations WHERE licence_key = 'LIC-DEMO-EDUCATION' OR (system_type = 'education' AND name ILIKE '%EducationFlow%') ORDER BY created_at ASC LIMIT 1`,
    );
    if (!org.rows[0]) throw new Error("EducationFlow org not found — start API once to seed demo business");
    const orgId = org.rows[0].id;
    console.log("[seed-education-users] org=", orgId);

    for (const u of ROLE_USERS) {
      const hash = await bcrypt.hash(u.password, 12);
      const existing = await client.query(`SELECT id FROM users WHERE lower(email) = lower($1)`, [u.email]);
      let userId = existing.rows[0]?.id;
      if (!userId) {
        const ins = await client.query(
          `INSERT INTO users (email, name, password_hash, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
          [u.email.toLowerCase(), u.name, hash],
        );
        userId = ins.rows[0].id;
        console.log("  + user", u.email);
      } else {
        await client.query(
          `UPDATE users SET name = $2, password_hash = $3, status = 'active' WHERE id = $1`,
          [userId, u.name, hash],
        );
        console.log("  ~ user", u.email);
      }

      const mem = await client.query(
        `SELECT user_id FROM organization_memberships WHERE organization_id = $1 AND user_id = $2`,
        [orgId, userId],
      );
      const nav = NAV[u.role] ?? null;
      if (mem.rowCount === 0) {
        await client.query(
          `INSERT INTO organization_memberships
            (organization_id, user_id, role, permissions, branch_scope, pin_required, active, nav_allowlist, last_activity_at)
           VALUES ($1, $2, $3, $4::jsonb, 'all', false, true, $5::jsonb, now())`,
          [orgId, userId, u.role, JSON.stringify(u.perms), nav ? JSON.stringify(nav) : null],
        );
      } else {
        await client.query(
          `UPDATE organization_memberships
           SET role = $3, permissions = $4::jsonb, branch_scope = 'all', active = true, nav_allowlist = $5::jsonb
           WHERE organization_id = $1 AND user_id = $2`,
          [orgId, userId, u.role, JSON.stringify(u.perms), nav ? JSON.stringify(nav) : null],
        );
      }
    }
    console.log("[seed-education-users] done");
    console.log("Passwords: admin Owner@12345 | staff/student/parent Staff@12345");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
