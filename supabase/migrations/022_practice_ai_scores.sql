-- 022_practice_ai_scores.sql
-- The AI grader's score on each practice (pilot) answer, shown in the practice area once a
-- grader has saved their own score for that answer (Kevin, 22 Oct 2026: "for the grader
-- practice, let's add a thing of what the AI thinks the score should be"). Practice only:
-- study grading never shows AI scores, and graders stay blind to them there.
--
-- The scores come from the study's own grader code (js/services/assessment-grader.js:
-- claude-sonnet-5, three independent gradings, the middle one kept), run on the pilot answers
-- on 22 Oct 2026. That score data is loaded separately: the pilot answers, and the grader's
-- notes about them, are not committed to this public repository.
-- One transaction; safe to re-run.

begin;

alter table public.practice_items
    add column if not exists ai_points      numeric,
    add column if not exists ai_max_points  numeric,
    add column if not exists ai_score       numeric,
    add column if not exists ai_awarded     jsonb,
    add column if not exists ai_missed      jsonb,
    add column if not exists ai_penalties   jsonb,
    add column if not exists ai_notes       text,
    add column if not exists ai_model       text,
    add column if not exists ai_graded_at   timestamptz;

-- The AI grader's score for one practice answer, returned only to a grader who has already
-- saved their own practice score for it (the same rule as practice_others), so nobody sees
-- the AI's reading before committing to their own.
create or replace function public.practice_ai(p_item uuid)
returns table (points numeric, max_points numeric, awarded jsonb, missed jsonb, penalties jsonb, notes text, model text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select p.ai_points, p.ai_max_points, p.ai_awarded, p.ai_missed, p.ai_penalties, p.ai_notes, p.ai_model
      from public.practice_items p
     where p.id = p_item
       and p.ai_points is not null
       and public.is_study_grader()
       and exists (select 1 from public.practice_grades mine
                    where mine.item_id = p_item and mine.grader_id = auth.uid());
$$;
revoke all on function public.practice_ai(uuid) from public, anon;
grant execute on function public.practice_ai(uuid) to authenticated;

commit;
