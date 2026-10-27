import { formatKoreanDateTime } from "@/domain/date";
import type { ProgramReservations } from "@/domain/notice-reservation";
import { describeNoticeTarget, RESERVE_DAYS_BEFORE_START } from "@/domain/program-notice";

import { CancelReservationButton } from "./cancel-reservation-button";
import { ReserveButton } from "./reserve-button";

/**
 * 참여자 안내문이 슬랙에 언제 걸렸는지. 걸린 예약은 **기수의 것**이라 챌린지 하나를 보는
 * 안내문 화면이 아니라 여기서 본다(plan.md §5).
 *
 * 못 걸린 건을 걸린 건 아래로 밀어두지 않고 **위에 세운다.** 걸린 예약은 이제 슬랙이
 * 지키므로 볼 일이 없고, 사람이 손볼 것은 못 걸린 쪽뿐이다.
 */
export function NoticeReservations({ rows }: { rows: ProgramReservations[] }) {
  const failed = rows.reduce((count, row) => count + row.failed.length, 0);
  const all = rows.flatMap((row) => row.reserved);
  const sent = all.filter((notice) => notice.sent).length;
  // 헤더의 `예약` 은 아직 나가지 않은 것만 센다. 이미 나간 글까지 세면 걸려 있는 줄로 읽힌다.
  const reserved = all.length - sent;

  return (
    <section className="border-border flex flex-col rounded-lg border p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-medium">안내문 슬랙 예약</h2>
          <span className="text-muted-foreground text-xs">
            {reserved}건 예약{sent > 0 ? ` · ${sent}건 발송됨` : ""}
          </span>
          {failed > 0 ? (
            <span className="text-destructive text-xs">
              못 걸린 건 {failed}건
            </span>
          ) : null}
        </div>
        <ReserveButton />
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          걸린 예약이 없습니다. 참여자 · 챌린지 공지방 안내문은 기수가 시작하기{" "}
          {RESERVE_DAYS_BEFORE_START}일 전에 예약됩니다.
        </p>
      ) : (
        <ul className="border-border divide-border divide-y rounded-lg border">
          {rows.map((row) => (
            <ProgramRow key={row.programId} row={row} />
          ))}
        </ul>
      )}

      {/*
       * 슬랙을 열어 찾아도 없다는 것을 미리 말해준다. API 로 건 예약은 슬랙 화면의
       * `예약된 메시지` 에 뜨지 않는데(plan.md §5 의 2026-09-13 정정), 그걸 모르면
       * 걸린 예약을 안 걸린 것으로 읽고 같은 자리를 몇 번이고 되돌게 된다.
       */}
      {reserved > 0 ? (
        <p className="text-muted-foreground mt-3 text-xs">
          걸린 예약은 슬랙 화면에는 보이지 않습니다. 거두려면 여기서 취소하세요.
        </p>
      ) : null}
    </section>
  );
}

/** 한 기수. 못 걸린 것부터 적고 걸린 것을 그 아래 둔다. */
function ProgramRow({ row }: { row: ProgramReservations }) {
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-sm">
          {row.challengeName} {row.cohort}기
        </p>
        <p className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {row.placedCount}/{row.noticeCount}건
        </p>
      </div>

      {row.awaiting ? (
        <p className="text-muted-foreground mt-1 text-xs">
          아직 예약되지 않았습니다. 안내문 {row.noticeCount}건이 다음 확인에서 걸립니다.
        </p>
      ) : null}

      {row.failed.map((notice) => (
        <p key={notice.reservationId} className="text-destructive mt-1 text-xs">
          {describeNoticeTarget(notice.placement, notice.audience)} · {notice.title} —{" "}
          {notice.failure}
        </p>
      ))}

      {/*
       * 보내는 사람을 함께 적는다. 그 사람 이름으로 참여자에게 보이므로 누구 이름으로
       * 나가는지가 여기서 읽혀야 한다.
       *
       * 거두는 자리를 옆에 둔다. **슬랙 화면에서는 이 예약이 보이지 않아**(plan.md §5 의
       * 2026-09-13 정정) 여기가 유일하게 손댈 수 있는 곳이다.
       */}
      {row.reserved.map((notice) => (
        <div
          key={notice.reservationId}
          className="mt-0.5 flex items-center justify-between gap-2"
        >
          <p className="text-muted-foreground truncate text-xs">
            {formatKoreanDateTime(notice.postAt)} ·{" "}
            {describeNoticeTarget(notice.placement, notice.audience)} · {notice.title}
            {notice.senderName ? ` · ${notice.senderName}` : ""}
          </p>
          {/* 이미 나간 글은 거둘 것이 없다. 버튼 대신 나갔다는 것을 적는다. */}
          {notice.sent ? (
            <span
              className="text-muted-foreground shrink-0 px-2 text-xs"
              title="발송 시각이 지나 슬랙이 보낸 것으로 봅니다"
            >
              발송됨
            </span>
          ) : (
            <CancelReservationButton reservationId={notice.reservationId} />
          )}
        </div>
      ))}
    </li>
  );
}
