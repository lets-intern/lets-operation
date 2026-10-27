import type { NextRequest } from "next/server";

import { listMissionGuideDocs } from "@/domain/service-mission-guide";

/**
 * 챌린지 가이드 · 공지사항의 Notion 본문을 한 번에 내려준다.
 *
 * 미션 콘텐츠 화면과 같은 이유로 첫 화면에서 떼어 내고 화면이 뜬 뒤 여기서 받는다(plan.md §5).
 * 미션 문구는 운영DB 안의 짧은 글이라 첫 화면에 그대로 싣는다.
 * 접근 차단은 proxy.ts 가 다른 화면과 똑같이 처리한다.
 */
export async function GET(request: NextRequest) {
  const { version, docs } = await listMissionGuideDocs();

  // 화면은 마지막 불러오기 시각을 v 로 붙여 부른다. 시각이 같으면 본문도 같으므로 브라우저가 남겨 두게 한다.
  const cacheable = version !== null && request.nextUrl.searchParams.get("v") === version;

  return Response.json(
    { version, docs },
    { headers: { "cache-control": cacheable ? "private, max-age=31536000, immutable" : "no-store" } },
  );
}
