import { prisma } from "@/lib/prisma";

import {
  eventColor,
  isValidEventId,
  pickWorkCalendar,
  WORK_CALENDAR_NAME,
  type EventInput,
  type WeekEvent,
} from "./calendar-week";

/**
 * 업무 수행 화면이 붙는 구글 캘린더(plan.md §5 — 업무 수행). OAuth2 와 Calendar API v3 를
 * 라이브러리 없이 fetch 로 직접 부른다 — 쓰는 길이 토큰 갱신과 일정 읽기 · 쓰기뿐이라
 * 무거운 SDK 를 싣지 않는다.
 *
 * **계정은 하나만 잇는다**(schema 의 GoogleCalendarConnection). 연결한 사람의 일정이 팀원
 * 화면에도 보이는 것은 감수하기로 했다.
 *
 * **토큰은 화면으로 돌려주지 않는다.** 이 앱은 팀 공용 비밀번호 하나로 열리고 계정 분리가
 * 없어서(plan.md §2), 읽어 보낼 수 있는 자리를 만들면 연결한 사람의 구글 자격이 그 자리에
 * 놓인다(domain/slack-sender 와 같은 이유). 화면이 받는 것은 연결 상태와 이메일까지이고,
 * 토큰은 이 파일 안에서만 읽힌다.
 *
 * **테스트 상태의 OAuth 앱은 갱신 토큰이 7일마다 만료된다.** 개인 Gmail 로 만든 앱을 구글
 * 심사 없이 쓰는 대가다. 만료되면 구글이 `invalid_grant` 로 거절하고, 그때 줄을 지우지 않고
 * 끊긴 시각과 사유를 적어 화면이 다시 연결 버튼을 띄우게 한다.
 */

const CONNECTION_ID = "default";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

const EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const CALENDAR_LIST_SCOPE = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";

/**
 * 필요한 만큼만 묻는다. 일정 읽고 쓰기와 캘린더 목록 읽기, 그리고 누구 계정인지 화면에
 * 적기 위한 이메일. 캘린더 자체를 만들거나 공유 설정을 바꾸는 권한은 받지 않는다.
 */
const SCOPES = ["openid", "email", EVENTS_SCOPE, CALENDAR_LIST_SCOPE];

/** 접근 토큰이 이만큼 남았으면 미리 갈아 둔다. 요청이 가는 도중에 만료되지 않게 한다. */
const REFRESH_MARGIN_MS = 60 * 1000;

/** 한 주에 이보다 많은 일정이 있는 캘린더는 없다고 본다. 넘으면 다음 쪽을 이어서 받는다. */
const EVENTS_PAGE_SIZE = 250;

/** 이 사유를 화면과 plan.md 가 같은 말로 쓴다. */
export const TESTING_APP_EXPIRY_NOTE =
  "OAuth 앱이 '테스트' 상태라 구글이 7일마다 연결을 끊습니다. 다시 연결하면 이어서 씁니다.";

export const OAUTH_STATE_COOKIE = "lo_google_oauth_state";
export const CALLBACK_PATH = "/api/google/callback";

/** 화면이 알아야 하는 실패의 종류. 메시지는 사람이 읽는 말이다. */
export type GoogleCalendarErrorKind =
  | "not-configured"
  | "not-connected"
  | "disconnected"
  | "forbidden"
  | "not-found"
  | "rate-limited"
  | "rejected"
  | "duplicate"
  | "unavailable";

export class GoogleCalendarError extends Error {
  constructor(
    readonly kind: GoogleCalendarErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "GoogleCalendarError";
  }
}

type OAuthConfig = { clientId: string; clientSecret: string };

function oauthConfig(): OAuthConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function requireOAuthConfig(): OAuthConfig {
  const config = oauthConfig();
  if (!config) {
    throw new GoogleCalendarError(
      "not-configured",
      "환경변수 GOOGLE_CLIENT_ID · GOOGLE_CLIENT_SECRET 이 설정되지 않았습니다.",
    );
  }
  return config;
}

/** 환경변수가 둘 다 있는지. 없으면 화면이 무엇을 설정해야 하는지 안내한다. */
export function isGoogleOAuthConfigured(): boolean {
  return oauthConfig() !== null;
}

