/**
 * 참여자 수행 현황의 규칙(plan.md §5 — 참여자 수행 현황). DB 를 타지 않는 계산만 둔다.
 *
 * 사본에는 운영DB 숫자가 그대로 있고, 정시 · 지각 · 반려와 점수 · 경고는 여기서 매번 계산한다.
 * 숫자의 뜻은 관리자 화면 코드의 enum 순서에 1부터 번호를 붙인 값이다(2026-10-03 실데이터로 확인).
 */

/** 기준 달성 점수. 전 챌린지 공통이다. */
export const PASS_SCORE = 80;
/** 비교 기준보다 이만큼(%p) 이상 낮으면 경고한다. 기수 간 편차를 보고 정했다(표준편차 22%p). */
export const WARN_DROP = 20;
/** 비교할 지난 기수 수 */
const PRIOR_COUNT = 3;

/** mission_type — -1 일반 · 1 OT · 2 POOL · 3 BONUS · 4 · 5 체험(같은 회차에 둘이 나란히 서고 하나를 골라 낸다) */
const KIND_OT = 1;
const KIND_BONUS = 3;
/** challenge_type 2 는 멘토링 · 스터디가 섞인 기타 묶음이라 견줄 기준이 없다. 경고를 붙이지 않는다. */
export const MISC_TYPE = 2;

/** 관리자(1) · 내부 테스트 계정(1751). CS 수집과 같은 계정이다. */
const TEST_USER_IDS = new Set([1, 1751]);

export function isTestUser(userId: number): boolean {
  return TEST_USER_IDS.has(userId);
}

/** `[테스트]` 말고도 `260921 테스트 챌린지_…` 꼴과 안내 문서를 만들려고 연 챌린지가 섞여 있다. */
export function isTestChallenge(title: string): boolean {
  return title.includes("테스트") || title.includes("가이드 문서용");
}

export type ProgressMission = {
  missionId: number;
  th: number;
  kind: number | null;
  /** 한국 시각 `YYYY-MM-DD HH:MM:SS` */
  due: string;
  score: number;
  lateScore: number;
};

export type ProgressParticipant = {
  userId: number;
  /** missions 와 같은 순서. 제출상태값 · 확인결과값을 이은 두 글자, 제출이 없으면 "" */
  codes: string[];
};

export type ProgressCohortSource = {
  id: number;
  type: number;
  title: string;
  /** `YYYY-MM-DD` */
  startDate: string;
  endDate: string;
  missions: ProgressMission[];
  participants: ProgressParticipant[];
};

/** 제출 한 건을 읽은 결과. 앞에 둔 것일수록 낫다 — 한 회차에 미션이 둘이면 나은 쪽을 쓴다. */
const OUTCOMES = ["on", "late", "rejected", "finalRejected", "missing"] as const;
type Outcome = (typeof OUTCOMES)[number];

/**
 * status 1 정상 · 2 수정 제출 · 3 지각 · 4 미제출 처리 / result 1 확인중 · 2 확인 완료 · 3 반려 · 4 최종 반려.
 * 확인중도 제출로 친다. 반려 · 최종 반려는 미제출이다 — 반려는 다시 낼 수 있어 따로 둔다.
 */
export function readCode(code: string): Outcome {
  if (code.length !== 2) return "missing";
  const status = code[0];
  const result = code[1];
  if (status === "4") return "missing";
  if (result === "4") return "finalRejected";
  if (result === "3") return "rejected";
  return status === "3" ? "late" : "on";
}

function better(a: Outcome, b: Outcome): Outcome {
  return OUTCOMES.indexOf(a) <= OUTCOMES.indexOf(b) ? a : b;
}

/** 0회차는 종류가 일반으로 적혀 있어도 OT 다 — 0점 · 0회차인 OT 가 종류 없이 들어간 기수가 많다. */
function isExcluded(mission: ProgressMission): boolean {
  return mission.kind === KIND_OT || mission.kind === KIND_BONUS || mission.th === 0;
}

function excludedLabel(mission: ProgressMission): string {
  if (mission.kind === KIND_BONUS) return "보너스";
  return "OT";
}

/**
 * `[대학생·무경력자 Ver.]` 같은 갈래. 갈래가 다르면 같은 챌린지여도 따로 비교한다.
 * `[대학생, 무경력자 Ver.]` 처럼 표기가 흔들리므로 문장부호와 띄어쓰기를 걷어낸다.
 */
function versionOf(title: string): string {
  const match = title.match(/\[([^\]]*Ver\.?)\]/);
  return match ? match[1].replace(/[\s.,·]/g, "") : "";
}

