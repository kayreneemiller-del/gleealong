-- Glee-Along 0003: server-side stats.
--
-- Everything here is SECURITY INVOKER, so the reveal-rule RLS from 0002 still applies underneath.
-- On top of that, "their" numbers are explicitly restricted to episodes BOTH of us submitted,
-- so a partial view can never leak a partner's averages over episodes I haven't reviewed.

-- One row per review with the three scales pivoted out. security_invoker => RLS on reviews/ratings applies.
create view public.review_scores with (security_invoker = true) as
select r.id as review_id, r.user_id, r.episode_id, r.status, r.overall_gleeks,
       max(x.value) filter (where x.scale = 'sue_c')         as sue_c,
       max(x.value) filter (where x.scale = 'schue_cringe')  as schue_cringe,
       max(x.value) filter (where x.scale = 'rachel_extra')  as rachel_extra
from public.reviews r
left join public.ratings x on x.review_id = r.id
group by r.id;

-- Averages, favorite/worst episode, and counter totals for one person's submitted reviews.
--   p_subject = me      -> all my submitted episodes
--   p_subject = partner -> only episodes where we have BOTH submitted
-- p_season null = all seasons.
create function public.season_stats(p_subject uuid, p_season integer default null) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  me     uuid := auth.uid();
  result jsonb;
begin
  if me is null then raise exception 'Sign in first, superstar.' using errcode = '28000'; end if;
  if p_subject <> me and not public.is_partner(p_subject) then
    raise exception 'You can only look at your own season or your partner''s.' using errcode = '42501';
  end if;

  with base as (
    select s.*, e.season, e.episode, e.title
    from public.review_scores s
    join public.episodes e on e.id = s.episode_id
    where s.user_id = p_subject
      and s.status = 'submitted'
      and (p_season is null or e.season = p_season)
      and (
        p_subject = me
        or exists (  -- mutual-only: I must have submitted this episode too
          select 1 from public.reviews m
          where m.user_id = me and m.episode_id = s.episode_id and m.status = 'submitted'
        )
      )
  ),
  pick as (
    select jsonb_build_object('episode_id', episode_id, 'season', season, 'episode', episode,
                              'title', title, 'overall_gleeks', overall_gleeks) as j,
           row_number() over (order by overall_gleeks desc, season, episode) as best,
           row_number() over (order by overall_gleeks asc,  season, episode) as worst
    from base
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
    'episodes_counted', (select count(*) from base),
    'averages', jsonb_build_object(
      'sue_c',          (select round(avg(sue_c), 2) from base),
      'schue_cringe',   (select round(avg(schue_cringe), 2) from base),
      'rachel_extra',   (select round(avg(rachel_extra), 2) from base),
      'overall_gleeks', (select round(avg(overall_gleeks), 2) from base)
    ),
    'favorite', (select j from pick where best = 1),
    'worst',    (select j from pick where worst = 1),
    'counters', (select j from totals)
  ) into result;
  return result;
end $$;

-- Episodes both of us submitted, ranked by how far apart our scores are
-- (mean absolute difference across the four scales).
create function public.biggest_disagreements(p_limit integer default 5, p_season integer default null)
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
    on b.episode_id = a.episode_id and b.user_id <> a.user_id and public.is_partner(b.user_id)
  join public.episodes e on e.id = a.episode_id
  where a.user_id = auth.uid()
    and a.status = 'submitted' and b.status = 'submitted'
    and (p_season is null or e.season = p_season)
  order by 5 desc, e.season, e.episode
  limit greatest(coalesce(p_limit, 5), 1)
$$;

revoke all on public.review_scores from anon, authenticated;
grant select on public.review_scores to authenticated;
revoke all on function public.season_stats(uuid, integer), public.biggest_disagreements(integer, integer) from public;
grant execute on function public.season_stats(uuid, integer), public.biggest_disagreements(integer, integer) to authenticated;
