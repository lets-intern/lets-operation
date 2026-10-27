import { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";
import { fetchRedashResult, MISSION_GUIDES_QUERY, type RedashRow } from "@/lib/redash";

import { GUIDE_ITEM_KIND_BY_VALUE, type GuideItemKind } from "./mission-guide";
import {
  contentSource,
  isNotionDoc,
  type MissionContentSource,
  type NotionDoc,
} from "./mission-content";
import { errorMessage, mapWithConcurrency, toDateColumn } from "./service-detail-page";
import { createNotionFetcher } from "./service-notion-fetch";

/**
 * 챌린지 가이드 · 대시보드 공지사항 · 미션 문구를 모아 사본으로 두는 일(plan.md §5 — 미션 가이드).
 *
 * 무엇이 어느 챌린지에 걸렸는지는 Redash 쿼리 336 에서 받는다. 미션의 미션명 · 내용 · 가이드 내용은
 * 운영DB 안의 글이라 쿼리 결과에 그대로 실려 오고, 가이드 · 공지는 주소만 실려 와 Notion 에서 본문을
 * 따로 받는다. 원문의 주인은 실서비스라 우리는 읽기만 한다.
 */

/** 본문을 동시에 몇 개씩 받을지. 저쪽 서버를 두드리지 않을 만큼만 겹친다. */
const FETCH_CONCURRENCY = 6;

/**
 * 한 번의 불러오기에서 본문을 받는 데 쓰는 시간. 받을 원문이 329개(2026-09-16)라 미션 콘텐츠의
 * 183개보다 많아 한 번에 다 못 받을 수 있다. 예산을 넘기면 남은 것은 건드리지 않고 다음 불러오기로
 * 미룬다 — 실행 시간 한도(maxDuration 120초)에 걸려 통째로 실패하면 쿼리 결과까지 못 쓰게 된다.
 */
const FETCH_BUDGET_MS = 70_000;

/** 자료 3,600줄을 한 트랜잭션으로 바꾸는 한도. 미션 콘텐츠와 같은 이유로 기본 5초로는 모자란다. */
const WRITE_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 60_000 };

/** 쿼리 336 이 내보내는 칸. 하나라도 없으면 쿼리가 바뀐 것이라 아무것도 고치지 않는다. */
const REQUIRED_COLUMNS = [
  "자료구분값",
  "challenge_id",
  "챌린지",
  "시작일자",
  "종료일자",
  "자료id",
  "mission_id",
  "회차",
  "미션마감일",
  "제목",
  "템플릿제목",
  "링크",
  "내용",
  "가이드",
  "고친시각",
];

function toInt(value: string | number | null): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return value !== null && value !== "" && Number.isInteger(number) ? number : null;
}

function toText(value: string | number | null): string {
  return value === null ? "" : String(value).trim();
}

