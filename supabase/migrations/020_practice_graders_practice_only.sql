-- 020_practice_graders_practice_only.sql
-- Practice graders (admin_roles notes starting "TEST") use the practice area only (Kevin, 19 Oct 2026).
-- Until now they could open every real study answer in study grading. From here:
--   grading_queue()  admins see every completed study answer, roster graders see the answers assigned
--                    to them, practice graders see none.
--   human_grades     practice graders can no longer save or read study grades (restrictive policy).
--   grader_kind()    tells the grading page which kind of account is signed in ('admin', 'study' or
--                    'practice'), so a practice account is sent to the practice area.
-- Making someone a study grader is still just removing "TEST" from their notes.
-- One transaction; safe to re-run.

begin;

create or replace function public.grader_kind()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select case
             when ar.role = 'admin' then 'admin'
             when ar.role = 'grader' and coalesce(ar.notes, '') ilike 'TEST%' then 'practice'
             when ar.role = 'grader' then 'study'
           end
      from public.admin_roles ar
     where ar.user_id = auth.uid();
$$;
revoke all on function public.grader_kind() from public, anon;
grant execute on function public.grader_kind() to authenticated;

create or replace function public.grading_queue()
returns table (response_id uuid, case_id text, assessment_id text, prompt_id text, response_text text,
               sort_key text, attempt_key text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select r.id, a.case_id, r.assessment_id, r.prompt_id, r.response_text,
           md5(a.id::text || coalesce(auth.uid()::text, '')) || '-' || r.prompt_id,
           md5(a.id::text)
      from public.assessment_responses r
      join public.test_attempts a on a.id = r.attempt_id
     where public.is_study_grader()
       and a.status = 'completed'
       and a.case_id in ('PAT003', 'PAT004', 'PAT005', 'PAT006', 'PAT007')
       and a.user_code ~ '^[0-9]{4}$'
       and (
             public.grader_kind() = 'admin'
          or exists (select 1 from public.grading_assignments ga
                      where ga.attempt_id = a.id and ga.grader_id = auth.uid())
       );
$$;
revoke all on function public.grading_queue() from public;
grant execute on function public.grading_queue() to authenticated;

drop policy if exists p_human_grades_not_practice on public.human_grades;
create policy p_human_grades_not_practice on public.human_grades
    as restrictive
    for all to authenticated
    using (public.grader_kind() is distinct from 'practice')
    with check (public.grader_kind() is distinct from 'practice');

commit;

-- Check: every grading account, its kind now, and study grades each has saved. Grades saved earlier by
-- practice accounts were never counted (adjudication and exports use roster graders only).
select u.email, ar.role, ar.notes,
       case when ar.role = 'admin' then 'admin'
            when coalesce(ar.notes, '') ilike 'TEST%' then 'practice'
            else 'study' end as kind,
       (select count(*) from public.human_grades hg where hg.grader_id = u.id) as study_grades_saved
  from public.admin_roles ar
  join auth.users u on u.id = ar.user_id
 where ar.role in ('grader', 'admin')
 order by kind, u.email;
