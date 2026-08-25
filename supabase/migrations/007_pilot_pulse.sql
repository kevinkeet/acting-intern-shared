-- ---------------------------------------------------------------------------
-- 007_pilot_pulse.sql — anonymous aggregate heartbeat for pilot monitoring.
--
-- Returns COUNTS AND TIMESTAMPS ONLY: no codes, no answers, no feedback text,
-- no AI content. Safe to expose to anon; exists so an unauthenticated watcher
-- can notice "something changed" and a human/admin then looks at the details
-- through the authenticated console. Idempotent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pilot_pulse()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT json_build_object(
        'attempts',        (SELECT count(*) FROM test_attempts),
        'completed',       (SELECT count(*) FROM test_attempts WHERE status = 'completed'),
        'responses',       (SELECT count(*) FROM assessment_responses),
        'ai_rows',         (SELECT count(*) FROM assessment_ai_log),
        'feedback',        (SELECT count(*) FROM feedback),
        'last_attempt_at', (SELECT max(started_at)   FROM test_attempts),
        'last_response_at',(SELECT max(submitted_at) FROM assessment_responses),
        'last_feedback_at',(SELECT max(created_at)   FROM feedback)
    );
$$;
REVOKE ALL ON FUNCTION public.pilot_pulse() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pilot_pulse() TO anon, authenticated;
COMMENT ON FUNCTION public.pilot_pulse() IS
    'Aggregate-only study heartbeat for pilot monitoring (007). No row-level data.';
