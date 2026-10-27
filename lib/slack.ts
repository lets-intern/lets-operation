/**
 * 슬랙에 예약을 맡기는 창구. 참여자 안내문은 우리 서버가 시각을 지키는 것이 아니라
 * **슬랙의 예약 발송**으로 나간다 — 걸어두면 우리 쪽이 멈춰 있어도 글은 나간다(plan.md §5).
 *
 * 토큰은 환경변수가 아니라 **부르는 쪽이 넘긴다.** 챌린지마다 보내는 사람이 다르고,
 * 그 계정은 데이터베이스에 있다(domain/slack-sender). 서버 전체에 하나뿐인 토큰이라는
 * 전제가 없으므로 여기서 환경을 읽지 않는다.
 *
 * 슬랙은 실패도 200 으로 돌려주고 본문의 `ok` 로 가른다. 상태 코드만 보면 아무것도 안
 * 나갔는데 걸린 것으로 기록되므로, 여기서 `ok` 를 반드시 읽는다.
 *
 * 글은 `text` 가 아니라 **`markdown_text`** 로 넘긴다. `text` 가 읽는 mrkdwn 에는 목록
 * 문법이 없어 `- 항목` 이 하이픈째로 찍혔다. `markdown_text` 는 슬랙이 표준 마크다운으로
 * 읽어 불렛 · 번호 목록 · 제목 · `[글자](주소)` 를 서식으로 바꿔준다. 두 인자는 **함께
 * 쓸 수 없다**("should not be used in conjunction with `blocks` or `text`").
 *
 * 바뀐 것이 하나 있다. mrkdwn 에서 굵게였던 `*한 별표*` 가 마크다운에서는 **기울임**이다.
 * 굵게는 `**두 별표**` 다.
 */

/** 저쪽이 느릴 때 크론이 통째로 붙잡히지 않도록 끊는다. */
const TIMEOUT_MS = 10_000;

const SCHEDULE_URL = "https://slack.com/api/chat.scheduleMessage";
const DELETE_SCHEDULE_URL =
  "https://slack.com/api/chat.deleteScheduledMessage";
const POST_URL = "https://slack.com/api/chat.postMessage";
const AUTH_TEST_URL = "https://slack.com/api/auth.test";

export type ScheduleMessageInput = {
  /**
   * 보내는 사람의 슬랙 사용자 토큰(`xoxp-`). 이 자격으로 글이 나가고, 예약도 그 사람의
   * `예약된 메시지` 목록에 선다.
   */
  token: string;
  /** 채널 아이디(`C01ABCDEFGH`) 또는 이름. 슬랙은 둘 다 받는다. */
  channel: string;
  /** 나갈 시각. 슬랙에는 초 단위 정수로 넘긴다. */
  postAt: Date;
  /** 나갈 글. 표준 마크다운으로 읽힌다. */
  markdown: string;
};

/**
 * 예약 한 건. 돌려주는 것은 슬랙의 예약 식별자다 — 사람이 슬랙에서 그 예약을 찾거나
 * 지울 때의 열쇠이고, 우리에게는 "이미 걸렸다" 는 표시다.
 *
 * 실패는 예외로 던진다. 부르는 쪽이 한 건씩 감싸 사유를 기록하므로, 한 건의 실패가
 * 나머지 예약을 막지 않는다.
 */
export async function scheduleSlackMessage(
  input: ScheduleMessageInput,
): Promise<string> {
  const response = await fetch(SCHEDULE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: input.channel,
      // 슬랙은 초 단위 유닉스 시각을 받는다. 밀리초를 그대로 넘기면 먼 미래가 된다.
      post_at: Math.floor(input.postAt.getTime() / 1000),
      markdown_text: input.markdown,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`슬랙 응답이 ${response.status} 입니다.`);
  }

  const body = (await response.json()) as SlackResponse;

  if (!body.ok) {
    throw new Error(describeSlackError(body));
  }

  if (!body.scheduled_message_id) {
    // 걸렸다고는 하는데 식별자가 없다. 걸린 것으로 기록하면 다음에 또 걸어 두 통이 나간다.
    throw new Error("슬랙이 예약 식별자를 돌려주지 않았습니다.");
  }

  return body.scheduled_message_id;
}

