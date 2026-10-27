import { prisma } from "@/lib/prisma";

import { toDate, toDateOnly, type DateOnly } from "./date";
import { detailOpenTargetFor, parseProgramTitle } from "./program-launch";
import {
  isSameChallenge,
  listServicePrograms,
  type ServiceProgram,
} from "./service-program";

/**
 * 실서비스에서 이미 돈 기수를 되짚어 우리 기수로 세우는 일.
 *
 * 마케팅팀 기획에는 **앞으로 열 것**만 있어(domain/mkt-planned-program) 우리 화면은 개설
 * 이후만 안다. 그래서 운영 캘린더의 지난 달은 늘 비어 있었다. 무엇이 실제로 돌았는지는
 * 실서비스가 알고 있으므로 그쪽 목록(Redash 쿼리)을 읽어 기수로 세운다.
 *
 * 되짚는 시작점은 2026-08-15 다. 그 앞은 이 도구가 생기기 한참 전이라 되짚어도 운영에
 * 쓸 일이 없고, 목록만 길어져 지금 도는 것이 묻힌다.
 *
 * 개설로 세운 기수는 **절대 덮지 않는다.** 같은 자리(챌린지 + 기수)에 우리 기수가 이미
 * 있으면 그대로 두고 넘어간다. 저쪽과 우리가 기수를 따로 세는 경우가 있어, 자리가 겹쳤다는
 * 것만으로 같은 기수라고 단정하면 사람이 잡아둔 일정을 남의 날짜로 덮게 된다.
 *
 * 같은 이유로 **번호가 달라도 같은 날 시작하는 개설 기수가 있으면 새로 세우지 않는다.**
 * 쿼리가 결제 0건인 기수까지 내보내면서(2026-09-16) 앞으로 열 기수가 되짚기에 들어오게 됐고,
 * 번호만 보면 개설 기수 옆에 같은 기수가 하나 더 선다.
 */

/** 되짚기의 첫날. 이보다 앞서 시작한 기수는 가져오지 않는다. */
export const SERVICE_HISTORY_FROM: DateOnly = "2026-08-15";

export type ServiceHistoryResult = {
  from: DateOnly;
  /** 이번에 되짚어 새로 세운 기수 */
  imported: number;
  /** 이미 되짚어 둔 기수 중 저쪽 날짜가 달라져 고친 것 */
  refreshed: number;
  /** 같은 자리나 같은 시작일에 개설로 세운 기수가 이미 있어 손대지 않은 것 */
  kept: number;
  /** 우리 챌린지로 잇지 못해 넘긴 실서비스 줄. 제휴·멤버십처럼 우리 것이 아닌 줄이 여기 든다. */
  skipped: number;
  /** 저쪽 쿼리가 돌아간 시각. 결과가 얼마나 묵었는지 드러난다. */
  retrievedAt: Date;
};

/** 되짚어 세울 기수 하나. 갈래가 나뉜 두 줄이 여기서 한 기수로 모인다. */
type HistoryGroup = {
  challengeId: string;
  cohort: number;
  startDate: DateOnly;
  endDate: DateOnly | null;
  /** 상세페이지가 실제로 열린 날. 저쪽 개설일자가 그대로 온다. */
  openDate: DateOnly | null;
};

/** 실서비스 구분에 이어져 있는 챌린지 하나. 구분 하나에 여럿이 걸릴 수 있다. */
type LinkedChallenge = { id: string; name: string; serviceType: number };

/**
 * 되짚기 한 번. 실서비스 목록을 읽어 우리 챌린지로 이어지는 줄만 기수로 세운다.
 *
 * 여러 번 불러도 결과가 같다. 이미 되짚어 둔 기수는 날짜만 저쪽에 맞추고, 개설로 세운
 * 기수는 건너뛴다.
 */
export async function importServiceHistory(
  options: { fresh?: boolean } = {},
): Promise<ServiceHistoryResult> {
  const { programs, retrievedAt } = await listServicePrograms(options);
  const challenges = await listLinkedChallenges();

  const groups = new Map<string, HistoryGroup>();
  let skipped = 0;

  for (const program of programs) {
    if (program.startDate < SERVICE_HISTORY_FROM) continue;

    const group = groupOf(program, challenges);
    if (!group) {
      skipped += 1;
      continue;
    }

    merge(groups, group);
  }

  let imported = 0;
  let refreshed = 0;
  let kept = 0;

  for (const group of groups.values()) {
    const outcome = await save(group);
    if (outcome === "IMPORTED") imported += 1;
    else if (outcome === "REFRESHED") refreshed += 1;
    else if (outcome === "KEPT") kept += 1;
  }

  return { from: SERVICE_HISTORY_FROM, imported, refreshed, kept, skipped, retrievedAt };
}

/** 실서비스 구분을 이어둔 챌린지만. 안 이은 챌린지는 저쪽 줄과 맞춰볼 열쇠가 없다. */
async function listLinkedChallenges(): Promise<LinkedChallenge[]> {
  const challenges = await prisma.challenge.findMany({
    where: { serviceType: { not: null } },
    select: { id: true, name: true, serviceType: true },
  });

  return challenges.map((challenge) => ({
    id: challenge.id,
    name: challenge.name,
    serviceType: challenge.serviceType as number,
  }));
}