/** `2026-09-16T05:05:27.387` 같은 시각 칸. 못 읽으면 비워 둔다 — 화면에 안 적힐 뿐이다. */
function toDateTime(value: string | number | null): Date | null {
  if (value === null || value === "") return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

type ParsedChallenge = { id: number; title: string; startDate: Date | null; endDate: Date | null };

type ParsedItem = {
  kind: GuideItemKind;
  sourceId: number;
  challengeId: number;
  title: string;
  link: string | null;
  templateId: number | null;
  th: number | null;
  endDate: Date | null;
  modifiedAt: Date | null;
};

type ParsedTemplate = { id: number; title: string; description: string; guide: string };

type Parsed = {
  challenges: ParsedChallenge[];
  items: ParsedItem[];
  templates: ParsedTemplate[];
  /** 본문을 받아야 하는 원문 주소. 가이드 · 공지가 같은 주소를 돌려 쓰므로 한 번만 센다. */
  links: { link: string; source: MissionContentSource }[];
};

function parse(rows: RedashRow[]): Parsed {
  if (rows.length === 0) {
    throw new Error("Redash 쿼리 결과가 비어 있습니다. 쿼리 336 을 확인하세요.");
  }
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !(column in rows[0]));
  if (missingColumns.length > 0) {
    throw new Error(`Redash 쿼리 결과에 칸이 없습니다: ${missingColumns.join(", ")}. 쿼리 336 을 확인하세요.`);
  }

  const challenges = new Map<number, ParsedChallenge>();
  const items = new Map<string, ParsedItem>();
  const templates = new Map<number, ParsedTemplate>();
  const links = new Map<string, MissionContentSource>();

  for (const row of rows) {
    const kind = GUIDE_ITEM_KIND_BY_VALUE[toInt(row.자료구분값) ?? 0];
    const challengeId = toInt(row.challenge_id);
    if (!kind || challengeId === null) continue;

    // 미션은 기수마다 한 줄이라 mission_id 가 열쇠다. 가이드 · 공지는 자료id 가 곧 저쪽 번호다.
    const sourceId = kind === "MISSION" ? toInt(row.mission_id) : toInt(row.자료id);
    if (sourceId === null) continue;

    if (!challenges.has(challengeId)) {
      challenges.set(challengeId, {
        id: challengeId,
        title: toText(row.챌린지),
        startDate: toDateColumn(row.시작일자),
        endDate: toDateColumn(row.종료일자),
      });
    }

    const link = toText(row.링크);
    if (kind !== "MISSION" && link !== "") links.set(link, contentSource(link));

    const templateId = kind === "MISSION" ? toInt(row.자료id) : null;
    if (templateId !== null && !templates.has(templateId)) {
      templates.set(templateId, {
        id: templateId,
        title: toText(row.템플릿제목),
        description: toText(row.내용),
        guide: toText(row.가이드),
      });
    }

    items.set(`${kind}:${sourceId}`, {
      kind,
      sourceId,
      challengeId,
      title: toText(row.제목),
      link: kind === "MISSION" ? null : link,
      templateId,
      th: kind === "MISSION" ? toInt(row.회차) : null,
      endDate: kind === "MISSION" ? toDateColumn(row.미션마감일) : null,
      modifiedAt: toDateTime(row.고친시각),
    });
  }

  if (items.size === 0) {
    throw new Error("Redash 쿼리 결과에서 읽어낸 자료가 없습니다. 쿼리 336 을 확인하세요.");
  }

  return {
    challenges: [...challenges.values()],
    items: [...items.values()],
    templates: [...templates.values()],
    links: [...links].map(([link, source]) => ({ link, source })),
  };
}

export type MissionGuideSyncResult = {
  challenges: number;
  items: number;
  templates: number;
  /** 가이드 · 공지가 가리키는 원문 주소 수(같은 주소는 한 번만 센다) */
  docs: number;
  /** 이번에 본문을 새로 받은 원문 수 */
  fetched: number;
  /** Notion 이 아니라 본문을 받지 않는 원문 수 */
  linkOnly: number;
  /** 시간이 모자라 다음 불러오기로 미룬 원문 수 */
  deferred: number;
  failed: { link: string; reason: string }[];
};

/**
 * 쿼리 결과와 본문을 받아 사본을 고친다. 쿼리 결과를 못 받거나 모양이 바뀌었으면 아무것도 고치지 않고 던진다.
 *
 * 본문은 아직 한 번도 못 받은 것부터, 그다음 오래 묵은 것부터 받는다. 예산 안에 다 받지 못해도
 * 쿼리 결과는 이미 저장되어 있고, 다시 누르면 못 받은 것부터 이어 받는다.
 */
