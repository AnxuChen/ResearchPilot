CREATE TABLE IF NOT EXISTS lab_recent_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tool_type TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  input_payload JSONB NOT NULL,
  output_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_lab_recent_records_user_id
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_lab_recent_records_tool_type
    CHECK (tool_type IN ('ACADEMIC_PLS', 'CITATIONS', 'DATA_VIZ'))
);

CREATE INDEX IF NOT EXISTS idx_lab_recent_user_tool_created_at
  ON lab_recent_records (user_id, tool_type, created_at DESC);
