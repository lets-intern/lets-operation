import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

import {
  connectGoogleCalendar,
  GoogleCalendarError,
  OAUTH_STATE_COOKIE,
} from "@/domain/google-calendar";

/**
 * 구글 동의 화면에서 돌아오는 자리. state 를 맞춰 보고 code 를 토큰으로 바꿔 연결을 저장한 뒤
 * 업무 수행 화면으로 돌려보낸다. 실패하면 사유를 주소(`?google=`)에 실어 화면이 읽게 한다.
 *
 * proxy 의 로그인 검사를 그대로 받는다. 로그인 쿠키는 sameSite=lax 라(app/login/actions.ts)
 * 구글에서 돌아오는 최상위 GET 이동에도 실린다 — 그래서 여기서 로그인 화면으로 튕기지 않는다.
 */

export const dynamic = "force-dynamic";

const PAGE_PATH = "/calendar/execution";

function back(request: NextRequest, result: string): NextResponse {
  const response = NextResponse.redirect(
    new URL(`${PAGE_PATH}?google=${encodeURIComponent(result)}`, request.nextUrl.origin),
  );
  // 한 번 쓴 state 는 버린다. 같은 동의 결과로 두 번 들어오지 못하게 한다.
  response.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/api/google", maxAge: 0 });
  return response;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // 사람이 동의 화면에서 취소했거나 구글이 거절한 경우다.
  if (params.get("error")) {
    return back(request, params.get("error") === "access_denied" ? "denied" : "exchange");
  }

  const state = params.get("state") ?? "";
  const expected = request.cookies.get(OAUTH_STATE_COOKIE)?.value ?? "";
  if (!state || !expected || state !== expected) return back(request, "state");

  const code = params.get("code");
  if (!code) return back(request, "exchange");

  try {
    const result = await connectGoogleCalendar(code, request.nextUrl.origin);
    if (!result.ok) return back(request, result.reason);
  } catch (error) {
    if (error instanceof GoogleCalendarError && error.kind === "not-configured") {
      return back(request, "not-configured");
    }
    console.error("[google] 연결 저장 실패", error);
    return back(request, "error");
  }

  revalidatePath(PAGE_PATH);
  return back(request, "connected");
}
