import { cookies } from "next/headers";

import { syncMktPlannedPrograms } from "@/domain/mkt-planned-program";
import { importServiceHistory } from "@/domain/service-history";
import {
  detailOpenAutoComplete,
  runDetailOpenCheck,
} from "@/domain/service-program";
import { SESSION_COOKIE, isValidSessionToken } from "@/lib/auth";

/**
 * 마케팅팀 개설 예정 프로그램을 가져오는 자리. Vercel Cron 이 주기적으로 부르고,
 * 사람이 화면에서 "지금 가져오기" 를 눌러도 같은 곳으로 온다.
 *
 * proxy 의 로그인 검사는 이 경로를 지나치므로(proxy.ts) 여기서 직접 문을 지킨다.
 */

// 부를 때마다 실제로 가져와야 한다. 응답을 굳히지 않는다.
export const dynamic = "force-dynamic";

async function authorize(request: Request): Promise<boolean> {
  // Vercel Cron 은 Authorization: Bearer <CRON_SECRET> 을 붙여 부른다.
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") === `Bearer ${secret}`) {
    return true;
  }

  // 로그인한 사람이 화면에서 부른 경우.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return isValidSessionToken(token);
}

export async function GET(request: Request) {
  if (!(await authorize(request))) {
    return Response.json({ error: "권한이 없습니다." }, { status: 401 });
  }

  try {
    const result = await syncMktPlannedPrograms();
    // 지난 운영을 되짚는 것은 개설 뒤에 한다. 같은 자리에 개설로 세운 기수가 있으면
    // 되짚기가 물러나므로, 순서가 뒤바뀌면 우리 기수가 저쪽 날짜로 덮인다.
    const history = await importHistory();
    // 개설 직후의 기수까지 이번 회차에 대조되도록 가져오기 뒤에 붙인다.
    const detailOpen = await checkDetailOpen();
    return Response.json({ ...result, history, detailOpen });
  } catch (error) {
    // 원본 DB 가 닫혀 있거나 스키마가 바뀐 경우다. 크론 로그에서 바로 읽히도록 남긴다.
    console.error("[mkt-sync] 개설 예정 프로그램 동기화 실패", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "동기화에 실패했습니다." },
      { status: 502 },
    );
  }
}

/**
 * 실서비스에서 이미 돈 기수를 되짚는다. 저쪽이 막혀 있어도 마케팅 기획 가져오기까지
 * 실패로 만들지 않는다 — 지난 운영은 기록이고, 개설은 그것과 무관하게 돌아야 한다.
 */
async function importHistory() {
  try {
    return await importServiceHistory();
  } catch (error) {
    console.error("[service-history] 지난 운영 되짚기 실패", error);
    return { error: error instanceof Error ? error.message : "되짚지 못했습니다." };
  }
}

/**
 * 상세페이지가 열렸는지 확인한다. 실서비스가 막혀 있어도 마케팅 기획 가져오기까지
 * 실패로 만들지 않는다 — 둘은 서로 다른 원본이고, 개설은 실서비스와 무관하게 돌아야 한다.
 */
async function checkDetailOpen() {
  try {
    return await runDetailOpenCheck({ complete: detailOpenAutoComplete() });
  } catch (error) {
    console.error("[detail-open] 상세페이지 오픈 확인 실패", error);
    return { error: error instanceof Error ? error.message : "확인에 실패했습니다." };
  }
}