export async function syncMissionGuides(): Promise<MissionGuideSyncResult> {
  const { rows, retrievedAt } = await fetchRedashResult({ fresh: true, query: MISSION_GUIDES_QUERY }).catch(
    (error: unknown) => {
      throw new Error(`Redash 쿼리 결과를 받지 못했습니다. ${errorMessage(error)}`);
    },
  );
  const { challenges, items, templates, links } = parse(rows);
  const now = new Date();

  try {
    // 챌린지 · 자료 · 템플릿은 쿼리 결과가 원본 그대로라 통째로 바꾼다. 사이에서 실패하면
    // 목록이 통째로 비므로 한 트랜잭션이어야 한다.
    await prisma.$transaction(
      [
        prisma.serviceGuideItem.deleteMany(),
        prisma.serviceGuideChallenge.deleteMany(),
        prisma.serviceMissionTemplate.deleteMany(),
        prisma.serviceGuideChallenge.createMany({
          data: challenges.map((challenge) => ({ ...challenge, queryRetrievedAt: retrievedAt })),
        }),
        prisma.serviceMissionTemplate.createMany({
          data: templates.map((template) => ({ ...template, listedAt: now })),
        }),
        prisma.serviceGuideItem.createMany({ data: items }),
        // 본문 사본은 지우지 않는다 — 받아둔 글은 쿼리 결과와 무관하게 쓸모가 있다.
        prisma.serviceGuideDoc.createMany({ data: links.map((doc) => ({ ...doc, listedAt: now })), skipDuplicates: true }),
        prisma.serviceGuideDoc.updateMany({
          where: { link: { in: links.map((doc) => doc.link) } },
          data: { listedAt: now },
        }),
      ],
      WRITE_TRANSACTION_OPTIONS,
    );
  } catch (error) {
    throw new Error(`쿼리 결과를 저장하지 못했습니다. ${errorMessage(error)}`);
  }

  // 아직 못 받은 것 먼저, 그다음 오래 묵은 것부터. 예산이 모자라면 뒤쪽이 다음 불러오기로 밀린다.
  const targets = await prisma.serviceGuideDoc.findMany({
    where: { link: { in: links.map((doc) => doc.link) }, source: { not: "other" } },
    select: { link: true },
    orderBy: [{ fetchedAt: { sort: "asc", nulls: "first" } }, { link: "asc" }],
  });

  const fetchNotionDoc = createNotionFetcher();
  const deadline = Date.now() + FETCH_BUDGET_MS;
  const results = await mapWithConcurrency(targets, FETCH_CONCURRENCY, async (target) => {
    if (Date.now() > deadline) return { done: false as const };
    try {
      return { done: true as const, ok: true as const, doc: await fetchNotionDoc(target.link) };
    } catch (error) {
      return { done: true as const, ok: false as const, reason: errorMessage(error) };
    }
  });

  const failed: MissionGuideSyncResult["failed"] = [];
  const writes: Prisma.PrismaPromise<unknown>[] = [];
  let deferred = 0;
  for (const [index, target] of targets.entries()) {
    const result = results[index];
    if (!result.done) {
      deferred++;
      continue;
    }
    if (!result.ok) failed.push({ link: target.link, reason: result.reason });
    writes.push(
      prisma.serviceGuideDoc.update({
        where: { link: target.link },
        // 받지 못하면 사유만 남기고 예전 본문은 그대로 둔다.
        data: result.ok
          ? { content: result.doc as unknown as Prisma.InputJsonValue, fetchError: null, fetchedAt: now }
          : { fetchError: result.reason },
      }),
    );
  }

  try {
    // 받아오기는 겹쳐도 쓰기는 한 연결로 묶어 보낸다. 풀러 연결을 한꺼번에 잡으면 고갈된다.
    await prisma.$transaction(writes, WRITE_TRANSACTION_OPTIONS);
  } catch (error) {
    throw new Error(
      `받아온 본문을 저장하지 못했습니다. 일부만 저장되었을 수 있어 다시 불러와 주세요. ${errorMessage(error)}`,
    );
  }

  return {
    challenges: challenges.length,
    items: items.length,
    templates: templates.length,
    docs: links.length,
    fetched: writes.length - failed.length,
    linkOnly: links.length - targets.length,
    deferred,
    failed,
  };
}

export type GuideItem = {
  kind: GuideItemKind;
  sourceId: number;
  /** 가이드 · 공지의 제목, 미션은 그 기수에 적힌 미션명 */
  title: string;
  /** 가이드 · 공지가 가리키는 원문 주소 */
  link: string | null;
  templateId: number | null;
  th: number | null;
  endDate: string | null;
  modifiedAt: string | null;
};

export type GuideChallenge = {
  id: number;
  title: string;
  startDate: string | null;
  endDate: string | null;
  items: GuideItem[];
};

/** 가이드 · 공지 원문 한 건. 본문은 첫 화면을 무겁게 해 listMissionGuideDocs 로 따로 받는다. */
export type GuideDocRow = {
  link: string;
  source: MissionContentSource;
  hasDoc: boolean;
  fetchedAt: string | null;
  fetchError: string | null;
};

/** 미션 템플릿의 문구. 166개뿐이라 첫 화면에 그대로 싣는다. */
export type MissionTemplateRow = {
  id: number;
  title: string;
  description: string;
  guide: string;
};

