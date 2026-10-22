-- Glee-Along 0002: reviews, ratings, counters, notes + the REVEAL RULE.
--
-- REVEAL RULE: you can read the other person's review of an episode only if
--   (a) it is submitted, (b) they are in your pair, and (c) YOU have submitted
--   your own review of that same episode.
-- Drafts are visible only to their author. Everything below hangs off the
-- single `reviews_select` policy; child tables just ask "can I see the parent?".

create table public.reviews (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references public.users (id) on delete cascade,
  episode_id     integer not null references public.episodes (id),
  status         text not null default 'draft' check (status in ('draft', 'submitted')),
  overall_gleeks smallint check (overall_gleeks between 1 and 5),
  submitted_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, episode_id),
  check (status = 'draft' or (overall_gleeks is not null and submitted_at is not null))
);
create index reviews_episode_idx on public.reviews (episode_id);

create table public.ratings (
  review_id uuid not null references public.reviews (id) on delete cascade,
  scale     text not null check (scale in ('sue_c', 'schue_cringe', 'rachel_extra')),
  value     smallint not null check (value between 1 and 5),
  primary key (review_id, scale)
);

create table public.counters (
  review_id uuid not null references public.reviews (id) on delete cascade,
  counter   text not null check (counter in ('schue_creep', 'schue_rap', 'rachel_cries', 'brittana', 'sue_nicknames')),
  count     integer not null check (count between 0 and 999),
  primary key (review_id, counter)
);

create table public.notes (
  review_id uuid primary key references public.reviews (id) on delete cascade,
  body      text not null check (char_length(body) <= 10000)
);

-- ---------------------------------------------------------------------------
-- "Have I submitted this episode?" SECURITY DEFINER so the reviews policy can
-- ask it about reviews without recursing into itself.
-- ---------------------------------------------------------------------------
create function public.i_submitted(p_episode integer) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.reviews
    where user_id = auth.uid() and episode_id = p_episode and status = 'submitted'
  )
$$;

-- ---------------------------------------------------------------------------
-- Triggers: submitted means FINAL, even for roles that bypass RLS.
-- ---------------------------------------------------------------------------
create function public.reviews_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'submitted' then
      raise exception 'Submitted reviews are final. No take-backs, no encores.' using errcode = 'P0001';
    end if;
    return old;
  end if;

  if old.status = 'submitted' then
    raise exception 'Submitted reviews are final. No take-backs, no encores.' using errcode = 'P0001';
  end if;
  if new.user_id <> old.user_id or new.episode_id <> old.episode_id then
    raise exception 'A review cannot move to another user or episode.' using errcode = 'P0001';
  end if;

  if new.status = 'submitted' then
    if new.overall_gleeks is null
       or (select count(*) from public.ratings where review_id = new.id) < 3 then
      raise exception 'Rate everything (all four scales) before submitting.' using errcode = 'P0001';
    end if;
    new.submitted_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger reviews_guard_upd before update or delete on public.reviews
  for each row execute function public.reviews_guard();

create function public.child_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare rid uuid := coalesce(new.review_id, old.review_id);
begin
  if exists (select 1 from public.reviews where id = rid and status = 'submitted') then
    raise exception 'Submitted reviews are final. No take-backs, no encores.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger ratings_guard  before insert or update or delete on public.ratings  for each row execute function public.child_guard();
create trigger counters_guard before insert or update or delete on public.counters for each row execute function public.child_guard();
create trigger notes_guard    before insert or update or delete on public.notes    for each row execute function public.child_guard();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.reviews  enable row level security;
alter table public.ratings  enable row level security;
alter table public.counters enable row level security;
alter table public.notes    enable row level security;

create policy reviews_select on public.reviews for select to authenticated
  using (
    user_id = auth.uid()
    or (status = 'submitted' and public.is_partner(user_id) and public.i_submitted(episode_id))
  );
create policy reviews_insert on public.reviews for insert to authenticated
  with check (user_id = auth.uid() and status = 'draft');
create policy reviews_update on public.reviews for update to authenticated
  using (user_id = auth.uid() and status = 'draft')
  with check (user_id = auth.uid());
