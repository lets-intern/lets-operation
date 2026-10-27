-- CreateEnum
CREATE TYPE "feedback_kind" AS ENUM ('WRITTEN', 'LIVE');

-- AlterTable
ALTER TABLE "challenge_mission" ADD COLUMN     "feedback_kind" "feedback_kind",
ADD COLUMN     "feedback_days" INTEGER;

-- 피드백은 이제 미션마다 붙고 서면·라이브 종류를 갖는다. 설정 한 벌에 하나였던
-- feedback_turnaround_days 는 어느 미션의 것인지도, 어느 종류인지도 알 수 없다.
-- 지어내 옮기면 화면에는 그럴듯한 값이 뜨지만 아무도 그것이 지어낸 값인 줄 모른다.
-- 그래서 옮기지 않고 지운다. 피드백 횟수는 남아 있으므로 미션에 아무것도 안 적힌
-- 설정은 "피드백 횟수는 n회인데 적어둔 피드백은 0개" 경고로 화면에 그대로 드러난다.
ALTER TABLE "challenge_setting" DROP COLUMN "feedback_turnaround_days";
