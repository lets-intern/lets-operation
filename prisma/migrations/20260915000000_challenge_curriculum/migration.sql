-- DropIndex
DROP INDEX "challenge_setting_challenge_id_version_key";

-- AlterTable
ALTER TABLE "challenge_setting" ADD COLUMN     "curriculum_days" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "program" ADD COLUMN     "curriculum_days" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "challenge_setting_challenge_id_curriculum_days_version_key" ON "challenge_setting"("challenge_id", "curriculum_days", "version");
