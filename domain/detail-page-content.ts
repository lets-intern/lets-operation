/**
 * 실서비스 상세페이지 내용을 우리 말로 옮긴 모양과, 그 위에서 찾는 규칙(plan.md §5 — 상세페이지).
 *
 * 화면에서도 그대로 쓰므로 DB 를 모른다. 저장할 때 옮기는 규칙과 화면에서 찾는 규칙이
 * 한 파일에 있어야 목록의 일치 건수와 미리보기에 칠해지는 곳의 수가 어긋나지 않는다.
 */

/** 상세페이지 이미지가 올라가는 저장소. 이미지를 대신 받아줄 때 이 주소만 받는다. */
export const DETAIL_IMAGE_HOST = "letsintern-bucket.s3.ap-northeast-2.amazonaws.com";

/** 실서비스 사이트. 화면 고정 이미지는 이 주소의 `/images/` 아래에만 있다. */
export const SERVICE_SITE_ORIGIN = "https://www.letscareer.co.kr";
const SITE_IMAGE_PATH = "/images/";

/**
 * 글자를 읽으려고 대신 받아줄 수 있는 이미지인지. 저장소 이미지와, 실서비스 코드에 박힌
 * 화면 고정 이미지 경로 하나만 받는다(plan.md §5). URL 이 `..` 을 미리 풀어두므로 경로 앞머리만 보면 된다.
 */
export function isDetailImageSrc(src: string): boolean {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "") {
    return false;
  }
  if (url.hostname === DETAIL_IMAGE_HOST) return true;
  // 인코딩된 구분자(`..%2F`)는 URL 이 풀지 않아 앞머리 검사를 지나가므로 따로 막는다.
  return (
    url.origin === SERVICE_SITE_ORIGIN &&
    url.pathname.startsWith(SITE_IMAGE_PATH) &&
    !/%2f|%5c/i.test(url.pathname) &&
    /\.(png|jpe?g|gif|webp)$/i.test(url.pathname)
  );
}

/** 사람이 주소를 적지 않는다. 챌린지 id 로 만든다. */
export function detailPageUrl(id: number): string {
  return `${SERVICE_SITE_ORIGIN}/program/challenge/${id}`;
}

export type DetailBlock =
  /** 페이지 제목. 상단에만 선다. */
  | { kind: "title"; text: string }
  /** screen: API 에 없어 실서비스 화면을 띄워 읽은 글(mergeScreen) */
  | { kind: "text"; text: string; screen?: true }
  | { kind: "link"; text: string; href: string }
  | { kind: "image"; src: string; screen?: true }
  /** 커리큘럼 회차 · 포인트 · 후기 · FAQ 처럼 제목과 본문이 짝을 이루는 칸 */
  | { kind: "item"; title: string; body: string; meta: string }
  /** 상단의 요금제 탭. 탭 이름과 탭마다의 설명 · 가격 · 옵션 */
  | { kind: "plans"; plans: DetailPlan[] };

export type DetailPlan = { label: string; meta: string; body: string };

/** 실서비스 페이지에 서는 차례 그대로 둔다. */
export const DETAIL_SECTION_KEYS = [
  "header",
  "intro",
  "point",
  "curriculum",
  "review",
  "notice",
  "faq",
] as const;

export type DetailSectionKey = (typeof DETAIL_SECTION_KEYS)[number];

export const DETAIL_SECTION_LABELS: Record<DetailSectionKey, string> = {
  header: "상단",
  intro: "소개",
  point: "챌린지 포인트",
  curriculum: "커리큘럼",
  review: "후기",
  notice: "유의사항",
  faq: "FAQ",
};

export type DetailSection = { key: DetailSectionKey; blocks: DetailBlock[] };

export type DetailPageContent = { sections: DetailSection[] };

export const DETAIL_STATUS_LABELS: Record<string, string> = {
  PREV: "모집 전",
  PROCEEDING: "진행 중",
  POST: "지난",
};

