import { addDays, isWeekend, type DateOnly } from "./date";
import { isHoliday } from "./holidays";
import {
  PROGRAM_VERSIONS,
  PROGRAM_VERSION_LABELS,
  type ProgramVersion,
} from "./program-setting";

/**
 * 프로그램 개설 규칙. 데이터베이스를 모르는 순수 로직이라 화면에서도 그대로 쓴다.
 */

/** 상세페이지는 시작 최소 2주 전에 연다(plan.md §5). 고정 기본값이고 건별로 고칠 수 있다. */
export const DETAIL_OPEN_LEAD_DAYS = 14;

/** 개설과 함께 자동으로 만들어지는 마일스톤. 업무 캘린더에는 이 태스크로 나타난다. */
export const DETAIL_OPEN_TASK_TITLE = "상세페이지 오픈";

/**
 * 버전마다 상세페이지가 따로 열리므로 오픈 태스크도 갈래마다 하나씩 둔다(plan.md §5).
 * 나뉘지 않는 챌린지는 갈래 표기 없이 예전 이름 그대로다 — 뜻 없는 괄호를 붙이지 않는다.
 */
export function detailOpenTaskTitle(version: ProgramVersion): string {
  if (version === "COMMON") return DETAIL_OPEN_TASK_TITLE;
  return `${DETAIL_OPEN_TASK_TITLE} (${PROGRAM_VERSION_LABELS[version]})`;
}

/** 태스크 이름에서 갈래를 되읽는다. 우리가 지은 이름 셋과 정확히 맞춰보므로 어긋날 일이 없다. */
const VERSION_BY_TASK_TITLE = new Map<string, ProgramVersion>(
  PROGRAM_VERSIONS.map((version) => [detailOpenTaskTitle(version), version]),
);

export function detailOpenTaskVersion(title: string): ProgramVersion | null {
  return VERSION_BY_TASK_TITLE.get(title) ?? null;
}

/** 기수의 상한. 수정 폼과 마케팅 기획 제목 해석이 같은 값을 쓴다. */
export const MAX_COHORT = 9999;

export type TaskStatus = "TODO" | "DOING" | "DONE";

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: "할 일",
  DOING: "진행 중",
  DONE: "완료",
};

export const TASK_STATUSES: TaskStatus[] = ["TODO", "DOING", "DONE"];

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as string[]).includes(value);
}

/**
 * 오픈 목표일 = 시작일 14일 전. 그날이 주말·공휴일이면 직전 평일로 당긴다.
 * 목표일이 항상 근무일에 떨어져 "오늘까지"가 분명해진다.
 */
export function detailOpenTargetFor(startDate: DateOnly): DateOnly {
  let target = addDays(startDate, -DETAIL_OPEN_LEAD_DAYS);

  // 연휴가 길어도 반드시 끝나도록 상한을 둔다.
  for (let i = 0; i < 30 && (isWeekend(target) || isHoliday(target)); i += 1) {
    target = addDays(target, -1);
  }

  return target;
}

/**
 * 목표일을 누가 정했는지. 화면의 표시가 갈린다.
 *
 * 마케팅 마감일과 같으면 저쪽이 정한 것이고, 계산값과 같으면 우리 규칙이 채운 것이다.
 * 둘 다 아니면 사람이 우리 화면에서 고친 값이다. 이 셋만 구분하면 되므로 별도 컬럼을 두지 않는다.
 */
export type TargetOrigin = "MKT" | "COMPUTED" | "MANUAL";

export function detailOpenTargetOrigin(
  startDate: DateOnly,
  detailOpenTargetDate: DateOnly,
  mktOpenDeadline: DateOnly | null,
): TargetOrigin {
  if (mktOpenDeadline !== null && detailOpenTargetDate === mktOpenDeadline) {
    return "MKT";
  }
  if (detailOpenTargetDate === detailOpenTargetFor(startDate)) return "COMPUTED";
  return "MANUAL";
}

/**
 * 목표일이 근무일이 아니면 그 이유. 근무일이면 비어 있다.
 *
 * 우리 계산은 목표일을 늘 평일에 떨어뜨리지만(detailOpenTargetFor), 마케팅 마감일은
 * 그 규칙을 거치지 않고 그대로 들어온다. 날짜를 우리 마음대로 당기지 않는 대신
 * 목록에서 눈에 띄게 해 사람이 판단하게 한다(plan.md §5).
 */
export function offDayLabel(value: DateOnly): "공휴일" | "주말" | null {
  if (isHoliday(value)) return "공휴일";
  if (isWeekend(value)) return "주말";
  return null;
}

