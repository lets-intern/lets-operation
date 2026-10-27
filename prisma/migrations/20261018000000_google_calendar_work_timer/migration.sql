-- 업무 수행 화면의 구글 캘린더 연결(plan.md §5 — 업무 수행). 계정 하나만 잇고 줄도 하나뿐이다.
-- 화면이 처음 연결할 때 생긴다.
CREATE TABLE "google_calendar_connection" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "email" TEXT NOT NULL,
    -- 토큰은 화면으로 돌려주지 않는다 — 구글을 부르는 서버 경로만 읽는다.
    "refresh_token" TEXT NOT NULL,
    "access_token" TEXT,
    "access_token_expires_at" TIMESTAMP(3),
    -- 테스트 상태의 OAuth 앱은 갱신 토큰이 7일마다 만료된다. 끊기면 줄을 지우지 않고 사유를 남긴다.
    "disconnected_at" TIMESTAMP(3),
    "disconnect_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_calendar_connection_pkey" PRIMARY KEY ("id")
);

-- 두 번째 계정이 끼어들 자리를 테이블이 막는다. 코드가 실수로 다른 id 를 써도 들어가지 않는다.
ALTER TABLE "google_calendar_connection" ADD CONSTRAINT "google_calendar_connection_single_row"
CHECK ("id" = 'default');

-- 돌고 있는 업무 타이머. 한 번에 하나만 돈다 — 시작이 겹치면 기본 키에서 걸린다.
CREATE TABLE "work_timer" (
    "id" TEXT NOT NULL DEFAULT 'running',
    "title" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    -- `종료` 를 누른 서버 시각. 차 있으면 확인 폼을 적는 중이고 등록하면 이 시각이 일정의 끝이 된다.
    "ending_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_timer_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "work_timer" ADD CONSTRAINT "work_timer_single_row" CHECK ("id" = 'running');
