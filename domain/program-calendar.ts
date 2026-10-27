import {
  firstDateOf,
  gridStartOf,
  weekCountOf,
  type CalendarMonth,
} from "./calendar-month";
import { addDays, daysBetween, type DateOnly } from "./date";
import { isHoliday } from "./holidays";
import {
  curriculumNoteText,
  type MissionFeedback,
  type MissionPlan,
  type ProgramCurriculumNote,
  type ProgramVersion,
} from "./program-setting";

/**
 * 프로그램 운영 캘린더의 표시 규칙. 데이터베이스를 모르는 순수 로직이라 화면에서도 그대로 쓴다.
 *
 * 업무 캘린더가 **하루에 떨어지는 일**을 놓는 곳이라면 여기는 **몇 주간 이어지는 기간**을
 * 놓는 곳이다. 같은 격자를 쓰지만 한 칸에 칩을 쌓는 대신 여러 칸에 걸친 막대를 눕힌다 —
 * 프로그램은 시작한 날 하루의 일이 아니라 그 사이 내내 도는 것이기 때문이다.
 *
 * 다만 운영에 앞서 **개설**이 있다. 상세페이지를 여는 날은 기간이 아니라 하루라, 막대가
 * 아니라 그 기수의 막대와 **같은 줄에 찍히는 표식**으로 놓는다. 한 줄이 곧 한 기수여서
 * 언제 열어 언제 시작하는지가 왼쪽에서 오른쪽으로 이어져 읽힌다.
 */

/**
 * 네 상태. 운영 막대는 이 넷 중 하나로 채워진다.
 *
 * **시작 전이 둘로 갈린다.** 상세페이지를 아직 안 연 기수(`UPCOMING`)와 이미 열어두고
 * 시작을 기다리는 기수(`READY`)는 할 일이 정반대다 — 앞의 것은 열어야 하고 뒤의 것은
 * 열 일이 없다. 한 칸에 담으면 이미 연 기수가 매일 "열어야 할 것" 목록에 서고, 범례의
 * 숫자도 실제로 열어야 하는 수를 말하지 못한다.
 */
export type ProgramPhase = "RUNNING" | "READY" | "UPCOMING" | "ENDED";

/** 범례와 목록이 쓰는 차례. 가까운 것이 먼저고, 끝난 것이 뒤다. */
export const PROGRAM_PHASES: ProgramPhase[] = [
  "RUNNING",
  "READY",
  "UPCOMING",
  "ENDED",
];

export const PROGRAM_PHASE_LABELS: Record<ProgramPhase, string> = {
  RUNNING: "운영 중",
  READY: "운영 예정",
  UPCOMING: "개설 예정",
  ENDED: "운영 종료",
};

/**
 * 범례가 가르는 갈래. 앞 셋은 운영 막대의 상태이고 `LAUNCH` 는 그 줄에 함께 찍히는
 * 개설 표식이다.
 *
 * 상태가 아니라 **표기의 갈래**인 이유는 한 기수가 둘 다 갖기 때문이다 — 오픈 목표일이
 * 남은 기수도 언젠가는 운영 중이 되고, 그때도 그 기수의 개설 목표일은 달력에 남는다.
 */
export type ProgramMark = ProgramPhase | "LAUNCH" | "MISSION" | "FEEDBACK";

/**
 * 개설이 운영보다 앞서지만 범례는 상태를 먼저 읽는 자리라 뒤에 붙인다.
 * 미션과 피드백은 막대 안을 들여다보는 것이라 그 뒤에 온다.
 */
export const PROGRAM_MARKS: ProgramMark[] = [
  ...PROGRAM_PHASES,
  "LAUNCH",
  "MISSION",
  "FEEDBACK",
];

export const PROGRAM_MARK_LABELS: Record<ProgramMark, string> = {
  ...PROGRAM_PHASE_LABELS,
  LAUNCH: "개설",
  MISSION: "미션",
  FEEDBACK: "피드백",
};

/**
 * 캘린더에 눕히는 프로그램 하나. 개설에서 세운 기수와 실서비스에서 되짚어 온 기수가
 * 같은 모양으로 여기 온다.
 *
 * 종료일은 되짚은 기수라야 확실하다 — 저쪽이 적어둔 날이 그대로 온다. 개설로 세운 기수는
 * 마케팅 기획의 종료일을 빌려 오는데(우리 개설 화면에 적는 자리가 없다, plan.md §9 — 보류)
 * 손으로 만든 기수나 저쪽이 안 채운 줄은 비어 있고, 그런 기수는 언제 끝나는지 모른다.
 *
 * 오픈 목표일은 반대로 늘 있다 — 개설에서 반드시 정하고 시작하는 값이라 비지 않는다.
 */
