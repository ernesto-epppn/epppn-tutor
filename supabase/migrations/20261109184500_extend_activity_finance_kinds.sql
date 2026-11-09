-- Extend the private per-account operations notebook with financial transactions
-- and recipe cost models. Existing owner RLS policies remain in force.
ALTER TABLE public.ernesto_activity_records
  DROP CONSTRAINT IF EXISTS ernesto_activity_records_kind_check;
ALTER TABLE public.ernesto_activity_records
  ADD CONSTRAINT ernesto_activity_records_kind_check
  CHECK (kind IN ('supplier','stock','profile','transaction','costing'));
