-- 마케팅팀 사이트의 개설 예정 프로그램 사본. 원본을 그대로 옮겨 담기만 한다.
-- source_id 가 원본 uuid 라 다시 가져와도 같은 줄에 덮인다.

-- CreateTable
CREATE TABLE "mkt_planned_program" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "start_date" DATE,
    "end_date" DATE,
    "open_deadline" DATE,
    "opened" BOOLEAN NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "source_created_at" TIMESTAMP(3) NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL,
    "program_id" TEXT,

    CONSTRAINT "mkt_planned_program_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mkt_planned_program_source_id_key" ON "mkt_planned_program"("source_id");

-- CreateIndex
CREATE INDEX "mkt_planned_program_sort_order_idx" ON "mkt_planned_program"("sort_order");

-- CreateIndex
CREATE INDEX "mkt_planned_program_program_id_idx" ON "mkt_planned_program"("program_id");

-- AddForeignKey
-- 기수를 지우면 연결만 끊는다. 기획 사본은 남아 다음 가져오기에 다시 설 수 있다.
ALTER TABLE "mkt_planned_program"
  ADD CONSTRAINT "mkt_planned_program_program_id_fkey"
  FOREIGN KEY ("program_id") REFERENCES "program"("id") ON DELETE SET NULL ON UPDATE CASCADE;
