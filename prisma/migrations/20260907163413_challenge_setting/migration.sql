-- CreateTable
CREATE TABLE "challenge_setting" (
    "id" TEXT NOT NULL,
    "challenge_id" TEXT NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "feedback_count" INTEGER NOT NULL,
    "feedback_turnaround_days" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "challenge_setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_mission" (
    "id" TEXT NOT NULL,
    "setting_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "duration_days" INTEGER NOT NULL,

    CONSTRAINT "challenge_mission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "challenge_setting_challenge_id_key" ON "challenge_setting"("challenge_id");

-- CreateIndex
CREATE UNIQUE INDEX "challenge_mission_setting_id_seq_key" ON "challenge_mission"("setting_id", "seq");

-- AddForeignKey
ALTER TABLE "challenge_setting" ADD CONSTRAINT "challenge_setting_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_mission" ADD CONSTRAINT "challenge_mission_setting_id_fkey" FOREIGN KEY ("setting_id") REFERENCES "challenge_setting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
