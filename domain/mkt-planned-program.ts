import { prisma } from "@/lib/prisma";
import { sourceDb } from "@/lib/source-db";

import { toDate, toDateOnly, type DateOnly } from "./date";
import type { ProgramVersion } from "./program-setting";
import {
  createProgramLaunch,
  ensureDetailOpenTasks,
  syncDetailOpenTasks,
} from "./program";
import { detailOpenTargetFor, parseProgramTitle } from "./program-launch";

/**
 * 마케팅팀 사이트의 개설 예정 프로그램을 가져와 우리 기수로 세우는 일.
 * 화면은 이 파일을 통해서만 닿는다.
 *
 * 가져오기는 두 걸음이다. 먼저 원본을 사본 테이블에 그대로 옮겨 담고(copyFromSource),
 * 그 사본을 읽어 개설 가능한 줄을 program 으로 만든다(openPending). 두 걸음을 나눠 두면
 * 개설이 막힌 줄이 있어도 사본은 최신이라 화면에서 막힌 이유를 그대로 보여줄 수 있다.
 *
 * 원본에 수정 시각 컬럼이 없어 "바뀐 것만" 을 가려낼 방법이 없다. 그래서 매번 전량을 읽고
 * source_id 로 덮어쓴다. 목록 자체가 수십~수백 줄 규모라 이 편이 단순하고 정확하다.
 */

/** 개설이 막힌 이유. 사람이 무엇을 해야 하는지가 그대로 드러나야 한다. */
export type MktBlockReason =
  /** 제목에서 "N기" 를 읽지 못했다. 마케팅팀 표기를 고쳐야 한다. */
  | "TITLE"
  /** 제목 앞부분과 이름이 같은 챌린지가 없다. 프로그램 설정에서 등록해야 한다. */
  | "CHALLENGE"
  /** 시작일이 비어 있다. 저쪽에서 일정이 잡혀야 한다. */
  | "START_DATE";

/** 아직 개설되지 않은 기획 한 줄. 개설 화면이 사유와 함께 보여준다. */
export type PendingMktProgram = {
  id: string;
  title: string;
  category: string;
  owner: string;
  note: string;
  startDate: DateOnly | null;
  openDeadline: DateOnly | null;
  reason: MktBlockReason;
  /**
   * 제목에서 뽑아낸 챌린지 이름. `등록되지 않은 챌린지` 사유일 때 이 이름을 별칭으로 잇는다.
   * 제목 자체를 못 읽은 줄은 비어 있다.
   */
  challengeName: string | null;
};

export type MktSyncResult = {
  /** 사본에 처음 들어온 줄 */
  added: number;
  /** 이미 있어 덮어쓴 줄 */
  updated: number;
  /** 원본에서 사라져 지운 줄 */
  removed: number;
  /** 이번에 새로 개설된 기수 */
  opened: number;
  /** 손으로 이미 만들어 둔 기수를 기획과 이어준 건 */
  linked: number;
  /** 아직 개설하지 못한 줄 */
  blocked: number;
  /** 이미 선 기수에서 갈래가 어긋나 채우거나 걷어낸 상세페이지 오픈 태스크 */
  healed: number;
};

/**
 * 원본 한 줄. 날짜는 문자열로 받는다.
 * pg 는 date 컬럼을 실행 환경 시간대의 Date 로 만들어 주는데, 그 과정에서 하루가 밀릴 수 있다.
 * SQL 에서 text 로 바꿔 받으면 저쪽이 적어둔 날짜가 그대로 온다.
 */
type SourceRow = {
  id: string;
  category: string;
  title: string;
  owner: string;
  note: string;
  start_date: string | null;
  end_date: string | null;
  open_deadline: string | null;
  opened: boolean;
  sort_order: number;
  created_at: Date;
};

const SOURCE_QUERY = `
  SELECT id::text            AS id,
         category,
         title,
         owner,
         note,
         start_date::text    AS start_date,
         end_date::text      AS end_date,
         open_deadline::text AS open_deadline,
         opened,
         sort_order,
         created_at
    FROM mkt_planned_programs
   ORDER BY sort_order, created_at
`;

