import { prisma } from "@/lib/prisma";

import { toDate, toDateOnly, type DateOnly } from "./date";
import type { ProgramMissionPlan, ProgramPeriod } from "./program-calendar";
import {
  DETAIL_OPEN_TASK_TITLE,
  detailOpenTaskTitle,
  detailOpenTaskVersion,
  type TaskStatus,
} from "./program-launch";
import {
  programCurriculumNote,
  PROGRAM_VERSIONS,
  settingsForProgram,
  type FeedbackKind,
  type ProgramCurriculumNote,
  type MissionPlan,
  type ProgramVersion,
} from "./program-setting";

/**
 * Program / Task 의 데이터 접근. 화면은 이 파일을 통해서만 DB 에 닿는다(plan.md §7).
 */

export type ProgramLaunch = {
  programId: string;
  challengeId: string;
  challengeName: string;
  cohort: number;
  /** 이 기수가 여는 커리큘럼(일수). 비어 있으면 미지정이다 — 가져온 기수는 비어서 선다. */
  curriculumDays: number | null;
  /** 목록에 적을 커리큘럼 표기. 운영 캘린더와 같은 규칙이다(programCurriculumNote). */
  curriculum: ProgramCurriculumNote;
  startDate: DateOnly;
  detailOpenTargetDate: DateOnly;
  /**
   * 상세페이지 오픈 태스크. 개설과 함께 만들어지므로 보통 비지 않는다.
   * 버전이 나뉘는 챌린지는 갈래마다 하나씩이라 두 줄이 된다(plan.md §5).
   */
  detailOpenTasks: DetailOpenTask[];
  /** 이 기수를 세운 마케팅 기획의 오픈 마감일. 손으로 만든 기수는 비어 있다. */
  mktOpenDeadline: DateOnly | null;
};

export type DetailOpenTask = {
  id: string;
  version: ProgramVersion;
  status: TaskStatus;
  /** 우리가 실서비스 확인을 근거로 완료로 올린 태스크인지. 사람이 올린 완료와 구분한다. */
  autoDone: boolean;
  /** 실서비스에서 열린 것으로 확인된 시각. 아직 완료로 올리기 전이어도 채워진다. */
  seenAt: Date | null;
};

export type UpdateProgramLaunchInput = {
  programId: string;
  challengeId: string;
  cohort: number;
  /** 미지정이면 `null`. 나뉘지 않는 챌린지도 `null` 이다. */
  curriculumDays: number | null;
  startDate: DateOnly;
  detailOpenTargetDate: DateOnly;
};

export type CreateProgramLaunchInput = {
  challengeId: string;
  cohort: number;
  startDate: DateOnly;
  detailOpenTargetDate: DateOnly;
  /** 이 기수가 도는 갈래. 갈래마다 상세페이지 오픈 태스크가 하나씩 생긴다. */
  versions: ProgramVersion[];
};

/**
 * 오픈 목표일이 급한 순. 개설 예정 목록이 그대로 쓴다.
 *
 * 목표일이 같으면 프로그램 설정에서 정한 챌린지 순서를 따른다. 목표일은 시작일 2주 전으로
 * 몰려 같은 날이 흔한데, 그때 설정 목록·개설 드롭다운과 같은 차례로 서야 눈이 익은 자리에서
 * 찾는다. 같은 챌린지끼리는 시작일 순이다.
 *
 * 실서비스에서 되짚어 온 기수는 뺀다. 이미 열려서 돌았던 기록이라 열어야 할 일이 없고,
 * 상세페이지 오픈 태스크도 갖지 않아 목록에 올라와야 빈 줄만 는다(domain/service-history).
 *
 * 운영을 시작한 기수도 뺀다(2026-10-18). 시작일이 오늘이거나 지났고 상세페이지가 모두
 * 열린 기수는 개설할 일이 끝났다 — 시작일 기준은 운영 캘린더의 `운영 중` 과 같고, 열렸는지는
 * isLaunched 가 정한다. **열지 못한 채 시작한 기수는 남긴다.** 업무 요청으로 개설이 번복된
 * 경우라 사람이 보고 직접 지운다.
 */
