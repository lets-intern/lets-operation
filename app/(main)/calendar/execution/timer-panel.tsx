"use client";

import { Play, Square } from "lucide-react";
import { type FormEvent, useActionState, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  clockOffsetMs,
  formatDuration,
  formatElapsed,
  formatKstTime,
  MAX_EVENT_DESCRIPTION_LENGTH,
  MAX_EVENT_TITLE_LENGTH,
  pickWorkCalendar,
  WORK_CALENDAR_NAME,
} from "@/domain/calendar-week";
import type { CalendarSummary } from "@/domain/google-calendar";

import {
  discardWorkTimer,
  endWorkTimer,
  finishWorkTimer,
  resumeWorkTimer,
  startWorkTimer,
  type ExecutionActionState,
  type ExecutionSaveState,
} from "./actions";
import { useNow } from "./use-now";

const INITIAL_ACTION_STATE: ExecutionActionState = { error: null, done: null };
const INITIAL_SAVE_STATE: ExecutionSaveState = { error: null, saved: null };

/** 화면이 받는 타이머. 시각은 ISO 문자열이다. */
export type TimerView = { startedAt: string; title: string | null; endingAt: string | null };

/**
 * 업무 타이머. 시작 시각은 서버에 있어 탭을 닫거나 다른 기기에서 열어도 같은 타이머가
 * 이어 흐른다. 화면은 그 시각에서 1초마다 경과 시간을 다시 셀 뿐이다. 기기 시계가 틀려도
 * 같은 값이 서도록 서버 시각과의 차이를 한 번 재서 보정한다.
 *
 * `종료` 를 누르면 서버가 그 순간을 굳히고(`endingAt`) 확인 폼이 뜬다. 제목 · 캘린더 · 설명을
 * 거기서 정하고, 일정의 끝은 굳혀 둔 시각이다 — 폼을 적는 동안 흐른 시간이 붙지 않는다.
 * 확인 폼 상태도 서버에 있어 새로 고치거나 다른 기기에서 열어도 이어진다.
 *
 * 모든 요청에 화면이 본 시작 시각을 싣는다. 그 사이 다른 곳에서 타이머가 바뀌었으면 서버가
 * 물러나고 화면을 다시 그린다.
 *
 * 액션 상태는 이 컴포넌트 맨 위에 둔다. 타이머가 끝나 폼이 사라져도 결과를 받아 알림을 띄워야 한다.
 */