export type MissionGuidesSnapshot = {
  challenges: GuideChallenge[];
  docs: GuideDocRow[];
  templates: MissionTemplateRow[];
  /** Redash 에서 쿼리가 돈 시각 */
  queryRetrievedAt: string | null;
  /** 본문을 마지막으로 받은 시각 */
  lastFetchedAt: string | null;
  /** 아직 받아오기를 시도조차 못 한 원문 수. 시간이 모자라 미뤄진 것이라 다시 누르면 이어받는다. */
  deferredDocs: number;
  /** 마지막 받아오기가 실패한 원문 수. 다시 눌러도 같은 사유로 실패할 수 있어 따로 센다. */
  failedDocs: number;
};

export type MissionGuideDocs = {
  /** 본문을 마지막으로 받은 시각. 스냅샷의 lastFetchedAt 과 같은 값이다. */
  version: string | null;
  docs: Record<string, NotionDoc>;
};

/** 본문만 따로 모은다. 화면이 뜬 뒤 /api/mission-guides/docs 가 내려준다(plan.md §5). */
export async function listMissionGuideDocs(): Promise<MissionGuideDocs> {
  const rows = await prisma.serviceGuideDoc.findMany({
    where: { content: { not: Prisma.DbNull } },
    select: { link: true, content: true, fetchedAt: true },
  });
  const docs: Record<string, NotionDoc> = {};
  let latest = 0;
  for (const row of rows) {
    if (isNotionDoc(row.content)) docs[row.link] = row.content;
    if (row.fetchedAt) latest = Math.max(latest, row.fetchedAt.getTime());
  }
  return { version: latest ? new Date(latest).toISOString() : null, docs };
}

function toYmd(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

/** 챌린지 안에서 서는 차례. 가이드 · 공지가 먼저 오고 미션이 회차 순으로 뒤를 잇는다. */
const KIND_ORDER: GuideItemKind[] = ["GUIDE", "NOTICE", "MISSION"];

export async function listMissionGuides(): Promise<MissionGuidesSnapshot> {
  const [challengeRows, itemRows, templateRows, docRows] = await Promise.all([
    prisma.serviceGuideChallenge.findMany({
      orderBy: [{ startDate: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    }),
    prisma.serviceGuideItem.findMany({
      orderBy: [{ th: { sort: "asc", nulls: "first" } }, { kind: "asc" }, { sourceId: "asc" }],
    }),
    prisma.serviceMissionTemplate.findMany({ orderBy: { id: "asc" } }),
    prisma.serviceGuideDoc.findMany({ omit: { content: true } }),
  ]);

  const challenges: GuideChallenge[] = challengeRows.map((row) => ({
    id: row.id,
    title: row.title,
    startDate: toYmd(row.startDate),
    endDate: toYmd(row.endDate),
    items: [],
  }));
  const byChallenge = new Map(challenges.map((challenge) => [challenge.id, challenge]));

  for (const row of itemRows) {
    byChallenge.get(row.challengeId)?.items.push({
      kind: row.kind as GuideItemKind,
      sourceId: row.sourceId,
      title: row.title,
      link: row.link,
      templateId: row.templateId,
      th: row.th,
      endDate: toYmd(row.endDate),
      modifiedAt: row.modifiedAt ? row.modifiedAt.toISOString() : null,
    });
  }
  // 회차 순서를 지킨 채 갈래만 앞으로 끌어온다(sort 는 안정 정렬).
  for (const challenge of challenges) {
    challenge.items.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  }

  const lastFetched = docRows.reduce<Date | null>(
    (latest, row) => (row.fetchedAt && (!latest || row.fetchedAt > latest) ? row.fetchedAt : latest),
    null,
  );

  return {
    challenges,
    docs: docRows.map((row) => ({
      link: row.link,
      source: row.source as MissionContentSource,
      hasDoc: row.fetchedAt !== null,
      fetchedAt: row.fetchedAt ? row.fetchedAt.toISOString() : null,
      fetchError: row.fetchError,
    })),
    templates: templateRows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      guide: row.guide,
    })),
    queryRetrievedAt: challengeRows[0] ? challengeRows[0].queryRetrievedAt.toISOString() : null,
    lastFetchedAt: lastFetched ? lastFetched.toISOString() : null,
    deferredDocs: docRows.filter(
      (row) => row.source !== "other" && row.fetchedAt === null && row.fetchError === null,
    ).length,
    failedDocs: docRows.filter((row) => row.fetchError !== null).length,
  };
}
