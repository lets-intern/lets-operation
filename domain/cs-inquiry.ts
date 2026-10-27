import { findMatches } from "./detail-page-content";

/**
 * CS 수집이 다루는 챌린지 1:1 문의의 규칙(plan.md §5 — CS 수집).
 *
 * 받아오기(서버)와 화면(브라우저)이 같은 규칙을 써야 해서 DB 에 닿지 않는 것만 여기 둔다 —
 * 테스트 문의 거르기, 답변 에디터 JSON 을 줄글로 옮기기, 카테고리 키워드 규칙, 찾기.
 */

/** 문의 카테고리. 순서가 곧 화면에 서는 순서다. */
export const CS_CATEGORIES = [
  { key: "FEEDBACK", label: "피드백·멘토링", hint: "서면 · LIVE 피드백 일정과 예약, 대상 플랜 여부" },
  { key: "COMMUNITY", label: "커뮤니티", hint: "슬랙 · 카카오톡 오픈채팅방 링크, 소감 · 인증 올리는 곳" },
  { key: "ACCESS", label: "대시보드·콘텐츠 접근", hint: "대시보드 입장, 콘텐츠 열람 기한, 템플릿 복사 · 링크 깨짐" },
  { key: "SCORE", label: "점수·지각·반려", hint: "지각 처리, 반려 사유, 점수, 정상참작 요청" },
  { key: "SUBMIT_ERROR", label: "미션 제출 오류", hint: "제출 실패, 경험 불러오기 비활성, 링크 형식 오류" },
  { key: "PAYBACK", label: "페이백·환급·리워드", hint: "페이백 · 환급 조건과 입금, 블로그 후기 리워드 계좌" },
  { key: "PAYMENT", label: "환불·결제·플랜 변경", hint: "환불, 플랜 업그레이드, 버전 · 기수 잘못 결제" },
  { key: "HOW_TO", label: "미션 수행 방법", hint: "무엇을 어떻게 제출하나, 필수 · 선택, 템플릿 위치" },
  { key: "CONSULT", label: "서류 작성 상담", hint: "자소서 문항 해석, 포트폴리오 구성 · 분량 같은 내용 질문" },
  { key: "ETC", label: "기타", hint: "재문의 · 독촉, 전화 상담 요청, 취업 인증 등 — 규칙에 안 걸린 문의도 여기 온다" },
] as const;

export type CsCategory = (typeof CS_CATEGORIES)[number]["key"];

const CATEGORY_KEYS = new Set<string>(CS_CATEGORIES.map((category) => category.key));

export function isCsCategory(value: string): value is CsCategory {
  return CATEGORY_KEYS.has(value);
}

export const CS_CATEGORY_LABELS = Object.fromEntries(
  CS_CATEGORIES.map((category) => [category.key, category.label]),
) as Record<CsCategory, string>;

/**
 * 카테고리마다 걸리는 말. 문의 제목과 본문에서만 찾는다 — 답변은 매니저의 말이라 문의가 무엇을
 * 물었는지와 어긋난다. 2026-09-16 실데이터 270건을 읽고 만들었다.
 *
 * 챌린지 이름에 `자기소개서` · `포트폴리오` · `이력서` 가 들어가 본문에도 흔하므로 서류 이름만으로는
 * 서류 작성 상담으로 보지 않는다.
 */
const CATEGORY_RULES: Record<Exclude<CsCategory, "ETC">, RegExp> = {
  FEEDBACK: /피드백|멘토링|멘토님|첨삭|라이브|live|예약/i,
  COMMUNITY: /오픈\s*채팅|옾챗|카톡|카카오톡|톡방|채팅방|슬랙|slack|인증샷|인증과\s*소감|소감.{0,15}(공유|업로드|어디|남기|남겨)/i,
  ACCESS:
    /대시\s*보드.{0,8}(입장|접근|접속)|입장.{0,4}(안\s*[되돼]|불가|오류)|열람|(끝나|종료).{0,15}(볼|접근|확인|열람)|복사.{0,4}안|복제|접속.{0,3}(안|불가)|깨[지져]|볼\s*수\s*있|기간\s*만료|안\s*보[여이]|보이지\s*않|안\s*뜨|안뜨|로딩|조회.{0,3}안/,
  SCORE: /지각|반려|점수|정상\s*(제출|참작|출석|처리)|배점|감점|다시\s*제출|재\s*제출|수정.{0,20}(제출|업로드|올려)/,
  SUBMIT_ERROR:
    /제출.{0,10}(실패|안\s*[되돼]|불가|오류|못\s*했|못\s*하)|불러오기|불러와|비활성|형식이\s*올바르지|서버\s*내부\s*오류|제출\s*(버튼|창)|업로드.{0,4}(안\s*[되돼]|불가)|등록\s*(실패|오류)|제출하기가\s*안/,
  PAYBACK: /페이백|환급|리워드|블로그\s*후기|계좌/,
  PAYMENT:
    /환불|결제\s*취소|업그레이드|요금제|플랜.{0,6}(변경|바꾸)|스탠다드.{0,4}변경|기수.{0,6}(변경|이관)|재결제|잘못.{0,6}결제|결제.{0,10}(잘못|실수)|실수로.{0,20}결제/,
  HOW_TO:
    /어떻게.{0,6}(제출|진행|하면|해야)|제출.{0,6}(방법|어디)|어디(에|서|다가).{0,15}(제출|올리|업로드|작성|남기|공유|확인)|템플릿|필수(인가|인지|항목|인가요)|선택(인가|이라고)|제출\s*확인|잘\s*제출|제대로.{0,10}(제출|진행)|미션\s*인증|까지\s*제출|(올려|제출해)야\s*하는/,
  CONSULT:
    /문항|지원\s*동기|입사\s*후\s*포부|직무\s*(설정|역량|관련|탐색)|경험.{0,8}(비중|배치)|구성하|웹으로|pdf|기업명|수치로|풀이\s*용지|장수|분량|몇\s*페이지/i,
};

