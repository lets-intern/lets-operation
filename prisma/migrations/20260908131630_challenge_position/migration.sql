-- AlterTable
ALTER TABLE "challenge" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- 기존 챌린지는 지금까지 보이던 이름순 그대로 자리를 잡는다.
-- 값이 전부 0 이면 위·아래로 옮겨도 자리가 바뀌지 않으므로 한 번 흩어 놓아야 한다.
WITH ordered AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "name") - 1 AS seq FROM "challenge"
)
UPDATE "challenge" c SET "position" = o.seq FROM ordered o WHERE c."id" = o."id";
