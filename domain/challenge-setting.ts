import { prisma } from "@/lib/prisma";

import { CHALLENGE_ORDER } from "./challenge";
import {
  CURRICULUM_NONE,
  type FeedbackKind,
  type MissionPlan,
  type ProgramSetting,
  type ProgramVersion,
} from "./program-setting";

/**
 * ChallengeSetting / ChallengeMission 의 데이터 접근. 화면은 이 파일을 통해서만 DB 에 닿는다(plan.md §7).
 */

/** 저장된 설정. 지울 때 필요한 식별자를 함께 들고 있다. */
export type SavedSetting = ProgramSetting & {
  settingId: string;
  /**
   * 이 설정을 따르는 기수 수. 지우기 전에 무엇이 기준을 잃는지 알려준다. 커리큘럼 구분 없음
   * 설정은 챌린지의 모든 기수가, 커리큘럼별 설정은 그 커리큘럼을 고른 기수만 따른다.
   */
  programCount: number;
};

export type ChallengeSettingRow = {
  challengeId: string;
  challengeName: string;
  /** 이 설정을 따르는 기수 수. 값을 고칠 때 무엇이 함께 움직이는지 알려준다. */
  programCount: number;
  /**
   * 커리큘럼 → 버전 순. 커리큘럼마다 나뉘지 않으면 한 벌, 나뉘면 두 벌.
   * 아직 안 적었으면 비어 있다.
   */
  settings: SavedSetting[];
};

export type SaveChallengeSettingInput = {
  challengeId: string;
  setting: ProgramSetting;
};

export type SaveChallengeSettingResult =
  | { ok: true }
  /** 한 챌린지 안에서 커리큘럼 "구분 없음" 과 커리큘럼별 설정이 섞이려 한 경우. */
  | { ok: false; reason: "curriculum-conflict"; existing: number }
  /** 같은 커리큘럼 안에서 "구분 없음" 과 버전별 설정이 섞이려 한 경우. */
  | {
      ok: false;
      reason: "version-conflict";
      curriculumDays: number;
      existing: ProgramVersion;
    };

/**
 * 설정 여부와 상관없이 모든 챌린지를 돌려준다. 아직 안 적은 챌린지가 화면에서 그대로 드러나야
 * 무엇이 비었는지 보인다. 챌린지 자체는 프로그램 설정의 이름 관리에서 만든다.
 */
export async function listChallengeSettings(): Promise<ChallengeSettingRow[]> {
  const challenges = await prisma.challenge.findMany({
    orderBy: CHALLENGE_ORDER,
    select: {
      id: true,
      name: true,
      _count: { select: { programs: true } },
      settings: {
        // 짧은 커리큘럼부터, 그 안에서는 열거형 정의 순서(COMMON · ENTRY · EXPERIENCED).
        // 화면 순서가 곧 이 순서다.
        orderBy: [{ curriculumDays: "asc" }, { version: "asc" }],
        select: {
          id: true,
          curriculumDays: true,
          version: true,
          durationDays: true,
          missions: {
            orderBy: { seq: "asc" },
            select: {
              seq: true,
              durationDays: true,
              feedbackKind: true,
              feedbackDays: true,
            },
          },
        },
      },
    },
  });

  // 커리큘럼별 설정이 몇 기수의 기준인지 세려고 챌린지 · 커리큘럼마다 기수를 센다.
  const counts = await prisma.program.groupBy({
    by: ["challengeId", "curriculumDays"],
    _count: { _all: true },
  });
  const countOf = (challengeId: string, curriculumDays: number) =>
    counts.find(
      (row) => row.challengeId === challengeId && row.curriculumDays === curriculumDays,
    )?._count._all ?? 0;

  return challenges.map((challenge) => ({
    challengeId: challenge.id,
    challengeName: challenge.name,
    programCount: challenge._count.programs,
    settings: challenge.settings.map((setting) => ({
      settingId: setting.id,
      programCount:
        setting.curriculumDays === CURRICULUM_NONE
          ? challenge._count.programs
          : countOf(challenge.id, setting.curriculumDays),
      curriculumDays: setting.curriculumDays,
      version: setting.version,
      durationDays: setting.durationDays,
      missions: setting.missions.map(toMissionPlan),
    })),
  }));
}