// ── 공개 API 응답 읽기 ──────────────────────────────────────────────
// 문서화된 API 가 아니라 모양이 언제든 바뀔 수 있다. 모르는 모양은 버리고 넘어간다.

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** 에디터 내용은 객체로도, 그 객체를 문자열로 굳힌 값으로도 온다. */
function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function pushText(blocks: DetailBlock[], text: string) {
  const trimmed = text.replace(/\n{3,}/g, "\n\n").trim();
  if (trimmed) blocks.push({ kind: "text", text: trimmed });
}

/**
 * 저장소 밖 주소의 이미지도 사본에는 넣는다. 빼면 미리보기에서 이미지가 아예 사라져
 * 없는 줄 안다. 글자 읽기만 저장소 이미지로 거른다(isDetailImageSrc).
 */
function pushImage(blocks: DetailBlock[], src: unknown) {
  const value = asString(src);
  if (/^https:\/\//i.test(value)) blocks.push({ kind: "image", src: value });
}

const HTML_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (_, name: string) => HTML_ENTITIES[name]);
}

function inlineText(node: Record<string, unknown>): string {
  if (node.type === "text") return asString(node.text);
  if (node.type === "linebreak") return "\n";
  return asArray(node.children)
    .map((child) => {
      const record = asRecord(child);
      return record ? inlineText(record) : "";
    })
    .join("");
}

/**
 * 소개 영역의 에디터(Lexical) 내용을 문단 · 이미지 · 링크로 편다.
 * 문단 안에 이미지나 링크가 끼면 그 앞뒤로 끊어, 칠해지는 글과 이미지의 차례가 페이지와 같게 한다.
 */
function lexicalBlocks(value: unknown): DetailBlock[] {
  const parsed = parseMaybeJson(value);
  if (typeof parsed === "string") {
    const blocks: DetailBlock[] = [];
    pushText(blocks, parsed);
    return blocks;
  }

  const root = asRecord(asRecord(parsed)?.root);
  if (!root) return [];

  const blocks: DetailBlock[] = [];
  let buffer = "";
  const flush = () => {
    pushText(blocks, buffer);
    buffer = "";
  };

  /** alone: 부모 문단에 이 노드 하나뿐인지. 단독 링크는 버튼처럼 따로 세운다. */
  const visit = (child: unknown, alone = false) => {
    const node = asRecord(child);
    if (!node) return;
    switch (node.type) {
      case "text":
        buffer += asString(node.text);
        return;
      case "linebreak":
        buffer += "\n";
        return;
      case "image":
        flush();
        pushImage(blocks, node.src);
        return;
      case "link":
      case "autolink": {
        const href = asString(node.url);
        // 링크로 감싼 배너 이미지가 흔하다. 이미지를 링크 글로 뭉개면 페이지에서 사라진다.
        const images = asArray(node.children).filter((grandchild) => asRecord(grandchild)?.type === "image");
        const text = inlineText(node);
        // 문장 속 글 링크는 문단에 그대로 잇는다. 끊으면 "환급 [조건] 안내" 를 "환급 조건" 으로 못 찾는다.
        if (images.length === 0 && !alone) {
          buffer += text;
          return;
        }
        flush();
        const label = text.trim() || (images.length === 0 ? href : "");
        if (label) blocks.push({ kind: "link", text: label, href });
        for (const image of images) pushImage(blocks, asRecord(image)?.src);
        return;
      }
      default: {
        const children = asArray(node.children);
        for (const grandchild of children) visit(grandchild, children.length === 1);
        // 문단 · 제목 · 목록 항목은 줄을 바꿔 다음 것과 붙지 않게 한다.
        buffer += "\n";
      }
    }
  };

  for (const child of asArray(root.children)) visit(child);
  flush();
  return blocks;
}

function htmlText(html: string): string {
  return decodeEntities(
    html.replace(/<br\s*\/?>|<\/(?:p|div|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, ""),
  );
}

/** 초기 기수의 HTML 본문 · 유의사항을 글과 이미지로 편다. 이미지가 선 자리 그대로 끊는다. */
function htmlBlocks(html: string): DetailBlock[] {
  const blocks: DetailBlock[] = [];
  let at = 0;
  for (const match of html.matchAll(/<img\b[^>]*?\bsrc="([^"]+)"[^>]*>/gi)) {
    pushText(blocks, htmlText(html.slice(at, match.index)));
    pushImage(blocks, decodeEntities(match[1]));
    at = match.index + match[0].length;
  }
  pushText(blocks, htmlText(html.slice(at)));
  return blocks;
}

