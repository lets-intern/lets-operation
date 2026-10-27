import { fetchRedashResult, type RedashRow } from "@/lib/redash";

import { serviceTypeByChallenge } from "./challenge";
import { isDateOnly, type DateOnly } from "./date";
import {
  applyDetailOpenEvidence,
  completeSeenDetailOpenTasks,
  listDetailOpenTargets,
  type DetailOpenMatch,
  type DetailOpenTarget,
} from "./detail-open";
import {
  parseProgramTitle,
  programTitleBody,
  programVersionOfTitle,
} from "./program-launch";
import type { ProgramVersion } from "./program-setting";

/**
 * 실서비스에 실제로 열려 있는 프로그램 목록. Redash 쿼리 결과를 우리 말로 옮긴다.
 *
 * 대조는 `구분 + 시작일 + 갈래` 로 한다. 기수 번호로 맞추면 안 된다 — 마케팅팀과 실서비스가
 * 기수를 따로 세서, `이력서 완성 챌린지 24기` 가 실서비스의 `취준 기필코 시작 챌린지 24기`
 * 같은 엉뚱한 줄에 걸린다. 되돌리지 않는 판정이라 그런 오탐은 그대로 남는다.
 *
 * 저쪽 쿼리는 결제 테이블을 안쪽 조인해서 **결제자가 없는 기수는 아예 나오지 않는다.**
 * 그래서 이 목록에 있다는 것은 상세페이지가 확실히 열렸다는 뜻이고(오탐 없음), 대신
 * 갓 열린 기수는 첫 결제가 들어올 때까지 늦게 잡힌다(늦을 수는 있음).
 */

/** 결과 컬럼 이름. 쿼리가 한글 별칭으로 내보내므로 여기 한 곳에 모아 둔다. */
const COLUMN = {
  serviceType: "구분",
  title: "프로그램",
  startDate: "시작일자",
  endDate: "종료일자",
  createdAt: "개설일자",
  total: "전체결제",
  basic: "베이직",
  standard: "스탠다드",
  premium: "프리미엄",
} as const;

/**
 * 한 줄에 붙은 참여 인원. 저쪽이 플랜별로 세어 둔 값을 그대로 받는다.
 *
 * 총원은 `전체결제` 다. 같은 줄의 `유료결제` 는 무료·쿠폰을 뺀 수라 플랜별 수의 합과
 * 맞지 않는다 — 합계와 내역이 어긋나 보이는 화면을 만들지 않으려고 합이 맞는 쪽을 쓴다.
 */
export type ProgramHeadcount = {
  total: number;
  basic: number;
  standard: number;
  premium: number;
};

export type ServiceProgram = {
  serviceType: number;
  title: string;
  startDate: DateOnly;
  /**
   * 저쪽이 적어둔 운영 종료일. 우리 `program` 에는 없던 값이라 지난 기수를 되짚을 때 쓴다.
   * 비어 있거나 날짜로 읽히지 않는 줄이 섞일 수 있어 없을 수도 있는 값으로 둔다.
   */
  endDate: DateOnly | null;
  version: ProgramVersion;
  /** 언제 열렸는지. 사람이 확인할 때 쓴다. */
  createdAt: string;
  /** 열린 날. 되짚은 기수의 상세페이지가 실제로 열린 하루가 이 값이다. */
  openDate: DateOnly | null;
  /** 이 줄에 붙은 참여 인원. 운영 현황이 읽는다. */
  headcount: ProgramHeadcount;
};

/**
 * 배포 테스트나 가이드용으로 만들어 둔 줄. 같은 시작일에 끼면 진짜 기수와 헷갈리므로
 * 아예 걷어낸다. `(구분, 시작일)` 이 겹친 4건이 전부 이런 줄이었다.
 */
const NOISE = /테스트|test|연습/i;

