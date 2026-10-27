/**
 * 날짜만 다루는 값. 시각과 시간대에 흔들리지 않도록 `YYYY-MM-DD` 문자열로 고정한다.
 * DB 는 `@db.Date` 로 저장하고 경계에서만 Date 로 바꾼다.
 */
export type DateOnly = string;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const WEEKDAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

/** 형식과 실재 여부를 함께 본다. "2026-02-31" 같은 값은 통과하지 못한다. */
export function isDateOnly(value: string): value is DateOnly {
  if (!DATE_ONLY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && toDateOnly(parsed) === value;
}

export function toDateOnly(date: Date): DateOnly {
  return date.toISOString().slice(0, 10);
}

/** DB 에 넘길 때만 Date 로 바꾼다. 항상 UTC 자정이다. */
export function toDate(value: DateOnly): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** 한국 기준 오늘. 서버가 어느 시간대에 있든 같은 날짜가 나온다. */
export function todayInKorea(now: Date = new Date()): DateOnly {
  return toDateOnly(new Date(now.getTime() + KST_OFFSET_MS));
}

/**
 * 한국 기준 그 날 그 시각의 실제 순간. 자정부터 흐른 분으로 받는다 — 오전 10시는 600 이다.
 *
 * 안내문에 적어둔 시각은 한국 시각이고, 슬랙에 넘기는 것은 시간대 없는 한 순간이다.
 * 서버가 어느 시간대에 있든 같은 순간이 나와야 해서 오프셋을 직접 걷어낸다. 서머타임이
 * 없는 지역이라 오프셋이 계절에 따라 흔들리지 않는다.
 */
export function atKoreanTime(value: DateOnly, minuteOfDay: number): Date {
  return new Date(toDate(value).getTime() - KST_OFFSET_MS + minuteOfDay * 60 * 1000);
}

/** 한 순간을 한국 시각으로. "10. 12. 오전 10:00" — 예약이 언제 나가는지 읽는 자리다. */
export function formatKoreanDateTime(value: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export function addDays(value: DateOnly, days: number): DateOnly {
  return toDateOnly(new Date(toDate(value).getTime() + days * DAY_MS));
}

/** from 에서 to 까지 남은 일수. 지난 날짜면 음수다. */
export function daysBetween(from: DateOnly, to: DateOnly): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY_MS);
}

/** 0 = 일요일 */
export function weekdayOf(value: DateOnly): number {
  return toDate(value).getUTCDay();
}

export function isWeekend(value: DateOnly): boolean {
  const day = weekdayOf(value);
  return day === 0 || day === 6;
}

/** "2026-09-21" → "2026. 09. 21. (월)" */
export function formatDateOnly(value: DateOnly): string {
  const [year, month, day] = value.split("-");
  return `${year}. ${month}. ${day}. (${WEEKDAY_NAMES[weekdayOf(value)]})`;
}

/** 남은 일수를 D-day 표기로. 오늘은 D-DAY, 지난 날짜는 D+n. */
export function formatDday(days: number): string {
  if (days === 0) return "D-DAY";
  return days > 0 ? `D-${days}` : `D+${Math.abs(days)}`;
}
