"use server";

import { revalidatePath } from "next/cache";

import {
  createChallengeAlias,
  setChallengeServiceType,
} from "@/domain/challenge";
import { isDateOnly, type DateOnly } from "@/domain/date";
import {
  openPendingMktPrograms,
  syncMktPlannedPrograms,
  type MktSyncResult,
} from "@/domain/mkt-planned-program";
import {
  deleteProgramLaunch,
  setTaskStatus,
  updateProgramLaunch,
} from "@/domain/program";
import {
  importServiceHistory,
  type ServiceHistoryResult,
} from "@/domain/service-history";
import {
  detailOpenAutoComplete,
  runDetailOpenCheck,
  type DetailOpenCheckResult,
} from "@/domain/service-program";
import { isTaskStatus, MAX_COHORT } from "@/domain/program-launch";
import { parseProgramCurriculum } from "@/domain/program-setting";

/**
 * 접근 차단은 proxy.ts 가 모든 경로에서 처리한다. 서버 액션도 페이지 경로로 POST 되므로
 * 같은 검사를 거친다(plan.md §7 — 계정 분리 없음 + 접근 차단 있음).
 */

export type EditState = {
  error: string | null;
  /** 저장에 성공하면 줄을 보기 상태로 되돌리는 신호가 된다. */
  saved: boolean;
};

export type DeleteState = { error: string | null };

export type AliasState = {
  error: string | null;
  /** 이어준 뒤 몇 기수가 섰는지. 0 이면 다른 사유가 남아 있다는 뜻이다. */
  opened: number | null;
};

export type SyncState = {
  error: string | null;
  /** 성공했을 때만 채워진다. 무엇이 달라졌는지 알리는 근거가 된다. */
  result: MktSyncResult | null;
  /** 실서비스 확인 결과. 저쪽이 막혀 있으면 비어 있다. */
  detailOpen: DetailOpenCheckResult | null;
  /** 지난 운영 되짚기 결과. 저쪽이 막혀 있으면 비어 있다. */
  history: ServiceHistoryResult | null;
};

const PATH = "/programs/new";

/**
 * 마케팅팀 기획을 지금 가져온다. 크론이 부르는 /api/sync/mkt-planned-programs 와 같은 일이라
 * 로직은 도메인 한 곳에 있고 여기서는 화면에 돌려줄 말만 고른다.
 */
/**
 * 마케팅팀 표기를 우리 챌린지에 잇고, 곧바로 개설까지 다시 시도한다.
 * 사유를 없앤 사람이 결과를 그 자리에서 보게 하려는 것이다 — 다음 가져오기를 기다리지 않는다.
 */
