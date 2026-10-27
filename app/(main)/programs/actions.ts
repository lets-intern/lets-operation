"use server";

import { revalidatePath } from "next/cache";

import {
  cancelNoticeReservation,
  reserveUpcomingNotices,
  type ReserveResult,
} from "@/domain/notice-reservation";

/**
 * 프로그램 운영 화면이 서버에 맡기는 일.
 */

const PATH = "/programs";

export type ReserveState = {
  error: string | null;
  result: ReserveResult | null;
};

/**
 * 참여자 안내문을 지금 한 번 걸어본다. 크론이 자정에 같은 일을 하지만, 자정과 자정
 * 사이에 적은 글은 그 회차를 이미 놓쳤다 — Vercel Hobby 가 그보다 잦은 크론을 받지
 * 않아(vercel.json) 사람이 직접 거는 자리가 필요하다.
 *
 * 이전 상태도 폼 값도 쓰지 않는다. 누르면 그냥 한 번 건다. 이미 걸린 글은 다시 걸리지
 * 않으므로(domain/notice-reservation) 몇 번을 눌러도 두 통이 나가지 않는다.
 */
export async function reserveNotices(): Promise<ReserveState> {
  try {
    const result = await reserveUpcomingNotices();

    revalidatePath(PATH);

    return { error: null, result };
  } catch (error) {
    // 슬랙이 거절한 건은 줄에 사유로 남고 여기까지 오지 않는다. 여기 오는 것은 DB 가 막힌 경우다.
    console.error("안내문 예약 실패", error);

    return {
      error: "예약하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      result: null,
    };
  }
}

export type CancelState = { error: string | null };

/**
 * 걸어둔 예약 하나를 거둔다. 거두고 나면 그 안내문은 다시 걸 수 있는 상태가 되므로,
 * 채널이나 발송 시각을 고친 뒤 `지금 걸기` 를 누르면 새 설정으로 나간다.
 */
export async function cancelReservation(
  _prevState: CancelState,
  formData: FormData,
): Promise<CancelState> {
  const reservationId = String(formData.get("reservationId") ?? "");
  if (!reservationId) return { error: "어느 예약인지 알 수 없습니다." };

  try {
    const result = await cancelNoticeReservation(reservationId);
    if (!result.ok) {
      // 열어둔 사이 발송 시각이 지나 막힌 경우가 있다. 목록을 되살려 그 줄이 `발송됨` 으로 서게 한다.
      revalidatePath(PATH);
      return { error: result.failure };
    }

    revalidatePath(PATH);

    return { error: null };
  } catch (error) {
    console.error("안내문 예약 취소 실패", error);
    return { error: "취소하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}
