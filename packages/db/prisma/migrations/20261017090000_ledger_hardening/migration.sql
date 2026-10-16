-- The ledger cannot be emptied either (the row trigger does not fire on TRUNCATE).
CREATE FUNCTION "ledger_entry_no_truncate"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entry is append-only';
END;
$$;
CREATE TRIGGER "ledger_entry_no_truncate"
  BEFORE TRUNCATE ON "ledger_entry"
  FOR EACH STATEMENT EXECUTE FUNCTION "ledger_entry_no_truncate"();

-- Perk lists are never NULL.
UPDATE "inventory_item" SET "perks" = '{}' WHERE "perks" IS NULL;
ALTER TABLE "inventory_item" ALTER COLUMN "perks" SET NOT NULL;
