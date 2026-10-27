/**
 * 프로그램 설정 규칙. 데이터베이스를 모르는 순수 로직이라 화면에서도 그대로 쓴다.
 *
 * 설정은 기수가 아니라 챌린지에 붙는다. "포트폴리오 챌린지" 의 운영 방식을 한 번 적어두면
 * 30기든 31기든 같은 방식을 따르므로, 기수를 열 때마다 다시 적지 않는다.
 */

/**
 * 같은 챌린지가 대상에 따라 둘로 나뉘는 경우가 있다. 갈래는 이 둘로 고정이다.
 * 나뉘지 않는 챌린지는 `COMMON` 한 벌만 둔다 — 안 나뉘는 챌린지에 뜻 없는 갈래를
 * 고르게 하지 않으려는 것이다. 한 챌린지 안에서 `COMMON` 과 나머지는 섞이지 않는다.
 */
export const PROGRAM_VERSIONS = ["COMMON", "ENTRY", "EXPERIENCED"] as const;

export type ProgramVersion = (typeof PROGRAM_VERSIONS)[number];

export const PROGRAM_VERSION_LABELS: Record<ProgramVersion, string> = {
  COMMON: "구분 없음",
  ENTRY: "무경력자",
  EXPERIENCED: "경력자",
};

export function isProgramVersion(value: string): value is ProgramVersion {
  return (PROGRAM_VERSIONS as readonly string[]).includes(value);
}

/** 피드백은 서면과 라이브 두 가지로 제공된다. 갈래는 이 둘로 고정이다(plan.md §5). */
export const FEEDBACK_KINDS = ["WRITTEN", "LIVE"] as const;

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  WRITTEN: "서면",
  LIVE: "라이브",
};

export function isFeedbackKind(value: string): value is FeedbackKind {
  return (FEEDBACK_KINDS as readonly string[]).includes(value);
}

/**
 * 한 미션이 끝난 뒤 붙는 피드백. 미션마다 하나까지다 — 같은 미션 뒤에 서면과 라이브가
 * 함께 도는 구성은 없다.
 */
export type MissionFeedback = {
  kind: FeedbackKind;
  /** 미션 종료 다음 날부터 피드백이 도는 일수. 보통 1~4일이다. */
  days: number;
};

/** 미션 하나. 개수는 배열 길이가 곧 답이라 따로 세지 않는다. */
export type MissionPlan = {
  /** 1부터. 화면의 "미션 3" 의 3 이다. */
  seq: number;
  durationDays: number;
  /** 이 미션 뒤에 피드백이 없으면 `null`. 모든 미션에 붙는 것은 아니다. */
  feedback: MissionFeedback | null;
};

/**
 * 갈래와 무관한 운영 방식 값. 경고 계산처럼 버전을 몰라도 되는 곳이 쓴다.
 *
 * 피드백 횟수는 없다. 미션에 적어둔 피드백을 세면 나오는 값이라 따로 받으면
 * 둘이 어긋날 수 있고, 그때 어느 쪽이 맞는지 아무도 모른다.
 */
export type ProgramSettingValues = {
  /** 미션이 도는 기간. 피드백 기간은 여기 포함되지 않는다. */
  durationDays: number;
  missions: MissionPlan[];
};

/** 설정 한 벌을 가리키는 두 축. 챌린지 + 커리큘럼 + 버전 하나당 한 벌이다. */
export type ProgramSetting = ProgramSettingValues & {
  curriculumDays: number;
  version: ProgramVersion;
};

/**
 * 같은 챌린지가 기수에 따라 1주나 2주 커리큘럼으로 열리는 경우가 있다. 1주·2주와 전혀 다른
 * 길이(예: 9일)도 있어 이름을 고정하지 않고 **일수**로 적는다(plan.md §5).
 *
 * 버전과는 다른 축이다. 버전은 한 기수 안에서 두 갈래가 함께 도는 것이고, 커리큘럼은 기수마다
 * 하나를 골라 연다. 나뉘지 않는 챌린지는 `0`(구분 없음) 한 벌뿐이고, 한 챌린지 안에서 `0` 과
 * 커리큘럼별 설정은 섞이지 않는다 — 섞이면 어느 기수가 어느 설정을 따르는지 흐려진다.
 *
 * 일수는 이름표일 뿐 수행기간이 아니다. `2주` 커리큘럼의 수행기간이 15일일 수 있다.
 */
