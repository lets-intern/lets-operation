"use server";

import { revalidatePath } from "next/cache";

import {
  isValidEventId,
  parseEventFields,
  parseTimerFinishFields,
  parseTimerTitle,
} from "@/domain/calendar-week";
import {
  createEvent,
  deleteEvent,
  disconnectGoogleCalendar,
  GoogleCalendarError,
  updateEvent,
} from "@/domain/google-calendar";
import {
  discardTimer,
  finishTimer,
  markTimerEnding,
  resumeTimer,
  startTimer,
} from "@/domain/work-timer";

/**
 * 접근 차단은 proxy.ts 가 모든 경로에서 처리한다. 서버 액션도 페이지 경로로 POST 되므로
 * 같은 검사를 거친다(plan.md §7 — 계정 분리 없음 + 접근 차단 있음).
 */

/** 일정 저장 · 타이머 등록처럼 성공도 알려야 하는 결과. 성공했을 때만 saved 가 채워진다. */
export type ExecutionSaveState = {
  error: string | null;
  saved: { title: string; at: number } | null;
};

/** 삭제 · 버리기 · 연결 해제처럼 성공하면 화면이 바뀌어 따로 알릴 것이 적은 결과. */
export type ExecutionActionState = { error: string | null; done: number | null };

const PATH = "/calendar/execution";

/**
 * 일정 등록과 수정. 같은 폼이다 — 적는 칸이 같다.
 *
 * 새 일정은 늘 '렛츠커리어' 캘린더에 들어간다(domain/google-calendar 의 createEvent). 폼은
 * 캘린더를 싣지 않는다. 수정할 때는 그 일정이 있던 캘린더를 그대로 둔다 — 구글에서 캘린더를
 * 옮기는 것은 별도 호출(move)이고 반복 일정의 한 회차는 옮길 수도 없다.
 */
export async function saveEvent(
  _prevState: ExecutionSaveState,
  formData: FormData,
): Promise<ExecutionSaveState> {

  const parsed = parseEventFields({
    title: String(formData.get("title") ?? ""),
    allDay: formData.get("allDay") === "on",
    startDate: String(formData.get("startDate") ?? ""),
    startTime: String(formData.get("startTime") ?? ""),
    endDate: String(formData.get("endDate") ?? ""),
    endTime: String(formData.get("endTime") ?? ""),
    description: String(formData.get("description") ?? ""),
    location: String(formData.get("location") ?? ""),
  });
  if (!parsed.ok) return { error: parsed.message, saved: null };

  // 빈 문자열은 "새로 만든다" 는 뜻이다. 수정할 때만 일정과 그 캘린더가 실려 온다.
  // 캘린더가 쓰기 가능한 것인지는 domain 이 구글에 다시 물어 확인한다(google-calendar 의 requireWritableCalendar).
  const eventId = String(formData.get("eventId") ?? "");
  const calendarId = String(formData.get("calendarId") ?? "");
  if (eventId && (!isValidEventId(eventId) || !calendarId)) {
    return { error: "일정 id 가 올바르지 않습니다. 새로고침 후 다시 시도하세요.", saved: null };
  }

  try {
    if (eventId) await updateEvent(calendarId, eventId, parsed.value);
    else await createEvent(parsed.value);

    revalidatePath(PATH);
    return { error: null, saved: { title: parsed.value.title, at: Date.now() } };
  } catch (error) {
    return { error: readableError(error, "일정을 저장하지 못했습니다."), saved: null };
  }
}

export async function removeEvent(
  _prevState: ExecutionActionState,
  formData: FormData,
): Promise<ExecutionActionState> {
  const calendarId = String(formData.get("calendarId") ?? "");
  const eventId = String(formData.get("eventId") ?? "");
  if (!calendarId || !isValidEventId(eventId)) {
    return { error: "삭제할 일정을 찾지 못했습니다.", done: null };
  }

  try {
    await deleteEvent(calendarId, eventId);
    revalidatePath(PATH);
    return { error: null, done: Date.now() };
  } catch (error) {
    return { error: readableError(error, "일정을 삭제하지 못했습니다."), done: null };
  }
}

/** 구글 연결을 끊는다. 다시 연결하기 전까지 팀원 모두의 화면에서 일정이 사라진다. */
export async function disconnectGoogle(): Promise<ExecutionActionState> {
  try {
    await disconnectGoogleCalendar();
    revalidatePath(PATH);
    return { error: null, done: Date.now() };
  } catch (error) {
    console.error("구글 연결 해제 실패", error);
    return { error: "연결을 해제하지 못했습니다. 잠시 후 다시 시도해 주세요.", done: null };
  }
}