function toServiceProgram(row: RedashRow): ServiceProgram | null {
  const serviceType = Number(row[COLUMN.serviceType]);
  const title = String(row[COLUMN.title] ?? "").trim();
  // "2026-09-21 11:00:00" 으로 오므로 날짜만 뗀다. 우리 시작일은 시각을 갖지 않는다.
  const startDate = String(row[COLUMN.startDate] ?? "").slice(0, 10);
  const createdAt = String(row[COLUMN.createdAt] ?? "");

  if (!Number.isInteger(serviceType)) return null;
  if (title.length === 0 || NOISE.test(title)) return null;
  if (!isDateOnly(startDate)) return null;

  return {
    serviceType,
    title,
    startDate,
    endDate: dateOnlyOf(row[COLUMN.endDate]),
    version: programVersionOfTitle(title),
    createdAt,
    openDate: dateOnlyOf(createdAt),
    headcount: {
      total: countOf(row[COLUMN.total]),
      basic: countOf(row[COLUMN.basic]),
      standard: countOf(row[COLUMN.standard]),
      premium: countOf(row[COLUMN.premium]),
    },
  };
}

/**
 * 인원 한 칸. 아무도 없는 플랜은 0 으로 오지만, 컬럼이 통째로 빠지거나 빈 칸으로 오는
 * 경우까지 0 으로 둔다. 세어보지 못한 것과 0 명을 가르는 일이 이 화면에는 없다.
 */
function countOf(value: string | number | null | undefined): number {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? count : 0;
}

/** 시각이 붙은 값에서 날짜만. 비어 있거나 날짜로 읽히지 않으면 없는 것으로 둔다. */
function dateOnlyOf(value: string | number | null | undefined): DateOnly | null {
  const date = String(value ?? "").slice(0, 10);
  return isDateOnly(date) ? date : null;
}

export type ServiceProgramList = {
  programs: ServiceProgram[];
  /** 저쪽에서 쿼리가 돌아간 시각. 결과가 얼마나 묵었는지 화면에 알린다. */
  retrievedAt: Date;
};

export async function listServicePrograms(
  options: { fresh?: boolean } = {},
): Promise<ServiceProgramList> {
  const { rows, retrievedAt } = await fetchRedashResult(options);

  const programs: ServiceProgram[] = [];
  for (const row of rows) {
    const program = toServiceProgram(row);
    if (program) programs.push(program);
  }

  return { programs, retrievedAt };
}

/**
 * 실서비스 제목이 우리 챌린지의 것인지 본다.
 *
 * 구분 코드가 계열 하나만 담는다는 전제가 실제로는 지켜지지 않아 필요해진 걸러내기다.
 * 실서비스는 새 계열의 첫 기수를 기존 코드에 얹었다가 나중에 전용 코드로 옮기고
 * (`HR 직무 서류 완성 올인원 챌린지` 1기는 구분 4, 2기부터 구분 10), 세미나 참가자용
 * 사본은 아예 남의 코드로 연다(`[Live 세미나 전용] 마케팅 서류 완성 올인원 챌린지` 가 구분 1).
 * 그런 줄은 구분·시작일·갈래가 우연히 맞아떨어지면 그대로 완료로 찍힌다.
 *
 * 대조는 **이름의 첫 낱말**만 본다. 낱말을 전부 맞추면 실서비스 표기가 흔들릴 때 정탐을
 * 통째로 놓친다 — 우리 `자기소개서 1주 완성 챌린지` 를 저쪽은 `자기소개서 2주 완성 챌린지`
 * 로 적고 있어, 지난 34줄 중 9줄만 남는다. 첫 낱말은 계열이 바뀌지 않는 한 그대로다.
 *
 * 지난 기수를 되짚을 때도 같은 잣대를 쓴다(domain/service-history). 상세페이지 확인과
 * 되짚기가 서로 다른 기준으로 남의 프로그램을 걸러내면 두 화면이 어긋난다.
 */
export function isSameChallenge(challengeName: string, title: string): boolean {
  const head = compactName(challengeName.split(/\s+/)[0] ?? "");
  if (head.length === 0) return false;

  return compactName(programTitleBody(title)).includes(head);
}

/** 사이 기호와 대소문자 때문에 어긋나지 않도록 글자만 남긴다. */
function compactName(value: string): string {
  return value.toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
}

/**
 * 우리 기수와 실서비스 줄을 맞춘다.
 *
 * 한 자리에 두 줄 이상이 걸리면 맞추지 않고 그대로 둔다. 같은 구분·같은 시작일에 제휴
 * 프로그램이 끼는 경우가 실제로 있어, 애매한 것을 골라잡으면 되돌릴 수 없는 완료가 잘못 찍힌다.
 */
