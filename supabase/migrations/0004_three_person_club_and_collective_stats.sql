-- Glee-Along 0004: a club holds up to three people, plus the collective season stats.
--
-- The reveal rule from 0002 needs no change: `is_partner()` already means "someone in my pair",
-- so with three members each pairing of (me, partner) unlocks independently, per episode.
--
-- COLLECTIVE RULE: a season's collective stats unlock only when EVERY current member has a
-- submitted review of EVERY episode in that season (and the club has at least two members).
-- Someone joining mid-season relocks it until they catch up.

-- ---------------------------------------------------------------------------
-- Club size: one place to change the cap.
-- ---------------------------------------------------------------------------
create function public.pair_max_size() returns integer
language sql immutable as $$ select 3 $$;

create or replace function public.enforce_pair_size() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.pairs where id = new.pair_id for update;
  if (select count(*) from public.users where pair_id = new.pair_id) >= public.pair_max_size() then
    raise exception 'This club is full. The Glee club only has room for % people!', public.pair_max_size() using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function public.join_pair(p_code text, p_display_name text) returns public.pairs
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
  -- Same message for "no such code" and "club full" so codes can't be probed.
  if not found or (select count(*) from public.users where pair_id = pr.id) >= public.pair_max_size() then
    raise exception 'That invite code did not work. Check it and try again.' using errcode = 'P0001';
  end if;
  insert into public.users (id, pair_id, display_name) values (uid, pr.id, btrim(p_display_name));
  return pr;
end $$;

revoke all on function public.pair_max_size() from public;
grant execute on function public.pair_max_size() to authenticated;

-- ---------------------------------------------------------------------------
-- Pairwise disagreements, now aimed at one named partner (with three people the old
-- "any partner" join would have listed each episode once per partner).
-- ---------------------------------------------------------------------------
drop function public.biggest_disagreements(integer, integer);

create function public.biggest_disagreements(p_partner uuid, p_limit integer default 5, p_season integer default null)
returns table (episode_id integer, season smallint, episode smallint, title text, score numeric, scales jsonb)
language sql stable security invoker set search_path = public as $$
  select e.id, e.season, e.episode, e.title,
         round((abs(a.sue_c - b.sue_c) + abs(a.schue_cringe - b.schue_cringe)
              + abs(a.rachel_extra - b.rachel_extra) + abs(a.overall_gleeks - b.overall_gleeks)) / 4.0, 2),
         jsonb_build_object(
           'sue_c',          jsonb_build_object('mine', a.sue_c,          'theirs', b.sue_c),
           'schue_cringe',   jsonb_build_object('mine', a.schue_cringe,   'theirs', b.schue_cringe),
           'rachel_extra',   jsonb_build_object('mine', a.rachel_extra,   'theirs', b.rachel_extra),
           'overall_gleeks', jsonb_build_object('mine', a.overall_gleeks, 'theirs', b.overall_gleeks))
  from public.review_scores a
  join public.review_scores b
    on b.episode_id = a.episode_id and b.user_id = p_partner and public.is_partner(b.user_id)
  join public.episodes e on e.id = a.episode_id
  where a.user_id = auth.uid()
    and a.status = 'submitted' and b.status = 'submitted'
    and (p_season is null or e.season = p_season)
  order by 5 desc, e.season, e.episode
  limit greatest(coalesce(p_limit, 5), 1)
$$;

