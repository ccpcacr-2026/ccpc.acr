-- Adds a freeform drag/resize position+size per Custom Count card
-- (dashboard grid: x/y in 12-column units, w/h in grid cells). Blank
-- ({}) means "not arranged yet" -- the client falls back to an auto
-- layout (narrow cards in a 3-up row, grouped/wide cards full-width,
-- stacked in save order) until the admin arranges and saves one.
alter table admission.dashboard_custom_counters
  add column if not exists layout jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