export type RoundView = {
  th: number;
  /** 체험 미션처럼 한 회차에 미션이 둘 이상이다 */
  paired: boolean;
  /** 마지막 미션 마감 */
  due: string;
  closed: boolean;
  score: number;
  lateScore: number;
  on: number;
  late: number;
  /** 반려 · 최종 반려 */
  rejected: number;
  missing: number;
  /** (정시 + 지각) ÷ 참여 인원, % */
  rate: number;
  /** 비교 기준 제출률(%). 마감 전이거나 기준이 없으면 null */
  base: number | null;
  baseSource: "prior" | "order" | null;
  warn: boolean;
};

export type ExtraMissionView = { label: string; th: number; closed: boolean; rate: number };

export type CohortView = {
  id: number;
  type: number;
  title: string;
  startDate: string;
  endDate: string;
  done: boolean;
  participants: number;
  rounds: RoundView[];
  /** OT · 보너스. 기준 계산에서 빠지고 제출률만 본다. */
  extras: ExtraMissionView[];
  /** 기준 달성 — 80점 이상 + 모든 회차 제출 */
  achieved: number;
  /** 탈락 확정 — 최종 반려된 회차가 있거나, 남은 회차를 다 내도 80점이 안 된다 */
  eliminated: number;
  /** 점수 10점 구간(0–9 … 90 이상) 인원. 끝난 기수는 최종 점수, 진행 중은 마감 회차 배점 대비 비율 */
  histogram: number[];
  warnings: number;
};

type Round = { th: number; missions: { mission: ProgressMission; index: number }[] };

function groupRounds(missions: ProgressMission[]): { rounds: Round[]; extras: { mission: ProgressMission; index: number }[] } {
  const byTh = new Map<number, Round>();
  const extras: { mission: ProgressMission; index: number }[] = [];
  missions.forEach((mission, index) => {
    if (isExcluded(mission)) {
      extras.push({ mission, index });
      return;
    }
    const round = byTh.get(mission.th) ?? { th: mission.th, missions: [] };
    round.missions.push({ mission, index });
    byTh.set(mission.th, round);
  });
  return {
    rounds: [...byTh.values()].sort((a, b) => a.th - b.th),
    extras: extras.sort((a, b) => a.mission.th - b.mission.th),
  };
}

function percent(part: number, whole: number): number {
  return whole > 0 ? (100 * part) / whole : 0;
}

/** 기수 하나를 계산한다. now 는 한국 시각 `YYYY-MM-DD HH:MM:SS` — 쿼리가 돈 시각이다. */
function computeCohort(source: ProgressCohortSource, now: string): CohortView {
  const { rounds, extras } = groupRounds(source.missions);
  const n = source.participants.length;

  const roundViews: RoundView[] = rounds.map((round) => {
    const due = round.missions.map(({ mission }) => mission.due).sort().at(-1) ?? "";
    return {
      th: round.th,
      paired: round.missions.length > 1,
      due,
      closed: due < now,
      score: Math.max(...round.missions.map(({ mission }) => mission.score)),
      lateScore: Math.max(...round.missions.map(({ mission }) => mission.lateScore)),
      on: 0,
      late: 0,
      rejected: 0,
      missing: 0,
      rate: 0,
      base: null,
      baseSource: null,
      warn: false,
    };
  });

  const done = `${source.endDate} 23:59:59` < now;
  let achieved = 0;
  let eliminated = 0;
  const histogram = new Array<number>(10).fill(0);

  for (const participant of source.participants) {
    let earned = 0;
    let earnedClosed = 0;
    let maxClosed = 0;
    let possible = 0;
    let allSubmitted = true;
    let finalRejected = false;

    rounds.forEach((round, r) => {
      const view = roundViews[r];
      let outcome: Outcome = "missing";
      let points = 0;
      let stillOpen = false;
      for (const { mission, index } of round.missions) {
        const read = readCode(participant.codes[index] ?? "");
        if (read === "missing" || read === "rejected") stillOpen = true;
        const value = read === "on" ? mission.score : read === "late" ? mission.lateScore : 0;
        if (better(read, outcome) === read && (read !== outcome || value > points)) {
          outcome = read;
          points = value;
        }
      }
      // 체험 미션 하나가 최종 반려돼도 다른 하나를 아직 낼 수 있으면 끝난 회차가 아니다.
      if (outcome === "finalRejected" && stillOpen) outcome = "rejected";

      if (outcome === "on") view.on++;
      else if (outcome === "late") view.late++;
      else if (outcome === "missing") view.missing++;
      else view.rejected++;

      const submitted = outcome === "on" || outcome === "late";
      if (!submitted) allSubmitted = false;
      if (outcome === "finalRejected") finalRejected = true;
      earned += points;
      if (view.closed) {
        earnedClosed += points;
        maxClosed += view.score;
      }
      // 마감이 지나도 지각으로 낼 수 있다 — 지각 제출의 절반은 마감 하루 뒤, 일부는 챌린지가 끝난 뒤에 들어온다.
      possible += submitted ? points : outcome === "finalRejected" ? 0 : view.closed ? view.lateScore : view.score;
    });

    if (earned >= PASS_SCORE && allSubmitted) achieved++;
    if (finalRejected || possible < PASS_SCORE) eliminated++;
    const shown = done ? earned : maxClosed > 0 ? percent(earnedClosed, maxClosed) : null;
    if (shown !== null) histogram[Math.min(9, Math.max(0, Math.floor(shown / 10)))]++;
  }

  for (const view of roundViews) view.rate = percent(view.on + view.late, n);

  const extraViews: ExtraMissionView[] = extras.map(({ mission, index }) => {
    const submitted = source.participants.filter((participant) => {
      const read = readCode(participant.codes[index] ?? "");
      return read === "on" || read === "late";
    }).length;
    return { label: excludedLabel(mission), th: mission.th, closed: mission.due < now, rate: percent(submitted, n) };
  });

  return {
    id: source.id,
    type: source.type,
    title: source.title,
    startDate: source.startDate,
    endDate: source.endDate,
    done,
    participants: n,
    rounds: roundViews,
    extras: extraViews,
    achieved,
    eliminated,
    histogram,
    warnings: 0,
  };
}

