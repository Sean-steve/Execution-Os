BEGIN;

CREATE TABLE IF NOT EXISTS execution_os_subject_state (
  tenant_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  state JSONB NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_execution_os_subject_state_updated_at
  ON execution_os_subject_state (updated_at DESC);

COMMIT;
