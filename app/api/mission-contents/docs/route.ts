import type { NextRequest } from "next/server";

import { listMissionContentDocs } from "@/domain/service-mission-content";

/**
 * 미션 콘텐츠 본문을 한 번에 내려준다.
 *
 * 본문이 미션 콘텐츠 페이지 무게의 90% 가까이(5.2MB 중 4.6MB, 2026-09-16)라 첫 화면에서
 * 떼어 내고, 화면이 뜬 뒤 여기서 받는다. 찾기는 그대로 브라우저에서 한다(plan.md §5).
 * 접근 차단은 proxy.ts 가 다른 화면과 똑같이 처리한다.
 */
export async function GET(request: NextRequest) {
  const { version, docs } = await listMissionContentDocs();

  // 화면은 마지막 불러오기 시각을 v 로 붙여 부른다. 시각이 같으면 본문도 같으므로 브라우저가 남겨 두게 한다.
  // 다르면 그사이 누가 새로 불러온 것이라, 화면이 새 시각으로 다시 부를 때까지 남기지 않는다.
  const cacheable = version !== null && request.nextUrl.searchParams.get("v") === version;

  return Response.json(
    { version, docs },
    { headers: { "cache-control": cacheable ? "private, max-age=31536000, immutable" : "no-store" } },
  );
}
