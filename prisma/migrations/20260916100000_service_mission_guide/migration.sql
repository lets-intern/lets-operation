-- 챌린지 가이드 · 대시보드 공지사항 · 미션 문구의 사본(plan.md §5 — 미션 가이드 관리).
-- 원문의 주인은 실서비스라 우리 테이블과 섞지 않고 사본으로만 둔다.
CREATE TABLE "service_guide_challenge" (
    "id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "start_date" DATE,
    "end_date" DATE,
    "query_retrieved_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_guide_challenge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "service_guide_challenge_start_date_idx" ON "service_guide_challenge"("start_date");

-- 자료는 불러올 때마다 쿼리 336 결과로 통째로 바꾼다.
CREATE TABLE "service_guide_item" (
    "kind" TEXT NOT NULL,
    "source_id" INTEGER NOT NULL,
    "challenge_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "link" TEXT,
    "template_id" INTEGER,
    "th" INTEGER,
    "end_date" DATE,
    "modified_at" TIMESTAMP(3),

    CONSTRAINT "service_guide_item_pkey" PRIMARY KEY ("kind","source_id")
);

CREATE INDEX "service_guide_item_challenge_id_idx" ON "service_guide_item"("challenge_id");

CREATE INDEX "service_guide_item_template_id_idx" ON "service_guide_item"("template_id");

-- 미션명 · 내용 · 가이드 내용. 여러 기수가 한 템플릿을 돌려 쓰므로 문구는 한 벌만 둔다.
CREATE TABLE "service_mission_template" (
    "id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "guide" TEXT NOT NULL,
    "listed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_mission_template_pkey" PRIMARY KEY ("id")
);

-- 가이드 · 공지가 가리키는 Notion 원문. 주소가 열쇠라 같은 원문을 여러 번 받지 않는다.
CREATE TABLE "service_guide_doc" (
    "link" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "content" JSONB,
    "fetch_error" TEXT,
    "fetched_at" TIMESTAMP(3),
    "listed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_guide_doc_pkey" PRIMARY KEY ("link")
);

CREATE INDEX "service_guide_doc_fetched_at_idx" ON "service_guide_doc"("fetched_at");
