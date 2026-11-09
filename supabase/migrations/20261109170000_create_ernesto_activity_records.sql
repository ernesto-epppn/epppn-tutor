-- Per-user operational notebooks for EPPPN graduates.
-- Rows are owned by auth.uid(). No user can read or modify another user's data.

CREATE TABLE IF NOT EXISTS public.ernesto_activity_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('supplier','stock','profile')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(payload)='object' AND octet_length(payload::text)<=12000
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ernesto_activity_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ernesto_activity_records FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ernesto_activity_records TO authenticated;

CREATE INDEX IF NOT EXISTS ernesto_activity_records_owner_kind_idx
  ON public.ernesto_activity_records(user_id,kind,updated_at DESC);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='ernesto_activity_records'
      AND policyname='ernesto_activity_owner_select') THEN
    CREATE POLICY ernesto_activity_owner_select ON public.ernesto_activity_records
      FOR SELECT TO authenticated
      USING (user_id = (SELECT auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='ernesto_activity_records'
      AND policyname='ernesto_activity_owner_insert') THEN
    CREATE POLICY ernesto_activity_owner_insert ON public.ernesto_activity_records
      FOR INSERT TO authenticated
      WITH CHECK (user_id = (SELECT auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='ernesto_activity_records'
      AND policyname='ernesto_activity_owner_update') THEN
    CREATE POLICY ernesto_activity_owner_update ON public.ernesto_activity_records
      FOR UPDATE TO authenticated
      USING (user_id = (SELECT auth.uid()))
      WITH CHECK (user_id = (SELECT auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='ernesto_activity_records'
      AND policyname='ernesto_activity_owner_delete') THEN
    CREATE POLICY ernesto_activity_owner_delete ON public.ernesto_activity_records
      FOR DELETE TO authenticated
      USING (user_id = (SELECT auth.uid()));
  END IF;
END $$;