revoke all on function public.biggest_disagreements(uuid, integer, integer) from public;
grant execute on function public.biggest_disagreements(uuid, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Season progress. SECURITY DEFINER because it has to count other members' submissions,
-- which RLS hides. It returns counts only: never who is missing, never any content.
-- ---------------------------------------------------------------------------
create function public.season_progress(p_season integer) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  pid     uuid := public.my_pair_id();
  members integer;
  total   integer;
  done    integer;
begin
  if auth.uid() is null then raise exception 'Sign in first, superstar.' using errcode = '28000'; end if;
  if pid is null then raise exception 'Join a club first.' using errcode = 'P0001'; end if;
  if p_season is null or p_season not between 1 and 6 then
    raise exception 'Pick a season from 1 to 6.' using errcode = 'P0001';
  end if;

  select count(*) into members from public.users where pair_id = pid;
  select count(*) into total   from public.episodes where season = p_season;
  select count(*) into done
  from public.episodes e
  where e.season = p_season
    and (
      select count(distinct r.user_id)
      from public.reviews r join public.users u on u.id = r.user_id
      where u.pair_id = pid and r.episode_id = e.id and r.status = 'submitted'
    ) = members;

  return jsonb_build_object(
    'season', p_season,
    'members', members,
    'total_episodes', total,
    'done_by_all', done,
    'unlocked', members >= 2 and total > 0 and done = total
  );
end $$;

revoke all on function public.season_progress(integer) from public;
grant execute on function public.season_progress(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Collective stats for one season. SECURITY INVOKER: the gate above decides whether it runs
-- at all, and RLS from 0002 still applies underneath. (Once unlocked, everyone has submitted
-- every episode, so everyone is already allowed to read everyone's reviews of the season.)
-- ---------------------------------------------------------------------------
create function public.collective_stats(p_season integer) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  prog   jsonb := public.season_progress(p_season);
  result jsonb;
begin
  if not (prog ->> 'unlocked')::boolean then
    raise exception 'This season isn''t unlocked yet. Everyone has to review every episode first.' using errcode = '42501';
  end if;

  with base as (
    select s.*, e.season, e.episode, e.title, u.display_name
    from public.review_scores s
    join public.episodes e on e.id = s.episode_id
    join public.users u on u.id = s.user_id
    where e.season = p_season
      and s.status = 'submitted'
      and u.pair_id = public.my_pair_id()
  ),
  per_episode as (
    select episode_id, season, episode, title,
           round(avg(overall_gleeks), 2) as avg_overall,
           round(((max(sue_c) - min(sue_c)) + (max(schue_cringe) - min(schue_cringe))
                + (max(rachel_extra) - min(rachel_extra)) + (max(overall_gleeks) - min(overall_gleeks))) / 4.0, 2) as spread,
           jsonb_build_object(
             'sue_c',          jsonb_build_object('min', min(sue_c),          'max', max(sue_c)),
             'schue_cringe',   jsonb_build_object('min', min(schue_cringe),   'max', max(schue_cringe)),
             'rachel_extra',   jsonb_build_object('min', min(rachel_extra),   'max', max(rachel_extra)),
             'overall_gleeks', jsonb_build_object('min', min(overall_gleeks), 'max', max(overall_gleeks))
           ) as ranges,
           jsonb_agg(jsonb_build_object('name', display_name, 'overall_gleeks', overall_gleeks) order by display_name) as by_member
    from base
    group by episode_id, season, episode, title
  ),
  pick as (
    select jsonb_build_object('episode_id', episode_id, 'season', season, 'episode', episode,
                              'title', title, 'avg_overall', avg_overall) as j,
           row_number() over (order by avg_overall desc, season, episode) as best,
           row_number() over (order by avg_overall asc,  season, episode) as worst
    from per_episode
  ),
  members as (
    select user_id, display_name,
           jsonb_build_object(
             'sue_c',          round(avg(sue_c), 2),
             'schue_cringe',   round(avg(schue_cringe), 2),
             'rachel_extra',   round(avg(rachel_extra), 2),
             'overall_gleeks', round(avg(overall_gleeks), 2)) as averages
    from base
    group by user_id, display_name
  ),
  totals as (
    select jsonb_build_object(
      'schue_creep',   coalesce(sum(c.count) filter (where c.counter = 'schue_creep'), 0),
      'schue_rap',     coalesce(sum(c.count) filter (where c.counter = 'schue_rap'), 0),
      'rachel_cries',  coalesce(sum(c.count) filter (where c.counter = 'rachel_cries'), 0),
      'brittana',      coalesce(sum(c.count) filter (where c.counter = 'brittana'), 0),
      'sue_nicknames', coalesce(sum(c.count) filter (where c.counter = 'sue_nicknames'), 0)
    ) as j
    from public.counters c join base b on b.review_id = c.review_id
  )
  select jsonb_build_object(
    'season', p_season,
    'members', prog -> 'members',
    'episodes_counted', (select count(*) from per_episode),
    'averages', jsonb_build_object(
      'sue_c',          (select round(avg(sue_c), 2) from base),
      'schue_cringe',   (select round(avg(schue_cringe), 2) from base),
      'rachel_extra',   (select round(avg(rachel_extra), 2) from base),
      'overall_gleeks', (select round(avg(overall_gleeks), 2) from base)
    ),
    'per_member', (select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'display_name', display_name, 'averages', averages)
                                             order by display_name), '[]') from members),
    'favorite', (select j from pick where best = 1),
    'worst',    (select j from pick where worst = 1),
    'counters', (select j from totals),
    'disagreements', (
      select coalesce(jsonb_agg(jsonb_build_object('episode_id', episode_id, 'season', season, 'episode', episode,
                                                   'title', title, 'spread', spread, 'ranges', ranges, 'by_member', by_member)
                                order by spread desc, season, episode), '[]')
      from (select * from per_episode order by spread desc, season, episode limit 5) top5
    )
  ) into result;
  return result;
end $$;

revoke all on function public.collective_stats(integer) from public;
grant execute on function public.collective_stats(integer) to authenticated;
