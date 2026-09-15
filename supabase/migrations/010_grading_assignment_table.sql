-- ---------------------------------------------------------------------------
-- 010_grading_assignment_table.sql — persistent, growable grader assignment.
--
-- Replaces the hash-based rule in 009. Assignments are STORED, so adding a
-- grader later never re-deals existing work: new attempts simply flow to
-- whichever roster graders have the fewest assignments. Each completed study
-- attempt is assigned to exactly two roster graders (fewest-assigned first,
-- random tie-break). Admins can add/remove rows by hand. Idempotent.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.grading_assignments (
    attempt_id   UUID NOT NULL REFERENCES public.test_attempts(id) ON DELETE CASCADE,
    grader_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    assigned_by  TEXT NOT NULL DEFAULT 'auto',
    PRIMARY KEY (attempt_id, grader_id)
);
ALTER TABLE public.grading_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_grading_assignments_admin ON public.grading_assignments;
CREATE POLICY p_grading_assignments_admin ON public.grading_assignments
    FOR ALL TO authenticated USING (public.is_study_admin()) WITH CHECK (public.is_study_admin());
DROP POLICY IF EXISTS p_grading_assignments_own ON public.grading_assignments;
CREATE POLICY p_grading_assignments_own ON public.grading_assignments
    FOR SELECT TO authenticated USING (grader_id = auth.uid());

-- Roster = real graders (TEST excluded), ordered by grant date for display.
CREATE OR REPLACE FUNCTION public.grader_roster()
RETURNS TABLE (grader_id UUID, email TEXT, granted_at TIMESTAMPTZ, notes TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT ar.user_id, u.email::text, ar.granted_at, ar.notes
    FROM public.admin_roles ar JOIN auth.users u ON u.id = ar.user_id
    WHERE public.is_study_grader() AND ar.role = 'grader'
      AND coalesce(ar.notes, '') NOT ILIKE 'TEST%'
    ORDER BY ar.granted_at, ar.user_id;
$$;
REVOKE ALL ON FUNCTION public.grader_roster() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grader_roster() TO authenticated;

-- Assign every unassigned (or half-assigned) completed study attempt to two
-- roster graders, balancing total load. Safe to call repeatedly; called by the
-- grading queue on load and by the adjudication page.
CREATE OR REPLACE FUNCTION public.assign_pending_grading()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    att RECORD; g RECORD; added INT := 0; need INT; n INT;
BEGIN
    IF NOT public.is_study_grader() THEN RETURN 0; END IF;
    SELECT count(*) INTO n FROM public.admin_roles ar
      WHERE ar.role = 'grader' AND coalesce(ar.notes,'') NOT ILIKE 'TEST%';
    IF n = 0 THEN RETURN 0; END IF;
    FOR att IN
        SELECT a.id
        FROM public.test_attempts a
        WHERE a.status = 'completed'
          AND a.case_id IN ('PAT003','PAT004','PAT005','PAT006','PAT007')
          AND a.user_code ~ '^[0-9]{4}$'
          AND (SELECT count(*) FROM public.grading_assignments ga WHERE ga.attempt_id = a.id) < LEAST(2, n)
        ORDER BY a.completed_at NULLS LAST, a.id
    LOOP
        need := LEAST(2, n) - (SELECT count(*) FROM public.grading_assignments ga WHERE ga.attempt_id = att.id);
        FOR g IN
            SELECT ar.user_id
            FROM public.admin_roles ar
            WHERE ar.role = 'grader' AND coalesce(ar.notes,'') NOT ILIKE 'TEST%'
              AND NOT EXISTS (SELECT 1 FROM public.grading_assignments x WHERE x.attempt_id = att.id AND x.grader_id = ar.user_id)
            ORDER BY (SELECT count(*) FROM public.grading_assignments y WHERE y.grader_id = ar.user_id), random()
            LIMIT need
        LOOP
            INSERT INTO public.grading_assignments (attempt_id, grader_id) VALUES (att.id, g.user_id)
            ON CONFLICT DO NOTHING;
            added := added + 1;
        END LOOP;
    END LOOP;
    RETURN added;
END $$;
REVOKE ALL ON FUNCTION public.assign_pending_grading() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_pending_grading() TO authenticated;

-- Queue: roster graders see their assigned attempts; admins and TEST graders see all.
DROP FUNCTION IF EXISTS public.grading_queue();
CREATE OR REPLACE FUNCTION public.grading_queue()
RETURNS TABLE (response_id UUID, case_id TEXT, assessment_id TEXT, prompt_id TEXT, response_text TEXT, sort_key TEXT, attempt_key TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT r.id, a.case_id, r.assessment_id, r.prompt_id, r.response_text,
           md5(a.id::text || coalesce(auth.uid()::text, '')) || '-' || r.prompt_id,
           md5(a.id::text)
    FROM public.assessment_responses r
    JOIN public.test_attempts a ON a.id = r.attempt_id
    WHERE public.is_study_grader()
      AND a.status = 'completed'
      AND a.case_id IN ('PAT003','PAT004','PAT005','PAT006','PAT007')
      AND a.user_code ~ '^[0-9]{4}$'
      AND (
            NOT EXISTS (SELECT 1 FROM public.admin_roles ar WHERE ar.user_id = auth.uid()
                        AND ar.role = 'grader' AND coalesce(ar.notes,'') NOT ILIKE 'TEST%')
         OR EXISTS (SELECT 1 FROM public.grading_assignments ga WHERE ga.attempt_id = a.id AND ga.grader_id = auth.uid())
      );
$$;
REVOKE ALL ON FUNCTION public.grading_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grading_queue() TO authenticated;

-- Admin view: assignments per attempt (grader ids), for the adjudication page.
DROP FUNCTION IF EXISTS public.grading_assignments();
CREATE OR REPLACE FUNCTION public.grading_assignment_list()
RETURNS TABLE (attempt_id UUID, grader_id UUID, assigned_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT ga.attempt_id, ga.grader_id, ga.assigned_at
    FROM public.grading_assignments ga
    WHERE public.is_study_admin();
$$;
REVOKE ALL ON FUNCTION public.grading_assignment_list() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grading_assignment_list() TO authenticated;

-- 009 leftovers are harmless but no longer used.
DROP FUNCTION IF EXISTS public.excluded_slot(UUID);
DROP FUNCTION IF EXISTS public.grader_slot(UUID);
DROP FUNCTION IF EXISTS public.grader_count();

SELECT public.assign_pending_grading() AS assignments_made,
       (SELECT count(*) FROM public.grading_assignments) AS total_assignment_rows;
