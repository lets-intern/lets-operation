import type { NextRequest } from "next/server";

import { findMentorAttachmentPath, MENTOR_ATTACHMENT_BUCKET } from "@/domain/mentor-application";
import { isMentorApplicationId } from "@/domain/mentor-application-status";
import { createStorageSignedUrl } from "@/lib/supabase-storage";

/**
 * 멘토 신청서 첨부파일(PDF)을 연다. 누를 때마다 짧게 사는 signed URL 을 만들어 그리로 보낸다.
 *
 * 주소를 화면에 미리 박아 두지 않는 것은 목록을 열어 둔 채 시간이 지나도 링크가 죽지 않게 하고,
 * 열린 주소가 어딘가에 남아도 곧 못 쓰게 하려는 것이다. 경로는 화면에서 받지 않고 id 로 DB 에서 다시 찾는다 —
 * 그래야 bucket 안의 다른 파일을 집어 열 수 없다. 접근 차단은 proxy.ts 가 다른 화면과 똑같이 처리한다.
 */

/** 새 탭이 열리기까지만 버티면 된다. */
const SIGNED_URL_EXPIRES_SECONDS = 60;

export async function GET(_request: NextRequest, ctx: RouteContext<"/mentors/applications/[id]/attachment">) {
  const { id } = await ctx.params;
  if (!isMentorApplicationId(id)) return new Response("신청서를 찾지 못했습니다.", { status: 404 });

  const path = await findMentorAttachmentPath(id);
  if (!path) return new Response("첨부파일이 없는 신청서입니다.", { status: 404 });

  try {
    const signedUrl = await createStorageSignedUrl(MENTOR_ATTACHMENT_BUCKET, path, SIGNED_URL_EXPIRES_SECONDS);
    return new Response(null, {
      status: 303,
      headers: { location: signedUrl, "cache-control": "no-store" },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : String(error), { status: 502 });
  }
}
