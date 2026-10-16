-- CreateEnum
CREATE TYPE "item_source" AS ENUM ('starter', 'shop', 'drop');

-- CreateEnum
CREATE TYPE "ledger_reason" AS ENUM ('kill', 'wave', 'objective', 'mission', 'score', 'contract', 'discard', 'purchase', 'upgrade', 'perk', 'respec', 'admin');

-- CreateTable
CREATE TABLE "class_progress" (
    "player_id" UUID NOT NULL,
    "class" "player_class" NOT NULL,
    "xp" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "class_progress_pkey" PRIMARY KEY ("player_id","class")
);

-- CreateTable
CREATE TABLE "skill_allocation" (
    "player_id" UUID NOT NULL,
    "class" "player_class" NOT NULL,
    "node_id" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,

    CONSTRAINT "skill_allocation_pkey" PRIMARY KEY ("player_id","class","node_id")
);

-- CreateTable
CREATE TABLE "ability_slot" (
    "player_id" UUID NOT NULL,
    "class" "player_class" NOT NULL,
    "slot" INTEGER NOT NULL,
    "ability_id" TEXT NOT NULL,

    CONSTRAINT "ability_slot_pkey" PRIMARY KEY ("player_id","class","slot")
);

-- CreateTable
CREATE TABLE "inventory_item" (
    "player_id" UUID NOT NULL,
    "item_id" TEXT NOT NULL,
    "upgrade_level" INTEGER NOT NULL DEFAULT 0,
    "perks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" "item_source" NOT NULL,
    "acquired_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_item_pkey" PRIMARY KEY ("player_id","item_id")
);

