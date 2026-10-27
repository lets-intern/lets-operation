import type { DateOnly } from "./date";

/**
 * 공휴일 목록. 오픈 목표일을 직전 평일로 당기는 규칙의 근거가 된다.
 *
 * 자동 수집원을 두지 않고 **연 1회 손으로 갱신**한다(plan.md §8).
 * 음력 기준 공휴일(설날·추석·부처님오신날)과 대체공휴일은 해마다 날짜가 달라지므로
 * 추측해서 넣지 않고, 확정된 날짜만 DATED_HOLIDAYS 에 적는다.
 */

/** 매년 같은 날짜인 공휴일. `MM-DD` */
const FIXED_HOLIDAYS = new Set([
  "01-01", // 신정
  "03-01", // 삼일절
  "05-05", // 어린이날
  "06-06", // 현충일
  "08-15", // 광복절
  "10-03", // 개천절
  "10-09", // 한글날
  "12-25", // 성탄절
]);

/** 해마다 달라지는 공휴일. `YYYY-MM-DD` 로 확정된 값만 적는다. */
const DATED_HOLIDAYS = new Set<DateOnly>([
  // 예) "2027-02-06", // 설날 연휴
]);

export function isHoliday(value: DateOnly): boolean {
  return FIXED_HOLIDAYS.has(value.slice(5)) || DATED_HOLIDAYS.has(value);
}
