-- One row per pair: the smaller id always goes in player_a. Players cannot befriend or block themselves.
ALTER TABLE "friendship" ADD CONSTRAINT "friendship_ordered" CHECK ("player_a" < "player_b");
ALTER TABLE "block" ADD CONSTRAINT "block_not_self" CHECK ("blocker_id" <> "blocked_id");
ALTER TABLE "recent_player" ADD CONSTRAINT "recent_not_self" CHECK ("player_id" <> "other_id");
