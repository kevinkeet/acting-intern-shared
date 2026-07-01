-- 004_scope_code_based_access.sql
--
-- SECURITY FIX. Migration 003 let the anon role SELECT *every* code-based row
-- (USING (user_id IS NULL)) — any participant could read all other
-- participants' attempts, responses, and AI logs from DevTools. Migration 002
-- had the same blanket problem on UPDATE (anyone could tamper with any
-- code-based row).
--
-- Fix: scope code-based SELECT/UPDATE to the participant code presented in
-- the `x-participant-code` request header, which the app sets on its Supabase
-- client as soon as a code is chosen (see js/services/supabase-sync.js).
-- PostgREST exposes request headers to SQL via current_setting('request.headers').
--
-- Threat model note: codes are self-chosen, so this is scoping, not
-- authentication — someone who KNOWS another participant's code can still
-- read that participant's rows. That's acceptable for this proctored study;
-- what this closes is the "read/tamper EVERYTHING anonymously" hole.
--
-- INSERTs are unchanged (002). Their EXISTS checks against test_attempts are
-- evaluated under test_attempts RLS, so with the scoped SELECT policy a child
-- row can only be attached to an attempt whose code matches the header —
-- strictly stronger than before.
--
-- Idempotent: safe to re-run.
-- AFTER RUNNING: verify with the smoke test at the bottom of this file.

-- ── helper: the participant code presented on this request ────────────────
CREATE OR REPLACE FUNCTION public.participant_code()
RETURNS text
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(
        (current_setting('request.headers', true)::json ->> 'x-participant-code'),
        ''
    );
$$;

COMMENT ON FUNCTION public.participant_code() IS
    'Participant code from the x-participant-code request header (set by the app after code entry). NULL when absent.';

-- ── test_attempts ──────────────────────────────────────────────────────────
-- SELECT: only code-based rows whose user_code matches the presented header.
DROP POLICY IF EXISTS p_test_attempts_select_code ON public.test_attempts;
CREATE POLICY p_test_attempts_select_code
    ON public.test_attempts
    FOR SELECT
    USING (
        user_id IS NULL
        AND user_code IS NOT NULL
        AND user_code = public.participant_code()
    );

-- UPDATE: replace 002's blanket code-based branch with a header-scoped one.
DROP POLICY IF EXISTS p_test_attempts_update ON public.test_attempts;
CREATE POLICY p_test_attempts_update ON public.test_attempts
    FOR UPDATE
    USING (
        (auth.uid() IS NOT NULL AND user_id = auth.uid())
        OR (user_id IS NULL AND user_code IS NOT NULL AND user_code = public.participant_code())
    )
    WITH CHECK (
        (auth.uid() IS NOT NULL AND user_id = auth.uid())
        OR (user_id IS NULL AND user_code IS NOT NULL AND user_code = public.participant_code())
    );

-- ── assessment_responses ───────────────────────────────────────────────────
DROP POLICY IF EXISTS p_assessment_responses_select_code ON public.assessment_responses;
CREATE POLICY p_assessment_responses_select_code
    ON public.assessment_responses
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.test_attempts t
            WHERE t.id = assessment_responses.attempt_id
              AND t.user_id IS NULL
              AND t.user_code IS NOT NULL
              AND t.user_code = public.participant_code()
        )
    );

DROP POLICY IF EXISTS p_assessment_responses_update ON public.assessment_responses;
CREATE POLICY p_assessment_responses_update ON public.assessment_responses
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.test_attempts a
            WHERE a.id = assessment_responses.attempt_id
              AND (
                  (auth.uid() IS NOT NULL AND a.user_id = auth.uid())
                  OR (a.user_id IS NULL AND a.user_code IS NOT NULL AND a.user_code = public.participant_code())
              )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.test_attempts a
            WHERE a.id = assessment_responses.attempt_id
              AND (
                  (auth.uid() IS NOT NULL AND a.user_id = auth.uid())
                  OR (a.user_id IS NULL AND a.user_code IS NOT NULL AND a.user_code = public.participant_code())
              )
        )
    );

-- ── assessment_ai_log ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS p_assessment_ai_log_select_code ON public.assessment_ai_log;
CREATE POLICY p_assessment_ai_log_select_code
    ON public.assessment_ai_log
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.test_attempts t
            WHERE t.id = assessment_ai_log.attempt_id
              AND t.user_id IS NULL
              AND t.user_code IS NOT NULL
              AND t.user_code = public.participant_code()
        )
    );

-- =========================================================================
-- SMOKE TEST (run as anon in the SQL editor after applying):
--
--   -- simulate a request carrying a code:
--   SELECT set_config('request.headers', '{"x-participant-code":"TESTCODE1"}', true);
--   SELECT public.participant_code();          -- → TESTCODE1
--
-- Then, from the app (DevTools console, with a code set):
--   sb.from('test_attempts').select('id,user_code').then(console.log)
--   → must return ONLY rows with your code (previously: every anon row).
-- =========================================================================
