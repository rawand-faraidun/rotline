-- CreateEnum
CREATE TYPE "difficulty" AS ENUM ('recruit', 'veteran', 'nightmare', 'apocalypse');

-- CreateEnum
CREATE TYPE "mastery" AS ENUM ('none', 'bronze', 'silver', 'gold');

-- AlterTable
ALTER TABLE "reward_grant" ADD COLUMN     "items" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "result" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "room" TEXT;

-- CreateTable
CREATE TABLE "mission_progress" (
    "player_id" UUID NOT NULL,
    "mission_id" TEXT NOT NULL,
    "difficulty" "difficulty" NOT NULL,
    "completions" INTEGER NOT NULL DEFAULT 0,
    "best_time_ms" INTEGER,
    "best_score" BIGINT NOT NULL DEFAULT 0,
    "mastery" "mastery" NOT NULL DEFAULT 'none',
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "mission_progress_pkey" PRIMARY KEY ("player_id","mission_id","difficulty")
);

-- CreateIndex
CREATE INDEX "reward_grant_player_id_room_idx" ON "reward_grant"("player_id", "room");

-- AddForeignKey
ALTER TABLE "mission_progress" ADD CONSTRAINT "mission_progress_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "player"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Plausible, consistent values only
ALTER TABLE "reward_grant" ADD CONSTRAINT "reward_grant_items_check" CHECK (cardinality("items") <= 32);
ALTER TABLE "mission_progress" ADD CONSTRAINT "mission_progress_completions_check" CHECK ("completions" >= 0);
ALTER TABLE "mission_progress" ADD CONSTRAINT "mission_progress_best_time_check" CHECK ("best_time_ms" > 0);
ALTER TABLE "mission_progress" ADD CONSTRAINT "mission_progress_best_score_check" CHECK ("best_score" >= 0);
ALTER TABLE "mission_progress" ADD CONSTRAINT "mission_progress_record_check" CHECK (("completions" = 0) = ("best_time_ms" IS NULL));

-- The game's role (created by the server setup) reads and writes mission records; where it does not
-- exist (local development, CI) this does nothing.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rotline_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "mission_progress" TO "rotline_app";
  END IF;
END
$$;
