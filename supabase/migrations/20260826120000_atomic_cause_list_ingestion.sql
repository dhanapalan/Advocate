-- Fixes a real correctness bug in ingestCauseList (cause-list.functions.ts),
-- flagged in the microservices decomposition plan
-- (C:\Users\cdhan\.claude\plans\bright-toasting-thompson.md, Phase 3) to be
-- closed before Diary & Cause-list is carried across a service boundary —
-- independent of that migration, this is wrong today regardless.
--
-- Today, per cause-list row, the app issues up to five separate round trips
-- (insert cause_list_records, update the superseded row's superseded_by,
-- insert cause_list_changes, insert cause_list_matches, then
-- reconcileHearing's own read+write into hearings) with no transaction
-- wrapping them. PostgREST commits each request independently, so a failure
-- partway through — e.g. the match insert failing after the record insert
-- succeeded — leaves an orphaned cause_list_records row with no match row,
-- no superseded_by link fixed up, and a hearing that never got reconciled.
-- The next re-ingestion sees that row as still "head" (superseded_by IS
-- NULL) and duplicates it.
--
-- This function does the same five writes in one Postgres transaction —
-- either all of them commit or none do. SECURITY INVOKER (not DEFINER): it
-- must run under the calling user's own role so every RLS policy on these
-- four tables still applies exactly as it does when the app issues the
-- writes directly — this changes atomicity, not authorization.
--
-- The matching/diffing computation itself (matchCauseListRecord,
-- detectChanges — cause-list-matching.ts, cause-list-changes.ts) stays in
-- TypeScript, since it's pure logic over already-fetched candidates with no
-- write of its own; only the writes that follow it move into this function.
CREATE OR REPLACE FUNCTION public.ingest_cause_list_row(
  p_source_id UUID,
  p_list_date DATE,
  p_court TEXT,
  p_bench TEXT,
  p_list_type TEXT,
  p_serial_number TEXT,
  p_case_number TEXT,
  p_cnr TEXT,
  p_petitioner TEXT,
  p_respondent TEXT,
  p_advocate_names TEXT,
  p_stage TEXT,
  p_court_hall TEXT,
  p_source_reference TEXT,
  p_raw_payload JSONB,
  p_created_by UUID,
  p_previous_id UUID,
  p_changes JSONB,              -- array of {changeType, fieldName, oldValue, newValue}
  p_match_matter_id UUID,
  p_match_method TEXT,
  p_match_confidence NUMERIC,
  p_match_status TEXT,
  p_carry_reviewed_by UUID,
  p_carry_reviewed_at TIMESTAMPTZ,
  p_reconcile_matter_title TEXT,        -- NULL unless p_match_status = 'matched'
  p_reconcile_purpose_encrypted TEXT    -- already-encrypted (see field-encryption.ts); only used if a new hearing is inserted
)
RETURNS UUID
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_new_record_id UUID;
  v_existing_hearing_id UUID;
  v_change JSONB;
BEGIN
  INSERT INTO public.cause_list_records (
    source_id, list_date, court, bench, list_type, serial_number, case_number, cnr,
    petitioner, respondent, advocate_names, stage, court_hall, source_reference,
    raw_payload, created_by
  ) VALUES (
    p_source_id, p_list_date, p_court, p_bench, p_list_type, p_serial_number, p_case_number, p_cnr,
    p_petitioner, p_respondent, p_advocate_names, p_stage, p_court_hall, p_source_reference,
    p_raw_payload, p_created_by
  ) RETURNING id INTO v_new_record_id;

  IF p_previous_id IS NOT NULL THEN
    UPDATE public.cause_list_records SET superseded_by = v_new_record_id WHERE id = p_previous_id;
  END IF;

  IF p_changes IS NOT NULL AND jsonb_array_length(p_changes) > 0 THEN
    FOR v_change IN SELECT * FROM jsonb_array_elements(p_changes) LOOP
      INSERT INTO public.cause_list_changes (
        record_id, previous_record_id, change_type, field_name, old_value, new_value
      ) VALUES (
        v_new_record_id, p_previous_id,
        v_change->>'changeType', v_change->>'fieldName', v_change->>'oldValue', v_change->>'newValue'
      );
    END LOOP;
  END IF;

  INSERT INTO public.cause_list_matches (
    record_id, matter_id, match_method, confidence, status, reviewed_by, reviewed_at
  ) VALUES (
    v_new_record_id, p_match_matter_id, p_match_method, p_match_confidence, p_match_status,
    p_carry_reviewed_by, p_carry_reviewed_at
  );

  -- Mirrors reconcileHearing's find-or-create logic (cause-list.functions.ts):
  -- prefer a hearing already linked to a prior version of this same listing
  -- (by source_reference chain), else fall back to same-matter/same-date.
  IF p_match_status = 'matched' AND p_match_matter_id IS NOT NULL THEN
    SELECT h.id INTO v_existing_hearing_id
    FROM public.hearings h
    WHERE h.cause_list_record_id IN (
      SELECT id FROM public.cause_list_records
      WHERE source_id = p_source_id AND source_reference = p_source_reference
    )
    ORDER BY h.created_at DESC
    LIMIT 1;

    IF v_existing_hearing_id IS NULL THEN
      SELECT h.id INTO v_existing_hearing_id
      FROM public.hearings h
      WHERE h.matter_id = p_match_matter_id AND h.hearing_date = p_list_date
      ORDER BY h.created_at DESC
      LIMIT 1;
    END IF;

    IF v_existing_hearing_id IS NOT NULL THEN
      UPDATE public.hearings SET
        matter_id = p_match_matter_id,
        hearing_date = p_list_date,
        court = p_court,
        court_hall = p_court_hall,
        bench = p_bench,
        cnr = p_cnr,
        cause_list_record_id = v_new_record_id
      WHERE id = v_existing_hearing_id;
    ELSE
      INSERT INTO public.hearings (
        matter_id, matter_title, court, hearing_date, hearing_time, purpose, status,
        court_hall, bench, cnr, cause_list_record_id, created_by
      ) VALUES (
        p_match_matter_id, p_reconcile_matter_title, p_court, p_list_date, NULL,
        p_reconcile_purpose_encrypted, 'confirmed',
        p_court_hall, p_bench, p_cnr, v_new_record_id, p_created_by
      );
    END IF;
  END IF;

  RETURN v_new_record_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_cause_list_row(
  UUID, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, UUID,
  UUID, JSONB, UUID, TEXT, NUMERIC, TEXT, UUID, TIMESTAMPTZ, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ingest_cause_list_row(
  UUID, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, UUID,
  UUID, JSONB, UUID, TEXT, NUMERIC, TEXT, UUID, TIMESTAMPTZ, TEXT, TEXT
) TO authenticated;
