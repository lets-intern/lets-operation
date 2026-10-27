-- 상세페이지가 실제로 열렸는지 실서비스에서 확인한 근거를 태스크에 남긴다.
-- 확인(detail_open_seen_at)과 자동 완료(auto_done_at)를 나눠 두는 이유는, 판정이 맞는지
-- 지켜보는 동안 상태를 건드리지 않고 확인만 쌓아둘 수 있어야 하기 때문이다.
ALTER TABLE "task" ADD COLUMN "detail_open_seen_at" TIMESTAMP(3);
ALTER TABLE "task" ADD COLUMN "detail_open_ref" TEXT;
ALTER TABLE "task" ADD COLUMN "auto_done_at" TIMESTAMP(3);