/** `2026-09-21T11:00:00` → `2026.09.21`. 모르는 모양이면 빈 글. */
function dotDate(value: unknown): string {
  const ymd = asString(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd.replaceAll("-", ".") : "";
}

function period(label: string, from: unknown, to: unknown): string {
  const start = dotDate(from);
  const end = dotDate(to);
  return start || end ? `${label} ${start} ~ ${end}` : "";
}

/** 페이지 맨 위 — 썸네일 · 제목 · 한 줄 소개 · 모집 / 진행 기간(plan.md §5). */
function headerBlocks(page: Record<string, unknown>): DetailBlock[] {
  const blocks: DetailBlock[] = [];
  // 데스크톱용과 모바일용이 따로 있으면 둘 다 둔다. 한쪽만 고친 것을 찾을 수 있어야 한다.
  for (const src of new Set([asString(page.desktopThumbnail), asString(page.thumbnail)])) {
    pushImage(blocks, src);
  }
  const title = asString(page.title).trim();
  if (title) blocks.push({ kind: "title", text: title });
  const shortDesc = asString(page.shortDesc).trim();
  // 초기 기수는 한 줄 소개 자리에 "-" 만 적혀 있다.
  if (shortDesc !== "-") pushText(blocks, shortDesc);
  pushText(
    blocks,
    [period("모집", page.beginning, page.deadline), period("진행", page.startDate, page.endDate)]
      .filter(Boolean)
      .join(" · "),
  );
  const plans = planTabs(page.priceInfo);
  if (plans.length > 0) blocks.push({ kind: "plans", plans });
  return blocks;
}

function won(value: number): string {
  return `${value.toLocaleString("ko-KR")}원`;
}

const PRICE_PLAN_LABELS: Record<string, string> = {
  LIGHT: "라이트",
  BASIC: "베이직",
  STANDARD: "스탠다드",
  PREMIUM: "프리미엄",
};

/** 실서비스 탭 차례. 저쪽 응답은 라이트를 맨 끝에 주므로 여기서 다시 세운다. */
const PRICE_PLAN_ORDER = ["LIGHT", "BASIC", "STANDARD", "PREMIUM"];

/**
 * 상단 요금제 탭(plan.md §5). 탭 이름은 요금제 종류에서 정한다 — 저쪽 이름 칸은 비거나
 * 끝에 공백이 붙거나 기수 이름이 들어가 있다. 종류 이름과 다른 값이면 설명 위에 함께 적는다.
 */
function planTabs(priceInfo: unknown): DetailPlan[] {
  const rank = (plan: string) => {
    const index = PRICE_PLAN_ORDER.indexOf(plan);
    return index < 0 ? PRICE_PLAN_ORDER.length : index;
  };
  return asArray(priceInfo)
    .flatMap((raw) => {
      const item = asRecord(raw);
      return item ? [item] : [];
    })
    .map((item, position) => ({ item, position, plan: asString(item.challengePricePlanType) }))
    // 같은 차례끼리는 응답 순서를 지킨다.
    .sort((a, b) => rank(a.plan) - rank(b.plan) || a.position - b.position)
    .map(({ item, plan }) => {
      const written = asString(item.title).trim();
      const label = PRICE_PLAN_LABELS[plan] ?? (written || plan || "가격");
      const options = asArray(item.challengeOptionList).flatMap((option) => {
        const record = asRecord(option);
        return record ? [`옵션 ${asString(record.title)} ${won(asNumber(record.price))}`] : [];
      });
      const meta = [
        written && written !== label ? written : "",
        asNumber(item.price) > 0 ? `정가 ${won(asNumber(item.price))}` : "",
        asNumber(item.discount) > 0 ? `할인 ${won(asNumber(item.discount))}` : "",
        asNumber(item.refund) > 0 ? `환급 ${won(asNumber(item.refund))}` : "",
        ...options,
      ]
        .filter(Boolean)
        .join(" · ");
      return { label, meta, body: asString(item.description).trim() };
    });
}

/**
 * `GET /challenge/{id}` 의 data 를 우리 모양으로 옮긴다.
 *
 * 모양을 알아보지 못하면 던진다. 빈 내용을 성공으로 돌려주면 저쪽이 키 이름만 바꿔도
 * 받아둔 사본이 조용히 빈 것으로 덮이고 검색이 0건이 된다(plan.md §5 — 실패는 사유와 함께 남긴다).
 */
export function toDetailPageContent(data: unknown): DetailPageContent {
  const page = asRecord(data);
  const parsedDesc = parseMaybeJson(page?.desc);
  // 2024년 초기 기수는 에디터 JSON 이 아니라 HTML 문자열로 적혀 있다.
  const legacyHtml = typeof parsedDesc === "string" && /<[a-z]/i.test(parsedDesc) ? parsedDesc : null;
  if (!page || (!asRecord(parsedDesc) && legacyHtml === null)) {
    throw new Error("상세 내용의 모양을 알아보지 못했습니다.");
  }
  const desc = asRecord(parsedDesc) ?? {};

  const header = headerBlocks(page);

  const intro: DetailBlock[] = [];
  if (legacyHtml !== null) intro.push(...htmlBlocks(legacyHtml));
  intro.push(...lexicalBlocks(desc.intro));
  intro.push(...lexicalBlocks(desc.mainDescription));
  intro.push(...lexicalBlocks(desc.freeContent));

  const point: DetailBlock[] = asArray(asRecord(desc.challengePoint)?.list).flatMap((raw) => {
    const item = asRecord(raw);
    if (!item) return [];
    return [{ kind: "item", title: asString(item.title), body: asString(item.subtitle), meta: "" }];
  });

  const curriculum: DetailBlock[] = [];
  pushImage(curriculum, desc.curriculumImage);
  for (const raw of asArray(desc.curriculum)) {
    const item = asRecord(raw);
    if (!item) continue;
    curriculum.push({
      kind: "item",
      title: asString(item.title),
      body: asString(item.content),
      meta: asString(item.session),
    });
  }

  const review: DetailBlock[] = [];
  for (const raw of asArray(desc.challengeReview)) {
    const item = asRecord(raw);
    if (!item) continue;
    review.push({
      kind: "item",
      title: asString(item.title),
      body: asString(item.content),
      meta: [item.name, item.programName, item.passedState].map(asString).filter(Boolean).join(" · "),
    });
  }
  for (const raw of asArray(asRecord(desc.blogReview)?.list)) {
    const item = asRecord(raw);
    if (!item) continue;
    review.push({ kind: "item", title: asString(item.title), body: "", meta: "블로그 후기" });
  }

  const rawNotice = asString(page.criticalNotice);
  const notice = rawNotice.trim().startsWith("{") ? lexicalBlocks(rawNotice) : htmlBlocks(rawNotice);

  const faq: DetailBlock[] = asArray(page.faqInfo).flatMap((raw) => {
    const item = asRecord(raw);
    if (!item) return [];
    return [
      {
        kind: "item",
        title: asString(item.question),
        body: asString(item.answer),
        meta: asString(item.category),
      },
    ];
  });

  const byKey: Record<DetailSectionKey, DetailBlock[]> = {
    header,
    intro,
    point,
    curriculum,
    review,
    notice,
    faq,
  };
  const sections = DETAIL_SECTION_KEYS.map((key) => ({ key, blocks: byKey[key] })).filter(
    (section) => section.blocks.length > 0,
  );
  // 상단은 목록에도 있는 값이라 늘 찬다. 본문 칸이 하나도 없어야 모양이 바뀐 것으로 본다.
  if (!sections.some((section) => section.key !== "header")) {
    throw new Error("상세 내용에서 읽어낸 칸이 하나도 없습니다.");
  }
  return { sections };
}

export function isDetailPageContent(value: unknown): value is DetailPageContent {
  return Array.isArray(asRecord(value)?.sections);
}

// ── 화면에서 읽은 글 끼워 넣기 ──────────────────────────────────────
// API 에 없는 화면 고정 문구를 실서비스 페이지를 띄워 읽어 채운다(plan.md §5 — 화면에만 있는 문구).

/** 실서비스 화면에 보이는 차례 그대로의 한 줄 또는 이미지 한 장. */
export type ScreenItem = { text: string } | { image: string };

export function isScreenItems(value: unknown): value is ScreenItem[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof asRecord(item)?.text === "string" || typeof asRecord(item)?.image === "string")
  );
}