export type ProgramPeriod = {
  programId: string;
  /** 어느 챌린지의 기수인지. 실서비스 구분은 챌린지에 이어져 있어 인원을 맞출 때 쓴다. */
  challengeId: string;
  challengeName: string;
  cohort: number;
  startDate: DateOnly;
  endDate: DateOnly | null;
  /**
   * 상세페이지 오픈 목표일. 개설 표식이 찍히는 하루다.
   * 되짚은 기수에서는 목표일이 아니라 실제로 열린 날이 이 자리에 온다.
   */
  detailOpenTargetDate: DateOnly;
  /**
   * 기수 이름 뒤에 붙는 커리큘럼 표기. 개설 목록과 같은 규칙이라(programCurriculumNote)
   * 어느 기수가 비었는지가 두 화면에서 같게 읽힌다.
   */
  curriculum: ProgramCurriculumNote;
  /**
   * 이 기수가 따르는 미션 구성. 프로그램 설정에 적어둔 것이 그대로 온다.
   * 아직 안 적은 챌린지는 비어 있고, 그런 기수는 막대만 눕고 미션은 그리지 않는다.
   *
   * 설정은 **지금의** 운영 방식이라, 이미 끝난 기수에 그대로 얹어도 되는 값은 아니다.
   * 어디까지 그릴지는 missionPiecesOf 가 정한다.
   */
  missionPlans: ProgramMissionPlan[];
  /**
   * 실서비스 목록에서 되짚어 온 기수인지. 우리가 개설해 세운 기수와 날짜의 출처가 달라
   * 마우스를 올렸을 때 어디서 온 값인지 밝힌다.
   */
  fromService: boolean;
  /**
   * 상세페이지가 실제로 열린 것으로 확인된 기수인지. 시작 전 기수를 `개설 예정` 과
   * `운영 예정` 으로 가르는 값이다(domain/program 의 isLaunched 가 정한다).
   */
  launched: boolean;
};

/**
 * 미션 구성 한 벌. 설정은 챌린지에 붙고 갈래마다 한 벌씩인데(plan.md §5), 기수는 버전을
 * 갖지 않으므로 한 기수가 여러 벌을 함께 따른다.
 *
 * 갈래가 나뉘어도 미션이 같으면 한 벌로 합쳐 온다. 같은 날짜를 두 줄로 그리면 줄만 먹고
 * 읽을 것은 늘지 않는다. 구성이 실제로 다를 때만 벌이 나뉘고, 그때는 어느 갈래의 미션인지
 * 칩에 붙는다.
 */
export type ProgramMissionPlan = {
  versions: ProgramVersion[];
  missions: MissionPlan[];
};

/**
 * "포트폴리오 챌린지 30기 · 2주". 기수는 버전을 갖지 않으므로 갈래는 붙지 않는다(plan.md §5).
 *
 * 커리큘럼은 기수가 고르는 것이라 붙는다. 채워야 할 기수는 `· 커리큘럼 미지정` ·
 * `· 2주 설정 없음` 이 붙어 막대 · 칩 · 툴팁 어디서든 같은 말로 드러난다. 좁은 막대에서는
 * 뒤가 잘리지만 툴팁에는 전부 나온다.
 */
export function programTitle(period: ProgramPeriod): string {
  const note = curriculumNoteText(period.curriculum);
  const base = `${period.challengeName} ${period.cohort}기`;

  return note === null ? base : `${base} · ${note}`;
}

/**
 * 오늘을 기준으로 어느 쪽인지.
 *
 * 종료일을 모르면 끝났다고 말할 수 없다. 시작일이 지난 기수는 **운영 중**으로 둔다 —
 * 끝난 것을 아직 돈다고 말하는 쪽이, 도는 것을 끝났다고 말해 화면에서 물려버리는 쪽보다 낫다.
 *
 * 시작 전은 상세페이지를 열었는지로 갈린다. 날짜만으로는 갈리지 않는 자리라 기수가 들고
 * 온 `launched` 를 그대로 따른다.
 */
export function phaseOf(period: ProgramPeriod, today: DateOnly): ProgramPhase {
  if (today < period.startDate) return period.launched ? "READY" : "UPCOMING";
  if (period.endDate !== null && today > period.endDate) return "ENDED";
  return "RUNNING";
}

/** 시작이 이른 순. 같은 날 시작이면 오래 도는 것이 위로 간다. */
export function comparePeriods(a: ProgramPeriod, b: ProgramPeriod): number {
  if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1;

  // 종료일을 모르는 기수는 끝을 알 수 없으니 가장 오래 도는 것으로 놓는다.
  const aEnd = a.endDate ?? OPEN_ENDED;
  const bEnd = b.endDate ?? OPEN_ENDED;
  if (aEnd !== bEnd) return aEnd > bEnd ? -1 : 1;

  return programTitle(a).localeCompare(programTitle(b));
}

/** 정렬에서만 쓰는 "끝을 모른다"의 자리값. 격자에는 이 날짜가 그려지지 않는다. */
const OPEN_ENDED = "9999-12-31";

