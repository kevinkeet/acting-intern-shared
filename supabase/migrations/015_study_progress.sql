-- 015_study_progress.sql
-- Group-wide progress page (Kevin, 15 Oct 2026): per-site counts of participants enrolled, started and
-- completed, plus totals, shown at actingintern.com/progress/ to anyone holding the private link.
--
-- The link carries a key. study_progress(key) answers only when the key's SHA-256 is on file in
-- progress_link_keys, so the anon key alone gets nothing. The key itself is never stored or committed;
-- the study team adds its hash separately. Counts only: no codes, names, arms, timing or answers.
--
-- Enrolled  = codes registered on the site (admin console > Windows), by the site of their session.
-- Started   = enrolled codes with at least one study-case attempt since launch (18 Sep 2026).
-- Completed = enrolled codes that have completed all three study cases.
-- unregistered_started = study codes (1000-1999) that have started cases but are not registered yet,
-- so the page can say the enrolled count is behind.
--
-- One transaction; safe to re-run.

begin;

create table if not exists public.progress_link_keys (
    key_sha256 text primary key check (key_sha256 ~ '^[0-9a-f]{64}$'),
    label      text,
    created_at timestamptz not null default now()
);
alter table public.progress_link_keys enable row level security;
revoke all on public.progress_link_keys from anon, authenticated;

create or replace function public.study_progress(p_key text)
returns json
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    result json;
begin
    if p_key is null or not exists (
        select 1 from public.progress_link_keys k
         where k.key_sha256 = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')) then
        return null;
    end if;

    with reg as (
        select w.code, s.site
          from public.participant_windows w
          join public.study_sessions s on s.session_id = w.session_id
         where w.code ~ '^[0-9]{4}$'
    ),
    att as (
        select t.user_code as code,
               count(distinct t.case_id) filter (where t.status = 'completed') as done
          from public.test_attempts t
         where t.user_code ~ '^[0-9]{4}$'
           and t.case_id in ('PAT005', 'PAT004', 'PAT007')
           and t.started_at >= '2026-09-18T00:00:00Z'
         group by t.user_code
    ),
    per_site as (
        select r.site,
               count(*)                            as enrolled,
               count(a.code)                       as started,
               count(*) filter (where a.done >= 3) as completed
          from reg r
          left join att a on a.code = r.code
         group by r.site
    ),
    sess as (
        select s.site,
               coalesce(to_char((s.starts_at at time zone s.tz)::date, 'YYYY-MM-DD'),
                        '2026-' || substr(substring(s.session_id from '([0-9]{4})$'), 1, 2)
                               || '-' || substr(substring(s.session_id from '([0-9]{4})$'), 3, 2)) as day,
               s.starts_at is not null as time_set
          from public.study_sessions s
    )
    select json_build_object(
        'as_of', now(),
        'sites', (
            select json_agg(json_build_object(
                       'site', x.site,
                       'enrolled', coalesce(p.enrolled, 0),
                       'started', coalesce(p.started, 0),
                       'completed', coalesce(p.completed, 0),
                       'sessions', coalesce((select json_agg(json_build_object('date', se.day, 'time_set', se.time_set)
                                                             order by se.day)
                                               from sess se where se.site = x.site), '[]'::json))
                   order by x.site)
              from (select generate_series(1, 4) as site) x
              left join per_site p on p.site = x.site),
        'unregistered_started', (
            select count(*) from att a
             where a.code ~ '^1[0-9]{3}$'
               and not exists (select 1 from reg r where r.code = a.code))
    ) into result;
    return result;
end
$$;

revoke all on function public.study_progress(text) from public;
grant execute on function public.study_progress(text) to anon, authenticated;

commit;