export const CURRICULUM_NONE = 0;
export const CURRICULUM_ONE_WEEK = 7;
export const CURRICULUM_TWO_WEEKS = 14;
export const CURRICULUM_THREE_WEEKS = 21;

/** 드롭다운에 이름으로 서는 커리큘럼. 나머지는 일수를 직접 적는다. */
export const PRESET_CURRICULUM_DAYS = [
  CURRICULUM_NONE,
  CURRICULUM_ONE_WEEK,
  CURRICULUM_TWO_WEEKS,
  CURRICULUM_THREE_WEEKS,
] as const;

/** 커리큘럼이 한 해를 넘을 일은 없다. 수행기간과 같은 상한으로 오타를 막는다. */
export const MAX_CURRICULUM_DAYS = 365;

/** 적은 일수에서 이름이 나온다. 7일은 `1주`, 14일은 `2주`, 21일은 `3주`, 나머지는 일수 그대로다. */
export function curriculumLabel(days: number): string {
  if (days === CURRICULUM_NONE) return "구분 없음";
  if (days === CURRICULUM_ONE_WEEK) return "1주";
  if (days === CURRICULUM_TWO_WEEKS) return "2주";
  if (days === CURRICULUM_THREE_WEEKS) return "3주";
  return `${days}일`;
}

/**
 * 설정 한 벌을 가리키는 이름. 커리큘럼이 나뉘지 않으면 버전만, 나뉘면 `2주 · 무경력자` 처럼
 * 둘을 잇는다 — 나뉘지 않는 챌린지에 뜻 없는 `구분 없음` 을 한 번 더 붙이지 않는다.
 */
export function settingLabel(curriculumDays: number, version: ProgramVersion): string {
  const versionLabel = PROGRAM_VERSION_LABELS[version];

  return curriculumDays === CURRICULUM_NONE
    ? versionLabel
    : `${curriculumLabel(curriculumDays)} · ${versionLabel}`;
}

/** 드롭다운에 이름으로 서는 커리큘럼인지. 아니면 직접 입력 칸에 일수가 선다. */
export function isPresetCurriculum(days: number): boolean {
  return (PRESET_CURRICULUM_DAYS as readonly number[]).includes(days);
}

/** 0(구분 없음)부터 상한까지의 정수. 화면과 서버가 같은 잣대를 본다. */
export function isCurriculumDays(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_CURRICULUM_DAYS;
}

/**
 * 기수의 커리큘럼을 화면에 적을 거리. 개설 목록과 운영 캘린더가 같은 것을 보도록 한 곳에 둔다
 * (plan.md §5 — 두 화면을 오가며 맞춰보지 않게).
 *
 * `label` 은 기수에 고른 커리큘럼 이름이다. 구분 없음 설정 챌린지에서도 고른 것은 표기로 남는다.
 * `issue` 는 사람이 채워야 할 것만 서고 settingsForProgram 의 사유를 그대로 따른다 — 구분 없음
 * 챌린지의 미지정은 할 일이 아니라서 아무것도 서지 않는다.
 */
export type ProgramCurriculumNote = {
  label: string | null;
  issue: ProgramSettingsPick<unknown>["unresolved"];
};

export function programCurriculumNote(
  settings: { curriculumDays: number }[],
  programCurriculumDays: number | null,
): ProgramCurriculumNote {
  return {
    label: programCurriculumDays === null ? null : curriculumLabel(programCurriculumDays),
    issue: settingsForProgram(settings, programCurriculumDays).unresolved,
  };
}

/** 표기를 한 마디로. `2주` · `커리큘럼 미지정` · `2주 설정 없음`, 적을 것이 없으면 `null`. */
export function curriculumNoteText(note: ProgramCurriculumNote): string | null {
  if (note.issue === "UNASSIGNED") return "커리큘럼 미지정";
  if (note.issue === "MISSING") return `${note.label} 설정 없음`;
  return note.label;
}

/**
 * 한 기수에 적용되는 설정을 고른 결과.
 *
 * 설정이 비어도 까닭이 다르다. 챌린지에 아직 설정이 없는 것(`null`)과, 커리큘럼이 나뉘는데
 * 기수가 고르지 않은 것(`UNASSIGNED`), 고른 커리큘럼의 설정이 그 뒤 지워진 것(`MISSING`)은
 * 사람이 손볼 자리가 달라 사유로 가른다.
 */
export type ProgramSettingsPick<T> = {
  settings: T[];
  unresolved: "UNASSIGNED" | "MISSING" | null;
};