-- CreateTable
CREATE TABLE "item_duplicate" (
    "id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "item_id" TEXT NOT NULL,
    "match_id" TEXT,
    "found_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_duplicate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loadout" (
    "player_id" UUID NOT NULL,
    "main_1" TEXT NOT NULL,
    "main_2" TEXT NOT NULL,
    "pistol" TEXT NOT NULL,
    "armour" TEXT,
    "utility_1" TEXT,
    "utility_2" TEXT,

    CONSTRAINT "loadout_pkey" PRIMARY KEY ("player_id")
);

-- CreateTable
CREATE TABLE "ledger_entry" (
    "id" BIGSERIAL NOT NULL,
    "player_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "balance_after" BIGINT NOT NULL,
    "reason" "ledger_reason" NOT NULL,
    "ref_type" TEXT,
    "ref_id" TEXT,
    "grant_key" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase" (
    "id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "price" BIGINT NOT NULL,
    "ledger_entry_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_grant" (
    "grant_key" TEXT NOT NULL,
    "player_id" UUID NOT NULL,
    "class" "player_class" NOT NULL,
    "xp" BIGINT NOT NULL,
    "salvage" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_grant_pkey" PRIMARY KEY ("grant_key")
);

-- CreateIndex
CREATE INDEX "item_duplicate_player_id_idx" ON "item_duplicate"("player_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entry_grant_key_key" ON "ledger_entry"("grant_key");

-- CreateIndex
CREATE INDEX "ledger_entry_player_id_id_idx" ON "ledger_entry"("player_id", "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_ledger_entry_id_key" ON "purchase"("ledger_entry_id");

-- CreateIndex
CREATE INDEX "purchase_player_id_idx" ON "purchase"("player_id");

-- CreateIndex
CREATE INDEX "reward_grant_player_id_idx" ON "reward_grant"("player_id");

-- AddForeignKey
ALTER TABLE "class_progress" ADD CONSTRAINT "class_progress_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "player"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_allocation" ADD CONSTRAINT "skill_allocation_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "player"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ability_slot" ADD CONSTRAINT "ability_slot_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "player"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_item" ADD CONSTRAINT "inventory_item_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "player"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_duplicate" ADD CONSTRAINT "item_duplicate_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "player"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loadout" ADD CONSTRAINT "loadout_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "player"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loadout" ADD CONSTRAINT "loadout_player_id_main_1_fkey" FOREIGN KEY ("player_id", "main_1") REFERENCES "inventory_item"("player_id", "item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loadout" ADD CONSTRAINT "loadout_player_id_main_2_fkey" FOREIGN KEY ("player_id", "main_2") REFERENCES "inventory_item"("player_id", "item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loadout" ADD CONSTRAINT "loadout_player_id_pistol_fkey" FOREIGN KEY ("player_id", "pistol") REFERENCES "inventory_item"("player_id", "item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loadout" ADD CONSTRAINT "loadout_player_id_armour_fkey" FOREIGN KEY ("player_id", "armour") REFERENCES "inventory_item"("player_id", "item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loadout" ADD CONSTRAINT "loadout_player_id_utility_1_fkey" FOREIGN KEY ("player_id", "utility_1") REFERENCES "inventory_item"("player_id", "item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loadout" ADD CONSTRAINT "loadout_player_id_utility_2_fkey" FOREIGN KEY ("player_id", "utility_2") REFERENCES "inventory_item"("player_id", "item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_ledger_entry_id_fkey" FOREIGN KEY ("ledger_entry_id") REFERENCES "ledger_entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: rules the schema language cannot express.

ALTER TABLE "player" ADD CONSTRAINT "player_salvage_not_negative" CHECK ("salvage" >= 0);
ALTER TABLE "class_progress" ADD CONSTRAINT "class_progress_xp_not_negative" CHECK ("xp" >= 0);
ALTER TABLE "skill_allocation" ADD CONSTRAINT "skill_allocation_rank" CHECK ("rank" BETWEEN 1 AND 5);
ALTER TABLE "ability_slot" ADD CONSTRAINT "ability_slot_range" CHECK ("slot" BETWEEN 1 AND 3);
ALTER TABLE "inventory_item" ADD CONSTRAINT "inventory_item_level" CHECK ("upgrade_level" BETWEEN 0 AND 20);
ALTER TABLE "loadout" ADD CONSTRAINT "loadout_two_different_mains" CHECK ("main_1" <> "main_2");
ALTER TABLE "loadout" ADD CONSTRAINT "loadout_two_different_utilities" CHECK ("utility_1" IS NULL OR "utility_2" IS NULL OR "utility_1" <> "utility_2");
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_amount_not_zero" CHECK ("amount" <> 0);
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_balance_not_negative" CHECK ("balance_after" >= 0);
ALTER TABLE "reward_grant" ADD CONSTRAINT "reward_grant_not_negative" CHECK ("xp" >= 0 AND "salvage" >= 0);

-- The ledger is append-only: history is never rewritten.
CREATE FUNCTION "ledger_entry_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entry is append-only';
END;
$$;
CREATE TRIGGER "ledger_entry_append_only"
  BEFORE UPDATE OR DELETE ON "ledger_entry"
  FOR EACH ROW EXECUTE FUNCTION "ledger_entry_append_only"();

-- Existing players get the three classes and the starter kit (the API does this for new players).
INSERT INTO "class_progress" ("player_id", "class")
  SELECT p."user_id", c."class"::"player_class"
  FROM "player" p CROSS JOIN (VALUES ('assault'), ('medic'), ('heavy')) AS c("class")
  ON CONFLICT DO NOTHING;
INSERT INTO "inventory_item" ("player_id", "item_id", "source")
  SELECT p."user_id", i."item_id", 'starter'
  FROM "player" p CROSS JOIN (VALUES ('vex-9'), ('k-71'), ('p9-service'), ('kevlar-vest'), ('frag-grenades')) AS i("item_id")
  ON CONFLICT DO NOTHING;
INSERT INTO "loadout" ("player_id", "main_1", "main_2", "pistol", "armour", "utility_1")
  SELECT "user_id", 'vex-9', 'k-71', 'p9-service', 'kevlar-vest', 'frag-grenades' FROM "player"
  ON CONFLICT DO NOTHING;