export type DetailOpenMatchResult = {
  matches: DetailOpenMatch[];
  /** 실서비스 구분이 아직 이어지지 않아 대조하지 못한 태스크 */
  unlinked: DetailOpenTarget[];
  /** 두 줄 이상이 걸려 사람이 봐야 하는 태스크 */
  ambiguous: DetailOpenTarget[];
  /** 자리는 맞는데 이름이 다른 줄만 걸려 넘긴 태스크. 연결이 틀렸다는 신호다. */
  mismatched: DetailOpenTarget[];
};

export function matchDetailOpen(
  targets: DetailOpenTarget[],
  programs: ServiceProgram[],
  serviceTypeByChallenge: Map<string, number>,
): DetailOpenMatchResult {
  const result: DetailOpenMatchResult = {
    matches: [],
    unlinked: [],
    ambiguous: [],
    mismatched: [],
  };

  for (const target of targets) {
    const serviceType = serviceTypeByChallenge.get(target.challengeId);
    if (serviceType === undefined) {
      result.unlinked.push(target);
      continue;
    }

    const sameSlot = programs.filter(
      (program) =>
        program.serviceType === serviceType &&
        program.startDate === target.startDate &&
        program.version === target.version,
    );
    const found = sameSlot.filter((program) =>
      isSameChallenge(target.challengeName, program.title),
    );

    // 자리는 맞는데 이름이 하나도 통하지 않으면 조용히 넘기지 않는다. 연결한 구분이
    // 틀렸거나 저쪽 표기가 계열째 바뀐 것이라 사람이 봐야 한다.
    if (found.length === 0 && sameSlot.length > 0) {
      result.mismatched.push(target);
      continue;
    }

    if (found.length === 0) continue;
    if (found.length > 1) {
      result.ambiguous.push(target);
      continue;
    }

    result.matches.push({ taskId: target.taskId, ref: serviceRef(found[0]) });
  }

  return result;
}

/**
 * 무엇을 보고 정했는지 되짚을 수 있는 표시. 쿼리에 challenge_id 가 없어 사람이 알아볼 수 있는
 * 제목과 시작일로 대신한다. 저쪽 쿼리에 id 가 생기면 그 값으로 바꾸면 된다.
 */
function serviceRef(program: ServiceProgram): string {
  return `${program.title} · ${program.startDate}`;
}

/** 구분을 고를 때 보여줄 보기. 코드만으로는 어느 계열인지 알 수 없다. */
export type ServiceTypeOption = {
  serviceType: number;
  /** 그 구분에서 많이 열린 프로그램 이름 몇 개. 사람이 알아보는 단서다. */
  samples: string[];
};

const MAX_SAMPLES = 3;

/**
 * 구분마다 대표 이름을 모은다.
 *
 * 기수가 붙은 제목만 본다. 기수가 도는 프로그램이라야 그 구분이 무엇인지 알려주고,
 * `가이드 문서용 챌린지` 처럼 한 번 만들고 만 줄은 계열을 흐린다.
 *
 * 많이 열린 이름부터 고르고, 두 번 넘게 열린 이름이 있으면 그것만 쓴다. 최근 것부터
 * 세면 어쩌다 한 번 낀 줄이 그대로 대표가 된다 — 이력서 자리(구분 1)에 `마케팅 서류 완성
 * 올인원 챌린지` 가, 인적성 자리(구분 4)에 `Lets Run 4주 스터디` 가 뜨던 것이 그랬다.
 * 앞은 세미나 참가자용 사본이고 뒤는 전용 구분이 생기기 전의 첫 기수인데, 마침 최근에
 * 열렸다는 것 말고는 그 자리와 아무 상관이 없다.
 *
 * 기수가 붙었다는 것만으로는 부족했다. 구분 4 처럼 실서비스가 멤버십·제휴 과정을 함께
 * 담아 둔 자리에는 한 번 열리고 만 줄이 잔뜩이라, 건수가 1 로 죄다 동점이 되어 결국
 * 최근순으로 되돌아간다. 두 기수 넘게 돈 이름이라야 그 구분이 무엇인지 말해 준다.
 *
 * 기수가 붙은 제목이 하나도 없는 구분은 가장 최근 제목을 그대로 쓴다. 이름이 없는 것보다
 * 낫고, 그런 구분은 우리 챌린지와 이어질 일도 거의 없다.
 */
