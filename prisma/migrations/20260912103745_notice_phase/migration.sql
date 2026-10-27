-- 회차 밖 안내문을 한 자리에서 두 자리로 가른다. 개강을 알리는 글과 수료를 알리는 글은
-- 기준일도(시작일·종료일) 방향도(앞·뒤) 반대라, 한 자리에 섞여 있으면 목록에서 어느 쪽
-- 글인지 제목으로만 가리게 된다.
CREATE TYPE "notice_phase" AS ENUM ('BEFORE_START', 'AFTER_END');

-- mission_seq 와 정확히 하나만 찬다. 회차에 붙은 안내문은 비어 있다.
ALTER TABLE "program_notice" ADD COLUMN "phase" "notice_phase";

-- 이미 적어둔 회차 밖 안내문은 기준일을 보고 자리를 정한다. 기준일을 아직 안 정한 글은
-- 개강 안내가 대부분이라 시작 전으로 둔다 — 자리를 옮기는 것은 화면에서 다시 할 수 있다.
UPDATE "program_notice"
SET "phase" = CASE
  WHEN "schedule_anchor" = 'PROGRAM_END' THEN 'AFTER_END'::"notice_phase"
  ELSE 'BEFORE_START'::"notice_phase"
END
WHERE "mission_seq" IS NULL;

-- 새 자리는 이름대로 방향이 잠긴다(시작 전은 앞, 종료 후는 뒤). 그 전에 반대쪽으로 적어둔
-- 시점은 옮겨 담을 데가 없다. 날짜를 말없이 뒤집는 대신 시점을 비워, 화면의 "저절로 나가지
-- 않는다" 경고에 걸리게 두고 사람이 다시 정하게 한다.
UPDATE "program_notice"
SET "schedule_anchor" = NULL, "schedule_offset_days" = NULL, "schedule_minute_of_day" = NULL
WHERE "schedule_offset_days" IS NOT NULL
  AND (
    ("phase" = 'BEFORE_START' AND "schedule_offset_days" > 0)
    OR ("phase" = 'AFTER_END' AND "schedule_offset_days" < 0)
  );

-- 자리는 회차이거나 회차 밖이지, 둘 다이거나 둘 다 아닐 수는 없다. 두 칸이 함께 비면
-- 화면에 설 자리가 없어 조용히 사라지므로, 막는 주체를 코드가 아니라 테이블에 둔다.
ALTER TABLE "program_notice"
ADD CONSTRAINT "program_notice_placement_check"
CHECK (("mission_seq" IS NULL) <> ("phase" IS NULL));
