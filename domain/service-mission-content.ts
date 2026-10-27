import { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";
import { fetchRedashResult, MISSION_CONTENTS_QUERY, type RedashRow } from "@/lib/redash";

import {
  contentSource,
  isNotionDoc,
  MISSION_CONTENT_KIND_BY_VALUE,
  type MissionContentKind,
  type MissionContentSource,
  type NotionDoc,
} from "./mission-content";
import { errorMessage, mapWithConcurrency, toDateColumn } from "./service-detail-page";
import { createNotionFetcher } from "./service-notion-fetch";

/**
 * 실서비스 미션 콘텐츠를 모아 사본으로 두는 일(plan.md §5 — 미션 콘텐츠).
 *
 * 무엇이 어느 미션에 붙었는지는 Redash 쿼리 335 에서, 본문은 Notion(oopy · 게시 페이지)에서 받는다.
 * 둘 다 문서화된 API 가 아니므로 실패는 삼키지 않고 사유를 남긴다. 한 콘텐츠가 실패해도
 * 예전에 받아둔 본문은 지우지 않는다.
 */

/** 본문을 동시에 몇 개씩 받을지. 저쪽 서버를 두드리지 않을 만큼만 겹친다. */
const FETCH_CONCURRENCY = 6;

/**
 * 콘텐츠 183개를 한 트랜잭션으로 쓰는 한도. 기본 5초로는 Supabase 까지 왕복이 쌓여 넘친다
 * (2026-09-15 로컬 → Supabase 에서 5.1초로 실패). 받아오기 40여 초와 합쳐도 maxDuration 120초 안에 든다.
 */
const WRITE_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 60_000 };

/** 쿼리 335 가 내보내는 칸. 하나라도 없으면 쿼리가 바뀐 것이라 아무것도 고치지 않는다. */
const REQUIRED_COLUMNS = [
  "challenge_id",
  "챌린지",
  "시작일자",
  "종료일자",
  "mission_id",
  "회차",
  "미션",
  "미션마감일",
  "연결구분값",
  "contents_id",
  "콘텐츠",
  "링크",
];

type ContentUse = {
  missionId: number;
  contentId: number;
  kind: MissionContentKind;
  challengeId: number;
  challengeTitle: string;
  challengeStartDate: Date | null;
  challengeEndDate: Date | null;
  missionTh: number;
  missionTitle: string;
  missionEndDate: Date | null;
  contentTitle: string;
  link: string;
};

function toInt(value: string | number | null): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return value !== null && value !== "" && Number.isInteger(number) ? number : null;
}

function toText(value: string | number | null): string {
  return value === null ? "" : String(value).trim();
}

function toUses(rows: RedashRow[]): ContentUse[] {
  if (rows.length === 0) {
    throw new Error("Redash 쿼리 결과가 비어 있습니다. 쿼리 335 를 확인하세요.");
  }
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !(column in rows[0]));
  if (missingColumns.length > 0) {
    throw new Error(`Redash 쿼리 결과에 칸이 없습니다: ${missingColumns.join(", ")}. 쿼리 335 를 확인하세요.`);
  }

  const uses = new Map<string, ContentUse>();
  for (const row of rows) {
    const missionId = toInt(row.mission_id);
    const kind = MISSION_CONTENT_KIND_BY_VALUE[toInt(row.연결구분값) ?? 0] ?? "UNKNOWN";
    const rawContentId = toInt(row.contents_id);
    // 템플릿 줄의 id 는 mission_template_id 라 contents_id 와 번호가 겹친다. 음수로 자리를 나눠
    // 콘텐츠와 같은 사본 · 연결 테이블에 둔다.
    const contentId = rawContentId !== null && kind === "TEMPLATE" ? -rawContentId : rawContentId;
    const challengeId = toInt(row.challenge_id);
    if (missionId === null || contentId === null || challengeId === null) continue;
    uses.set(`${missionId}:${contentId}`, {
      missionId,
      contentId,
      kind,
      challengeId,
      challengeTitle: toText(row.챌린지),
      challengeStartDate: toDateColumn(row.시작일자),
      challengeEndDate: toDateColumn(row.종료일자),
      missionTh: toInt(row.회차) ?? 0,
      missionTitle: toText(row.미션),
      missionEndDate: toDateColumn(row.미션마감일),
      contentTitle: toText(row.콘텐츠),
      link: toText(row.링크),
    });
  }
  if (uses.size === 0) {
    throw new Error("Redash 쿼리 결과에서 읽어낸 연결이 없습니다. 쿼리 335 를 확인하세요.");
  }
  return [...uses.values()];
}

