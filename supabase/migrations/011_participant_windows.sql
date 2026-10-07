-- 011_participant_windows.sql
--
-- Study windows: when each participant code may work on the cases.
--   PRE arm  (REDCap arm 1): open from enrollment until the site's PRE
--            deadline, so nobody does the "before" assessment after the
--            workshop.
--   POST arm (REDCap arm 2): closed until the workshop is over, then open
--            until the site's POST window ends.
-- The site does not know arms (REDCap does), so the study team registers each
-- enrolled code's site and arm (admin console > Windows, pasted from REDCap).
-- Dates live once per site in site_sessions, so a moved workshop is one edit.
-- A code that is not registered is unrestricted, so a slow registration
-- never locks a PRE resident out (it only leaves a POST resident unblocked
-- until registered). Optional per-code opens_at/closes_at override the site.
--
-- Enforcement is twofold: the site asks my_study_window() before showing the
-- case list, starting or resuming a case, and saving each answer; the
-- restrictive policies below make the database refuse the same writes even
-- from a stale page. Restrictive policies are ANDed with the existing
-- permissive ones (002/004), so they can only remove access, never add it.
--
-- Neither table is readable by anon/authenticated. Admins read and register
-- through the admin_* functions (is_study_admin(): admin/proctor only, never
-- graders). A participant can learn only whether their own code is open.
--
-- Idempotent: safe to re-run.

-- ── Tables ───────────────────────────────────────────────────────────────
create table if not exists public.site_sessions (
    site            smallint primary key,      -- REDCap site: 1 Stanford, 2 BIDMC, 3 CHA, 4 AdventHealth
    name            text not null,
    pre_closes_at   timestamptz,               -- PRE arm: cases close (the PRE deadline)
    post_opens_at   timestamptz,               -- POST arm: cases open (after the workshop)
    post_closes_at  timestamptz,               -- POST arm: cases close
    note            text,
    updated_at      timestamptz not null default now()
);
alter table public.site_sessions enable row level security;
revoke all on public.site_sessions from anon, authenticated;

create table if not exists public.participant_windows (
    code        text primary key check (code ~ '^[0-9]{4}$' or code like 'TEST-%'),
    site        smallint check (site between 1 and 4),
    arm         smallint check (arm in (1, 2)),   -- REDCap arm: 1 = PRE, 2 = POST
    opens_at    timestamptz,                      -- optional override of the site schedule
    closes_at   timestamptz,                      -- optional override of the site schedule
    note        text,
    updated_at  timestamptz not null default now()
);
alter table public.participant_windows enable row level security;
revoke all on public.participant_windows from anon, authenticated;