/**
 * 사람이 목표일을 직접 고쳤는지. 계산값과 같으면 시작일을 바꿀 때 함께 움직이고,
 * 다르면 그대로 둔다. 수정 폼이 `기본값` 되돌리기를 보일지 정하는 데 쓴다.
 */
export function isCustomDetailOpenTarget(
  startDate: DateOnly,
  detailOpenTargetDate: DateOnly,
): boolean {
  return detailOpenTargetDate !== detailOpenTargetFor(startDate);
}

/** "포트폴리오 챌린지" + 30 → "포트폴리오 챌린지 30기" */
export function programTitle(challengeName: string, cohort: number): string {
  return `${challengeName} ${cohort}기`;
}

/**
 * programTitle 의 반대. 마케팅팀은 프로그램을 "포트폴리오 완성 챌린지 41기" 한 줄로 적어 두므로
 * 우리 구조인 `챌린지 이름 + 기수` 로 되돌려야 개설할 수 있다.
 *
 * 앞뒤의 군더더기를 떼고 남는 것이 챌린지 이름이다.
 *
 * - 앞: "[대학생·무경력 Ver.]" 같은 버전 표기. 버전은 기수를 나누지 않으므로(plan.md §5)
 *   떼어낸다. 두 버전 줄은 같은 이름·같은 기수로 풀려 한 기수로 모인다.
 * - 뒤: "41기". 이름에 숫자가 섞여도 마지막 기수만 잡힌다.
 *
 * 이 모양이 아니면 null 이고, 그 줄은 사람이 판단하도록 미개설로 남는다.
 */
const VERSION_PREFIX = /^\s*[[(]([^\])]*)[\])]\s*/;
const PROGRAM_TITLE = /^(.+?)\s*(\d+)\s*기$/;

export type ParsedProgramTitle = {
  challengeName: string;
  cohort: number;
  version: ProgramVersion;
};

/**
 * 제목 앞 접두어를 뗀 나머지. 이름을 대조할 때 제휴사·전용 표기가 끼어들지 않게 한다 —
 * `[부산시 AI 브랜드 마케팅] 서류 완성 챌린지` 를 통째로 보면 접두어 안의 "마케팅" 이
 * 우리 마케팅 챌린지인 것처럼 걸린다.
 */
export function programTitleBody(title: string): string {
  const prefix = VERSION_PREFIX.exec(title);
  return (prefix ? title.slice(prefix[0].length) : title).trim();
}

export function parseProgramTitle(title: string): ParsedProgramTitle | null {
  const matched = PROGRAM_TITLE.exec(programTitleBody(title));
  if (!matched) return null;

  const cohort = Number(matched[2]);
  if (!Number.isInteger(cohort) || cohort < 1 || cohort > MAX_COHORT) return null;

  const challengeName = matched[1].trim();
  if (challengeName.length === 0) return null;

  return { challengeName, cohort, version: programVersionOfTitle(title) };
}

/**
 * 제목 앞 접두어만 보고 갈래를 읽는다. 기수가 붙지 않은 제목에도 쓸 수 있어야 해서
 * parseProgramTitle 과 따로 둔다 — 실서비스 목록에는 "[렛츠커리어] 마케팅 올인원 패스"
 * 처럼 기수 없는 줄이 섞여 있다.
 */
export function programVersionOfTitle(title: string): ProgramVersion {
  return versionOfPrefix(VERSION_PREFIX.exec(title)?.[1]);
}

/**
 * 접두어에서 갈래를 읽는다. 마케팅팀은 "대학생·무경력 Ver." / "인턴·실무 경험자 Ver." 로 적는데,
 * 표기가 조금씩 흔들려도 걸리도록 핵심 낱말만 본다.
 *
 * 갈래로 읽히지 않는 접두어(예: "[재오픈]")는 갈래가 없는 것으로 본다. 모르는 표기를
 * 억지로 한쪽에 넣으면 엉뚱한 버전의 상세페이지 태스크가 생긴다.
 */
function versionOfPrefix(prefix: string | undefined): ProgramVersion {
  if (!prefix) return "COMMON";
  if (prefix.includes("무경력")) return "ENTRY";
  if (prefix.includes("경험자") || prefix.includes("경력")) return "EXPERIENCED";
  // 실서비스 옛 표기가 "[1~3년차 주니어 Ver]" 였다. 지금은 "경험자" 로 적지만,
  // 지난 기수를 되짚을 때 갈래가 통째로 COMMON 으로 뭉개지지 않도록 함께 본다.
  if (prefix.includes("주니어")) return "EXPERIENCED";
  return "COMMON";
}
