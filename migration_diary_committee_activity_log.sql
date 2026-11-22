-- Append-only audit trail for committee membership/role changes (who added/
-- removed a member, who promoted/demoted a chairman, when) -- confirmed via
-- explicit request: "admin or chairman can make any member of a committee
-- in charge/chairman (all activity should be noted)". Same append-only
-- idiom as diary_case_referrals (Part 18).
create table if not exists teacher_staff.diary_committee_activity_log (
  id bigint generated always as identity primary key,
  committee_id bigint not null references teacher_staff.diary_committees(id) on delete cascade,
  actor_id text,
  target_user_id text,
  action text not null check (action in ('added_member', 'removed_member', 'promoted_to_chairman', 'demoted_from_chairman')),
  created_at timestamptz not null default now()
);
create index if not exists diary_committee_activity_log_committee_idx on teacher_staff.diary_committee_activity_log (committee_id, created_at desc);
grant all on teacher_staff.diary_committee_activity_log to service_role;

notify pgrst, 'reload schema';
