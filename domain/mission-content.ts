import { asArray, asRecord, asString, findMatches } from "./detail-page-content";

/**
 * 미션 콘텐츠 본문을 우리 말로 옮긴 모양과, 그 위에서 찾는 규칙(plan.md §5 — 미션 콘텐츠).
 *
 * 콘텐츠는 모두 Notion 으로 만들어져 oopy 페이지든 Notion 게시 페이지든 같은 블록 데이터로 받는다.
 * 화면에서도 그대로 쓰므로 DB 도 네트워크도 모른다. 옮기는 규칙과 찾는 규칙이 한 파일에 있어야
 * 목록의 일치 건수와 미리보기에 칠해지는 곳의 수가 어긋나지 않는다.
 */

/** 이미지 · 하위 페이지 주소를 만들 때 쓰는 Notion 게시 사이트. oopy 콘텐츠도 같은 워크스페이스다. */
export const NOTION_SITE_ORIGIN = "https://letsintern.notion.site";

export type MissionContentKind = "TEMPLATE" | "ESSENTIAL" | "ADDITIONAL" | "LIMITED" | "UNKNOWN";

/**
 * 쿼리 335 의 `연결구분값`. 1~3 은 `mission_contents.contents_type` 으로 실서비스 관리자 화면의 목록
 * 차례(필수 · 추가 · 제한)와 같다. 4 는 콘텐츠가 아니라 미션 템플릿(`mission_template.template_link`)을
 * 쿼리가 이어 붙인 줄이다.
 */
export const MISSION_CONTENT_KIND_BY_VALUE: Record<number, MissionContentKind> = {
  1: "ESSENTIAL",
  2: "ADDITIONAL",
  3: "LIMITED",
  4: "TEMPLATE",
};

export const MISSION_CONTENT_KIND_LABELS: Record<MissionContentKind, string> = {
  TEMPLATE: "템플릿",
  ESSENTIAL: "필수",
  ADDITIONAL: "추가",
  LIMITED: "제한",
  UNKNOWN: "기타",
};

/** 게시 사이트가 아니라 Notion 앱 · 공유 주소로 적힌 것들. 페이지 id 는 같아서 게시 사이트에서 받는다. */
const NOTION_APP_HOSTS = new Set(["app.notion.com", "www.notion.so", "notion.so"]);

export type MissionContentSource = "oopy" | "notion" | "other";

export const MISSION_CONTENT_SOURCE_LABELS: Record<MissionContentSource, string> = {
  oopy: "oopy",
  notion: "Notion",
  other: "외부 링크",
};

/** 본문을 받을 수 있는 링크인지. 그 밖의 링크(구글 드라이브 · 폼 등)는 링크만 둔다. */
export function contentSource(link: string): MissionContentSource {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return "other";
  }
  if (url.protocol !== "https:") return "other";
  if (url.hostname.endsWith(".oopy.io")) return "oopy";
  // app.notion.com · www.notion.so 주소도 같은 워크스페이스의 공개 페이지라 게시 사이트 API 로 받힌다
  // (미션 템플릿 1개 · 챌린지 가이드 3개 · 공지 9개, 2026-09-16).
  if (url.hostname.endsWith(".notion.site")) return "notion";
  if (NOTION_APP_HOSTS.has(url.hostname)) return "notion";
  return "other";
}

/**
 * Notion 주소 끝의 32자리에서 페이지 id 를 만든다. 앞에 붙은 제목 조각(`/1-959f…`)은
 * 사람이 바꿀 수 있어 보지 않는다.
 */