export async function linkAlias(
  _prevState: AliasState,
  formData: FormData,
): Promise<AliasState> {
  const challengeId = String(formData.get("challengeId") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  if (!challengeId) return { error: "이을 챌린지를 고르세요.", opened: null };
  if (!name) return { error: "이을 이름을 찾지 못했습니다.", opened: null };

  try {
    await createChallengeAlias(challengeId, name);
    const { opened } = await openPendingMktPrograms();

    revalidatePath(PATH);

    return { error: null, opened };
  } catch (error) {
    if (hasPrismaCode(error, "P2002")) {
      return { error: "이미 다른 챌린지에 이어진 이름입니다.", opened: null };
    }
    if (hasPrismaCode(error, "P2003")) {
      return { error: "이미 삭제된 챌린지입니다.", opened: null };
    }
    console.error("챌린지 별칭 연결 실패", error);
    return { error: "잇지 못했습니다. 잠시 후 다시 시도해 주세요.", opened: null };
  }
}

// 이전 상태도 폼 값도 쓰지 않는다. 누르면 그냥 한 번 가져온다.
export async function syncMkt(): Promise<SyncState> {
  try {
    const result = await syncMktPlannedPrograms();
    // 되짚기는 개설 뒤에. 같은 자리에 개설로 세운 기수가 있으면 되짚기가 물러난다.
    const history = await importHistory();
    // 사람이 눌렀을 때는 저쪽 결과를 새로 받는다. 몇 분 묵은 값을 보여주면 방금 연 것이 안 보인다.
    const detailOpen = await checkDetailOpen();

    revalidatePath(PATH);
    // 되짚은 기수는 운영 캘린더에 눕는다. 개설 화면만 새로 그리면 그쪽이 묵은 채로 남는다.
    revalidatePath("/programs");

    return { error: null, result, detailOpen, history };
  } catch (error) {
    console.error("마케팅 기획 가져오기 실패", error);
    return {
      error: "마케팅팀 데이터를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      result: null,
      detailOpen: null,
      history: null,
    };
  }
}

/** 실서비스가 막혀 있어도 마케팅 기획 가져오기까지 실패로 만들지 않는다. */
async function importHistory(): Promise<ServiceHistoryResult | null> {
  try {
    return await importServiceHistory({ fresh: true });
  } catch (error) {
    console.error("지난 운영 되짚기 실패", error);
    return null;
  }
}

/** 실서비스가 막혀 있어도 마케팅 기획 가져오기까지 실패로 만들지 않는다. */
async function checkDetailOpen(): Promise<DetailOpenCheckResult | null> {
  try {
    return await runDetailOpenCheck({
      complete: detailOpenAutoComplete(),
      fresh: true,
    });
  } catch (error) {
    console.error("상세페이지 오픈 확인 실패", error);
    return null;
  }
}

/** 목록에서 연 수정 폼이 보낸다. 가져온 일정을 사람이 고치는 유일한 길이다. */
export async function updateLaunch(
  _prevState: EditState,
  formData: FormData,
): Promise<EditState> {
  const programId = String(formData.get("programId") ?? "");
  if (!programId) return { error: "수정할 프로그램을 찾지 못했습니다.", saved: false };

  const parsed = parseLaunchForm(formData);
  if (!parsed.ok) return { error: parsed.message, saved: false };

  try {
    await updateProgramLaunch({
      programId,
      challengeId: parsed.value.challengeId,
      cohort: parsed.value.cohort,
      curriculumDays: parsed.value.curriculumDays,
      startDate: parsed.value.startDate,
      detailOpenTargetDate: parsed.value.detailOpenTargetDate,
    });

    revalidatePath(PATH);

    return { error: null, saved: true };
  } catch (error) {
    if (hasPrismaCode(error, "P2002")) {
      return { error: "이미 등록된 챌린지·기수 조합입니다.", saved: false };
    }
    if (hasPrismaCode(error, "P2025")) {
      return { error: "이미 삭제된 프로그램입니다.", saved: false };
    }
    console.error("프로그램 개설 수정 실패", error);
    return { error: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", saved: false };
  }
}

export async function deleteLaunch(
  _prevState: DeleteState,
  formData: FormData,
): Promise<DeleteState> {
  const programId = String(formData.get("programId") ?? "");
  if (!programId) return { error: "삭제할 프로그램을 찾지 못했습니다." };

  try {
    await deleteProgramLaunch(programId);

    revalidatePath(PATH);

    return { error: null };
  } catch (error) {
    if (hasPrismaCode(error, "P2025")) {
      return { error: "이미 삭제된 프로그램입니다." };
    }
    console.error("프로그램 삭제 실패", error);
    return { error: "삭제하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function changeDetailOpenStatus(formData: FormData): Promise<void> {
  const taskId = String(formData.get("taskId") ?? "");
  const status = String(formData.get("status") ?? "");

  if (!taskId || !isTaskStatus(status)) return;

  await setTaskStatus(taskId, status);
  revalidatePath(PATH);
}

type ParsedLaunch = {
  challengeId: string;
  cohort: number;
  curriculumDays: number | null;
  startDate: DateOnly;
  detailOpenTargetDate: DateOnly;
};

type ParseResult =
  | { ok: true; value: ParsedLaunch }
  | { ok: false; message: string };

/** 목록에서 여는 수정 폼의 입력 검사. 기수 자체는 마케팅 기획에서 오고 여기서는 손질만 받는다. */
function parseLaunchForm(formData: FormData): ParseResult {
  const challengeId = String(formData.get("challengeId") ?? "");
  const cohortInput = String(formData.get("cohort") ?? "").trim();
  const startDate = String(formData.get("startDate") ?? "");
  const detailOpenTargetDate = String(formData.get("detailOpenTargetDate") ?? "");

  if (!challengeId) return invalid("챌린지를 선택하세요.");

  const cohort = Number(cohortInput);
  if (!Number.isInteger(cohort) || cohort < 1 || cohort > MAX_COHORT) {
    return invalid(`기수는 1 이상 ${MAX_COHORT} 이하의 정수여야 합니다.`);
  }

  // 챌린지 설정에 묶지 않는다. 설정보다 먼저 고를 수 있다(domain/program-setting).
  const curriculum = parseProgramCurriculum(String(formData.get("curriculumDays") ?? ""));
  if (!curriculum.ok) return invalid(curriculum.message);

  if (!isDateOnly(startDate)) return invalid("프로그램 시작일을 입력하세요.");
  if (!isDateOnly(detailOpenTargetDate)) return invalid("오픈 목표일을 입력하세요.");
  if (detailOpenTargetDate > startDate) {
    return invalid("오픈 목표일은 프로그램 시작일보다 뒤일 수 없습니다.");
  }

  return {
    ok: true,
    value: {
      challengeId,
      cohort,
      curriculumDays: curriculum.value,
      startDate,
      detailOpenTargetDate,
    },
  };
}

function invalid(message: string): ParseResult {
  return { ok: false, message };
}

/** P2002 = `챌린지 + 기수` 중복, P2003 = 없는 챌린지를 가리킴, P2025 = 이미 사라진 레코드. */
function hasPrismaCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

/**
 * 챌린지를 실서비스 구분에 잇는다. 이어야 그 챌린지의 기수가 자동 확인 대상이 된다.
 * 빈 값을 고르면 연결을 끊는다 — 잘못 이었을 때 되돌리는 길이다.
 */
export async function linkServiceType(formData: FormData): Promise<void> {
  const challengeId = String(formData.get("challengeId") ?? "");
  if (!challengeId) return;

  const raw = String(formData.get("serviceType") ?? "").trim();
  const serviceType = raw === "" ? null : Number(raw);
  if (serviceType !== null && !Number.isInteger(serviceType)) return;

  await setChallengeServiceType(challengeId, serviceType);
  revalidatePath(PATH);
}
