-- 014_cha_post_extension.sql
-- CHA POST residents get one more week to do the cases (Kevin, 14 Oct 2026). The POST
-- window for the 6 Oct CHA session now closes at the end of Tuesday 27 Oct, Eastern time,
-- instead of the end of Tuesday 20 Oct. It covers every POST code registered to CHA1006
-- (1002, 1003, 1004). PRE is unchanged: those residents have already had the workshop.
-- One transaction; safe to re-run.

begin;

update public.study_sessions
   set post_closes_at = '2026-10-27 23:59:59-04',
       note = 'CHA workshop Tue 6 Oct (clock time approximate). PRE closed at the deadline residents were given, '
              || 'end of Mon 5 Oct ET. POST extended one week to the end of Tue 27 Oct ET (Kevin, 14 Oct 2026).',
       updated_at = now()
 where session_id = 'CHA1006';

commit;

-- Check: POST closes 2026-10-28 03:59:59+00 (= 11:59:59 pm ET on 27 Oct), and the three POST codes are open.
select * from public.session_window_dates('CHA1006');
select w.code, w.arm, x.opens_at, x.closes_at, public.study_window_open(w.code) as open_now
  from public.participant_windows w
  cross join lateral public.study_window(w.code) x
 where w.session_id = 'CHA1006'
 order by w.code;
