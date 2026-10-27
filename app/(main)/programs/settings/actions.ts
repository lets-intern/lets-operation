"use server";

import { revalidatePath } from "next/cache";

import {
  deleteChallengeSetting,
  saveChallengeSetting,
  type SaveChallengeSettingResult,
} from "@/domain/challenge-setting";
import {
  createChallenge,
  deleteChallenge,
  isMoveDirection,
  moveChallenge,
  renameChallenge,
} from "@/domain/challenge";
import {
  CURRICULUM_NONE,
  curriculumLabel,
  isCurriculumDays,
  isFeedbackKind,
  isProgramVersion,
  MAX_CHALLENGE_NAME_LENGTH,
  MAX_CURRICULUM_DAYS,
  MAX_DURATION_DAYS,
  MAX_FEEDBACK_DAYS,
  MAX_MISSION_COUNT,
  MAX_MISSION_DURATION_DAYS,
  PROGRAM_VERSION_LABELS,
  type MissionFeedback,
  type MissionPlan,
  type ProgramSetting,
} from "@/domain/program-setting";

/**
 * 접근 차단은 proxy.ts 가 모든 경로에서 처리한다. 서버 액션도 페이지 경로로 POST 되므로
 * 같은 검사를 거친다(plan.md §7 — 계정 분리 없음 + 접근 차단 있음).
 */

/** "use server" 파일은 async 함수만 내보낼 수 있어 초기값 상수는 폼 쪽에 둔다. */
export type SaveState = {
  error: string | null;
  /** 성공했을 때만 채워진다. 무엇을 저장했는지 알리는 근거가 된다. */
  saved: { challengeId: string; at: number } | null;
};

export type RemoveState = { error: string | null };

export type ChallengeState = {
  error: string | null;
  /** 성공했을 때만 채워진다. 폼을 비우고 결과를 알리는 근거가 된다. */
  added: { challengeId: string; name: string } | null;
};

export type MoveState = { error: string | null };

export type RenameState = {
  error: string | null;
  /** 저장에 성공하면 줄을 보기 상태로 되돌리는 신호가 된다. */
  saved: boolean;
};

const PATH = "/programs/settings";
const LAUNCH_PATH = "/programs/new";