function toRecord(row: SourceRow) {
  return {
    sourceId: row.id,
    // 갈래는 제목 앞 접두어에 있다. 사본에 함께 담아 두면 개설할 때 다시 뜯지 않아도 되고,
    // 저쪽이 표기를 바꾸면 다음 가져오기에 그대로 따라온다.
    version: parseProgramTitle(row.title)?.version ?? "COMMON",
    category: row.category,
    title: row.title,
    owner: row.owner,
    note: row.note,
    startDate: row.start_date ? toDate(row.start_date) : null,
    endDate: row.end_date ? toDate(row.end_date) : null,
    openDeadline: row.open_deadline ? toDate(row.open_deadline) : null,
    opened: row.opened,
    sortOrder: row.sort_order,
    sourceCreatedAt: row.created_at,
  };
}

/**
 * 가져오기 한 번. 사본을 맞추고 이어서 개설까지 한다.
 * 별칭을 새로 이었을 때는 사본을 다시 읽을 것 없이 openPendingMktPrograms 만 부르면 된다.
 */
export async function syncMktPlannedPrograms(): Promise<MktSyncResult> {
  const copied = await copyFromSource();
  const launched = await openPending();

  return { ...copied, ...launched };
}

/**
 * 원본을 통째로 읽어 사본을 맞춘다. 저쪽에서 지워진 줄은 우리 사본에서도 지운다.
 * 이미 개설한 기수는 그대로 남는다. 딸린 태스크가 업무 캘린더에 이미 나가 있어,
 * 저쪽 목록에서 줄이 사라졌다고 우리 일정까지 걷어내면 진행 중인 일이 없어진다.
 *
 * 한 트랜잭션으로 묶어 도중에 끊겨도 반쯤 덮인 목록이 남지 않게 한다.
 */
async function copyFromSource() {
  const { rows } = await sourceDb().query<SourceRow>(SOURCE_QUERY);
  const records = rows.map(toRecord);
  const sourceIds = records.map((record) => record.sourceId);

  const existing = await prisma.mktPlannedProgram.findMany({
    select: { sourceId: true },
  });
  const known = new Set(existing.map((row) => row.sourceId));
  const updated = sourceIds.filter((sourceId) => known.has(sourceId)).length;

  // notIn 에 빈 배열을 넘기는 모양에 기대지 않고, 원본이 비었으면 전부 지우는 것을 그대로 적는다.
  const removal =
    sourceIds.length > 0
      ? prisma.mktPlannedProgram.deleteMany({
          where: { sourceId: { notIn: sourceIds } },
        })
      : prisma.mktPlannedProgram.deleteMany({});

  await prisma.$transaction([
    ...records.map((record) =>
      prisma.mktPlannedProgram.upsert({
        where: { sourceId: record.sourceId },
        create: record,
        update: record,
      }),
    ),
    removal,
  ]);

  return {
    added: records.length - updated,
    updated,
    removed: existing.length - updated,
  };
}

/**
 * 기획을 개설하는 데 필요한 밑자료. 줄마다 DB 를 다시 묻지 않도록 한 번에 모아 둔다.
 * 가져오기와 화면 표시가 같은 자료로 같은 판단을 하도록 한 곳에서 만든다.
 */
type LaunchContext = {
  /** 마케팅팀 이름 → 우리 챌린지. 우리 이름과 별칭이 함께 들어 있다. */
  challengeIdByName: Map<string, string>;
  /** `챌린지 id:기수` → 이미 있는 기수. 같은 자리를 두 번 만들지 않기 위한 것이다. */
  programByKey: Map<string, { id: string; detailOpenTargetDate: DateOnly }>;
  /** 기수 id → 그 기수의 오픈 목표일. 이미 이어진 줄을 다시 볼 때 쓴다. */
  targetByProgramId: Map<string, DateOnly>;
};

function programKey(challengeId: string, cohort: number): string {
  return `${challengeId}:${cohort}`;
}

async function loadLaunchContext(): Promise<LaunchContext> {
  const [challenges, aliases, programs] = await Promise.all([
    prisma.challenge.findMany({ select: { id: true, name: true } }),
    prisma.challengeAlias.findMany({ select: { name: true, challengeId: true } }),
    prisma.program.findMany({
      select: {
        id: true,
        challengeId: true,
        cohort: true,
        detailOpenTargetDate: true,
      },
    }),
  ]);

  // 별칭을 먼저 깔고 우리 이름으로 덮는다. 두 표기가 겹치면 우리 이름이 이긴다.
  const challengeIdByName = new Map<string, string>();
  for (const alias of aliases) challengeIdByName.set(alias.name, alias.challengeId);
  for (const challenge of challenges) {
    challengeIdByName.set(challenge.name, challenge.id);
  }

  return {
    challengeIdByName,
    programByKey: new Map(
      programs.map((program) => [
        programKey(program.challengeId, program.cohort),
        {
          id: program.id,
          detailOpenTargetDate: toDateOnly(program.detailOpenTargetDate),
        },
      ]),
    ),
    targetByProgramId: new Map(
      programs.map((program) => [
        program.id,
        toDateOnly(program.detailOpenTargetDate),
      ]),
    ),
  };
}

