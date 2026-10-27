"use server";

import { revalidatePath } from "next/cache";

import { syncMissionGuides, type MissionGuideSyncResult } from "@/domain/service-mission-guide";

/**
 * 접근 차단은 proxy.ts 가 모든 경로에서 처리한다. 서버 액션도 페이지 경로로 POST 되므로
 * 같은 검사를 거친다(plan.md §7 — 계정 분리 없음 + 접근 차단 있음).
 */

export type MissionGuideSyncState = {
  error: string | null;
  result: MissionGuideSyncResult | null;
  at: number;
};

export async function syncMissionGuidesAction(): Promise<MissionGuideSyncState> {
  try {
    const result = await syncMissionGuides();
    revalidatePath("/program-management/mission-guides");
    return { error: null, result, at: Date.now() };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { error: reason, result: null, at: Date.now() };
  }
}
