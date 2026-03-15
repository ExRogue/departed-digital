BEGIN;

CREATE TABLE IF NOT EXISTS ops_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
  queue_key TEXT NOT NULL DEFAULT 'workflow',
  job_type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  run_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  last_error TEXT NOT NULL DEFAULT '',
  locked_at TIMESTAMPTZ,
  locked_by TEXT NOT NULL DEFAULT '',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_jobs_dedupe_key ON ops_jobs(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_ops_jobs_run_at_status ON ops_jobs(status, run_at);
CREATE INDEX IF NOT EXISTS idx_ops_jobs_case_id_status ON ops_jobs(case_id, status);

COMMIT;
