import { prisma } from "@/lib/prisma";
import { CS_INQUIRIES_QUERY, fetchRedashResult, type RedashRow } from "@/lib/redash";

import {
  isCsCategory,
  isTestInquiry,
  lexicalToText,
  normalizeCategories,
  ruleCategories,
  type CsCategory,
} from "./cs-inquiry";
import { errorMessage } from "./service-detail-page";

/**
 * 챌린지 1:1 문의를 모아 사본으로 두는 일(plan.md §5 — CS 수집).
 *
 * 문의는 Redash 쿼리 337 에서 받는다. 원문의 주인은 실서비스라 우리는 읽기만 하고, 답변도 관리자 화면에서 단다.
 * 우리 쪽에 남는 것은 매니저가 고친 카테고리뿐이다.
 */

/** 쿼리 337 이 내보내는 칸. 하나라도 없으면 쿼리가 바뀐 것이라 아무것도 고치지 않는다. */
const REQUIRED_COLUMNS = [
  "문의id",
  "등록일시",
  "고친시각",
  "challenge_id",
  "챌린지",
  "user_id",
  "고객이름",
  "플랜",
  "제목",
  "본문",
  "답변",
  "답변읽은시각",
  "첨부이미지",
];

/** 문의 수백 건을 한 트랜잭션으로 바꾸는 한도. 기본 5초로는 풀러가 붐빌 때 모자란다. */
const WRITE_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 60_000 };

function toInt(value: string | number | null): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return value !== null && value !== "" && Number.isInteger(number) ? number : null;
}

function toText(value: string | number | null): string {
  return value === null ? "" : String(value).trim();
}

/**
 * `2026-09-16 21:11:26` 같은 시각 칸(`T` 구분자 · 소수점 초도 받는다). 운영DB 가 한국 시각으로 적으므로 +09:00 으로 읽는다 —
 * 첨부 이미지 파일 이름에 박힌 업로드 시각과 9시간 차이로 맞는 것을 확인했다(2026-09-16).
 */
