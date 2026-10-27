/**
 * 멘토 신청서의 진행 상태와 입력 검사(plan.md §5 — 멘토 관리). DB 를 타지 않아 화면에서도 읽는다.
 */

/** DB check 제약과 같은 순서 · 같은 값이다. 하나를 더하려면 lets-mentor 의 SQL 부터 고친다. */
export const MENTOR_APPLICATION_STATUSES = [
  { key: "received", label: "접수 완료" },
  { key: "reviewing", label: "검토중" },
  { key: "replied", label: "회신완료" },
] as const;

export type MentorApplicationStatus = (typeof MENTOR_APPLICATION_STATUSES)[number]["key"];

export const MENTOR_APPLICATION_STATUS_LABELS = Object.fromEntries(
  MENTOR_APPLICATION_STATUSES.map((entry) => [entry.key, entry.label]),
) as Record<MentorApplicationStatus, string>;

export function isMentorApplicationStatus(value: unknown): value is MentorApplicationStatus {
  return MENTOR_APPLICATION_STATUSES.some((entry) => entry.key === value);
}

/** 운영 메모 길이 한도. 칸 자체는 제한이 없지만 붙여 넣기 실수로 화면이 무거워지지 않게 막는다. */
export const MENTOR_MEMO_MAX_LENGTH = 5_000;

/** uuid 모양이 아니면 DB 가 형식 오류 문구를 그대로 내보내므로 미리 거른다. */
export function isMentorApplicationId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
