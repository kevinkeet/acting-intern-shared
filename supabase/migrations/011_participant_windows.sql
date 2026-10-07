-- 011_participant_windows.sql
--
-- Study windows: when each participant code may work on the cases, tied to
-- the teaching session that participant attends (a site can hold several).
--   PRE arm  (REDCap arm 1): open from enrollment until their session starts,
--            so nobody does the "before" assessment after the workshop.
--   POST arm (REDCap arm 2): closed until their session ends, then open for
--            two weeks (to 23:59 local time on the 14th day after it).
-- The site does not know arms or sessions (REDCap does), so the study team
-- registers each enrolled code's session and arm (admin console > Windows).
-- Session times live once in study_sessions, so a moved session is one edit;
-- pre_closes_at / post_opens_at / post_closes_at override the defaults when a
-- session needs something different (CHA used the PRE deadline it announced).
-- A code that is not registered is unrestricted, so a slow registration never
-- locks a PRE resident out (it only leaves a POST resident unblocked until
-- registered). Per-code opens_at/closes_at override everything.
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
-- One transaction: if anything fails, nothing is applied. Safe to re-run.

begin;

-- ── Tables ───────────────────────────────────────────────────────────────
create table if not exists public.study_sessions (
    session_id      text primary key check (session_id ~ '^[A-Z]+[0-9]{4,6}$'),   -- e.g. STAN1022
    site            smallint not null check (site between 1 and 4),               -- 1 Stanford, 2 BIDMC, 3 CHA, 4 AdventHealth
    tz              text not null default 'America/Los_Angeles',
    starts_at       timestamptz,           -- workshop start
    ends_at         timestamptz,           -- workshop end
    pre_closes_at   timestamptz,           -- override; default = starts_at
    post_opens_at   timestamptz,           -- override; default = ends_at
    post_closes_at  timestamptz,           -- override; default = 23:59:59 local, 14 days after the workshop
    note            text,
    updated_at      timestamptz not null default now()
);
alter table public.study_sessions enable row level security;
revoke all on public.study_sessions from anon, authenticated;

create table if not exists public.participant_windows (
    code        text primary key check (code ~ '^[0-9]{4}$' or code like 'TEST-%'),
    session_id  text references public.study_sessions (session_id) on update cascade,
    arm         smallint check (arm in (1, 2)),   -- REDCap arm: 1 = PRE, 2 = POST
    opens_at    timestamptz,                      -- optional override
    closes_at   timestamptz,                      -- optional override
    note        text,
    updated_at  timestamptz not null default now()
);
alter table public.participant_windows enable row level security;
revoke all on public.participant_windows from anon, authenticated;

