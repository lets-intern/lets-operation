"use server";

import { revalidatePath } from "next/cache";

import {
  saveDetailImageText,
  syncServiceDetailPages,
  type DetailPageSyncResult,
} from "@/domain/service-detail-page";
import { readServiceScreens, type ScreenReadResult } from "@/domain/service-detail-screen";

/**
 * 접근 차단은 proxy.ts 가 모든 경로에서 처리한다. 서버 액션도 페이지 경로로 POST 되므로
 * 같은 검사를 거친다(plan.md §7 — 계정 분리 없음 + 접근 차단 있음).
 */

export type DetailSyncState = {
  error: string | null;
  result: DetailPageSyncResult | null;
  at: number;
};

export async function syncDetailPages(): Promise<DetailSyncState> {
  try {
    const result = await syncServiceDetailPages();
    revalidatePath("/program-management/detail-pages");
    return { error: null, result, at: Date.now() };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { error: reason, result: null, at: Date.now() };
  }
}

/**
 * 화면에서 OCR 로 읽어낸 글을 저장한다. 한 장씩 부르므로 화면 전체를 다시 그리지 않는다 —
 * 백몇십 페이지의 내용을 이미지마다 다시 내려보내게 된다. 화면은 읽은 글을 제 상태에 더한다.
 */
export async function saveImageText(src: string, text: string): Promise<{ error: string | null }> {
  if (typeof src !== "string" || typeof text !== "string") {
    return { error: "잘못된 요청입니다." };
  }
  try {
    await saveDetailImageText(src, text);
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 실서비스 화면을 한 묶음 읽는다. 화면이 remaining 이 0 이 될 때까지 다시 부르고, 끝나면 새로 그린다.
 * 묶음마다 새로 그리지 않는다 — 백몇십 페이지의 내용을 묶음마다 다시 내려보내게 된다.
 */
export async function readScreens(
  startedAt: string | null,
): Promise<{ error: string | null; result: ScreenReadResult | null }> {
  const since = startedAt === null ? null : new Date(startedAt);
  if (since && Number.isNaN(since.getTime())) return { error: "잘못된 요청입니다.", result: null };
  try {
    return { error: null, result: await readServiceScreens(since) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), result: null };
  }
}
