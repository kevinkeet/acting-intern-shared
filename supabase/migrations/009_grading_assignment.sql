-- ---------------------------------------------------------------------------
-- 009_grading_assignment.sql — two-of-three grader assignment.
--
-- Every answer is graded by exactly two of the roster graders (non-TEST
-- 'grader' roles, ordered by grant date = slot 1, 2, 3 …). Assignment is per
-- ATTEMPT (all of one participant's answers to one case go to the same pair)
-- and deterministic: the excluded slot is md5(attempt_id) mod n. With n ≤ 2
-- everyone grades everything. Test graders (notes starting TEST) and admins
-- see the whole queue for practice. Idempotent; replaces grading_queue().
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.grader_slot(uid UUID)
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT slot FROM (
        SELECT ar.user_id, row_number() OVER (ORDER BY ar.granted_at, ar.user_id)::int AS slot
        FROM public.admin_roles ar
        WHERE ar.role = 'grader' AND coalesce(ar.notes, '') NOT ILIKE 'TEST%'
    ) s WHERE s.user_id = uid;
$$;
REVOKE ALL ON FUNCTION public.grader_slot(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grader_slot(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.grader_count()
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT count(*)::int FROM public.admin_roles ar
    WHERE ar.role = 'grader' AND coalesce(ar.notes, '') NOT ILIKE 'TEST%';
$$;
REVOKE ALL ON FUNCTION public.grader_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grader_count() TO authenticated;

-- Which slot sits this attempt out (1-based). NULL when n <= 2 (nobody sits out).
CREATE OR REPLACE FUNCTION public.excluded_slot(attempt UUID)
RETURNS INTEGER
LANGUAGE sql STABLE
AS $$
    SELECT CASE WHEN public.grader_count() <= 2 THEN NULL
                ELSE (('x' || substr(md5(attempt::text), 1, 8))::bit(32)::int & 2147483647) % public.grader_count() + 1
           END;
$$;
GRANT EXECUTE ON FUNCTION public.excluded_slot(UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.grading_queue();
CREATE OR REPLACE FUNCTION public.grading_queue()
RETURNS TABLE (
    response_id   UUID,
    case_id       TEXT,
    assessment_id TEXT,
    prompt_id     TEXT,
    response_text TEXT,
    sort_key      TEXT,
    attempt_key   TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
            public.grader_slot(auth.uid()) IS NULL              -- admin or TEST grader: everything
         OR public.excluded_slot(a.id) IS NULL                  -- ≤ 2 graders: everything
         OR public.excluded_slot(a.id) <> public.grader_slot(auth.uid())
      );
$$;
REVOKE ALL ON FUNCTION public.grading_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grading_queue() TO authenticated;
COMMENT ON FUNCTION public.grading_queue() IS
    'Blinded, per-grader queue (009): two of n roster graders per attempt, deterministic by md5(attempt_id) mod n.';

-- Admin view of the assignment: which slots grade which attempt.
CREATE OR REPLACE FUNCTION public.grading_assignments()
RETURNS TABLE (attempt_id UUID, excluded_slot INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT a.id, public.excluded_slot(a.id)
    FROM public.test_attempts a
    WHERE public.is_study_admin()
      AND a.status = 'completed'
      AND a.case_id IN ('PAT003','PAT004','PAT005','PAT006','PAT007')
      AND a.user_code ~ '^[0-9]{4}$';
$$;
REVOKE ALL ON FUNCTION public.grading_assignments() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grading_assignments() TO authenticated;

SELECT public.grader_count() AS roster_graders,
       (SELECT count(*) FROM public.grading_queue()) AS items_visible_to_you;