/**
 * 화면에서 뽑은 이미지 주소를 받아둘 모양으로 바꾼다. 넣지 않을 이미지면 null.
 * `/_next/image?url=…` 은 사이트가 원본을 줄여 내려주는 주소라 원본으로 되돌려야 API 이미지와 맞춰진다.
 * 아이콘(SVG)은 글자를 품지 않고 수가 많아 뺀다.
 */
export function screenImageSrc(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw, SERVICE_SITE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin === SERVICE_SITE_ORIGIN && url.pathname === "/_next/image") {
    const original = url.searchParams.get("url");
    return original ? screenImageSrc(original) : null;
  }
  if (url.protocol !== "https:") return null;
  if (/\.svg$/i.test(url.pathname) || url.pathname.startsWith("/icons/")) return null;
  return url.href;
}

/** 이만큼 넘는 묶음이 곧바로 한 번 더 나오면 흘러가는 띠의 복제로 본다. 짧은 되풀이(날짜 · "진행 방식")는 진짜다. */
const MIN_REPEAT_RUN = 3;

/**
 * 후기 띠처럼 끝없이 흐르게 하려고 같은 목록을 여러 벌 이어 그린 곳을 한 벌로 줄인다.
 * 같은 묶음이 떨어져서 다시 나오는 것(상단과 모집개요의 기간)은 화면에 실제로 두 번 있는 글이라 둔다.
 */
