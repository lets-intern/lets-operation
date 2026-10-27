"use server";

import { revalidatePath } from "next/cache";

import { saveReviewCategories, syncReviews, type ReviewSyncResult } from "@/domain/service-review";

/**
 * 접근 차단은 proxy.ts 가 모든 경로에서 처리한다. 서버 액션도 페이지 경로로 POST 되므로
 * 같은 검사를 거친다(plan.md §7 — 계정 분리 없음 + 접근 차단 있음).
 */

const PATH = "/operation-health/reviews";

export type ReviewSyncState = {
  result: ReviewSyncResult | null;
  at: number;
};

/** 두 쿼리 각각의 성패는 결과에 담긴다. 한쪽이 실패해도 다른 쪽은 바뀌었을 수 있다. */
export async function syncReviewsAction(): Promise<ReviewSyncState> {
  const result = await syncReviews();
  revalidatePath(PATH);
  return { result, at: Date.now() };
}

/** 칸 열쇠 모양 — `유형:후기id:칸id` */
const PART_KEY = /^[A-Z_]+:\d+:\d+$/;

/** 칸 카테고리를 고친다. categories 가 null 이면 키워드 규칙으로 되돌린다. */
export async function saveReviewCategoriesAction(
  key: string,
  categories: string[] | null,
): Promise<{ error: string | null }> {
  if (typeof key !== "string" || !PART_KEY.test(key)) return { error: "후기를 찾지 못했습니다." };
  if (categories !== null && !Array.isArray(categories)) return { error: "카테고리를 다시 골라 주세요." };
  try {
    await saveReviewCategories(
      key,
      categories === null ? null : categories.filter((value): value is string => typeof value === "string"),
    );
    revalidatePath(PATH);
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
