-- 실서비스 미션 콘텐츠 사본과, 그 콘텐츠가 어느 미션에 붙었는지(plan.md §5 — 미션 콘텐츠 관리).
-- 콘텐츠의 주인은 실서비스라 우리 테이블과 섞지 않고 사본으로만 둔다.
CREATE TABLE "service_mission_content" (
    "id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "content" JSONB,
    "fetch_error" TEXT,
    "fetched_at" TIMESTAMP(3),
    "listed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_mission_content_pkey" PRIMARY KEY ("id")
);

-- 연결은 Redash 쿼리 335 결과로 불러올 때마다 통째로 바꾼다.
CREATE TABLE "service_mission_content_use" (
    "mission_id" INTEGER NOT NULL,
    "content_id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "challenge_id" INTEGER NOT NULL,
    "challenge_title" TEXT NOT NULL,
    "challenge_start_date" DATE,
    "challenge_end_date" DATE,
    "mission_th" INTEGER NOT NULL,
    "mission_title" TEXT NOT NULL,
    "mission_end_date" DATE,
    "query_retrieved_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_mission_content_use_pkey" PRIMARY KEY ("mission_id","content_id")
);

CREATE INDEX "service_mission_content_use_challenge_id_idx" ON "service_mission_content_use"("challenge_id");

CREATE INDEX "service_mission_content_use_content_id_idx" ON "service_mission_content_use"("content_id");
