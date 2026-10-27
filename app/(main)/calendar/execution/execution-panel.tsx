"use client";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useActionState, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  formatWeekLabel,
  slotFormValues,
  type WeekEvent,
} from "@/domain/calendar-week";
import { addDays, todayInKorea, type DateOnly } from "@/domain/date";
import type { CalendarSummary } from "@/domain/google-calendar";

import { disconnectGoogle, type ExecutionActionState } from "./actions";
import { EventForm, type EventFormTarget } from "./event-form";
import { TimerPanel, type TimerView } from "./timer-panel";
import { WeekView } from "./week-view";

const INITIAL_ACTION_STATE: ExecutionActionState = { error: null, done: null };

/** 새 일정 버튼이 채우는 시각. 오전 10시부터 한 시간 — 업무 시작 무렵이다. */
const DEFAULT_NEW_MINUTE = 10 * 60;

/**
 * 연결된 상태의 업무 수행 화면. 위에서부터 연결된 계정 · 타이머 · 주간 뷰.
 *
 * 일정 폼은 한 번에 하나만 연다. 같은 시트를 새 일정과 기존 일정이 함께 쓴다.
 */
export function ExecutionPanel({
  email,
  weekStart,
  calendars,
  events,
  failedCalendars,
  timer,
  serverNow,
}: {
  email: string;
  weekStart: DateOnly;
  calendars: CalendarSummary[];
  events: WeekEvent[];
  failedCalendars: string[];
  timer: TimerView | null;
  /** 화면을 그린 순간의 서버 시각. 타이머가 기기 시계 대신 이것을 기준으로 센다. */
  serverNow: string;
}) {
  const [target, setTarget] = useState<EventFormTarget | null>(null);
  const close = useCallback(() => setTarget(null), []);

  function openNew() {
    // 보고 있는 주가 이번 주면 오늘, 아니면 그 주 월요일에 채운다.
    const today = todayInKorea();
    const date = today >= weekStart && today < addDays(weekStart, 7) ? today : weekStart;
    setTarget({ kind: "new", values: slotFormValues(date, DEFAULT_NEW_MINUTE) });
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <section className="border-border flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-3">
        <p className="text-sm">
          <span className="text-muted-foreground">연결된 구글 계정 </span>
          <span className="font-medium">{email}</span>
        </p>
        <DisconnectButton email={email} />
      </section>

      <TimerPanel timer={timer} calendars={calendars} serverNow={serverNow} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button asChild variant="outline" size="icon-sm" aria-label="이전 주">
              <Link href={`?week=${addDays(weekStart, -7)}`}>
                <ChevronLeft />
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              {/* 주를 적지 않으면 서버가 그 순간의 이번 주를 고른다. 화면이 날짜를 계산하지 않는다. */}
              <Link href="/calendar/execution">오늘</Link>
            </Button>
            <Button asChild variant="outline" size="icon-sm" aria-label="다음 주">
              <Link href={`?week=${addDays(weekStart, 7)}`}>
                <ChevronRight />
              </Link>
            </Button>
            <h2 className="ml-2 text-sm font-medium">{formatWeekLabel(weekStart)}</h2>
          </div>
          <Button size="sm" onClick={openNew}>
            <Plus aria-hidden />새 일정
          </Button>
        </div>

        {failedCalendars.length > 0 ? (
          <p className="border-border text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
            읽지 못한 캘린더가 있어 그 일정은 빠져 있습니다: {failedCalendars.join(", ")}
          </p>
        ) : null}

        <WeekView
          weekStart={weekStart}
          events={events}
          onSelectEvent={(event) => setTarget({ kind: "edit", event })}
          onSelectSlot={(date, minute) =>
            setTarget({
              kind: "new",
              values: slotFormValues(date, minute ?? 0, minute === null),
            })
          }
        />
      </section>

      <Sheet open={target !== null} onOpenChange={(open) => (open ? null : close())}>
        <SheetContent className="overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>
              {target?.kind === "edit"
                ? target.event.writable
                  ? "일정 수정"
                  : "일정"
                : "새 일정"}
            </SheetTitle>
            <SheetDescription>
              {target?.kind === "edit" && !target.event.writable
                ? "읽기 전용 일정입니다."
                : "저장하면 구글 캘린더에 바로 반영됩니다."}
            </SheetDescription>
          </SheetHeader>
          {target ? (
            <EventForm
              // 다른 일정이나 다른 칸을 열면 적던 값을 버리고 새로 채운다.
              key={target.kind === "edit" ? target.event.key : JSON.stringify(target.values)}
              target={target}
              calendars={calendars}
              onDone={close}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/**
 * 구글 연결 해제. 팀 공용 화면이라 누르면 모두의 화면에서 일정이 사라진다 — 그 사실을
 * 확인 창에 적는다.
 */
export function DisconnectButton({ email }: { email: string }) {
  const [state, action, pending] = useActionState(disconnectGoogle, INITIAL_ACTION_STATE);

  function confirmDisconnect(event: FormEvent<HTMLFormElement>) {
    const message = `${email} 연결을 해제할까요? 다시 연결하기 전까지 팀원 모두의 화면에서 일정이 사라집니다. 돌고 있는 타이머는 그대로 남습니다.`;
    if (!window.confirm(message)) event.preventDefault();
  }

  return (
    <form action={action} onSubmit={confirmDisconnect} className="flex items-center gap-2">
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? "해제 중…" : "연결 해제"}
      </Button>
      {state.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * 구글에서 돌아온 결과(`?google=`)를 알림으로 띄우고 주소에서 걷어낸다. 새로 고칠 때마다
 * 같은 알림이 다시 뜨지 않게 한다. 보고 있던 주(`?week=`)는 남긴다.
 */
export function ConnectNotice({
  notice,
}: {
  notice: { tone: "success" | "error"; message: string } | null;
}) {
  const shown = useRef(false);

  useEffect(() => {
    if (!notice || shown.current) return;
    shown.current = true;
    if (notice.tone === "success") toast.success(notice.message);
    else toast.error(notice.message);

    const url = new URL(window.location.href);
    url.searchParams.delete("google");
    window.history.replaceState(window.history.state, "", url);
  }, [notice]);

  return null;
}
