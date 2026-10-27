"use server";

import { revalidatePath } from "next/cache";

import { isCsCategory } from "@/domain/cs-inquiry";
import {
  saveCsInquiryCategories,
  setCsInquiryHidden,
  syncCsInquiries,
  type CsInquirySyncResult,
} from "@/domain/service-cs-inquiry";

/**
 * 접근 차단은 proxy.ts 가 모든 경로에서 처리한다. 서버 액션도 페이지 경로로 POST 되므로
 * 같은 검사를 거친다(plan.md §7 — 계정 분리 없음 + 접근 차단 있음).
 */

const PATH = "/operation-health/cs-collection";

export type CsInquirySyncState = {
  error: string | null;
  result: CsInquirySyncResult | null;
  at: number;
};

export async function syncCsInquiriesAction(): Promise<CsInquirySyncState> {
  try {
    const result = await syncCsInquiries();
    revalidatePath(PATH);
    return { error: null, result, at: Date.now() };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { error: reason, result: null, at: Date.now() };
  }
}

/** 실서비스 문의 번호는 int4 칸에 들어간다. 범위를 넘으면 DB 오류 문구가 화면에 그대로 나간다. */
const MAX_INQUIRY_ID = 2_147_483_647;

/** 카테고리를 고친다. categories 가 비어 있으면(null) 키워드 규칙으로 되돌린다. */
export async function saveCsInquiryCategoriesAction(
  inquiryId: number,
  categories: string[] | null,
): Promise<{ error: string | null }> {
  if (!Number.isInteger(inquiryId) || inquiryId < 1 || inquiryId > MAX_INQUIRY_ID) {
    return { error: "문의를 찾지 못했습니다." };
  }
  if (categories !== null && !Array.isArray(categories)) return { error: "카테고리를 다시 골라 주세요." };
  try {
    await saveCsInquiryCategories(
      inquiryId,
      categories === null ? null : categories.filter((value) => typeof value === "string" && isCsCategory(value)),
    );
    revalidatePath(PATH);
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** 문의를 목록에서 숨기거나 다시 보이게 한다. */
export async function setCsInquiryHiddenAction(inquiryId: number, hidden: boolean): Promise<{ error: string | null }> {
  if (!Number.isInteger(inquiryId) || inquiryId < 1 || inquiryId > MAX_INQUIRY_ID) {
    return { error: "문의를 찾지 못했습니다." };
  }
  if (typeof hidden !== "boolean") return { error: "다시 눌러 주세요." };
  try {
    await setCsInquiryHidden(inquiryId, hidden);
    revalidatePath(PATH);
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
