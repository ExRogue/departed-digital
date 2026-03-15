BEGIN;

CREATE TABLE IF NOT EXISTS admin_case_read_model (
  case_id UUID PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
  reference TEXT NOT NULL,
  client_name TEXT NOT NULL DEFAULT '',
  client_email TEXT NOT NULL DEFAULT '',
  deceased_name TEXT NOT NULL DEFAULT '',
  selected_package TEXT NOT NULL DEFAULT '',
  package_label TEXT NOT NULL DEFAULT '',
  relationship_to_deceased TEXT NOT NULL DEFAULT '',
  assigned_to TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'standard',
  due_date DATE,
  referral_partner_name TEXT NOT NULL DEFAULT '',
  referral_fee_status TEXT NOT NULL DEFAULT 'not_applicable',
  status TEXT NOT NULL DEFAULT '',
  payment_status TEXT NOT NULL DEFAULT '',
  platform_count INTEGER NOT NULL DEFAULT 0,
  resolved_platform_count INTEGER NOT NULL DEFAULT 0,
  blocked_platform_count INTEGER NOT NULL DEFAULT 0,
  pending_submission_count INTEGER NOT NULL DEFAULT 0,
  in_flight_platform_count INTEGER NOT NULL DEFAULT 0,
  document_count INTEGER NOT NULL DEFAULT 0,
  open_reminder_count INTEGER NOT NULL DEFAULT 0,
  overdue_reminder_count INTEGER NOT NULL DEFAULT 0,
  escalated_reminder_count INTEGER NOT NULL DEFAULT 0,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  workflow_stage_label TEXT NOT NULL DEFAULT '',
  workflow_queue_label TEXT NOT NULL DEFAULT '',
  workflow_queue_key TEXT NOT NULL DEFAULT '',
  workflow_waiting_on TEXT NOT NULL DEFAULT '',
  workflow_service_target_date DATE,
  workflow_follow_up_date DATE,
  workflow_health_status TEXT NOT NULL DEFAULT '',
  workflow_progress_percent INTEGER NOT NULL DEFAULT 0,
  workflow_needs_attention BOOLEAN NOT NULL DEFAULT FALSE,
  workflow_overdue BOOLEAN NOT NULL DEFAULT FALSE,
  workflow_open_reminder_count INTEGER NOT NULL DEFAULT 0,
  workflow_escalated_reminder_count INTEGER NOT NULL DEFAULT 0,
  workflow_recommended_lane TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_admin_case_read_model_updated_at ON admin_case_read_model(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_case_read_model_status ON admin_case_read_model(status);
CREATE INDEX IF NOT EXISTS idx_admin_case_read_model_payment_status ON admin_case_read_model(payment_status);
CREATE INDEX IF NOT EXISTS idx_admin_case_read_model_archived_at ON admin_case_read_model(archived_at);
CREATE INDEX IF NOT EXISTS idx_admin_case_read_model_queue ON admin_case_read_model(workflow_queue_key);

COMMIT;