export type MissionContentSyncResult = {
  uses: number;
  contents: number;
  fetched: number;
  /** Notion 이 아니라 본문을 받지 않은 콘텐츠 수 */
  linkOnly: number;
  failed: { id: number; title: string; reason: string }[];
};

/**
 * 쿼리 결과와 본문을 모두 새로 받아 사본을 고친다. 쿼리 결과를 못 받거나 모양이 바뀌었으면
 * 아무것도 고치지 않고 던진다.
 */
export async function syncMissionContents(): Promise<MissionContentSyncResult> {
  const { rows, retrievedAt } = await fetchRedashResult({ fresh: true, query: MISSION_CONTENTS_QUERY }).catch(
    (error: unknown) => {
      throw new Error(`Redash 쿼리 결과를 받지 못했습니다. ${errorMessage(error)}`);
    },
  );
  const uses = toUses(rows);
  const now = new Date();

  const contents = [...new Map(uses.map((use) => [use.contentId, use])).values()].map((use) => ({
    id: use.contentId,
    title: use.contentTitle,
    link: use.link,
    source: contentSource(use.link),
  }));

  const fetchNotionDoc = createNotionFetcher();
  const docs = await mapWithConcurrency(contents, FETCH_CONCURRENCY, async (content) => {
    try {
      return { ok: true as const, doc: await fetchNotionDoc(content.link) };
    } catch (error) {
      return { ok: false as const, reason: errorMessage(error) };
    }
  });

  const failed: MissionContentSyncResult["failed"] = [];
  const writes: Prisma.PrismaPromise<unknown>[] = [];
  for (const [index, content] of contents.entries()) {
    const result = docs[index];
    const listedFields = { title: content.title, link: content.link, source: content.source, listedAt: now };
    const docFields = !result.ok
      ? { fetchError: result.reason }
      : result.doc
        ? { content: result.doc as unknown as Prisma.InputJsonValue, fetchError: null, fetchedAt: now }
        : { content: Prisma.DbNull, fetchError: null, fetchedAt: null };
    if (!result.ok) failed.push({ id: content.id, title: content.title, reason: result.reason });

    writes.push(
      prisma.serviceMissionContent.upsert({
        where: { id: content.id },
        create: { id: content.id, ...listedFields, ...docFields },
        update: { ...listedFields, ...docFields },
      }),
    );
  }

  try {
    // 받아오기는 겹쳐도 쓰기는 한 연결로 묶어 보낸다. 풀러 연결을 한꺼번에 잡으면 고갈된다.
    // 콘텐츠 사본은 한 트랜잭션이다. 일부만 listedAt 이 새로 찍히면 나머지가 "사라짐" 으로 보인다.
    await prisma.$transaction(writes, WRITE_TRANSACTION_OPTIONS);
    // 연결은 지우고 다시 넣는 것이 한 번에 되어야 한다. 사이에서 실패하면 연결이 통째로 빈다.
    await prisma.$transaction([
      prisma.serviceMissionContentUse.deleteMany(),
      prisma.serviceMissionContentUse.createMany({
        data: uses.map((use) => ({
          missionId: use.missionId,
          contentId: use.contentId,
          kind: use.kind,
          challengeId: use.challengeId,
          challengeTitle: use.challengeTitle,
          challengeStartDate: use.challengeStartDate,
          challengeEndDate: use.challengeEndDate,
          missionTh: use.missionTh,
          missionTitle: use.missionTitle,
          missionEndDate: use.missionEndDate,
          queryRetrievedAt: retrievedAt,
        })),
      }),
    ]);
  } catch (error) {
    throw new Error(
      `받아온 내용을 저장하지 못했습니다. 일부만 저장되었을 수 있어 다시 불러와 주세요. ${errorMessage(error)}`,
    );
  }

  const linkOnly = contents.filter((content) => content.source === "other").length;
  return {
    uses: uses.length,
    contents: contents.length,
    fetched: contents.length - linkOnly - failed.length,
    linkOnly,
    failed,
  };
}

export type MissionContentRow = {
  id: number;
  title: string;
  link: string;
  source: MissionContentSource;
  /** 받아둔 본문이 있는지. 본문은 첫 화면을 무겁게 해 listMissionContentDocs 로 따로 받는다. */
  hasDoc: boolean;
  fetchedAt: string | null;
  fetchError: string | null;
  /** 마지막 불러오기의 쿼리 결과에 없던 콘텐츠. 지우지 않고 표시만 한다. */
  delisted: boolean;
};

export type MissionContentItem = { contentId: number; kind: MissionContentKind };

export type ContentMission = {
  id: number;
  th: number;
  title: string;
  endDate: string | null;
  contents: MissionContentItem[];
};

