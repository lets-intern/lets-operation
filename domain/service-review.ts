import { prisma } from "@/lib/prisma";
import { fetchRedashResult, MISSION_REVIEWS_QUERY, REVIEWS_QUERY, type RedashQuery, type RedashRow } from "@/lib/redash";

import { findMatches } from "./detail-page-content";
import {
  comparePart,
  countReviewHits,
  GENERAL_REVIEW_TYPES,
  isClassifiedPart,
  isReviewCategory,
  isTestReview,
  normalizeReviewCategories,
  reviewTypeFromQuery,
  ruleReviewCategories,
  UNCLASSIFIED,
  type ReviewType,
} from "./review";
import { errorMessage } from "./service-detail-page";

/**
 * 실서비스 후기를 모아 사본으로 두는 일(plan.md §5 — 후기 관리).
 *
 * 후기는 Redash 쿼리 349(미션 외 다섯 유형) · 350(미션)에서 받는다. 두 쿼리는 칸 구성이 같고 후기 글 한 칸이 한 줄이다.
 * 원문의 주인은 실서비스라 우리는 읽기만 하고, 노출 여부도 관리자 화면에서 바꾼다. 우리 쪽에 남는 것은 매니저가 고친 카테고리뿐이다.
 */

/** 두 쿼리가 내보내는 칸. 하나라도 없으면 쿼리가 바뀐 것이라 아무것도 고치지 않는다. */
const REQUIRED_COLUMNS = [
  "유형",
  "후기id",
  "칸id",
  "칸",
  "작성일시",
  "프로그램id",
  "프로그램",
  "회차",
  "미션",
  "이름",
  "user_id",
  "멘토",
  "만족도",
  "NPS",
  "내용",
  "노출여부",
  "칸노출여부",
  "링크",
  "제목",
];

/** 후기 수천 줄을 한 트랜잭션으로 바꾸는 한도. 미션 후기는 1만 줄이 넘는다. */
const WRITE_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 120_000 };

/** 한 번에 넣는 줄 수. 줄마다 칸이 21개라 Postgres 매개변수 상한(65,535)보다 넉넉히 작게 자른다. */
const INSERT_CHUNK = 1_000;

/** 목록 한 쪽에 싣는 후기 수. 미션 후기는 1만 건이 넘어 한꺼번에 화면으로 보내지 않는다. */
export const REVIEW_PAGE_SIZE = 50;

function toInt(value: string | number | null): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return value !== null && value !== "" && Number.isInteger(number) ? number : null;
}

function toText(value: string | number | null): string {
  return value === null ? "" : String(value).trim();
}

/** 운영DB 가 한국 시각으로 적으므로 +09:00 으로 읽는다(CS 수집과 같다). */
function toKstDateTime(value: string | number | null): Date | null {
  const text = toText(value);
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(text)) return null;
  const date = new Date(`${text.replace(" ", "T")}+09:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 노출 칸은 0 · 1 로 온다. 비어 있으면 null. */
function toFlag(value: string | number | null): boolean | null {
  const number = toInt(value);
  return number === null ? null : number !== 0;
}

type ParsedReview = {
  key: string;
  type: ReviewType;
  reviewId: number;
  itemId: number | null;
  part: string;
  writtenAt: Date;
  programId: number | null;
  programTitle: string;
  th: number | null;
  missionTitle: string | null;
  authorName: string | null;
  userId: number | null;
  mentorName: string | null;
  score: number | null;
  nps: number | null;
  content: string;
  visible: boolean;
  partVisible: boolean | null;
  url: string | null;
  blogTitle: string | null;
};

function parse(
  rows: RedashRow[],
  queryLabel: string,
  types: ReviewType[],
): { reviews: ParsedReview[]; tests: number; skipped: number } {
  if (rows.length === 0) {
    throw new Error(`Redash 쿼리 결과가 비어 있습니다. 쿼리 ${queryLabel} 을 확인하세요.`);
  }
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !(column in rows[0]));
  if (missingColumns.length > 0) {
    throw new Error(`Redash 쿼리 결과에 칸이 없습니다: ${missingColumns.join(", ")}. 쿼리 ${queryLabel} 을 확인하세요.`);
  }

  const reviews: ParsedReview[] = [];
  const seen = new Set<string>();
  let tests = 0;
  let skipped = 0;
  for (const row of rows) {
    const type = reviewTypeFromQuery(toText(row.유형));
    const reviewId = toInt(row.후기id);
    const writtenAt = toKstDateTime(row.작성일시);
    const content = toText(row.내용);
    // 유형 · 번호 · 작성일시를 못 읽었거나 이 쿼리가 맡지 않은 유형이면 버리되 세어 둔다 —
    // 쿼리 모양이 조금 바뀐 것을 결과 문구로 알아챈다.
    if (type === null || !types.includes(type) || reviewId === null || writtenAt === null) {
      skipped++;
      continue;
    }
    // 쿼리가 빈 글을 거르지만, 블로그는 설명 없이 글 주소만 등록된 것이 있을 수 있다.
    if (!content && type !== "BLOG") continue;

    const itemId = toInt(row.칸id);
    const key = `${type}:${reviewId}:${itemId ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const review: ParsedReview = {
      key,
      type,
      reviewId,
      itemId,
      part: toText(row.칸) || "후기",
      writtenAt,
      programId: toInt(row.프로그램id),
      programTitle: toText(row.프로그램),
      th: toInt(row.회차),
      missionTitle: toText(row.미션) || null,
      authorName: toText(row.이름) || null,
      userId: toInt(row.user_id),
      mentorName: toText(row.멘토) || null,
      score: toInt(row.만족도),
      nps: toInt(row.NPS),
      content,
      visible: toFlag(row.노출여부) ?? false,
      partVisible: toFlag(row.칸노출여부),
      url: /^https?:\/\//.test(toText(row.링크)) ? toText(row.링크) : null,
      blogTitle: toText(row.제목) || null,
    };
    if (isTestReview(review)) {
      tests++;
      continue;
    }
    reviews.push(review);
  }

  if (reviews.length === 0) {
    throw new Error(`Redash 쿼리 결과에서 읽어낸 후기가 없습니다. 쿼리 ${queryLabel} 을 확인하세요.`);
  }
  return { reviews, tests, skipped };
}

