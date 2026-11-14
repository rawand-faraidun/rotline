-- Survival runs remember their room: a reward report delivered again cannot enter the same run twice.
ALTER TABLE "survival_run" ADD COLUMN "room" TEXT;
CREATE UNIQUE INDEX "survival_run_player_id_room_key" ON "survival_run"("player_id", "room");

-- The leaderboards read one best line per player: by arena and player for Survival, and only the
-- missions someone has finished for the mission boards.
DROP INDEX IF EXISTS "survival_run_player_id_idx";
CREATE INDEX "survival_run_arena_player_id_rounds_score_time_ms_idx"
  ON "survival_run"("arena", "player_id", "rounds" DESC, "score" DESC, "time_ms");
CREATE INDEX "mission_progress_board_idx"
  ON "mission_progress"("mission_id", "difficulty", "best_time_ms", "best_score" DESC)
  WHERE "completions" > 0;

-- Nothing looks stats up by key across players.
DROP INDEX IF EXISTS "player_stat_key_idx";

-- Achievements and Survival runs are only ever added: the game's role may not change or remove them
-- (a deleted player's rows still go with the player, through the foreign key).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rotline_app') THEN
    REVOKE UPDATE, DELETE ON "achievement_unlock", "survival_run" FROM "rotline_app";
  END IF;
END
$$;
