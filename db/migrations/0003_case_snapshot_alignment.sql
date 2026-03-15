BEGIN;

ALTER TABLE customers
  ADD CONSTRAINT customers_email_key UNIQUE (email);

ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS referral_partner_type TEXT NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS referral_partner_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS referral_partner_email TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS referral_partner_phone TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS referral_fee_status TEXT NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS referral_notes TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_cases_referral_partner_type ON cases(referral_partner_type);
CREATE INDEX IF NOT EXISTS idx_cases_referral_partner_name ON cases(referral_partner_name);

COMMIT;