/**
 * 걸어둔 예약 하나를 슬랙에서 거둔다. 채널은 **걸 때 넘긴 그 값**이어야 한다 —
 * 챌린지의 채널을 그 뒤에 바꿨어도 예약은 옛 채널에 서 있다.
 *
 * **이미 없는 예약은 성공으로 본다.** 사람이 슬랙에서 먼저 지웠거나 발송 시각이 지나
 * 이미 나갔을 수 있는데, 그때 실패로 막으면 우리 줄만 영영 남아 다시 걸 수도 거둘 수도
 * 없게 된다. 하려던 일(그 예약을 없던 것으로 만들기)은 어차피 이루어진 상태다.
 */
export async function deleteScheduledSlackMessage(input: {
  token: string;
  channel: string;
  scheduledMessageId: string;
}): Promise<void> {
  const response = await fetch(DELETE_SCHEDULE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: input.channel,
      scheduled_message_id: input.scheduledMessageId,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`슬랙 응답이 ${response.status} 입니다.`);
  }

  const body = (await response.json()) as SlackResponse;

  if (!body.ok && body.error !== "invalid_scheduled_message_id") {
    throw new Error(describeSlackError(body));
  }
}

/**
 * 보내는 사람 자신에게 한 통 보낸다. 예약을 걸었다는 **영수증**이 이 길로 간다.
 *
 * 받는 사람을 따로 받지 않고 **토큰 주인**에게 보낸다. 영수증은 그 예약을 건 사람이
 * 받아야 하고, 그 사람이 곧 이 토큰의 주인이기 때문이다. 누구인지는 우리가 적어두지
 * 않고 슬랙에게 묻는다(`auth.test`) — 계정을 바꿔 적어도 늘 지금 주인에게 간다.
 *
 * 영수증이 필요한 이유는 슬랙이 **API 로 건 예약을 제 화면에 보여주지 않기** 때문이다
 * (plan.md §5 의 2026-09-13 정정). 무엇이 언제 나가는지 슬랙 안에서 알 길이 이것뿐이다.
 */
export async function sendSlackSelfMessage(input: {
  token: string;
  markdown: string;
}): Promise<void> {
  const me = await slackCall(AUTH_TEST_URL, input.token, {});
  if (!me.user_id) throw new Error("슬랙이 계정을 알려주지 않았습니다.");

  await slackCall(POST_URL, input.token, {
    channel: me.user_id,
    markdown_text: input.markdown,
  });
}

/** 슬랙 호출 한 번. `ok` 가 아니면 사람이 읽는 사유로 던진다. */
async function slackCall(
  url: string,
  token: string,
  payload: Record<string, unknown>,
): Promise<SlackResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`슬랙 응답이 ${response.status} 입니다.`);

  const body = (await response.json()) as SlackResponse;
  if (!body.ok) throw new Error(describeSlackError(body));

  return body;
}

/**
 * 슬랙이 돌려주는 것 중 우리가 읽는 몫. `needed`/`provided` 는 권한이 모자랄 때만 온다.
 */
type SlackResponse = {
  ok?: boolean;
  error?: string;
  /** 이 호출에 필요한 권한. 슬랙이 `missing_scope` 와 함께 알려준다. */
  needed?: string;
  /** 지금 이 토큰이 가진 권한. */
  provided?: string;
  scheduled_message_id?: string;
  /** `auth.test` 가 알려주는 토큰 주인. */
  user_id?: string;
};

/**
 * 슬랙의 오류 코드를 사람이 읽는 말로. 운영 화면에 그대로 서는 문장이라,
 * 무엇을 손봐야 하는지가 읽혀야 한다.
 */
