-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "task_kind" AS ENUM ('MILESTONE', 'TASK');

-- CreateEnum
CREATE TYPE "task_status" AS ENUM ('TODO', 'DOING', 'DONE');

-- CreateTable
CREATE TABLE "challenge" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program" (
    "id" TEXT NOT NULL,
    "challenge_id" TEXT NOT NULL,
    "cohort" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "detail_open_target_date" DATE NOT NULL,
    "redash_dashboard_url" TEXT,
    "cloned_from_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "task_kind" NOT NULL DEFAULT 'TASK',
    "status" "task_status" NOT NULL DEFAULT 'TODO',
    "due_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "challenge_name_key" ON "challenge"("name");

-- CreateIndex
CREATE UNIQUE INDEX "program_challenge_id_cohort_key" ON "program"("challenge_id", "cohort");

-- CreateIndex
CREATE INDEX "task_due_date_idx" ON "task"("due_date");

-- AddForeignKey
ALTER TABLE "program" ADD CONSTRAINT "program_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program" ADD CONSTRAINT "program_cloned_from_id_fkey" FOREIGN KEY ("cloned_from_id") REFERENCES "program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

