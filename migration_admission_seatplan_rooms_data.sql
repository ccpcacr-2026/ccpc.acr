-- One-time data correction, not a schema change: upserts the real 66-room
-- seat-plan list (room number + capacity + building) from the user's own
-- Google Sheet into the shared inventory.rooms/buildings registry (the
-- Admission Candidates module's Rooms tab reads/writes this exact table,
-- per migration_admission_rooms_use_inventory.sql). No unique constraint
-- exists on inventory.rooms.name to upsert against via ON CONFLICT, so
-- this upserts by name explicitly (update if present, insert if not) --
-- safe to re-run any time; never deletes a room.
do $$
declare
  rec record;
  bld_id bigint;
begin
  for rec in select * from (values
    ('CB-202', 90, 'College Building'),
    ('CB-204', 90, 'College Building'),
    ('CB-207', 80, 'College Building'),
    ('CB-208', 80, 'College Building'),
    ('CB-302', 80, 'College Building'),
    ('CB-303', 75, 'College Building'),
    ('CB-304', 90, 'College Building'),
    ('CB-307', 80, 'College Building'),
    ('CB-308', 85, 'College Building'),
    ('CB-402', 85, 'College Building'),
    ('CB-403', 85, 'College Building'),
    ('CB-404', 90, 'College Building'),
    ('CB-408', 85, 'College Building'),
    ('CB-409', 85, 'College Building'),
    ('CB-502', 60, 'College Building'),
    ('CB-503', 65, 'College Building'),
    ('CB-504', 65, 'College Building'),
    ('CB-508', 85, 'College Building'),
    ('CB-509', 85, 'College Building'),
    ('CB-602', 60, 'College Building'),
    ('CB-603', 70, 'College Building'),
    ('CB-604', 80, 'College Building'),
    ('CB-608', 80, 'College Building'),
    ('CB-609', 90, 'College Building'),
    ('JB-105', 50, 'Junior Block'),
    ('JB-106', 50, 'Junior Block'),
    ('JB-107', 50, 'Junior Block'),
    ('MB-109', 47, 'Main Building'),
    ('MB-110', 46, 'Main Building'),
    ('MB-111', 45, 'Main Building'),
    ('MB-112', 44, 'Main Building'),
    ('MB-113', 41, 'Main Building'),
    ('MB-114', 42, 'Main Building'),
    ('MB-205', 43, 'Main Building'),
    ('MB-207', 47, 'Main Building'),
    ('MB-210', 48, 'Main Building'),
    ('MB-211', 46, 'Main Building'),
    ('MB-212', 51, 'Main Building'),
    ('MB-213', 43, 'Main Building'),
    ('SB-106', 45, 'School Building'),
    ('SB-107', 45, 'School Building'),
    ('SB-202', 45, 'School Building'),
    ('SB-203', 45, 'School Building'),
    ('SB-204', 45, 'School Building'),
    ('SB-205', 45, 'School Building'),
    ('SB-206', 45, 'School Building'),
    ('SB-207', 45, 'School Building'),
    ('SB-208', 45, 'School Building'),
    ('SB-302', 45, 'School Building'),
    ('SB-303', 45, 'School Building'),
    ('SB-305', 45, 'School Building'),
    ('SB-306', 45, 'School Building'),
    ('SB-307', 45, 'School Building'),
    ('SB-308', 45, 'School Building'),
    ('SB-402', 40, 'School Building'),
    ('SB-403', 40, 'School Building'),
    ('SB-405', 40, 'School Building'),
    ('SB-406', 40, 'School Building'),
    ('SB-407', 40, 'School Building'),
    ('SB-408', 40, 'School Building'),
    ('SB-502', 40, 'School Building'),
    ('SB-503', 40, 'School Building'),
    ('SB-505', 40, 'School Building'),
    ('SB-506', 40, 'School Building'),
    ('SB-507', 40, 'School Building'),
    ('SB-508', 40, 'School Building')
  ) as t(room_name, capacity, building_name)
  loop
    select id into bld_id from inventory.buildings where name = rec.building_name;
    if bld_id is null then
      insert into inventory.buildings (name) values (rec.building_name) returning id into bld_id;
    end if;

    if exists (select 1 from inventory.rooms where name = rec.room_name) then
      update inventory.rooms set capacity = rec.capacity, building_id = bld_id where name = rec.room_name;
    else
      insert into inventory.rooms (name, capacity, building_id) values (rec.room_name, rec.capacity, bld_id);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
