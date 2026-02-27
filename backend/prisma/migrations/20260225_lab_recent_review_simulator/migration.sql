ALTER TABLE lab_recent_records
  DROP CONSTRAINT IF EXISTS chk_lab_recent_records_tool_type;

ALTER TABLE lab_recent_records
  ADD CONSTRAINT chk_lab_recent_records_tool_type
  CHECK (tool_type IN ('ACADEMIC_PLS', 'CITATIONS', 'DATA_VIZ', 'REVIEW_SIMULATOR'));
