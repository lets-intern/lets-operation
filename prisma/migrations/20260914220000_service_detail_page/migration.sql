-- 실서비스 챌린지 상세페이지 사본과 그 이미지에서 읽어낸 글(plan.md §5 — 상세페이지 관리).
-- 페이지의 주인은 마케팅팀이라 우리 테이블과 섞지 않고 사본으로만 둔다.
CREATE TABLE "service_detail_page" (
    "id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "start_date" DATE,
    "end_date" DATE,
    "content" JSONB,
    "fetch_error" TEXT,
    "fetched_at" TIMESTAMP(3),
    "listed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_detail_page_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "service_detail_page_start_date_idx" ON "service_detail_page"("start_date");

-- 같은 이미지는 기수가 바뀌어도 한 번만 읽도록 이미지 주소를 열쇠로 둔다.
CREATE TABLE "detail_image_text" (
    "src" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "detail_image_text_pkey" PRIMARY KEY ("src")
);
