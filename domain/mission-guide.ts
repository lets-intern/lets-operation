import { findMatches } from "./detail-page-content";

/**
 * 미션 가이드가 다루는 자료의 갈래와, 그 자료를 고치러 가는 자리(plan.md §5 — 미션 가이드).
 *
 * 한 화면에 성질이 다른 두 가지가 섞인다 — 챌린지 가이드 · 대시보드 공지사항은 Notion 원문을 받아
 * 그리고, 미션은 운영DB 안의 글(미션명 · 내용 · 가이드 내용)을 그대로 그린다. 찾기는 둘을 가리지
 * 않아야 하므로 건수를 세는 규칙을 여기 한자리에 둔다.
 */

export type GuideItemKind = "GUIDE" | "NOTICE" | "MISSION";

/** 쿼리 336 의 `자료구분값` */
export const GUIDE_ITEM_KIND_BY_VALUE: Record<number, GuideItemKind> = {
  1: "GUIDE",
  2: "NOTICE",
  3: "MISSION",
};

export const GUIDE_ITEM_KIND_LABELS: Record<GuideItemKind, string> = {
  GUIDE: "챌린지 가이드",
  NOTICE: "공지사항",
  MISSION: "미션",
};

/** 실서비스 관리자 화면. 찾은 문구를 고치러 가는 곳이다. */
const ADMIN_ORIGIN = "https://admin.letscareer.co.kr";

/**
 * 그 자료를 고치는 관리자 화면 주소. 주소는 저쪽 id 로 만든다 — 사람이 적어 두면 어긋나는 날이 온다
 * (plan.md §5 의 상세페이지와 같은 규칙).
 *
 * 공지사항은 챌린지 운영 화면(`/challenge/operation/{id}/home`)에서 고친다. 챌린지 가이드도 같은
 * 화면으로 보내는데, 저쪽에서 가이드를 어느 탭에서 고치는지는 아직 확인하지 못했다 — 다르다면
 * 여기만 고치면 된다. 미션은 목록 화면까지만 열린다(`/challenge/missions`) — 미션 하나를 가리키는
 * 주소를 아직 받지 못했다.
 */
export function guideAdminUrl(kind: GuideItemKind, challengeId: number): string {
  return kind === "MISSION"
    ? `${ADMIN_ORIGIN}/challenge/missions`
    : `${ADMIN_ORIGIN}/challenge/operation/${challengeId}/home`;
}

export function countTextHits(text: string, query: string): number {
  return query.trim() ? findMatches(text, query).length : 0;
}

/**
 * 한 원문에 붙은 제목들. 같은 가이드 · 공지가 기수마다 다른 제목으로 걸려 있고, 미션은 기수에서
 * 미션명을 덮어쓰기도 한다(2,040줄 중 12줄, 2026-09-16). 한쪽만 고친 곳을 찾으려는 화면이라
 * 다른 제목을 숨기지 않고, 같은 제목은 한 번만 세어 건수가 부풀지 않게 한다.
 *
 * 첫 번째가 대표 제목이다 — 가장 최근 기수의 제목, 미션은 템플릿에 적힌 미션명.
 */
export function uniqueTitles(titles: string[]): string[] {
  return [...new Set(titles.map((title) => title.trim()).filter((title) => title !== ""))];
}
