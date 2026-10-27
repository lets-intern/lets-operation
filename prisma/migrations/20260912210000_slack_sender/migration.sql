-- 안내문을 예약할 슬랙 계정. 봇이 아니라 사람의 계정이다 — 예약이 그 사람의 슬랙
-- `예약된 메시지` 목록에 서서 거기서 고치고 지울 수 있기 때문이다(plan.md §5).
-- 챌린지마다 보내는 사람이 다르므로 계정을 여러 벌 두고 챌린지가 하나를 가리킨다.
CREATE TABLE "slack_sender" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    -- 사용자 토큰(xoxp-). 화면으로 돌려주지 않는다 — 적을 수만 있고 읽을 수는 없다.
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slack_sender_pkey" PRIMARY KEY ("id")
);

-- 같은 이름의 계정이 둘 있으면 드롭다운에서 어느 쪽인지 가릴 수 없다.
CREATE UNIQUE INDEX "slack_sender_name_key" ON "slack_sender"("name");

ALTER TABLE "challenge" ADD COLUMN "slack_sender_id" TEXT;

-- 계정을 지우면 그 챌린지의 선택이 비고 예약이 멈춘다. 기수와 안내문은 그대로 남고
-- 운영 화면에 사유가 뜬다 — 계정 하나 지우자고 적어둔 글이 딸려 사라지지 않는다.
ALTER TABLE "challenge" ADD CONSTRAINT "challenge_slack_sender_id_fkey" FOREIGN KEY ("slack_sender_id") REFERENCES "slack_sender"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 걸던 시점의 보내는 사람. 예약이 그 사람의 목록에 서 있으므로 고치거나 지울 사람이
-- 누구인지가 화면에서 읽혀야 한다. 계정을 지워도 남아야 해서 이름을 그대로 박아 둔다.
ALTER TABLE "notice_reservation" ADD COLUMN "sender_name" TEXT;
