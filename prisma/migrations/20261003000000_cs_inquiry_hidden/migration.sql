-- 매니저가 목록에서 숨긴 문의(plan.md §5 — CS 수집). 사본을 통째로 바꿔도 남도록 따로 둔다.
CREATE TABLE "cs_inquiry_hidden" (
    "inquiry_id" INTEGER NOT NULL,
    "hidden_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cs_inquiry_hidden_pkey" PRIMARY KEY ("inquiry_id")
);
