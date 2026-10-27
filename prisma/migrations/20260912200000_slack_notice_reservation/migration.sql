-- 참여자 안내문을 기수의 날짜에 맞춰 슬랙에 예약하는 데 필요한 두 가지.

-- 1) 안내문이 나갈 채널. 안내문과 같은 자리(챌린지)에 붙는다 — 기수마다 다시 적지 않기
--    위해서다. 비어 있으면 그 챌린지의 예약은 걸리지 않고 사유가 남는다.
ALTER TABLE "challenge" ADD COLUMN "slack_channel_id" TEXT;

-- 2) 걸어 본 결과. 걸린 것과 못 걸린 것이 한 테이블에 있는 이유는, 못 걸린 것도 사람이
--    봐야 할 결과이고 사유가 풀리면 같은 자리에서 다시 시도되기 때문이다.
--    post_at 이 비는 경우가 있다 — 종료일을 모르는 기수는 발송일을 계산조차 못 한다.
CREATE TABLE "notice_reservation" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "notice_id" TEXT NOT NULL,
    "post_at" TIMESTAMP(3),
    "channel_id" TEXT,
    "slack_message_id" TEXT,
    "failure" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notice_reservation_pkey" PRIMARY KEY ("id")
);

-- 한 기수의 한 글은 한 번만 걸린다. 크론은 하루 한 번 돌면서 같은 기수를 며칠에 걸쳐
-- 다시 보는데, 두 통이 나가지 않는 것을 화면이 아니라 이 제약이 지킨다.
CREATE UNIQUE INDEX "notice_reservation_program_id_notice_id_key" ON "notice_reservation"("program_id", "notice_id");

-- 운영 화면은 앞으로 나갈 것부터 읽는다.
CREATE INDEX "notice_reservation_post_at_idx" ON "notice_reservation"("post_at");

-- 기수나 안내문이 사라지면 예약 기록도 함께 사라진다. 슬랙에 이미 걸린 것은 슬랙에
-- 남지만, 우리가 무엇을 걸었다는 기록은 그 둘에 딸린 것이다.
ALTER TABLE "notice_reservation" ADD CONSTRAINT "notice_reservation_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notice_reservation" ADD CONSTRAINT "notice_reservation_notice_id_fkey" FOREIGN KEY ("notice_id") REFERENCES "program_notice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