export async function listProgramLaunches(
  today: DateOnly,
): Promise<ProgramLaunch[]> {
  const programs = await prisma.program.findMany({
    where: { serviceImportedAt: null },
    orderBy: [
      { detailOpenTargetDate: "asc" },
      // CHALLENGE_ORDER 와 같은 차례(자리 → 이름)를 챌린지 관계를 거쳐 건다.
      { challenge: { position: "asc" } },
      { challenge: { name: "asc" } },
      { startDate: "asc" },
    ],
    select: {
      id: true,
      cohort: true,
      curriculumDays: true,
      startDate: true,
      detailOpenTargetDate: true,
      challengeId: true,
      challenge: {
        select: { name: true, settings: { select: { curriculumDays: true } } },
      },
      tasks: {
        where: { title: { startsWith: DETAIL_OPEN_TASK_TITLE } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          title: true,
          status: true,
          autoDoneAt: true,
          detailOpenSeenAt: true,
        },
      },
      // 버전이 나뉘면 두 줄이 한 기수를 가리키지만 마감일은 같다. 한 줄만 본다.
      mktPlans: { take: 1, select: { openDeadline: true } },
    },
  });

  const pending = programs.filter(
    (program) =>
      toDateOnly(program.startDate) > today ||
      !isLaunched(null, program.tasks),
  );

  return pending.map((program) => ({
    programId: program.id,
    challengeId: program.challengeId,
    challengeName: program.challenge.name,
    cohort: program.cohort,
    curriculumDays: program.curriculumDays,
    curriculum: programCurriculumNote(program.challenge.settings, program.curriculumDays),
    startDate: toDateOnly(program.startDate),
    detailOpenTargetDate: toDateOnly(program.detailOpenTargetDate),
    detailOpenTasks: toDetailOpenTasks(program.tasks),
    mktOpenDeadline: program.mktPlans[0]?.openDeadline
      ? toDateOnly(program.mktPlans[0].openDeadline)
      : null,
  }));
}

/**
 * 운영 캘린더가 쓰는 기간 목록. 개설에서 세운 기수와 실서비스에서 되짚어 온 기수가
 * 함께 캘린더의 막대가 된다(domain/service-history).
 *
 * 종료일은 두 곳에서 온다. 되짚은 기수는 실서비스가 적어둔 날을 제 컬럼에 들고 있고,
 * 개설로 세운 기수는 마케팅 기획의 종료일을 본다 — 우리 개설 화면에는 종료일을 적는 자리가
 * 아직 없다(plan.md §9 — 보류). 손으로 만든 기수와 저쪽이 안 채운 줄은 비어 돌아오고,
 * 그런 기수는 캘린더에서 끝을 열어둔다.
 *
 * 오픈 목표일은 늘 있다. 캘린더는 이 하루를 개설 표식으로 찍는다. 되짚은 기수에서는
 * 목표일이 아니라 실제로 열린 날이 그 자리에 들어 있다.
 *
 * 미션은 프로그램 설정에서 온다. 설정은 기수가 아니라 챌린지에 붙으므로(plan.md §5) 그
 * 챌린지에 적어둔 것을 읽어 온다. 아직 안 적은 챌린지는 비어 돌아온다. 커리큘럼이 나뉘는
 * 챌린지는 기수가 고른 커리큘럼의 것만 오고, 고르지 않은 기수는 비어 돌아온다 — 어림해서
 * 틀린 날짜를 그리지 않는다(settingsForProgram).
 *
 * 상세페이지를 열었는지도 함께 온다. 캘린더가 시작 전 기수를 `개설 예정` 과 `운영 예정`
 * 으로 가르는 값이라, 그 근거인 오픈 태스크를 여기서 같이 읽는다(isLaunched).
 */
