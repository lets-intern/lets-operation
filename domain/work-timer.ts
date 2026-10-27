import { prisma } from "@/lib/prisma";

import { kstEventTime, timerEventId } from "./calendar-week";
import { createEvent, GoogleCalendarError } from "./google-calendar";

/**
 * 업무 타이머(plan.md §5 — 업무 수행). 시작 시각을 DB 에 두어 탭을 닫거나 기기를 바꿔도
 * 계속 흐른다. 끝내면 시작~종료 시각 그대로 구글 캘린더 일정이 되고 줄은 지워진다.
 *
 * **한 번에 하나만 돈다.** 줄의 id 가 고정이라(`running`) 두 사람이 동시에 시작해도 둘째는
 * 기본 키에서 걸린다. 팀이 함께 쓰는 화면이라 누군가 켜 둔 타이머가 모두에게 보인다.
 *
 * **화면이 본 타이머와 지금 타이머가 같은지 늘 맞춰 본다.** 종료 · 계속하기 · 등록 · 버리기는
 * 화면이 들고 있던 시작 시각을 함께 보내고, DB 의 값과 다르면 `stale` 로 물러난다. 다른 기기나
 * 다른 사람이 그 사이 버리고 새로 시작한 타이머를 엉뚱하게 끝내거나 지우지 않기 위해서다.
 */

const TIMER_ID = "running";

export type RunningTimer = { startedAt: Date; title: string | null; endingAt: Date | null };

export type TimerResult = { ok: true } | { ok: false; reason: "stale" };

export async function getRunningTimer(): Promise<RunningTimer | null> {
  return prisma.workTimer.findUnique({
    where: { id: TIMER_ID },
    select: { startedAt: true, title: true, endingAt: true },
  });
}

/** 이미 돌고 있으면 `running`. 화면이 옛 상태로 시작을 눌렀을 때다. */
export async function startTimer(
  title: string | null,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; reason: "running" }> {
  try {
    await prisma.workTimer.create({ data: { id: TIMER_ID, title, startedAt: now } });
    return { ok: true };
  } catch (error) {
    if (hasPrismaCode(error, "P2002")) return { ok: false, reason: "running" };
    throw error;
  }
}

/**
 * `종료` 를 누른 순간을 **서버 시각으로** 굳힌다. 기기 시계는 몇 분씩 틀릴 수 있고, 확인 폼을
 * 적는 동안 흐른 시간은 일정에 붙지 않아야 한다. 이미 굳혀 둔 타이머는 다시 굳히지 않는다 —
 * 두 기기에서 번갈아 눌러도 처음 누른 시각이 남는다.
 */
export async function markTimerEnding(startedAt: Date, now: Date = new Date()): Promise<TimerResult> {
  const updated = await prisma.workTimer.updateMany({
    where: { id: TIMER_ID, startedAt, endingAt: null },
    data: { endingAt: now },
  });
  return updated.count > 0 ? { ok: true } : { ok: false, reason: "stale" };
}

/** 확인 폼에서 `계속하기`. 굳혀 둔 종료 시각을 비워 다시 흐르게 한다. */
export async function resumeTimer(startedAt: Date): Promise<TimerResult> {
  const updated = await prisma.workTimer.updateMany({
    where: { id: TIMER_ID, startedAt },
    data: { endingAt: null },
  });
  return updated.count > 0 ? { ok: true } : { ok: false, reason: "stale" };
}

/** 등록하지 않고 버린다. 화면이 본 타이머가 아니면 지우지 않는다. */
export async function discardTimer(startedAt: Date): Promise<TimerResult> {
  const deleted = await prisma.workTimer.deleteMany({ where: { id: TIMER_ID, startedAt } });
  return deleted.count > 0 ? { ok: true } : { ok: false, reason: "stale" };
}

export type FinishTimerInput = {
  /** 화면이 본 타이머의 시작 시각. 지금 타이머와 다르면 물러난다. */
  startedAt: Date;
  title: string;
  description: string;
};

export type FinishTimerResult =
  | { ok: true; eventId: string; startedAt: Date; endedAt: Date }
  | { ok: false; reason: "stale" | "not-ending" };

/**
 * 타이머를 끝내고 구글 캘린더에 일정으로 남긴다. 끝은 `종료` 때 굳혀 둔 서버 시각이다.
 *
 * 일정을 먼저 만들고 타이머를 지운다. 순서가 반대면 구글이 거절했을 때 시작 시각이 사라져
 * 다시 등록할 길이 없다.
 *
 * 일정 id 를 시작 시각에서 정해 넣는다(calendar-week 의 timerEventId). 등록을 두 번 누르거나
 * 응답을 못 받고 다시 눌러도 구글이 둘째를 409 로 거절하므로, 그때는 이미 등록된 것으로 보고
 * 타이머를 지운다 — 일정이 두 벌 생기지도, 타이머가 남아 같은 시간을 또 등록하게 되지도 않는다.
 */
export async function finishTimer(input: FinishTimerInput): Promise<FinishTimerResult> {
  const timer = await getRunningTimer();
  if (!timer || timer.startedAt.getTime() !== input.startedAt.getTime()) {
    return { ok: false, reason: "stale" };
  }
  if (!timer.endingAt) return { ok: false, reason: "not-ending" };

  const eventId = timerEventId(timer.startedAt);
  try {
    await createEvent(
      {
        title: input.title,
        description: input.description,
        location: "",
        start: kstEventTime(timer.startedAt),
        end: kstEventTime(timer.endingAt),
      },
      eventId,
    );
  } catch (error) {
    if (!(error instanceof GoogleCalendarError && error.kind === "duplicate")) throw error;
  }

  await prisma.workTimer.deleteMany({ where: { id: TIMER_ID, startedAt: timer.startedAt } });

  return { ok: true, eventId, startedAt: timer.startedAt, endedAt: timer.endingAt };
}

/** P2002 = 기본 키가 겹침(이미 돌고 있는 타이머). */
function hasPrismaCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
