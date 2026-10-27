import { addDays, weekdayOf, type DateOnly } from "./date";

/**
 * 달력 격자를 세우는 공통 규칙. 업무 캘린더와 프로그램 운영 캘린더가 같은 격자를 쓴다.
 *
 * 두 화면이 서로 다른 주 시작 요일이나 주 수를 쓰면 같은 달이 다르게 보인다. 한 달을
 * 어디서 끊는지는 화면마다 정할 일이 아니라 하나로 정해두고 따르는 일이다.
 */

/** 화면이 보고 있는 달. month 는 1~12 로, 사람이 읽는 그대로 둔다. */
export type CalendarMonth = { year: number; month: number };

export const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

export function monthOf(value: DateOnly): CalendarMonth {
  const [year, month] = value.split("-");
  return { year: Number(year), month: Number(month) };
}

/** 월을 넘길 때 연도까지 알아서 넘어간다. Date 의 월 넘침 계산에 맡긴다. */
export function shiftMonth(month: CalendarMonth, delta: number): CalendarMonth {
  const moved = new Date(Date.UTC(month.year, month.month - 1 + delta, 1));
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1 };
}

export function isSameMonth(a: CalendarMonth, b: CalendarMonth): boolean {
  return a.year === b.year && a.month === b.month;
}

export function formatMonth(month: CalendarMonth): string {
  return `${month.year}년 ${month.month}월`;
}

export function firstDateOf(month: CalendarMonth): DateOnly {
  return `${month.year}-${String(month.month).padStart(2, "0")}-01`;
}

export function daysInMonth(month: CalendarMonth): number {
  return new Date(Date.UTC(month.year, month.month, 0)).getUTCDate();
}

/** 격자 첫 칸의 날짜. 일요일 시작이라 그 달 1일 앞의 며칠이 딸려 온다. */
export function gridStartOf(month: CalendarMonth): DateOnly {
  const first = firstDateOf(month);
  return addDays(first, -weekdayOf(first));
}

/**
 * 그 달을 덮는 데 필요한 주 수. 달마다 4~6주로 높이가 달라지지만, 빈 주를 넣어
 * 늘리지는 않는다.
 */
export function weekCountOf(month: CalendarMonth): number {
  return Math.ceil((weekdayOf(firstDateOf(month)) + daysInMonth(month)) / 7);
}