/**
 * 챌린지 + 커리큘럼 + 버전 하나당 설정도 하나뿐이라 등록과 수정이 같은 동작이다(upsert).
 * 미션은 순서가 곧 정체성이라 지웠다 다시 넣는다. 3개를 2개로 줄일 때 남는 줄이 없다.
 */
export async function saveChallengeSetting(
  input: SaveChallengeSettingInput,
): Promise<SaveChallengeSettingResult> {
  const { challengeId, setting } = input;
  const { curriculumDays, version } = setting;

  const values = { durationDays: setting.durationDays };

  return prisma.$transaction(async (tx) => {
    // 한 챌린지는 커리큘럼 "구분 없음" 이거나 커리큘럼별이거나 둘 중 하나다.
    // 섞이면 어느 기수가 어느 설정을 따르는지 흐려진다.
    const curriculumConflict = await tx.challengeSetting.findFirst({
      where: {
        challengeId,
        curriculumDays:
          curriculumDays === CURRICULUM_NONE ? { not: CURRICULUM_NONE } : CURRICULUM_NONE,
      },
      select: { curriculumDays: true },
    });

    if (curriculumConflict) {
      return {
        ok: false as const,
        reason: "curriculum-conflict" as const,
        existing: curriculumConflict.curriculumDays,
      };
    }

    // 버전 규칙은 커리큘럼마다 따로 본다. 1주는 구분 없이, 2주는 버전별로 두는 구성도 있다.
    const versionConflict = await tx.challengeSetting.findFirst({
      where: {
        challengeId,
        curriculumDays,
        version: version === "COMMON" ? { not: "COMMON" } : "COMMON",
      },
      select: { version: true },
    });

    if (versionConflict) {
      return {
        ok: false as const,
        reason: "version-conflict" as const,
        curriculumDays,
        existing: versionConflict.version,
      };
    }

    const saved = await tx.challengeSetting.upsert({
      where: {
        challengeId_curriculumDays_version: { challengeId, curriculumDays, version },
      },
      create: { challengeId, curriculumDays, version, ...values },
      update: values,
      select: { id: true },
    });

    await tx.challengeMission.deleteMany({ where: { settingId: saved.id } });
    await tx.challengeMission.createMany({
      data: setting.missions.map((mission) => ({
        settingId: saved.id,
        seq: mission.seq,
        durationDays: mission.durationDays,
        // 종류와 일수는 함께 있거나 함께 비어 있다. 피드백 없는 미션은 두 칸 다 빈다.
        feedbackKind: mission.feedback?.kind ?? null,
        feedbackDays: mission.feedback?.days ?? null,
      })),
    });

    return { ok: true as const };
  });
}

/** 미션은 설정과 함께 지워진다(schema.prisma 의 onDelete: Cascade). 챌린지는 남는다. */
export async function deleteChallengeSetting(settingId: string): Promise<void> {
  await prisma.challengeSetting.delete({ where: { id: settingId } });
}

function toMissionPlan(mission: {
  seq: number;
  durationDays: number;
  feedbackKind: FeedbackKind | null;
  feedbackDays: number | null;
}): MissionPlan {
  return {
    seq: mission.seq,
    durationDays: mission.durationDays,
    // 한쪽만 남는 경우는 저장 쪽에서 막지만, 읽는 쪽도 짝이 맞을 때만 피드백으로 본다.
    feedback:
      mission.feedbackKind !== null && mission.feedbackDays !== null
        ? { kind: mission.feedbackKind, days: mission.feedbackDays }
        : null,
  };
}
