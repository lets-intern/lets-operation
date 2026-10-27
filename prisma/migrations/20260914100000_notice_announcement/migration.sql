-- 챌린지 공지방. 참여자 채널과 같은 규칙으로 예약되지만, 채널이 챌린지마다가 아니라
-- 모든 챌린지가 함께 쓰는 전체 공지 채널 하나다(plan.md §5).

-- 1) 받는 쪽 하나 더. 받는 쪽이 곧 통로라 칸을 따로 두지 않는다.
ALTER TYPE "notice_audience" ADD VALUE 'ANNOUNCEMENT';

-- 2) 챌린지에 딸리지 않는 설정. 줄은 하나뿐이고 화면이 처음 저장할 때 생긴다.
--    채널이 비어 있으면 공지방 글만 못 걸리고 사유가 남는다.
CREATE TABLE "notice_setting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "announcement_channel_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notice_setting_pkey" PRIMARY KEY ("id")
);
