-- Part 5: per-circular Admission Committee — members + section permissions + scan-option grants

create table if not exists admission.circular_committee_members (
  id bigint generated always as identity primary key,
  circular_id bigint not null references admission.exam_circulars(id) on delete cascade,
  user_id text not null,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists circular_committee_members_circular_user_idx on admission.circular_committee_members (circular_id, user_id);
grant all on admission.circular_committee_members to service_role;

notify pgrst, 'reload schema';
