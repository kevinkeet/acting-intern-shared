-- 018_post_locked_until_session.sql
-- POST stays locked until the participant is registered to the workshop they attended (Kevin, 15 Oct 2026).
-- A POST code registered without a session (or taken back to none) now gets opens_at 'infinity': the site
-- says their cases open after they attend their workshop, and the database refuses case work, until the
-- attendance paste registers the code to its session (then POST opens at that session's end as before).
-- PRE codes without a session stay open, and codes that are not registered at all stay unrestricted.
--
-- Also (Kevin): the Stanford enrollees registered for 22 Oct on 13 Oct were assigned before sessions came
-- from attendance and are probably not all in that group, so their session is cleared. Only Stanford
-- registrations made before 16 Oct are cleared, so re-running this after an attendance paste changes nothing.
--
-- One transaction; safe to re-run.

begin;

create or replace function public.study_window(p_code text)
returns table (opens_at timestamptz, closes_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select coalesce(w.opens_at, case when w.arm = 2 then coalesce(d.post_opens, 'infinity'::timestamptz) end),
           coalesce(w.closes_at, case when w.arm = 1 then d.pre_closes
                                      when w.arm = 2 then d.post_closes end)
      from public.participant_windows w
      left join lateral public.session_window_dates(w.session_id) d on true
     where w.code = p_code;
$$;
revoke all on function public.study_window(text) from public, anon, authenticated;

update public.participant_windows w
   set session_id = null,
       site       = 1,
       note       = coalesce(w.note, '') || '; session cleared 2026-10-15 (sessions now come from attendance)',
       updated_at = now()
  from public.study_sessions s
 where s.session_id = w.session_id
   and s.site = 1
   and w.updated_at < '2026-10-16 00:00:00-07';

commit;

-- Check: registered study codes by site and arm, how many have no session yet, and how many the site
-- lets in right now. Stanford POST should show open_now 0.
select coalesce(s.site, w.site) as site, w.arm, count(*) as codes,
       count(*) filter (where w.session_id is null) as no_session,
       count(*) filter (where public.study_window_open(w.code)) as open_now
  from public.participant_windows w
  left join public.study_sessions s on s.session_id = w.session_id
 where w.code ~ '^[0-9]{4}$'
 group by 1, 2
 order by 1, 2;
