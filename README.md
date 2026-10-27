# LetsOperation

교육 프로그램 운영 도구. 기획 원본은 [`plan.md`](./plan.md) 입니다.

## 실행

```bash
npm install
cp .env.example .env.local   # APP_PASSWORD, AUTH_SECRET 채우기
npm run dev
```

`AUTH_SECRET` 생성:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 접근 차단

계정 분리는 하지 않고 팀 공용 비밀번호 1개로 막습니다(`plan.md` §2, §7).

- `proxy.ts` — 모든 요청에서 세션 쿠키를 검사하고, 없으면 `/login` 으로 보냅니다.
  Next.js 16부터 `middleware.ts` 가 `proxy.ts` 로 이름이 바뀌었습니다.
- `lib/auth.ts` — 쿠키에는 비밀번호가 아니라 `AUTH_SECRET` 과 합친 해시만 담습니다.
  proxy 에서 같은 해시를 다시 계산해 비교하므로 쿠키를 위조할 수 없습니다.

## 구조

```
app/
  login/            비밀번호 게이트
  (main)/           좌측 패널이 붙는 영역
    dashboard/      대시보드        — 기획 중, "구현 중" 표시
    calendar/       업무 현황 관리   — 레이아웃 골격만
    programs/       프로그램 운영    — 기획 중, "구현 중" 표시
components/
  app-sidebar.tsx   좌측 패널
  ui/               shadcn/ui
lib/
  nav.ts            메뉴 정의. 메뉴 추가는 여기 한 곳만 고칩니다
  auth.ts           세션 토큰
```

페이지끼리 직접 import 하지 않습니다. 데이터가 붙기 시작하면 `plan.md` §7 대로
`domain/` 을 두고 그곳을 통해서만 접근합니다.

## 스택

Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind CSS v4 · shadcn/ui