function describeSlackError(body: SlackResponse): string {
  const error = body.error;

  switch (error) {
    case "channel_not_found":
      return "슬랙에서 그 채널을 찾지 못했습니다. 채널 아이디를 확인하세요.";
    case "not_in_channel":
      return "보내는 사람이 그 채널에 들어가 있지 않습니다. 채널에 참여한 뒤 다시 시도합니다.";
    case "is_archived":
      return "보관된 채널입니다.";
    case "invalid_auth":
    case "not_authed":
    case "token_revoked":
      return "이 계정의 슬랙 토큰이 더 이상 유효하지 않습니다. 다시 적어 주세요.";
    case "not_allowed_token_type":
      // 회전을 켠 앱이 접근 토큰과 나란히 내주는 갱신 토큰(`xoxe-`)을 적은 경우가 대부분이다.
      return "글을 보낼 수 없는 종류의 토큰입니다. 갱신 토큰(xoxe-)이 아니라 접근 토큰(xoxp- 또는 xoxe.xoxp-)을 적어 주세요.";
    case "token_expired":
      // 회전을 켠 앱의 접근 토큰은 12시간이면 만료된다. 우리는 적어둔 토큰을 그대로 쓰고
      // 갱신하지 않으므로 사람이 다시 적는 수밖에 없다. **회전은 한 번 켜면 끌 수 없다** —
      // 되풀이가 번거로우면 회전을 켜지 않은 앱으로 토큰을 새로 받는 쪽이 답이다.
      return "토큰이 만료됐습니다. 회전을 켠 앱의 접근 토큰은 12시간마다 만료되므로 새 토큰을 다시 적어 주세요.";
    case "account_inactive":
      return "이 계정이 슬랙에서 비활성됐습니다.";
    case "missing_scope":
      // 권한은 앱 설정에서 더하는 것으로 끝나지 않는다. **다시 설치해 새 토큰을 받아야**
      // 그 권한이 붙는데, 그 한 걸음을 빠뜨리면 같은 자리를 몇 번이고 되돌게 된다.
      return withScopes(
        "이 토큰에 chat:write 권한이 없습니다. 슬랙 앱의 User Token Scopes 에 chat:write 를 더하고 앱을 다시 설치한 뒤, 새로 받은 토큰을 적어야 합니다.",
        body,
      );
    case "not_in_channel_user":
    case "user_not_in_channel":
      return "보내는 사람이 그 채널에 들어가 있지 않습니다.";
    case "time_in_past":
      return "이미 지난 시각이라 슬랙이 예약을 받지 않았습니다.";
    case "time_too_far":
      return "슬랙이 받는 예약 범위를 넘어선 시각입니다.";
    case "msg_too_long":
      return "글이 슬랙 한 통에 들어가는 길이를 넘었습니다.";
    case "ratelimited":
    case "rate_limited":
      return "슬랙 호출이 너무 잦아 거절됐습니다. 다음 확인에서 다시 시도합니다.";
    default:
      return `슬랙이 예약을 거절했습니다(${error ?? "사유 없음"}).`;
  }
}

/**
 * 권한이 모자랄 때 슬랙이 함께 보내는 `needed`/`provided` 를 붙인다.
 *
 * 무엇이 필요하고 지금 무엇을 들고 있는지가 그 안에 있어, 이 두 줄만 있으면 앱 설정을
 * 열어 하나씩 대조하지 않아도 된다. 특히 `provided` 는 **다시 설치했는지**를 그대로
 * 말해준다 — 권한을 더했는데 목록이 그대로면 옛 토큰을 아직 쓰고 있다는 뜻이다.
 *
 * 문서에 적힌 필드가 아니라 없을 수도 있으므로 있을 때만 붙인다. 가진 권한은 길게
 * 늘어지는 일이 있어 줄이 한 화면을 먹지 않도록 끊는다.
 */
function withScopes(message: string, body: SlackResponse): string {
  const parts = [
    body.needed ? `필요: ${body.needed}` : null,
    body.provided ? `현재: ${truncate(body.provided)}` : null,
  ].filter((part): part is string => part !== null);

  return parts.length === 0 ? message : `${message} (${parts.join(" / ")})`;
}

/** 사유 한 줄이 화면을 먹지 않을 만큼. 끊긴 것은 말줄임으로 드러낸다. */
const MAX_SCOPE_LIST = 120;

function truncate(value: string): string {
  return value.length <= MAX_SCOPE_LIST
    ? value
    : `${value.slice(0, MAX_SCOPE_LIST)}…`;
}
