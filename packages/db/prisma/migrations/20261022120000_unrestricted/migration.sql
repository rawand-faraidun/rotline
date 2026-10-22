-- A test account may hold every skill in a tree, whatever its level (set by hand, never by the game).
ALTER TABLE "player" ADD COLUMN "unrestricted" BOOLEAN NOT NULL DEFAULT false;
