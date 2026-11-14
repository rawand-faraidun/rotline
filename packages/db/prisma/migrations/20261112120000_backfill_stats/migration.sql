-- Lifetime stats from what was recorded before stats existed: missions completed (in all, by
-- difficulty and by mission) and golds earned, from mission_progress. Kills, revives and rounds
-- were never recorded, so they start from zero. Values already counted are kept when larger.
INSERT INTO "player_stat" ("player_id", "key", "value")
SELECT "player_id", 'missions', SUM("completions") FROM "mission_progress" GROUP BY "player_id"
UNION ALL
SELECT "player_id", 'missions:' || "difficulty"::text, SUM("completions") FROM "mission_progress" GROUP BY "player_id", "difficulty"
UNION ALL
SELECT "player_id", 'mission:' || "mission_id", SUM("completions") FROM "mission_progress" GROUP BY "player_id", "mission_id"
UNION ALL
SELECT "player_id", 'gold', COUNT(*) FROM "mission_progress" WHERE "mastery" = 'gold' GROUP BY "player_id"
ON CONFLICT ("player_id", "key") DO UPDATE SET "value" = GREATEST("player_stat"."value", EXCLUDED."value");
