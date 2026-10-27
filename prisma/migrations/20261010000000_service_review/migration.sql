-- 실서비스 후기 사본(plan.md §5 — 후기 관리). 불러올 때마다 쿼리 349 · 350 결과로 유형별로 통째로 바꾼다.
CREATE TABLE "service_review" (
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "review_id" INTEGER NOT NULL,
    "item_id" INTEGER,
    "part" TEXT NOT NULL,
    "written_at" TIMESTAMP(3) NOT NULL,
    "program_id" INTEGER,
    "program_title" TEXT NOT NULL,
    "th" INTEGER,
    "mission_title" TEXT,
    "author_name" TEXT,
    "user_id" INTEGER,
    "mentor_name" TEXT,
    "score" INTEGER,
    "nps" INTEGER,
    "content" TEXT NOT NULL,
    "visible" BOOLEAN NOT NULL,
    "part_visible" BOOLEAN,
    "url" TEXT,
    "blog_title" TEXT,
    "query_retrieved_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_review_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "service_review_type_written_at_idx" ON "service_review"("type", "written_at");

-- 매니저가 고친 카테고리. 사본을 통째로 바꿔도 남도록 따로 둔다.
CREATE TABLE "review_category" (
    "key" TEXT NOT NULL,
    "categories" TEXT[],
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_category_pkey" PRIMARY KEY ("key")
);
