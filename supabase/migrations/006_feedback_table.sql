-- ---------------------------------------------------------------------------
-- 006_feedback_table.sql
--
-- The feedback widget previously stored feedback ONLY in the participant's
-- browser localStorage — pilot users' feedback never reached the study team.
-- This adds a server-side destination.
--
-- Access model mirrors the rest of the study schema:
--   INSERT: anon, but the row's participant_code must match the
--           x-participant-code header (participant_code() helper from 004) —
--           a participant can file feedback only under their own code.
--   SELECT: admins only (is_study_admin() from 005). Participants have no
--           read path; feedback is not shown back in the app.
--   No UPDATE/DELETE from the API at all.
--
-- Idempotent: safe to re-run.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.feedback (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_code  TEXT NOT NULL,
    attempt_id        UUID REFERENCES public.test_attempts(id) ON DELETE SET NULL,
    page              TEXT,          -- route hash where feedback was written
    method            TEXT,          -- 'typed' | 'dictated'
    feedback_text     TEXT NOT NULL,
    user_agent        TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_created
    ON public.feedback (created_at DESC);

COMMENT ON TABLE public.feedback IS
    'In-app feedback from the feedback widget. Written by participants (code-scoped), readable by study admins only.';

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_feedback_insert_code ON public.feedback;
CREATE POLICY p_feedback_insert_code
    ON public.feedback
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (
        participant_code IS NOT NULL
        AND participant_code = public.participant_code()
    );

DROP POLICY IF EXISTS p_feedback_select_admin ON public.feedback;
CREATE POLICY p_feedback_select_admin
    ON public.feedback
    FOR SELECT
    TO authenticated
    USING (public.is_study_admin());

-- Smoke test (run as an admin session):
--   SELECT count(*) FROM public.feedback;
-- As anon without the header, INSERT must fail; with header code 'X',
-- INSERT with participant_code='X' must succeed and ='Y' must fail.
