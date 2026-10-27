import type { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";

/**
 * Challenge 의 데이터 접근. 챌린지 이름의 등록·수정·삭제와 나열 순서는 모두
 * 프로그램 설정 화면에서 정한다. 마케팅팀 기획은 여기 등록된 이름과 맞아떨어질 때만
 * 기수로 세워진다(plan.md §5).
 */

/**
 * 목록에 나오는 차례. 사람이 정한 자리를 먼저 보고, 자리가 겹치면 이름으로 갈린다.
 * 설정 화면과 개설 드롭다운이 같은 순서를 쓰도록 한 곳에 둔다.
 */
export const CHALLENGE_ORDER: Prisma.ChallengeOrderByWithRelationInput[] = [
  { position: "asc" },
  { name: "asc" },
];

export type MoveDirection = "up" | "down";

export function isMoveDirection(value: string): value is MoveDirection {
  return value === "up" || value === "down";
}

export type ChallengeOption = {
  id: string;
  name: string;
};

export async function listChallengeOptions(): Promise<ChallengeOption[]> {
  return prisma.challenge.findMany({
    orderBy: CHALLENGE_ORDER,
    select: { id: true, name: true },
  });
}

/**
 * 마케팅팀 표기를 우리 챌린지에 잇는다. 저쪽 표기가 우리 것과 다를 때 쓰는 다리다.
 * 한 이름이 두 챌린지를 가리킬 수는 없어 같은 이름을 다시 넣으면 데이터베이스가 막는다(P2002).
 */
export async function createChallengeAlias(
  challengeId: string,
  name: string,
): Promise<void> {
  await prisma.challengeAlias.create({ data: { challengeId, name } });
}

/**
 * 이름은 하나뿐이다. 같은 이름을 다시 넣으면 데이터베이스가 막는다(P2002).
 * 새 챌린지는 맨 뒤에 붙는다. 이미 정해둔 순서가 흔들리지 않는다.
 */
export async function createChallenge(name: string): Promise<{ challengeId: string }> {
  return prisma.$transaction(async (tx) => {
    const last = await tx.challenge.findFirst({
      orderBy: { position: "desc" },
      select: { position: true },
    });

    const challenge = await tx.challenge.create({
      data: { name, position: (last?.position ?? -1) + 1 },
      select: { id: true },
    });

    return { challengeId: challenge.id };
  });
}

/**
 * 한 칸 위나 아래로 옮긴다. 옮긴 뒤 자리를 0 부터 다시 매겨, 값이 겹쳐 있었더라도
 * 이 참에 정리된다. 챌린지 수가 많지 않아 전부 다시 매기는 편이 확실하다.
 *
 * 이미 끝이면 아무 일도 하지 않는다. 목록에서 사라진 챌린지면 false 를 돌려준다.
 */
export async function moveChallenge(
  challengeId: string,
  direction: MoveDirection,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const challenges = await tx.challenge.findMany({
      orderBy: CHALLENGE_ORDER,
      select: { id: true, position: true },
    });

    const at = challenges.findIndex((challenge) => challenge.id === challengeId);
    if (at === -1) return false;

    const to = direction === "up" ? at - 1 : at + 1;
    if (to < 0 || to >= challenges.length) return true;

    const moved = [...challenges];
    [moved[at], moved[to]] = [moved[to], moved[at]];

    for (const [index, challenge] of moved.entries()) {
      if (challenge.position === index) continue;
      await tx.challenge.update({
        where: { id: challenge.id },
        data: { position: index },
      });
    }

    return true;
  });
}

/**
 * 이름만 고친다. 딸린 기수와 설정은 그대로 있고 표기만 바뀐다.
 * 오타를 고치는 길이라 기수가 있어도 막지 않는다.
 */
export async function renameChallenge(
  challengeId: string,
  name: string,
): Promise<void> {
  await prisma.challenge.update({ where: { id: challengeId }, data: { name } });
}

/**
 * 챌린지를 목록에서 지운다. 이 챌린지로 개설한 기수가 하나라도 있으면
 * 데이터베이스가 거절한다(schema.prisma 의 Program.challenge onDelete: Restrict).
 * 이름을 지우는 김에 프로그램과 태스크가 딸려 사라지는 일을 막기 위해서다.
 * 설정은 함께 지워진다.
 */
export async function deleteChallenge(challengeId: string): Promise<void> {
  await prisma.challenge.delete({ where: { id: challengeId } });
}

/** 실서비스 구분을 이을 때 쓰는 한 줄. 아직 안 이었으면 serviceType 이 비어 있다. */
export type ChallengeServiceLink = {
  challengeId: string;
  challengeName: string;
  serviceType: number | null;
  /**
   * 이 연결에 걸려 있는 기수 번호. 최근 것부터. 개설한 적이 없는 챌린지는 비어 있다.
   * 개수가 아니라 번호를 들고 있어야 연결이 틀렸을 때 어느 기수가 확인되지 않는지 보인다.
   */
  cohorts: number[];
};

/**
 * 챌린지마다의 실서비스 연결 상태. 개설 화면이 그대로 보여준다.
 *
 * **기수가 없는 챌린지도 올린다.** 예전에는 기수가 선 챌린지만 보였다 — 대조할 태스크가
 * 없는 줄을 올려 두면 해야 할 일처럼 보인다는 이유였다. 그런데 지난 운영을 되짚게 되면서
 * (domain/service-history) 그 조건이 닭과 달걀이 됐다. 되짚기는 이어둔 구분으로만 기수를
 * 세우는데, 이을 자리는 기수가 있어야 나타난다. 마케팅팀 기획에 없는 계열(대기업 자기소개서·
 * 마케팅·HR·PM)이 정확히 그 자리에 갇혀, 실서비스에서 돌고 있는데도 영영 되짚이지 않았다.
 *
 * 실서비스에서 되짚어 온 기수는 `개설 기수` 에서 뺀다. 저쪽 목록에서 그대로 옮겨온 기수라
 * 대조할 것이 없는데, 번호를 함께 세워두면 확인되지 않는 기수처럼 읽힌다.
 */
export async function listChallengeServiceLinks(): Promise<ChallengeServiceLink[]> {
  const challenges = await prisma.challenge.findMany({
    orderBy: CHALLENGE_ORDER,
    select: {
      id: true,
      name: true,
      serviceType: true,
      programs: {
        where: { serviceImportedAt: null },
        select: { cohort: true },
        orderBy: { cohort: "desc" },
      },
    },
  });

  return challenges.map((challenge) => ({
    challengeId: challenge.id,
    challengeName: challenge.name,
    serviceType: challenge.serviceType,
    cohorts: challenge.programs.map((program) => program.cohort),
  }));
}

/** 실서비스 구분을 잇거나 끊는다. 여러 챌린지가 같은 구분을 가리켜도 된다. */
export async function setChallengeServiceType(
  challengeId: string,
  serviceType: number | null,
): Promise<void> {
  await prisma.challenge.update({
    where: { id: challengeId },
    data: { serviceType },
  });
}

/** 챌린지 id → 실서비스 구분. 대조할 때 줄마다 다시 묻지 않도록 한 번에 모아 둔다. */
export async function serviceTypeByChallenge(): Promise<Map<string, number>> {
  const challenges = await prisma.challenge.findMany({
    where: { serviceType: { not: null } },
    select: { id: true, serviceType: true },
  });

  return new Map(
    challenges.map((challenge) => [challenge.id, challenge.serviceType as number]),
  );
}