-- ── Window logic ─────────────────────────────────────────────────────────
-- Not granted to anon: it would reveal any code's arm-derived dates.
create or replace function public.study_window(p_code text)
returns table (opens_at timestamptz, closes_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select coalesce(w.opens_at, case when w.arm = 2 then s.post_opens_at end),
           coalesce(w.closes_at, case when w.arm = 1 then s.pre_closes_at
                                      when w.arm = 2 then s.post_closes_at end)
      from public.participant_windows w
      left join public.site_sessions s on s.site = w.site
     where w.code = p_code;
$$;
revoke all on function public.study_window(text) from public, anon, authenticated;

create or replace function public.study_window_open(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select coalesce(
        (select (x.opens_at is null or now() >= x.opens_at)
            and (x.closes_at is null or now() < x.closes_at)
           from public.study_window(p_code) x),
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

-- What the site asks: is MY code (the x-participant-code header) open now?
create or replace function public.my_study_window()
returns json
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select json_build_object(
        'open',      public.study_window_open(c.code),
        'opens_at',  x.opens_at,
        'closes_at', x.closes_at,
        'now',       now())
      from (select public.participant_code() as code) c
      left join lateral public.study_window(c.code) x on true;
$$;
grant execute on function public.my_study_window() to anon, authenticated;
-- Needed by the policies below (policies run as the caller).
grant execute on function public.study_window_open(text) to anon, authenticated;
grant execute on function public.study_window_open_for_attempt(uuid) to anon, authenticated;

-- ── Database backstop (restrictive = ANDed with the existing policies) ──
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

-- ── Admin console (admin/proctor only) ───────────────────────────────────
create or replace function public.admin_site_sessions()
returns setof public.site_sessions
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select * from public.site_sessions where public.is_study_admin() order by site;
$$;

create or replace function public.admin_participant_windows()
returns table (code text, site smallint, arm smallint, opens_at timestamptz,
               closes_at timestamptz, open boolean, note text, updated_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select w.code, w.site, w.arm, x.opens_at, x.closes_at,
           public.study_window_open(w.code), w.note, w.updated_at
      from public.participant_windows w
      left join lateral public.study_window(w.code) x on true
     where public.is_study_admin()
     order by w.code;
$$;

-- Register (or correct) codes from REDCap: [{"code":"1007","site":1,"arm":2}, ...]
create or replace function public.admin_register_participants(p_rows jsonb)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    r        jsonb;
    n        int := 0;
    rejected text[] := '{}';
begin
    if not public.is_study_admin() then
        raise exception 'Only study admins can register participants.';
    end if;
    for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
        if coalesce(r->>'code', '') !~ '^[0-9]{4}$'
           or coalesce(r->>'site', '') !~ '^[1-4]$'
           or coalesce(r->>'arm', '') !~ '^[12]$' then
            rejected := rejected || coalesce(r->>'code', '?');
            continue;
        end if;
        insert into public.participant_windows (code, site, arm, note)
        values (r->>'code', (r->>'site')::smallint, (r->>'arm')::smallint,
                'registered ' || to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD'))
        on conflict (code) do update
            set site = excluded.site, arm = excluded.arm, updated_at = now();
        n := n + 1;
    end loop;
    return json_build_object('registered', n, 'rejected', rejected);
end
$$;

revoke all on function public.admin_site_sessions() from public, anon;
revoke all on function public.admin_participant_windows() from public, anon;
revoke all on function public.admin_register_participants(jsonb) from public, anon;
grant execute on function public.admin_site_sessions() to authenticated;
grant execute on function public.admin_participant_windows() to authenticated;
grant execute on function public.admin_register_participants(jsonb) to authenticated;

-- ── Site schedule ────────────────────────────────────────────────────────
-- CHA: PRE deadline end of Mon 5 Oct ET (what residents were told); workshop
-- Tue 6 Oct. POST end date not set yet. Stanford: PRE deadline end of Wed
-- 21 Oct PT; session Thu 22 Oct (POST opening at 1 pm PT is a placeholder
-- until the session end time is confirmed); POST closes end of Thu 5 Nov.
-- BIDMC and AdventHealth: fill in before their outreach (blank = no limits).
insert into public.site_sessions (site, name, pre_closes_at, post_opens_at, post_closes_at, note) values
    (3, 'Cambridge Health Alliance', '2026-10-05 23:59:59-04', '2026-10-06 13:00:00-04', null,
        'Workshop Tue 6 Oct; POST close date to be set'),
    (1, 'Stanford', '2026-10-21 23:59:59-07', '2026-10-22 13:00:00-07', '2026-11-05 23:59:59-08',
        'Session Thu 22 Oct; confirm session end time for post_opens_at'),
    (2, 'BIDMC', null, null, null, 'Workshop 10 Nov; set dates before outreach'),
    (4, 'AdventHealth Orlando', null, null, null, 'Workshop 18 Nov; set dates before outreach')
on conflict (site) do nothing;

-- ── Registered codes ─────────────────────────────────────────────────────
-- CHA enrollments so far (arms from REDCap).
insert into public.participant_windows (code, site, arm, note) values
    ('1001', 3, 1, 'CHA PRE'),
    ('1005', 3, 1, 'CHA PRE'),
    ('1006', 3, 1, 'CHA PRE'),
    ('1002', 3, 2, 'CHA POST'),
    ('1003', 3, 2, 'CHA POST'),
    ('1004', 3, 2, 'CHA POST')
on conflict (code) do update
    set site = excluded.site, arm = excluded.arm, note = excluded.note, updated_at = now();

-- Permanent staff test fixtures: one always closed, one not open until 2099.
insert into public.participant_windows (code, closes_at, note) values
    ('TEST-CLOSED', '2026-01-01 00:00:00+00', 'staff test fixture: always closed')
on conflict (code) do nothing;
insert into public.participant_windows (code, opens_at, note) values
    ('TEST-NOTYET', '2099-01-01 00:00:00+00', 'staff test fixture: not open yet')
on conflict (code) do nothing;