function toKstDateTime(value: string | number | null): Date | null {
  const text = toText(value);
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(text)) return null;
  const date = new Date(`${text.replace(" ", "T")}+09:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 첨부 이미지 칸은 주소를 줄바꿈으로 잇는다. 같은 주소는 한 번만 둔다. */
function toUrlList(value: string | number | null): string[] {
  const urls = toText(value)
    .split(/\r?\n/)
    .map((url) => url.trim())
    .filter((url) => /^https?:\/\//.test(url));
  return [...new Set(urls)];
}

type ParsedInquiry = {
  id: number;
  createdAt: Date;
  modifiedAt: Date | null;
  challengeId: number;
  challengeTitle: string;
  userId: number;
  customerName: string;
  plan: string | null;
  title: string;
  body: string;
  imageUrls: string[];
  answer: string | null;
  answerImageUrls: string[];
  answerReadAt: Date | null;
};

function parse(rows: RedashRow[]): { inquiries: ParsedInquiry[]; tests: number; skipped: number } {
  if (rows.length === 0) {
    throw new Error("Redash 쿼리 결과가 비어 있습니다. 쿼리 337 을 확인하세요.");
  }
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !(column in rows[0]));
  if (missingColumns.length > 0) {
    throw new Error(`Redash 쿼리 결과에 칸이 없습니다: ${missingColumns.join(", ")}. 쿼리 337 을 확인하세요.`);
  }

  const inquiries: ParsedInquiry[] = [];
  let tests = 0;
  let skipped = 0;
  for (const row of rows) {
    const id = toInt(row.문의id);
    const challengeId = toInt(row.challenge_id);
    const userId = toInt(row.user_id);
    const createdAt = toKstDateTime(row.등록일시);
    // 열쇠나 등록일시를 못 읽은 줄은 버리되 세어 둔다 — 쿼리 모양이 조금 바뀐 것을 결과 문구로 알아챈다.
    if (id === null || challengeId === null || userId === null || createdAt === null) {
      skipped++;
      continue;
    }

    const inquiry = {
      id,
      createdAt,
      modifiedAt: toKstDateTime(row.고친시각),
      challengeId,
      challengeTitle: toText(row.챌린지),
      userId,
      customerName: toText(row.고객이름),
      plan: toText(row.플랜) || null,
      title: toText(row.제목),
      body: toText(row.본문),
      imageUrls: toUrlList(row.첨부이미지),
      answer: null as string | null,
      answerImageUrls: [] as string[],
      answerReadAt: toKstDateTime(row.답변읽은시각),
    };
    if (isTestInquiry(inquiry)) {
      tests++;
      continue;
    }

    // 답변이 NULL 이면 아직 답하지 않은 문의다. 에디터가 빈 글을 남긴 경우도 답한 것으로 둔다 — 관리자 화면과 같다.
    if (row.답변 !== null && row.답변 !== "") {
      const answer = lexicalToText(String(row.답변));
      inquiry.answer = answer.text;
      inquiry.answerImageUrls = answer.imageUrls;
    }
    inquiries.push(inquiry);
  }

  if (inquiries.length === 0) {
    throw new Error("Redash 쿼리 결과에서 읽어낸 문의가 없습니다. 쿼리 337 을 확인하세요.");
  }
  return { inquiries, tests, skipped };
}

export type CsInquirySyncResult = {
  inquiries: number;
  unanswered: number;
  /** 모으지 않은 테스트 문의 수 */
  tests: number;
  /** 문의id · 등록일시 같은 필수 값을 못 읽어 버린 줄 수 */
  skipped: number;
};

/** 쿼리 결과를 받아 사본을 통째로 바꾼다. 결과를 못 받거나 모양이 바뀌었으면 아무것도 고치지 않고 던진다. */
export async function syncCsInquiries(): Promise<CsInquirySyncResult> {
  const { rows, retrievedAt } = await fetchRedashResult({ fresh: true, query: CS_INQUIRIES_QUERY }).catch(
    (error: unknown) => {
      throw new Error(`Redash 쿼리 결과를 받지 못했습니다. ${errorMessage(error)}`);
    },
  );
  const { inquiries, tests, skipped } = parse(rows);

  try {
    // 사이에서 실패하면 목록이 통째로 비므로 한 트랜잭션이어야 한다. 매니저가 고친 카테고리는 다른 표라 남는다.
    await prisma.$transaction(
      [
        prisma.serviceCsInquiry.deleteMany(),
        prisma.serviceCsInquiry.createMany({
          data: inquiries.map((inquiry) => ({ ...inquiry, queryRetrievedAt: retrievedAt })),
        }),
      ],
      WRITE_TRANSACTION_OPTIONS,
    );
  } catch (error) {
    throw new Error(`쿼리 결과를 저장하지 못했습니다. ${errorMessage(error)}`);
  }

  return {
    inquiries: inquiries.length,
    unanswered: inquiries.filter((inquiry) => inquiry.answer === null).length,
    tests,
    skipped,
  };
}

export type CsInquiryRow = {
  id: number;
  createdAt: string;
  challengeId: number;
  challengeTitle: string;
  customerName: string;
  plan: string | null;
  title: string;
  body: string;
  imageUrls: string[];
  /** 줄글로 옮긴 답변. null 이면 대기 */
  answer: string | null;
  answerImageUrls: string[];
  answerReadAt: string | null;
  /** 지금 붙은 카테고리 — 매니저가 고쳤으면 그것, 아니면 키워드 규칙이 붙인 것 */
  categories: CsCategory[];
  /** 키워드 규칙이 붙이는 카테고리. 매니저가 고친 뒤에도 되돌릴 때 보여준다. */
  ruleCategories: CsCategory[];
  /** 매니저가 카테고리를 고쳤는지 */
  categoriesEdited: boolean;
  /** 매니저가 목록에서 숨겼는지 */
  hidden: boolean;
};

export type CsInquiriesSnapshot = {
  inquiries: CsInquiryRow[];
  /** Redash 에서 쿼리가 돈 시각 */
  queryRetrievedAt: string | null;
};

export async function listCsInquiries(): Promise<CsInquiriesSnapshot> {
  const [rows, edits, hiddens] = await Promise.all([
    prisma.serviceCsInquiry.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
    prisma.csInquiryCategory.findMany(),
    prisma.csInquiryHidden.findMany({ select: { inquiryId: true } }),
  ]);
  const editById = new Map(edits.map((edit) => [edit.inquiryId, edit.categories]));
  const hiddenIds = new Set(hiddens.map((hidden) => hidden.inquiryId));

  return {
    inquiries: rows.map((row) => {
      const rule = ruleCategories(row);
      // 카테고리 이름을 바꾸거나 지워 예전에 고친 값이 하나도 안 남으면 규칙으로 돌아간다 — 어느 칩에도 안 잡히는 문의가 생긴다.
      const editedRaw = editById.get(row.id);
      const edited = editedRaw ? normalizeCategories(editedRaw.filter(isCsCategory)) : [];
      const isEdited = edited.length > 0;
      return {
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        challengeId: row.challengeId,
        challengeTitle: row.challengeTitle,
        customerName: row.customerName,
        plan: row.plan,
        title: row.title,
        body: row.body,
        imageUrls: row.imageUrls,
        answer: row.answer,
        answerImageUrls: row.answerImageUrls,
        answerReadAt: row.answerReadAt ? row.answerReadAt.toISOString() : null,
        categories: isEdited ? edited : rule,
        ruleCategories: rule,
        categoriesEdited: isEdited,
        hidden: hiddenIds.has(row.id),
      };
    }),
    queryRetrievedAt: rows[0] ? rows[0].queryRetrievedAt.toISOString() : null,
  };
}

/**
 * 매니저가 고른 카테고리를 저장한다. null 이면 고친 것을 지워 키워드 규칙으로 되돌린다.
 * 하나도 고르지 않은 채로는 저장하지 않는다 — 목록에서 어느 카테고리에도 안 잡히는 문의가 생긴다.
 */
export async function saveCsInquiryCategories(inquiryId: number, categories: CsCategory[] | null): Promise<void> {
  if (categories === null) {
    await prisma.csInquiryCategory.deleteMany({ where: { inquiryId } });
    return;
  }
  const normalized = normalizeCategories(categories);
  if (normalized.length === 0) throw new Error("카테고리를 하나 이상 골라 주세요.");
  // 사본에 없는 문의에는 저장하지 않는다. 주인 없는 줄이 쌓이지 않게 한다.
  const exists = await prisma.serviceCsInquiry.count({ where: { id: inquiryId } });
  if (exists === 0) throw new Error("문의를 찾지 못했습니다. 새로고침해 주세요.");
  await prisma.csInquiryCategory.upsert({
    where: { inquiryId },
    create: { inquiryId, categories: normalized },
    update: { categories: normalized },
  });
}

/** 문의를 목록에서 숨기거나(true) 다시 보이게(false) 한다. */
export async function setCsInquiryHidden(inquiryId: number, hidden: boolean): Promise<void> {
  if (!hidden) {
    await prisma.csInquiryHidden.deleteMany({ where: { inquiryId } });
    return;
  }
  // 사본에 없는 문의에는 저장하지 않는다. 주인 없는 줄이 쌓이지 않게 한다.
  const exists = await prisma.serviceCsInquiry.count({ where: { id: inquiryId } });
  if (exists === 0) throw new Error("문의를 찾지 못했습니다. 새로고침해 주세요.");
  await prisma.csInquiryHidden.upsert({ where: { inquiryId }, create: { inquiryId }, update: {} });
}