// ── 격자 ────────────────────────────────────────────────────────────────────

/**
 * 한 주에 눕힐 수 있는 줄 수. 넘치면 `+N건`으로 접는다.
 * 칸 높이가 주마다 들쭉날쭉해지지 않도록 한도를 둔다.
 *
 * 넷에서 여섯, 여덟을 거쳐 열로 올렸다. 개설 표식이 같은 날 대여섯씩 몰리는 데다(오픈
 * 목표일이 시작일 2주 전 평일로 정해지니 자연히 같은 날에 모인다) 미션이 들어오면서 한
 * 기수가 두세 줄을 붙여 쓰게 됐다. 2026년 10월이 아홉 줄이라 그보다 낮추면 도는 기수의
 * 미션이 접혀 사라진다.
 *
 * 한도를 더 올리지는 않는다. 2026년 9월은 열일곱 줄이 필요해 한도로 덮으려 들면 달력이
 * 세로로 두 배가 되는데, 그 높이를 **늘 치르는 쪽**보다 몰리는 달에만 펼치는 쪽이 낫다.
 * 그래서 접힌 것은 세지 않고 **이름을 들고 남아**(ProgramWeek.hidden) 화면에서 펼쳐진다.
 */
export const MAX_LANES = 10;

/** 달력 한 칸. 막대가 그 위를 지나가므로 칸 자체는 날짜만 안다. */
export type ProgramDay = {
  date: DateOnly;
  /** 보고 있는 달의 날인지. 앞뒤 달에서 끌어온 날은 흐리게 둔다. */
  inMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
  isHoliday: boolean;
};

/** 격자 위 한 조각이 공통으로 갖는 자리. 어느 줄 어느 칸에 놓이는지는 갈래와 무관하다. */
type PlacedSegment = {
  key: string;
  period: ProgramPeriod;
  /** 몇 번째 줄에 눕는지. 0부터. */
  lane: number;
  /** 이 주에서 조각이 걸치는 칸. 0 = 일요일 */
  startCol: number;
  endCol: number;
};

/** 한 주에 걸친 운영 막대 한 토막. 여러 주에 걸친 프로그램은 주마다 한 토막씩 생긴다. */
export type ProgramBarSegment = PlacedSegment & {
  kind: "PERIOD";
  phase: ProgramPhase;
  /**
   * 이 주에서 막대가 덮는 줄 수. 1 이면 예전처럼 한 줄짜리 막대이고, 그보다 크면 그만큼
   * 아래로 늘어나 자기 미션과 피드백을 품는다.
   */
  rowSpan: number;
  /**
   * 이 주 앞뒤로도 도는지. **자른 좌표가 아니라 실제 기간으로 본다** — 격자 밖까지
   * 이어지는 막대를 끝에서 둥글게 닫으면 거기서 시작하거나 끝나는 것으로 읽힌다.
   */
  continuesBefore: boolean;
  continuesAfter: boolean;
  /** 종료일을 몰라 어디서 끝나는지 알 수 없는 막대. */
  openEnded: boolean;
  /**
   * 격자에서 이 막대의 마지막 토막인지. 종료일을 모르는 막대의 끝을 흐리게 지울 자리다.
   * "화면 밖으로 이어짐"과 "우리가 끝을 모름"은 다른 이야기라 표시도 갈라야 한다.
   */
  lastInGrid: boolean;
};

/** 오픈 목표일 하루에 찍히는 개설 표식. 늘 한 칸이라 잘릴 일도 이어질 일도 없다. */
export type ProgramLaunchSegment = PlacedSegment & {
  kind: "LAUNCH";
  /** 목표일이 이미 지났는지. 지난 개설은 기록으로 남기되 물러나 보이게 한다. */
  passed: boolean;
};

/** 미션 하나가 도는 동안. 막대 아래 줄에 칩으로 눕는다. */
export type ProgramMissionSegment = PlacedSegment & {
  kind: "MISSION";
  /**
   * 자기를 품은 막대의 상태. 칩은 그 막대 **안에** 놓이므로 생김새도 막대를 따라야 한다 —
   * 꽉 찬 막대 위의 칩과 비어 있는 막대 위의 칩이 같은 색이면 한쪽은 반드시 부딪힌다.
   */
  phase: ProgramPhase;
  /** 그 막대 안에 온전히 들어 있는지. 밖으로 나간 칩은 페이지 바탕 위에 혼자 놓인다. */
  insideBar: boolean;
  seq: number;
  /**
   * 이 미션이 어느 갈래의 것인지. 기수의 미션 구성이 한 벌뿐이면 비어 있다 —
   * 갈래가 하나뿐인 자리에 갈래 이름을 붙이면 읽는 사람이 없는 구분을 찾게 된다.
   */
  versions: ProgramVersion[];
  /** 잘리지 않은 실제 기간. 주를 넘겨 잘린 토막도 원래 기간을 말할 수 있어야 한다. */
  from: DateOnly;
  to: DateOnly;
};