export async function listProgramPeriods(): Promise<ProgramPeriod[]> {
  const programs = await prisma.program.findMany({
    orderBy: [{ startDate: "asc" }, { cohort: "asc" }],
    select: {
      id: true,
      challengeId: true,
      cohort: true,
      startDate: true,
      endDate: true,
      detailOpenTargetDate: true,
      serviceImportedAt: true,
      curriculumDays: true,
      challenge: {
        select: {
          name: true,
          settings: {
            orderBy: [{ curriculumDays: "asc" }, { version: "asc" }],
            select: {
              curriculumDays: true,
              version: true,
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
      },
      // 갈래가 나뉘면 두 줄이 한 기수를 가리킨다. 늦게 끝나는 쪽이 그 기수의 끝이다.
      mktPlans: { select: { endDate: true } },
      // 상세페이지를 열었는지의 근거. 우리가 만든 마일스톤만 본다.
      tasks: {
        where: { kind: "MILESTONE", title: { startsWith: DETAIL_OPEN_TASK_TITLE } },
        select: { status: true, detailOpenSeenAt: true },
      },
    },
  });

  return programs.map((program) => ({
    programId: program.id,
    challengeId: program.challengeId,
    challengeName: program.challenge.name,
    cohort: program.cohort,
    startDate: toDateOnly(program.startDate),
    endDate: program.endDate
      ? toDateOnly(program.endDate)
      : latestEnd(program.mktPlans),
    detailOpenTargetDate: toDateOnly(program.detailOpenTargetDate),
    curriculum: programCurriculumNote(program.challenge.settings, program.curriculumDays),
    missionPlans: toMissionPlans(
      settingsForProgram(program.challenge.settings, program.curriculumDays).settings,
    ),
    fromService: program.serviceImportedAt !== null,
    launched: isLaunched(program.serviceImportedAt, program.tasks),
  }));
}

/**
 * 상세페이지가 실제로 열린 기수인지.
 *
 * 되짚어 온 기수는 **실서비스 목록에 서 있다는 것 자체가** 열렸다는 뜻이다. 그래서 오픈
 * 태스크를 애초에 갖지 않고, 여기서도 더 볼 것이 없다.
 *
 * 개설로 세운 기수는 실서비스 대조가 근거다(domain/detail-open). 대조는 확인
 * (`detailOpenSeenAt`)과 자동 완료를 나눠 두고 스위치가 꺼진 동안에는 확인만 쌓으므로,
 * **상태만 보면 스위치를 켜기 전까지 영영 열리지 않는다.** 확인을 먼저 보고, 사람이 손으로
 * 올린 완료도 "열었다"는 말이라 함께 본다.
 *
 * 갈래마다 상세페이지가 따로 열리므로(plan.md §5) **갈래가 모두 열려야** 그 기수가 열린
 * 것이다 — 한쪽만 열린 기수는 아직 열 일이 남아 있다. 태스크가 하나도 없는 기수는 열렸다고
 * 말할 근거가 없어 열리지 않은 것으로 둔다.
 */
function isLaunched(
  serviceImportedAt: Date | null,
  tasks: { status: TaskStatus; detailOpenSeenAt: Date | null }[],
): boolean {
  if (serviceImportedAt !== null) return true;
  if (tasks.length === 0) return false;

  return tasks.every(
    (task) => task.detailOpenSeenAt !== null || task.status === "DONE",
  );
}

/**
 * 갈래별 설정을 미션 구성 단위로 묶는다. 갈래가 나뉘어도 미션이 같으면 한 벌이다 —
 * 실제로 지금 나뉜 챌린지는 모두 두 갈래의 미션이 같아, 벌을 안 묶으면 같은 날짜가 두 줄로
 * 그려져 줄만 먹는다.
 *
 * 미션이 하나도 없는 설정은 버린다. 수행기간만 적어두고 미션은 아직 안 적은 설정이 있는데,
 * 그런 벌을 남기면 캘린더에 빈 줄만 생긴다.
 */
function toMissionPlans(
  settings: {
    version: ProgramVersion;
    missions: {
      seq: number;
      durationDays: number;
      feedbackKind: FeedbackKind | null;
      feedbackDays: number | null;
    }[];
  }[],
): ProgramMissionPlan[] {
  const plans = new Map<string, ProgramMissionPlan>();

  for (const setting of settings) {
    if (setting.missions.length === 0) continue;

    const missions = setting.missions.map(toMissionPlan);
    const key = JSON.stringify(missions);

    const found = plans.get(key);
    if (found) found.versions.push(setting.version);
    else plans.set(key, { versions: [setting.version], missions });
  }

  return [...plans.values()];
}

/** 종류와 일수는 함께 있거나 함께 비어 있다. 짝이 맞을 때만 피드백으로 본다. */
function toMissionPlan(mission: {
  seq: number;
  durationDays: number;
  feedbackKind: FeedbackKind | null;
  feedbackDays: number | null;
}): MissionPlan {
  return {
    seq: mission.seq,
    durationDays: mission.durationDays,
    feedback:
      mission.feedbackKind !== null && mission.feedbackDays !== null
        ? { kind: mission.feedbackKind, days: mission.feedbackDays }
        : null,
  };
}

/** 갈래마다 끝나는 날이 다를 수 있다. 마지막 갈래가 끝나야 그 기수의 운영이 끝난다. */
function latestEnd(plans: { endDate: Date | null }[]): DateOnly | null {
  const ends = plans
    .map((plan) => plan.endDate)
    .filter((end): end is Date => end !== null)
    .map(toDateOnly);

  return ends.length === 0 ? null : ends.reduce((a, b) => (a > b ? a : b));
}

/**
 * 태스크 이름으로 갈래를 되읽고 정해진 차례로 세운다. 우리가 짓지 않은 이름이 섞여 있으면
 * 갈래를 알 수 없으므로 목록에 올리지 않는다.
 */
function toDetailOpenTasks(
  tasks: {
    id: string;
    title: string;
    status: TaskStatus;
    autoDoneAt: Date | null;
    detailOpenSeenAt: Date | null;
  }[],
): DetailOpenTask[] {
  return tasks
    .map((task) => {
      const version = detailOpenTaskVersion(task.title);
      return version
        ? {
            id: task.id,
            version,
            status: task.status,
            autoDone: task.autoDoneAt !== null && task.status === "DONE",
            seenAt: task.detailOpenSeenAt,
          }
        : null;
    })
    .filter((task): task is DetailOpenTask => task !== null)
    .sort(
      (a, b) =>
        PROGRAM_VERSIONS.indexOf(a.version) -
        PROGRAM_VERSIONS.indexOf(b.version),
    );
}

/**
 * 개설 = 프로그램 생성 1단계. 정원·가격·목표치·Redash URL 은 비운 채 시작한다.
 * 상세페이지 오픈 마일스톤을 함께 만들어 업무 캘린더에 바로 나타나게 한다.
 * 챌린지는 프로그램 설정에서 등록해 둔 것 중에서 고른다.
 */
export async function createProgramLaunch(
  input: CreateProgramLaunchInput,
): Promise<{ programId: string }> {
  const program = await prisma.program.create({
    data: {
      challengeId: input.challengeId,
      cohort: input.cohort,
      startDate: toDate(input.startDate),
      detailOpenTargetDate: toDate(input.detailOpenTargetDate),
    },
    select: { id: true },
  });

  await ensureDetailOpenTasks(
    program.id,
    input.versions,
    input.detailOpenTargetDate,
  );

  return { programId: program.id };
}

/**
 * 갈래마다 상세페이지 오픈 태스크를 하나씩 둔다. 이미 있으면 그대로 두어
 * 사람이 옮겨둔 상태나 마감일을 덮지 않는다.
 *
 * 나중에 저쪽에 다른 갈래가 추가되면 그때 그 갈래의 태스크만 새로 생긴다.
 */
export async function ensureDetailOpenTasks(
  programId: string,
  versions: ProgramVersion[],
  dueDate: DateOnly,
): Promise<number> {
  const titles = [...new Set(versions.map(detailOpenTaskTitle))];

  const existing = await prisma.task.findMany({
    where: { programId, title: { in: titles } },
    select: { title: true },
  });
  const known = new Set(existing.map((task) => task.title));
  const missing = titles.filter((title) => !known.has(title));

  if (missing.length === 0) return 0;

  await prisma.task.createMany({
    data: missing.map((title) => ({
      programId,
      title,
      kind: "MILESTONE" as const,
      status: "TODO" as const,
      dueDate: toDate(dueDate),
    })),
  });

  return missing.length;
}

/**
 * 기수의 상세페이지 오픈 태스크를 갈래 목록에 맞춘다. 빠진 갈래는 만들고, 갈래에 없는
 * 태스크는 아직 손대지 않았을 때만 지운다.
 *
 * 저쪽이 제목의 버전 표기를 나중에 고치면 이미 선 기수의 갈래가 달라진다. 기수 자체는
 * 덮지 않는다는 규칙 때문에 태스크만 옛 모습으로 남는데, 그러면 열어야 할 상세페이지가
 * 목록에서 빠지거나 없는 페이지가 하나 떠 있게 된다.
 *
 * 지우는 것은 `할 일` 상태뿐이다. 진행 중이거나 완료된 태스크는 사람이 이미 손댄 것이라
 * 갈래가 달라졌다고 걷어내면 해둔 일이 사라진다. 그런 줄은 남겨 눈에 띄게 둔다.
 */
export async function syncDetailOpenTasks(
  programId: string,
  versions: ProgramVersion[],
  dueDate: DateOnly,
): Promise<{ added: number; removed: number }> {
  const titles = new Set(versions.map(detailOpenTaskTitle));

  const stale = await prisma.task.findMany({
    where: {
      programId,
      // 우리가 만든 마일스톤만 본다. 사람이 손으로 적은 할 일까지 걷어내지 않기 위해서다.
      kind: "MILESTONE",
      title: { startsWith: DETAIL_OPEN_TASK_TITLE, notIn: [...titles] },
      status: "TODO",
    },
    select: { id: true },
  });

  if (stale.length > 0) {
    await prisma.task.deleteMany({
      where: { id: { in: stale.map((task) => task.id) } },
    });
  }

  const added = await ensureDetailOpenTasks(programId, versions, dueDate);

  return { added, removed: stale.length };
}

/**
 * 개설 내용 수정. 목표일을 고치는 것은 곧 상세페이지 오픈 태스크의 마감일을 고치는 것이다(plan.md §5).
 * 챌린지는 이미 등록된 것 사이에서만 옮긴다. 새 챌린지 추가는 개설에서만 한다.
 */
export async function updateProgramLaunch(
  input: UpdateProgramLaunchInput,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.program.update({
      where: { id: input.programId },
      data: {
        challengeId: input.challengeId,
        cohort: input.cohort,
        curriculumDays: input.curriculumDays,
        startDate: toDate(input.startDate),
        detailOpenTargetDate: toDate(input.detailOpenTargetDate),
      },
    });

    // 갈래가 나뉘면 태스크도 여럿이다. 목표일은 기수 하나에 하나이므로 함께 움직인다.
    await tx.task.updateMany({
      where: {
        programId: input.programId,
        title: { startsWith: DETAIL_OPEN_TASK_TITLE },
      },
      data: { dueDate: toDate(input.detailOpenTargetDate) },
    });
  });
}

/** 딸린 태스크는 Program 과 함께 지워진다(schema.prisma 의 onDelete: Cascade). */
export async function deleteProgramLaunch(programId: string): Promise<void> {
  await prisma.program.delete({ where: { id: programId } });
}

/**
 * 사람이 목록에서 상태를 바꾼다. 자동 판정의 흔적(autoDoneAt)은 지우지 않는다.
 * 남겨 두어야 사람이 되돌린 태스크를 다음 확인에서 다시 완료로 올리지 않는다.
 */
export async function setTaskStatus(
  taskId: string,
  status: TaskStatus,
): Promise<void> {
  await prisma.task.update({ where: { id: taskId }, data: { status } });
}
