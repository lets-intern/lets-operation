-- 피드백 횟수는 미션에 적어둔 피드백을 세면 나온다. 따로 두면 둘이 어긋날 수 있고,
-- 어긋난 순간 어느 쪽이 그 챌린지의 기준인지 아무도 모른다. 세어내는 쪽만 남긴다.
ALTER TABLE "challenge_setting" DROP COLUMN "feedback_count";