/** 미션이 끝난 다음 날부터 도는 피드백. 다음 미션과 나란히 돌기도 한다. */
export type ProgramFeedbackSegment = PlacedSegment & {
  kind: "FEEDBACK";
  /** 미션 칩과 같은 이유로 품은 막대의 상태를 들고 있다. */
  phase: ProgramPhase;
  /**
   * 그 막대 안에 온전히 들어 있는지. 마지막 미션의 피드백은 운영이 끝난 뒤까지 이어져
   * 막대 밖에 혼자 놓이는 일이 잦다.
   */
  insideBar: boolean;
  /** 어느 미션에 딸린 피드백인지. */
  seq: number;
  feedback: MissionFeedback;
  versions: ProgramVersion[];
  from: DateOnly;
  to: DateOnly;
};

export type ProgramSegment =
  | ProgramBarSegment
  | ProgramLaunchSegment
  | ProgramMissionSegment
  | ProgramFeedbackSegment;

/**
 * 줄 한도를 넘겨 접힌 기수 하나.
 *
 * 세기만 하고 이름을 말하지 못하면 **접혀서 안 보이는 기수**와 **아예 등록되지 않은 기수**가
 * 화면에서 같아 보인다. 그 둘을 가리지 못하면 사람은 없는 줄 알고 다시 세우려 든다.
 */
export type ProgramHidden = {
  /**
   * 접힌 기수 그대로. 이름만 들고 오면 상태를 말할 때 이 기수의 사정(되짚어 온 기수인지)을
   * 알 수 없어, 같은 기수가 막대 툴팁과 접힘 줄에서 다르게 불린다.
   */
  period: ProgramPeriod;
  phase: ProgramPhase;
  /**
   * 이 주에서 접힌 조각의 갈래. 개설 표식만 접힌 주와 운영 막대째 접힌 주는 다른 이야기라,
   * 무엇이 접혔는지까지 말해야 펼쳐 볼지 말지를 정할 수 있다.
   */
  marks: ProgramMark[];
};

export type ProgramWeek = {
  days: ProgramDay[];
  segments: ProgramSegment[];
  /**
   * 줄 한도를 넘겨 이 주에서 접힌 기수들.
   *
   * 조각이 아니라 **기수**로 센다. 한 기수가 막대와 미션과 피드백으로 여러 조각을 내므로
   * 조각을 세면 실제보다 서너 배로 부풀어, 그 수를 보고 무엇이 빠졌는지 가늠할 수 없다.
   */
  hidden: ProgramHidden[];
};

/** 보이는 격자에 걸치는 기간인지. 걸치지 않는 기수는 그릴 것이 없다. */
function intersects(
  period: ProgramPeriod,
  start: DateOnly,
  end: DateOnly,
): boolean {
  return period.startDate <= end && (period.endDate ?? end) >= start;
}

/**
 * 격자에 실제로 그려지는 조각 하나. 그리는 날짜(`from`/`to`)는 격자 밖까지 이어지면
 * 잘라 두지만, 미션과 피드백은 잘리지 않은 원래 기간도 함께 들고 있어야 한다 —
 * 잘린 토막에 마우스를 올려도 그 미션이 언제부터 언제까지인지는 말할 수 있어야 한다.
 */
type Piece = { from: DateOnly; to: DateOnly } & (
  | { kind: "PERIOD" }
  | { kind: "LAUNCH" }
  | ({ kind: "MISSION" } & MissionPart)
  | ({ kind: "FEEDBACK"; feedback: MissionFeedback } & MissionPart)
);

/** 미션에서 나온 조각이 공통으로 지고 오는 것. 자르기 전 기간은 툴팁이 쓴다. */
type MissionPart = {
  seq: number;
  versions: ProgramVersion[];
  wholeFrom: DateOnly;
  wholeTo: DateOnly;
};

/** 한 줄을 차지하는 조각들. 보통은 개설 표식과 운영 막대가 한 줄에 함께 눕는다. */
type LaidOutRow = {
  period: ProgramPeriod;
  phase: ProgramPhase;
  /**
   * 이 격자에서 실제로 그려지는 운영 막대의 구간. 범례에서 그 상태를 접었거나 막대가
   * 격자에 안 걸치면 비어 있다. 칩이 막대 안에 든 것인지 가리는 데 쓴다.
   */
  bar: { from: DateOnly; to: DateOnly } | null;
  lane: number;
  /** 이 기수가 쓰는 줄 수. 막대가 감싸야 할 높이가 여기서 나온다. */
  rows: number;
  pieces: Piece[];
};

