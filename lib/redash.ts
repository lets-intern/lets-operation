/**
 * 실서비스 운영DB 를 들여다보는 창구. 우리는 운영DB 에 직접 닿지 않고 Redash 쿼리를
 * 통해서만 읽는다. 저쪽 스키마가 바뀌어도 쿼리 쪽에서 흡수되고, 읽기 권한을 따로 받을 일도 없다.
 *
 * 결과 API 는 **마지막으로 실행된 결과**를 돌려준다. 부를 때마다 쿼리가 도는 게 아니라
 * Redash 쪽 Refresh Schedule 이 돌려둔 값을 받는 것이다. 그래서 저쪽에 하루 1회 갱신이
 * 걸려 있어야 한다 — 없으면 며칠 지난 결과를 계속 받게 된다.
 */

/** 결과 한 줄. 쿼리가 한글 별칭으로 컬럼을 내보내므로 그대로 받는다. */
export type RedashRow = Record<string, string | number | null>;

export type RedashResult = {
  rows: RedashRow[];
  /** 저쪽에서 쿼리가 실제로 돌아간 시각. 결과가 얼마나 묵었는지 판단하는 근거다. */
  retrievedAt: Date;
};

/** 읽는 쿼리. API 키가 쿼리마다 따로 나오므로 ID 와 키를 짝으로 둔다. */
export type RedashQuery = { idEnv: string; keyEnv: string };

/** 쿼리 322 `[기획운영팀]프로그램 운영 현황`. 실서비스 개설 확인에 쓴다. */
export const OPERATION_STATUS_QUERY: RedashQuery = {
  idEnv: "REDASH_QUERY_ID",
  keyEnv: "REDASH_API_KEY",
};

/** 쿼리 335. 미션마다 붙은 필수 · 추가 콘텐츠(plan.md §5 — 미션 콘텐츠). */
export const MISSION_CONTENTS_QUERY: RedashQuery = {
  idEnv: "REDASH_CONTENTS_QUERY_ID",
  keyEnv: "REDASH_CONTENTS_API_KEY",
};

/** 쿼리 336. 챌린지 가이드 · 대시보드 공지사항 · 미션 템플릿 문구(plan.md §5 — 미션 가이드). */
export const MISSION_GUIDES_QUERY: RedashQuery = {
  idEnv: "REDASH_GUIDES_QUERY_ID",
  keyEnv: "REDASH_GUIDES_API_KEY",
};

/** 쿼리 337 `[기획운영팀]1:1문의 수집`. 챌린지 1:1 문의(plan.md §5 — CS 수집). */
export const CS_INQUIRIES_QUERY: RedashQuery = {
  idEnv: "REDASH_CS_QUERY_ID",
  keyEnv: "REDASH_CS_API_KEY",
};

/** 쿼리 349 `[기획운영팀]후기 수집`. 미션 외 다섯 유형의 후기를 글 한 칸에 한 줄씩(plan.md §5 — 후기 관리). */
export const REVIEWS_QUERY: RedashQuery = {
  idEnv: "REDASH_REVIEWS_QUERY_ID",
  keyEnv: "REDASH_REVIEWS_API_KEY",
};

/** 쿼리 350 `[기획운영팀]미션후기`. 2026년에 시작한 챌린지의 미션 소감. 칸 구성은 349 와 같다. */
export const MISSION_REVIEWS_QUERY: RedashQuery = {
  idEnv: "REDASH_MISSION_REVIEWS_QUERY_ID",
  keyEnv: "REDASH_MISSION_REVIEWS_API_KEY",
};

/** 쿼리 344 `[기획운영팀]참여자 수행 현황`. 신청 × 미션 한 줄씩 미션 제출을 내보낸다(plan.md §5 — 참여자 수행 현황). */
export const PARTICIPANT_PROGRESS_QUERY: RedashQuery = {
  idEnv: "REDASH_PROGRESS_QUERY_ID",
  keyEnv: "REDASH_PROGRESS_API_KEY",
};

type RedashResponse = {
  query_result?: {
    retrieved_at?: string;
    data?: { rows?: RedashRow[] };
  };
};

/**
 * 같은 요청이 짧은 사이에 여러 번 오는 것을 막는다. 저쪽 결과는 하루 1회만 바뀌므로
 * 몇 분 묵은 값을 다시 써도 판단이 달라지지 않는다. 서버리스라 인스턴스가 바뀌면
 * 캐시도 함께 사라지는데, 그래도 한 화면이 여러 번 부르는 경우는 걸러진다.
 */
const CACHE_MS = 5 * 60 * 1000;

const globalForRedash = globalThis as unknown as {
  redashCache?: Map<string, { at: number; result: RedashResult }>;
};

/** 저쪽이 느릴 때 우리 화면까지 붙잡히지 않도록 끊는다. */
const TIMEOUT_MS = 15_000;

function config(query: RedashQuery): { url: string; key: string } {
  const base = process.env.REDASH_BASE_URL;
  const queryId = process.env[query.idEnv];
  const key = process.env[query.keyEnv];

  if (!base || !queryId || !key) {
    throw new Error(
      `환경변수 REDASH_BASE_URL · ${query.idEnv} · ${query.keyEnv} 가 필요합니다. .env.local 을 확인하세요.`,
    );
  }

  return {
    url: `${base.replace(/\/$/, "")}/api/queries/${queryId}/results.json`,
    key,
  };
}

/** 설정이 갖춰졌는지. 갖춰지지 않았으면 자동 확인을 건너뛴다. */
export function hasRedashConfig(query: RedashQuery = OPERATION_STATUS_QUERY): boolean {
  return Boolean(
    process.env.REDASH_BASE_URL && process.env[query.idEnv] && process.env[query.keyEnv],
  );
}

export async function fetchRedashResult(
  options: { fresh?: boolean; query?: RedashQuery } = {},
): Promise<RedashResult> {
  const query = options.query ?? OPERATION_STATUS_QUERY;
  // 개발 서버가 코드를 갈아끼워도 globalThis 에는 예전 모양의 캐시가 남을 수 있다.
  if (!(globalForRedash.redashCache instanceof Map)) globalForRedash.redashCache = new Map();
  const cache = globalForRedash.redashCache;
  const cached = cache.get(query.idEnv);
  if (!options.fresh && cached && Date.now() - cached.at < CACHE_MS) {
    return cached.result;
  }

  const { url, key } = config(query);

  const response = await fetch(`${url}?api_key=${encodeURIComponent(key)}`, {
    // 저쪽 결과를 Next 가 또 캐시하면 갱신 시각이 두 겹으로 묵는다. 우리 캐시만 쓴다.
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    // 키가 죽었거나(404) 쿼리가 지워진 경우다. 크론 로그에서 바로 읽히도록 상태를 남긴다.
    throw new Error(`Redash 응답이 ${response.status} 입니다.`);
  }

  const body = (await response.json()) as RedashResponse;
  const rows = body.query_result?.data?.rows;
  const retrievedAt = body.query_result?.retrieved_at;

  if (!Array.isArray(rows) || !retrievedAt) {
    throw new Error("Redash 응답에서 결과를 찾지 못했습니다.");
  }

  const result: RedashResult = { rows, retrievedAt: new Date(retrievedAt) };
  cache.set(query.idEnv, { at: Date.now(), result });

  return result;
}
