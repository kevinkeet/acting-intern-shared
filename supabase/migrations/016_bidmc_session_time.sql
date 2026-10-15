-- 016_bidmc_session_time.sql
-- BIDMC workshop, Tue 10 Nov 2026. Kevin (15 Oct 2026): PRE closes at noon Eastern on the day of the
-- workshop. The session's clock time is not confirmed, so it is entered as 12:00-13:00 ET, the same
-- placeholder used for CHA: PRE closes at 12:00, POST opens at 13:00 and closes at the end of Tue 24 Nov ET
-- (the 14-day default). Setting the time also lets BIDMC codes be registered (admin console > Windows).
-- One transaction; safe to re-run.

begin;

update public.study_sessions
   set starts_at  = timestamp '2026-11-10 12:00' at time zone 'America/New_York',
       ends_at    = timestamp '2026-11-10 13:00' at time zone 'America/New_York',
       note       = 'BIDMC workshop Tue 10 Nov (clock time approximate). PRE closes at noon ET on the day of the '
                    || 'workshop (Kevin, 15 Oct 2026); POST opens at 1 pm ET.',
       updated_at = now()
 where session_id = 'BIDMC1110';

commit;

-- Check: PRE closes 10 Nov 12:00 ET, POST opens 13:00 ET, POST closes 24 Nov 23:59:59 ET.
select s.session_id,
       d.pre_closes  at time zone s.tz as pre_closes_local,
       d.post_opens  at time zone s.tz as post_opens_local,
       d.post_closes at time zone s.tz as post_closes_local
  from public.study_sessions s
  left join lateral public.session_window_dates(s.session_id) d on true
 where s.session_id = 'BIDMC1110';