/**
 * 사본에서 아직 개설되지 않은 줄을 읽어 기수를 세운다.
 *
 * 이미 개설된 기수는 다시 건드리지 않는다. 마케팅팀이 일정을 옮겨도 우리 목표일을 말없이
 * 덮지 않는다는 뜻이다. 사람이 우리 화면에서 목표일을 직접 고쳐둔 경우가 있어, 자동 덮어쓰기는
 * 그 손질을 소리 없이 지운다. 바뀐 일정은 목록에 그대로 보이므로 사람이 보고 고친다.
 */
async function openPending() {
  const rows = await listMirrorRows();
  const context = await loadLaunchContext();

  // 아직 개설되지 않은 줄을 기수 단위로 묶는다. 버전이 나뉘면 두 줄이 한 묶음이 되어
  // 기수는 하나만 서고 상세페이지 오픈 태스크만 갈래 수만큼 생긴다(plan.md §5).
  const groups = new Map<string, { resolved: ResolvedRow; rows: MirrorRow[] }>();
  let blocked = 0;

  for (const row of rows) {
    if (row.programId !== null) continue;

    const resolved = resolveRow(row, context);
    if (!resolved.ok) {
      blocked += 1;
      continue;
    }

    const key = programKey(resolved.challengeId, resolved.cohort);
    const group = groups.get(key);
    // 묶음의 일정은 첫 줄을 따른다. 같은 기수의 두 갈래는 같은 날 열리므로 갈릴 일이 없다.
    if (group) group.rows.push(row);
    else groups.set(key, { resolved, rows: [row] });
  }

  const healed = await healLinkedRows(rows, context);

  let opened = 0;
  let linked = 0;

  for (const [key, group] of groups) {
    const versions = [...new Set(group.rows.map((row) => row.version))];
    const existing = context.programByKey.get(key);

    let programId: string;

    if (existing) {
      // 이미 그 자리에 기수가 있다. 손으로 먼저 만들어 둔 것이거나, 저쪽에 갈래가 하나 늘어난
      // 경우다. 기수는 그대로 두고 빠진 갈래의 태스크만 채운다. 마감일은 그 기수의 목표일을
      // 따른다 — 사람이 고쳐둔 값을 저쪽 일정으로 되돌리지 않기 위해서다.
      programId = existing.id;
      await ensureDetailOpenTasks(
        programId,
        versions,
        existing.detailOpenTargetDate,
      );
      linked += 1;
    } else {
      const created = await createProgramLaunch({
        challengeId: group.resolved.challengeId,
        cohort: group.resolved.cohort,
        startDate: group.resolved.startDate,
        detailOpenTargetDate: group.resolved.detailOpenTargetDate,
        versions,
      });
      programId = created.programId;
      context.programByKey.set(key, {
        id: programId,
        detailOpenTargetDate: group.resolved.detailOpenTargetDate,
      });
      opened += 1;
    }

    await prisma.mktPlannedProgram.updateMany({
      where: { id: { in: group.rows.map((row) => row.id) } },
      data: { programId },
    });
  }

  return { opened, linked, blocked, healed };
}

/**
 * 이미 이어진 줄의 갈래를 다시 본다. 저쪽이 제목의 버전 표기를 나중에 고치면 그 기수의
 * 갈래가 달라지는데, 기수는 덮지 않는다는 규칙 때문에 태스크만 옛 모습으로 남는다.
 * 가져올 때마다 맞춰두면 어긋난 상태가 오래 가지 않는다.
 */
