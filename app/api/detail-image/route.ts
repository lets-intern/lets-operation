import type { NextRequest } from "next/server";

import { isDetailImageSrc } from "@/domain/detail-page-content";

/**
 * 상세페이지 이미지를 대신 받아 넘긴다.
 *
 * 이미지 저장소(S3)가 CORS 를 열어두지 않아 브라우저가 이미지 픽셀을 캔버스로 읽지 못한다.
 * 화면에서 OCR 을 돌리려면 같은 출처에서 받아야 해서 이 통로를 둔다(plan.md §5).
 *
 * 아무 주소나 대신 받아주는 통로가 되지 않도록 렛츠커리어 이미지 저장소 주소만 받는다.
 * 접근 차단은 proxy.ts 가 다른 화면과 똑같이 처리한다.
 */
/**
 * 넘겨주는 형식. SVG 는 스크립트를 품을 수 있어 우리 도메인에서 내려주면 안 되고,
 * OCR 도 어차피 픽셀 이미지만 읽는다.
 */
const RASTER_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export async function GET(request: NextRequest) {
  const src = request.nextUrl.searchParams.get("src") ?? "";
  if (!isDetailImageSrc(src)) {
    return new Response("받을 수 없는 이미지 주소입니다.", { status: 400 });
  }

  // 저장소가 다른 곳으로 돌려보내면 허용 목록을 우회하게 되므로 따라가지 않는다.
  const upstream = await fetch(src, { redirect: "error", cache: "no-store" }).catch(
    () => null,
  );
  const type = (upstream?.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!upstream?.ok || !upstream.body || !RASTER_IMAGE_TYPES.has(type)) {
    return new Response("이미지를 받지 못했습니다.", { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "content-type": type,
      // 우리 도메인에서 내려가는 파일이라 브라우저가 문서로 해석해 스크립트를 돌리지 못하게 잠근다.
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      // 같은 주소의 이미지는 바뀌지 않는다. 다시 읽을 때 저장소까지 가지 않게 둔다.
      "cache-control": "private, max-age=86400",
    },
  });
}
