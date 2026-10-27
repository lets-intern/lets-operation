import { serviceTypeByChallenge } from "./challenge";
import type { DateOnly } from "./date";
import { phaseOf, type ProgramPeriod } from "./program-calendar";
import { PROGRAM_VERSIONS, type ProgramVersion } from "./program-setting";
import {
  isSameChallenge,
  listServicePrograms,
  type ProgramHeadcount,
  type ServiceProgram,
} from "./service-program";

/**
 * 지금 도는 기수의 참여 인원. 운영 캘린더 옆에 놓이는 **운영 현황**이 읽는다.
 *
 * 무엇이 도는지는 **우리 캘린더가 정한다**(phaseOf). 저쪽 쿼리에도 `현황` 칸이 있지만
 * 그쪽은 멤버십·올인원 패스처럼 기수가 아닌 상품까지 진행 중으로 세고, 모집과 운영을
 * 저쪽 기준으로 가른다. 같은 화면의 캘린더가 운영 중이라 칠한 막대와 목록이 어긋나면
 * 둘 중 어느 쪽이 맞는지를 사람이 매번 따져야 한다.
 *
 * 인원은 반대로 **저쪽만 안다**. 결제는 실서비스에서 일어나고 우리 DB 에는 흔적이 없다.
 * 그래서 우리 기수에 저쪽 줄을 맞춰 붙인다.
 *
 * 갈래가 나뉜 기수는 저쪽에서 두 줄로 오고, 여기서도 두 줄로 둔다. 합쳐 놓으면 어느
 * 갈래가 덜 찼는지가 묻히는데, 모집을 더 밀지 말지는 갈래마다 따로 정하는 일이다.
 */

/** 목록 한 줄. 실서비스 줄 하나가 그대로 한 줄이 된다. */
export type ProgramStatusRow = {
  key: string;
  challengeName: string;
  cohort: number;
  startDate: DateOnly;
  endDate: DateOnly | null;
  /** 이 줄이 어느 갈래인지. 나뉘지 않는 챌린지는 `COMMON` 이다. */
  version: ProgramVersion;
  /** 맞는 실서비스 줄을 못 찾으면 비어 있다. 0 명과 구분해야 해서 없는 값으로 둔다. */
  headcount: ProgramHeadcount | null;
};

export type ProgramStatusBoard = {
  rows: ProgramStatusRow[];
  /** 저쪽 쿼리가 돌아간 시각. 인원이 얼마나 묵은 값인지 드러난다. */
  retrievedAt: Date | null;
  /** 저쪽을 읽지 못한 사유. 읽었으면 비어 있다. */
  unavailable: string | null;
};

/**
 * 운영 중인 기수에 실서비스 인원을 붙인다.
 *
 * 캘린더가 이미 읽어 둔 기간 목록을 그대로 받는다. 같은 화면이 같은 자료로 같은 판단을
 * 하도록 하려는 것이고, 한 페이지에서 기수 목록을 두 번 읽지 않기 위한 것이기도 하다.
 *
 * 저쪽이 막혀도 사유만 안고 돌아간다. 프로그램 운영 화면은 실서비스와 무관하게 쓸 수
 * 있어야 한다 — 인원 한 칸 때문에 캘린더까지 못 보게 되는 쪽이 나쁘다.
 */
export async function loadProgramStatus(
  periods: ProgramPeriod[],
  today: DateOnly,
): Promise<ProgramStatusBoard> {
  const running = periods.filter((period) => phaseOf(period, today) === "RUNNING");
  if (running.length === 0) {
    return { rows: [], retrievedAt: null, unavailable: null };
  }

  let programs: ServiceProgram[];
  let retrievedAt: Date;

  try {
    const result = await listServicePrograms();
    programs = result.programs;
    retrievedAt = result.retrievedAt;
  } catch (error) {
    console.error("실서비스 인원을 읽지 못했습니다", error);
    return {
      rows: running.map(emptyRow),
      retrievedAt: null,
      unavailable: "실서비스 인원을 읽지 못했습니다",
    };
  }

  const links = await serviceTypeByChallenge();
  const rows: ProgramStatusRow[] = [];

  for (const period of running) {
    const matched = matchService(period, programs, links);

    // 이을 구분이 없거나 저쪽에 줄이 아직 없는 기수다. 목록에서 빼지는 않는다 —
    // 도는 기수가 화면에서 사라지면 인원이 0 인 것인지 안 잡힌 것인지 알 수 없다.
    if (matched.length === 0) {
      rows.push(emptyRow(period));
      continue;
    }

    matched.forEach((program, index) => {
      rows.push({
        key: `${period.programId}:${index}`,
        challengeName: period.challengeName,
        cohort: period.cohort,
        startDate: period.startDate,
        endDate: period.endDate,
        version: program.version,
        headcount: program.headcount,
      });
    });
  }

  return { rows, retrievedAt, unavailable: null };
}

/** 인원을 못 붙인 줄. 기수 자체는 우리가 아는 것이라 이름과 기간은 그대로 채운다. */
function emptyRow(period: ProgramPeriod): ProgramStatusRow {
  return {
    key: period.programId,
    challengeName: period.challengeName,
    cohort: period.cohort,
    startDate: period.startDate,
    endDate: period.endDate,
    version: "COMMON",
    headcount: null,
  };
}

/**
 * 우리 기수에 걸리는 실서비스 줄. 대조는 `구분 + 시작일 + 이름 첫 낱말` 로 한다.
 *
 * 기수 번호로 맞추지 않는다. 저쪽과 우리가 기수를 따로 세서(자기소개서는 실서비스 34기가
 * 우리 25기다) 번호로 맞추면 남의 기수의 인원이 붙는다. 이름을 함께 보는 이유도 같다 —
 * 구분 하나에 멤버십과 제휴 과정이 섞여 있어, 구분과 시작일만으로는 엉뚱한 줄이 걸린다
 * (domain/service-program 의 isSameChallenge 가 쓰는 잣대를 그대로 쓴다).
 *
 * 갈래 차례로 돌려준다. 무경력자와 경력자가 늘 같은 자리에 놓여야 두 줄을 눈으로 견준다.
 */
function matchService(
  period: ProgramPeriod,
  programs: ServiceProgram[],
  links: Map<string, number>,
): ServiceProgram[] {
  const serviceType = links.get(period.challengeId);
  if (serviceType === undefined) return [];

  return programs
    .filter(
      (program) =>
        program.serviceType === serviceType &&
        program.startDate === period.startDate &&
        isSameChallenge(period.challengeName, program.title),
    )
    .sort(
      (a, b) =>
        PROGRAM_VERSIONS.indexOf(a.version) - PROGRAM_VERSIONS.indexOf(b.version),
    );
}
