ALTER TABLE admin_case_read_model
ADD COLUMN IF NOT EXISTS workflow_model_version INTEGER NOT NULL DEFAULT 1;
