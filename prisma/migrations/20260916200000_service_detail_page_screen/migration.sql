-- 상세페이지 중 API 에 없고 실서비스 코드에만 박힌 고정 문구를 채우려고, 페이지를 직접 띄워 읽은 결과를 둔다.
-- API 사본(content)과 나눠 두는 이유는, 화면 읽기가 실패하거나 늦어도 API 사본은 그대로 새로 받을 수 있어야 하기 때문이다.
ALTER TABLE "service_detail_page" ADD COLUMN "screen" JSONB;
ALTER TABLE "service_detail_page" ADD COLUMN "screen_key" TEXT;
ALTER TABLE "service_detail_page" ADD COLUMN "screen_error" TEXT;
ALTER TABLE "service_detail_page" ADD COLUMN "screened_at" TIMESTAMP(3);
