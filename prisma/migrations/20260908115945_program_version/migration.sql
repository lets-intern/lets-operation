-- CreateEnum
CREATE TYPE "program_version" AS ENUM ('COMMON', 'ENTRY', 'EXPERIENCED');

-- DropIndex
DROP INDEX "challenge_setting_challenge_id_key";

-- AlterTable
ALTER TABLE "challenge_setting" ADD COLUMN     "version" "program_version" NOT NULL DEFAULT 'COMMON';

-- CreateIndex
CREATE UNIQUE INDEX "challenge_setting_challenge_id_version_key" ON "challenge_setting"("challenge_id", "version");
