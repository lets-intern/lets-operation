import { NextResponse, type NextRequest } from "next/server";

import { buildAuthUrl, isGoogleOAuthConfigured, OAUTH_STATE_COOKIE } from "@/domain/google-calendar";

/**
 * 구글 동의 화면으로 보내는 자리. 업무 수행 화면의 `구글 캘린더 연결` 버튼이 여기로 온다.
 *
 * proxy 의 로그인 검사를 그대로 받는다 — 비밀번호를 모르는 사람이 이 앱의 캘린더 자리에
 * 자기 계정을 꽂아 넣을 수 없게 한다.
 *
 * 무작위 state 를 httpOnly 쿠키에 적어 두고 콜백에서 맞춰 본다. 남이 만든 동의 결과(code)를
 * 우리 콜백으로 밀어 넣어 엉뚱한 계정이 연결되는 것(CSRF)을 막는다.
 */

// 부를 때마다 새 state 를 만들어야 한다. 응답을 굳히지 않는다.
export const dynamic = "force-dynamic";

/** 동의 화면에서 돌아오기까지 넉넉히 10분. 그 뒤에 돌아오면 다시 누르게 한다. */
const STATE_MAX_AGE = 60 * 10;

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;

  if (!isGoogleOAuthConfigured()) {
    return NextResponse.redirect(new URL("/calendar/execution?google=not-configured", origin));
  }

  const state = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  const response = NextResponse.redirect(buildAuthUrl(origin, state));
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    // 구글에서 돌아오는 것은 다른 사이트에서 시작된 최상위 GET 이동이다. lax 면 실리고 strict 면 안 실린다.
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/google",
    maxAge: STATE_MAX_AGE,
  });
  return response;
}
