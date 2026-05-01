alter table if exists pvp_rooms
  add column if not exists is_private boolean not null default false;

create index if not exists pvp_rooms_public_waiting_idx
  on pvp_rooms (status, is_private, created_at desc);