/** 격자 안에 들어오는 오픈 목표일만 표식이 된다. 밖이면 그 달에 그릴 것이 없다. */
function launchPieceOf(
  period: ProgramPeriod,
  start: DateOnly,
  end: DateOnly,
): Piece | null {
  const date = period.detailOpenTargetDate;
  if (date < start || date > end) return null;

  return { kind: "LAUNCH", from: date, to: date };
}

/** 격자 밖으로 나가는 기간은 격자 끝에서 자른다. 안 자르면 없는 칸을 가리키게 된다. */
function barPieceOf(
  period: ProgramPeriod,
  start: DateOnly,
  end: DateOnly,
): Piece | null {
  if (!intersects(period, start, end)) return null;

  const last = period.endDate ?? end;

  return {
    kind: "PERIOD",
    from: period.startDate < start ? start : period.startDate,
    to: last > end ? end : last,
  };
}

/**
 * 미션과 피드백이 도는 날. 설정에는 일수만 있고 날짜는 없으므로 **시작일부터 차례로 눕혀**
 * 계산한다. 미션이 끝난 다음 날 다음 미션이 시작하고, 피드백은 그 미션이 끝난 다음 날부터
 * 도는데 다음 미션과 나란히 돈다(domain/program-setting).
 *
 * 운영 기간에 맞추지 않는다. 설정의 합계가 마케팅 기획의 종료일과 어긋나면 미션이 막대보다
 * 짧거나 길게 그려지는데, 그 어긋남 자체가 봐야 할 것이다. 맞춰 늘이면 화면의 날짜가
 * 설정과 달라져 어느 쪽도 못 믿게 된다.
 *
 * **이미 끝난 기수를 실서비스에서 되짚은 것이라면 그리지 않는다.** 설정은 지금의 운영
 * 방식이라 그때 그 기수가 그 일정으로 돌았는지는 알 수 없고, 그런 기수는 지난 기록으로
 * 보는 것이지 미션을 챙길 자리가 아니다. 지금 도는 기수와 앞으로 돌 기수는 이 설정을
 * 그대로 따르므로, 되짚어 온 기수라도 미션을 품는다.
 */
function missionPiecesOf(
  period: ProgramPeriod,
  phase: ProgramPhase,
  start: DateOnly,
  end: DateOnly,
  folded: ProgramMark[],
): Piece[] {
  if (period.fromService && phase === "ENDED") return [];

  const showMissions = !folded.includes("MISSION");
  const showFeedbacks = !folded.includes("FEEDBACK");
  if (!showMissions && !showFeedbacks) return [];

  const pieces: Piece[] = [];

  for (const plan of period.missionPlans) {
    // 갈래가 하나뿐인 기수는 칩에 갈래를 붙이지 않는다.
    const versions = period.missionPlans.length > 1 ? plan.versions : [];
    let cursor = period.startDate;

    for (const mission of plan.missions) {
      const missionTo = addDays(cursor, mission.durationDays - 1);

      if (showMissions) {
        pieces.push(
          ...clip(
            {
              kind: "MISSION",
              seq: mission.seq,
              versions,
              from: cursor,
              to: missionTo,
              wholeFrom: cursor,
              wholeTo: missionTo,
            },
            start,
            end,
          ),
        );
      }

      if (showFeedbacks && mission.feedback !== null) {
        const feedbackFrom = addDays(missionTo, 1);
        const feedbackTo = addDays(feedbackFrom, mission.feedback.days - 1);

        pieces.push(
          ...clip(
            {
              kind: "FEEDBACK",
              seq: mission.seq,
              versions,
              feedback: mission.feedback,
              from: feedbackFrom,
              to: feedbackTo,
              wholeFrom: feedbackFrom,
              wholeTo: feedbackTo,
            },
            start,
            end,
          ),
        );
      }

      cursor = addDays(missionTo, 1);
    }
  }

  return pieces;
}

/** 격자에 걸치는 몫만 남긴다. 안 걸치면 빈 배열이라 그대로 흘려보낼 수 있다. */
function clip(piece: Piece, start: DateOnly, end: DateOnly): Piece[] {
  if (piece.to < start || piece.from > end) return [];

  return [
    {
      ...piece,
      from: piece.from < start ? start : piece.from,
      to: piece.to > end ? end : piece.to,
    },
  ];
}

/**
 * 한 기수가 이 격자에서 만드는 줄들. 조각을 앞에서부터 빈 줄에 채워 넣어, 서로 겹치지
 * 않는 것끼리 한 줄에 모인다.
 *
 * 그래서 보통은 개설 표식과 운영 막대가 첫 줄에 함께 눕고, 막대와 겹치는 미션이 그 아래
 * 한 줄을 쓰고, 다음 미션과 나란히 도는 중간 피드백이 있을 때만 한 줄이 더 생긴다.
 * 마지막 미션 뒤에만 피드백이 붙는 구성은 미션 줄의 빈 끝자리에 그대로 들어간다.
 *
 * 조각 차례가 곧 줄 차례다. 막대 · 미션 · 피드백 순으로 넣어야 미션이 자기 막대 아래
 * 오고, 피드백이 그 아래 온다.
 */
