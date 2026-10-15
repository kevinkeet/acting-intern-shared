-- 017_register_without_session.sql
-- Register a participant before their session is known (Kevin, 15 Oct 2026). Stanford sign-ups go to
-- whichever workshop they end up attending, so they are registered at sign-up with site and arm only:
-- counted as enrolled (progress page, admin console), cases open (no window applies). After each
-- workshop the attendance list registers each attendee again with that session, which starts their
-- window (PRE closes at the session start; POST opens at its end for two weeks).
--
-- Registering a code without a session never clears a session it already has, so pasting a REDCap
-- report with blank session dates cannot undo earlier assignments. To take a registered participant
-- back to "no session" (for example someone set for 10/22 who did not attend), register them with the
-- session NONE.
--
-- One transaction; safe to re-run.

begin;

-- Site of a participant registered without a session (kept equal to the session's site otherwise).
alter table public.participant_windows
    add column if not exists site smallint check (site between 1 and 4);

update public.participant_windows w
   set site = s.site
  from public.study_sessions s
 where s.session_id = w.session_id
   and w.site is distinct from s.site;

-- Register (or correct) codes:
--   [{"code":"1007","session":"STAN1022","arm":2}]   with a session: its window applies
--   [{"code":"1034","site":1,"arm":2}]               no session yet: keeps any session the code already has
--   [{"code":"1009","session":"NONE","site":1,"arm":2}]   clears the session: cases open again
create or replace function public.admin_register_participants(p_rows jsonb)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    r        jsonb;
    sess     text;
    s_site   smallint;
    n        int := 0;
    rejected text[] := '{}';
begin
    if not public.is_study_admin() then
        raise exception 'Only study admins can register participants.';
    end if;
    for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
        sess := upper(coalesce(r->>'session', ''));
        if coalesce(r->>'code', '') !~ '^[0-9]{4}$' or coalesce(r->>'arm', '') !~ '^[12]$' then
            rejected := rejected || (coalesce(r->>'code', '?') || ' (code or arm)');
            continue;
        end if;

        if sess in ('', 'NONE') then
            if coalesce(r->>'site', '') !~ '^[1-4]$' then
                rejected := rejected || ((r->>'code') || ' (no session and no site)');
                continue;
            end if;
            insert into public.participant_windows (code, session_id, site, arm, note)
            values (r->>'code', null, (r->>'site')::smallint, (r->>'arm')::smallint,
                    'registered ' || to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD') || ', no session yet')
            on conflict (code) do update
                set session_id = case when sess = 'NONE' then null else participant_windows.session_id end,
                    site       = case when sess = 'NONE' or participant_windows.session_id is null
                                      then excluded.site else participant_windows.site end,
                    arm        = excluded.arm,
                    updated_at = now();
        else
            select s.site into s_site from public.study_sessions s where s.session_id = sess;
            if not found then
                rejected := rejected || ((r->>'code') || ' (' || sess || ')');
                continue;
            end if;
            insert into public.participant_windows (code, session_id, site, arm, note)
            values (r->>'code', sess, s_site, (r->>'arm')::smallint,
                    'registered ' || to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD'))
            on conflict (code) do update
                set session_id = excluded.session_id, site = excluded.site, arm = excluded.arm, updated_at = now();
        end if;
        n := n + 1;
    end loop;
    return json_build_object('registered', n, 'rejected', rejected);
end
$$;

-- Admin list: the site comes from the session, or from the registration when there is no session yet.
create or replace function public.admin_participant_windows()
returns table (code text, session_id text, site smallint, arm smallint, opens_at timestamptz,
               closes_at timestamptz, open boolean, note text, updated_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select w.code, w.session_id, coalesce(s.site, w.site), w.arm, x.opens_at, x.closes_at,
           public.study_window_open(w.code), w.note, w.updated_at
      from public.participant_windows w
      left join public.study_sessions s on s.session_id = w.session_id
      left join lateral public.study_window(w.code) x on true
     where public.is_study_admin()
     order by w.code;
$$;

-- Progress page (015): enrolled now includes participants registered without a session yet.
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
        select w.code, coalesce(s.site, w.site) as site
          from public.participant_windows w
          left join public.study_sessions s on s.session_id = w.session_id
         where w.code ~ '^[0-9]{4}$'
           and coalesce(s.site, w.site) is not null
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

revoke all on function public.admin_register_participants(jsonb) from public, anon;
revoke all on function public.admin_participant_windows() from public, anon;
grant execute on function public.admin_register_participants(jsonb) to authenticated;
grant execute on function public.admin_participant_windows() to authenticated;
revoke all on function public.study_progress(text) from public;
grant execute on function public.study_progress(text) to anon, authenticated;

commit;

-- Check: every registered study code with its site and session (sessionless rows show session_id null).
select coalesce(s.site, w.site) as site, count(*) as codes,
       count(*) filter (where w.session_id is null) as no_session_yet
  from public.participant_windows w
  left join public.study_sessions s on s.session_id = w.session_id
 where w.code ~ '^[0-9]{4}$'
 group by 1
 order by 1;
