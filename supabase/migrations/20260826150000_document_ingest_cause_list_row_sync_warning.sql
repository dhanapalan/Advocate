-- Code-review fix: the hearing-reconciliation logic in this function (find a
-- hearing linked to a prior version of this listing, else same-matter/
-- same-date, else insert) is independently reimplemented in TypeScript as
-- reconcileHearing() (services/diary/src/cause-list.ts, used by the manual
-- "Match Matter" path) — no test or type contract ties the two together,
-- only a code comment on each side. This migration changes nothing about
-- the function's behavior; it only strengthens that comment into an
-- explicit two-way sync warning, matching the one added to reconcileHearing
-- itself.
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
  p_changes JSONB,
  p_match_matter_id UUID,
  p_match_method TEXT,
  p_match_confidence NUMERIC,
  p_match_status TEXT,
  p_carry_reviewed_by UUID,
  p_carry_reviewed_at TIMESTAMPTZ,
  p_reconcile_matter_title TEXT,
  p_reconcile_purpose_encrypted TEXT
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

  -- SYNC WARNING: this find-or-create logic (version-chain hearing, else
  -- same-matter/same-date, else insert) is independently reimplemented in
  -- TypeScript as reconcileHearing() (services/diary/src/cause-list.ts,
  -- used by the manual "Match Matter" path) — no test or type contract ties
  -- the two together, only this comment. If you change the matching
  -- precedence, the insert/update fields, or any other part of this logic,
  -- reconcileHearing() needs the identical change, or the automated
  -- cause-list-ingest path and the manual-match path will silently diverge.
  IF p_match_status = 'matched' AND p_match_matter_id IS NOT NULL
     AND p_reconcile_matter_title IS NOT NULL THEN
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
