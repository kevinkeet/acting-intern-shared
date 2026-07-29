-- ---------------------------------------------------------------------------
-- 005_admin_read_all.sql
--
-- Migration 004 scoped anon SELECT on the three study tables to the caller's
-- own x-participant-code header. That correctly stops one participant reading
-- another's rows, but it also left NOBODY able to read the study as a whole —
-- the admin dashboard at #/admin/attempts returned only the viewer's own data.
--
-- This migration adds an ADDITIVE path: a signed-in user listed in
-- public.admin_roles may SELECT every row. RLS policies are OR'd, so the
-- existing anon/code-scoped policies are untouched — participants stay boxed
-- into their own code, and no shared secret ships in the browser bundle.
--
-- Deliberately SELECT-only. Admins observe; they do not mutate participant
-- data from the browser. Repairs go through the Supabase dashboard, where they
-- are attributable.
-- ---------------------------------------------------------------------------

-- Helper: is the current JWT an admin or proctor?
-- SECURITY DEFINER so the lookup itself is not subject to admin_roles' own RLS
-- (otherwise the policy would recurse). search_path is pinned to defeat
-- search_path-hijack attacks against a definer function.
CREATE OR REPLACE FUNCTION public.is_study_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.admin_roles ar
        WHERE ar.user_id = auth.uid()
          AND ar.role IN ('admin', 'proctor')
    );
$$;

REVOKE ALL ON FUNCTION public.is_study_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_study_admin() TO authenticated;

COMMENT ON FUNCTION public.is_study_admin() IS
    'True when the calling authenticated user holds an admin/proctor row. Used by the admin read-all RLS policies added in 005.';

-- ---------------------------------------------------------------------------
-- Read-all policies (additive; anon code-scoped policies from 004 remain)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS p_test_attempts_select_admin ON public.test_attempts;
CREATE POLICY p_test_attempts_select_admin
    ON public.test_attempts
    FOR SELECT
    TO authenticated
    USING (public.is_study_admin());

DROP POLICY IF EXISTS p_assessment_responses_select_admin ON public.assessment_responses;
CREATE POLICY p_assessment_responses_select_admin
    ON public.assessment_responses
    FOR SELECT
    TO authenticated
    USING (public.is_study_admin());

DROP POLICY IF EXISTS p_assessment_ai_log_select_admin ON public.assessment_ai_log;
CREATE POLICY p_assessment_ai_log_select_admin
    ON public.assessment_ai_log
    FOR SELECT
    TO authenticated
    USING (public.is_study_admin());

-- Admins must also be able to read admin_roles to confirm their own status
-- from the client (the dashboard checks this before rendering).
DROP POLICY IF EXISTS p_admin_roles_select_self ON public.admin_roles;
CREATE POLICY p_admin_roles_select_self
    ON public.admin_roles
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

ALTER TABLE public.admin_roles ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- POST-MIGRATION, ONE TIME, IN THE SUPABASE SQL EDITOR
-- ---------------------------------------------------------------------------
-- 1. Create your admin account: Supabase Dashboard -> Authentication -> Users
--    -> "Add user" (email + password, mark email confirmed).
-- 2. Grant yourself the role, substituting your email:
--
--      INSERT INTO public.admin_roles (user_id, role)
--      SELECT id, 'admin' FROM auth.users WHERE email = 'kkeet@stanford.edu'
--      ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
--
-- 3. Verify (should return every attempt, not just your own):
--      SELECT count(*) FROM public.test_attempts;
-- ---------------------------------------------------------------------------