export function notionPageIdFromUrl(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const last = url.pathname.split("/").filter(Boolean).pop() ?? "";
  const match = /([0-9a-f]{32})$/i.exec(last.replaceAll("-", ""));
  if (!match) return null;
  const hex = match[1].toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type NotionBlockKind =
  | "heading"
  | "text"
  | "bulleted"
  | "numbered"
  | "todo"
  | "quote"
  | "callout"
  | "toggle"
  | "code"
  | "equation"
  | "divider"
  | "image"
  | "link"
  | "page"
  | "database"
  | "table"
  | "columns"
  | "column";

export type NotionBlock = {
  kind: NotionBlockKind;
  /** 블록에 적힌 글. 이미지는 캡션, 링크 · 하위 페이지 · 데이터베이스는 이름. */
  text: string;
  children?: NotionBlock[];
  /** heading · 제목 모양 toggle 의 수준(1~3) */
  level?: number;
  checked?: boolean;
  /** callout 의 이모지 */
  icon?: string;
  href?: string;
  src?: string;
  /** table: 줄마다 칸 글 */
  rows?: string[][];
  /** table: 첫 줄이 머리글인지 */
  header?: boolean;
};

export type NotionDoc = {
  title: string;
  blocks: NotionBlock[];
  /** Notion 페이지 id. 2026-09-16 전에 받은 사본에는 없고, 다음 불러오기에서 채워진다. */
  pageId?: string;
};

/**
 * 게시된 웹(oopy · notion.site)이 아니라 Notion 에서 원본을 연다. 워크스페이스 멤버는 편집 화면이,
 * Notion 앱에서 링크 열기를 켠 사람은 앱이 열린다.
 */
export function notionEditUrl(pageId: string): string {
  return `https://www.notion.so/${pageId.replaceAll("-", "")}`;
}

export function isNotionDoc(value: unknown): value is NotionDoc {
  return Array.isArray(asRecord(value)?.blocks);
}

// ── Notion 블록 데이터 읽기 ─────────────────────────────────────────
// 문서화된 API 가 아니라 모양이 언제든 바뀔 수 있다. 모르는 블록은 글만 건지거나 버린다.

type RecordTable = Record<string, unknown>;

/** 너무 깊은 중첩이나 서로를 가리키는 동기화 블록에서 멈추기 위한 한계 */
const MAX_DEPTH = 40;

/** 레코드 값. oopy 는 `{ value: { value } }`, Notion 게시 페이지는 `{ value }` 로 한 겹 다르다. */
function recordValue(record: unknown): Record<string, unknown> | null {
  const outer = asRecord(asRecord(record)?.value);
  const inner = asRecord(outer?.value);
  return inner && (typeof inner.id === "string" || typeof inner.type === "string") ? inner : outer;
}

/** 지워졌거나 권한이 없어 값이 비어 있는 블록은 없는 것으로 친다. */
function blockValue(blocks: RecordTable, id: string): Record<string, unknown> | null {
  const value = recordValue(blocks[id]);
  return value && typeof value.type === "string" && value.alive !== false ? value : null;
}

/** 서식이 붙은 글 조각 배열을 글로 편다. 인라인 멘션(`‣`)은 가리키는 페이지 이름 · 날짜로 바꾼다. */
function richText(value: unknown, blocks: RecordTable): string {
  return asArray(value)
    .map((segment) => {
      const parts = asArray(segment);
      const text = asString(parts[0]);
      if (text !== "‣" && text !== "⁍") return text;
      for (const decoration of asArray(parts[1])) {
        const [type, argument] = asArray(decoration);
        if (type === "p") return pageTitle(blocks, asString(argument));
        if (type === "d") return asString(asRecord(argument)?.start_date);
        if (type === "e") return asString(argument);
      }
      return "";
    })
    .join("");
}

function pageTitle(blocks: RecordTable, id: string): string {
  const value = blockValue(blocks, id);
  return value ? richText(asRecord(value.properties)?.title, blocks) : "";
}

/**
 * Notion 저장소의 이미지는 서명된 주소라 그대로 열면 막힌다. Notion 게시 사이트의 이미지 통로로
 * 연다 — 게시된 페이지의 이미지만 열리므로 새로 권한을 넓히는 일이 아니다.
 */
function imageSrc(id: string, value: Record<string, unknown>, blocks: RecordTable): string {
  const properties = asRecord(value.properties);
  const format = asRecord(value.format);
  const source = richText(properties?.source, blocks) || asString(format?.display_source);
  if (source.startsWith("attachment:") || /^https:\/\/[^/]*amazonaws\.com\//.test(source)) {
    const space = asString(value.space_id);
    return (
      `${NOTION_SITE_ORIGIN}/image/${encodeURIComponent(source)}?table=block&id=${id}` +
      (space ? `&spaceId=${space}` : "") +
      "&cache=v2"
    );
  }
  return /^https:\/\//i.test(source) ? source : "";
}

const HEADING_LEVELS: Record<string, number> = { header: 1, sub_header: 2, sub_sub_header: 3 };

const LINK_TYPES = new Set(["bookmark", "embed", "video", "audio", "file", "pdf", "figma", "drive"]);

/** 그리지 않는 블록. 목차 · 경로 · 버튼은 본문 글이 아니고, 표 줄은 표가 대신 읽는다. */
const SKIPPED_TYPES = new Set(["table_of_contents", "breadcrumb", "button", "table_row"]);

/**
 * oopy 기능을 켜는 설정 코드 블록인지. `pagePassword: false`(콘텐츠 162개) · 슬라이드 `ratio: 1.0 # …`
 * 처럼 영문 `키: 값` 줄로만 이뤄진다. 본문이 아니라 매 콘텐츠 맨 위에 같은 글이 서고 찾기에도 걸린다.
 * 콘텐츠의 코드 예시는 한글 문장이나 프롬프트라 이 모양에 들지 않는다(2026-09-14 전수 확인).
 */
function isOopyConfig(text: string): boolean {
  const lines = text.split("\n").filter((line) => line.trim());
  return lines.length > 0 && lines.every((line) => /^\s*[A-Za-z]+\s*:\s*[^#\n]*(#.*)?$/.test(line));
}

/**
 * 한 페이지의 블록 데이터를 NotionDoc 으로 옮긴다. 하위 페이지는 안으로 들어가지 않고 이름만 둔다.
 *
 * 모양을 알아보지 못하면 던진다. 빈 본문을 성공으로 돌려주면 저쪽이 키 이름만 바꿔도
 * 받아둔 사본이 조용히 빈 것으로 덮이고 검색이 0건이 된다(plan.md §5).
 */
export function toNotionDoc(
  recordMap: unknown,
  rootId: string,
  pageHref: (id: string) => string,
): NotionDoc {
  const map = asRecord(recordMap);
  const blocks = asRecord(map?.block) ?? {};
  const collections = asRecord(map?.collection) ?? {};
  const root = blockValue(blocks, rootId);
  if (!root || root.type !== "page") {
    throw new Error("Notion 페이지 모양을 알아보지 못했습니다.");
  }

  const convertChildren = (ids: unknown, path: string[]): NotionBlock[] => {
    if (path.length > MAX_DEPTH) return [];
    return asArray(ids).flatMap((raw) => {
      const id = asString(raw);
      const value = id && !path.includes(id) ? blockValue(blocks, id) : null;
      return value ? convertBlock(id, value, [...path, id]) : [];
    });
  };

  const convertBlock = (id: string, value: Record<string, unknown>, path: string[]): NotionBlock[] => {
    const type = asString(value.type);
    const properties = asRecord(value.properties) ?? {};
    const format = asRecord(value.format) ?? {};
    const text = richText(properties.title, blocks);
    const withChildren = (block: NotionBlock): NotionBlock[] => {
      const children = convertChildren(value.content, path);
      return [children.length > 0 ? { ...block, children } : block];
    };

    if (type in HEADING_LEVELS) {
      const level = HEADING_LEVELS[type];
      // 펼침 제목은 안에 본문을 품는다. 토글처럼 접었다 편다.
      return format.toggleable ? withChildren({ kind: "toggle", level, text }) : [{ kind: "heading", level, text }];
    }
    if (LINK_TYPES.has(type)) {
      const href =
        richText(properties.link, blocks) || richText(properties.source, blocks) || asString(format.display_source);
      if (!/^https?:\/\//i.test(href)) return [];
      return [{ kind: "link", text: text || richText(properties.caption, blocks) || href, href }];
    }
    if (SKIPPED_TYPES.has(type)) return [];

    switch (type) {
      case "page":
        return [{ kind: "page", text: text || "제목 없는 페이지", href: pageHref(id) }];
      case "alias": {
        const target = asString(asRecord(format.alias_pointer)?.id);
        return target ? [{ kind: "page", text: pageTitle(blocks, target) || "링크된 페이지", href: pageHref(target) }] : [];
      }
      case "text":
        return withChildren({ kind: "text", text });
      case "bulleted_list":
        return withChildren({ kind: "bulleted", text });
      case "numbered_list":
        return withChildren({ kind: "numbered", text });
      case "to_do":
        return withChildren({ kind: "todo", text, checked: richText(properties.checked, blocks) === "Yes" });
      case "quote":
        return withChildren({ kind: "quote", text });
      case "callout": {
        // 아이콘이 이모지가 아니라 그림 주소면 버린다.
        const icon = asString(format.page_icon);
        return withChildren({ kind: "callout", text, icon: icon && !/[/:]/.test(icon) ? icon : undefined });
      }
      case "toggle":
        return withChildren({ kind: "toggle", text });
      case "code":
        return isOopyConfig(text) ? [] : [{ kind: "code", text }];
      case "equation":
        return [{ kind: "equation", text }];
      case "divider":
        return [{ kind: "divider", text: "" }];
      case "image": {
        const src = imageSrc(id, value, blocks);
        return src ? [{ kind: "image", text: richText(properties.caption, blocks), src }] : [];
      }
      case "collection_view":
      case "collection_view_page": {
        const collectionId = asString(value.collection_id) || asString(asRecord(format.collection_pointer)?.id);
        const name = richText(recordValue(collections[collectionId])?.name, blocks);
        return [{ kind: "database", text: name || "이름 없는 데이터베이스" }];
      }
      case "table": {
        const order = asArray(format.table_block_column_order).map(asString);
        const rows = asArray(value.content).flatMap((raw) => {
          const row = blockValue(blocks, asString(raw));
          if (!row || row.type !== "table_row") return [];
          const cells = asRecord(row.properties) ?? {};
          return [order.map((column) => richText(cells[column], blocks))];
        });
        return rows.length > 0 ? [{ kind: "table", text: "", rows, header: format.table_block_column_header === true }] : [];
      }
      case "column_list":
        return withChildren({ kind: "columns", text: "" });
      case "column":
        return withChildren({ kind: "column", text: "" });
      case "transclusion_container":
        return convertChildren(value.content, path);
      case "transclusion_reference": {
        // 동기화 블록 사본. 원본 블록의 본문을 이 자리에 그린다.
        const target = asString(asRecord(format.transclusion_reference_pointer)?.id);
        const source = target && !path.includes(target) ? blockValue(blocks, target) : null;
        return source ? convertChildren(source.content, [...path, target]) : [];
      }
      default:
        // 모르는 블록도 글이 있으면 건진다. 찾기에서 빠지는 것보다 모양이 어색한 편이 낫다.
        return text ? withChildren({ kind: "text", text }) : convertChildren(value.content, path);
    }
  };

  const title = richText(asRecord(root.properties)?.title, blocks);
  const content = asArray(root.content);
  // 일부러 빼는 블록(설정 · 목차)뿐인 페이지는 비어도 맞다. 본문 블록을 하나도 알아보지 못할 때만 던진다.
  if (content.length > 0 && !content.some((id) => blockValue(blocks, asString(id)))) {
    throw new Error("Notion 본문 블록을 하나도 읽지 못했습니다.");
  }
  return { title, blocks: convertChildren(content, [rootId]), pageId: asString(root.id) || rootId };
}

/**
 * 본문에서 이어지는데 받은 데이터에 없는 블록. 하위 페이지와 데이터베이스 안은 보지 않는다 —
 * 그리지 않기 때문이다.
 */
export function missingBlockIds(recordMap: unknown, rootId: string): string[] {
  const blocks = asRecord(asRecord(recordMap)?.block) ?? {};
  const missing = new Set<string>();
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    if (!(id in blocks)) {
      missing.add(id);
      return;
    }
    const value = blockValue(blocks, id);
    if (!value) return;
    if (id !== rootId && (value.type === "page" || asString(value.type).startsWith("collection_view"))) return;
    if (value.type === "transclusion_reference") {
      const target = asString(asRecord(asRecord(value.format)?.transclusion_reference_pointer)?.id);
      if (target) visit(target);
    }
    for (const child of asArray(value.content)) visit(asString(child));
  };
  visit(rootId);
  return [...missing];
}

// ── 찾기 ────────────────────────────────────────────────────────────

/** 이 블록에서 칠해지는 글. 자식은 들어가지 않는다. 미리보기가 칠하는 글과 똑같아야 한다. */
export function ownTexts(block: NotionBlock): string[] {
  return block.kind === "table" ? (block.rows ?? []).flat() : [block.text];
}

export function countBlockHits(block: NotionBlock, query: string): number {
  let count = 0;
  for (const text of ownTexts(block)) count += findMatches(text, query).length;
  for (const child of block.children ?? []) count += countBlockHits(child, query);
  return count;
}

/** 제목과 본문 전체의 일치 건수. 토글 속 일치도 센다 — 미리보기는 걸린 토글을 펼친다. */
export function countDocHits(doc: NotionDoc, query: string): number {
  if (!query.trim()) return 0;
  let count = findMatches(doc.title, query).length;
  for (const block of doc.blocks) count += countBlockHits(block, query);
  return count;
}