export type ContentChallenge = {
  id: number;
  title: string;
  startDate: string | null;
  endDate: string | null;
  missions: ContentMission[];
};

export type MissionContentsSnapshot = {
  contents: MissionContentRow[];
  challenges: ContentChallenge[];
  /** Redash 에서 쿼리가 돈 시각. 연결이 언제 기준인지 */
  queryRetrievedAt: string | null;
  /** 본문을 마지막으로 받은 시각 */
  lastFetchedAt: string | null;
};

export type MissionContentDocs = {
  /** 본문을 마지막으로 받은 시각. 스냅샷의 lastFetchedAt 과 같은 값이다. */
  version: string | null;
  docs: Record<number, NotionDoc>;
};

/** 본문만 따로 모은다. 화면이 뜬 뒤 /api/mission-contents/docs 가 내려준다(plan.md §5). */
export async function listMissionContentDocs(): Promise<MissionContentDocs> {
  const rows = await prisma.serviceMissionContent.findMany({
    where: { content: { not: Prisma.DbNull } },
    select: { id: true, content: true, fetchedAt: true },
  });
  const docs: Record<number, NotionDoc> = {};
  let latest = 0;
  for (const row of rows) {
    if (isNotionDoc(row.content)) docs[row.id] = row.content;
    if (row.fetchedAt) latest = Math.max(latest, row.fetchedAt.getTime());
  }
  return { version: latest ? new Date(latest).toISOString() : null, docs };
}

function toYmd(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

/** 실서비스 미션 화면처럼 템플릿이 먼저, 그다음 필수 · 추가 */
const KIND_ORDER: MissionContentKind[] = ["TEMPLATE", "ESSENTIAL", "ADDITIONAL", "LIMITED", "UNKNOWN"];

export async function listMissionContents(): Promise<MissionContentsSnapshot> {
  const rows = await prisma.serviceMissionContent.findMany({ omit: { content: true }, orderBy: { id: "desc" } });
  const uses = await prisma.serviceMissionContentUse.findMany({
    orderBy: [
      { challengeStartDate: { sort: "desc", nulls: "last" } },
      { challengeId: "desc" },
      { missionTh: "asc" },
      { missionEndDate: { sort: "asc", nulls: "last" } },
      { missionId: "asc" },
      { contentId: "asc" },
    ],
  });

  const lastListedAt = Math.max(0, ...rows.map((row) => row.listedAt.getTime()));
  const contents: MissionContentRow[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    link: row.link,
    source: row.source as MissionContentSource,
    // 본문을 받는 데 한 번이라도 성공해야 fetchedAt 이 찍히고, 실패해도 본문과 함께 남는다.
    hasDoc: row.fetchedAt !== null,
    fetchedAt: row.fetchedAt ? row.fetchedAt.toISOString() : null,
    fetchError: row.fetchError,
    delisted: row.listedAt.getTime() < lastListedAt,
  }));

  // 정렬된 연결을 차례대로 챌린지 · 미션으로 묶는다. Map 은 넣은 차례를 지킨다.
  const challenges = new Map<number, ContentChallenge>();
  const missions = new Map<number, ContentMission>();
  for (const use of uses) {
    let challenge = challenges.get(use.challengeId);
    if (!challenge) {
      challenge = {
        id: use.challengeId,
        title: use.challengeTitle,
        startDate: toYmd(use.challengeStartDate),
        endDate: toYmd(use.challengeEndDate),
        missions: [],
      };
      challenges.set(use.challengeId, challenge);
    }
    let mission = missions.get(use.missionId);
    if (!mission) {
      mission = {
        id: use.missionId,
        th: use.missionTh,
        title: use.missionTitle,
        endDate: toYmd(use.missionEndDate),
        contents: [],
      };
      missions.set(use.missionId, mission);
      challenge.missions.push(mission);
    }
    mission.contents.push({ contentId: use.contentId, kind: use.kind as MissionContentKind });
  }
  // 필수가 추가보다 먼저 선다. 같은 구분끼리는 콘텐츠 id 차례를 지킨다(sort 는 안정 정렬).
  for (const mission of missions.values()) {
    mission.contents.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  }

  const lastFetched = rows.reduce<Date | null>(
    (latest, row) => (row.fetchedAt && (!latest || row.fetchedAt > latest) ? row.fetchedAt : latest),
    null,
  );
  return {
    contents,
    challenges: [...challenges.values()],
    queryRetrievedAt: uses[0] ? uses[0].queryRetrievedAt.toISOString() : null,
    lastFetchedAt: lastFetched ? lastFetched.toISOString() : null,
  };
}