-- ── Window logic (internal; not granted to anon or authenticated) ───────
create or replace function public.session_window_dates(p_session text)
returns table (pre_closes timestamptz, post_opens timestamptz, post_closes timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select coalesce(s.pre_closes_at, s.starts_at),
           coalesce(s.post_opens_at, s.ends_at),
           coalesce(s.post_closes_at,
                    ((((s.ends_at at time zone s.tz)::date + 15)::timestamp) at time zone s.tz)
                      - interval '1 second')
      from public.study_sessions s
     where s.session_id = p_session;
$$;

create or replace function public.study_window(p_code text)
returns table (opens_at timestamptz, closes_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select coalesce(w.opens_at, case when w.arm = 2 then d.post_opens end),
           coalesce(w.closes_at, case when w.arm = 1 then d.pre_closes
                                      when w.arm = 2 then d.post_closes end)
      from public.participant_windows w
      left join lateral public.session_window_dates(w.session_id) d on true
     where w.code = p_code;
$$;
revoke all on function public.session_window_dates(text) from public, anon, authenticated;
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
create or replace function public.admin_study_sessions()
returns table (session_id text, site smallint, tz text, starts_at timestamptz, ends_at timestamptz,
               pre_closes timestamptz, post_opens timestamptz, post_closes timestamptz,
               participants bigint, note text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select s.session_id, s.site, s.tz, s.starts_at, s.ends_at,
           d.pre_closes, d.post_opens, d.post_closes,
           (select count(*) from public.participant_windows w where w.session_id = s.session_id),
           s.note
      from public.study_sessions s
      left join lateral public.session_window_dates(s.session_id) d on true
     where public.is_study_admin()
     order by s.starts_at nulls last, s.session_id;
$$;

create or replace function public.admin_participant_windows()
returns table (code text, session_id text, site smallint, arm smallint, opens_at timestamptz,
               closes_at timestamptz, open boolean, note text, updated_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select w.code, w.session_id, s.site, w.arm, x.opens_at, x.closes_at,
           public.study_window_open(w.code), w.note, w.updated_at
      from public.participant_windows w
      left join public.study_sessions s on s.session_id = w.session_id
      left join lateral public.study_window(w.code) x on true
     where public.is_study_admin()
     order by w.code;
$$;

-- Register (or correct) codes: [{"code":"1007","session":"STAN1022","arm":2}, ...]
create or replace function public.admin_register_participants(p_rows jsonb)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    r        jsonb;
    sess     text;
    n        int := 0;
    rejected text[] := '{}';
begin
    if not public.is_study_admin() then
        raise exception 'Only study admins can register participants.';
    end if;
    for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
        sess := upper(coalesce(r->>'session', ''));
        if coalesce(r->>'code', '') !~ '^[0-9]{4}$'
           or coalesce(r->>'arm', '') !~ '^[12]$'
           or not exists (select 1 from public.study_sessions s where s.session_id = sess) then
            rejected := rejected || (coalesce(r->>'code', '?') || ' (' || coalesce(nullif(sess, ''), 'no session') || ')');
            continue;
        end if;
        insert into public.participant_windows (code, session_id, arm, note)
        values (r->>'code', sess, (r->>'arm')::smallint,
                'registered ' || to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD'))
        on conflict (code) do update
            set session_id = excluded.session_id, arm = excluded.arm, updated_at = now();
        n := n + 1;
    end loop;
    return json_build_object('registered', n, 'rejected', rejected);
end
$$;

revoke all on function public.admin_study_sessions() from public, anon;
revoke all on function public.admin_participant_windows() from public, anon;
revoke all on function public.admin_register_participants(jsonb) from public, anon;
grant execute on function public.admin_study_sessions() to authenticated;
grant execute on function public.admin_participant_windows() to authenticated;
grant execute on function public.admin_register_participants(jsonb) to authenticated;

-- ── Sessions ─────────────────────────────────────────────────────────────
-- POST windows default to two weeks after the session (Kevin, 7 Oct 2026).
-- Stanford sessions run 90 minutes (Kevin, 7 Oct 2026).
insert into public.study_sessions (session_id, site, tz, starts_at, ends_at, pre_closes_at, note) values
    ('CHA1006', 3, 'America/New_York', '2026-10-06 12:00:00-04', '2026-10-06 13:00:00-04', '2026-10-05 23:59:59-04',
        'CHA workshop Tue 6 Oct (clock time approximate). PRE closed at the deadline residents were given, end of Mon 5 Oct ET.'),
    ('STAN1022', 1, 'America/Los_Angeles', '2026-10-22 10:30:00-07', '2026-10-22 12:00:00-07', null,
        'Stanford session, Thu 22 Oct 10:30-12:00.'),
    ('STAN1105', 1, 'America/Los_Angeles', '2026-11-05 10:30:00-08', '2026-11-05 12:00:00-08', null,
        'Stanford session, Thu 5 Nov 10:30-12:00 (to confirm).'),
    ('BIDMC1110', 2, 'America/New_York', null, null, null, 'BIDMC 10 Nov: set start and end times before outreach.'),
    ('ADVH1118', 4, 'America/New_York', null, null, null, 'AdventHealth Orlando 18 Nov: set start and end times before outreach.')
on conflict (session_id) do nothing;

-- ── Registered codes ─────────────────────────────────────────────────────
-- CHA enrollments so far (arms from REDCap); all attended the 6 Oct session.
insert into public.participant_windows (code, session_id, arm, note) values
    ('1001', 'CHA1006', 1, 'CHA PRE'),
    ('1005', 'CHA1006', 1, 'CHA PRE'),
    ('1006', 'CHA1006', 1, 'CHA PRE'),
    ('1002', 'CHA1006', 2, 'CHA POST'),
    ('1003', 'CHA1006', 2, 'CHA POST'),
    ('1004', 'CHA1006', 2, 'CHA POST')
on conflict (code) do update
    set session_id = excluded.session_id, arm = excluded.arm, note = excluded.note, updated_at = now();

-- Permanent staff test fixtures: one always closed, one not open until 2099.
insert into public.participant_windows (code, closes_at, note) values
    ('TEST-CLOSED', '2026-01-01 00:00:00+00', 'staff test fixture: always closed')
on conflict (code) do nothing;
insert into public.participant_windows (code, opens_at, note) values
    ('TEST-NOTYET', '2099-01-01 00:00:00+00', 'staff test fixture: not open yet')
on conflict (code) do nothing;

commit;
