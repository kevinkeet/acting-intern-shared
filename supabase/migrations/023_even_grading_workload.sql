-- 023_even_grading_workload.sql
-- Even grading workload (Kevin, 23 Oct 2026): "we haven't finalized all our graders yet, but will want
-- to have an intelligent way to distribute the workload so it is even".
--
-- Each finished study case still goes to two roster graders, and nothing a grader has started ever
-- moves. What changes is how the two are chosen and what happens when the roster changes.
--
--   A new case      goes, one grader at a time, to whoever has the fewest cases of the same kind (same
--                   case, same arm), then the fewest answers overall, then the fewest cases shared with
--                   the grader already on it, then at random. Every grader gets the same mix of Case 1,
--                   2 and 3 and of PRE and POST, and a grader who joins late catches up on the kinds of
--                   case still coming in. Catching up on totals alone would hand a late joiner mostly
--                   POST cases (every case graded before 23 Oct is PRE), and then how strictly that one
--                   grader scores would show up as a difference between the arms.
--   A grader added  also takes over cases another grader has not opened yet, wherever that evens the
--                   work out. Not opened = assigned after that grader last loaded their queue, and no
--                   grade saved on it.
--   A grader leaves (role removed, or notes changed to TEST...) and gives back the cases they have not
--                   started; those go to the others. Cases they started stay with them and show in
--                   grading_workload() for the study team to decide.
--
-- grading_workload() (admins only) lists each grader's cases, answers, graded, still to grade, and the
-- mix by case and arm. The adjudication page shows it. Graders never see arms or codes.
-- One transaction; safe to re-run. If the editor offers "Run and enable RLS", choose "Run without RLS":
-- the one new table turns RLS on itself.

begin;

-- When each roster grader last loaded their study queue (the grading page calls
-- assign_pending_grading() just before it reads the queue). An assignment made after that has not
-- been shown to them yet, so it can still move.
create table if not exists public.grader_queue_seen (
    grader_id  uuid primary key references auth.users(id) on delete cascade,
    seen_at    timestamptz not null default now()
);
alter table public.grader_queue_seen enable row level security;
revoke all on public.grader_queue_seen from anon, authenticated;

-- Everything assigned before this migration counts as seen, so nothing assigned today moves.
insert into public.grader_queue_seen (grader_id, seen_at)
select ar.user_id, now()
  from public.admin_roles ar
 where ar.role = 'grader' and coalesce(ar.notes, '') not ilike 'TEST%'
on conflict (grader_id) do nothing;