export async function saveSetting(
  _prevState: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const challengeId = String(formData.get("challengeId") ?? "");
  if (!challengeId) return { error: "챌린지를 선택하세요.", saved: null };

  const parsed = parseSettingForm(formData);
  if (!parsed.ok) return { error: parsed.message, saved: null };

  try {
    const result = await saveChallengeSetting({ challengeId, setting: parsed.value });

    if (!result.ok) {
      return { error: conflictMessage(result), saved: null };
    }

    revalidatePath(PATH);

    return { error: null, saved: { challengeId, at: Date.now() } };
  } catch (error) {
    if (hasPrismaCode(error, "P2003") || hasPrismaCode(error, "P2025")) {
      return { error: "이미 삭제된 챌린지입니다.", saved: null };
    }
    console.error("프로그램 설정 저장 실패", error);
    return { error: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", saved: null };
  }
}

export async function removeSetting(
  _prevState: RemoveState,
  formData: FormData,
): Promise<RemoveState> {
  const settingId = String(formData.get("settingId") ?? "");
  if (!settingId) return { error: "삭제할 설정을 찾지 못했습니다." };

  try {
    await deleteChallengeSetting(settingId);

    revalidatePath(PATH);

    return { error: null };
  } catch (error) {
    if (hasPrismaCode(error, "P2025")) {
      return { error: "이미 삭제된 설정입니다." };
    }
    console.error("프로그램 설정 삭제 실패", error);
    return { error: "삭제하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

/**
 * 챌린지를 드롭다운 목록에서 지운다. 잘못 적은 이름을 되돌리는 길이다.
 * 기수가 남아 있으면 데이터베이스가 막으므로, 그 뜻을 사람 말로 옮겨 돌려준다.
 */
export async function removeChallenge(
  _prevState: RemoveState,
  formData: FormData,
): Promise<RemoveState> {
  const challengeId = String(formData.get("challengeId") ?? "");
  if (!challengeId) return { error: "삭제할 챌린지를 찾지 못했습니다." };

  try {
    await deleteChallenge(challengeId);

    revalidateBothPaths();

    return { error: null };
  } catch (error) {
    if (hasPrismaCode(error, "P2003")) {
      return {
        error: "이 챌린지로 개설한 기수가 남아 있습니다. 프로그램 개설에서 먼저 지우세요.",
      };
    }
    if (hasPrismaCode(error, "P2025")) {
      return { error: "이미 삭제된 챌린지입니다." };
    }
    console.error("챌린지 삭제 실패", error);
    return { error: "삭제하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

/** 챌린지 이름 등록. 개설 드롭다운에 들어갈 이름은 여기서만 만든다(plan.md §5). */
export async function addChallenge(
  _prevState: ChallengeState,
  formData: FormData,
): Promise<ChallengeState> {
  const parsed = parseChallengeName(formData);
  if (!parsed.ok) return { error: parsed.message, added: null };

  try {
    const { challengeId } = await createChallenge(parsed.value);

    revalidateBothPaths();

    return { error: null, added: { challengeId, name: parsed.value } };
  } catch (error) {
    if (hasPrismaCode(error, "P2002")) {
      return { error: "이미 등록된 챌린지 이름입니다.", added: null };
    }
    console.error("챌린지 등록 실패", error);
    return { error: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", added: null };
  }
}

/** 표기만 고친다. 딸린 기수와 설정은 그대로 있어 기수가 있어도 막지 않는다. */
export async function editChallengeName(
  _prevState: RenameState,
  formData: FormData,
): Promise<RenameState> {
  const challengeId = String(formData.get("challengeId") ?? "");
  if (!challengeId) return { error: "수정할 챌린지를 찾지 못했습니다.", saved: false };

  const parsed = parseChallengeName(formData);
  if (!parsed.ok) return { error: parsed.message, saved: false };

  try {
    await renameChallenge(challengeId, parsed.value);

    revalidateBothPaths();

    return { error: null, saved: true };
  } catch (error) {
    if (hasPrismaCode(error, "P2002")) {
      return { error: "이미 등록된 챌린지 이름입니다.", saved: false };
    }
    if (hasPrismaCode(error, "P2025")) {
      return { error: "이미 삭제된 챌린지입니다.", saved: false };
    }
    console.error("챌린지 이름 수정 실패", error);
    return { error: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", saved: false };
  }
}

/**
 * 목록에서 한 칸 위·아래로 옮긴다. 정한 순서는 설정 목록과 개설 드롭다운이 함께 따른다.
 * 이미 끝이면 조용히 아무 일도 일어나지 않는다.
 */
export async function moveChallengeOrder(
  _prevState: MoveState,
  formData: FormData,
): Promise<MoveState> {
  const challengeId = String(formData.get("challengeId") ?? "");
  const direction = String(formData.get("direction") ?? "");

  if (!challengeId) return { error: "옮길 챌린지를 찾지 못했습니다." };
  if (!isMoveDirection(direction)) return { error: "옮길 방향을 알 수 없습니다." };

  try {
    const moved = await moveChallenge(challengeId, direction);
    if (!moved) return { error: "이미 삭제된 챌린지입니다." };

    revalidateBothPaths();

    return { error: null };
  } catch (error) {
    console.error("챌린지 순서 변경 실패", error);
    return { error: "옮기지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

type ParseResult =
  | { ok: true; value: ProgramSetting }
  | { ok: false; message: string };

/**
 * 미션 값은 `missionDurationDays` · `missionFeedbackKind` · `missionFeedbackDays` 로
 * 미션 개수만큼 나란히 실려 온다. 보낸 순서가 곧 미션 순서라 개수를 따로 받지 않는다.
 * 피드백이 없는 미션도 빈 값으로 자리를 채워 보내므로 세 줄의 길이가 같아야 한다 —
 * 어긋나면 어느 미션의 피드백인지 알 수 없으므로 저장하지 않는다.
 * 브라우저 검사(min/max)를 통과하지 못한 값도 여기서 한 번 더 막는다.
 */
function parseSettingForm(formData: FormData): ParseResult {
  // 구분 없음 · 1주 · 2주는 숨은 칸으로, 직접 입력은 일수 칸으로 같은 이름에 실려 온다.
  const curriculumDays = parseCount(formData.get("curriculumDays"));
  if (curriculumDays === null || !isCurriculumDays(curriculumDays)) {
    return invalid(
      `커리큘럼은 구분 없음이거나 1 이상 ${MAX_CURRICULUM_DAYS} 이하의 일수여야 합니다.`,
    );
  }

  const version = String(formData.get("version") ?? "");
  if (!isProgramVersion(version)) return invalid("버전을 선택하세요.");

  const durationDays = parseCount(formData.get("durationDays"));
  if (durationDays === null || durationDays < 1 || durationDays > MAX_DURATION_DAYS) {
    return invalid(`수행기간은 1 이상 ${MAX_DURATION_DAYS} 이하의 정수여야 합니다.`);
  }

  const rawMissions = formData.getAll("missionDurationDays");
  const rawKinds = formData.getAll("missionFeedbackKind");
  const rawFeedbackDays = formData.getAll("missionFeedbackDays");

  if (rawMissions.length < 1) return invalid("미션을 하나 이상 두세요.");
  if (rawMissions.length > MAX_MISSION_COUNT) {
    return invalid(`미션은 ${MAX_MISSION_COUNT}개까지 둘 수 있습니다.`);
  }
  if (
    rawKinds.length !== rawMissions.length ||
    rawFeedbackDays.length !== rawMissions.length
  ) {
    return invalid("미션과 피드백 값이 어긋났습니다. 새로고침 후 다시 시도해 주세요.");
  }

  const missions: MissionPlan[] = [];
  for (const [index, raw] of rawMissions.entries()) {
    const days = parseCount(raw);
    if (days === null || days < 1 || days > MAX_MISSION_DURATION_DAYS) {
      return invalid(
        `미션 ${index + 1}의 수행 기간은 1 이상 ${MAX_MISSION_DURATION_DAYS} 이하의 정수여야 합니다.`,
      );
    }

    const feedback = parseFeedback(rawKinds[index], rawFeedbackDays[index]);
    if (!feedback.ok) return invalid(`미션 ${index + 1}의 ${feedback.message}`);

    missions.push({ seq: index + 1, durationDays: days, feedback: feedback.value });
  }

  return { ok: true, value: { curriculumDays, version, durationDays, missions } };
}

type FeedbackResult =
  | { ok: true; value: MissionFeedback | null }
  | { ok: false; message: string };

/**
 * 한 미션의 피드백. 종류를 고르지 않았으면 피드백이 없는 미션이고, 그때 일수는 보지 않는다 —
 * 화면이 "없음" 으로 되돌려도 적어둔 일수를 지우지 않기 때문이다(mission-fields.ts).
 */
function parseFeedback(
  rawKind: FormDataEntryValue | undefined,
  rawDays: FormDataEntryValue | undefined,
): FeedbackResult {
  const kind = String(rawKind ?? "").trim();
  if (!kind) return { ok: true, value: null };
  if (!isFeedbackKind(kind)) return { ok: false, message: "피드백 종류를 알 수 없습니다." };

  const days = parseCount(rawDays ?? null);
  if (days === null || days < 1 || days > MAX_FEEDBACK_DAYS) {
    return {
      ok: false,
      message: `피드백 기간은 1 이상 ${MAX_FEEDBACK_DAYS} 이하의 정수여야 합니다.`,
    };
  }

  return { ok: true, value: { kind, days } };
}

/**
 * 한 챌린지는 커리큘럼 "구분 없음" 이거나 커리큘럼별이고, 한 커리큘럼은 버전 "구분 없음" 한 벌이거나
 * 버전별이다. 무엇이 걸렸는지와 어떻게 풀지를 함께 말해준다.
 */
function conflictMessage(
  result: Extract<SaveChallengeSettingResult, { ok: false }>,
): string {
  if (result.reason === "curriculum-conflict") {
    return result.existing === CURRICULUM_NONE
      ? "이 챌린지에는 커리큘럼 구분 없음 설정이 있습니다. 커리큘럼을 나누려면 그 설정을 먼저 지우세요."
      : `이 챌린지에는 ${curriculumLabel(result.existing)} 커리큘럼 설정이 있습니다. 커리큘럼 구분 없음으로 되돌리려면 커리큘럼별 설정을 먼저 지우세요.`;
  }

  const label = PROGRAM_VERSION_LABELS[result.existing];
  // 나뉘지 않는 챌린지에는 커리큘럼 이름을 붙이지 않는다. 예전 문구 그대로 읽힌다.
  const where =
    result.curriculumDays === CURRICULUM_NONE
      ? "이 챌린지에는"
      : `이 챌린지의 ${curriculumLabel(result.curriculumDays)} 커리큘럼에는`;

  return result.existing === "COMMON"
    ? `${where} ${label} 설정이 있습니다. 버전을 나누려면 그 설정을 먼저 지우세요.`
    : `${where} ${label} 설정이 있습니다. 구분 없음으로 되돌리려면 버전별 설정을 먼저 지우세요.`;
}

/** 빈 칸과 "3.5", "abc" 를 한꺼번에 걸러 낸다. */
function parseCount(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;

  const parsed = Number(text);
  return Number.isInteger(parsed) ? parsed : null;
}

function invalid(message: string): ParseResult {
  return { ok: false, message };
}

type NameResult = { ok: true; value: string } | { ok: false; message: string };

/** 등록과 이름 수정이 같은 칸을 쓰므로 검사도 한 곳이다. */
function parseChallengeName(formData: FormData): NameResult {
  const name = String(formData.get("challengeName") ?? "").trim();

  if (!name) return { ok: false, message: "챌린지 이름을 입력하세요." };
  if (name.length > MAX_CHALLENGE_NAME_LENGTH) {
    return {
      ok: false,
      message: `챌린지 이름은 ${MAX_CHALLENGE_NAME_LENGTH}자까지 쓸 수 있습니다.`,
    };
  }

  return { ok: true, value: name };
}

/** 챌린지 이름이 바뀌면 개설 폼의 드롭다운도 같은 목록을 쓰므로 함께 새로 읽게 한다. */
function revalidateBothPaths(): void {
  revalidatePath(PATH);
  revalidatePath(LAUNCH_PATH);
}

/** P2002 = 챌린지 이름 중복, P2003 = 관계 제약에 걸림, P2025 = 이미 사라진 레코드. */
function hasPrismaCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
