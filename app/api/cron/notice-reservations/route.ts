import { cookies } from "next/headers";

import { reserveUpcomingNotices } from "@/domain/notice-reservation";
import { RESERVE_DAYS_BEFORE_START } from "@/domain/program-notice";
import { SESSION_COOKIE, isValidSessionToken } from "@/lib/auth";

/**
 * 참여자 안내문을 슬랙에 예약하는 자리. Vercel Cron 이 한국 시각 자정에 부르고,
 * 사람이 주소를 직접 열거나 운영 화면의 `지금 걸기` 를 눌러도 같은 곳으로 온다.
 *
 * 자정에 도는 이유는 예약이 걸리는 날(시작 4일 전) 하루가 통째로 앞에 남아 있어야 하기
 * 때문이다. 낮에 돌면 그날 아침으로 적어둔 시작 전 안내문이 이미 지난 시각이 된다.
 *
 * **하루 한 번인 것은 우리 선택이 아니라 Vercel Hobby 의 제약이다.** 그보다 잦은 크론을
 * 받지 않는다. 그래서 자정과 자정 사이에 적은 글은 사람이 `지금 걸기` 로 건다 —
 * 오늘 저녁으로 적어둔 안내문을 그날 낮에 적으면 그 글을 볼 크론이 이미 지나갔기 때문이다.
 *
 * 마케팅 기획 동기화와 한 경로에 묶지 않는다. 원천이 다르고, 한쪽이 막혀도 다른 쪽은
 * 돌아야 한다(plan.md §6 — 페이지는 독립적으로).
 *
 * proxy 의 로그인 검사는 이 경로를 지나치므로(proxy.ts) 여기서 직접 문을 지킨다.
 */

// 부를 때마다 실제로 걸어야 한다. 응답을 굳히지 않는다.
export const dynamic = "force-dynamic";

async function authorize(request: Request): Promise<boolean> {
  // Vercel Cron 은 Authorization: Bearer <CRON_SECRET> 을 붙여 부른다.
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") === `Bearer ${secret}`) {
    return true;
  }

  // 로그인한 사람이 주소를 직접 연 경우.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return isValidSessionToken(token);
}

export async function GET(request: Request) {
  if (!(await authorize(request))) {
    return Response.json({ error: "권한이 없습니다." }, { status: 401 });
  }

  try {
    const result = await reserveUpcomingNotices();

    return Response.json({ daysBeforeStart: RESERVE_DAYS_BEFORE_START, ...result });
  } catch (error) {
    // 데이터베이스가 막힌 경우다. 슬랙이 거절한 건은 줄에 사유로 남고 여기까지 오지 않는다.
    console.error("[notice-reservation] 안내문 예약 실패", error);

    return Response.json(
      { error: error instanceof Error ? error.message : "예약하지 못했습니다." },
      { status: 502 },
    );
  }
}
