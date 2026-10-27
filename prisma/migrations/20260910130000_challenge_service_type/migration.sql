-- 실서비스 운영DB 의 challenge_type. 상세페이지가 열렸는지 대조하는 열쇠다.
-- 저쪽 제목 표기가 계속 흔들려 이름으로는 이을 수 없다. 여러 챌린지가 같은 값을 가질 수 있어
-- 유일 제약을 두지 않는다.
ALTER TABLE "challenge" ADD COLUMN "service_type" INTEGER;
