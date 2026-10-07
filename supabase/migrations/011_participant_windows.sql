-- 011_participant_windows.sql
--
-- Per-code study windows. The site does not know a participant's arm (that
-- lives in REDCap), so the study team records, per participant code, when
-- that code may work on the cases:
--   PRE arm  -> closes_at = the start of their site's workshop (or the PRE
--               deadline residents were given), so nobody completes the
--               "before" assessment after the intervention;
--   POST arm -> optionally opens_at = the workshop, closes_at = the end of
--               the POST window.
-- A code with no row is unrestricted (staff TEST- codes, pilots, and anyone
-- not yet entered), so a missing entry never locks a resident out.
--
-- Enforcement is twofold: the site asks my_study_window() before showing the
-- case list, starting or resuming a case, and saving each answer (clear
-- message to the resident), and the restrictive policies below make the
-- database refuse the same writes even from a stale page. Restrictive
-- policies are ANDed with the existing permissive ones (002/004), so they
-- can only remove access, never add it.
--
-- The table itself has no policies: anon/authenticated cannot read it. A
-- participant can learn only whether their own code (the x-participant-code
-- header) is open.
--
-- Idempotent: safe to re-run.

create table if not exists public.participant_windows (
    code        text primary key check (code ~ '^[0-9]{4}$' or code like 'TEST-%'),
    opens_at    timestamptz,
    closes_at   timestamptz,
    note        text,
    updated_at  timestamptz not null default now()
);
alter table public.participant_windows enable row level security;
revoke all on public.participant_windows from anon, authenticated;

create or replace function public.study_window_open(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select coalesce(
        (select (w.opens_at is null or now() >= w.opens_at)
            and (w.closes_at is null or now() < w.closes_at)
           from public.participant_windows w
          where w.code = p_code),
        true);
$$;

create or replace function public.study_window_open_for_attempt(p_attempt uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select coalesce(
        (select public.study_window_open(t.user_code)
           from public.test_attempts t
          where t.id = p_attempt),
        true);
$$;

-- What the site asks: is MY code (the request header) open right now?
create or replace function public.my_study_window()
returns json
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select json_build_object(
        'open',      public.study_window_open(x.c),
        'opens_at',  w.opens_at,
        'closes_at', w.closes_at,
        'now',       now())
      from (select public.participant_code() as c) x
      left join public.participant_windows w on w.code = x.c;
$$;
grant execute on function public.my_study_window() to anon, authenticated;
grant execute on function public.study_window_open(text) to anon, authenticated;
grant execute on function public.study_window_open_for_attempt(uuid) to anon, authenticated;

-- Database backstop (restrictive = ANDed with the existing policies).
drop policy if exists p_test_attempts_window_insert on public.test_attempts;
create policy p_test_attempts_window_insert on public.test_attempts
    as restrictive for insert
    with check (user_code is null or public.study_window_open(user_code));

drop policy if exists p_test_attempts_window_update on public.test_attempts;
create policy p_test_attempts_window_update on public.test_attempts
    as restrictive for update
    using (user_code is null or public.study_window_open(user_code));

drop policy if exists p_assessment_responses_window_insert on public.assessment_responses;
create policy p_assessment_responses_window_insert on public.assessment_responses
    as restrictive for insert
    with check (public.study_window_open_for_attempt(attempt_id));

drop policy if exists p_assessment_responses_window_update on public.assessment_responses;
create policy p_assessment_responses_window_update on public.assessment_responses
    as restrictive for update
    using (public.study_window_open_for_attempt(attempt_id));

-- ── Windows ──────────────────────────────────────────────────────────────
-- Cambridge Health Alliance, PRE arm: due by the end of Monday 5 Oct 2026
-- (Eastern), the deadline residents were given; workshop Tue 6 Oct.
insert into public.participant_windows (code, closes_at, note) values
    ('1001', '2026-10-05 23:59:59-04', 'CHA PRE: closed at the PRE deadline (end of Mon 5 Oct ET)'),
    ('1005', '2026-10-05 23:59:59-04', 'CHA PRE: closed at the PRE deadline (end of Mon 5 Oct ET)'),
    ('1006', '2026-10-05 23:59:59-04', 'CHA PRE: closed at the PRE deadline (end of Mon 5 Oct ET)')
on conflict (code) do update
    set closes_at = excluded.closes_at, note = excluded.note, updated_at = now();

-- Permanent staff test fixture: a code whose window is always closed, so the
-- site's closed screen and the database backstop can be checked any time.
insert into public.participant_windows (code, closes_at, note) values
    ('TEST-CLOSED', '2026-01-01 00:00:00+00', 'staff test fixture: always closed')
on conflict (code) do nothing;

-- Check: 4 rows; my_study_window() returns open=true with no header.
select code, opens_at, closes_at, note from public.participant_windows order by code;