/**
 * 실서비스 줄 하나를 우리 자리(챌린지 + 기수)로 옮긴다. 옮길 수 없으면 비운다.
 *
 * 넘기는 줄은 셋이다. 구분을 안 이은 챌린지의 줄, 제목에서 기수를 못 읽는 줄
 * (`[렛츠커리어] 마케팅 올인원 패스` 처럼 기수가 없는 상품), 그리고 구분은 맞는데 이름이
 * 우리 챌린지와 다른 줄이다. 마지막이 특히 중요하다 — 실서비스는 구분 하나에 멤버십과
 * 제휴 과정을 함께 담아 두어, 이름을 안 보면 `렛츠커리어 2026년 하반기 멤버십` 이
 * 인적성 기수로 서 버린다.
 *
 * 이름이 두 챌린지에 걸리는 줄도 넘긴다. 골라잡으면 엉뚱한 챌린지에 남의 기수가 선다.
 */
function groupOf(
  program: ServiceProgram,
  challenges: LinkedChallenge[],
): HistoryGroup | null {
  const parsed = parseProgramTitle(program.title);
  if (!parsed) return null;

  const found = challenges.filter(
    (challenge) =>
      challenge.serviceType === program.serviceType &&
      isSameChallenge(challenge.name, program.title),
  );
  if (found.length !== 1) return null;

  return {
    challengeId: found[0].id,
    cohort: parsed.cohort,
    startDate: program.startDate,
    endDate: program.endDate,
    openDate: program.openDate,
  };
}

/**
 * 갈래가 나뉜 기수는 저쪽에서 두 줄로 온다. 기수는 갈래를 갖지 않으므로(plan.md §5)
 * 한 자리에 모으고, 날짜는 **가장 넓게** 잡는다 — 먼저 열어 늦게 끝나는 쪽이 그 기수의
 * 운영 기간이다.
 */
function merge(groups: Map<string, HistoryGroup>, group: HistoryGroup): void {
  const key = `${group.challengeId}:${group.cohort}`;
  const found = groups.get(key);

  if (!found) {
    groups.set(key, group);
    return;
  }

  found.startDate =
    group.startDate < found.startDate ? group.startDate : found.startDate;
  found.endDate = later(found.endDate, group.endDate);
  found.openDate = earlier(found.openDate, group.openDate);
}

/** 한쪽이 비면 있는 쪽을 쓴다. 갈래 하나만 날짜가 없다고 기수 전체를 모르는 것으로 두지 않는다. */
function earlier(a: DateOnly | null, b: DateOnly | null): DateOnly | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}

function later(a: DateOnly | null, b: DateOnly | null): DateOnly | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

type SaveOutcome = "IMPORTED" | "REFRESHED" | "KEPT" | "SAME";

/**
 * 되짚은 기수 하나를 저장한다.
 *
 * 상세페이지 오픈 태스크는 만들지 않는다. 이미 열려서 돌기까지 한 페이지라 열어야 할 일이
 * 없는데, 만들어 두면 업무 캘린더에 지난 날짜의 `할 일` 로 남아 밀린 일처럼 보인다.
 *
 * 오픈 목표일 자리에는 저쪽 **개설일자**를 넣는다. 목표가 아니라 실제로 열린 날이지만,
 * 캘린더에서 그 하루에 개설 표식이 찍혀 "언제 열어 언제 시작했는지"가 한 줄로 읽힌다.
 * 개설일자가 비면 우리 규칙(시작 2주 전)으로 채워 자리만 지킨다.
 */
async function save(group: HistoryGroup): Promise<SaveOutcome> {
  const detailOpenTargetDate = group.openDate ?? detailOpenTargetFor(group.startDate);

  const existing = await prisma.program.findUnique({
    where: {
      challengeId_cohort: {
        challengeId: group.challengeId,
        cohort: group.cohort,
      },
    },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      detailOpenTargetDate: true,
      serviceImportedAt: true,
    },
  });

  if (!existing) {
    // 기수 번호가 비어 있어도 같은 날 시작하는 개설 기수가 있으면 같은 기수다. 마케팅팀과
    // 실서비스가 기수를 따로 세어 번호로는 겹침이 안 보인다(우리 `자기소개서 25기` 가 저쪽
    // `35기`). 상세페이지 확인이 시작일로 맞추는 것과 같은 잣대다.
    const launched = await prisma.program.findFirst({
      where: {
        challengeId: group.challengeId,
        startDate: toDate(group.startDate),
        serviceImportedAt: null,
      },
      select: { id: true },
    });
    if (launched) return "KEPT";

    await prisma.program.create({
      data: {
        challengeId: group.challengeId,
        cohort: group.cohort,
        startDate: toDate(group.startDate),
        endDate: group.endDate === null ? null : toDate(group.endDate),
        detailOpenTargetDate: toDate(detailOpenTargetDate),
        serviceImportedAt: new Date(),
      },
    });

    return "IMPORTED";
  }

  // 개설로 세운 기수다. 저쪽 날짜로 덮지 않는다.
  if (existing.serviceImportedAt === null) return "KEPT";

  const same =
    toDateOnly(existing.startDate) === group.startDate &&
    (existing.endDate === null ? null : toDateOnly(existing.endDate)) ===
      group.endDate &&
    toDateOnly(existing.detailOpenTargetDate) === detailOpenTargetDate;

  if (same) return "SAME";

  await prisma.program.update({
    where: { id: existing.id },
    data: {
      startDate: toDate(group.startDate),
      endDate: group.endDate === null ? null : toDate(group.endDate),
      detailOpenTargetDate: toDate(detailOpenTargetDate),
    },
  });

  return "REFRESHED";
}
