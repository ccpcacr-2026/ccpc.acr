-- Reorders the 4 Payroll Groups to match the actual tab order in the
-- source workbooks, read directly from each file's own SheetNames (not
-- assumed): School file -> '01 SS Driver helper', '01 SS', '01 ST';
-- College file -> '01 CS Driver helper', '01 CS', '01 CT'. In both files
-- the Driver/Helper and general-Staff tabs (now merged into Non-Teaching)
-- come before the Teacher tab, so Non-Teaching leads Teaching within each
-- institution; School before College matches how both files have been
-- referred to throughout (School named first every time).
--
-- Just an ordering change — doesn't touch which people or designations
-- belong to which group. Safe to re-run; change these anytime from the
-- Payroll Groups screen instead if a different order is wanted later.
--
-- Run in Supabase SQL editor.

update payroll.payroll_groups set sort_order = 1 where name = 'Non-Teaching (School)';
update payroll.payroll_groups set sort_order = 2 where name = 'Teaching (School)';
update payroll.payroll_groups set sort_order = 3 where name = 'Non-Teaching (College)';
update payroll.payroll_groups set sort_order = 4 where name = 'Teaching (College)';

notify pgrst, 'reload schema';
