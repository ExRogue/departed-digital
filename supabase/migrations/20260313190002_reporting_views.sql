BEGIN;

CREATE OR REPLACE VIEW reporting_case_queue_metrics AS
SELECT
  status,
  payment_status,
  priority,
  COUNT(*) AS case_count,
  COUNT(*) FILTER (WHERE archived_at IS NULL) AS active_case_count
FROM cases
GROUP BY status, payment_status, priority;

CREATE OR REPLACE VIEW reporting_partner_conversion AS
SELECT
  COALESCE(p.business_name, 'Direct') AS partner_name,
  COALESCE(p.partner_type, 'direct') AS partner_type,
  COUNT(c.id) AS total_cases,
  COUNT(c.id) FILTER (WHERE c.payment_status = 'paid') AS paid_cases,
  COUNT(c.id) FILTER (WHERE c.status = 'completed') AS completed_cases
FROM cases c
LEFT JOIN partner_accounts p ON p.id = c.partner_account_id
GROUP BY COALESCE(p.business_name, 'Direct'), COALESCE(p.partner_type, 'direct');

CREATE OR REPLACE VIEW reporting_funnel_daily AS
SELECT
  DATE_TRUNC('day', created_at) AS event_day,
  event_type,
  COUNT(*) AS event_count
FROM analytics_events
GROUP BY DATE_TRUNC('day', created_at), event_type
ORDER BY event_day DESC, event_type ASC;

COMMIT;
