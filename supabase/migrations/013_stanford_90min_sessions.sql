-- 013_stanford_90min_sessions.sql
-- Stanford teaching sessions run 90 minutes (Kevin, 7 Oct 2026): POST cases
-- open at 12:00, not 11:30. Also removes the staff test rows (TEST- codes)
-- left by the 7 Oct window check. One transaction; safe to re-run.

begin;

update public.study_sessions
   set ends_at    = starts_at + interval '90 minutes',
       note       = case session_id
                        when 'STAN1022' then 'Stanford session, Thu 22 Oct 10:30-12:00.'
                        when 'STAN1105' then 'Stanford session, Thu 5 Nov 10:30-12:00 (to confirm).'
                    end,
       updated_at = now()
 where session_id in ('STAN1022', 'STAN1105');

delete from public.assessment_ai_log    where attempt_id in (select id from public.test_attempts where user_code like 'TEST-%');
delete from public.assessment_responses where attempt_id in (select id from public.test_attempts where user_code like 'TEST-%');
delete from public.test_attempts        where user_code like 'TEST-%';

commit;

-- Check: both Stanford sessions end at 12:00 Pacific; POST closes 5 Nov and 19 Nov, 23:59.
select s.session_id, s.starts_at, s.ends_at, d.pre_closes, d.post_opens, d.post_closes
  from public.study_sessions s
  left join lateral public.session_window_dates(s.session_id) d on true
 where s.site = 1
 order by s.starts_at;