create policy reviews_delete on public.reviews for delete to authenticated
  using (user_id = auth.uid() and status = 'draft');

-- Children: readable iff the parent review is readable (subquery is itself RLS-filtered).
-- Writable only by the author while the parent is still a draft.
do $$
declare t text;
begin
  foreach t in array array['ratings', 'counters', 'notes'] loop
    execute format($f$create policy %1$s_select on public.%1$s for select to authenticated
      using (exists (select 1 from public.reviews r where r.id = review_id))$f$, t);
    execute format($f$create policy %1$s_write on public.%1$s for all to authenticated
      using (exists (select 1 from public.reviews r where r.id = review_id and r.user_id = auth.uid() and r.status = 'draft'))
      with check (exists (select 1 from public.reviews r where r.id = review_id and r.user_id = auth.uid() and r.status = 'draft'))$f$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Autosave + submit RPCs. SECURITY INVOKER: every write goes through RLS above.
-- save_draft takes a FULL snapshot (absolute values, not deltas), so retrying
-- after a flaky connection is idempotent.
-- payload: { overall_gleeks, notes, ratings: {sue_c,...}, counters: {schue_creep,...} }
-- ---------------------------------------------------------------------------
create function public.save_draft(p_episode_id integer, p_payload jsonb) returns public.reviews
language plpgsql security invoker set search_path = public as $$
declare
  uid uuid := auth.uid();
  r   public.reviews;
  k   text;
  v   text;
  body text := coalesce(p_payload ->> 'notes', '');
begin
  select * into r from public.reviews where user_id = uid and episode_id = p_episode_id;
  if found and r.status = 'submitted' then
    raise exception 'Submitted reviews are final. No take-backs, no encores.' using errcode = 'P0001';
  end if;

  insert into public.reviews (user_id, episode_id, overall_gleeks)
  values (uid, p_episode_id, nullif(p_payload ->> 'overall_gleeks', '')::smallint)
  on conflict (user_id, episode_id) do update set overall_gleeks = excluded.overall_gleeks
  returning * into r;

  foreach k in array array['sue_c', 'schue_cringe', 'rachel_extra'] loop
    v := p_payload -> 'ratings' ->> k;
    if v is null or v = '' then
      delete from public.ratings where review_id = r.id and scale = k;
    else
      insert into public.ratings (review_id, scale, value) values (r.id, k, v::smallint)
      on conflict (review_id, scale) do update set value = excluded.value;
    end if;
  end loop;

  foreach k in array array['schue_creep', 'schue_rap', 'rachel_cries', 'brittana', 'sue_nicknames'] loop
    insert into public.counters (review_id, counter, count)
    values (r.id, k, coalesce((p_payload -> 'counters' ->> k)::integer, 0))
    on conflict (review_id, counter) do update set count = excluded.count;
  end loop;

  if btrim(body) = '' then
    delete from public.notes where review_id = r.id;
  else
    insert into public.notes (review_id, body) values (r.id, body)
    on conflict (review_id) do update set body = excluded.body;
  end if;

  update public.reviews set updated_at = now() where id = r.id returning * into r;
  return r;
end $$;

create function public.submit_review(p_episode_id integer, p_payload jsonb default null) returns public.reviews
language plpgsql security invoker set search_path = public as $$
declare r public.reviews;
begin
  if p_payload is not null then
    perform public.save_draft(p_episode_id, p_payload);
  end if;
  update public.reviews set status = 'submitted'
   where user_id = auth.uid() and episode_id = p_episode_id
  returning * into r;
  if not found then
    raise exception 'Nothing to submit yet. Rate something first!' using errcode = 'P0001';
  end if;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on public.reviews, public.ratings, public.counters, public.notes from anon, authenticated;
grant select, insert, update, delete on public.reviews, public.ratings, public.counters, public.notes to authenticated;
revoke all on function public.i_submitted(integer), public.save_draft(integer, jsonb),
  public.submit_review(integer, jsonb) from public;
grant execute on function public.i_submitted(integer), public.save_draft(integer, jsonb),
  public.submit_review(integer, jsonb) to authenticated;
