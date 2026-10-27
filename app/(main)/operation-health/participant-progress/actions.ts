"use server";

import { revalidatePath } from "next/cache";

import { syncParticipantProgress, type ParticipantProgressSyncResult } from "@/domain/service-participant-progress";

/**
 * 접근 차단은 proxy.ts 가 모든 경로에서 처리한다. 서버 액션도 페이지 경로로 POST 되므로
 * 같은 검사를 거친다(plan.md §7 — 계정 분리 없음 + 접근 차단 있음).
 */

const PATH = "/operation-health/participant-progress";

export type ParticipantProgressSyncState = {
  error: string | null;
  result: ParticipantProgressSyncResult | null;
  at: number;
};

export async function syncParticipantProgressAction(): Promise<ParticipantProgressSyncState> {
  try {
    const result = await syncParticipantProgress();
    revalidatePath(PATH);
    return { error: null, result, at: Date.now() };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { error: reason, result: null, at: Date.now() };
  }
}
