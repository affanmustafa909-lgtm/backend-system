/**
 * EducationFlow E2E API QA — actually hits endpoints.
 * Usage: node scripts/education-e2e-qa.mjs
 */
const API = process.env.API_BASE ?? "http://127.0.0.1:3000";
const BRANCH = "EDU-HQ";

const results = { passed: [], failed: [], fixed_related: [] };

async function login(email, password) {
  const res = await fetch(`${API}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, token: body.accessToken };
}

async function get(token, path) {
  const res = await fetch(`${API}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { status: res.status, body };
}

async function post(token, path, payload) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { status: res.status, body };
}

function ok(name, cond, detail = "") {
  if (cond) results.passed.push(name);
  else results.failed.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  console.log("=== EducationFlow E2E QA ===");
  console.log("API:", API);

  const health = await fetch(`${API}/health`);
  ok("API health", health.ok, `status=${health.status}`);

  // Critical previously broken paths
  const admin = await login("admin.education@pops.demo", "Owner@12345");
  ok("Admin login", admin.status === 201 && Boolean(admin.token), `status=${admin.status}`);
  const t = admin.token;

  const critical = [
    `/v1/education/timetable?branchCode=${BRANCH}`,
    `/v1/education/timetable-slots?branchCode=${BRANCH}`,
    `/v1/education/fees/structures?branchCode=${BRANCH}`,
    `/v1/education/fee-structures?branchCode=${BRANCH}`,
    `/v1/education/finance/txns?branchCode=${BRANCH}`,
    `/v1/education/finance-txns?branchCode=${BRANCH}`,
    `/v1/education/payroll/runs?branchCode=${BRANCH}`,
    `/v1/education/payroll-runs?branchCode=${BRANCH}`,
  ];
  for (const p of critical) {
    const r = await get(t, p);
    ok(`GET ${p}`, r.status === 200, `status=${r.status}`);
    if (r.status === 200) results.fixed_related.push(p);
  }

  const modules = [
    "dashboard",
    "lookups",
    "modules",
    "settings",
    "sessions",
    "classes",
    "sections",
    "subjects",
    "students",
    "admissions",
    "guardians",
    "staff",
    "teachers",
    "departments",
    "programs",
    "courses",
    "batches",
    "periods",
    "rooms",
    "attendance",
    "exams",
    "expenses",
    "books",
    "vehicles",
    "notices",
    "document-templates",
    "leave-requests",
    "discipline",
    "lifecycle",
    "assignments",
    "scholarships",
    "fee-refunds",
    "buildings",
    "labs",
    "equipment",
    "inventory-items",
    "enquiries",
    "events",
    "alumni",
    "health-records",
    "hostels",
    "custom-fields",
    "workflows",
    "notification-rules",
    "audit-logs",
    "reports/attendance-summary",
    "finance/summary",
  ];
  for (const m of modules) {
    const q = m.includes("?") || m === "modules" || m === "custom-fields" || m === "workflows" || m === "notification-rules" || m === "lookups" || m === "settings"
      ? (m.includes("?") ? m : `${m}?branchCode=${BRANCH}`)
      : `${m}?branchCode=${BRANCH}`;
    // modules/custom-fields/workflows/notification-rules may be org-level
    const path =
      m === "modules" || m === "custom-fields" || m === "workflows" || m === "notification-rules"
        ? `/v1/education/${m}`
        : `/v1/education/${q}`;
    const r = await get(t, path);
    ok(`Module GET ${m}`, r.status === 200, `status=${r.status}`);
  }

  // Bootstrap + seed idempotent
  const boot = await post(t, "/v1/education/bootstrap-defaults", { branchCode: BRANCH });
  ok("bootstrap-defaults", boot.status === 201 || boot.status === 200, `status=${boot.status}`);
  const seed1 = await post(t, "/v1/education/seed-demo-data", { branchCode: BRANCH });
  ok("seed-demo-data #1", seed1.status === 201 || seed1.status === 200, `status=${seed1.status}`);
  const seed2 = await post(t, "/v1/education/seed-demo-data", { branchCode: BRANCH });
  ok(
    "seed-demo-data idempotent",
    (seed2.status === 201 || seed2.status === 200) && (seed2.body?.idempotent === true || (seed2.body?.created?.length ?? 1) === 0),
    JSON.stringify(seed2.body)?.slice(0, 120),
  );

  // Role logins
  const roleLogins = [
    ["admin.education@pops.demo", "Owner@12345", "admin"],
    ["principal.education@pops.demo", "Staff@12345", "principal"],
    ["teacher.education@pops.demo", "Staff@12345", "teacher"],
    ["accountant.education@pops.demo", "Staff@12345", "accountant"],
    ["hr.education@pops.demo", "Staff@12345", "hr"],
    ["reception.education@pops.demo", "Staff@12345", "reception"],
    ["student.education@pops.demo", "Staff@12345", "student"],
    ["parent.education@pops.demo", "Staff@12345", "parent"],
  ];
  for (const [email, pass, label] of roleLogins) {
    const r = await login(email, pass);
    ok(`Login ${label}`, r.status === 201 && Boolean(r.token), `status=${r.status}`);
  }

  // Unauthorized: no token
  const unauth = await get(null, `/v1/education/students?branchCode=${BRANCH}`);
  ok("Unauthorized without token", unauth.status === 401 || unauth.status === 403, `status=${unauth.status}`);

  // Student cannot manage (POST should fail without manage permission)
  const student = await login("student.education@pops.demo", "Staff@12345");
  if (student.token) {
    const deny = await post(student.token, "/v1/education/classes", {
      branchCode: BRANCH,
      name: "Hacked",
      code: "HACK",
    });
    ok("Student blocked from create class", deny.status === 403 || deny.status === 401, `status=${deny.status}`);
    const allow = await get(student.token, `/v1/education/dashboard?branchCode=${BRANCH}`);
    ok("Student can read dashboard", allow.status === 200, `status=${allow.status}`);
  } else {
    results.failed.push("Student RBAC tests skipped — login failed");
  }

  // CRUD smoke: create enquiry + list
  const enquiry = await post(t, "/v1/education/enquiries", {
    branchCode: BRANCH,
    name: "QA Parent",
    phone: "03001112233",
    status: "new",
    sourceCode: "walk_in",
  });
  ok("Create enquiry", enquiry.status === 201, `status=${enquiry.status}`);

  console.log("\n=== QA SUMMARY ===");
  console.log("PASSED:", results.passed.length);
  console.log("FAILED:", results.failed.length);
  if (results.failed.length) {
    console.log("Failures:");
    for (const f of results.failed) console.log(" -", f);
  }
  console.log("Critical path retests OK:", results.fixed_related.length);
  process.exit(results.failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