/** 지난 기수를 묶는 열쇠. 기타 묶음은 null — 비교하지 않는다. */
function groupOf(cohort: CohortView): string | null {
  return cohort.type === MISC_TYPE ? null : `${cohort.type}|${versionOf(cohort.title)}`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * 모든 기수를 계산하고 경고를 붙인다. 배점이 하나도 없는 챌린지는 빼고 돌려준다.
 *
 * 경고는 비교 기준보다 20%p 이상 낮은 마감 회차다. 기준은 같은 챌린지(같은 갈래) 직전 3개 기수의
 * 같은 회차 평균이고, 그런 기수가 셋이 안 되면 끝난 기수 전체에서 같은 순서 회차의 제출률 중앙값이다.
 * 제출률은 회차가 갈수록 자연스럽게 떨어져(1회차 78% → 6회차 54%) 고정 임계값은 후반 회차마다 울린다.
 */
export function computeCohorts(sources: ProgressCohortSource[], now: string): CohortView[] {
  const cohorts = sources
    .filter((source) => source.missions.some((mission) => !isExcluded(mission) && mission.score > 0))
    .map((source) => computeCohort(source, now));

  const byOrder: number[][] = [];
  for (const cohort of cohorts) {
    if (!cohort.done || cohort.participants === 0 || cohort.type === MISC_TYPE) continue;
    cohort.rounds.forEach((round, index) => {
      if (round.closed) (byOrder[index] ??= []).push(round.rate);
    });
  }
  const orderMedian = byOrder.map((rates) => median(rates));

  const byGroup = new Map<string, CohortView[]>();
  for (const cohort of cohorts) {
    const group = groupOf(cohort);
    if (group === null) continue;
    byGroup.set(group, [...(byGroup.get(group) ?? []), cohort]);
  }

  for (const cohort of cohorts) {
    const group = groupOf(cohort);
    // 기타 묶음은 멘토링 · 스터디가 섞여 견줄 기준이 없다 — 경고를 붙이지 않는다.
    if (group === null) continue;
    const earlier = (byGroup.get(group) ?? [])
      .filter((other) => other.startDate < cohort.startDate && other.participants > 0)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    cohort.rounds.forEach((round, index) => {
      if (!round.closed || cohort.participants === 0) return;
      // 같은 회차가 마감된 기수 중에서 최근 셋을 고른다. 시작일로만 고르면 겹쳐 열린 기수의 마감 전 회차가 자리를 차지한다.
      const priorRates = earlier
        .flatMap((other) => other.rounds.filter((past) => past.th === round.th && past.closed).map((past) => past.rate))
        .slice(-PRIOR_COUNT);
      if (priorRates.length >= PRIOR_COUNT) {
        round.base = mean(priorRates);
        round.baseSource = "prior";
      } else if (orderMedian[index] != null) {
        round.base = orderMedian[index];
        round.baseSource = "order";
      }
      round.warn = round.base !== null && round.rate <= round.base - WARN_DROP;
    });
    cohort.warnings = cohort.rounds.filter((round) => round.warn).length;
  }

  return cohorts;
}

/** 쿼리 344 가 내보내는 칸. 하나라도 없으면 쿼리가 바뀐 것이라 아무것도 고치지 않는다. */
export const PROGRESS_REQUIRED_COLUMNS = [
  "challenge_id",
  "구분",
  "챌린지",
  "시작일자",
  "종료일자",
  "mission_id",
  "회차",
  "미션종류값",
  "미션마감일시",
  "배점",
  "지각배점",
  "user_id",
  "제출상태값",
  "확인결과값",
];

type Cell = string | number | null;

function toInt(value: Cell): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return value !== null && value !== "" && Number.isInteger(number) ? number : null;
}

