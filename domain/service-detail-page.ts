import type { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";

import {
  asArray,
  asRecord,
  asString,
  detailPageUrl,
  isDetailImageSrc,
  isDetailPageContent,
  isScreenItems,
  mergeScreen,
  toDetailPageContent,
  type DetailPageContent,
} from "./detail-page-content";

/**
 * 실서비스 챌린지 상세페이지를 공개 API 에서 받아 사본으로 두는 일(plan.md §5 — 상세페이지).
 *
 * 문서화된 API 가 아니라 실서비스 화면 코드에서 찾은 주소다. 마케팅팀이 바꾸면 여기가 깨지므로
 * 실패는 삼키지 않고 사유를 남긴다. 한 페이지가 실패해도 예전에 받아둔 내용은 지우지 않는다.
 */

const API_BASE = "https://3ccm7bgq1b.execute-api.ap-northeast-2.amazonaws.com/api/v1";

const LIST_PAGE_SIZE = 500;

/** 상세를 동시에 몇 개씩 받을지. 저쪽 서버를 두드리지 않을 만큼만 겹친다. */
const DETAIL_CONCURRENCY = 6;

const REQUEST_TIMEOUT_MS = 15_000;

/** 한 트랜잭션에 묶는 쓰기 수. 한 번에 너무 크게 묶으면 실패 하나에 전부 되돌아간다. */
const WRITE_BATCH_SIZE = 40;

/** OCR 결과 한 장의 상한. 아주 긴 이미지도 이 안에 들고, 이상한 값이 쌓이는 것은 막는다. */
export const MAX_IMAGE_TEXT_LENGTH = 100_000;

async function getData(path: string): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`실서비스 API 가 ${response.status} 로 답했습니다.`);
  const data = asRecord(await response.json())?.data;
  if (data === undefined || data === null) {
    throw new Error("실서비스 API 응답에 내용이 없습니다.");
  }
  return data;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") return "응답이 너무 늦습니다.";
  return error instanceof Error ? error.message : String(error);
}

