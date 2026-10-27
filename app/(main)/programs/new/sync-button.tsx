"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { syncMkt, type SyncState } from "./actions";

const INITIAL_STATE: SyncState = {
  error: null,
  result: null,
  detailOpen: null,
  history: null,
};

/**
 * 마케팅팀 기획을 지금 가져온다. 크론이 매일 오전 9시에 같은 일을 하지만,
 * 저쪽에서 방금 적은 기획을 기다리지 않고 보고 싶을 때가 있다.
 */
export function SyncButton({ syncedAt }: { syncedAt: string | null }) {
  const [state, formAction, pending] = useActionState(syncMkt, INITIAL_STATE);

  return (
    <form action={formAction} className="flex items-center gap-3">
      <span className="text-muted-foreground text-xs" aria-live="polite">
        {state.error ? (
          <span className="text-destructive">{state.error}</span>
        ) : state.result ? (
          summarize(state.result, state.detailOpen, state.history)
        ) : syncedAt ? (
          `마지막 가져오기 ${syncedAt}`
        ) : (
          "아직 가져온 적이 없습니다"
        )}
      </span>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "가져오는 중…" : "지금 가져오기"}
      </Button>
    </form>
  );
}

/** 무엇이 달라졌는지만 짧게 알린다. 달라진 게 없으면 그렇다고 말한다. */
function summarize(
  result: NonNullable<SyncState["result"]>,
  detailOpen: SyncState["detailOpen"],
  history: SyncState["history"],
): string {
  const parts: string[] = [];
  if (result.opened > 0) parts.push(`${result.opened}건 개설`);
  if (result.linked > 0) parts.push(`${result.linked}건 연결`);
  if (result.added > 0) parts.push(`기획 ${result.added}건 추가`);
  if (result.removed > 0) parts.push(`기획 ${result.removed}건 삭제`);
  if (result.healed > 0) parts.push(`태스크 ${result.healed}건 보정`);
  if (result.blocked > 0) parts.push(`${result.blocked}건 확인 필요`);

  // 지난 운영 되짚기. 새로 선 것과 날짜가 달라진 것만 적는다 — 건너뛴 줄은 우리 것이 아닌
  // 프로그램이 대부분이라, 매번 세어 보이면 할 일이 남은 것처럼 읽힌다.
  if (history) {
    if (history.imported > 0) parts.push(`지난 운영 ${history.imported}건 되짚음`);
    if (history.refreshed > 0) parts.push(`지난 운영 ${history.refreshed}건 갱신`);
  }

  // 실서비스 확인은 가져오기와 다른 원본이라 따로 적는다. 저쪽이 막혔으면 아무 말도 하지 않는다.
  if (detailOpen) {
    if (detailOpen.completed > 0) parts.push(`${detailOpen.completed}건 자동 완료`);
    else if (detailOpen.seen > 0) parts.push(`${detailOpen.seen}건 열림 확인`);
    // 둘 다 사람이 봐야 하는 건이라 한 줄로 합친다. 애매해서 넘긴 것이든 이름이 달라
    // 넘긴 것이든, 할 일은 실제 프로그램을 열어 확인하는 것으로 같다.
    const check = detailOpen.ambiguous + detailOpen.mismatched;
    if (check > 0) parts.push(`${check}건 실제 프로그램 확인 필요`);
  }

  return parts.length > 0 ? parts.join(" · ") : "달라진 기획이 없습니다";
}
