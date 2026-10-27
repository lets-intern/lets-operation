"use client";

import { ExternalLink } from "lucide-react";
import { type FormEvent, useActionState, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  formatKstTime,
  formValuesOf,
  MAX_EVENT_DESCRIPTION_LENGTH,
  MAX_EVENT_LOCATION_LENGTH,
  MAX_EVENT_TITLE_LENGTH,
  pickWorkCalendar,
  WORK_CALENDAR_NAME,
  type EventFormValues,
  type WeekEvent,
} from "@/domain/calendar-week";
import { addDays, formatDateOnly } from "@/domain/date";
import type { CalendarSummary } from "@/domain/google-calendar";

import {
  removeEvent,
  saveEvent,
  type ExecutionActionState,
  type ExecutionSaveState,
} from "./actions";

const INITIAL_SAVE_STATE: ExecutionSaveState = { error: null, saved: null };
const INITIAL_REMOVE_STATE: ExecutionActionState = { error: null, done: null };

/** 폼이 서는 이유. 빈 칸을 눌러 새로 적거나, 일정을 눌러 고친다. */
export type EventFormTarget =
  | { kind: "new"; values: EventFormValues }
  | { kind: "edit"; event: WeekEvent };

/**
 * 일정 한 건을 적는 폼. 등록과 수정이 같은 폼이다 — 적는 칸이 같다.
 *
 * 쓰기 권한이 없는 캘린더의 일정은 폼 대신 내용만 보여 준다. 고칠 수 없는 칸을 열어 두면
 * 적고 나서야 구글이 거절한다.
 */