async function healLinkedRows(
  rows: MirrorRow[],
  context: LaunchContext,
): Promise<number> {
  const versionsByProgram = new Map<string, ProgramVersion[]>();

  for (const row of rows) {
    if (row.programId === null) continue;
    const versions = versionsByProgram.get(row.programId) ?? [];
    versions.push(row.version);
    versionsByProgram.set(row.programId, versions);
  }

  let healed = 0;

  for (const [programId, versions] of versionsByProgram) {
    const dueDate = context.targetByProgramId.get(programId);
    // 기수가 사라졌으면 연결도 끊겼어야 한다. 만약을 위해 건너뛴다.
    if (!dueDate) continue;

    const { added, removed } = await syncDetailOpenTasks(
      programId,
      versions,
      dueDate,
    );
    healed += added + removed;
  }

  return healed;
}

function listMirrorRows() {
  return prisma.mktPlannedProgram.findMany({
    orderBy: [{ sortOrder: "asc" }, { sourceCreatedAt: "asc" }],
  });
}

type MirrorRow = {
  id: string;
  title: string;
  version: ProgramVersion;
  startDate: Date | null;
  openDeadline: Date | null;
  programId: string | null;
};

type ResolvedRow = {
  ok: true;
  challengeId: string;
  cohort: number;
  startDate: DateOnly;
  detailOpenTargetDate: DateOnly;
};

type Resolved = ResolvedRow | { ok: false; reason: MktBlockReason };

/**
 * 기획 한 줄이 개설 가능한지. 가져오기와 화면 표시가 같은 판단을 쓰도록 한 곳에 둔다.
 *
 * 오픈 목표일은 저쪽이 잡아둔 마감일을 그대로 쓴다. 저쪽이 이미 정해 둔 날을 우리 계산으로
 * 덮으면 두 팀이 서로 다른 날을 보게 된다. 마감일이 비었을 때만 시작일 2주 전 규칙으로 채운다.
 */
function resolveRow(
  row: Pick<MirrorRow, "title" | "startDate" | "openDeadline">,
  context: LaunchContext,
): Resolved {
  const parsed = parseProgramTitle(row.title);
  if (!parsed) return { ok: false, reason: "TITLE" };

  const challengeId = context.challengeIdByName.get(parsed.challengeName);
  if (!challengeId) return { ok: false, reason: "CHALLENGE" };

  if (!row.startDate) return { ok: false, reason: "START_DATE" };
  const startDate = toDateOnly(row.startDate);

  const deadline = row.openDeadline ? toDateOnly(row.openDeadline) : null;
  // 마감일이 시작일보다 뒤면 우리 규칙이 깨진다(오픈 목표일은 시작일보다 앞). 계산값으로 돌린다.
  const detailOpenTargetDate =
    deadline && deadline <= startDate ? deadline : detailOpenTargetFor(startDate);

  return {
    ok: true,
    challengeId,
    cohort: parsed.cohort,
    startDate,
    detailOpenTargetDate,
  };
}

/**
 * 아직 개설되지 않은 기획. 개설 화면이 사유와 함께 보여준다.
 * 가져오기가 끝나면 개설 가능한 줄은 남지 않으므로 여기 오르는 것은 막힌 줄뿐이다.
 */
export async function listPendingMktPrograms(): Promise<PendingMktProgram[]> {
  const rows = await listMirrorRows();
  const context = await loadLaunchContext();

  const pending: PendingMktProgram[] = [];

  for (const row of rows) {
    if (row.programId !== null) continue;

    const resolved = resolveRow(row, context);
    if (resolved.ok) continue;

    pending.push({
      id: row.id,
      title: row.title,
      category: row.category,
      owner: row.owner,
      note: row.note,
      startDate: row.startDate ? toDateOnly(row.startDate) : null,
      openDeadline: row.openDeadline ? toDateOnly(row.openDeadline) : null,
      reason: resolved.reason,
      challengeName: parseProgramTitle(row.title)?.challengeName ?? null,
    });
  }

  return pending;
}

/**
 * 사본은 그대로 두고 개설만 다시 시도한다. 챌린지나 별칭을 새로 등록해 막혀 있던 사유가
 * 풀렸을 때 쓴다. 저쪽 DB 를 건드리지 않아 가볍다.
 */
export async function openPendingMktPrograms(): Promise<{
  opened: number;
  linked: number;
  blocked: number;
  healed: number;
}> {
  return openPending();
}

/** 마지막으로 가져온 시각. 아직 한 번도 가져오지 않았으면 비어 있다. */
export async function lastMktSyncedAt(): Promise<Date | null> {
  const latest = await prisma.mktPlannedProgram.aggregate({
    _max: { syncedAt: true },
  });
  return latest._max.syncedAt;
}