export function listServiceTypeOptions(
  programs: ServiceProgram[],
): ServiceTypeOption[] {
  const recent = [...programs].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );

  const countsByType = new Map<number, Map<string, number>>();
  const fallbackByType = new Map<number, string>();

  for (const program of recent) {
    if (!fallbackByType.has(program.serviceType)) {
      fallbackByType.set(program.serviceType, program.title);
    }

    // 기수와 갈래를 뗀 이름이 계열을 가장 잘 드러낸다.
    const name = parseProgramTitle(program.title)?.challengeName;
    if (!name) continue;

    const counts = countsByType.get(program.serviceType) ?? new Map();
    counts.set(name, (counts.get(name) ?? 0) + 1);
    countsByType.set(program.serviceType, counts);
  }

  return [...fallbackByType.entries()]
    .map(([serviceType, fallback]) => ({
      serviceType,
      samples: topNames(countsByType.get(serviceType)) ?? [fallback],
    }))
    .sort((a, b) => a.serviceType - b.serviceType);
}

/**
 * 건수가 많은 이름부터. 건수가 같으면 최근에 열린 쪽이 앞선다(counts 가 최근 순이다).
 *
 * 두 기수 넘게 돈 이름이 하나라도 있으면 그것만 쓰고, 하나도 없으면 있는 대로 쓴다.
 * 계열이 드러나지 않는 자리라도 이름을 아예 비우는 것보다는 낫다.
 */
function topNames(counts: Map<string, number> | undefined): string[] | null {
  if (!counts || counts.size === 0) return null;

  const sorted = [...counts.entries()].sort(([, a], [, b]) => b - a);
  const repeated = sorted.filter(([, count]) => count > 1);

  return (repeated.length > 0 ? repeated : sorted)
    .slice(0, MAX_SAMPLES)
    .map(([name]) => name);
}

/**
 * 확인 한 번. 실서비스 목록을 읽어 우리 태스크와 맞추고 그 결과를 남긴다.
 *
 * `complete` 가 꺼져 있으면 확인만 쌓는다(관찰 단계). 판정이 실제로 맞아떨어지는 것을
 * 눈으로 본 뒤에 켜는 것이 안전하다 — 완료는 되돌리지 않기 때문이다.
 */
export type DetailOpenCheckResult = {
  /** 저쪽 쿼리가 돌아간 시각. 결과가 묵었으면 여기서 드러난다. */
  retrievedAt: Date;
  /** 이번에 대조한 태스크 수 */
  checked: number;
  /** 열린 것으로 확인된 태스크 */
  seen: number;
  /** 그중 완료까지 올린 태스크. 관찰 단계에서는 0 이다. */
  completed: number;
  /** 실서비스 구분이 이어지지 않아 대조하지 못한 태스크 */
  unlinked: number;
  /** 두 줄 이상이 걸려 사람이 봐야 하는 태스크 */
  ambiguous: number;
  /** 자리는 맞는데 이름이 달라 넘긴 태스크. 이어 둔 구분이 틀렸을 수 있다. */
  mismatched: number;
};

export async function runDetailOpenCheck(
  options: { complete: boolean; fresh?: boolean },
): Promise<DetailOpenCheckResult> {
  // 관찰 단계에 확인만 해 둔 태스크를 먼저 올린다. 스위치를 켠 첫 회차에서만 실제로 걸린다.
  const carried = options.complete ? await completeSeenDetailOpenTasks() : 0;

  const targets = await listDetailOpenTargets();
  const { programs, retrievedAt } = await listServicePrograms({
    fresh: options.fresh,
  });
  const links = await serviceTypeByChallenge();

  const matched = matchDetailOpen(targets, programs, links);
  const applied = await applyDetailOpenEvidence(matched.matches, {
    complete: options.complete,
  });

  return {
    retrievedAt,
    checked: targets.length,
    seen: applied.seen,
    completed: applied.completed + carried,
    unlinked: matched.unlinked.length,
    ambiguous: matched.ambiguous.length,
    mismatched: matched.mismatched.length,
  };
}

/** 자동 완료를 켤지. 판정이 맞는 것을 확인하기 전에는 꺼 두고 확인만 쌓는다. */
export function detailOpenAutoComplete(): boolean {
  return process.env.DETAIL_OPEN_AUTO_COMPLETE === "true";
}