function rowsOf(
  period: ProgramPeriod,
  today: DateOnly,
  start: DateOnly,
  end: DateOnly,
  folded: ProgramMark[],
): Omit<LaidOutRow, "lane" | "rows">[] {
  const phase = phaseOf(period, today);

  const launch = folded.includes("LAUNCH")
    ? null
    : launchPieceOf(period, start, end);
  const bar = folded.includes(phase) ? null : barPieceOf(period, start, end);

  const pieces = [
    ...(launch ? [launch] : []),
    ...(bar ? [bar] : []),
    // 막대가 접혀 있어도 미션은 그린다. 접은 것은 상태 하나지 그 기수 전부가 아니다.
    ...missionPiecesOf(period, phase, start, end, folded),
  ];

  const rows: Piece[][] = [];

  for (const piece of pieces) {
    const row = rows.find((taken) => !collides(taken, [piece]));
    if (row) row.push(piece);
    else rows.push([piece]);
  }

  const span = bar ? { from: bar.from, to: bar.to } : null;

  return rows.map((row) => ({ period, phase, bar: span, pieces: row }));
}

/** 줄이 격자에서 차지하는 구간. 개설 표식이 운영보다 앞서므로 보통 그쪽이 왼쪽 끝이다. */
function spanOf(pieces: Piece[]): { from: DateOnly; to: DateOnly } {
  return {
    from: pieces.reduce(
      (min, piece) => (piece.from < min ? piece.from : min),
      pieces[0].from,
    ),
    to: pieces.reduce(
      (max, piece) => (piece.to > max ? piece.to : max),
      pieces[0].to,
    ),
  };
}

/** 이 줄의 조각이 그 층에 이미 놓인 것과 날짜로 부딪히는지. */
function collides(taken: Piece[], pieces: Piece[]): boolean {
  return pieces.some((piece) =>
    taken.some((other) => piece.from <= other.to && piece.to >= other.from),
  );
}

/**
 * 줄을 겹치지 않게 나눠 놓는다. 줄은 **격자 전체에서 한 번** 정한다 — 주마다 다시 정하면
 * 같은 프로그램이 주를 넘길 때 위아래로 튀어 한 줄로 안 읽힌다.
 *
 * 왼쪽 끝이 이른 것부터 빈 줄을 찾아 놓는 방식이라, 일찍 열어 오래 도는 프로그램이 위쪽
 * 줄을 차지한다. 아래 줄일수록 짧고 늦게 시작한 것이 모여 한도에 걸려 접히는 쪽도 그쪽이 된다.
 *
 * 자리는 줄의 양 끝이 아니라 **실제로 그리는 조각**으로 잡는다. 개설 표식과 운영 막대
 * 사이는 보통 2주쯤 비는데, 그 빈 자리까지 통째로 잡으면 아무것도 안 그리는 줄이 자리만
 * 차지해 다른 기수의 개설 표식이 한도 밖으로 밀려난다. 빈 자리는 다른 기수에게 내어준다.
 *
 * 한 기수의 줄들은 **붙여서** 앉힌다. 막대가 미션을 감싸는 그림이라 사이에 남의 줄이
 * 끼면 그 그림이 깨진다. 그래서 자리를 찾을 때도 줄 하나가 아니라 그 기수의 줄 전부가
 * 연달아 들어갈 자리를 찾는다.
 */
function layoutRows(
  periods: ProgramPeriod[],
  today: DateOnly,
  start: DateOnly,
  end: DateOnly,
  folded: ProgramMark[],
): LaidOutRow[] {
  // 줄마다 이미 찬 구간들. 다음 기수를 같은 층에 놓을 수 있는지가 이 값으로 갈린다.
  const lanes: Piece[][] = [];
  const laid: LaidOutRow[] = [];

  const blocks = periods
    .map((period) => ({
      rows: rowsOf(period, today, start, end, folded),
      period,
    }))
    .filter((block) => block.rows.length > 0)
    .map((block) => ({
      ...block,
      span: spanOf(block.rows.flatMap((row) => row.pieces)),
    }))
    .sort((a, b) =>
      a.span.from === b.span.from
        ? comparePeriods(a.period, b.period)
        : a.span.from < b.span.from
          ? -1
          : 1,
    );

  for (const block of blocks) {
    const claims = claimsOf(block.rows);
    const base = firstFitBlock(lanes, claims);

    claims.forEach((claim, index) => {
      const lane = base + index;
      while (lanes.length <= lane) lanes.push([]);
      lanes[lane].push(...claim);

      laid.push({ ...block.rows[index], lane, rows: claims.length });
    });
  }

  return laid;
}

