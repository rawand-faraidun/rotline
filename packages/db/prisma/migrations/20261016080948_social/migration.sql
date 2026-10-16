-- CreateEnum
CREATE TYPE "friendship_status" AS ENUM ('pending', 'accepted');

-- CreateTable
CREATE TABLE "friendship" (
    "player_a" UUID NOT NULL,
    "player_b" UUID NOT NULL,
    "status" "friendship_status" NOT NULL,
    "requested_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMPTZ,

    CONSTRAINT "friendship_pkey" PRIMARY KEY ("player_a","player_b")
);

-- CreateTable
CREATE TABLE "block" (
    "blocker_id" UUID NOT NULL,
    "blocked_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "block_pkey" PRIMARY KEY ("blocker_id","blocked_id")
);

-- CreateTable
CREATE TABLE "recent_player" (
    "player_id" UUID NOT NULL,
    "other_id" UUID NOT NULL,
    "played_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recent_player_pkey" PRIMARY KEY ("player_id","other_id")
);

-- CreateTable
CREATE TABLE "admin_setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "admin_setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "friendship_player_b_status_idx" ON "friendship"("player_b", "status");

-- CreateIndex
CREATE INDEX "block_blocked_id_idx" ON "block"("blocked_id");

-- CreateIndex
CREATE INDEX "recent_player_player_id_played_at_idx" ON "recent_player"("player_id", "played_at" DESC);

-- AddForeignKey
ALTER TABLE "friendship" ADD CONSTRAINT "friendship_player_a_fkey" FOREIGN KEY ("player_a") REFERENCES "player"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friendship" ADD CONSTRAINT "friendship_player_b_fkey" FOREIGN KEY ("player_b") REFERENCES "player"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block" ADD CONSTRAINT "block_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "player"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block" ADD CONSTRAINT "block_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "player"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recent_player" ADD CONSTRAINT "recent_player_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "player"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recent_player" ADD CONSTRAINT "recent_player_other_id_fkey" FOREIGN KEY ("other_id") REFERENCES "player"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
