-- Bàn Tròn: bảng trắng + chat realtime
-- Chạy file này trong Supabase Dashboard → SQL Editor (hoặc `supabase db push`).

create extension if not exists pgcrypto;

-- ───────────────────────────── rooms ─────────────────────────────
create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  name        text not null check (char_length(name) between 1 and 80),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

-- ─────────────────────────── elements ────────────────────────────
-- Mỗi phần tử trên bảng (nét vẽ, hình, chữ, ghi chú, bảng, ảnh...)
create table if not exists public.elements (
  id          uuid primary key,
  room_id     uuid not null references public.rooms(id) on delete cascade,
  type        text not null check (type in ('ink','shape','line','text','note','table','image')),
  data        jsonb not null check (pg_column_size(data) < 262144),
  z           double precision not null default 0,
  created_by  uuid default auth.uid(),
  updated_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists elements_room_idx on public.elements(room_id, z);

-- ─────────────────────────── messages ────────────────────────────
create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms(id) on delete cascade,
  user_id      uuid not null default auth.uid(),
  author_name  text not null check (char_length(author_name) between 1 and 40),
  author_color text not null check (author_color ~ '^#[0-9a-fA-F]{6}$'),
  content      text not null check (char_length(content) between 1 and 4000),
  created_at   timestamptz not null default now()
);
create index if not exists messages_room_idx on public.messages(room_id, created_at desc);

-- ─────────────────────── audit triggers ──────────────────────────
-- Không tin dữ liệu client gửi lên cho các cột "ai/khi nào".
create or replace function public.tg_elements_audit()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.room_id    := old.room_id;   -- không cho chuyển phần tử sang phòng khác
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists elements_audit on public.elements;
create trigger elements_audit before insert or update on public.elements
for each row execute function public.tg_elements_audit();

create or replace function public.tg_messages_audit()
returns trigger language plpgsql as $$
begin
  new.user_id    := auth.uid();
  new.created_at := now();
  return new;
end $$;

drop trigger if exists messages_audit on public.messages;
create trigger messages_audit before insert on public.messages
for each row execute function public.tg_messages_audit();

create or replace function public.tg_rooms_audit()
returns trigger language plpgsql as $$
begin
  new.created_by := auth.uid();
  new.created_at := now();
  return new;
end $$;

drop trigger if exists rooms_audit on public.rooms;
create trigger rooms_audit before insert on public.rooms
for each row execute function public.tg_rooms_audit();

-- ─────────────────────── thành viên phòng ────────────────────────
-- Chỉ ai biết mã phòng (slug) mới vào được: vào phòng qua RPC join_room(slug).
-- Nhờ vậy không ai liệt kê được phòng/tin nhắn của người khác bằng anon key.
create table if not exists public.room_members (
  room_id   uuid not null references public.rooms(id) on delete cascade,
  user_id   uuid not null default auth.uid(),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create or replace function public.is_room_member(p_room uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.room_members m
    where m.room_id = p_room and m.user_id = auth.uid()
  );
$$;

-- người tạo phòng tự động là thành viên
create or replace function public.tg_rooms_add_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.room_members (room_id, user_id) values (new.id, new.created_by)
  on conflict do nothing;
  return null;
end $$;

drop trigger if exists rooms_add_owner on public.rooms;
create trigger rooms_add_owner after insert on public.rooms
for each row execute function public.tg_rooms_add_owner();

-- vào phòng bằng mã: trả về thông tin phòng (hoặc rỗng nếu không tồn tại)
create or replace function public.join_room(p_slug text)
returns table (id uuid, slug text, name text, created_by uuid)
language plpgsql security definer set search_path = '' as $$
declare r public.rooms;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select * into r from public.rooms where rooms.slug = lower(p_slug);
  if not found then
    return;
  end if;
  insert into public.room_members (room_id, user_id) values (r.id, auth.uid())
  on conflict do nothing;
  return query select r.id, r.slug, r.name, r.created_by;
end $$;

revoke all on function public.join_room(text) from public, anon;
grant execute on function public.join_room(text) to authenticated;
revoke all on function public.is_room_member(uuid) from public, anon;
grant execute on function public.is_room_member(uuid) to authenticated;

-- ───────────────────────────── RLS ───────────────────────────────
-- Người dùng ẩn danh (anonymous sign-in) cũng có role "authenticated".
alter table public.rooms        enable row level security;
alter table public.room_members enable row level security;
alter table public.elements     enable row level security;
alter table public.messages     enable row level security;

drop policy if exists "rooms read"   on public.rooms;
drop policy if exists "rooms insert" on public.rooms;
drop policy if exists "rooms update" on public.rooms;
create policy "rooms read"   on public.rooms for select to authenticated using (public.is_room_member(id));
create policy "rooms insert" on public.rooms for insert to authenticated with check (true);
create policy "rooms update" on public.rooms for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
-- chủ phòng chỉ được đổi tên (không đổi slug → link mời không bị hỏng)
revoke update on public.rooms from anon, authenticated;
grant update (name) on public.rooms to authenticated;

drop policy if exists "members read own" on public.room_members;
create policy "members read own" on public.room_members for select to authenticated
  using (user_id = auth.uid());

-- Bảng trắng cộng tác: thành viên phòng đều được vẽ/sửa/xoá.
drop policy if exists "elements read"   on public.elements;
drop policy if exists "elements insert" on public.elements;
drop policy if exists "elements update" on public.elements;
drop policy if exists "elements delete" on public.elements;
create policy "elements read"   on public.elements for select to authenticated using (public.is_room_member(room_id));
create policy "elements insert" on public.elements for insert to authenticated with check (public.is_room_member(room_id));
create policy "elements update" on public.elements for update to authenticated
  using (public.is_room_member(room_id)) with check (public.is_room_member(room_id));
create policy "elements delete" on public.elements for delete to authenticated using (public.is_room_member(room_id));

drop policy if exists "messages read"   on public.messages;
drop policy if exists "messages insert" on public.messages;
drop policy if exists "messages delete" on public.messages;
create policy "messages read"   on public.messages for select to authenticated using (public.is_room_member(room_id));
create policy "messages insert" on public.messages for insert to authenticated with check (public.is_room_member(room_id));
create policy "messages delete" on public.messages for delete to authenticated using (user_id = auth.uid());

-- ─────────────────────────── realtime ────────────────────────────
-- Kênh "room:<uuid>" là kênh PRIVATE: chỉ thành viên phòng mới được nghe / gửi
-- (Realtime Authorization). Không có policy này thì ai biết room id cũng nghe lén được.
create or replace function public.room_id_from_topic(p_topic text)
returns uuid language sql immutable set search_path = '' as $$
  select case
    when p_topic ~ '^room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then substring(p_topic from 6)::uuid
  end;
$$;

drop policy if exists "room members can receive" on realtime.messages;
drop policy if exists "room members can send" on realtime.messages;
create policy "room members can receive" on realtime.messages for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.is_room_member(public.room_id_from_topic(realtime.topic()))
  );
create policy "room members can send" on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.is_room_member(public.room_id_from_topic(realtime.topic()))
  );

-- Chat dùng Postgres Changes; bảng vẽ dùng Broadcast (nhanh hơn, không tốn DB).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- ─────────────────────────── storage ─────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('board-images', 'board-images', true, 5242880,
        array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do nothing;

drop policy if exists "board images upload" on storage.objects;
create policy "board images upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'board-images'
    and public.is_room_member(((storage.foldername(name))[1])::uuid)
  );
