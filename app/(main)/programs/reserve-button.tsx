"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import type { ReserveResult } from "@/domain/notice-reservation";
import { RESERVE_DAYS_BEFORE_START } from "@/domain/program-notice";

import { reserveNotices, type ReserveState } from "./actions";

const INITIAL_STATE: ReserveState = { error: null, result: null };

/**
 * 참여자 안내문을 지금 건다. 크론이 자정에 같은 일을 하지만, 안내문을 방금 적었거나
 * 슬랙 채널을 방금 채운 경우에는 자정까지 기다릴 수 없다 — 오늘 저녁으로 적어둔 글은
 * 그 사이에 발송 시각이 지나버린다.
 *
 * 눌러도 안전하다. 이미 걸린 글은 다시 걸리지 않으므로 두 통이 나가지 않는다
 * (domain/notice-reservation 의 유일 제약).
 */
export function ReserveButton() {
  const [state, formAction, pending] = useActionState(
    reserveNotices,
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="flex items-center gap-2">
      <span className="text-muted-foreground text-xs" aria-live="polite">
        {state.error ? (
          <span className="text-destructive">{state.error}</span>
        ) : state.result ? (
          summarize(state.result)
        ) : null}
      </span>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "거는 중…" : "지금 걸기"}
      </Button>
    </form>
  );
}

/**
 * 무엇이 달라졌는지만 짧게. 아무 일도 없었을 때 그 이유가 서로 다르므로 뭉뚱그리지
 * 않는다 — 다가온 기수가 없는 것과, 기수는 있는데 적어둔 글이 없는 것과, 이미 다 걸려
 * 있는 것은 사람이 할 일이 각각 다르다.
 */
function summarize(result: ReserveResult): string {
  if (result.programs === 0) {
    return `${RESERVE_DAYS_BEFORE_START}일 안으로 다가온 기수가 없습니다`;
  }

  const parts: string[] = [];
  if (result.reserved > 0) parts.push(`${result.reserved}건 예약`);
  if (result.failed > 0) parts.push(`${result.failed}건 실패`);
  if (parts.length > 0) return parts.join(" · ");

  return result.kept > 0
    ? `이미 ${result.kept}건 걸려 있습니다`
    : "걸 안내문이 없습니다";
}
