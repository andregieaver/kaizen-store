-- Supabase's security advisor: public.rls_auto_enable() (the dashboard's "enable RLS on new tables" event-trigger function, made outside
-- this repository) was executable by anon and authenticated through PUBLIC's grant, and it is SECURITY DEFINER. An event trigger calls its
-- function without asking for EXECUTE (tested: a role without it still has its new table's RLS turned on), so only direct calls are taken
-- away. Where the function does not exist (CI, local databases, PGlite) nothing happens.
DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM authenticated;
    END IF;
  END IF;
END $$;
