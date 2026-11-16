-- Live auto-seat-allocation rules -- a persistent, per-category (or any
-- ALLOC_FIELDS-filtered) config that seats NEW arrivals automatically and
-- immediately, separate from the one-shot batch admission.seat_allocation_runs
-- (which is a point-in-time execution record, not an ongoing rule).
--
-- Ordering guarantee: next_room_idx/next_seat_in_room is a monotonic cursor,
-- advanced by exactly one slot per successful auto-assignment -- never
-- recomputed from a scan of existing rows, so an already-seated candidate
-- (possibly already on a printed admit card/signature sheet) is never moved
-- or renumbered by a later arrival.
--
-- overflow_count is incremented (never auto-cleared) whenever a matching
-- arrival finds every room in room_ids already full -- the candidate stays
-- unallocated (room_id/seat_no null) rather than spilling into an unrelated
-- room; this counter is what surfaces "this rule needs more rooms" to the
-- admin.
create table if not exists admission.seat_auto_allocation_rules (
  id bigint generated always as identity primary key,
  circular_id bigint not null references admission.exam_circulars(id) on delete cascade,
  filters jsonb not null default '{}'::jsonb,
  room_ids bigint[] not null default '{}'::bigint[],
  next_room_idx int not null default 0,
  next_seat_in_room int not null default 0,
  overflow_count int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant all on admission.seat_auto_allocation_rules to service_role;

notify pgrst, 'reload schema';
