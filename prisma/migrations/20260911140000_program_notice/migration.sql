-- 회차별 안내문. 받는 쪽(참여자·멘토)이 곧 나가는 통로(슬랙·카카오톡)를 정하므로
-- 통로 칸은 두지 않는다.
CREATE TYPE "notice_audience" AS ENUM ('PARTICIPANT', 'MENTOR');

-- 예약 발송 시각을 재는 기준일. 안내문은 챌린지에 붙어 기수의 날짜를 모르므로
-- 날짜 대신 "무엇으로부터 며칠" 을 적어둔다.
CREATE TYPE "notice_anchor" AS ENUM ('MISSION_START', 'MISSION_END', 'PROGRAM_START', 'PROGRAM_END');

-- mission_seq 는 challenge_mission 을 외래키로 가리키지 않는다. 미션 줄은 버전별 설정
-- 아래 있는데 안내문은 버전을 가리지 않아, 이으면 같은 안내문을 버전마다 두 번 적게 된다.
-- 비어 있으면 회차와 별개인 안내문(개강·종료 등)이다.
-- schedule_ 세 칸은 함께 있거나 함께 비어 있고, 참여자 안내문만 채운다.
CREATE TABLE "program_notice" (
    "id" TEXT NOT NULL,
    "challenge_id" TEXT NOT NULL,
    "audience" "notice_audience" NOT NULL,
    "mission_seq" INTEGER,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "schedule_anchor" "notice_anchor",
    "schedule_offset_days" INTEGER,
    "schedule_minute_of_day" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "program_notice_pkey" PRIMARY KEY ("id")
);

-- 같은 자리에 여러 장이 설 수 있어(시작 안내 + 마감 리마인드) 유일 제약이 아니다.
CREATE INDEX "program_notice_challenge_id_audience_mission_seq_idx" ON "program_notice"("challenge_id", "audience", "mission_seq");

-- 챌린지를 지우면 안내문도 함께 사라진다. 이름이 없어진 안내문은 갈 곳이 없다.
ALTER TABLE "program_notice" ADD CONSTRAINT "program_notice_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
