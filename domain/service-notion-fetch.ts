import { asArray, asRecord, asString } from "./detail-page-content";
import {
  contentSource,
  missingBlockIds,
  NOTION_SITE_ORIGIN,
  notionPageIdFromUrl,
  toNotionDoc,
  type NotionDoc,
} from "./mission-content";

/**
 * Notion 으로 만든 원문을 받아 우리 본문(NotionDoc)으로 옮기는 일.
 *
 * 미션 콘텐츠 화면과 미션 가이드 화면이 같은 원문 갈래(oopy · Notion 게시 페이지)를 받으므로
 * 받는 규칙을 한자리에 둔다. 둘 다 문서화된 API 가 아니라 실패는 삼키지 않고 사유를 남긴다.
 */

const REQUEST_TIMEOUT_MS = 20_000;

/** Notion 게시 페이지를 조각으로 받을 때의 상한. 아주 긴 페이지에서 끝없이 돌지 않게 한다. */
const MAX_PAGE_CHUNKS = 30;

/** 빠진 블록을 채우러 몇 번까지 되묻는지. 채운 블록 안에서 또 빠진 블록이 나올 수 있다. */
const MAX_FILL_ROUNDS = 3;

/** 429 를 받았을 때 몇 번까지 기다렸다 다시 받는지 */
const MAX_RATE_LIMIT_RETRIES = 3;

/** 429 에 retry-after 가 없을 때 기다리는 시간. 되물을 때마다 두 배로 는다. */
const RATE_LIMIT_WAIT_MS = 5_000;

/** 한 번에 기다리는 최대 시간. 저쪽이 긴 retry-after 를 주어도 실행 시간 한도 안에서 끝낸다. */
const MAX_RATE_LIMIT_WAIT_MS = 15_000;

/** 원문이 다른 주소로 넘길 때 몇 번까지 따라가는지 */
const MAX_REDIRECTS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 원문을 받는다.
 *
 * - oopy 는 짧은 사이에 100건 남짓을 넘게 받으면 429 로 막는다(2026-09-14 확인). 막히면 기다렸다가
 *   다시 받는다 — 한 번 막혔다고 실패로 두면 콘텐츠 수십 개가 한꺼번에 예전 사본에 머문다.
 * - 다른 주소로 넘기면 같은 종류(oopy · notion.site)의 주소일 때만 따라간다. 누구나 만들 수 있는
 *   oopy 사이트가 내부 주소로 넘겨 우리 서버가 대신 받으러 가는 일을 막는다.
 */
async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const source = contentSource(url);
  let current = url;
  let redirects = 0;
  let retries = 0;
  for (;;) {
    const response = await fetch(current, {
      ...init,
      headers: { "user-agent": "Mozilla/5.0 (LetsOperation)", ...init.headers },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      const next = location ? new URL(location, current).href : "";
      if (!next || contentSource(next) !== source || ++redirects > MAX_REDIRECTS) {
        throw new Error(`원문이 받을 수 없는 주소로 넘깁니다(${response.status}).`);
      }
      current = next;
      continue;
    }
    if (response.status === 429 && retries < MAX_RATE_LIMIT_RETRIES) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await response.body?.cancel();
      const wait = retryAfter > 0 ? retryAfter * 1000 : RATE_LIMIT_WAIT_MS * 2 ** retries;
      await sleep(Math.min(wait, MAX_RATE_LIMIT_WAIT_MS));
      retries++;
      continue;
    }
    if (!response.ok) throw new Error(`원문이 ${response.status} 로 답했습니다.`);
    return response;
  }
}