export function dropRepeatedRuns(items: ScreenItem[]): ScreenItem[] {
  const keys = items.map((item) => ("text" in item ? `t:${item.text}` : `i:${item.image}`));
  const sameRun = (a: number, b: number, size: number) => {
    for (let k = 0; k < size; k++) if (keys[a + k] !== keys[b + k]) return false;
    return true;
  };
  const out: ScreenItem[] = [];
  let i = 0;
  while (i < items.length) {
    // 가장 짧은 한 벌부터 찾는다. 긴 것부터 찾으면 네 벌 그린 띠가 "두 벌짜리 한 벌"로 잡혀 두 벌이 남는다.
    // 같은 줄만 되풀이되는 칸(비교표의 "✓" 여러 개)은 띠가 아니라 실제로 여러 번 있는 글이다.
    const largest = Math.floor((items.length - i) / 2);
    let size = MIN_REPEAT_RUN;
    while (size <= largest && !(sameRun(i, i + size, size) && new Set(keys.slice(i, i + size)).size > 1)) {
      size += 1;
    }
    if (size > largest) {
      out.push(items[i]);
      i += 1;
      continue;
    }
    out.push(...items.slice(i, i + size));
    i += size;
    // 띠 라이브러리는 폭을 채우려고 서너 벌 그리기도 한다. 같은 벌이 이어지는 동안 모두 건너뛴다.
    while (i + size <= items.length && sameRun(i - size, i, size)) i += size;
  }
  return out;
}

/**
 * 화면에서 읽은 줄이 API 칸과 같은 자리라고 믿을 만한지. 짧은 줄("1회차" · "베이직")이나 긴 본문 속
 * 한 구절이 들어맞은 것으로 자리를 옮기면, FAQ 답에 우연히 든 구절 하나에 뒤따르는 글이 전부 FAQ 로 끌려간다.
 */
function anchorsAt(folded: string, field: string): boolean {
  return (
    folded.length >= 8 &&
    (folded.length * 3 >= field.length || (folded.length >= 20 && folded.length * 10 >= field.length))
  );
}

