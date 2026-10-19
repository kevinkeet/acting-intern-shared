-- 019_grading_practice.sql
-- Grading practice area (Kevin, 19 Oct 2026): graders practise on answers from the Aug-Sep 2026 pilot
-- (usability phase, not trial data) at #/grade-practice, apart from real study grading at #/grade.
--
-- practice_items holds the pilot answers: case, question and answer text only (no participant code).
-- practice_grades holds practice scores, one row per grader per item, in their own table, so practice
-- never reaches human_grades, grading assignment, adjudication or any export. The answers themselves
-- are loaded separately by the study team and are never committed to this public repository.
--
-- One transaction; safe to re-run.

begin;

create table if not exists public.practice_items (
    id            uuid primary key default gen_random_uuid(),
    case_id       text not null,
    prompt_id     text not null,
    response_text text not null,
    text_hash     text generated always as (md5(response_text)) stored,
    sort_key      text not null,               -- display order within a case (the same for every grader)
    source        text not null default 'pilot, Aug-Sep 2026',
    created_at    timestamptz not null default now(),
    unique (case_id, prompt_id, text_hash)
);
alter table public.practice_items enable row level security;
revoke all on public.practice_items from anon, authenticated;

create table if not exists public.practice_grades (
    item_id     uuid not null references public.practice_items (id) on delete cascade,
    grader_id   uuid not null references auth.users (id) on delete cascade,
    criteria    jsonb not null default '[]'::jsonb,
    points      numeric(6, 2),
    max_points  numeric(6, 2),
    notes       text,
    updated_at  timestamptz not null default now(),
    primary key (item_id, grader_id)
);
alter table public.practice_grades enable row level security;
revoke all on public.practice_grades from anon;
grant select, insert, update, delete on public.practice_grades to authenticated;
drop policy if exists p_practice_grades_own on public.practice_grades;
create policy p_practice_grades_own on public.practice_grades
    for all to authenticated
    using (grader_id = auth.uid() and public.is_study_grader())
    with check (grader_id = auth.uid() and public.is_study_grader());

-- Every grader (TEST or roster) and every admin sees all practice items.
create or replace function public.practice_queue()
returns table (item_id uuid, case_id text, prompt_id text, response_text text, sort_key text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select p.id, p.case_id, p.prompt_id, p.response_text, p.sort_key
      from public.practice_items p
     where public.is_study_grader()
     order by p.case_id, p.sort_key;
$$;
revoke all on function public.practice_queue() from public, anon;
grant execute on function public.practice_queue() to authenticated;

-- Other graders' practice points on one item, without names, and only once the caller has saved their
-- own practice grade for it (so nobody is anchored before they score).
create or replace function public.practice_others(p_item uuid)
returns table (points numeric, max_points numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select g.points, g.max_points
      from public.practice_grades g
     where g.item_id = p_item
       and g.grader_id <> auth.uid()
       and public.is_study_grader()
       and exists (select 1 from public.practice_grades mine
                    where mine.item_id = p_item and mine.grader_id = auth.uid())
     order by g.points;
$$;
revoke all on function public.practice_others(uuid) from public, anon;
grant execute on function public.practice_others(uuid) to authenticated;

commit;

-- Check: practice tables exist (items are loaded separately).
select (select count(*) from public.practice_items) as practice_items,
       (select count(*) from public.practice_grades) as practice_grades;