/**
 * 각 줄이 실제로 잡는 자리. 조각이 놓인 자리에 더해, **막대가 덮는 구간을 모든 줄에서**
 * 잡는다 — 감싸는 그림은 막대 폭만큼의 네모라, 미션이 없는 안쪽 칸에 남의 칩이 들어오면
 * 그 칩이 이 기수의 것으로 읽힌다.
 *
 * 개설 표식이 찍힌 하루는 네모 밖이라 잡지 않는다. 그 자리는 다른 기수에게 그대로 열려 있다.
 */
function claimsOf(rows: Omit<LaidOutRow, "lane" | "rows">[]): Piece[][] {
  const bar = rows
    .flatMap((row) => row.pieces)
    .find((piece) => piece.kind === "PERIOD");

  return rows.map((row) => (bar ? [...row.pieces, bar] : row.pieces));
}

/** 한 기수의 줄들이 연달아 앉을 수 있는 첫 층. 아래로 내려가다 보면 반드시 빈 자리가 있다. */
function firstFitBlock(lanes: Piece[][], claims: Piece[][]): number {
  for (let base = 0; ; base += 1) {
    const fits = claims.every((claim, index) => {
      const taken = lanes[base + index];
      return taken === undefined || !collides(taken, claim);
    });

    if (fits) return base;
  }
}

/** 주 안에서 몇 번째 칸인지. 격자 밖에서 이어져 온 막대는 첫 칸에 붙인다. */
function columnOf(weekStart: DateOnly, date: DateOnly): number {
  return Math.min(6, Math.max(0, daysBetween(weekStart, date)));
}

/** 한 주 안에서 조각이 놓이는 자리. 주 밖으로 나간 몫은 여기서 잘린다. */
function segmentOf(
  row: LaidOutRow,
  piece: Piece,
  weekStart: DateOnly,
  weekEnd: DateOnly,
  today: DateOnly,
  rowSpan: number,
): ProgramSegment {
  const { period, phase, lane } = row;

  // 막대가 덮는 구간 안에 온전히 든 조각만 막대의 결을 따를 수 있다.
  const insideBar =
    row.bar !== null && piece.from >= row.bar.from && piece.to <= row.bar.to;

  const placed = {
    // 한 기수가 미션을 여러 개 그리므로 종류와 주만으로는 열쇠가 겹친다.
    key: `${period.programId}-${piece.kind}-${keyOf(piece)}-${weekStart}`,
    period,
    lane,
    startCol: columnOf(weekStart, piece.from),
    endCol: columnOf(weekStart, piece.to),
  };

  if (piece.kind === "LAUNCH") {
    return { ...placed, kind: "LAUNCH", passed: piece.from < today };
  }

  if (piece.kind === "MISSION") {
    return {
      ...placed,
      kind: "MISSION",
      phase,
      insideBar,
      seq: piece.seq,
      versions: piece.versions,
      from: piece.wholeFrom,
      to: piece.wholeTo,
    };
  }

  if (piece.kind === "FEEDBACK") {
    return {
      ...placed,
      kind: "FEEDBACK",
      phase,
      insideBar,
      seq: piece.seq,
      feedback: piece.feedback,
      versions: piece.versions,
      from: piece.wholeFrom,
      to: piece.wholeTo,
    };
  }

  return {
    ...placed,
    kind: "PERIOD",
    phase,
    rowSpan,
    continuesBefore: period.startDate < weekStart,
    // 종료일을 모르면 이 주에서 끝난다고 말할 수 없다. 닫지 않고 열어둔다.
    continuesAfter: period.endDate === null || period.endDate > weekEnd,
    openEnded: period.endDate === null,
    lastInGrid: piece.to <= weekEnd,
  };
}

/** 같은 주에 같은 종류가 여럿일 때 서로를 가르는 값. 미션 번호와 갈래가 그것이다. */
function keyOf(piece: Piece): string {
  return piece.kind === "MISSION" || piece.kind === "FEEDBACK"
    ? `${piece.versions.join("+")}-${piece.seq}`
    : "";
}

/**
 * 일요일 시작의 주 단위 격자에 프로그램 막대를 눕힌다.
 * 업무 캘린더와 같은 격자를 쓰므로 두 화면의 같은 달이 같은 모양이다.
 */
