-- Every player gets a code to hand out so others can add them; existing players get one now.
ALTER TABLE "player" ADD COLUMN "friend_code" TEXT NOT NULL DEFAULT upper(substr(replace((gen_random_uuid())::text, '-'::text, ''::text), 1, 8));
CREATE UNIQUE INDEX "player_friend_code_key" ON "player"("friend_code");

-- Finding players by part of a name, or a name close to it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "player_name_key_trgm" ON "player" USING GIN ("name_key" gin_trgm_ops);
