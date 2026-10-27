-- 운영 종료일. 실서비스에서 되짚어 온 기수는 저쪽이 적어둔 날이 그대로 들어온다.
-- 개설로 세운 기수는 비어 있고, 그때는 마케팅 기획의 종료일을 본다.
ALTER TABLE "program" ADD COLUMN "end_date" DATE;

-- 실서비스 목록에서 되짚어 세운 기수라는 표시이자 그 시각.
-- 개설로 세운 기수는 비어 있어, 두 경로에서 온 기수가 이 값 하나로 갈린다.
ALTER TABLE "program" ADD COLUMN "service_imported_at" TIMESTAMP(3);
