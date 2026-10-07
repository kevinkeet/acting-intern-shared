-- 012_study_pulse_pilot_return.sql
--
-- 1. The work filed under "0slerian" (30 Sep - 1 Oct 2026, three cases, two
--    AI questions) was a returning pilot user, not an enrolled participant
--    (Kevin, 7 Oct). Relabel it PILOT-0930: kept, but outside every study
--    count and the REDCap export (which takes four-digit codes only).
-- 2. study_pulse() as applied on 2 Oct 2026 (v2), now also ignoring PILOT-
--    codes in its non-standard and health counts. Same fields as before.
--    Never returns a non-four-digit code as text: this function is callable
--    with the public anon key, and that code was the site password.
--
-- Idempotent: safe to re-run.

update public.test_attempts
   set user_code = 'PILOT-0930'
 where user_code = '0slerian';

create or replace function public.study_pulse()
returns json
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with a as (
    select id, user_code as code, case_id, status, started_at, completed_at, total_score
    from test_attempts
    where user_code ~ '^[0-9]{4}$'
      and case_id in ('PAT005','PAT004','PAT007')
      and started_at >= '2026-09-18T00:00:00Z'
  ),
  per_code as (
    select code,
           count(distinct case_id) filter (where status = 'completed') as cases_completed,
           count(*) as attempts,
           min(started_at) as first_seen,
           max(coalesce(completed_at, started_at)) as last_activity
    from a group by code
  ),
  -- in-progress rows left behind by a later completion of the same case (restarts)
  orphans as (
    select x.code, count(*) as n
    from a x
    where x.status = 'in_progress'
      and exists (select 1 from a y
                  where y.code = x.code and y.case_id = x.case_id and y.status = 'completed'
                    and coalesce(y.completed_at, now()) > x.started_at)
    group by x.code
  ),
  ai as (
    select t.user_code as code,
           count(*) filter (where l.interaction_type = 'ask') as asks,
           count(*) filter (where l.interaction_type = 'ask_error') as errors
    from assessment_ai_log l join test_attempts t on t.id = l.attempt_id
    where t.started_at >= '2026-09-18T00:00:00Z'
    group by t.user_code
  ),
  -- resident-looking rows whose code is neither a study code, a staff TEST code, nor PILOT-
  odd as (
    select user_code as code, count(*) as attempts,
           count(distinct case_id) filter (where status = 'completed') as cases_completed,
           max(coalesce(completed_at, started_at)) as last_activity
    from test_attempts
    where started_at >= '2026-09-18T00:00:00Z'
      and case_id in ('PAT005','PAT004','PAT007')
      and user_id is null
      and user_code !~ '^[0-9]{4}$'
      and user_code !~* '^((UI)?TEST|PILOT-)'
    group by user_code
  )
  select json_build_object(
    'as_of', now(),
    'participants_seen', (select count(*) from per_code),
    'finished_all_3', (select count(*) from per_code where cases_completed >= 3),
    'finished_2', (select count(*) from per_code where cases_completed = 2),
    'finished_1', (select count(*) from per_code where cases_completed = 1),
    'started_none_completed', (select count(*) from per_code where cases_completed = 0),
    'attempts_total', (select count(*) from a),
    'attempts_completed', (select count(*) from a where status = 'completed'),
    'by_case', (select json_object_agg(case_id, n) from (select case_id, count(distinct code) filter (where status = 'completed') as n from a group by case_id) c),
    'last_activity', (select max(last_activity) from per_code),
    'new_participants_24h', (select count(*) from per_code where first_seen >= now() - interval '24 hours'),
    'completions_24h', (select count(*) from a where status = 'completed' and completed_at >= now() - interval '24 hours'),
    'ai_messages', (select coalesce(sum(asks), 0) from ai where code ~ '^[0-9]{4}$'),
    'ai_errors_24h', (select count(*) from assessment_ai_log l join test_attempts t on t.id = l.attempt_id
                      where l.interaction_type = 'ask_error' and l.timestamp >= now() - interval '24 hours'
                        and t.user_id is null and t.user_code !~* '^((UI)?TEST|PILOT-)'),
    'ungraded_responses', (select count(*) from assessment_responses r join test_attempts t on t.id = r.attempt_id
                           where t.started_at >= '2026-09-18T00:00:00Z' and t.user_id is null
                             and t.user_code !~* '^((UI)?TEST|PILOT-)'
                             and r.score is null and r.submitted_at < now() - interval '15 minutes'),
    'restarts_total', (select coalesce(sum(n), 0) from orphans),
    'feedback_rows', (select count(*) from feedback where created_at >= '2026-09-18T00:00:00Z'),
    'stalled_codes', (select coalesce(json_agg(json_build_object('code', code, 'done', cases_completed, 'last', last_activity) order by last_activity), '[]'::json)
                      from per_code where cases_completed < 3 and last_activity < now() - interval '3 days'),
    'progress', (select coalesce(json_agg(json_build_object('code', p.code, 'done', p.cases_completed, 'last', p.last_activity,
                                                            'ai', coalesce(ai.asks, 0), 'restarts', coalesce(o.n, 0)) order by p.code), '[]'::json)
                 from per_code p left join ai on ai.code = p.code left join orphans o on o.code = p.code),
    'nonstandard_codes', (select count(*) from odd),
    'nonstandard_completed_cases', (select coalesce(sum(cases_completed), 0) from odd),
    'nonstandard_ai', (select coalesce(sum(ai.asks), 0) from odd d join ai on ai.code = d.code),
    'nonstandard_last_activity', (select max(last_activity) from odd),
    'staff_test_attempts', (select count(*) from test_attempts where started_at >= '2026-09-18T00:00:00Z' and user_code ~* '^(UI)?TEST')
  );
$$;
revoke all on function public.study_pulse() from public;
grant execute on function public.study_pulse() to anon, authenticated;