-- Finished study cases that need grading: a study case, completed, a genuine four-digit code.
-- arm comes from participant_windows: 1 PRE, 2 POST, 0 not registered yet.
create or replace function public._grading_cases()
returns table (attempt_id uuid, case_id text, arm smallint, answers integer, completed_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select a.id, a.case_id, coalesce(w.arm, 0)::smallint,
           (select count(*)::int from public.assessment_responses r where r.attempt_id = a.id),
           a.completed_at
      from public.test_attempts a
      left join public.participant_windows w on w.code = a.user_code
     where a.status = 'completed'
       and a.case_id in ('PAT003', 'PAT004', 'PAT005', 'PAT006', 'PAT007')
       and a.user_code ~ '^[0-9]{4}$';
$$;
revoke all on function public._grading_cases() from public, anon, authenticated;

-- Roster graders: role grader, notes not starting TEST.
create or replace function public._grading_roster()
returns table (grader_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select ar.user_id
      from public.admin_roles ar
     where ar.role = 'grader' and coalesce(ar.notes, '') not ilike 'TEST%';
$$;
revoke all on function public._grading_roster() from public, anon, authenticated;

-- Has grader g saved any grade (draft or submitted) on case a?
create or replace function public._grading_started(a uuid, g uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists (select 1
                     from public.human_grades hg
                     join public.assessment_responses r on r.id = hg.response_id
                    where r.attempt_id = a and hg.grader_id = g);
$$;
revoke all on function public._grading_started(uuid, uuid) from public, anon, authenticated;

create or replace function public.assign_pending_grading()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    changed integer := 0;
    k       integer;
    n       integer;
    att     record;
    mv      record;
    pick    uuid;
    rounds  integer := 0;
begin
    if not public.is_study_grader() then
        return 0;
    end if;
    -- One caller at a time, so two graders opening their queues together cannot both fill a case.
    perform pg_advisory_xact_lock(hashtext('public.assign_pending_grading'));

    select count(*) into n from public._grading_roster();
    -- An empty roster is more likely a slip than everyone leaving: change nothing.
    if n > 0 then
        -- 1. Graders who have left the roster give back the cases they have not started.
        delete from public.grading_assignments ga
         where ga.grader_id not in (select r.grader_id from public._grading_roster() r)
           and not public._grading_started(ga.attempt_id, ga.grader_id);
        get diagnostics k = row_count;
        changed := changed + k;

        -- 2. Every finished case gets its graders, one at a time: fewest cases of the same kind
        --    (case and arm), then fewest answers, then fewest cases shared with the grader
        --    already on it, then at random.
        for att in
            select c.attempt_id, c.case_id, c.arm
              from public._grading_cases() c
             where (select count(*) from public.grading_assignments x where x.attempt_id = c.attempt_id) < least(2, n)
             order by c.completed_at nulls last, c.attempt_id
        loop
            loop
                exit when (select count(*) from public.grading_assignments x
                            where x.attempt_id = att.attempt_id) >= least(2, n);
                pick := null;
                with cases as materialized (select * from public._grading_cases()),
                     onit as (select x.grader_id from public.grading_assignments x where x.attempt_id = att.attempt_id),
                     work as (select y.grader_id,
                                     count(*) filter (where c.case_id = att.case_id and c.arm = att.arm) as same_kind,
                                     sum(c.answers) as answers
                                from public.grading_assignments y
                                join cases c on c.attempt_id = y.attempt_id
                               group by y.grader_id),
                     shared as (select p.grader_id, count(*) as together
                                  from public.grading_assignments p
                                  join public.grading_assignments q on q.attempt_id = p.attempt_id and q.grader_id <> p.grader_id
                                 where q.grader_id in (select o.grader_id from onit o)
                                 group by p.grader_id)
                select r.grader_id into pick
                  from public._grading_roster() r
                  left join work w on w.grader_id = r.grader_id
                  left join shared s on s.grader_id = r.grader_id
                 where r.grader_id not in (select o.grader_id from onit o)
                 order by coalesce(w.same_kind, 0), coalesce(w.answers, 0), coalesce(s.together, 0), random()
                 limit 1;
                exit when pick is null;
                insert into public.grading_assignments (attempt_id, grader_id, assigned_by)
                values (att.attempt_id, pick, 'auto')
                on conflict do nothing;
                changed := changed + 1;
            end loop;
        end loop;

        -- 3. Even out cases nobody has opened yet: move one from a grader to another roster grader when
        --    that narrows a gap of two or more cases of that kind or, with the kind within one, a gap
        --    in answers larger than the case itself. Biggest gap first, until nothing improves.
        loop
            rounds := rounds + 1;
            exit when rounds > 500;
            with cases as materialized (select * from public._grading_cases()),
                 roster as (select r.grader_id from public._grading_roster() r),
                 asg as (select ga.attempt_id, ga.grader_id, ga.assigned_at, c.case_id, c.arm, c.answers
                           from public.grading_assignments ga
                           join cases c on c.attempt_id = ga.attempt_id),
                 kinds as (select distinct c.case_id, c.arm from cases c),
                 cell as (select r.grader_id, kd.case_id, kd.arm,
                                 (select count(*) from asg a
                                   where a.grader_id = r.grader_id and a.case_id = kd.case_id and a.arm = kd.arm) as n
                            from roster r cross join kinds kd),
                 load as (select r.grader_id,
                                 (select coalesce(sum(a.answers), 0) from asg a where a.grader_id = r.grader_id) as answers
                            from roster r),
                 movable as (select a.*
                               from asg a
                               join roster r on r.grader_id = a.grader_id
                               left join public.grader_queue_seen s on s.grader_id = a.grader_id
                              where a.assigned_at > coalesce(s.seen_at, '-infinity'::timestamptz)
                                and not public._grading_started(a.attempt_id, a.grader_id))
            select m.attempt_id, m.grader_id as from_grader, h.grader_id as to_grader into mv
              from movable m
              join cell cf on cf.grader_id = m.grader_id and cf.case_id = m.case_id and cf.arm = m.arm
              join load lf on lf.grader_id = m.grader_id
              join roster h on h.grader_id <> m.grader_id
              join cell ct on ct.grader_id = h.grader_id and ct.case_id = m.case_id and ct.arm = m.arm
              join load lt on lt.grader_id = h.grader_id
             where not exists (select 1 from public.grading_assignments x
                                where x.attempt_id = m.attempt_id and x.grader_id = h.grader_id)
               and (cf.n - ct.n >= 2 or (cf.n - ct.n = 1 and lf.answers - lt.answers > m.answers))
             order by cf.n - ct.n desc, lf.answers - lt.answers desc, random()
             limit 1;
            exit when not found;
            update public.grading_assignments
               set grader_id = mv.to_grader, assigned_at = now(), assigned_by = 'rebalance'
             where attempt_id = mv.attempt_id and grader_id = mv.from_grader;
            changed := changed + 1;
        end loop;
    end if;

    -- 4. The caller is about to read their queue: everything assigned to them so far counts as seen.
    if exists (select 1 from public._grading_roster() r where r.grader_id = auth.uid()) then
        insert into public.grader_queue_seen (grader_id, seen_at)
        values (auth.uid(), now())
        on conflict (grader_id) do update set seen_at = excluded.seen_at;
    end if;
    return changed;
end;
$$;
revoke all on function public.assign_pending_grading() from public, anon;
grant execute on function public.assign_pending_grading() to authenticated;

-- Each grader's workload: roster graders, plus anyone who left the roster with cases still assigned.
create or replace function public._grading_workload()
returns table (grader_id uuid, email text, label text, on_roster boolean,
               cases integer, answers integer, graded integer, to_grade integer,
               case1 integer, case2 integer, case3 integer, other_cases integer,
               pre integer, post integer, no_arm integer, last_queue timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    with cases as materialized (select * from public._grading_cases()),
         roster as (select r.grader_id from public._grading_roster() r),
         asg as (select ga.grader_id, c.attempt_id, c.case_id, c.arm, c.answers
                   from public.grading_assignments ga
                   join cases c on c.attempt_id = ga.attempt_id),
         people as (select grader_id from roster union select grader_id from asg),
         done as (select hg.grader_id, count(*)::int as graded
                    from public.human_grades hg
                    join public.assessment_responses r on r.id = hg.response_id
                    join asg a on a.attempt_id = r.attempt_id and a.grader_id = hg.grader_id
                   where hg.status = 'submitted'
                   group by hg.grader_id),
         agg as (select p.grader_id,
                        count(a.attempt_id)::int as cases,
                        coalesce(sum(a.answers), 0)::int as answers,
                        count(*) filter (where a.case_id = 'PAT005')::int as case1,
                        count(*) filter (where a.case_id = 'PAT004')::int as case2,
                        count(*) filter (where a.case_id = 'PAT007')::int as case3,
                        count(*) filter (where a.case_id in ('PAT003', 'PAT006'))::int as other_cases,
                        count(*) filter (where a.arm = 1)::int as pre,
                        count(*) filter (where a.arm = 2)::int as post,
                        count(*) filter (where a.arm = 0)::int as no_arm
                   from people p
                   left join asg a on a.grader_id = p.grader_id
                  group by p.grader_id)
    select g.grader_id, u.email::text, ar.notes, g.grader_id in (select grader_id from roster),
           g.cases, g.answers, coalesce(d.graded, 0), g.answers - coalesce(d.graded, 0),
           g.case1, g.case2, g.case3, g.other_cases, g.pre, g.post, g.no_arm, s.seen_at
      from agg g
      left join done d on d.grader_id = g.grader_id
      left join auth.users u on u.id = g.grader_id
      left join public.admin_roles ar on ar.user_id = g.grader_id
      left join public.grader_queue_seen s on s.grader_id = g.grader_id
     order by 4 desc, ar.notes nulls last, u.email;
$$;
revoke all on function public._grading_workload() from public, anon, authenticated;

create or replace function public.grading_workload()
returns table (grader_id uuid, email text, label text, on_roster boolean,
               cases integer, answers integer, graded integer, to_grade integer,
               case1 integer, case2 integer, case3 integer, other_cases integer,
               pre integer, post integer, no_arm integer, last_queue timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select * from public._grading_workload() where public.is_study_admin();
$$;
revoke all on function public.grading_workload() from public, anon;
grant execute on function public.grading_workload() to authenticated;

commit;

-- Check: each grader's workload now. Nothing moves when this runs; new cases follow the new rule
-- from the next time a grader or admin opens a grading queue.
select coalesce(label, email) as grader, on_roster, cases, answers, graded, to_grade,
       case1, case2, case3, pre, post, no_arm
  from public._grading_workload();