/**
 * API 로 옮긴 내용에 화면에서만 읽힌 줄과 이미지를 끼워 넣는다.
 *
 * - API 칸에 이미 든 글은 버린다. 같은 문구가 두 번 잡혀 건수가 부풀면 안 된다.
 * - 없는 글은 화면에서 바로 앞에 나온 API 칸 뒤에 둔다. 자리는 앞으로만 옮긴다 — 실서비스는 요금제를
 *   상단과 가격 플랜 칸에 두 번 그리는데, 뒤의 것에 맞춰 상단으로 돌아가면 뒤따르는 글이 상단에 쌓인다.
 * - 이어진 줄은 한 칸으로 묶는다. 미리보기가 줄마다 칸을 세우면 너무 성기다.
 */
export function mergeScreen(content: DetailPageContent, screen: ScreenItem[]): DetailPageContent {
  type Slot = { fields: string[]; src: string | null };
  const slots: Slot[] = content.sections.flatMap((section) =>
    section.blocks.map((block) => {
      const fields = blockTexts(block, {})
        .map((text) => fold(text).folded)
        .filter(Boolean);
      // 화면은 한 칸의 이름과 값을 한 줄로 잇기도 한다("베이직 49,000원"). 이어 붙인 것도 같은 칸으로 본다.
      if (fields.length > 1) fields.push(fields.join(""));
      return { fields, src: block.kind === "image" ? block.src : null };
    }),
  );

  // 열쇠는 이 칸 뒤에 끼울 것. -1 은 첫 API 칸보다 앞이다.
  const inserts = new Map<number, DetailBlock[]>();
  const seenImages = new Set(slots.flatMap((slot) => (slot.src ? [slot.src] : [])));
  let cursor = -1;
  let run: string[] = [];

  const insertHere = (block: DetailBlock) => {
    const list = inserts.get(cursor);
    if (list) list.push(block);
    else inserts.set(cursor, [block]);
  };
  const flushRun = () => {
    if (run.length > 0) insertHere({ kind: "text", text: run.join("\n"), screen: true });
    run = [];
  };
  const moveTo = (index: number) => {
    flushRun();
    cursor = index;
  };
  const locate = (needle: string, from: number, to: number) => {
    for (let index = from; index < to; index++) {
      const field = slots[index].fields.find((candidate) => candidate.includes(needle));
      if (field !== undefined) return { index, field };
    }
    return null;
  };

  for (const item of screen) {
    if ("image" in item) {
      const at = slots.findIndex((slot, index) => index > cursor && slot.src === item.image);
      if (at >= 0) {
        moveTo(at);
      } else if (!seenImages.has(item.image)) {
        seenImages.add(item.image);
        flushRun();
        insertHere({ kind: "image", src: item.image, screen: true });
      }
      continue;
    }

    const needle = fold(item.text).folded;
    // 이모지나 구분 기호만 있는 줄은 찾을 거리가 아니다.
    if (!/[\p{L}\p{N}]/u.test(needle)) continue;
    const ahead = locate(needle, cursor + 1, slots.length);
    if (ahead) {
      if (anchorsAt(needle, ahead.field)) moveTo(ahead.index);
      continue;
    }
    if (locate(needle, 0, cursor + 1)) continue;
    run.push(item.text.trim());
  }
  flushRun();

  if (inserts.size === 0) return content;
  let index = 0;
  return {
    sections: content.sections.map((section, sectionIndex) => {
      const blocks: DetailBlock[] = sectionIndex === 0 ? [...(inserts.get(-1) ?? [])] : [];
      for (const block of section.blocks) {
        blocks.push(block, ...(inserts.get(index) ?? []));
        index += 1;
      }
      return { ...section, blocks };
    }),
  };
}

export function contentImageSrcs(content: DetailPageContent): string[] {
  return content.sections.flatMap((section) =>
    section.blocks.flatMap((block) => (block.kind === "image" ? [block.src] : [])),
  );
}

// ── 찾기 ────────────────────────────────────────────────────────────

