-- 챌린지 공지방 글을 챌린지에서 떼어낸다. 모든 챌린지가 한 벌을 함께 쓰므로 챌린지마다
-- 같은 글을 되풀이해 적지 않는다(plan.md §5). 이 시점에 공지방 글은 한 장도 없어 옮길 것이 없다.
ALTER TABLE "program_notice" ALTER COLUMN "challenge_id" DROP NOT NULL;

-- 공지방 글만 챌린지가 비고, 나머지는 반드시 챌린지가 있다. 챌린지가 빈 참여자 글은 어느
-- 채널로도 걸리지 않고 어느 표에도 서지 않아 조용히 사라지므로 테이블이 막는다.
ALTER TABLE "program_notice"
ADD CONSTRAINT "program_notice_announcement_check"
CHECK (("audience" = 'ANNOUNCEMENT') = ("challenge_id" IS NULL));

-- 공지방 글은 시작 전 · 종료 후에만 선다. 미션 회차는 챌린지마다 달라 한 벌의 글이 가리킬 데가 없다.
ALTER TABLE "program_notice"
ADD CONSTRAINT "program_notice_announcement_phase_check"
CHECK ("audience" <> 'ANNOUNCEMENT' OR "phase" IS NOT NULL);
