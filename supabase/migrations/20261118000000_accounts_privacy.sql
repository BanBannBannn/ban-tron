-- Bàn Tròn: tài khoản, hồ sơ mã hoá, duyệt người vào phòng, phòng công khai/riêng tư,
-- lưu phòng, mã hoá chat + bảng vẽ, chống spam (rate limit).
-- Chạy SAU file 20261117000000_init.sql.

-- ═════════════════════════ schema nội bộ ═════════════════════════
-- Schema "private" KHÔNG được PostgREST mở ra ngoài (chỉ public, graphql_public),
-- nên client không đọc/ghi trực tiếp được các bảng ở đây.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Người gọi là tài khoản thật (không phải khách ẩn danh)?
create or replace function public.is_registered()
returns boolean language sql stable set search_path = '' as $$
  select auth.uid() is not null
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) = false;
$$;

-- ═════════════════════════ rate limit ═════════════════════════════
-- Bộ đếm cửa sổ cố định theo (user, loại thao tác). Vượt ngưỡng → lỗi HTTP 429.
create table if not exists private.rate_limits (
  user_id      uuid not null,
  kind         text not null,
  window_start timestamptz not null,
  hits         int not null,
  primary key (user_id, kind)
);

create or replace function private.hit(p_kind text, p_max int, p_window interval)
returns void language plpgsql security definer set search_path = '' as $$
declare
  n int;
  uid uuid := auth.uid();
begin
  if uid is null then
    return; -- service role / migration
  end if;
  insert into private.rate_limits as r (user_id, kind, window_start, hits)
  values (uid, p_kind, now(), 1)
  on conflict (user_id, kind) do update set
    hits         = case when r.window_start <= now() - p_window then 1 else r.hits + 1 end,
    window_start = case when r.window_start <= now() - p_window then now() else r.window_start end
  returning hits into n;
  if n > p_max then
    -- PTxxx: PostgREST trả về đúng mã HTTP xxx
    raise exception 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.'
      using errcode = 'PT429', hint = p_kind;
  end if;
end $$;