function toText(value: Cell): string {
  return value === null ? "" : String(value).trim();
}

function toDate(value: Cell): string | null {
  const text = toText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function toDateTime(value: Cell): string | null {
  const text = toText(value).replace("T", " ").replace(/\.\d+$/, "");
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? text : null;
}

export type ProgressFoldResult = {
  cohorts: ProgressCohortSource[];
  /** 빼 둔 테스트 챌린지 수 */
  testChallenges: number;
  /** 사용자가 없는 신청(탈퇴한 계정으로 보인다)의 줄 수. 참여 인원에서 뺀다. */
  noUser: number;
  /** 열쇠 · 날짜를 못 읽어 버린 줄 수 */
  skipped: number;
};

/**
 * 신청 × 미션 한 줄씩인 쿼리 결과를 기수 하나에 한 덩어리로 접는다.
 * 한 사람이 같은 챌린지에 신청을 둘 넣었으면(취소 안 된 것끼리) 한 사람으로 센다 — 제출은 사람에게 붙는다.
 */
export function foldProgressRows(rows: Record<string, Cell>[]): ProgressFoldResult {
  type Draft = ProgressCohortSource & { missionIndex: Map<number, number>; byUser: Map<number, string[]> };
  const drafts = new Map<number, Draft>();
  const tests = new Set<number>();
  let skipped = 0;
  let noUser = 0;

  for (const row of rows) {
    const challengeId = toInt(row.challenge_id);
    const missionId = toInt(row.mission_id);
    const userId = toInt(row.user_id);
    const th = toInt(row.회차);
    const type = toInt(row.구분);
    const startDate = toDate(row.시작일자);
    const endDate = toDate(row.종료일자);
    const due = toDateTime(row.미션마감일시);
    if (
      challengeId === null ||
      missionId === null ||
      (userId === null && row.user_id !== null) ||
      th === null ||
      type === null ||
      startDate === null ||
      endDate === null ||
      due === null
    ) {
      skipped++;
      continue;
    }
    const title = toText(row.챌린지);
    if (isTestChallenge(title)) {
      tests.add(challengeId);
      continue;
    }
    if (row.user_id === null) {
      noUser++;
      continue;
    }
    if (userId === null || isTestUser(userId)) continue;

    let draft = drafts.get(challengeId);
    if (!draft) {
      draft = {
        id: challengeId,
        type,
        title,
        startDate,
        endDate,
        missions: [],
        participants: [],
        missionIndex: new Map(),
        byUser: new Map(),
      };
      drafts.set(challengeId, draft);
    }
    let index = draft.missionIndex.get(missionId);
    if (index === undefined) {
      index = draft.missions.length;
      draft.missionIndex.set(missionId, index);
      draft.missions.push({
        missionId,
        th,
        kind: toInt(row.미션종류값),
        due,
        score: toInt(row.배점) ?? 0,
        lateScore: toInt(row.지각배점) ?? 0,
      });
    }
    const codes = draft.byUser.get(userId) ?? [];
    const status = toInt(row.제출상태값);
    const result = toInt(row.확인결과값);
    // 같은 사람 · 같은 미션에 제출이 여러 줄이면 나은 쪽을 남긴다.
    if (status !== null && result !== null) {
      const code = `${status}${result}`;
      const previous = codes[index];
      if (previous === undefined || better(readCode(code), readCode(previous)) === readCode(code)) codes[index] = code;
    }
    draft.byUser.set(userId, codes);
  }

  const cohorts = [...drafts.values()].map((draft) => ({
    id: draft.id,
    type: draft.type,
    title: draft.title,
    startDate: draft.startDate,
    endDate: draft.endDate,
    missions: draft.missions,
    participants: [...draft.byUser].map(([userId, codes]) => ({
      userId,
      codes: draft.missions.map((_, index) => codes[index] ?? ""),
    })),
  }));
  return { cohorts, testChallenges: tests.size, noUser, skipped };
}