async function postNotion(origin: string, method: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await request(`${origin}/api/v3/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return asRecord(await response.json()) ?? {};
}

type RecordMap = { block: Record<string, unknown>; collection: Record<string, unknown> };

/**
 * 본문에서 이어지는데 받은 데이터에 없는 블록을 Notion 게시 사이트에서 채운다.
 * 끝내 다 채우지 못하면 던진다 — 일부만 담긴 본문이 성공으로 예전 사본을 덮으면 찾기에서 조용히 빠진다.
 */
async function fillMissingBlocks(origin: string, recordMap: RecordMap, rootId: string): Promise<void> {
  for (let round = 0; round < MAX_FILL_ROUNDS; round++) {
    const missing = missingBlockIds(recordMap, rootId).slice(0, 100);
    if (missing.length === 0) return;
    const data = await postNotion(origin, "syncRecordValuesMain", {
      requests: missing.map((id) => ({ pointer: { table: "block", id }, version: -1 })),
    });
    const blocks = asRecord(asRecord(data.recordMap)?.block) ?? {};
    if (Object.keys(blocks).length === 0) break;
    Object.assign(recordMap.block, blocks);
  }
  const left = missingBlockIds(recordMap, rootId).length;
  if (left > 0) throw new Error(`본문 블록 ${left}개를 받지 못했습니다.`);
}

/**
 * 요청을 일정한 간격 이상 벌려 보낸다. 겹쳐 받는 줄이 여럿이어도 보내는 순서대로 칸을 나눠 갖는다.
 */
function createPacer(intervalMs: number): () => Promise<void> {
  let nextAt = 0;
  return async () => {
    const now = Date.now();
    const at = Math.max(now, nextAt);
    nextAt = at + intervalMs;
    if (at > now) await sleep(at - now);
  };
}

/**
 * oopy 에 페이지를 받으러 가는 간격. 100건 남짓을 약 10초 안에 받으면 막히므로(초당 14건에서 막히고
 * 초당 5건은 통과, 2026-09-14) 초당 4건으로 흘린다. 161개를 받는 데 40초쯤 걸린다.
 */
const OOPY_REQUEST_INTERVAL_MS = 250;

/** oopy 는 서버가 그린 HTML 안에 Notion 블록 데이터를 통째로 싣는다. */
async function fetchOopyDoc(link: string, pace: () => Promise<void>): Promise<NotionDoc> {
  await pace();
  const html = await (await request(link)).text();
  const match = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  let pageProps: Record<string, unknown> | null = null;
  try {
    pageProps = match ? asRecord(asRecord(asRecord(JSON.parse(match[1]))?.props)?.pageProps) : null;
  } catch {
    // 아래에서 모양을 모르는 것으로 알린다.
  }
  const loaded = asRecord(pageProps?.recordMap);
  const rootId = asString(pageProps?.pageID);
  if (!loaded || !rootId) throw new Error("oopy 페이지에서 본문 데이터를 찾지 못했습니다.");

  const recordMap: RecordMap = {
    block: asRecord(loaded.block) ?? {},
    collection: asRecord(loaded.collection) ?? {},
  };
  await fillMissingBlocks(NOTION_SITE_ORIGIN, recordMap, rootId);
  const origin = new URL(link).origin;
  return toNotionDoc(recordMap, rootId, (id) => `${origin}/${id}`);
}

/**
 * 주소에 페이지 id 가 없는 게시 사이트 주소(`/mockinterviewregister` 같은 이름 주소)는
 * 그 페이지 HTML 에 실린 `"pageId"` 로 찾는다.
 */
async function resolveNotionSlug(link: string): Promise<string | null> {
  const html = await (await request(link)).text();
  const match = /"pageId":"([0-9a-f-]{32,36})"/i.exec(html);
  return match ? notionPageIdFromUrl(`${NOTION_SITE_ORIGIN}/${match[1]}`) : null;
}

/** Notion 게시 페이지는 공개 페이지가 쓰는 블록 API 로 조각조각 끝까지 받는다. */
async function fetchNotionSiteDoc(link: string): Promise<NotionDoc> {
  const url = new URL(link);
  const isSite = url.hostname.endsWith(".notion.site");
  const pageId = notionPageIdFromUrl(link) ?? (isSite ? await resolveNotionSlug(link) : null);
  if (!pageId) throw new Error("Notion 주소에서 페이지를 찾지 못했습니다.");
  // app.notion.com · www.notion.so 는 로그인 화면으로 넘기므로 같은 워크스페이스의 게시 사이트에서 받는다.
  const origin = isSite ? url.origin : NOTION_SITE_ORIGIN;

  const recordMap: RecordMap = { block: {}, collection: {} };
  let cursor: unknown = { stack: [] };
  for (let chunkNumber = 0; ; chunkNumber++) {
    if (chunkNumber === MAX_PAGE_CHUNKS) {
      throw new Error(`Notion 페이지가 ${MAX_PAGE_CHUNKS}조각을 넘어 끝까지 받지 못했습니다.`);
    }
    const data = await postNotion(origin, "loadPageChunk", {
      pageId,
      limit: 100,
      cursor,
      chunkNumber,
      verticalColumns: false,
    });
    const loaded = asRecord(data.recordMap);
    Object.assign(recordMap.block, asRecord(loaded?.block));
    Object.assign(recordMap.collection, asRecord(loaded?.collection));
    cursor = data.cursor;
    if (asArray(asRecord(cursor)?.stack).length === 0) break;
  }
  if (!(pageId in recordMap.block)) {
    throw new Error("Notion 페이지를 받지 못했습니다. 게시가 꺼졌을 수 있습니다.");
  }
  await fillMissingBlocks(origin, recordMap, pageId);
  return toNotionDoc(recordMap, pageId, (id) => `${origin}/${id.replaceAll("-", "")}`);
}

/**
 * 한 번의 불러오기에서 여러 원문을 받을 때 쓰는 수집기. oopy 를 두드리는 간격을 안에 들고 있어
 * 겹쳐 받는 줄이 여럿이어도 저쪽이 막지 않을 만큼만 흘린다.
 *
 * Notion 으로 만든 원문이 아니면 `null` 을 돌려준다 — 받지 않고 링크만 두는 자리다.
 */
export function createNotionFetcher(): (link: string) => Promise<NotionDoc | null> {
  const paceOopy = createPacer(OOPY_REQUEST_INTERVAL_MS);
  return async (link: string) => {
    const source = contentSource(link);
    if (source === "other") return null;
    return source === "oopy" ? fetchOopyDoc(link, paceOopy) : fetchNotionSiteDoc(link);
  };
}
