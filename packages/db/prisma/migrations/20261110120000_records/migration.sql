-- AlterTable
ALTER TABLE "player" ADD COLUMN "title_id" TEXT;

-- CreateTable
CREATE TABLE "player_stat" (
    "player_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "player_stat_pkey" PRIMARY KEY ("player_id","key")
);

-- CreateTable
CREATE TABLE "achievement_unlock" (
    "player_id" UUID NOT NULL,
    "achievement_id" TEXT NOT NULL,
    "unlocked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "achievement_unlock_pkey" PRIMARY KEY ("player_id","achievement_id")
);

-- CreateTable
CREATE TABLE "challenge_progress" (
    "player_id" UUID NOT NULL,
    "challenge_key" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "challenge_progress_pkey" PRIMARY KEY ("player_id","challenge_key")
);

-- CreateTable
CREATE TABLE "survival_run" (
    "id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "arena" TEXT NOT NULL,
    "rounds" INTEGER NOT NULL,
    "score" BIGINT NOT NULL,
    "time_ms" INTEGER NOT NULL,
    "squad" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survival_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "player_stat_key_idx" ON "player_stat"("key");
CREATE INDEX "survival_run_arena_rounds_score_idx" ON "survival_run"("arena", "rounds" DESC, "score" DESC);
CREATE INDEX "survival_run_arena_created_at_idx" ON "survival_run"("arena", "created_at");
CREATE INDEX "survival_run_player_id_idx" ON "survival_run"("player_id");

-- AddForeignKey
ALTER TABLE "player_stat" ADD CONSTRAINT "player_stat_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "player"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "achievement_unlock" ADD CONSTRAINT "achievement_unlock_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "player"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "challenge_progress" ADD CONSTRAINT "challenge_progress_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "player"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "survival_run" ADD CONSTRAINT "survival_run_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "player"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Plausible values only
ALTER TABLE "player_stat" ADD CONSTRAINT "player_stat_value_check" CHECK ("value" >= 0);
ALTER TABLE "challenge_progress" ADD CONSTRAINT "challenge_progress_progress_check" CHECK ("progress" >= 0);
ALTER TABLE "survival_run" ADD CONSTRAINT "survival_run_values_check" CHECK ("rounds" >= 0 AND "score" >= 0 AND "time_ms" > 0 AND "squad" BETWEEN 1 AND 4);

-- The game's role (created by the server setup) reads and writes these; where it does not exist
-- (local development, CI) this does nothing.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rotline_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "player_stat", "achievement_unlock", "challenge_progress", "survival_run" TO "rotline_app";
  END IF;
END
$$;