/**
 * 기수가 따르는 설정들. 캘린더와 안내문 예약이 같은 잣대로 보도록 한 곳에 둔다.
 *
 * 나뉘지 않는 챌린지(`0` 설정이 있다)는 기수의 커리큘럼과 상관없이 그 설정들이다. 나뉘는
 * 챌린지는 기수가 고른 커리큘럼의 설정들뿐이고, 고르지 않았으면 **없음**이다 — 틀린 커리큘럼으로
 * 날짜를 계산해 안내문이 나가는 것보다 비어 있는 편이 낫다(plan.md §5). 버전 순서는 들어온
 * 차례를 그대로 지킨다.
 */
export function settingsForProgram<T extends { curriculumDays: number }>(
  settings: T[],
  programCurriculumDays: number | null,
): ProgramSettingsPick<T> {
  const common = settings.filter((setting) => setting.curriculumDays === CURRICULUM_NONE);
  if (common.length > 0 || settings.length === 0) {
    return { settings: common, unresolved: null };
  }

  if (programCurriculumDays === null) return { settings: [], unresolved: "UNASSIGNED" };

  const picked = settings.filter(
    (setting) => setting.curriculumDays === programCurriculumDays,
  );

  return picked.length > 0
    ? { settings: picked, unresolved: null }
    : { settings: [], unresolved: "MISSING" };
}

/**
 * 개설 수정 폼이 보낸 커리큘럼을 기수 값으로 읽는다. 빈 값은 미지정이다.
 *
 * 챌린지의 설정에 묶지 않는다. 설정보다 먼저 고를 수 있어야, 설정이 하나도 없는 동안에도
 * 어디서부터 채울지 보인다(plan.md §5). 고른 커리큘럼의 설정이 없으면 `설정 없음` 으로 드러난다.
 * `0`(구분 없음)은 설정의 값이지 기수가 고르는 값이 아니라 받지 않는다.
 */
export function parseProgramCurriculum(
  raw: string,
): { ok: true; value: number | null } | { ok: false; message: string } {
  const text = raw.trim();
  if (!text) return { ok: true, value: null };

  const days = Number(text);
  if (!isCurriculumDays(days) || days === CURRICULUM_NONE) {
    return {
      ok: false,
      message: `커리큘럼은 1 이상 ${MAX_CURRICULUM_DAYS} 이하의 일수여야 합니다.`,
    };
  }

  return { ok: true, value: days };
}

/** 표에 그려질 한 줄. 아직 안 적은 버전도 자리를 잡아 무엇이 비었는지 드러난다. */
export type SettingSlot<T> = {
  curriculumDays: number;
  version: ProgramVersion;
  setting: T | null;
};

/**
 * 저장된 설정과 아직 비어 있는 버전을 같은 모양의 줄로 편다. 커리큘럼마다 따로 본다.
 *
 * 설정이 없는 챌린지는 `구분 없음 · 구분 없음` 한 줄이다. 한 커리큘럼 안에서 `구분 없음` 버전이
 * 있으면 그 한 줄, 없으면 무경력자 · 경력자 두 줄을 세운다 — 한쪽만 적어둔 상태에서 빠진 버전이
 * 눈에 띄어야 채울 수 있다.
 */
export function settingSlots<
  T extends { curriculumDays: number; version: ProgramVersion },
>(settings: T[]): SettingSlot<T>[] {
  if (settings.length === 0) {
    return [{ curriculumDays: CURRICULUM_NONE, version: "COMMON", setting: null }];
  }

  const curricula = [...new Set(settings.map((setting) => setting.curriculumDays))].sort(
    (a, b) => a - b,
  );

  return curricula.flatMap((curriculumDays): SettingSlot<T>[] => {
    const group = settings.filter((setting) => setting.curriculumDays === curriculumDays);
    const common = group.find((setting) => setting.version === "COMMON");
    if (common) return [{ curriculumDays, version: "COMMON", setting: common }];

    return (["ENTRY", "EXPERIENCED"] as const).map((version) => ({
      curriculumDays,
      version,
      setting: group.find((setting) => setting.version === version) ?? null,
    }));
  });
}

/**
 * 챌린지 이름이 너무 길면 목록과 드롭다운이 무너진다. 화면과 서버가 같은 값을 본다.
 * 이름 관리가 이 화면 몫이라 규칙도 여기 둔다(plan.md §5).
 */
export const MAX_CHALLENGE_NAME_LENGTH = 60;

