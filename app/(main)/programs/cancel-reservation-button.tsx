"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { cancelReservation, type CancelState } from "./actions";

const INITIAL_STATE: CancelState = { error: null };

/**
 * 걸어둔 예약 한 건을 거둔다.
 *
 * 한 번 걸린 예약은 다시 걸리지 않으므로(domain/notice-reservation), 채널이나 발송 시각을
 * 고쳐도 이미 걸린 글은 옛 설정 그대로 나간다. 거두는 자리가 없으면 그것을 되돌릴 방법이
 * 아예 없다 — 슬랙에서 지워도 우리 줄이 남아 `지금 걸기` 가 건너뛴다.
 *
 * 거두고 나면 그 안내문은 아직 걸리지 않은 상태가 되어, `지금 걸기` 가 지금 설정으로
 * 다시 건다.
 */
export function CancelReservationButton({
  reservationId,
}: {
  reservationId: string;
}) {
  const [state, formAction, pending] = useActionState(
    cancelReservation,
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="flex shrink-0 items-center gap-1.5">
      <input type="hidden" name="reservationId" value={reservationId} />
      {state.error ? (
        <span className="text-destructive text-xs" aria-live="polite">
          {state.error}
        </span>
      ) : null}
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={pending}
        // 눌러 되돌릴 수 있는 일이라 확인을 묻지 않는다. 다시 걸면 그만이다.
        title="슬랙에서 이 예약을 거두고 다시 걸 수 있는 상태로 되돌립니다"
      >
        {pending ? "거두는 중…" : "취소"}
      </Button>
    </form>
  );
}
