import { prisma } from "@/lib/prisma";

import { toDateOnly, type DateOnly } from "./date";
import {
  DETAIL_OPEN_TASK_TITLE,
  detailOpenTaskVersion,
  type TaskStatus,
} from "./program-launch";
import type { ProgramVersion } from "./program-setting";

/**
 * 상세페이지가 실제로 열렸는지를 실서비스에서 확인해 태스크에 반영하는 일.
 *
 * 확인(detailOpenSeenAt)과 자동 완료(autoDoneAt)를 나눠 둔다. 판정이 맞는지 아직 모르는
 * 동안에는 확인만 쌓아 목록에 보여주고, 실제로 맞아떨어지는 것을 눈으로 본 뒤에 완료까지
 * 올린다. 되돌리지 않기로 한 판정이라 한 번 잘못 켜지면 그대로 남기 때문이다.
 *
 * 완료는 한 방향으로만 움직인다. 실서비스에서 그 기수가 사라져도 우리 완료는 그대로 두고,
 * 사람이 되돌려 둔 태스크는 다시 자동으로 완료하지 않는다.
 */

/** 아직 열렸는지 확인되지 않은 상세페이지 오픈 태스크 하나. */
export type DetailOpenTarget = {
  taskId: string;
  programId: string;
  challengeId: string;
  challengeName: string;
  cohort: number;
  version: ProgramVersion;
  /** 실서비스 행과 맞춰볼 열쇠. 기수 번호는 저쪽과 어긋나므로 시작일로 맞춘다. */
  startDate: DateOnly;
  status: TaskStatus;
};

/** 열린 것으로 확인된 태스크. ref 는 근거가 된 운영DB 의 challenge_id 다. */
export type DetailOpenMatch = {
  taskId: string;
  ref: string;
};

export type DetailOpenApplyResult = {
  /** 이번에 처음 열린 것으로 확인된 태스크 */
  seen: number;
  /** 그중 자동으로 완료까지 올린 태스크. 관찰 단계에서는 늘 0 이다. */
  completed: number;
};

/**
 * 아직 확인되지 않은 상세페이지 오픈 태스크. 이미 확인된 태스크는 다시 묻지 않는다.
 *
 * 사람이 이미 완료해 둔 태스크도 대상에 넣는다. 상태를 건드리지는 않지만, 언제 열린 것으로
 * 잡히는지를 함께 기록해 두면 사람이 완료한 시점과 얼마나 벌어지는지 알 수 있다.
 */
export async function listDetailOpenTargets(): Promise<DetailOpenTarget[]> {
  const tasks = await prisma.task.findMany({
    where: {
      kind: "MILESTONE",
      title: { startsWith: DETAIL_OPEN_TASK_TITLE },
      detailOpenSeenAt: null,
    },
    select: {
      id: true,
      title: true,
      status: true,
      programId: true,
      program: {
        select: {
          challengeId: true,
          cohort: true,
          startDate: true,
          challenge: { select: { name: true } },
        },
      },
    },
  });

  const targets: DetailOpenTarget[] = [];

  for (const task of tasks) {
    // 우리가 짓지 않은 이름이 섞여 있으면 갈래를 알 수 없다. 그런 줄은 대조하지 않는다.
    const version = detailOpenTaskVersion(task.title);
    if (!version) continue;

    targets.push({
      taskId: task.id,
      programId: task.programId,
      challengeId: task.program.challengeId,
      challengeName: task.program.challenge.name,
      cohort: task.program.cohort,
      version,
      startDate: toDateOnly(task.program.startDate),
      status: task.status,
    });
  }

  return targets;
}

/**
 * 확인 결과를 태스크에 남긴다. `complete` 가 켜져 있을 때만 완료까지 올린다.
 *
 * 완료로 올리는 것은 아직 완료가 아니고 자동 판정을 받은 적도 없는 태스크뿐이다.
 * 사람이 되돌려 둔 태스크에는 autoDoneAt 이 남아 있어 두 번 다시 올라가지 않는다.
 */
export async function applyDetailOpenEvidence(
  matches: DetailOpenMatch[],
  options: { complete: boolean },
): Promise<DetailOpenApplyResult> {
  if (matches.length === 0) return { seen: 0, completed: 0 };

  const seenAt = new Date();

  return prisma.$transaction(async (tx) => {
    for (const match of matches) {
      await tx.task.update({
        where: { id: match.taskId },
        data: { detailOpenSeenAt: seenAt, detailOpenRef: match.ref },
      });
    }

    if (!options.complete) return { seen: matches.length, completed: 0 };

    const completed = await tx.task.updateMany({
      where: {
        id: { in: matches.map((match) => match.taskId) },
        status: { not: "DONE" },
        autoDoneAt: null,
      },
      data: { status: "DONE", autoDoneAt: seenAt },
    });

    return { seen: matches.length, completed: completed.count };
  });
}

/**
 * 열린 것으로 이미 확인해 두었지만 아직 완료가 아닌 태스크를 마저 올린다.
 *
 * 관찰 단계에서는 확인만 쌓인다. 자동 완료를 켠 순간 그때까지 확인해 둔 것들도 완료가 되어야
 * 하는데, 확인이 끝난 태스크는 다시 묻지 않으려고 대조 대상에서 빼 두었으므로 그냥 두면
 * 영영 올라가지 않는다. 스위치를 켠 첫 회차에 한 번 훑어 그 간극을 메운다.
 *
 * 자동 판정을 이미 받은 태스크(autoDoneAt)는 건드리지 않는다. 사람이 되돌려 둔 것이라
 * 다시 올리면 그 판단을 덮는다.
 */
export async function completeSeenDetailOpenTasks(): Promise<number> {
  const completed = await prisma.task.updateMany({
    where: {
      kind: "MILESTONE",
      title: { startsWith: DETAIL_OPEN_TASK_TITLE },
      detailOpenSeenAt: { not: null },
      status: { not: "DONE" },
      autoDoneAt: null,
    },
    data: { status: "DONE", autoDoneAt: new Date() },
  });

  return completed.count;
}
