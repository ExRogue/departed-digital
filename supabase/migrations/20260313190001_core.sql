BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('founder_admin', 'case_manager', 'document_specialist', 'partner_manager', 'read_only')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  invalidated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  relationship_to_deceased TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS partner_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_type TEXT NOT NULL DEFAULT 'direct' CHECK (partner_type IN ('direct', 'funeral_director', 'solicitor', 'probate', 'other')),
  business_name TEXT NOT NULL,
  primary_contact_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  referral_fee_gbp NUMERIC(10,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'prospect')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cases (
  id UUID PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  public_token_hash TEXT NOT NULL UNIQUE,
  public_token_hint TEXT NOT NULL DEFAULT '',
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  partner_account_id UUID REFERENCES partner_accounts(id) ON DELETE SET NULL,
  intake_source TEXT NOT NULL DEFAULT 'website',
  referral_source TEXT NOT NULL DEFAULT '',
  deceased_name TEXT NOT NULL,
  preferred_outcome TEXT NOT NULL DEFAULT 'not_sure',
  case_details TEXT NOT NULL DEFAULT '',
  relationship_to_deceased TEXT NOT NULL DEFAULT '',
  urgency TEXT NOT NULL DEFAULT 'standard',
  selected_package TEXT NOT NULL CHECK (selected_package IN ('essential', 'standard', 'estate')),
  package_label TEXT NOT NULL,
  package_price_gbp NUMERIC(10,2) NOT NULL DEFAULT 0,
  package_target_days INTEGER NOT NULL DEFAULT 10,
  status TEXT NOT NULL CHECK (status IN ('awaiting_payment', 'paid', 'awaiting_documents', 'documents_received', 'active', 'submitted', 'completed', 'blocked')),
  payment_status TEXT NOT NULL CHECK (payment_status IN ('pending', 'payment_link_sent', 'paid', 'refunded')),
  priority TEXT NOT NULL DEFAULT 'standard' CHECK (priority IN ('standard', 'priority', 'urgent')),
  assigned_to_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  assigned_to_name_snapshot TEXT NOT NULL DEFAULT '',
  due_date DATE,
  next_follow_up_at DATE,
  operator_lane TEXT NOT NULL DEFAULT '',
  blocker_reason TEXT NOT NULL DEFAULT '',
  authority_basis TEXT NOT NULL DEFAULT '',
  document_notes TEXT NOT NULL DEFAULT '',
  internal_notes TEXT NOT NULL DEFAULT '',
  archived_at TIMESTAMPTZ,
  archived_by_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  archived_by_name_snapshot TEXT NOT NULL DEFAULT '',
  archive_reason TEXT NOT NULL DEFAULT '',
  last_client_update_at TIMESTAMPTZ,
  last_operator_action_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  legacy_payload JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE TABLE IF NOT EXISTS platform_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  external_key TEXT NOT NULL,
  platform_name TEXT NOT NULL,
  profile_or_handle TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'queued', 'submitted', 'waiting', 'resolved', 'blocked')),
  outcome_requested TEXT NOT NULL DEFAULT '',
  evidence_needed TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  submission_reference TEXT NOT NULL DEFAULT '',
  submitted_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (case_id, external_key)
);

CREATE TABLE IF NOT EXISTS case_documents (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  document_type TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes BIGINT NOT NULL DEFAULT 0,
  storage_provider TEXT NOT NULL DEFAULT 'blob',
  storage_path TEXT NOT NULL,
  uploaded_by_actor TEXT NOT NULL DEFAULT 'public',
  uploaded_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE TABLE IF NOT EXISTS case_reminders (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dismissed')),
  severity TEXT NOT NULL DEFAULT 'normal' CHECK (severity IN ('normal', 'priority', 'urgent')),
  assigned_to TEXT NOT NULL DEFAULT '',
  owner_lane TEXT NOT NULL DEFAULT '',
  due_date DATE,
  escalate_at DATE,
  notes TEXT NOT NULL DEFAULT '',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS case_activity (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL,
  actor_label TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS case_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  authored_by_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  authored_by_name_snapshot TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal', 'client_safe')),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'manual',
  provider_reference TEXT NOT NULL DEFAULT '',
  amount_gbp NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency_code CHAR(3) NOT NULL DEFAULT 'GBP',
  status TEXT NOT NULL CHECK (status IN ('pending', 'payment_link_sent', 'paid', 'refunded', 'failed')),
  paid_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES cases(id) ON DELETE SET NULL,
  recipient_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  direction TEXT NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound', 'internal')),
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'sms', 'system')),
  template_key TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  provider_message_id TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY,
  session_id TEXT NOT NULL,
  case_id UUID REFERENCES cases(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  page_title TEXT NOT NULL DEFAULT '',
  referrer TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_user_id ON admin_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_partner_accounts_type_status ON partner_accounts(partner_type, status);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_payment_status ON cases(payment_status);
CREATE INDEX IF NOT EXISTS idx_cases_priority ON cases(priority);
CREATE INDEX IF NOT EXISTS idx_cases_created_at ON cases(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cases_archived_at ON cases(archived_at);
CREATE INDEX IF NOT EXISTS idx_cases_partner_account_id ON cases(partner_account_id);
CREATE INDEX IF NOT EXISTS idx_platform_tasks_case_id_status ON platform_tasks(case_id, status);
CREATE INDEX IF NOT EXISTS idx_case_documents_case_id ON case_documents(case_id);
CREATE INDEX IF NOT EXISTS idx_case_reminders_case_id_status ON case_reminders(case_id, status);
CREATE INDEX IF NOT EXISTS idx_case_activity_case_id_created_at ON case_activity(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_case_id_status ON payments(case_id, status);
CREATE INDEX IF NOT EXISTS idx_notifications_case_id_created_at ON notifications(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_session_id ON analytics_events(session_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_event_type ON analytics_events(event_type);

COMMIT;
