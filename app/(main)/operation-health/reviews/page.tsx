import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { isReviewType, REVIEW_TYPES } from "@/domain/review";
import { listReviews, type ReviewSort, type ReviewVisibility } from "@/domain/service-review";

import { ReviewsPanel } from "./reviews-panel";

export const metadata: Metadata = { title: "후기 관리 · LetsOperation" };

// 불러오기나 카테고리 고치기를 다른 사람이 방금 했을 수 있다.
export const dynamic = "force-dynamic";

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * 미션 후기는 1만 건이 넘어 화면으로 한꺼번에 보내지 않는다. 유형 · 찾기 · 거르기 · 쪽을 주소에 두고
 * 서버에서 거른 한 쪽만 보낸다.
 */
export default async function ReviewsPage({ searchParams }: PageProps<"/operation-health/reviews">) {
  const params = await searchParams;
  const typeParam = one(params.type);
  const visibilityParam = one(params.visible);
  const filters = {
    type: isReviewType(typeParam) ? typeParam : REVIEW_TYPES[0].key,
    query: one(params.q),
    part: one(params.part),
    category: one(params.category),
    visibility: (["visible", "hidden"].includes(visibilityParam) ? visibilityParam : "all") as ReviewVisibility,
    sort: (one(params.sort) === "oldest" ? "oldest" : "newest") as ReviewSort,
    page: Number.parseInt(one(params.page), 10) || 1,
  };
  const snapshot = await listReviews(filters);

  return (
    <>
      <PageHeader
        title="후기 관리"
        description="미션 · 챌린지 · 라이브 · 라이브 멘토링 · 1:1 LIVE 멘토링 · 블로그 후기를 모아 유형별로 찾고, 칸마다 카테고리로 나눠 봅니다."
      />

      <ReviewsPanel
        filters={{ ...filters, part: snapshot.part, category: snapshot.category, page: snapshot.page }}
        snapshot={snapshot}
      />
    </>
  );
}
