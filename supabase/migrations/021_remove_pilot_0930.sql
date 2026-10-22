-- 021_remove_pilot_0930.sql
-- Remove PILOT-0930 from the study database (Kevin, 22 Oct 2026).
-- PILOT-0930 is a returning pilot user's work from 30 Sep - 1 Oct 2026 (relabeled
-- from the site password in migration 012): 4 case attempts, 21 answers, 2 AI
-- questions, no grades. It was already outside every study count and the REDCap
-- export; this takes it off the admin pages and the "include everything" export.
--
-- A copy of every removed row is kept first in public.archived_rows, a table no
-- page or API key can read (row-level security on, no policies). Drop that table
-- whenever the copy is no longer wanted.
-- Deleting the attempts also deletes their answers, AI log, grades, adjudications
-- and grading assignments (ON DELETE CASCADE). Feedback rows would only lose
-- their link (ON DELETE SET NULL), so they are archived and deleted explicitly.
-- One transaction; safe to re-run (a second run finds nothing).
-- Supabase's SQL editor flags the temporary table as "created without RLS". Choose
-- "Run without RLS": the "Run and enable RLS" option adds an ALTER for the temporary
-- table after COMMIT, when it no longer exists, so the run ends in a harmless 42P01
-- error after everything above has committed (what happened when this ran on 22 Oct
-- 2026: PILOT-0930 was gone afterwards).

begin;

create table if not exists public.archived_rows (
    id            bigserial primary key,
    archived_at   timestamptz not null default now(),
    reason        text not null,
    source_table  text not null,
    row_data      jsonb not null
);
alter table public.archived_rows enable row level security;
revoke all on public.archived_rows from anon, authenticated;

create temporary table pilot_0930_attempts on commit drop as
    select id from public.test_attempts where user_code = 'PILOT-0930';

insert into public.archived_rows (reason, source_table, row_data)
          select 'PILOT-0930 removed (Kevin, 22 Oct 2026)', 'test_attempts', to_jsonb(t)
            from public.test_attempts t where t.id in (select id from pilot_0930_attempts)
union all select 'PILOT-0930 removed (Kevin, 22 Oct 2026)', 'assessment_responses', to_jsonb(r)
            from public.assessment_responses r where r.attempt_id in (select id from pilot_0930_attempts)
union all select 'PILOT-0930 removed (Kevin, 22 Oct 2026)', 'assessment_ai_log', to_jsonb(l)
            from public.assessment_ai_log l where l.attempt_id in (select id from pilot_0930_attempts)
union all select 'PILOT-0930 removed (Kevin, 22 Oct 2026)', 'human_grades', to_jsonb(g)
            from public.human_grades g
            join public.assessment_responses r on r.id = g.response_id
           where r.attempt_id in (select id from pilot_0930_attempts)
union all select 'PILOT-0930 removed (Kevin, 22 Oct 2026)', 'grade_adjudications', to_jsonb(j)
            from public.grade_adjudications j
            join public.assessment_responses r on r.id = j.response_id
           where r.attempt_id in (select id from pilot_0930_attempts)
union all select 'PILOT-0930 removed (Kevin, 22 Oct 2026)', 'grading_assignments', to_jsonb(s)
            from public.grading_assignments s where s.attempt_id in (select id from pilot_0930_attempts)
union all select 'PILOT-0930 removed (Kevin, 22 Oct 2026)', 'feedback', to_jsonb(f)
            from public.feedback f where f.attempt_id in (select id from pilot_0930_attempts);

delete from public.feedback where attempt_id in (select id from pilot_0930_attempts);
delete from public.test_attempts where id in (select id from pilot_0930_attempts);

commit;

-- Check: nothing left under PILOT-0930, and what the archive holds.
select (select count(*) from public.test_attempts where user_code = 'PILOT-0930') as attempts_left,
       (select json_object_agg(source_table, n)
          from (select source_table, count(*) as n from public.archived_rows
                 where reason like 'PILOT-0930%' group by source_table) s) as archived_rows_by_table;