export function EventForm({
  target,
  calendars,
  onDone,
}: {
  target: EventFormTarget;
  calendars: CalendarSummary[];
  onDone: () => void;
}) {
  const uid = useId();
  const [saveState, saveAction, saving] = useActionState(saveEvent, INITIAL_SAVE_STATE);
  const [removeState, removeAction, removing] = useActionState(removeEvent, INITIAL_REMOVE_STATE);

  const event = target.kind === "edit" ? target.event : null;
  const initial = target.kind === "edit" ? formValuesOf(target.event) : target.values;
  /** 종일 여부만 들고 있다. 시각 칸을 보이고 숨기는 데 쓴다 — 나머지 칸은 브라우저가 든다. */
  const [allDay, setAllDay] = useState(initial.allDay);

  const handledSave = useRef<number | null>(null);
  useEffect(() => {
    if (!saveState.saved || handledSave.current === saveState.saved.at) return;
    handledSave.current = saveState.saved.at;
    toast.success(`"${saveState.saved.title}" 일정을 ${event ? "고쳤습니다" : "등록했습니다"}.`);
    onDone();
  }, [saveState.saved, event, onDone]);

  const handledRemove = useRef<number | null>(null);
  useEffect(() => {
    if (!removeState.done || handledRemove.current === removeState.done) return;
    handledRemove.current = removeState.done;
    toast.success("일정을 삭제했습니다.");
    onDone();
  }, [removeState.done, onDone]);

  if (event && !event.writable) return <EventDetail event={event} />;

  // 새 일정은 늘 이 캘린더에 들어간다(actions 의 saveEvent). 없으면 등록할 자리가 없다.
  const workCalendar = pickWorkCalendar(calendars);
  if (!event && !workCalendar) {
    return (
      <p className="text-muted-foreground px-4 text-sm">
        구글 캘린더에 쓰기 권한이 있는 &lsquo;{WORK_CALENDAR_NAME}&rsquo; 캘린더가 없어 일정을
        등록할 수 없습니다. 구글 캘린더에서 만들거나 이름을 확인한 뒤 새로고침하세요.
      </p>
    );
  }

  const busy = saving || removing;

  function confirmRemove(submit: FormEvent<HTMLFormElement>) {
    const message = event?.recurring
      ? "이 회차만 삭제할까요? 같은 반복의 다른 날짜는 그대로 남습니다."
      : "이 일정을 삭제할까요? 구글 캘린더에서도 지워집니다.";
    if (!window.confirm(message)) submit.preventDefault();
  }

  return (
    <div className="space-y-4 px-4 pb-4">
      <form action={saveAction} className="space-y-4">
        {event ? (
          <>
            <input type="hidden" name="eventId" value={event.eventId} />
            {/* 수정할 때 캘린더는 바꾸지 않는다(actions 의 saveEvent). 고른 칸 대신 숨긴 칸으로 싣는다. */}
            <input type="hidden" name="calendarId" value={event.calendarId} />
          </>
        ) : null}

        {event?.recurring ? (
          <p className="border-border text-muted-foreground rounded-lg border border-dashed p-3 text-xs">
            반복 일정의 한 회차입니다. 여기서 고치거나 지우면 이 회차만 바뀌고 같은 반복의 다른
            날짜는 그대로입니다. 반복 전체를 바꾸려면 구글 캘린더에서 고치세요.
          </p>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor={`${uid}-calendar`}>캘린더</Label>
          {event ? (
            <p id={`${uid}-calendar`} className="text-sm">
              {event.calendarName}
              <span className="text-muted-foreground text-xs"> · 수정할 때는 바꿀 수 없습니다</span>
            </p>
          ) : (
            <p id={`${uid}-calendar`} className="text-sm">
              {workCalendar?.name}
              <span className="text-muted-foreground text-xs">
                {" "}
                · 이 화면에서 만드는 일정은 모두 여기에 들어갑니다
              </span>
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${uid}-title`}>제목</Label>
          <Input
            id={`${uid}-title`}
            name="title"
            required
            maxLength={MAX_EVENT_TITLE_LENGTH}
            defaultValue={event?.title ?? ""}
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="allDay"
            checked={allDay}
            onChange={(change) => setAllDay(change.target.checked)}
            className="accent-primary size-4"
          />
          종일
        </label>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">시작</legend>
          <div className="flex flex-wrap gap-2">
            <Input
              aria-label="시작 날짜"
              name="startDate"
              type="date"
              required
              defaultValue={initial.startDate}
              className="w-40"
            />
            <Input
              aria-label="시작 시각"
              name="startTime"
              type="time"
              required={!allDay}
              hidden={allDay}
              defaultValue={initial.startTime}
              className="w-32"
            />
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">종료</legend>
          <div className="flex flex-wrap gap-2">
            <Input
              aria-label="종료 날짜"
              name="endDate"
              type="date"
              required
              defaultValue={initial.endDate}
              className="w-40"
            />
            <Input
              aria-label="종료 시각"
              name="endTime"
              type="time"
              required={!allDay}
              hidden={allDay}
              defaultValue={initial.endTime}
              className="w-32"
            />
          </div>
          {allDay ? (
            <p className="text-muted-foreground text-xs">종일 일정은 마지막 날을 포함해서 적습니다.</p>
          ) : null}
        </fieldset>

        <div className="space-y-2">
          <Label htmlFor={`${uid}-location`}>장소</Label>
          <Input
            id={`${uid}-location`}
            name="location"
            maxLength={MAX_EVENT_LOCATION_LENGTH}
            defaultValue={event?.location ?? ""}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${uid}-description`}>설명</Label>
          <Textarea
            id={`${uid}-description`}
            name="description"
            rows={5}
            maxLength={MAX_EVENT_DESCRIPTION_LENGTH}
            defaultValue={event?.description ?? ""}
          />
        </div>

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={busy}>
            {saving ? "저장 중…" : event ? "저장" : "등록하기"}
          </Button>
          {event?.htmlLink ? (
            <Button asChild variant="ghost">
              <a href={event.htmlLink} target="_blank" rel="noreferrer">
                구글 캘린더에서 열기
                <ExternalLink aria-hidden />
              </a>
            </Button>
          ) : null}
        </div>

        {saveState.error ? (
          <p role="alert" className="text-destructive text-sm">
            {saveState.error}
          </p>
        ) : null}
      </form>

      {event ? (
        <form action={removeAction} onSubmit={confirmRemove} className="border-border border-t pt-4">
          <input type="hidden" name="calendarId" value={event.calendarId} />
          <input type="hidden" name="eventId" value={event.eventId} />
          <Button type="submit" variant="destructive" size="sm" disabled={busy}>
            {removing ? "삭제 중…" : event.recurring ? "이 회차 삭제" : "삭제"}
          </Button>
          {removeState.error ? (
            <p role="alert" className="text-destructive mt-2 text-sm">
              {removeState.error}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

/** 읽기 전용 일정. 다른 사람이 공유해 준 캘린더처럼 쓰기 권한이 없는 경우다. */
function EventDetail({ event }: { event: WeekEvent }) {
  const when = event.allDay
    ? event.end === addDays(event.start, 1)
      ? `${formatDateOnly(event.start)} 종일`
      : `${formatDateOnly(event.start)} – ${formatDateOnly(addDays(event.end, -1))} 종일`
    : `${formatDateOnly(formValuesOf(event).startDate)} ${formatKstTime(new Date(event.start))} – ${formatKstTime(new Date(event.end))}`;

  return (
    <div className="space-y-3 px-4 pb-4 text-sm">
      <p className="text-muted-foreground text-xs">
        {event.calendarName} · 쓰기 권한이 없는 캘린더라 여기서 고칠 수 없습니다.
      </p>
      <p className="text-base font-medium">{event.title || "(제목 없음)"}</p>
      <p>{when}</p>
      {event.location ? <p className="text-muted-foreground">{event.location}</p> : null}
      {event.description ? (
        <p className="text-muted-foreground whitespace-pre-wrap break-words">{event.description}</p>
      ) : null}
      {event.htmlLink ? (
        <Button asChild variant="outline" size="sm">
          <a href={event.htmlLink} target="_blank" rel="noreferrer">
            구글 캘린더에서 열기
            <ExternalLink aria-hidden />
          </a>
        </Button>
      ) : null}
    </div>
  );
}
