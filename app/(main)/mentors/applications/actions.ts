"use server";

import { revalidatePath } from "next/cache";

import { deleteMentorApplication, updateMentorApplication } from "@/domain/mentor-application";
import {
  isMentorApplicationId,
  isMentorApplicationStatus,
  MENTOR_MEMO_MAX_LENGTH,
} from "@/domain/mentor-application-status";

/**
 * 접근 차단은 proxy.ts 가 모든 경로에서 처리한다. 서버 액션도 페이지 경로로 POST 되므로
 * 같은 검사를 거친다(plan.md §7 — 계정 분리 없음 + 접근 차단 있음).
 */

const PATH = "/mentors/applications";

async function save(id: unknown, data: Parameters<typeof updateMentorApplication>[1]): Promise<{ error: string | null }> {
  if (!isMentorApplicationId(id)) return { error: "신청서를 찾지 못했습니다." };
  try {
    const found = await updateMentorApplication(id, data);
    revalidatePath(PATH);
    return { error: found ? null : "신청서를 찾지 못했습니다." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function setMentorApplicationStatusAction(id: string, status: string): Promise<{ error: string | null }> {
  if (!isMentorApplicationStatus(status)) return { error: "진행 상태를 다시 골라 주세요." };
  return save(id, { status });
}

export async function saveMentorApplicationMemoAction(id: string, memo: string): Promise<{ error: string | null }> {
  if (typeof memo !== "string") return { error: "메모를 다시 적어 주세요." };
  if (memo.length > MENTOR_MEMO_MAX_LENGTH) {
    return { error: `메모는 ${MENTOR_MEMO_MAX_LENGTH.toLocaleString()}자까지 적을 수 있습니다.` };
  }
  return save(id, { adminMemo: memo });
}

/** 신청서와 첨부파일을 지운다. 지우면 같은 전화번호로 다시 신청할 수 있다. */
export async function deleteMentorApplicationAction(id: string): Promise<{ error: string | null }> {
  if (!isMentorApplicationId(id)) return { error: "신청서를 찾지 못했습니다." };
  try {
    const found = await deleteMentorApplication(id);
    revalidatePath(PATH);
    return { error: found ? null : "이미 지워진 신청서입니다." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