/** 공백으로 치는 글자. 정규식을 글자마다 돌리면 백몇십 페이지를 찾을 때 느려서 코드로 가른다. */
function isSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 160 || code === 0x3000;
}

/**
 * text 안에서 query 가 나오는 자리를 원문 기준 [시작, 끝) 으로 돌려준다.
 *
 * 대소문자와 공백을 가리지 않는다. OCR 이 띄어쓰기를 자주 틀려서, "환급 조건" 으로 찾을 때
 * "환급조건" 으로 읽힌 이미지도 걸려야 한다(plan.md §5).
 */
export function findMatches(text: string, query: string): Array<[number, number]> {
  const needle = fold(query).folded;
  if (!needle || !text) return [];

  const { folded, origin } = fold(text);
  const ranges: Array<[number, number]> = [];
  let from = 0;
  let previousEnd = 0;
  for (;;) {
    const at = folded.indexOf(needle, from);
    if (at < 0) break;
    // 소문자로 바꾸면 한 글자가 둘이 되는 드문 경우 범위가 겹칠 수 있어 앞 범위 뒤로 민다.
    const start = Math.max(origin[at], previousEnd);
    const end = origin[at + needle.length - 1] + 1;
    if (start < end) {
      ranges.push([start, end]);
      previousEnd = end;
    }
    from = at + needle.length;
  }
  return ranges;
}

type Folded = { folded: string; origin: number[] };

/**
 * 공백을 걷고 소문자로 접은 글과, 접은 글의 각 자리가 원문 몇 번째 글자인지.
 * 글자를 칠 때마다 백몇십 페이지 · 수백 장 OCR 글을 다시 접지 않도록 글마다 한 번만 만든다.
 */
const foldCache = new Map<string, Folded>();
const FOLD_CACHE_LIMIT = 50_000;

function fold(text: string): Folded {
  const cached = foldCache.get(text);
  if (cached) return cached;

  let folded = "";
  const origin: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (isSpace(text.charCodeAt(i))) continue;
    const lower = text[i].toLowerCase();
    for (let k = 0; k < lower.length; k++) {
      folded += lower[k];
      origin.push(i);
    }
  }

  if (foldCache.size >= FOLD_CACHE_LIMIT) foldCache.clear();
  const value = { folded, origin };
  foldCache.set(text, value);
  return value;
}

/**
 * 한 칸에서 찾는 글들. 미리보기가 칠하는 글과 똑같은 것만 돌려줘야 건수가 어긋나지 않는다.
 * 이미지는 읽어낸 글에서 찾는다. 아직 읽지 않았으면 찾을 글이 없다.
 */
export function blockTexts(block: DetailBlock, imageTexts: Record<string, string>): string[] {
  switch (block.kind) {
    case "title":
    case "text":
    case "link":
      return [block.text];
    case "item":
      return [block.meta, block.title, block.body];
    case "plans":
      // 탭 이름은 늘 보이고, 설명은 고른 탭과 걸린 탭만 펼쳐지므로 접힌 탭의 설명에는 일치가 없다.
      return block.plans.flatMap((plan) => [plan.label, plan.meta, plan.body]);
    case "image":
      return [imageTexts[block.src] ?? ""];
  }
}

export type PageMatchSummary = {
  total: number;
  /** 이미지 속 글자에서 찾은 건수. 부정확할 수 있어 따로 알린다. */
  inImages: number;
  sections: { key: DetailSectionKey; count: number }[];
};

export function summarizeMatches(
  content: DetailPageContent,
  imageTexts: Record<string, string>,
  query: string,
): PageMatchSummary {
  const summary: PageMatchSummary = { total: 0, inImages: 0, sections: [] };
  for (const section of content.sections) {
    let count = 0;
    for (const block of section.blocks) {
      for (const text of blockTexts(block, imageTexts)) {
        const hits = findMatches(text, query).length;
        count += hits;
        if (block.kind === "image") summary.inImages += hits;
      }
    }
    if (count > 0) summary.sections.push({ key: section.key, count });
    summary.total += count;
  }
  return summary;
}
