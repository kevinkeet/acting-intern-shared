-- ---------------------------------------------------------------------------
-- 008_human_grading.sql — blinded human grading for the TEACH-AI trial.
--
-- Adds a 'grader' role, a per-grader score table, an adjudication table, and a
-- SECURITY DEFINER queue function that hands graders ONLY what they need to
-- score an answer: the answer text and which prompt it belongs to. No
-- participant code, no attempt id, no arm, no dates, no automated score.
-- Graders never get SELECT on test_attempts or assessment_responses.
-- Idempotent.
-- ---------------------------------------------------------------------------

-- 1. Role
ALTER TABLE public.admin_roles DROP CONSTRAINT IF EXISTS admin_roles_role_check;
ALTER TABLE public.admin_roles
    ADD CONSTRAINT admin_roles_role_check CHECK (role IN ('admin','proctor','resident','grader'));

CREATE OR REPLACE FUNCTION public.is_study_grader()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.admin_roles ar
        WHERE ar.user_id = auth.uid() AND ar.role IN ('grader','admin')
    );
$$;
REVOKE ALL ON FUNCTION public.is_study_grader() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_study_grader() TO authenticated;

-- 2. Per-grader scores (one row per grader per answer)
CREATE TABLE IF NOT EXISTS public.human_grades (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    response_id  UUID NOT NULL REFERENCES public.assessment_responses(id) ON DELETE CASCADE,
    grader_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    criteria     JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{"label":"…","points":1,"checked":true}, …]
    points       NUMERIC(6,2),
    max_points   NUMERIC(6,2),
    notes        TEXT,
    status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (response_id, grader_id)
);
CREATE INDEX IF NOT EXISTS human_grades_grader_idx ON public.human_grades (grader_id);
CREATE INDEX IF NOT EXISTS human_grades_response_idx ON public.human_grades (response_id);
ALTER TABLE public.human_grades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_human_grades_own ON public.human_grades;
CREATE POLICY p_human_grades_own ON public.human_grades
    FOR ALL TO authenticated
    USING (grader_id = auth.uid() AND public.is_study_grader())
    WITH CHECK (grader_id = auth.uid() AND public.is_study_grader());

DROP POLICY IF EXISTS p_human_grades_admin_read ON public.human_grades;
CREATE POLICY p_human_grades_admin_read ON public.human_grades
    FOR SELECT TO authenticated
    USING (public.is_study_admin());

-- 3. Adjudication (admins only)
CREATE TABLE IF NOT EXISTS public.grade_adjudications (
    response_id     UUID PRIMARY KEY REFERENCES public.assessment_responses(id) ON DELETE CASCADE,
    final_points    NUMERIC(6,2),
    notes           TEXT,
    adjudicator_id  UUID REFERENCES auth.users(id),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.grade_adjudications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_grade_adjudications_admin ON public.grade_adjudications;
CREATE POLICY p_grade_adjudications_admin ON public.grade_adjudications
    FOR ALL TO authenticated
    USING (public.is_study_admin())
    WITH CHECK (public.is_study_admin());

-- 4. Blinded queue. Study cases, completed attempts, genuine 4-digit codes.
--    Sort key is per-caller so each grader sees a different shuffled order.
CREATE OR REPLACE FUNCTION public.grading_queue()
RETURNS TABLE (
    response_id   UUID,
    case_id       TEXT,
    assessment_id TEXT,
    prompt_id     TEXT,
    response_text TEXT,
    sort_key      TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT r.id, a.case_id, r.assessment_id, r.prompt_id, r.response_text,
           md5(r.id::text || coalesce(auth.uid()::text, ''))
    FROM public.assessment_responses r
    JOIN public.test_attempts a ON a.id = r.attempt_id
    WHERE public.is_study_grader()
      AND a.status = 'completed'
      AND a.case_id IN ('PAT003','PAT004','PAT005','PAT006','PAT007')
      AND a.user_code ~ '^[0-9]{4}$';
$$;
REVOKE ALL ON FUNCTION public.grading_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grading_queue() TO authenticated;
COMMENT ON FUNCTION public.grading_queue() IS
    'Blinded list of answers to grade for grader/admin users (008). No codes, attempts, arms, or automated scores.';

-- 5. Grader roster for the adjudication view: slot order = when the role was granted.
CREATE OR REPLACE FUNCTION public.grader_roster()
RETURNS TABLE (grader_id UUID, email TEXT, granted_at TIMESTAMPTZ, notes TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT ar.user_id, u.email::text, ar.granted_at, ar.notes
    FROM public.admin_roles ar JOIN auth.users u ON u.id = ar.user_id
    WHERE public.is_study_admin() AND ar.role = 'grader'
    ORDER BY ar.granted_at;
$$;
REVOKE ALL ON FUNCTION public.grader_roster() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grader_roster() TO authenticated;

-- Verify:
-- SELECT proname FROM pg_proc WHERE proname IN ('is_study_grader','grading_queue','grader_roster');
