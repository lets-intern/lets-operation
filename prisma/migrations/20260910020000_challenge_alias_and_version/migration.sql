-- 마케팅팀 표기와 우리 이름을 잇는 별칭. 표기를 저쪽에 맞추지 않고 우리 것을 지킨다.
CREATE TABLE "challenge_alias" (
    "id" TEXT NOT NULL,
    "challenge_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenge_alias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "challenge_alias_name_key" ON "challenge_alias"("name");

-- CreateIndex
CREATE INDEX "challenge_alias_challenge_id_idx" ON "challenge_alias"("challenge_id");

-- AddForeignKey
ALTER TABLE "challenge_alias"
  ADD CONSTRAINT "challenge_alias_challenge_id_fkey"
  FOREIGN KEY ("challenge_id") REFERENCES "challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 기획 줄이 어느 갈래인지. 버전마다 상세페이지가 따로 열리므로 오픈 태스크도 갈래만큼 생긴다.
ALTER TABLE "mkt_planned_program" ADD COLUMN "version" "program_version" NOT NULL DEFAULT 'COMMON';
