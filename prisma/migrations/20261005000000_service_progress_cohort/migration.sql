-- 실서비스 챌린지 기수별 미션 제출 사본(plan.md §5 — 참여자 수행 현황). 불러올 때마다 쿼리 344 결과로 통째로 바꾼다.
CREATE TABLE "service_progress_cohort" (
    "id" INTEGER NOT NULL,
    "type" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "missions" JSONB NOT NULL,
    "participants" JSONB NOT NULL,
    "query_retrieved_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_progress_cohort_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "service_progress_cohort_start_date_idx" ON "service_progress_cohort"("start_date");
