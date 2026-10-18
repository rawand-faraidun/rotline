-- Armour is worn in five places (head, torso, vest, legs, feet), each with its own loadout slot.

-- the one armour slot becomes the vest; its foreign key keeps pointing at the same column
ALTER TABLE "loadout" RENAME COLUMN "armour" TO "armour_vest";
ALTER TABLE "loadout" RENAME CONSTRAINT "loadout_player_id_armour_fkey" TO "loadout_player_id_armour_vest_fkey";

ALTER TABLE "loadout" ADD COLUMN "armour_head" TEXT,
ADD COLUMN "armour_torso" TEXT,
ADD COLUMN "armour_legs" TEXT,
ADD COLUMN "armour_feet" TEXT;

ALTER TABLE "loadout" ADD CONSTRAINT "loadout_player_id_armour_head_fkey" FOREIGN KEY ("player_id", "armour_head") REFERENCES "inventory_item"("player_id", "item_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "loadout" ADD CONSTRAINT "loadout_player_id_armour_torso_fkey" FOREIGN KEY ("player_id", "armour_torso") REFERENCES "inventory_item"("player_id", "item_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "loadout" ADD CONSTRAINT "loadout_player_id_armour_legs_fkey" FOREIGN KEY ("player_id", "armour_legs") REFERENCES "inventory_item"("player_id", "item_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "loadout" ADD CONSTRAINT "loadout_player_id_armour_feet_fkey" FOREIGN KEY ("player_id", "armour_feet") REFERENCES "inventory_item"("player_id", "item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- the hazmat suit is now worn on the torso
UPDATE "loadout" SET "armour_torso" = "armour_vest", "armour_vest" = NULL WHERE "armour_vest" = 'hazmat-suit';

-- everyone gets the new starter pieces (helmet, shirt, trousers, boots) and wears them where the place is free
INSERT INTO "inventory_item" ("player_id", "item_id", "source")
  SELECT p."user_id", piece.id, 'starter' FROM "player" p CROSS JOIN (VALUES ('field-helmet'), ('field-shirt'), ('field-trousers'), ('field-boots')) AS piece(id)
  ON CONFLICT DO NOTHING;
UPDATE "loadout" SET "armour_head" = 'field-helmet' WHERE "armour_head" IS NULL;
UPDATE "loadout" SET "armour_torso" = 'field-shirt' WHERE "armour_torso" IS NULL;
UPDATE "loadout" SET "armour_legs" = 'field-trousers' WHERE "armour_legs" IS NULL;
UPDATE "loadout" SET "armour_feet" = 'field-boots' WHERE "armour_feet" IS NULL;
