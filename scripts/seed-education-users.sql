-- EducationFlow demo users (idempotent)
-- admin.education@pops.demo = Owner@12345
-- other *.education@pops.demo = Staff@12345

DO $$
DECLARE
  v_org uuid;
  r RECORD;
  v_uid uuid;
  owner_hash text := '$2a$12$hevLZUFMqluz6F3f1cpKdOQCyvdPDtyv5ytRVDDe5fya6xMX.gkeq';
  staff_hash text := '$2a$12$a8uwuc9Kbut2fEKt/mgyTOcIf1jnbf3cAWaF/xsbMsddj.FxInKty';
BEGIN
  SELECT id INTO v_org FROM organizations WHERE licence_key = 'LIC-DEMO-EDUCATION' LIMIT 1;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'EducationFlow org LIC-DEMO-EDUCATION not found';
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('admin.education@pops.demo', 'Education Admin', 'admin', owner_hash, '["*"]'::jsonb, NULL::jsonb),
      ('principal.education@pops.demo', 'Principal', 'manager', staff_hash,
        '["pops.read","pops.inventory.manage","pops.users.manage","pops.hr.manage"]'::jsonb, NULL::jsonb),
      ('teacher.education@pops.demo', 'Teacher Demo', 'teacher', staff_hash,
        '["pops.read","pops.inventory.manage"]'::jsonb,
        '["education/dashboard","education/students","education/attendance","education/assignments","education/examinations","education/results","education/timetable","education/leave","education/communication"]'::jsonb),
      ('accountant.education@pops.demo', 'Accountant Demo', 'accountant', staff_hash,
        '["pops.read","pops.accounting.manage","finance.view","finance.post"]'::jsonb, NULL::jsonb),
      ('hr.education@pops.demo', 'HR Demo', 'hr', staff_hash, '["pops.read","pops.hr.manage"]'::jsonb, NULL::jsonb),
      ('reception.education@pops.demo', 'Receptionist', 'cashier', staff_hash, '["pops.read"]'::jsonb,
        '["education/dashboard","education/admissions","education/front-desk","education/students","education/communication"]'::jsonb),
      ('librarian.education@pops.demo', 'Librarian', 'hr', staff_hash, '["pops.read"]'::jsonb,
        '["education/dashboard","education/library","education/students"]'::jsonb),
      ('transport.education@pops.demo', 'Transport Manager', 'manager', staff_hash,
        '["pops.read","pops.inventory.manage"]'::jsonb,
        '["education/dashboard","education/transport","education/students"]'::jsonb),
      ('student.education@pops.demo', 'Student Demo', 'student', staff_hash, '["pops.read"]'::jsonb,
        '["education/dashboard","education/timetable","education/attendance","education/assignments","education/examinations","education/results","education/fees","education/communication","education/documents","education/leave"]'::jsonb),
      ('parent.education@pops.demo', 'Parent Demo', 'parent', staff_hash, '["pops.read"]'::jsonb,
        '["education/dashboard","education/students","education/attendance","education/assignments","education/results","education/fees","education/communication","education/documents","education/leave","education/timetable"]'::jsonb)
    ) AS t(email, name, role, password_hash, permissions, nav_allowlist)
  LOOP
    SELECT id INTO v_uid FROM users WHERE lower(email) = lower(r.email);
    IF v_uid IS NULL THEN
      INSERT INTO users (email, name, password_hash, status)
      VALUES (lower(r.email), r.name, r.password_hash, 'active')
      RETURNING id INTO v_uid;
    ELSE
      UPDATE users SET name = r.name, password_hash = r.password_hash, status = 'active' WHERE id = v_uid;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM organization_memberships WHERE organization_id = v_org AND user_id = v_uid
    ) THEN
      INSERT INTO organization_memberships
        (organization_id, user_id, role, permissions, branch_scope, pin_required, active, nav_allowlist, last_activity_at)
      VALUES (v_org, v_uid, r.role, r.permissions, 'all', false, true, r.nav_allowlist, now());
    ELSE
      UPDATE organization_memberships
      SET role = r.role,
          permissions = r.permissions,
          branch_scope = 'all',
          active = true,
          nav_allowlist = r.nav_allowlist
      WHERE organization_id = v_org AND user_id = v_uid;
    END IF;
  END LOOP;
END $$;
