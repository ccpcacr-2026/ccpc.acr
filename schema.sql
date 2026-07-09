-- CCPC ACR SYSTEM - MASTER SCHEMA (Safe to run multiple times)
-- This script uses "IF NOT EXISTS" to prevent errors and PROTECT EXISTING DATA.

-- Drop old single-role check constraint so comma-separated roles are allowed
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;

-- 1. App Users (Login Credentials)
-- role supports comma-separated values for multi-role users e.g. 'Teacher,HR' or 'Admin,Principal'
CREATE TABLE IF NOT EXISTS app_users (
    user_id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL, -- single: 'Teacher' | multi: 'Teacher,HR' | valid tokens: Teacher,Staff,HR,Admin,Principal,VP
    phone TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Users Profile (Primary Personnel Record)
CREATE TABLE IF NOT EXISTS users_profile (
    teacher_id TEXT PRIMARY KEY REFERENCES app_users(user_id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT,
    category TEXT, -- Teacher, Staff
    department TEXT,
    designation TEXT,
    joining_date DATE,
    is_evaluatable BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure columns exist if table was created with an older version
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS designation TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS joining_date DATE;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS is_evaluatable BOOLEAN DEFAULT FALSE;

-- 3. Family Details (Spouse/Children)
CREATE TABLE IF NOT EXISTS family_details (
    id SERIAL PRIMARY KEY,
    teacher_id TEXT REFERENCES users_profile(teacher_id) ON DELETE CASCADE,
    member_type TEXT, -- Spouse, Son, Daughter
    name TEXT,
    marriage_date DATE
);

-- 4. Faculty Attributes (Education, Achievements, etc.)
CREATE TABLE IF NOT EXISTS faculty_attributes (
    id SERIAL PRIMARY KEY,
    teacher_id TEXT REFERENCES users_profile(teacher_id) ON DELETE CASCADE,
    header TEXT, -- Education, Achievement, Speciality, Hobby, Committee
    subheader TEXT,
    value TEXT
);

-- 5. Yearly ACR History (The Timeline - 60% Weightage)
CREATE TABLE IF NOT EXISTS yearly_acr (
    id SERIAL PRIMARY KEY,
    teacher_id TEXT REFERENCES users_profile(teacher_id) ON DELETE CASCADE,
    year_num INTEGER, -- 1 to 30
    calendar_year TEXT, -- e.g. "2024"
    io_marks NUMERIC DEFAULT 0, -- Initiating Officer
    rv_marks NUMERIC DEFAULT 0, -- Reviewing Officer (VP)
    rp_marks NUMERIC DEFAULT 0, -- Reporting Officer (Principal)
    pet_marks NUMERIC DEFAULT 0, -- Performance/Physical Grading (part of the 10% PET)
    is_exempt BOOLEAN DEFAULT FALSE,
    UNIQUE(teacher_id, year_num)
);

-- 6. Academic Courses (28% Weightage)
CREATE TABLE IF NOT EXISTS course_marks (
    id SERIAL PRIMARY KEY,
    teacher_id TEXT REFERENCES users_profile(teacher_id) ON DELETE CASCADE,
    course_name TEXT,
    full_marks NUMERIC DEFAULT 100,
    obtained_marks NUMERIC DEFAULT 0,
    weight_allotted NUMERIC DEFAULT 0 -- e.g. 5.5
);

-- 7. Committee/Non-Mandatory (2% Weightage)
CREATE TABLE IF NOT EXISTS committee_eval (
    teacher_id TEXT PRIMARY KEY REFERENCES users_profile(teacher_id) ON DELETE CASCADE,
    input_1 NUMERIC DEFAULT 0,
    input_2 NUMERIC DEFAULT 0,
    input_3 NUMERIC DEFAULT 0,
    input_4 NUMERIC DEFAULT 0
);

-- 8. Bonus & Penalty
CREATE TABLE IF NOT EXISTS bonus_penalty (
    id SERIAL PRIMARY KEY,
    teacher_id TEXT REFERENCES users_profile(teacher_id) ON DELETE CASCADE,
    type TEXT CHECK (type IN ('Bonus', 'Penalty')),
    description TEXT,
    amount NUMERIC DEFAULT 0
);

-- --- RLS POLICIES (Idempotent: Resets access rules without touching data) ---

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE faculty_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE yearly_acr ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE committee_eval ENABLE ROW LEVEL SECURITY;
ALTER TABLE bonus_penalty ENABLE ROW LEVEL SECURITY;

-- Drop and recreate policies to avoid "already exists" errors
DROP POLICY IF EXISTS "Full access users" ON app_users;
CREATE POLICY "Full access users" ON app_users FOR ALL USING (true);

DROP POLICY IF EXISTS "Full access profiles" ON users_profile;
CREATE POLICY "Full access profiles" ON users_profile FOR ALL USING (true);

DROP POLICY IF EXISTS "Full access family" ON family_details;
CREATE POLICY "Full access family" ON family_details FOR ALL USING (true);

DROP POLICY IF EXISTS "Full access attributes" ON faculty_attributes;
CREATE POLICY "Full access attributes" ON faculty_attributes FOR ALL USING (true);

DROP POLICY IF EXISTS "Full access service acr" ON yearly_acr;
CREATE POLICY "Full access service acr" ON yearly_acr FOR ALL USING (true);

DROP POLICY IF EXISTS "Full access service courses" ON course_marks;
CREATE POLICY "Full access service courses" ON course_marks FOR ALL USING (true);

DROP POLICY IF EXISTS "Full access service comm" ON committee_eval;
CREATE POLICY "Full access service comm" ON committee_eval FOR ALL USING (true);

-- 9. Committee Groups (Committee structure)
CREATE TABLE IF NOT EXISTS committee_groups (
    id SERIAL PRIMARY KEY,
    create_date TIMESTAMPTZ DEFAULT NOW(),
    committee_name TEXT NOT NULL,
    sub_committee TEXT,
    members_list JSONB NOT NULL, -- [{user_id, role, name}, ...], first is Chairman
    chat_messages JSONB DEFAULT '[]'::jsonb, -- [{id, user_id, text, ts, reply_to}]
    member_aliases JSONB DEFAULT '{}'::jsonb  -- { "user_id": "ShortName" }
);
ALTER TABLE committee_groups ADD COLUMN IF NOT EXISTS chat_messages JSONB DEFAULT '[]'::jsonb;
ALTER TABLE committee_groups ADD COLUMN IF NOT EXISTS member_aliases JSONB DEFAULT '{}'::jsonb;

-- 10. New Committee Evaluations (Peer and Admin evaluation)
CREATE TABLE IF NOT EXISTS committee_evaluations_new (
    id SERIAL PRIMARY KEY,
    committee_id INTEGER REFERENCES committee_groups(id) ON DELETE CASCADE,
    evaluated_id TEXT REFERENCES app_users(user_id) ON DELETE CASCADE,
    evaluated_by_id TEXT REFERENCES app_users(user_id) ON DELETE CASCADE,
    evaluator_role TEXT NOT NULL, -- member, chairman, HR, VP, Principal
    marks NUMERIC DEFAULT 0, -- out of 5 (for members eval chair) or specified
    date TIMESTAMPTZ DEFAULT NOW()
);

-- 11. System Settings (Thresholds, Weights)
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL
);

-- Seed initial settings if not exists
INSERT INTO system_settings (key, value) VALUES 
('committee_threshold', '2'),
('committee_weights', '{"member_eval": 20, "chairman_eval": 30, "admin_eval": 50}')
ON CONFLICT (key) DO NOTHING;

-- --- RLS POLICIES ---

ALTER TABLE committee_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE committee_evaluations_new ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Full access groups" ON committee_groups;
CREATE POLICY "Full access groups" ON committee_groups FOR ALL USING (true);

DROP POLICY IF EXISTS "Full access evaluations" ON committee_evaluations_new;
CREATE POLICY "Full access evaluations" ON committee_evaluations_new FOR ALL USING (true);

DROP POLICY IF EXISTS "Full access settings" ON system_settings;
CREATE POLICY "Full access settings" ON system_settings FOR ALL USING (true);

-- ============================================================
-- PERSONAL PROFILE EXTENSION (Part I–III of Personnel Record)
-- ============================================================

-- Extend users_profile with all personal info scalar fields
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS national_id TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS auth_ref TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS name_bengali TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS school_college TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS place_of_birth TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS birth_certificate_no TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS height_feet NUMERIC;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS height_inches NUMERIC;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS weight_kg NUMERIC;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS blood_group TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS medical_category TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS disability_nature TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS disability_attributable TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS religion TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS caste TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS nationality TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS previous_nationality TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS permanent_address TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS present_address TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS alternate_address TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS personal_email TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS tt_phone TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS mobile TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS passport_number TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS passport_date_issue DATE;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS passport_place_issue TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS passport_date_expiry DATE;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS passport_type TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS passport_issuing_auth TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS father_name TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS father_nationality TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS father_prev_nationality TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS father_citizenship_auth TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS father_present_age TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS father_date_of_decease DATE;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS father_occupation TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS father_annual_income TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS mother_name TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS mother_nationality TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS mother_prev_nationality TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS mother_citizenship_auth TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS mother_present_age TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS mother_date_of_decease DATE;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS mother_occupation TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS position_in_siblings TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS marital_status TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS marriage_divorce_date DATE;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS marriage_authority TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS own_income TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS spouse_income TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS assets_income TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS assets_details TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS institution_law_breaking TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS civil_law_breaking TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS identification_marks TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS tid_bin_no TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS additional_qualification TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS spouse_name TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS whatsapp TEXT;
ALTER TABLE users_profile ADD COLUMN IF NOT EXISTS phone TEXT;

-- ============================================================
-- LEGACY GAS CLEANUP
-- The old Google Apps Script system used a table called
-- "teachers_profile". The Next.js system uses "users_profile".
-- Run this block to fix any leftover triggers, functions, and
-- FK constraints that still reference "teachers_profile".
-- Safe to run even if none of these exist.
-- ============================================================

-- 1. Drop any triggers on users_profile that fire into teachers_profile
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT trigger_name
    FROM information_schema.triggers
    WHERE event_object_table = 'users_profile'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON users_profile', r.trigger_name);
  END LOOP;
END $$;

-- 2. Drop any stored functions whose body references teachers_profile
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT routine_name, routine_schema
    FROM information_schema.routines
    WHERE routine_type = 'FUNCTION'
      AND routine_definition ILIKE '%teachers_profile%'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %I.%I() CASCADE', r.routine_schema, r.routine_name);
  END LOOP;
END $$;

-- 3. Fix FK constraints on child tables that still point to teachers_profile
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT tc.constraint_name, tc.table_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
    JOIN information_schema.table_constraints tc2 ON tc2.constraint_name = rc.unique_constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc2.table_name = 'teachers_profile'
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', r.table_name, r.constraint_name);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (teacher_id) REFERENCES users_profile(teacher_id) ON DELETE CASCADE', r.table_name, r.constraint_name);
  END LOOP;
END $$;

-- Countries Visited
CREATE TABLE IF NOT EXISTS countries_visited (
    id SERIAL PRIMARY KEY,
    teacher_id TEXT REFERENCES users_profile(teacher_id) ON DELETE CASCADE,
    country_name TEXT,
    duration_from DATE,
    duration_to DATE,
    reasons TEXT
);
ALTER TABLE countries_visited ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Full access countries" ON countries_visited;
CREATE POLICY "Full access countries" ON countries_visited FOR ALL USING (true);

-- Language Skills (except Bengali & English)
CREATE TABLE IF NOT EXISTS language_skills (
    id SERIAL PRIMARY KEY,
    teacher_id TEXT REFERENCES users_profile(teacher_id) ON DELETE CASCADE,
    language TEXT,
    efficiency TEXT
);
ALTER TABLE language_skills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Full access languages" ON language_skills;
CREATE POLICY "Full access languages" ON language_skills FOR ALL USING (true);

-- Siblings Info
CREATE TABLE IF NOT EXISTS siblings_info (
    id SERIAL PRIMARY KEY,
    teacher_id TEXT REFERENCES users_profile(teacher_id) ON DELETE CASCADE,
    name TEXT,
    age TEXT,
    nationality TEXT,
    occupation_address TEXT,
    dependency TEXT
);
ALTER TABLE siblings_info ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Full access siblings" ON siblings_info;
CREATE POLICY "Full access siblings" ON siblings_info FOR ALL USING (true);

-- Spouse Details (multi-spouse support)
CREATE TABLE IF NOT EXISTS spouse_details (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    teacher_id TEXT REFERENCES users_profile(teacher_id) ON DELETE CASCADE,
    name_english TEXT,
    name_bengali TEXT,
    date_of_birth DATE,
    place_of_birth TEXT,
    birth_reg_number TEXT,
    nationality TEXT,
    prev_nationality TEXT,
    citizenship_auth TEXT,
    national_id TEXT,
    educational_qualification TEXT,
    occupation TEXT,
    occupation_designation TEXT,
    occupation_address TEXT,
    previous_occupation TEXT,
    tid_bin_no TEXT,
    status TEXT DEFAULT 'Alive'
);
ALTER TABLE spouse_details ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Full access spouse" ON spouse_details;
CREATE POLICY "Full access spouse" ON spouse_details FOR ALL USING (true);

-- Children Info (comprehensive)
CREATE TABLE IF NOT EXISTS children_info (
    id SERIAL PRIMARY KEY,
    teacher_id TEXT REFERENCES users_profile(teacher_id) ON DELETE CASCADE,
    name TEXT,
    sex TEXT,
    date_of_birth DATE,
    occupation TEXT,
    present_address TEXT,
    disease_notes TEXT
);
ALTER TABLE children_info ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Full access children_info" ON children_info;
CREATE POLICY "Full access children_info" ON children_info FOR ALL USING (true);

-- Chronic Diseases
CREATE TABLE IF NOT EXISTS chronic_diseases (
    id SERIAL PRIMARY KEY,
    teacher_id TEXT REFERENCES users_profile(teacher_id) ON DELETE CASCADE,
    disease_name TEXT,
    nature TEXT,
    date_of_illness DATE,
    present_condition TEXT
);
ALTER TABLE chronic_diseases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Full access chronic" ON chronic_diseases;
CREATE POLICY "Full access chronic" ON chronic_diseases FOR ALL USING (true);

-- Sibling In-laws
CREATE TABLE IF NOT EXISTS sibling_inlaws (
    id SERIAL PRIMARY KEY,
    teacher_id TEXT REFERENCES users_profile(teacher_id) ON DELETE CASCADE,
    name_in_full TEXT,
    address TEXT
);
ALTER TABLE sibling_inlaws ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Full access inlaws" ON sibling_inlaws;
CREATE POLICY "Full access inlaws" ON sibling_inlaws FOR ALL USING (true);

-- Bank Accounts
CREATE TABLE IF NOT EXISTS bank_accounts (
    id SERIAL PRIMARY KEY,
    teacher_id TEXT REFERENCES users_profile(teacher_id) ON DELETE CASCADE,
    bank_name TEXT,
    account_number TEXT,
    account_type TEXT
);
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Full access bank" ON bank_accounts;
CREATE POLICY "Full access bank" ON bank_accounts FOR ALL USING (true);

-- Education Records (Part II)
CREATE TABLE IF NOT EXISTS education_records (
    id SERIAL PRIMARY KEY,
    teacher_id TEXT REFERENCES users_profile(teacher_id) ON DELETE CASCADE,
    from_date TEXT,
    to_date TEXT,
    school_college TEXT,
    exam_passed TEXT,
    division_gpa TEXT,
    year_of_passing TEXT,
    remarks TEXT
);
ALTER TABLE education_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Full access education" ON education_records;
CREATE POLICY "Full access education" ON education_records FOR ALL USING (true);
