-- In production the game connects as `rotline_app` (created by the server setup, not by migrations).
-- It may only append to the economy's history: never update, delete or empty it.
-- Where the role does not exist (local development, CI) this does nothing.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rotline_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "ledger_entry", "purchase", "reward_grant" FROM "rotline_app";
  END IF;
END
$$;