export async function startWorkTimer(
  _prevState: ExecutionActionState,
  formData: FormData,
): Promise<ExecutionActionState> {
  const title = parseTimerTitle(String(formData.get("title") ?? ""));
  if (!title.ok) return { error: title.message, done: null };

  try {
    const result = await startTimer(title.value);
    revalidatePath(PATH);
    if (!result.ok) {
      return { error: "이미 돌고 있는 타이머가 있습니다. 화면을 새로 고쳤습니다.", done: null };
    }
    return { error: null, done: Date.now() };
  } catch (error) {
    console.error("타이머 시작 실패", error);
    return { error: "타이머를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.", done: null };
  }
}

/** 화면이 본 타이머의 시작 시각. 숨긴 칸으로 실려 온다. 꼴이 틀리면 null. */
function timerStartedAt(formData: FormData): Date | null {
  const parsed = new Date(String(formData.get("startedAt") ?? ""));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const STALE_TIMER_MESSAGE =
  "다른 곳에서 타이머가 바뀌었습니다. 화면을 새로 고쳤으니 지금 타이머를 확인하세요.";

/** `종료`. 서버 시각으로 끝을 굳히고 확인 폼을 띄운다(domain/work-timer 의 markTimerEnding). */
export async function endWorkTimer(
  _prevState: ExecutionActionState,
  formData: FormData,
): Promise<ExecutionActionState> {
  return timerStep(formData, markTimerEnding, "타이머를 멈추지 못했습니다.");
}

/** 확인 폼의 `계속하기`. 굳혀 둔 끝을 비워 다시 흐르게 한다. */
export async function resumeWorkTimer(
  _prevState: ExecutionActionState,
  formData: FormData,
): Promise<ExecutionActionState> {
  return timerStep(formData, resumeTimer, "타이머를 이어 가지 못했습니다.");
}

export async function discardWorkTimer(
  _prevState: ExecutionActionState,
  formData: FormData,
): Promise<ExecutionActionState> {
  return timerStep(formData, (startedAt) => discardTimer(startedAt), "타이머를 버리지 못했습니다.");
}

/** 종료 · 계속하기 · 버리기는 모양이 같다. 화면이 본 타이머가 아니면 물러나고 화면을 다시 그린다. */
async function timerStep(
  formData: FormData,
  step: (startedAt: Date) => Promise<{ ok: true } | { ok: false; reason: "stale" }>,
  failure: string,
): Promise<ExecutionActionState> {
  const startedAt = timerStartedAt(formData);
  if (!startedAt) {
    revalidatePath(PATH);
    return { error: STALE_TIMER_MESSAGE, done: null };
  }

  try {
    const result = await step(startedAt);
    revalidatePath(PATH);
    if (!result.ok) return { error: STALE_TIMER_MESSAGE, done: null };
    return { error: null, done: Date.now() };
  } catch (error) {
    console.error(failure, error);
    return { error: `${failure} 잠시 후 다시 시도해 주세요.`, done: null };
  }
}

/** 타이머를 끝내고 시작~`종료` 시각 그대로 구글 캘린더 일정으로 남긴다. */
export async function finishWorkTimer(
  _prevState: ExecutionSaveState,
  formData: FormData,
): Promise<ExecutionSaveState> {
  const startedAt = timerStartedAt(formData);
  if (!startedAt) {
    revalidatePath(PATH);
    return { error: STALE_TIMER_MESSAGE, saved: null };
  }

  const parsed = parseTimerFinishFields({
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
  });
  if (!parsed.ok) return { error: parsed.message, saved: null };

  try {
    const result = await finishTimer({ ...parsed.value, startedAt });
    revalidatePath(PATH);
    if (!result.ok) {
      return {
        error:
          result.reason === "stale"
            ? STALE_TIMER_MESSAGE
            : "타이머가 멈춘 상태가 아닙니다. 화면을 새로 고쳤으니 다시 종료하세요.",
        saved: null,
      };
    }
    return { error: null, saved: { title: parsed.value.title, at: Date.now() } };
  } catch (error) {
    // 일정이 만들어지지 않았으면 타이머는 그대로 남는다(domain/work-timer). 다시 등록하면 된다.
    return {
      error: readableError(error, "일정으로 등록하지 못했습니다. 타이머는 그대로 남아 있습니다."),
      saved: null,
    };
  }
}

/**
 * 구글 쪽 실패는 domain 이 이미 사람이 읽을 말로 바꿔 두었다. 연결이 끊긴 것이면 화면을
 * 다시 그려 `다시 연결` 카드가 서게 한다.
 */
function readableError(error: unknown, fallback: string): string {
  if (error instanceof GoogleCalendarError) {
    if (error.kind === "disconnected") revalidatePath(PATH);
    return error.message;
  }
  console.error(fallback, error);
  return `${fallback} 잠시 후 다시 시도해 주세요.`;
}
