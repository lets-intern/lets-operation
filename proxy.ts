import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { SESSION_COOKIE, isValidSessionToken } from "@/lib/auth";

const LOGIN_PATH = "/login";

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const authenticated = await isValidSessionToken(
    request.cookies.get(SESSION_COOKIE)?.value,
  );

  // 로그인 화면은 열어두되, 이미 들어온 사람은 되돌려 보낸다.
  if (pathname === LOGIN_PATH) {
    if (!authenticated) return NextResponse.next();
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (authenticated) return NextResponse.next();

  const loginUrl = new URL(LOGIN_PATH, request.url);
  if (pathname !== "/") loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // 정적 파일과 이미지 최적화 요청은 검사하지 않는다.
  // api/sync 와 api/cron 은 크론이 쿠키 없이 부르는 자리라 여기서 걸러내지 않고
  // route 가 CRON_SECRET 으로 직접 지킨다. 빼놓으면 크론이 로그인 화면으로 되돌려진다.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/sync|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