/** 규칙이 붙이는 카테고리. 하나도 안 걸리면 기타로 둔다 — 목록에서 사라지는 문의가 없어야 한다. */
export function ruleCategories(inquiry: { title: string; body: string }): CsCategory[] {
  const text = `${inquiry.title}\n${inquiry.body}`;
  const matched = CS_CATEGORIES.map((category) => category.key).filter(
    (key): key is Exclude<CsCategory, "ETC"> => key !== "ETC" && CATEGORY_RULES[key].test(text),
  );
  return matched.length > 0 ? matched : ["ETC"];
}

/** 화면에 서는 순서로 줄 세우고 겹친 것을 뺀다. 매니저가 고른 카테고리를 저장할 때 쓴다. */
export function normalizeCategories(values: string[]): CsCategory[] {
  const picked = new Set(values);
  return CS_CATEGORIES.map((category) => category.key).filter((key) => picked.has(key));
}

/**
 * 모으지 않는 테스트 문의(2026-09-16 사용자가 정함). 관리자 계정, `[테스트]` 챌린지, 내부 테스트 계정.
 * 쿼리는 그대로 두고 여기서 거른다 — 기준이 바뀌어도 Redash 를 고치지 않아도 된다.
 */
const TEST_USER_IDS = new Set([1751]);

export function isTestInquiry(inquiry: { userId: number; customerName: string; challengeTitle: string }): boolean {
  return (
    inquiry.customerName.trim() === "관리자" ||
    inquiry.challengeTitle.includes("[테스트]") ||
    TEST_USER_IDS.has(inquiry.userId)
  );
}

type LexicalNode = {
  type?: unknown;
  text?: unknown;
  src?: unknown;
  url?: unknown;
  children?: unknown;
};

const BLOCK_TYPES = new Set(["paragraph", "heading", "quote", "code"]);

/**
 * 관리자 화면 답변 에디터(Lexical)가 저장한 JSON 을 줄글과 이미지 주소로 옮긴다.
 *
 * 글은 `text` 조각에 나뉘어 있고 문단 · 줄바꿈은 노드 모양으로만 남는다. 문단 · 목록 줄 끝에 줄을 바꾸고,
 * 목록 줄 앞에는 `- ` 를 붙인다. JSON 이 아니면(에디터를 쓰기 전 답변일 수 있다) 받은 글을 그대로 쓴다.
 */
export function lexicalToText(raw: string): { text: string; imageUrls: string[] } {
  let root: unknown;
  try {
    root = (JSON.parse(raw) as { root?: unknown }).root;
  } catch {
    return { text: raw.trim(), imageUrls: [] };
  }
  if (!root || typeof root !== "object") return { text: raw.trim(), imageUrls: [] };

  const imageUrls: string[] = [];
  const walk = (node: LexicalNode): string => {
    if (node.type === "linebreak") return "\n";
    if (node.type === "image") {
      // 첨부 이미지와 같이 웹 주소만 받는다. 화면이 그대로 <img> · <a> 에 넣는다.
      if (typeof node.src === "string" && /^https?:\/\//.test(node.src) && !imageUrls.includes(node.src)) {
        imageUrls.push(node.src);
      }
      return "";
    }
    // text · emoji · hashtag 는 모두 글 조각이다.
    if (typeof node.text === "string") return node.text;

    const children = Array.isArray(node.children) ? (node.children as LexicalNode[]) : [];
    const inner = children.map(walk).join("");
    // "여기를 눌러 주세요" 처럼 글을 붙인 링크는 주소를 함께 남긴다 — 어느 링크로 안내했는지 찾을 수 있어야 한다.
    if (node.type === "link" && typeof node.url === "string" && node.url && !inner.includes(node.url)) {
      return `${inner} (${node.url})`;
    }
    if (node.type === "listitem") return `- ${inner}\n`;
    if (typeof node.type === "string" && BLOCK_TYPES.has(node.type)) return `${inner}\n`;
    return inner;
  };

  const text = walk(root as LexicalNode)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, imageUrls };
}

/** 찾기 대상 칸. 고객 이름 · 문의 제목 · 챌린지 · 플랜 · 본문, 그리고 답변. */
export type CsSearchable = {
  customerName: string;
  title: string;
  challengeTitle: string;
  plan: string | null;
  body: string;
  answer: string | null;
};

export function countInquiryHits(inquiry: CsSearchable, query: string): number {
  if (!query.trim()) return 0;
  return [inquiry.customerName, inquiry.title, inquiry.challengeTitle, inquiry.plan ?? "", inquiry.body, inquiry.answer ?? ""]
    .map((field) => findMatches(field, query).length)
    .reduce((sum, count) => sum + count, 0);
}