export function TimerPanel({
  timer,
  calendars,
  serverNow,
}: {
  timer: TimerView | null;
  calendars: CalendarSummary[];
  /** 화면을 그린 순간의 서버 시각. 기기 시계와의 차이를 재는 데만 쓴다. */
  serverNow: string;
}) {
  const uid = useId();
  const now = useNow(1000);
  // 처음 그릴 때 한 번만 잰다. 그 뒤로 기기 시계가 흘러가는 빠르기는 믿는다.
  const [offset] = useState(() => clockOffsetMs(serverNow));
  const [startState, startAction, starting] = useActionState(startWorkTimer, INITIAL_ACTION_STATE);
  const [endState, endAction, ending] = useActionState(endWorkTimer, INITIAL_ACTION_STATE);
  const [resumeState, resumeAction, resuming] = useActionState(
    resumeWorkTimer,
    INITIAL_ACTION_STATE,
  );
  const [discardState, discardAction, discarding] = useActionState(
    discardWorkTimer,
    INITIAL_ACTION_STATE,
  );
  const [finishState, finishAction, finishing] = useActionState(
    finishWorkTimer,
    INITIAL_SAVE_STATE,
  );

  const handledFinish = useRef<number | null>(null);
  useEffect(() => {
    if (!finishState.saved || handledFinish.current === finishState.saved.at) return;
    handledFinish.current = finishState.saved.at;
    toast.success(`"${finishState.saved.title}" 일정을 구글 캘린더에 등록했습니다.`);
  }, [finishState.saved]);

  // 타이머 일정도 늘 이 캘린더에 들어간다(domain/google-calendar 의 createEvent).
  const workCalendar = pickWorkCalendar(calendars);
  const busy = starting || ending || resuming || discarding || finishing;

  function confirmDiscard(event: FormEvent<HTMLFormElement>) {
    if (!window.confirm("타이머를 버릴까요? 잰 시간은 일정으로 남지 않습니다.")) {
      event.preventDefault();
    }
  }

  // 지난 결과가 엉뚱한 자리에 남지 않게, 지금 보이는 버튼에 딸린 오류만 보인다.
  // 타이머가 다른 곳에서 바뀐 것은 어느 상태에서든 알려야 해서 버리기 · 등록 오류는 늘 보인다.
  const error = !timer
    ? (startState.error ?? finishState.error ?? discardState.error)
    : timer.endingAt
      ? (finishState.error ?? resumeState.error ?? discardState.error)
      : (endState.error ?? discardState.error);

  const startedMs = timer ? Date.parse(timer.startedAt) : 0;
  const endingMs = timer?.endingAt ? Date.parse(timer.endingAt) : null;
  // 서버가 그린 첫 화면에는 기기 시각이 없다(useNow). 그때는 서버 시각으로 센다.
  const currentMs = endingMs ?? (now === null ? Date.parse(serverNow) : now + offset);

  const startedAtField = timer ? (
    <input type="hidden" name="startedAt" value={timer.startedAt} />
  ) : null;

  return (
    <section className="border-border space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">타이머</h2>
        <p className="text-muted-foreground text-xs">
          한 번에 하나만 돕니다. 끝내면 시작~종료 시각 그대로 일정이 됩니다.
        </p>
      </div>

      {!timer ? (
        <form action={startAction} className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="타이머 제목"
            name="title"
            maxLength={MAX_EVENT_TITLE_LENGTH}
            placeholder="무엇을 하나요? 비워 두고 끝낼 때 적어도 됩니다"
            className="max-w-96"
          />
          <Button type="submit" disabled={busy}>
            <Play aria-hidden />
            {starting ? "시작 중…" : "시작"}
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="truncate text-sm">
              {timer.title ?? <span className="text-muted-foreground">제목 없음</span>}
            </p>
            <p className="text-muted-foreground text-xs">
              {formatKstTime(new Date(timer.startedAt))} 시작
            </p>
          </div>
          <p className="font-mono text-2xl tabular-nums" aria-live="off">
            {formatElapsed(currentMs - startedMs)}
          </p>
          {!timer.endingAt ? (
            <div className="flex items-center gap-2">
              <form action={endAction}>
                {startedAtField}
                <Button type="submit" disabled={busy}>
                  <Square aria-hidden />
                  {ending ? "멈추는 중…" : "종료"}
                </Button>
              </form>
              <form action={discardAction} onSubmit={confirmDiscard}>
                {startedAtField}
                <Button type="submit" variant="ghost" disabled={busy}>
                  {discarding ? "버리는 중…" : "버리기"}
                </Button>
              </form>
            </div>
          ) : null}
        </div>
      )}

      {timer && endingMs !== null ? (
        <div className="bg-muted/30 border-border space-y-4 rounded-lg border p-4">
          <p className="text-muted-foreground text-xs">
            {formatKstTime(new Date(startedMs))} – {formatKstTime(new Date(endingMs))}
            {" · "}
            {formatDuration(endingMs - startedMs)} · 이 시각 그대로 일정이 됩니다.
          </p>

          {workCalendar ? (
            <form action={finishAction} className="space-y-4">
              {startedAtField}

              <div className="space-y-2">
                <Label htmlFor={`${uid}-title`}>제목</Label>
                <Input
                  id={`${uid}-title`}
                  name="title"
                  required
                  maxLength={MAX_EVENT_TITLE_LENGTH}
                  defaultValue={timer.title ?? ""}
                  className="max-w-96"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor={`${uid}-calendar`}>캘린더</Label>
                <p id={`${uid}-calendar`} className="text-sm">
                  {workCalendar.name}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor={`${uid}-description`}>설명</Label>
                <Textarea
                  id={`${uid}-description`}
                  name="description"
                  rows={3}
                  maxLength={MAX_EVENT_DESCRIPTION_LENGTH}
                />
              </div>

              <Button type="submit" disabled={busy}>
                {finishing ? "등록 중…" : "일정으로 등록"}
              </Button>
            </form>
          ) : (
            <p className="text-muted-foreground text-sm">
              구글 캘린더에 쓰기 권한이 있는 &lsquo;{WORK_CALENDAR_NAME}&rsquo; 캘린더가 없어 등록할
              수 없습니다. 구글 캘린더에서 만들거나 이름을 확인한 뒤 새로고침하세요. 타이머는 그대로
              남아 있습니다.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <form action={resumeAction}>
              {startedAtField}
              <Button type="submit" variant="outline" size="sm" disabled={busy}>
                {resuming ? "이어 가는 중…" : "계속하기"}
              </Button>
            </form>
            <form action={discardAction} onSubmit={confirmDiscard}>
              {startedAtField}
              <Button type="submit" variant="destructive" size="sm" disabled={busy}>
                {discarding ? "버리는 중…" : "등록하지 않고 버리기"}
              </Button>
            </form>
          </div>
          <p className="text-muted-foreground text-xs">
            계속하기를 누르면 멈춘 동안의 시간도 이어서 셉니다. 시작 시각은 그대로입니다.
          </p>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </section>
  );
}
