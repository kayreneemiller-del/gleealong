-- Glee-Along 0001: pairs, users, episodes, invite-code pairing.
-- Supabase provides the `auth` schema, auth.uid(), and the anon/authenticated roles.

create table public.pairs (
  id          uuid primary key default gen_random_uuid(),
  invite_code text not null unique,
  created_at  timestamptz not null default now()
);

create table public.users (
  id           uuid primary key references auth.users (id) on delete cascade,
  pair_id      uuid not null references public.pairs (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  created_at   timestamptz not null default now()
);
create index users_pair_id_idx on public.users (pair_id);
-- Two people in one pair must be tellable apart.
create unique index users_pair_name_uniq on public.users (pair_id, lower(btrim(display_name)));

create table public.episodes (
  id          integer generated always as identity primary key,
  season      smallint not null check (season between 1 and 6),
  episode     smallint not null check (episode >= 1),
  title       text not null,
  verify_note text,           -- non-null = a human should double-check this row
  unique (season, episode)
);

-- ---------------------------------------------------------------------------
-- Helpers. SECURITY DEFINER so policies can ask "who is in my pair?" without
-- recursing into the very RLS policies that call them.
-- ---------------------------------------------------------------------------
create function public.my_pair_id() returns uuid
language sql stable security definer set search_path = public as $$
  select pair_id from public.users where id = auth.uid()
$$;

create function public.is_partner(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user is not null
     and p_user <> auth.uid()
     and exists (
       select 1 from public.users u
       where u.id = p_user and u.pair_id = public.my_pair_id()
     )
$$;

-- A pair holds at most two people, even if someone bypasses the RPCs.
create function public.enforce_pair_size() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.pairs where id = new.pair_id for update;
  if (select count(*) from public.users where pair_id = new.pair_id) >= 2 then
    raise exception 'This pair already has two people. The Glee club is full!' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger users_pair_size before insert on public.users
  for each row execute function public.enforce_pair_size();

-- ---------------------------------------------------------------------------
-- Pairing RPCs. Clients never write pairs/users directly.
-- Invite codes: 8 chars from an alphabet without 0/O/1/I/L, shown as XXXX-XXXX.
-- ---------------------------------------------------------------------------
create function public.generate_invite_code() returns text
language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text := '';
begin
  for i in 1..8 loop
    code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return code;
end $$;

create function public.create_pair(p_display_name text) returns public.pairs
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  pr  public.pairs;
begin
  if uid is null then raise exception 'Sign in first, superstar.' using errcode = '28000'; end if;
  if exists (select 1 from public.users where id = uid) then
    raise exception 'You are already in a pair.' using errcode = 'P0001';
  end if;
  loop
    begin
      insert into public.pairs (invite_code) values (public.generate_invite_code()) returning * into pr;
      exit;
    exception when unique_violation then
      null; -- astronomically unlikely code collision; try again
    end;
  end loop;
  insert into public.users (id, pair_id, display_name) values (uid, pr.id, btrim(p_display_name));
  return pr;
end $$;

create function public.join_pair(p_code text, p_display_name text) returns public.pairs
language plpgsql security definer set search_path = public as $$
declare
  uid  uuid := auth.uid();
  norm text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  pr   public.pairs;
begin
  if uid is null then raise exception 'Sign in first, superstar.' using errcode = '28000'; end if;
  if exists (select 1 from public.users where id = uid) then
    raise exception 'You are already in a pair.' using errcode = 'P0001';
  end if;
  select * into pr from public.pairs where invite_code = norm for update;
  -- Same message for "no such code" and "pair full" so codes can't be probed.
  if not found or (select count(*) from public.users where pair_id = pr.id) >= 2 then
    raise exception 'That invite code did not work. Check it and try again.' using errcode = 'P0001';
  end if;
  insert into public.users (id, pair_id, display_name) values (uid, pr.id, btrim(p_display_name));
  return pr;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.pairs    enable row level security;
alter table public.users    enable row level security;
alter table public.episodes enable row level security;

create policy pairs_select on public.pairs for select to authenticated
  using (id = public.my_pair_id());

create policy users_select on public.users for select to authenticated
  using (id = auth.uid() or pair_id = public.my_pair_id());

create policy episodes_select on public.episodes for select to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- Privileges: read-only for clients; all writes go through the RPCs above.
-- ---------------------------------------------------------------------------
revoke all on public.pairs, public.users, public.episodes from anon, authenticated;
grant select on public.pairs, public.users, public.episodes to authenticated;

revoke all on function public.my_pair_id(), public.is_partner(uuid),
  public.generate_invite_code(), public.create_pair(text), public.join_pair(text, text)
  from public;
grant execute on function public.my_pair_id(), public.is_partner(uuid) to authenticated;
grant execute on function public.create_pair(text), public.join_pair(text, text) to authenticated;
