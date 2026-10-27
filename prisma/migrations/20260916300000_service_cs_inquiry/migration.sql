-- 챌린지 1:1 문의 사본(plan.md §5 — CS 수집). 불러올 때마다 쿼리 337 결과로 통째로 바꾼다.
CREATE TABLE "service_cs_inquiry" (
    "id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "modified_at" TIMESTAMP(3),
    "challenge_id" INTEGER NOT NULL,
    "challenge_title" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "customer_name" TEXT NOT NULL,
    "plan" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "image_urls" TEXT[],
    "answer" TEXT,
    "answer_image_urls" TEXT[],
    "answer_read_at" TIMESTAMP(3),
    "query_retrieved_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_cs_inquiry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "service_cs_inquiry_created_at_idx" ON "service_cs_inquiry"("created_at");

-- 매니저가 고친 카테고리. 사본을 통째로 바꿔도 남도록 따로 둔다.
CREATE TABLE "cs_inquiry_category" (
    "inquiry_id" INTEGER NOT NULL,
    "categories" TEXT[],
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cs_inquiry_category_pkey" PRIMARY KEY ("inquiry_id")
);