/** 한 해를 넘기는 기수는 없다. 오타로 들어온 큰 수를 여기서 막는다. */
export const MAX_DURATION_DAYS = 365;
export const MAX_MISSION_COUNT = 52;
export const MAX_MISSION_DURATION_DAYS = 365;
export const MAX_FEEDBACK_DAYS = 30;

/**
 * 피드백은 대개 이 사이에서 끝난다. 벗어나도 저장은 되고 화면에만 눈에 띈다 —
 * 오타는 대부분 여기서 잡히지만, 길게 잡는 구성 자체가 없지는 않기 때문이다.
 */
export const TYPICAL_FEEDBACK_DAYS_MIN = 1;
export const TYPICAL_FEEDBACK_DAYS_MAX = 4;

/** 미션 개수를 바꿨을 때 채울 기본 일수. 직전 미션과 같은 길이가 대개 맞다. */
export const DEFAULT_MISSION_DURATION_DAYS = 7;

/** 피드백 종류를 처음 고를 때 채워 둘 일수. 적어둔 앞 피드백이 없을 때만 쓴다. */
export const DEFAULT_FEEDBACK_DAYS = 2;

export function totalMissionDays(missions: MissionPlan[]): number {
  return missions.reduce((sum, mission) => sum + mission.durationDays, 0);
}

/** 미션에 실제로 적어둔 피드백들. 순서는 미션 순서를 그대로 따른다. */
export function plannedFeedbacks(missions: MissionPlan[]): MissionFeedback[] {
  return missions
    .map((mission) => mission.feedback)
    .filter((feedback): feedback is MissionFeedback => feedback !== null);
}

/** 종류별 몇 회인지. 목록에서 "서면 2 · 라이브 1" 로 요약할 때 쓴다. */
export function countFeedbackKinds(
  missions: MissionPlan[],
): Record<FeedbackKind, number> {
  const counts: Record<FeedbackKind, number> = { WRITTEN: 0, LIVE: 0 };

  for (const feedback of plannedFeedbacks(missions)) {
    counts[feedback.kind] += 1;
  }

  return counts;
}

/**
 * 프로그램이 열려 있는 기간을 정하는 마지막 피드백의 일수.
 *
 * 피드백은 미션이 끝난 뒤에 붙으므로, 수행기간이 끝난 뒤까지 남는 것은 마지막으로
 * 피드백이 달린 미션의 것 하나다. 중간 미션의 피드백은 다음 미션과 나란히 돌아
 * 전체 기간을 늘리지 않는다. 피드백이 하나도 없으면 0 이다.
 */
export function trailingFeedbackDays(missions: MissionPlan[]): number {
  const feedbacks = plannedFeedbacks(missions);

  return feedbacks.length === 0 ? 0 : feedbacks[feedbacks.length - 1].days;
}

/**
 * 프로그램이 열려 있는 전체 기간. 수행기간이 끝나도 마지막 미션의 피드백이 남아 있으므로
 * 수행기간 + 마지막 피드백 일수다. 적어둔 값에서 바로 나오므로 따로 저장하지 않는다.
 */
export function totalProgramDays(setting: ProgramSettingValues): number {
  return setting.durationDays + trailingFeedbackDays(setting.missions);
}

/**
 * 저장을 막지는 않지만 사람이 한 번 봐야 하는 것들.
 *
 * 미션이 겹쳐 도는 구성도, 피드백을 아직 안 적어둔 구성도 실제로 있다.
 * 그래서 규칙으로 못 박지 않고 눈에만 띄게 한다.
 */
export function settingWarnings(setting: ProgramSettingValues): string[] {
  const warnings: string[] = [];
  const missionDays = totalMissionDays(setting.missions);

  if (missionDays > setting.durationDays) {
    warnings.push(
      `미션 일수 합계가 ${missionDays}일로 수행기간 ${setting.durationDays}일을 넘습니다. 미션이 겹쳐 진행되는 구성인지 확인하세요.`,
    );
  }

  // 어느 미션이 벗어났는지까지 말해야 고칠 자리를 찾을 수 있다.
  for (const mission of setting.missions) {
    const days = mission.feedback?.days;
    if (days === undefined) continue;
    if (days >= TYPICAL_FEEDBACK_DAYS_MIN && days <= TYPICAL_FEEDBACK_DAYS_MAX) continue;

    warnings.push(
      `미션 ${mission.seq}의 피드백이 ${days}일입니다. 피드백은 보통 ${TYPICAL_FEEDBACK_DAYS_MIN}~${TYPICAL_FEEDBACK_DAYS_MAX}일 진행됩니다.`,
    );
  }

  return warnings;
}
