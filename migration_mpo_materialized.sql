-- Materializes the MPO Bill figures that are genuinely DERIVED (never a
-- literal stored column, so the "From Another Table" field mechanism
-- can't reach them directly) onto mpo_roster itself, kept in sync by the
-- backend (add_mpo_roster_person/save_mpo_roster_person) every time a
-- roster row's Grade/Step/Basic-override/Arrear changes — same app-level
-- "recompute and store" approach as everywhere else in this system,
-- deliberately not a DB trigger.
--
-- resolved_basic     = that row's own MPO Basic (override, or Grade+Step
--                       looked up against grade_step_values).
-- resolved_deduction = a flat 10% of resolved_basic. Materialized rather
--                       than built as a "% of Field" field configured via
--                       grade_fields, since that rate must always be
--                       exactly 10% for everyone — a per-grade percent
--                       config would silently resolve to 0% for any grade
--                       nobody remembered to set it on (e.g. a brand new
--                       one added later).
-- resolved_net       = that row's full MPO Bill Net Payable (the same
--                       Incentive/House Rent/Welfare/Retirement formula
--                       as _mpoComputeRow / the MPO Bill tab itself).
-- resolved_payable   = resolved_net minus resolved_deduction — the exact
--                       fund-source "MPO" figure for the internal
--                       payroll's own MPO/College split.
--
-- Once these are real columns, "MPO Deduction" and "MPO Payable" become
-- ordinary "From Another Table" fields (see the Global Tables feature) —
-- no bespoke calculation code needed for either.
alter table payroll.mpo_roster add column if not exists resolved_basic numeric not null default 0;
alter table payroll.mpo_roster add column if not exists resolved_deduction numeric not null default 0;
alter table payroll.mpo_roster add column if not exists resolved_net numeric not null default 0;
alter table payroll.mpo_roster add column if not exists resolved_payable numeric not null default 0;

notify pgrst, 'reload schema';