-- Tên an toàn: bỏ ký tự điều khiển, cắt khoảng trắng, tối đa 40 ký tự.
create or replace function private.clean_name(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(left(btrim(regexp_replace(coalesce(p, ''), '[[:cntrl:]]', '', 'g')), 40), '');
$$;

-- ═════════════════════════ hồ sơ (profiles) ════════════════════════
-- Thông tin công khai (tên hiển thị, màu) để thường.
-- Thông tin cá nhân nhạy cảm (họ tên thật, SĐT, ngày sinh) CHỈ lưu dạng mã hoá
-- AES-256-GCM do server Next.js mã hoá bằng khoá ENCRYPTION_KEY (không nằm trong DB).
-- Ràng buộc định dạng bảo đảm DB không bao giờ chứa bản rõ, kể cả khi client lỗi.
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 40),
  color         text not null default '#3b5bdb' check (color ~ '^#[0-9a-fA-F]{6}$'),
  full_name_enc text check (char_length(full_name_enc) <= 1400 and full_name_enc ~ '^s1\.[A-Za-z0-9_-]{8}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$'),
  phone_enc     text check (char_length(phone_enc) <= 1400 and phone_enc ~ '^s1\.[A-Za-z0-9_-]{8}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$'),
  birthday_enc  text check (char_length(birthday_enc) <= 1400 and birthday_enc ~ '^s1\.[A-Za-z0-9_-]{8}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant insert (id, display_name, color, full_name_enc, phone_enc, birthday_enc) on public.profiles to authenticated;
grant update (display_name, color, full_name_enc, phone_enc, birthday_enc) on public.profiles to authenticated;

drop policy if exists "profiles self read" on public.profiles;
drop policy if exists "profiles self insert" on public.profiles;
drop policy if exists "profiles self update" on public.profiles;
-- Chỉ chủ hồ sơ đọc/sửa được. Người khác (kể cả cùng phòng) không đọc được hồ sơ.
create policy "profiles self read" on public.profiles for select to authenticated
  using (id = auth.uid());
create policy "profiles self insert" on public.profiles for insert to authenticated
  with check (id = auth.uid() and public.is_registered());
create policy "profiles self update" on public.profiles for update to authenticated
  using (id = auth.uid() and public.is_registered())
  with check (id = auth.uid());

create or replace function private.tg_profiles_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.hit('profile', 30, interval '10 minutes');
  new.display_name := coalesce(private.clean_name(new.display_name), 'Người dùng');
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.created_at := old.created_at;
  else
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before insert or update on public.profiles
for each row execute function private.tg_profiles_guard();

-- Tự tạo hồ sơ khi có tài khoản thật (đăng ký email hoặc Google).
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  palette text[] := array['#e8590c','#e03131','#c2255c','#9c36b5','#6741d9','#3b5bdb',
                          '#1971c2','#0c8599','#099268','#2f9e44','#66a80f','#f08c00'];
  c text := new.raw_user_meta_data ->> 'color';
begin
  if new.is_anonymous then
    return new;
  end if;
  if c is null or c !~ '^#[0-9a-fA-F]{6}$' then
    c := palette[1 + floor(random() * array_length(palette, 1))::int];
  end if;
  insert into public.profiles (id, display_name, color)
  values (
    new.id,
    coalesce(
      private.clean_name(new.raw_user_meta_data ->> 'display_name'),
      private.clean_name(new.raw_user_meta_data ->> 'full_name'),
      private.clean_name(new.raw_user_meta_data ->> 'name'),
      private.clean_name(split_part(new.email, '@', 1)),
      'Người dùng'
    ),
    c
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function private.handle_new_user();

drop trigger if exists on_auth_user_upgraded on auth.users;
create trigger on_auth_user_upgraded after update of is_anonymous on auth.users
for each row when (old.is_anonymous and not new.is_anonymous)
execute function private.handle_new_user();

-- ═════════════════════════ phòng ══════════════════════════════════
alter table public.rooms add column if not exists visibility text not null default 'private'
  check (visibility in ('private', 'public'));
alter table public.rooms add column if not exists require_approval boolean not null default false;
-- "thế hệ" khoá mã hoá của phòng: tăng mỗi khi mời ai ra / chặn ai
-- → người bị mời ra không có khoá mới.
alter table public.rooms add column if not exists key_epoch int not null default 0;
create index if not exists rooms_public_idx on public.rooms(created_at desc) where visibility = 'public';

alter table public.room_members add column if not exists status text not null default 'active'
  check (status in ('active', 'pending', 'banned'));
alter table public.room_members add column if not exists display_name text
  check (display_name is null or char_length(display_name) between 1 and 40);
alter table public.room_members add column if not exists saved boolean not null default false;
alter table public.room_members add column if not exists last_seen_at timestamptz not null default now();
create index if not exists room_members_user_idx on public.room_members(user_id, last_seen_at desc);
create index if not exists room_members_pending_idx on public.room_members(room_id) where status = 'pending';

-- Thành viên = đã được duyệt (status active). Người đang chờ / bị chặn không đọc được gì.
create or replace function public.is_room_member(p_room uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.room_members m
    where m.room_id = p_room and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

create or replace function public.is_room_owner(p_room uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.rooms r where r.id = p_room and r.created_by = auth.uid());
$$;
revoke all on function public.is_room_owner(uuid) from public, anon;
grant execute on function public.is_room_owner(uuid) to authenticated;

-- Tạo phòng: gán chủ phòng, chống spam, chỉ tài khoản thật được tạo phòng công khai.
create or replace function public.tg_rooms_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.hit('room', 20, interval '1 hour');
  new.created_by := auth.uid();
  new.created_at := now();
  new.key_epoch := 0;
  if new.visibility = 'public' and not public.is_registered() then
    raise exception 'Cần đăng nhập để tạo phòng công khai' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function private.tg_rooms_update_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Chỉ áp dụng cho người dùng (RPC nội bộ chạy với quyền chủ bảng thì auth.uid() vẫn có,
  -- nhưng các cột nhạy cảm đã được khoá bằng GRANT theo cột).
  if new.visibility = 'public' and old.visibility <> 'public'
     and new.created_by = auth.uid() and not public.is_registered() then
    raise exception 'Cần đăng nhập để chuyển phòng sang công khai' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists rooms_update_guard on public.rooms;
create trigger rooms_update_guard before update on public.rooms
for each row execute function private.tg_rooms_update_guard();

revoke update on public.rooms from anon, authenticated;
grant update (name, visibility, require_approval) on public.rooms to authenticated;
revoke insert on public.rooms from anon, authenticated;
grant insert (slug, name, visibility, require_approval) on public.rooms to authenticated;

drop policy if exists "rooms delete" on public.rooms;
create policy "rooms delete" on public.rooms for delete to authenticated using (created_by = auth.uid());

create or replace function public.tg_rooms_add_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.room_members (room_id, user_id, status, display_name)
  values (new.id, new.created_by, 'active',
          (select p.display_name from public.profiles p where p.id = new.created_by))
  on conflict do nothing;
  return null;
end $$;

-- room_members: client KHÔNG ghi trực tiếp, chỉ qua RPC.
revoke insert, update, delete on public.room_members from anon, authenticated;
drop policy if exists "members read own" on public.room_members;
drop policy if exists "members read own or owner" on public.room_members;
create policy "members read own or owner" on public.room_members for select to authenticated
  using (user_id = auth.uid() or public.is_room_owner(room_id));

-- Tên hiển thị khi xin vào phòng: tài khoản thật dùng tên trong hồ sơ (không giả mạo được).
create or replace function private.member_name(p_name text)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when public.is_registered() then
      (select p.display_name from public.profiles p where p.id = auth.uid())
    else private.clean_name(p_name)
  end;
$$;

-- Vào phòng bằng mã. Trả về trạng thái: active (vào được) / pending (chờ duyệt) / banned.
drop function if exists public.join_room(text);
create or replace function public.join_room(p_slug text, p_name text default null)
returns table (
  id uuid, slug text, name text, visibility text, require_approval boolean,
  is_owner boolean, status text
)
language plpgsql security definer set search_path = '' as $$
declare
  r public.rooms;
  st text;
  uid uuid := auth.uid();
  nm text;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform private.hit('join', 60, interval '1 minute');

  select * into r from public.rooms where rooms.slug = lower(p_slug);
  if not found then
    return;
  end if;
  nm := private.member_name(p_name);

  select m.status into st from public.room_members m where m.room_id = r.id and m.user_id = uid;
  if st = 'banned' then
    -- không lộ tên / cài đặt phòng cho người bị chặn
    return query select r.id, r.slug, null::text, null::text, null::boolean, false, 'banned'::text;
    return;
  elsif st is not null then
    if st = 'pending' and (not r.require_approval or r.created_by = uid) then
      st := 'active';
    end if;
    update public.room_members m
       set last_seen_at = now(), status = st, display_name = coalesce(nm, m.display_name)
     where m.room_id = r.id and m.user_id = uid;
  else
    if r.require_approval and r.created_by is distinct from uid then
      if (select count(*) from public.room_members m where m.room_id = r.id and m.status = 'pending') >= 50 then
        raise exception 'Phòng đang có quá nhiều yêu cầu chờ duyệt, thử lại sau.' using errcode = 'PT429';
      end if;
      st := 'pending';
    else
      st := 'active';
    end if;
    insert into public.room_members (room_id, user_id, status, display_name)
    values (r.id, uid, st, nm);
  end if;

  if st = 'pending' then
    -- người chờ duyệt chỉ thấy tên phòng
    return query select r.id, r.slug, r.name, null::text, true, false, st;
  else
    return query select r.id, r.slug, r.name, r.visibility, r.require_approval, r.created_by = uid, st;
  end if;
end $$;

revoke all on function public.join_room(text, text) from public, anon;
grant execute on function public.join_room(text, text) to authenticated;

-- Chủ phòng duyệt / từ chối / mời ra / chặn / bỏ chặn.
create or replace function public.moderate_member(p_room uuid, p_user uuid, p_action text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  if not public.is_room_owner(p_room) then
    raise exception 'Chỉ chủ phòng mới làm được việc này' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'Không thể tự thao tác với chính mình' using errcode = '22023';
  end if;
  perform private.hit('moderate', 200, interval '1 minute');

  if p_action = 'approve' then
    update public.room_members set status = 'active', joined_at = now()
     where room_id = p_room and user_id = p_user and status = 'pending';
  elsif p_action = 'deny' then
    delete from public.room_members where room_id = p_room and user_id = p_user and status = 'pending';
  elsif p_action = 'remove' then
    delete from public.room_members where room_id = p_room and user_id = p_user and status = 'active';
  elsif p_action = 'ban' then
    update public.room_members set status = 'banned'
     where room_id = p_room and user_id = p_user and status in ('active', 'pending');
  elsif p_action = 'unban' then
    delete from public.room_members where room_id = p_room and user_id = p_user and status = 'banned';
  else
    raise exception 'Thao tác không hợp lệ' using errcode = '22023';
  end if;
  get diagnostics n = row_count;

  -- đổi khoá mã hoá để người bị mời ra không đọc được nội dung mới
  if n > 0 and p_action in ('remove', 'ban') then
    update public.rooms set key_epoch = key_epoch + 1 where id = p_room;
  end if;
  return n > 0;
end $$;
revoke all on function public.moderate_member(uuid, uuid, text) from public, anon;
grant execute on function public.moderate_member(uuid, uuid, text) to authenticated;

-- Thế hệ khoá hiện tại của phòng — chỉ thành viên. Server dùng để cấp khoá giải mã.
create or replace function public.room_key_epoch(p_room uuid)
returns int language plpgsql volatile security definer set search_path = '' as $$
declare e int;
begin
  perform private.hit('keys', 120, interval '1 minute');
  if not public.is_room_member(p_room) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select key_epoch into e from public.rooms where id = p_room;
  return e;
end $$;
revoke all on function public.room_key_epoch(uuid) from public, anon;
grant execute on function public.room_key_epoch(uuid) to authenticated;

-- Phòng của tôi (lưu theo tài khoản, xem được trên mọi thiết bị).
create or replace function public.list_my_rooms()
returns table (
  id uuid, slug text, name text, visibility text, require_approval boolean,
  is_owner boolean, saved boolean, last_seen_at timestamptz, member_count int, pending_count int
)
language sql stable security definer set search_path = '' as $$
  select r.id, r.slug, r.name, r.visibility, r.require_approval,
         r.created_by = auth.uid(), m.saved, m.last_seen_at,
         (select count(*)::int from public.room_members x where x.room_id = r.id and x.status = 'active'),
         case when r.created_by = auth.uid()
              then (select count(*)::int from public.room_members x where x.room_id = r.id and x.status = 'pending')
              else 0 end
  from public.room_members m
  join public.rooms r on r.id = m.room_id
  where m.user_id = auth.uid() and m.status = 'active'
  order by m.saved desc, m.last_seen_at desc
  limit 200;
$$;
revoke all on function public.list_my_rooms() from public, anon;
grant execute on function public.list_my_rooms() to authenticated;

create or replace function public.set_room_saved(p_room uuid, p_saved boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.room_members set saved = coalesce(p_saved, false)
   where room_id = p_room and user_id = auth.uid() and status = 'active';
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.set_room_saved(uuid, boolean) from public, anon;
grant execute on function public.set_room_saved(uuid, boolean) to authenticated;

create or replace function public.leave_room(p_room uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if public.is_room_owner(p_room) then
    raise exception 'Chủ phòng không thể rời phòng (hãy xoá phòng)' using errcode = '22023';
  end if;
  -- người bị chặn không tự "rời" để gỡ chặn được
  delete from public.room_members where room_id = p_room and user_id = auth.uid() and status <> 'banned';
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.leave_room(uuid) from public, anon;
grant execute on function public.leave_room(uuid) to authenticated;

-- Danh sách phòng công khai (chỉ lộ slug, tên, số người — không lộ chủ phòng hay nội dung).
create or replace function public.list_public_rooms(p_search text default null)
returns table (slug text, name text, require_approval boolean, member_count int, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.slug, r.name, r.require_approval,
         (select count(*)::int from public.room_members x where x.room_id = r.id and x.status = 'active'),
         r.created_at
  from public.rooms r
  where r.visibility = 'public'
    and (coalesce(btrim(p_search), '') = ''
         or r.name ilike '%' || replace(replace(replace(left(btrim(p_search), 60), '\', '\\'), '%', '\%'), '_', '\_') || '%')
  order by r.created_at desc
  limit 50;
$$;
revoke all on function public.list_public_rooms(text) from public, anon;
grant execute on function public.list_public_rooms(text) to authenticated;

-- ═════════════════════════ tin nhắn (mã hoá) ════════════════════════
-- Nội dung chat được TRÌNH DUYỆT mã hoá AES-256-GCM bằng khoá của phòng trước khi gửi.
-- DB chỉ chấp nhận chuỗi mã hoá "e1.<kid>.<iv>.<ciphertext>" → không thể lưu bản rõ.
alter table public.messages add column if not exists author_verified boolean not null default false;
alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages drop constraint if exists messages_content_encrypted;
alter table public.messages add constraint messages_content_encrypted check (
  char_length(content) <= 24000
  and content ~ '^e1\.[A-Za-z0-9_-]{8}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$'
) not valid;
create index if not exists messages_user_idx on public.messages(user_id);

create or replace function public.tg_messages_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare p public.profiles;
begin
  perform private.hit('msg', 12, interval '10 seconds');
  perform private.hit('msg_long', 300, interval '10 minutes');
  new.user_id    := auth.uid();
  new.created_at := now();
  -- tài khoản thật: tên & màu lấy từ hồ sơ → không mạo danh được; đánh dấu "đã xác thực"
  if public.is_registered() then
    select * into p from public.profiles where id = auth.uid();
  end if;
  if p.id is not null then
    new.author_name := p.display_name;
    new.author_color := p.color;
    new.author_verified := true;
  else
    new.author_name := coalesce(private.clean_name(new.author_name), 'Khách');
    new.author_verified := false;
  end if;
  return new;
end $$;

-- ═════════════════════════ phần tử bảng vẽ (mã hoá) ═══════════════════
alter table public.elements drop constraint if exists elements_data_encrypted;
alter table public.elements add constraint elements_data_encrypted check (
  jsonb_typeof(data -> 'enc') = 'string'
  and (data - 'enc') = '{}'::jsonb
  and (data ->> 'enc') ~ '^e1\.[A-Za-z0-9_-]{8}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$'
) not valid;

create or replace function private.tg_elements_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- pg_trigger_depth() > 1: xoá dây chuyền (xoá phòng / xoá tài khoản) → không tính rate limit
  if pg_trigger_depth() = 1 then
    perform private.hit('el', 3000, interval '1 minute');
  end if;
  if tg_op = 'INSERT' and not exists (select 1 from public.elements e where e.id = new.id) then
    if (select count(*) from (select 1 from public.elements e where e.room_id = new.room_id limit 10000) s) >= 10000 then
      raise exception 'Bảng đã đạt giới hạn 10.000 phần tử' using errcode = 'PT413';
    end if;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists elements_guard on public.elements;
create trigger elements_guard before insert or update or delete on public.elements
for each row execute function private.tg_elements_guard();

-- ═════════════════════════ chuyển dữ liệu khách → tài khoản ═════════════
-- Khách (ẩn danh) tạo phòng rồi mới đăng nhập: chuyển phòng/thành viên/tin nhắn sang tài khoản.
-- Khách tạo một mã bí mật (chỉ lưu bản băm SHA-256, hết hạn 30 phút), tài khoản dùng mã đó để nhận.
create table if not exists private.guest_claims (
  token_hash bytea primary key,
  anon_id    uuid not null,
  expires_at timestamptz not null
);

create or replace function public.create_guest_claim()
returns text language plpgsql security definer set search_path = '' as $$
declare tok text;
begin
  if auth.uid() is null or not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Chỉ dành cho khách' using errcode = '42501';
  end if;
  perform private.hit('claim', 20, interval '1 hour');
  delete from private.guest_claims where anon_id = auth.uid() or expires_at < now();
  tok := encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.guest_claims (token_hash, anon_id, expires_at)
  values (extensions.digest(tok, 'sha256'), auth.uid(), now() + interval '30 minutes');
  return tok;
end $$;
revoke all on function public.create_guest_claim() from public, anon;
grant execute on function public.create_guest_claim() to authenticated;

create or replace function public.claim_guest(p_token text)
returns int language plpgsql security definer set search_path = '' as $$
declare
  gid uuid;
  me uuid := auth.uid();
  n int;
begin
  if not public.is_registered() then
    raise exception 'Cần đăng nhập' using errcode = '42501';
  end if;
  perform private.hit('claim', 20, interval '1 hour');
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Mã không hợp lệ' using errcode = '22023';
  end if;
  delete from private.guest_claims
   where token_hash = extensions.digest(p_token, 'sha256') and expires_at > now()
  returning anon_id into gid;
  if gid is null or gid = me
     or not exists (select 1 from auth.users u where u.id = gid and u.is_anonymous) then
    raise exception 'Mã không hợp lệ hoặc đã hết hạn' using errcode = '22023';
  end if;

  insert into public.room_members as t (room_id, user_id, status, display_name, saved, joined_at, last_seen_at)
  select g.room_id, me, g.status, (select p.display_name from public.profiles p where p.id = me),
         g.saved, g.joined_at, g.last_seen_at
  from public.room_members g where g.user_id = gid
  on conflict (room_id, user_id) do update set
    status = case when t.status = 'banned' or excluded.status = 'banned' then 'banned'
                  when t.status = 'active' or excluded.status = 'active' then 'active'
                  else 'pending' end,
    saved = t.saved or excluded.saved,
    last_seen_at = greatest(t.last_seen_at, excluded.last_seen_at);

  update public.rooms set created_by = me where created_by = gid;
  get diagnostics n = row_count;
  update public.room_members m set status = 'active'
   where m.user_id = me and m.room_id in (select r.id from public.rooms r where r.created_by = me);
  update public.messages set user_id = me where user_id = gid;
  delete from public.room_members where user_id = gid;
  delete from auth.users where id = gid and is_anonymous;
  return n;
end $$;
revoke all on function public.claim_guest(text) from public, anon;
grant execute on function public.claim_guest(text) to authenticated;

-- ═════════════════════════ xoá tài khoản ═══════════════════════════
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if not public.is_registered() then
    raise exception 'Cần đăng nhập' using errcode = '42501';
  end if;
  delete from public.rooms where created_by = me;         -- xoá phòng mình tạo (kèm nội dung)
  delete from public.messages where user_id = me;         -- xoá tin nhắn mình gửi ở phòng khác
  delete from public.room_members where user_id = me;
  delete from private.rate_limits where user_id = me;
  delete from auth.users where id = me;                   -- hồ sơ bị xoá theo (on delete cascade)
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ═════════════════════════ góp ý & đánh giá ═══════════════════════════
-- Nội dung góp ý + email liên hệ được SERVER mã hoá (AES-256-GCM, khoá ENCRYPTION_KEY) trước khi lưu.
-- Không ai đọc được bảng này qua API (không có policy SELECT); chủ app đọc bằng script
-- `npm run feedback:read` (cần secret key + ENCRYPTION_KEY).
create table if not exists public.feedback (
  id           uuid primary key,
  user_id      uuid not null default auth.uid(),
  registered   boolean not null default false,
  rating       smallint check (rating between 1 and 5),
  category     text not null check (category in ('rating', 'bug', 'idea', 'other')),
  message_enc  text check (char_length(message_enc) <= 8000
                          and message_enc ~ '^s1\.[A-Za-z0-9_-]{8}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$'),
  contact_enc  text check (char_length(contact_enc) <= 1400
                          and contact_enc ~ '^s1\.[A-Za-z0-9_-]{8}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$'),
  page         text check (page is null or (char_length(page) <= 200 and page ~ '^/[A-Za-z0-9/_?=&%.-]*$' and page !~ '^//')),
  emailed      boolean not null default false,
  created_at   timestamptz not null default now(),
  check (rating is not null or message_enc is not null)
);
create index if not exists feedback_created_idx on public.feedback(created_at desc);

alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;
-- không có policy nào → client không đọc / ghi / xoá trực tiếp được; chỉ qua RPC bên dưới

-- Gửi góp ý. Chống spam: theo người dùng, theo IP (server truyền khoá IP đã băm), và trần toàn hệ thống.
-- Trả về true nếu còn quota gửi email trong ngày (để server quyết định có gửi mail không).
create or replace function public.submit_feedback(
  p_id uuid, p_rating int, p_category text, p_message_enc text, p_contact_enc text,
  p_page text, p_ip_key uuid default null
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  n int;
  quota boolean;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform private.hit('feedback', 3, interval '10 minutes');
  perform private.hit('feedback_day', 10, interval '1 day');
  if p_ip_key is not null then
    -- bộ đếm theo IP dùng chung bảng rate_limits với khoá = hash(IP)
    insert into private.rate_limits as r (user_id, kind, window_start, hits)
    values (p_ip_key, 'feedback_ip', now(), 1)
    on conflict (user_id, kind) do update set
      hits = case when r.window_start <= now() - interval '1 hour' then 1 else r.hits + 1 end,
      window_start = case when r.window_start <= now() - interval '1 hour' then now() else r.window_start end
    returning hits into n;
    if n > 10 then
      raise exception 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.' using errcode = 'PT429';
    end if;
  end if;
  -- trần toàn hệ thống: tối đa 500 góp ý / ngày (chống bot tạo nhiều tài khoản khách)
  if (select count(*) from public.feedback where created_at > now() - interval '1 day') >= 500 then
    raise exception 'Hệ thống đang nhận quá nhiều góp ý, thử lại sau.' using errcode = 'PT429', hint = 'feedback_cap';
  end if;
  quota := (select count(*) from public.feedback where emailed and created_at > now() - interval '1 day') < 90;

  insert into public.feedback (id, user_id, registered, rating, category, message_enc, contact_enc, page, emailed)
  values (p_id, uid, public.is_registered(), p_rating, p_category, p_message_enc, p_contact_enc, p_page, quota);
  return quota;
end $$;
revoke all on function public.submit_feedback(uuid, int, text, text, text, text, uuid) from public, anon;
grant execute on function public.submit_feedback(uuid, int, text, text, text, text, uuid) to authenticated;

-- Thống kê đánh giá công khai (chỉ số trung bình + số lượt, không lộ nội dung).
create or replace function public.feedback_stats()
returns table (average numeric, total int)
language sql stable security definer set search_path = '' as $$
  select round(avg(rating)::numeric, 1), count(rating)::int from public.feedback where rating is not null;
$$;
revoke all on function public.feedback_stats() from public, anon;
grant execute on function public.feedback_stats() to authenticated;