/**
 * 구글 동의 화면 주소. 리디렉션 주소는 요청이 들어온 origin 으로 만든다 — 로컬과 배포가
 * 같은 코드로 돌고, 둘 다 구글 콘솔의 승인된 리디렉션 URI 에 적혀 있어야 한다.
 *
 * `prompt=consent` 는 매번 갱신 토큰을 받기 위해서다. 구글은 이미 동의한 계정에 다시
 * 동의를 묻지 않으면 갱신 토큰을 주지 않는데, 끊긴 뒤 다시 연결할 때 그것이 꼭 필요하다.
 */
export function buildAuthUrl(origin: string, state: string): string {
  const { clientId } = requireOAuthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${origin}${CALLBACK_PATH}`,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/** 화면에 서는 연결 상태. 토큰은 들어 있지 않다. */
export type GoogleConnectionStatus =
  | { state: "none" }
  | { state: "connected"; email: string }
  | { state: "disconnected"; email: string; reason: string; disconnectedAt: Date };

export async function getGoogleConnectionStatus(): Promise<GoogleConnectionStatus> {
  const row = await prisma.googleCalendarConnection.findUnique({
    where: { id: CONNECTION_ID },
    // 토큰은 고르지 않는다. 이 함수의 결과는 그대로 화면으로 간다.
    select: { email: true, disconnectedAt: true, disconnectReason: true },
  });
  if (!row) return { state: "none" };
  if (row.disconnectedAt) {
    return {
      state: "disconnected",
      email: row.email,
      reason: row.disconnectReason ?? TESTING_APP_EXPIRY_NOTE,
      disconnectedAt: row.disconnectedAt,
    };
  }
  return { state: "connected", email: row.email };
}

/** 콜백이 화면에 돌려줄 실패 사유. 주소에 실려 가므로 짧은 부호로 둔다. */
export type ConnectFailure = "exchange" | "no-refresh-token" | "scope" | "email";

export type ConnectResult = { ok: true; email: string } | { ok: false; reason: ConnectFailure };

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

/**
 * 동의 화면에서 받은 code 를 토큰으로 바꾸고 연결을 저장한다. 끊겼던 연결은 되살아난다.
 *
 * 구글의 세분화된 동의 화면은 권한마다 체크를 풀 수 있다. 일정 권한을 빼고 동의하면 화면이
 * 아무것도 못 하므로 저장하지 않고 되돌린다.
 */
export async function connectGoogleCalendar(code: string, origin: string): Promise<ConnectResult> {
  const { clientId, clientSecret } = requireOAuthConfig();

  const tokens = await postToken({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: `${origin}${CALLBACK_PATH}`,
    grant_type: "authorization_code",
  });
  if (!tokens.ok) {
    console.error("[google] code 교환 실패", tokens.error, tokens.description);
    return { ok: false, reason: "exchange" };
  }

  const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn } =
    tokens.body;
  if (!accessToken) return { ok: false, reason: "exchange" };
  if (!refreshToken) return { ok: false, reason: "no-refresh-token" };

  const granted = new Set((tokens.body.scope ?? "").split(" "));
  if (!granted.has(EVENTS_SCOPE) || !granted.has(CALENDAR_LIST_SCOPE)) {
    // 저장하지 않고 사유만 돌려준다. 토큰을 돌려주지(revoke) 않는 것은 같은 앱의 권한이 계정
    // 단위로 묶여 있어서다 — 돌려주면 이미 잘 쓰고 있던 연결까지 함께 끊길 수 있다.
    return { ok: false, reason: "scope" };
  }

  const email = await fetchEmail(accessToken);
  if (!email) return { ok: false, reason: "email" };

  const data = {
    email,
    refreshToken,
    accessToken,
    accessTokenExpiresAt: new Date(Date.now() + (expiresIn ?? 3600) * 1000),
    disconnectedAt: null,
    disconnectReason: null,
  };

  // 다른 계정으로 다시 연결하면 예전 계정의 토큰은 버려진다. 계정은 하나뿐이다.
  const previous = await prisma.googleCalendarConnection.findUnique({
    where: { id: CONNECTION_ID },
    select: { refreshToken: true, email: true },
  });
  await prisma.googleCalendarConnection.upsert({
    where: { id: CONNECTION_ID },
    create: { id: CONNECTION_ID, ...data },
    update: data,
  });
  if (previous && previous.email !== email) await revokeToken(previous.refreshToken);

  return { ok: true, email };
}

async function fetchEmail(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { email?: string };
    return body.email ?? null;
  } catch (error) {
    console.error("[google] 이메일 확인 실패", error);
    return null;
  }
}

/**
 * 연결을 끊는다. 구글에도 토큰을 돌려줘 계정의 연결된 앱 목록에서 빠지게 하고 줄을 지운다.
 * 돌려주기가 실패해도(이미 만료된 토큰 등) 줄은 지운다 — 사람이 바란 것은 끊는 것이다.
 */
export async function disconnectGoogleCalendar(): Promise<void> {
  const row = await prisma.googleCalendarConnection.findUnique({
    where: { id: CONNECTION_ID },
    select: { refreshToken: true },
  });
  if (!row) return;
  await revokeToken(row.refreshToken);
  await prisma.googleCalendarConnection.deleteMany({ where: { id: CONNECTION_ID } });
}

async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
      cache: "no-store",
    });
  } catch (error) {
    console.error("[google] 토큰 돌려주기 실패", error);
  }
}

type PostTokenResult =
  | { ok: true; body: TokenResponse }
  | { ok: false; error: string; description: string };

async function postToken(params: Record<string, string>): Promise<PostTokenResult> {
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
      cache: "no-store",
    });
  } catch (error) {
    console.error("[google] 토큰 요청 실패", error);
    throw new GoogleCalendarError("unavailable", "구글에 연결하지 못했습니다. 잠시 후 다시 시도하세요.");
  }

  const body = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || body.error) {
    return {
      ok: false,
      error: body.error ?? `http_${response.status}`,
      description: body.error_description ?? "",
    };
  }
  return { ok: true, body };
}

/**
 * 쓸 수 있는 접근 토큰. 만료 1분 전이면 갱신 토큰으로 새로 받는다.
 *
 * 구글이 갱신 토큰을 `invalid_grant` 로 거절하면 연결을 끊긴 상태로 적는다. 테스트 상태 앱의
 * 7일 만료가 대부분이고, 비밀번호를 바꿨거나 구글 계정에서 앱 권한을 지운 경우도 같은 답이 온다.
 */
let pendingToken: { forced: boolean; promise: Promise<string> } | null = null;

/**
 * 같은 때 들어온 요청은 토큰 한 번을 함께 기다린다. 주간 뷰는 캘린더마다 병렬로 묻는데, 각자
 * 갱신하면 같은 갱신 토큰으로 구글을 여러 번 부르고 마지막 응답이 앞선 것을 덮는다.
 * 새로 받기를 바라는 호출(401 뒤)은 그냥 읽기만 하던 대기에 얹히지 않는다.
 */
function getAccessToken(force = false): Promise<string> {
  if (pendingToken && (pendingToken.forced || !force)) return pendingToken.promise;

  const promise = loadAccessToken(force).finally(() => {
    if (pendingToken?.promise === promise) pendingToken = null;
  });
  pendingToken = { forced: force, promise };
  return promise;
}

async function loadAccessToken(force: boolean): Promise<string> {
  const row = await prisma.googleCalendarConnection.findUnique({ where: { id: CONNECTION_ID } });
  if (!row) {
    throw new GoogleCalendarError("not-connected", "구글 캘린더가 연결되어 있지 않습니다.");
  }
  if (row.disconnectedAt) {
    throw new GoogleCalendarError("disconnected", "구글 연결이 끊겼습니다. 다시 연결하세요.");
  }

  const fresh =
    !force &&
    row.accessToken &&
    row.accessTokenExpiresAt &&
    row.accessTokenExpiresAt.getTime() - REFRESH_MARGIN_MS > Date.now();
  if (fresh && row.accessToken) return row.accessToken;

  const { clientId, clientSecret } = requireOAuthConfig();
  const result = await postToken({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: row.refreshToken,
    grant_type: "refresh_token",
  });

  if (!result.ok) {
    if (result.error === "invalid_grant") {
      // 읽은 갱신 토큰에 걸어 둔다. 그 사이 다시 연결해 토큰이 바뀌었으면 새 연결을 끊지 않는다.
      await prisma.googleCalendarConnection.updateMany({
        where: { id: CONNECTION_ID, refreshToken: row.refreshToken },
        data: {
          disconnectedAt: new Date(),
          disconnectReason: `구글이 연결을 거절했습니다(invalid_grant). ${TESTING_APP_EXPIRY_NOTE} 구글 비밀번호를 바꿨거나 계정에서 앱 권한을 지운 경우에도 이렇게 됩니다.`,
          accessToken: null,
          accessTokenExpiresAt: null,
        },
      });
      throw new GoogleCalendarError("disconnected", "구글 연결이 끊겼습니다. 다시 연결하세요.");
    }
    console.error("[google] 토큰 갱신 실패", result.error, result.description);
    if (result.error === "invalid_client" || result.error === "unauthorized_client") {
      throw new GoogleCalendarError(
        "not-configured",
        "구글이 이 앱의 클라이언트 정보를 받지 않습니다. GOOGLE_CLIENT_ID · GOOGLE_CLIENT_SECRET 을 확인하세요.",
      );
    }
    throw new GoogleCalendarError("unavailable", "구글 토큰을 갱신하지 못했습니다. 잠시 후 다시 시도하세요.");
  }

  const accessToken = result.body.access_token;
  if (!accessToken) {
    throw new GoogleCalendarError("unavailable", "구글 토큰을 갱신하지 못했습니다. 잠시 후 다시 시도하세요.");
  }

  // 다시 연결로 갱신 토큰이 바뀌었으면 옛 토큰으로 받은 값을 덮어쓰지 않는다.
  await prisma.googleCalendarConnection.updateMany({
    where: { id: CONNECTION_ID, refreshToken: row.refreshToken },
    data: {
      accessToken,
      accessTokenExpiresAt: new Date(Date.now() + (result.body.expires_in ?? 3600) * 1000),
      // 구글은 대개 갱신 토큰을 다시 주지 않는다. 줄 때만 바꾼다.
      ...(result.body.refresh_token ? { refreshToken: result.body.refresh_token } : {}),
    },
  });

  return accessToken;
}

type GoogleApiError = {
  error?: { code?: number; message?: string; errors?: { reason?: string }[] };
};

/**
 * Calendar API 를 부른다. 401 이면 토큰을 한 번 새로 받아 다시 부른다 — 저장해 둔 만료
 * 시각보다 구글이 먼저 토큰을 버리는 일이 있다.
 */
async function calendarFetch<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const accessToken = await getAccessToken(attempt > 0);
    let response: Response;
    try {
      response = await fetch(`${CALENDAR_API}${path}`, {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${accessToken}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
        cache: "no-store",
      });
    } catch (error) {
      console.error("[google] 캘린더 요청 실패", path, error);
      throw new GoogleCalendarError("unavailable", "구글 캘린더에 연결하지 못했습니다. 잠시 후 다시 시도하세요.");
    }

    if (response.status === 401 && attempt === 0) continue;
    if (response.status === 204) return null;
    if (response.ok) return (await response.json()) as T;

    const body = (await response.json().catch(() => ({}))) as GoogleApiError;
    throw toReadableError(response.status, body);
  }
  throw new GoogleCalendarError("disconnected", "구글이 인증을 거절했습니다. 다시 연결하세요.");
}

/** 구글의 오류를 사람이 할 일이 읽히는 말로. 원문은 서버 로그에 남긴다. */
function toReadableError(status: number, body: GoogleApiError): GoogleCalendarError {
  const reason = body.error?.errors?.[0]?.reason ?? "";
  const original = body.error?.message ?? "";
  console.error("[google] 캘린더 API 오류", status, reason, original);

  if (status === 401) {
    return new GoogleCalendarError("disconnected", "구글이 인증을 거절했습니다. 다시 연결하세요.");
  }
  if (status === 429 || reason === "rateLimitExceeded" || reason === "userRateLimitExceeded") {
    return new GoogleCalendarError("rate-limited", "구글 캘린더 요청이 너무 많습니다. 잠시 후 다시 시도하세요.");
  }
  if (status === 403) {
    if (reason === "accessNotConfigured") {
      return new GoogleCalendarError(
        "not-configured",
        "구글 클라우드 콘솔에서 Google Calendar API 가 사용 설정되어 있지 않습니다.",
      );
    }
    if (reason === "insufficientPermissions") {
      return new GoogleCalendarError(
        "forbidden",
        "권한이 부족합니다. 연결을 해제하고 다시 연결하면서 모든 권한에 동의하세요.",
      );
    }
    return new GoogleCalendarError("forbidden", "이 캘린더에 쓸 권한이 없습니다.");
  }
  // 410 은 이미 지워진 일정이다. 찾지 못한 것과 사람에게는 같은 일이다.
  if (status === 404 || status === 410) {
    return new GoogleCalendarError("not-found", "일정이나 캘린더를 찾지 못했습니다. 이미 지워졌을 수 있습니다.");
  }
  if (status === 409) {
    return new GoogleCalendarError("duplicate", "같은 일정이 이미 있습니다. 새로고침 후 다시 확인하세요.");
  }
  if (status === 412) {
    return new GoogleCalendarError("rejected", "그 사이 일정이 바뀌었습니다. 새로고침 후 다시 고치세요.");
  }
  if (status >= 500) {
    return new GoogleCalendarError("unavailable", "구글 캘린더가 잠시 응답하지 않습니다. 잠시 후 다시 시도하세요.");
  }
  return new GoogleCalendarError(
    "rejected",
    original ? `구글이 요청을 받지 않았습니다: ${original}` : "구글이 요청을 받지 않았습니다.",
  );
}

/** 화면에 서는 캘린더 한 줄. */
export type CalendarSummary = {
  calendarId: string;
  name: string;
  color: string;
  primary: boolean;
  /** owner · writer 일 때만 일정을 만들고 고칠 수 있다. */
  writable: boolean;
};

type CalendarListResponse = {
  items?: {
    id: string;
    summary?: string;
    summaryOverride?: string;
    backgroundColor?: string;
    accessRole?: string;
    primary?: boolean;
    hidden?: boolean;
    deleted?: boolean;
  }[];
  nextPageToken?: string;
};

/**
 * 연결한 계정의 캘린더 목록. 구글 화면에서 숨긴 캘린더는 뺀다(목록 API 의 기본값이 이미
 * 빼지만 한 번 더 거른다). 기본 캘린더를 맨 앞에, 나머지는 이름순.
 */
export async function listCalendars(): Promise<CalendarSummary[]> {
  const items: NonNullable<CalendarListResponse["items"]> = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ maxResults: "250" });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await calendarFetch<CalendarListResponse>(`/users/me/calendarList?${params}`);
    items.push(...(page?.items ?? []));
    pageToken = page?.nextPageToken;
  } while (pageToken);

  return items
    .filter((item) => !item.hidden && !item.deleted)
    .map((item) => ({
      calendarId: item.id,
      name: item.summaryOverride ?? item.summary ?? item.id,
      color: item.backgroundColor ?? "#9fc6e7",
      primary: item.primary === true,
      writable: item.accessRole === "owner" || item.accessRole === "writer",
    }))
    .sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name, "ko"));
}

type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  colorId?: string;
  htmlLink?: string;
  recurringEventId?: string;
  eventType?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
};

type EventsResponse = { items?: GoogleEvent[]; nextPageToken?: string };

export type WeekEventsResult = {
  events: WeekEvent[];
  /** 읽지 못한 캘린더 이름. 한 캘린더가 막혀도 나머지 일정은 보여 준다. */
  failedCalendars: string[];
};

/**
 * 구간 안의 일정. 캘린더마다 따로 물어 한 목록으로 합친다.
 *
 * 반복 일정은 회차마다 한 건으로 펼쳐 받는다(`singleEvents=true`). 화면은 한 주만 그리므로
 * 반복 규칙을 직접 풀 필요가 없고, 고치거나 지울 때도 그 회차 id 로 부르면 그 회차만 바뀐다.
 */
export async function listEventsBetween(
  calendars: CalendarSummary[],
  timeMin: Date,
  timeMax: Date,
): Promise<WeekEventsResult> {
  const results = await Promise.allSettled(
    calendars.map((calendar) => listCalendarEvents(calendar, timeMin, timeMax)),
  );

  const events: WeekEvent[] = [];
  const failedCalendars: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      events.push(...result.value);
      return;
    }
    // 연결 자체가 끊긴 것이면 캘린더 하나의 문제가 아니다. 화면이 다시 연결을 띄워야 한다.
    if (result.reason instanceof GoogleCalendarError && result.reason.kind === "disconnected") {
      throw result.reason;
    }
    // 사유를 바꿔 둔 구글 오류는 이미 로그에 남았다. 그 밖의 것(코드 오류 등)은 여기서 남긴다.
    if (!(result.reason instanceof GoogleCalendarError)) {
      console.error("[google] 캘린더 일정 읽기 실패", calendars[index].calendarId, result.reason);
    }
    failedCalendars.push(calendars[index].name);
  });

  return { events, failedCalendars };
}

async function listCalendarEvents(
  calendar: CalendarSummary,
  timeMin: Date,
  timeMax: Date,
): Promise<WeekEvent[]> {
  const events: WeekEvent[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone: "Asia/Seoul",
      maxResults: String(EVENTS_PAGE_SIZE),
    });
    if (pageToken) params.set("pageToken", pageToken);

    const page = await calendarFetch<EventsResponse>(
      `/calendars/${encodeURIComponent(calendar.calendarId)}/events?${params}`,
    );
    for (const item of page?.items ?? []) {
      const event = toWeekEvent(item, calendar);
      if (event) events.push(event);
    }
    pageToken = page?.nextPageToken;
  } while (pageToken);

  return events;
}

/**
 * 구글 일정 한 건을 화면 꼴로. 취소된 회차와 근무 위치(일정이 아니라 상태 표시다)는 뺀다.
 * 시작이나 끝이 없는 것은 그릴 자리가 없어 뺀다.
 */
function toWeekEvent(item: GoogleEvent, calendar: CalendarSummary): WeekEvent | null {
  if (item.status === "cancelled" || item.eventType === "workingLocation") return null;

  const allDay = Boolean(item.start?.date);
  const start = allDay ? item.start?.date : item.start?.dateTime;
  const end = allDay ? item.end?.date : item.end?.dateTime;
  if (!start || !end) return null;

  return {
    key: `${calendar.calendarId} ${item.id}`,
    eventId: item.id,
    calendarId: calendar.calendarId,
    calendarName: calendar.name,
    title: item.summary ?? "",
    description: item.description ?? "",
    location: item.location ?? "",
    allDay,
    start,
    end,
    color: eventColor(item.colorId, calendar.color),
    writable: calendar.writable,
    recurring: Boolean(item.recurringEventId),
    htmlLink: item.htmlLink ?? "",
  };
}

/**
 * 쓰는 요청 앞에서 캘린더를 다시 확인한다. 폼에 실려 온 캘린더 id 는 브라우저가 고칠 수 있는
 * 값이라, 화면이 고르게 한 목록(owner · writer)에 실제로 있는 것인지 서버가 구글에 물어 본다.
 */
async function requireWritableCalendar(calendarId: string): Promise<void> {
  const calendars = await listCalendars();
  if (!calendars.some((calendar) => calendar.calendarId === calendarId && calendar.writable)) {
    throw new GoogleCalendarError("forbidden", "쓰기 권한이 있는 캘린더가 아닙니다. 새로고침 후 다시 고르세요.");
  }
}

function requireEventId(eventId: string): void {
  if (!isValidEventId(eventId)) {
    throw new GoogleCalendarError("rejected", "일정 id 가 올바르지 않습니다. 새로고침 후 다시 시도하세요.");
  }
}

/**
 * 새 일정이 들어갈 캘린더(calendar-week 의 WORK_CALENDAR_NAME). 화면이 고르게 하지 않으므로
 * 폼에 실린 값을 믿지 않고 서버가 매번 목록에서 찾는다.
 */
async function requireWorkCalendar(): Promise<string> {
  const calendar = pickWorkCalendar(await listCalendars());
  if (!calendar) {
    throw new GoogleCalendarError(
      "not-found",
      `구글 캘린더에 쓰기 권한이 있는 '${WORK_CALENDAR_NAME}' 캘린더가 없습니다. 구글 캘린더에서 만들거나 이름을 확인하세요.`,
    );
  }
  return calendar.calendarId;
}

/**
 * 일정을 만든다. 늘 '렛츠커리어' 캘린더에 만든다(requireWorkCalendar).
 * 반복 · 알림 · 참석자는 이번 범위가 아니다(plan.md §8).
 *
 * `eventId` 를 주면 그 id 로 만든다 — 타이머처럼 같은 등록이 두 번 갈 수 있는 자리에서 구글이
 * 둘째를 409(`duplicate`) 로 거절하게 하려는 것이다.
 */
export async function createEvent(
  input: EventInput,
  eventId?: string,
): Promise<{ eventId: string }> {
  const calendarId = await requireWorkCalendar();
  if (eventId !== undefined) requireEventId(eventId);

  const body = {
    ...(eventId ? { id: eventId } : {}),
    summary: input.title,
    ...(input.description ? { description: input.description } : {}),
    ...(input.location ? { location: input.location } : {}),
    start: input.start,
    end: input.end,
  };
  const created = await calendarFetch<{ id: string }>(
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: "POST", body: JSON.stringify(body) },
  );
  if (!created) throw new GoogleCalendarError("unavailable", "구글이 만든 일정을 돌려주지 않았습니다.");
  return { eventId: created.id };
}

/**
 * 일정을 고친다(PATCH). 적은 칸만 바뀌고 참석자 · 알림처럼 이 화면이 모르는 칸은 그대로 둔다.
 *
 * 종일 ↔ 시각을 오갈 때는 반대쪽 칸을 `null` 로 비워야 한다. PATCH 는 안쪽 칸을 합치므로,
 * 비우지 않으면 date 와 dateTime 이 함께 남아 구글이 거절한다. 설명 · 장소도 빈 문자열을
 * 그대로 보내 지운 것이 지워지게 한다.
 */
export async function updateEvent(
  calendarId: string,
  eventId: string,
  input: EventInput,
): Promise<void> {
  requireEventId(eventId);
  await requireWritableCalendar(calendarId);

  const time = (value: EventInput["start"]) =>
    value.date
      ? { date: value.date, dateTime: null, timeZone: null }
      : { date: null, dateTime: value.dateTime, timeZone: value.timeZone };

  await calendarFetch(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        summary: input.title,
        description: input.description,
        location: input.location,
        start: time(input.start),
        end: time(input.end),
      }),
    },
  );
}

/** 일정을 지운다. 이미 지워진 일정(410 · 404)이어도 사람이 바라던 결과는 같다. */
export async function deleteEvent(calendarId: string, eventId: string): Promise<void> {
  requireEventId(eventId);
  await requireWritableCalendar(calendarId);

  try {
    await calendarFetch(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE" },
    );
  } catch (error) {
    if (error instanceof GoogleCalendarError && error.kind === "not-found") return;
    throw error;
  }
}

/**
 * 콜백이 주소(`?google=`)에 실어 보낸 결과를 사람이 읽는 말로. 모르는 값이면 null —
 * 주소를 손으로 고쳐 적어도 엉뚱한 알림이 뜨지 않는다.
 */
export function describeConnectResult(
  code: string,
): { tone: "success" | "error"; message: string } | null {
  const messages: Record<string, { tone: "success" | "error"; message: string }> = {
    connected: { tone: "success", message: "구글 캘린더를 연결했습니다." },
    denied: { tone: "error", message: "구글 동의 화면에서 취소되어 연결하지 않았습니다." },
    state: {
      tone: "error",
      message: "연결 요청이 만료되었거나 이 브라우저에서 시작한 것이 아닙니다. 다시 눌러 주세요.",
    },
    exchange: { tone: "error", message: "구글에서 연결 정보를 받지 못했습니다. 다시 시도하세요." },
    "no-refresh-token": {
      tone: "error",
      message:
        "구글이 갱신 토큰을 주지 않았습니다. 구글 계정 › 보안 › 연결된 앱에서 이 앱을 지운 뒤 다시 연결하세요.",
    },
    scope: {
      tone: "error",
      message: "일정 권한에 동의하지 않아 연결하지 않았습니다. 다시 연결하면서 모든 항목에 체크하세요.",
    },
    email: { tone: "error", message: "연결한 구글 계정의 이메일을 확인하지 못했습니다. 다시 시도하세요." },
    "not-configured": {
      tone: "error",
      message: "GOOGLE_CLIENT_ID · GOOGLE_CLIENT_SECRET 환경변수가 없어 연결할 수 없습니다.",
    },
    error: { tone: "error", message: "연결을 저장하지 못했습니다. 잠시 후 다시 시도하세요." },
  };
  return messages[code] ?? null;
}