/** `2026-09-21T11:00:00` 에서 날짜만 떼어 @db.Date 로 넣을 값을 만든다. */
export function toDateColumn(value: unknown): Date | null {
  const ymd = asString(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? new Date(`${ymd}T00:00:00.000Z`) : null;
}

type ListedChallenge = {
  id: number;
  title: string;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
};

async function fetchChallengeList(): Promise<ListedChallenge[]> {
  const listed: ListedChallenge[] = [];
  for (let page = 1; ; page++) {
    const data = asRecord(
      await getData(`/program?type=CHALLENGE&page=${page}&size=${LIST_PAGE_SIZE}`),
    );
    for (const raw of asArray(data?.programList)) {
      const info = asRecord(asRecord(raw)?.programInfo);
      if (!info || typeof info.id !== "number") continue;
      listed.push({
        id: info.id,
        title: asString(info.title),
        status: asString(info.programStatusType),
        startDate: toDateColumn(info.startDate),
        endDate: toDateColumn(info.endDate),
      });
    }
    const totalPages = Number(asRecord(data?.pageInfo)?.totalPages ?? 1);
    if (!(page < totalPages)) break;
  }
  return listed;
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

export type DetailPageSyncResult = {
  listed: number;
  fetched: number;
  failed: { id: number; title: string; reason: string }[];
};

/** 목록과 상세를 모두 새로 받아 사본을 고친다. 목록을 못 받으면 아무것도 고치지 않고 던진다. */
export async function syncServiceDetailPages(): Promise<DetailPageSyncResult> {
  const challenges = await fetchChallengeList().catch((error: unknown) => {
    throw new Error(`실서비스 목록을 받지 못했습니다. ${errorMessage(error)}`);
  });
  const now = new Date();

  const details = await mapWithConcurrency(challenges, DETAIL_CONCURRENCY, async (challenge) => {
    try {
      return { ok: true as const, content: toDetailPageContent(await getData(`/challenge/${challenge.id}`)) };
    } catch (error) {
      return { ok: false as const, reason: errorMessage(error) };
    }
  });

  // 받아오기는 겹쳐도 쓰기는 한 연결로 한다. 풀러 연결을 한꺼번에 잡으면 고갈된다.
  // 한 줄씩 왕복하면 서버와 DB 가 멀 때 수십 초가 걸려 실행 시간 제한에 닿으므로 묶어서 보낸다.
  const failed: DetailPageSyncResult["failed"] = [];
  const writes: Prisma.PrismaPromise<unknown>[] = [];
  for (const [index, challenge] of challenges.entries()) {
    const detail = details[index];
    const listedFields = {
      title: challenge.title,
      status: challenge.status,
      startDate: challenge.startDate,
      endDate: challenge.endDate,
      listedAt: now,
    };
    const detailFields = detail.ok
      ? {
          content: detail.content as unknown as Prisma.InputJsonValue,
          fetchError: null,
          fetchedAt: now,
        }
      : { fetchError: detail.reason };
    if (!detail.ok) failed.push({ id: challenge.id, title: challenge.title, reason: detail.reason });

    writes.push(
      prisma.serviceDetailPage.upsert({
        where: { id: challenge.id },
        create: { id: challenge.id, ...listedFields, ...detailFields },
        update: { ...listedFields, ...detailFields },
      }),
    );
  }

  try {
    for (let start = 0; start < writes.length; start += WRITE_BATCH_SIZE) {
      await prisma.$transaction(writes.slice(start, start + WRITE_BATCH_SIZE));
    }
  } catch (error) {
    throw new Error(
      `받아온 내용을 저장하지 못했습니다. 일부만 저장되었을 수 있어 다시 불러와 주세요. ${errorMessage(error)}`,
    );
  }

  return { listed: challenges.length, fetched: challenges.length - failed.length, failed };
}

export type DetailPageRow = {
  id: number;
  title: string;
  status: string;
  startDate: string | null;
  url: string;
  content: DetailPageContent | null;
  fetchedAt: string | null;
  fetchError: string | null;
  /** 실서비스 화면을 띄워 마지막으로 읽은(또는 시도한) 시각. 한 번도 안 읽었으면 null. */
  screenedAt: string | null;
  /** 화면을 한 번이라도 읽어 content 에 끼워 넣었는지 */
  screenRead: boolean;
  screenError: string | null;
  /**
   * 마지막 불러오기의 목록에 없던 페이지. 저쪽이 비공개로 돌리거나 지운 것이다.
   * 지우지 않고 표시만 한다 — 예전 문구를 찾는 데는 여전히 쓸모가 있다.
   */
  delisted: boolean;
};

/** 최근에 시작하는 기수가 위로 온다. 찾는 일은 대개 지금 열려 있는 페이지에서 시작한다. */
export async function listDetailPages(): Promise<DetailPageRow[]> {
  const rows = await prisma.serviceDetailPage.findMany({
    orderBy: [{ startDate: { sort: "desc", nulls: "last" } }, { id: "desc" }],
  });
  const lastListedAt = Math.max(0, ...rows.map((row) => row.listedAt.getTime()));
  return rows.map((row) => {
    const content = isDetailPageContent(row.content) ? row.content : null;
    const screen = isScreenItems(row.screen) ? row.screen : null;
    return {
      delisted: row.listedAt.getTime() < lastListedAt,
      id: row.id,
      title: row.title,
      status: row.status,
      startDate: row.startDate ? row.startDate.toISOString().slice(0, 10) : null,
      url: detailPageUrl(row.id),
      // 화면에서 읽은 글은 읽을 때마다 끼워 넣는다. API 사본만 새로 받아도 예전에 읽은 화면이 제자리를 찾는다.
      content: content && screen ? mergeScreen(content, screen) : content,
      fetchedAt: row.fetchedAt ? row.fetchedAt.toISOString() : null,
      fetchError: row.fetchError,
      screenedAt: row.screenedAt ? row.screenedAt.toISOString() : null,
      screenRead: screen !== null,
      screenError: row.screenError,
    };
  });
}

export async function lastDetailPagesFetchedAt(): Promise<Date | null> {
  const result = await prisma.serviceDetailPage.aggregate({ _max: { fetchedAt: true } });
  return result._max.fetchedAt;
}

export async function listDetailImageTexts(): Promise<Record<string, string>> {
  const rows = await prisma.detailImageText.findMany({ select: { src: true, text: true } });
  return Object.fromEntries(rows.map((row) => [row.src, row.text]));
}

/** 읽어낸 글이 비어 있어도 저장한다. 글자가 없는 이미지를 다음에 또 읽지 않게 하려는 것이다. */
export async function saveDetailImageText(src: string, text: string): Promise<void> {
  if (!isDetailImageSrc(src)) throw new Error("상세페이지 이미지 주소가 아닙니다.");
  const value = text.slice(0, MAX_IMAGE_TEXT_LENGTH);
  await prisma.detailImageText.upsert({
    where: { src },
    create: { src, text: value },
    update: { text: value, readAt: new Date() },
  });
}