export type ReviewQuerySyncResult =
  | {
      ok: true;
      /** 받은 후기 수(칸이 여럿인 후기도 한 건) */
      reviews: number;
      /** 받은 칸 수 */
      parts: number;
      /** 모으지 않은 테스트 후기 칸 수 */
      tests: number;
      /** 유형 · 번호 · 작성일시를 못 읽어 버린 줄 수 */
      skipped: number;
    }
  | { ok: false; error: string };

export type ReviewSyncResult = {
  /** 쿼리 349 — 챌린지 · 라이브 · 라이브 멘토링 · 1:1 LIVE 멘토링 · 블로그 */
  general: ReviewQuerySyncResult;
  /** 쿼리 350 — 미션 */
  mission: ReviewQuerySyncResult;
};

/**
 * 쿼리 하나의 결과를 받아 그 쿼리가 맡은 유형의 사본을 통째로 바꾼다.
 * 결과를 못 받거나 모양이 바뀌었으면 그 유형은 아무것도 고치지 않는다.
 */
async function syncQuery(query: RedashQuery, queryLabel: string, types: ReviewType[]): Promise<ReviewQuerySyncResult> {
  try {
    const { rows, retrievedAt } = await fetchRedashResult({ fresh: true, query }).catch((error: unknown) => {
      throw new Error(`Redash 쿼리 ${queryLabel} 결과를 받지 못했습니다. ${errorMessage(error)}`);
    });
    const { reviews, tests, skipped } = parse(rows, queryLabel, types);

    const data = reviews.map((review) => ({ ...review, queryRetrievedAt: retrievedAt }));
    try {
      // 사이에서 실패하면 그 유형 목록이 통째로 비므로 한 트랜잭션이어야 한다. 매니저가 고친 카테고리는 다른 표라 남는다.
      await prisma.$transaction(async (tx) => {
        await tx.serviceReview.deleteMany({ where: { type: { in: types } } });
        for (let at = 0; at < data.length; at += INSERT_CHUNK) {
          await tx.serviceReview.createMany({ data: data.slice(at, at + INSERT_CHUNK) });
        }
      }, WRITE_TRANSACTION_OPTIONS);
    } catch (error) {
      throw new Error(`쿼리 ${queryLabel} 결과를 저장하지 못했습니다. ${errorMessage(error)}`);
    }

    return {
      ok: true,
      reviews: new Set(reviews.map((review) => `${review.type}:${review.reviewId}`)).size,
      parts: reviews.length,
      tests,
      skipped,
    };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/** 두 쿼리를 차례로 받는다. 한쪽이 실패해도 다른 쪽은 바꾼다 — 유형이 겹치지 않는다. */
export async function syncReviews(): Promise<ReviewSyncResult> {
  const general = await syncQuery(REVIEWS_QUERY, "349", GENERAL_REVIEW_TYPES);
  const mission = await syncQuery(MISSION_REVIEWS_QUERY, "350", ["MISSION"]);
  return { general, mission };
}

export type ReviewPartRow = {
  key: string;
  part: string;
  content: string;
  /** 칸 노출 여부. 칸이 따로 있는 챌린지 · 라이브만 있다. */
  partVisible: boolean | null;
  /** 카테고리를 붙이는 칸인지. 멘토 이름 칸은 붙이지 않는다. */
  classified: boolean;
  /** 지금 붙은 카테고리 — 매니저가 고쳤으면 그것, 아니면 키워드 규칙이 붙인 것 */
  categories: string[];
  ruleCategories: string[];
  categoriesEdited: boolean;
};

export type ReviewRow = {
  /** 목록 열쇠 — 유형:후기id */
  id: string;
  reviewId: number;
  writtenAt: string;
  programTitle: string;
  th: number | null;
  missionTitle: string | null;
  authorName: string | null;
  mentorName: string | null;
  score: number | null;
  nps: number | null;
  visible: boolean;
  url: string | null;
  blogTitle: string | null;
  parts: ReviewPartRow[];
};

export type ReviewVisibility = "all" | "visible" | "hidden";
export type ReviewSort = "newest" | "oldest";

export type ReviewListParams = {
  type: ReviewType;
  query: string;
  /** 칸 거르기(챌린지 · 라이브). 빈 글이면 거르지 않는다. */
  part: string;
  /** 카테고리 키. 빈 글이면 거르지 않는다. */
  category: string;
  visibility: ReviewVisibility;
  sort: ReviewSort;
  /** 1부터 */
  page: number;
};

export type ReviewsSnapshot = {
  /** 실제로 적용한 칸 · 카테고리 거르기. 이 유형에 없는 값이 주소에 오면 비운다. */
  part: string;
  category: string;
  /** 유형별 후기 수(탭에 적는다) */
  typeCounts: Partial<Record<ReviewType, number>>;
  /** Redash 에서 쿼리가 돈 시각 — 349 · 350 각각 */
  retrievedAt: { general: string | null; mission: string | null };
  /** 이 유형에 있는 칸 이름(칸 거르기에 쓴다) */
  parts: string[];
  /** 찾기 · 칸 · 노출로 거른 뒤 카테고리별 칸 수. 카테고리를 골라도 다른 카테고리 건수가 0 이 되지 않게 카테고리 거르기 전에 센다. */
  categoryCounts: Record<string, number>;
  /** 카테고리 거르기 전 후기 수 */
  narrowedTotal: number;
  /** 모든 조건으로 거른 후기 수 */
  total: number;
  /** 이 유형의 후기 수(거르기 전) */
  typeTotal: number;
  page: number;
  pageCount: number;
  reviews: ReviewRow[];
  /** 지금 쪽 후기마다 찾은 곳 수 */
  hits: Record<string, number>;
};

export async function listReviews(params: ReviewListParams): Promise<ReviewsSnapshot> {
  const [rows, edits, counts, retrieved] = await Promise.all([
    prisma.serviceReview.findMany({ where: { type: params.type }, orderBy: [{ writtenAt: "desc" }, { key: "asc" }] }),
    prisma.reviewCategory.findMany({ where: { key: { startsWith: `${params.type}:` } } }),
    prisma.$queryRaw<{ type: string; n: number }[]>`
      SELECT type, COUNT(DISTINCT review_id)::int AS n FROM service_review GROUP BY type`,
    prisma.$queryRaw<{ general: Date | null; mission: Date | null }[]>`
      SELECT MAX(query_retrieved_at) FILTER (WHERE type <> 'MISSION') AS general,
             MAX(query_retrieved_at) FILTER (WHERE type = 'MISSION') AS mission
        FROM service_review`,
  ]);
  const editByKey = new Map(edits.map((edit) => [edit.key, edit.categories]));

  // 후기 하나에 칸이 여럿이다. 쿼리 순서(최신순)를 지키며 후기별로 묶는다.
  const grouped = new Map<string, ReviewRow>();
  const partNames = new Set<string>();
  for (const row of rows) {
    const id = `${row.type}:${row.reviewId}`;
    let review = grouped.get(id);
    if (!review) {
      review = {
        id,
        reviewId: row.reviewId,
        writtenAt: row.writtenAt.toISOString(),
        programTitle: row.programTitle,
        th: row.th,
        missionTitle: row.missionTitle,
        authorName: row.authorName,
        mentorName: row.mentorName,
        score: row.score,
        nps: row.nps,
        visible: row.visible,
        url: row.url,
        blogTitle: row.blogTitle,
        parts: [],
      };
      grouped.set(id, review);
    }
    const classified = isClassifiedPart(row.part);
    const rule = classified ? ruleReviewCategories(params.type, row) : [];
    // 카테고리 이름을 바꾸거나 지워 예전에 고친 값이 하나도 안 남으면 규칙으로 돌아간다.
    const editedRaw = classified ? editByKey.get(row.key) : undefined;
    const edited = editedRaw ? normalizeReviewCategories(params.type, editedRaw) : [];
    review.parts.push({
      key: row.key,
      part: row.part,
      content: row.content,
      partVisible: row.partVisible,
      classified,
      categories: edited.length > 0 ? edited : rule,
      ruleCategories: rule,
      categoriesEdited: edited.length > 0,
    });
    partNames.add(row.part);
  }
  for (const review of grouped.values()) review.parts.sort((a, b) => comparePart(a.part, b.part));

  const all = [...grouped.values()];
  // 주소에 남은 칸 · 카테고리가 이 유형에 없으면(다른 유형에서 옮겨 온 주소 등) 거르지 않는다 — 풀 수 있는 거르기가 화면에 없다.
  const part = partNames.has(params.part) ? params.part : "";
  const category =
    params.category === UNCLASSIFIED || isReviewCategory(params.type, params.category) ? params.category : "";
  const searching = params.query.trim().length > 0;
  // 칸을 고르면 그 칸만 본다 — 찾기도, 카테고리 건수도 그 칸으로 센다.
  const consideredParts = (review: ReviewRow) =>
    review.parts.filter((entry) => entry.classified && (!part || entry.part === part));
  // 멘토 이름 칸은 위쪽 멘토와 같은 글이라 찾기에서 뺀다 — 한 번 일치가 두 번으로 세어진다.
  const hitCount = (review: ReviewRow) =>
    countReviewHits({ ...review, content: "" }, params.query) +
    consideredParts(review).reduce((sum, entry) => sum + findMatches(entry.content, params.query).length, 0);

  const hits = new Map<string, number>();
  const narrowed = all.filter((review) => {
    if (params.visibility !== "all" && review.visible !== (params.visibility === "visible")) return false;
    if (part && !review.parts.some((entry) => entry.part === part)) return false;
    if (searching) {
      const count = hitCount(review);
      if (count === 0) return false;
      hits.set(review.id, count);
    }
    return true;
  });

  const categoryCounts: Record<string, number> = {};
  for (const review of narrowed) {
    for (const entry of consideredParts(review)) {
      for (const key of entry.categories) categoryCounts[key] = (categoryCounts[key] ?? 0) + 1;
    }
  }

  const filtered = category
    ? narrowed.filter((review) => consideredParts(review).some((entry) => entry.categories.includes(category)))
    : narrowed;
  const ordered = params.sort === "newest" ? filtered : [...filtered].reverse();

  const pageCount = Math.max(1, Math.ceil(ordered.length / REVIEW_PAGE_SIZE));
  const page = Math.min(Math.max(1, params.page), pageCount);
  const pageReviews = ordered.slice((page - 1) * REVIEW_PAGE_SIZE, page * REVIEW_PAGE_SIZE);

  return {
    part,
    category,
    typeCounts: Object.fromEntries(counts.map((count) => [count.type, count.n])),
    retrievedAt: {
      general: retrieved[0]?.general ? retrieved[0].general.toISOString() : null,
      mission: retrieved[0]?.mission ? retrieved[0].mission.toISOString() : null,
    },
    parts: [...partNames].sort(comparePart),
    categoryCounts,
    narrowedTotal: narrowed.length,
    total: ordered.length,
    typeTotal: all.length,
    page,
    pageCount,
    reviews: pageReviews,
    hits: Object.fromEntries(pageReviews.map((review) => [review.id, hits.get(review.id) ?? 0])),
  };
}

/**
 * 매니저가 고른 칸 카테고리를 저장한다. null 이면 고친 것을 지워 키워드 규칙으로 되돌린다.
 * 하나도 고르지 않은 채로는 저장하지 않는다 — 어느 카테고리에도 안 잡히는 칸이 생긴다.
 */
export async function saveReviewCategories(key: string, categories: string[] | null): Promise<void> {
  if (categories === null) {
    await prisma.reviewCategory.deleteMany({ where: { key } });
    return;
  }
  // 사본에 없는 칸에는 저장하지 않는다. 주인 없는 줄이 쌓이지 않게 한다.
  const row = await prisma.serviceReview.findUnique({ where: { key }, select: { type: true, part: true } });
  if (!row) throw new Error("후기를 찾지 못했습니다. 새로고침해 주세요.");
  const type = row.type as ReviewType;
  if (!isClassifiedPart(row.part)) throw new Error("이 칸에는 카테고리를 붙이지 않습니다.");
  const normalized = normalizeReviewCategories(
    type,
    categories.filter((value) => value !== UNCLASSIFIED && isReviewCategory(type, value)),
  );
  if (normalized.length === 0) throw new Error("카테고리를 하나 이상 골라 주세요.");
  await prisma.reviewCategory.upsert({
    where: { key },
    create: { key, categories: normalized },
    update: { categories: normalized },
  });
}