export function buildProgramMonth(
  month: CalendarMonth,
  periods: ProgramPeriod[],
  today: DateOnly,
  folded: ProgramMark[] = [],
  maxLanes: number = MAX_LANES,
): ProgramWeek[] {
  const start = gridStartOf(month);
  const weekCount = weekCountOf(month);
  const end = addDays(start, weekCount * 7 - 1);
  const monthPrefix = firstDateOf(month).slice(0, 7);

  const rows = layoutRows(periods, today, start, end, folded);

  return Array.from({ length: weekCount }, (_, week) => {
    const weekStart = addDays(start, week * 7);
    const weekEnd = addDays(weekStart, 6);

    const segments: ProgramSegment[] = [];
    // 같은 기수의 조각 여럿이 한 줄로 합쳐지도록 기수 단위로 모은다.
    const hidden = new Map<string, HiddenParts>();

    /**
     * 이 주에 이 기수가 실제로 무언가를 그리는 마지막 줄. 막대는 여기까지만 감싼다 —
     * 미션이 이미 끝난 주까지 자리를 잡아 두면 빈 네모만 길게 남는다.
     */
    const bottoms = new Map<string, number>();

    for (const row of rows) {
      if (row.lane >= maxLanes) continue;
      if (
        !row.pieces.some(
          (piece) => piece.to >= weekStart && piece.from <= weekEnd,
        )
      )
        continue;

      const id = row.period.programId;
      bottoms.set(id, Math.max(bottoms.get(id) ?? row.lane, row.lane));
    }

    for (const row of rows) {
      for (const piece of row.pieces) {
        if (piece.from > weekEnd || piece.to < weekStart) continue;

        if (row.lane >= maxLanes) {
          fold(hidden, row, piece);
          continue;
        }

        const bottom = bottoms.get(row.period.programId) ?? row.lane;
        segments.push(
          segmentOf(
            row,
            piece,
            weekStart,
            weekEnd,
            today,
            bottom - row.lane + 1,
          ),
        );
      }
    }

    const days = Array.from({ length: 7 }, (_, day) => {
      const date = addDays(weekStart, day);
      return {
        date,
        inMonth: date.slice(0, 7) === monthPrefix,
        isToday: date === today,
        isWeekend: day === 0 || day === 6,
        isHoliday: isHoliday(date),
      };
    });

    return { days, segments, hidden: [...hidden.values()].map(toHidden) };
  });
}

/** 접힌 기수를 모으는 동안의 모습. 갈래는 중복 없이 쌓고 차례는 내보낼 때 세운다. */
type HiddenParts = {
  period: ProgramPeriod;
  phase: ProgramPhase;
  marks: Set<ProgramMark>;
};

/**
 * 접힌 조각 하나를 그 기수의 몫으로 더한다. 운영 막대는 갈래가 따로 없고 그 기수의
 * 상태가 곧 갈래라(범례가 상태를 갈래로 세는 것과 같은 이유), 막대만 상태로 바꿔 담는다.
 */
function fold(
  into: Map<string, HiddenParts>,
  row: LaidOutRow,
  piece: Piece,
): void {
  const mark: ProgramMark = piece.kind === "PERIOD" ? row.phase : piece.kind;

  const found = into.get(row.period.programId);
  if (found) {
    found.marks.add(mark);
    return;
  }

  into.set(row.period.programId, {
    period: row.period,
    phase: row.phase,
    marks: new Set([mark]),
  });
}

/** 갈래는 범례와 같은 차례로 세운다. 두 곳이 같은 말을 다른 순서로 하면 짝이 안 보인다. */
function toHidden(parts: HiddenParts): ProgramHidden {
  return {
    period: parts.period,
    phase: parts.phase,
    marks: PROGRAM_MARKS.filter((mark) => parts.marks.has(mark)),
  };
}

/**
 * 이 달 격자에 걸치는 것을 갈래별로 센다. 범례 옆 숫자가 곧 이 값이다.
 * 접혀서 안 보이는 것도 세어, 화면에 몇 개가 있는지와 이 달에 몇 개가 도는지가 갈린다.
 *
 * 상태는 **운영 기간**이 걸치는지로, 개설은 **오픈 목표일**이 이 격자 안에 떨어지는지로
 * 센다. 한 기수가 두 곳에서 세어지는 것은 두 가지가 각각 이 달의 일이기 때문이다.
 *
 * 미션과 피드백은 기수가 아니라 **이 달에 걸치는 칩 수**를 센다. 셋이 기수 수를 세면 늘
 * 운영 중 수와 같아 아무것도 말하지 않는다. 이 달에 미션이 몇 번 돌아가는지가 알고 싶은
 * 값이다.
 */
export function countMarksInMonth(
  month: CalendarMonth,
  periods: ProgramPeriod[],
  today: DateOnly,
): Record<ProgramMark, number> {
  const start = gridStartOf(month);
  const end = addDays(start, weekCountOf(month) * 7 - 1);

  const counts: Record<ProgramMark, number> = {
    RUNNING: 0,
    READY: 0,
    UPCOMING: 0,
    ENDED: 0,
    LAUNCH: 0,
    MISSION: 0,
    FEEDBACK: 0,
  };

  for (const period of periods) {
    const phase = phaseOf(period, today);
    if (intersects(period, start, end)) counts[phase] += 1;

    const open = period.detailOpenTargetDate;
    if (open >= start && open <= end) counts.LAUNCH += 1;

    for (const piece of missionPiecesOf(period, phase, start, end, [])) {
      counts[piece.kind === "MISSION" ? "MISSION" : "FEEDBACK"] += 1;
    }
  }

  return counts;
}
