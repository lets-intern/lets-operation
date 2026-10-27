/**
 * 안내문 규칙. 데이터베이스를 모르는 순수 로직이라 화면에서도 그대로 쓴다.
 *
 * 안내문은 설정과 같은 자리에 붙는다 — 기수가 아니라 챌린지다.
 * "포트폴리오 챌린지 미션 3" 의 안내문을 한 번 적어두면 30기든 31기든 같은 글이 나간다.
 * 자리는 프로그램이 도는 차례 그대로 시작 전 · 미션 1..N · 종료 후로 선다.
 *
 * 버전(무경력자·경력자)은 가리지 않는다. 두 갈래가 같은 회차에 같은 안내문을 받으므로
 * 갈래마다 같은 글을 두 번 적지 않는다. 갈래별로 달라지는 날이 오면 그때 칸을 더한다.
 */

import { unlinkedMentions } from "./slack-markdown";

/**
 * 안내문을 받는 쪽. 받는 쪽이 곧 나가는 통로를 정한다 — 참여자는 챌린지 슬랙 채널,
 * 챌린지 공지방은 모든 챌린지가 함께 쓰는 전체 공지 채널, 멘토는 카카오톡이다.
 * 통로를 따로 고르게 하지 않는 것은, 고를 수 있게 두면 참여자에게 카카오톡으로 가는
 * 조합이 생기는데 그런 운영이 없기 때문이다.
 *
 * 챌린지 공지방은 챌린지에 붙지 않는다. 모든 챌린지가 한 벌을 함께 쓰므로 챌린지를 고르는
 * 드롭다운에 따로 서고, 챌린지의 표에는 참여자 · 멘토 두 칸만 선다(`CHALLENGE_AUDIENCES`).
 */
export const NOTICE_AUDIENCES = ["PARTICIPANT", "MENTOR", "ANNOUNCEMENT"] as const;

export type NoticeAudience = (typeof NOTICE_AUDIENCES)[number];

/** 챌린지에 붙는 쪽. 챌린지를 고르면 서는 표의 칸 차례가 이 차례다. */
export const CHALLENGE_AUDIENCES = ["PARTICIPANT", "MENTOR"] as const satisfies readonly NoticeAudience[];

/**
 * 챌린지에 붙는 안내문인지. 공지방 글은 챌린지가 없고, 나머지는 반드시 있다 —
 * 서버가 저장할 때 이것으로 가르고 테이블의 CHECK 제약이 같은 규칙을 한 번 더 본다.
 */
export function belongsToChallenge(audience: NoticeAudience): boolean {
  return audience !== "ANNOUNCEMENT";
}

/**
 * 공지방 글이 설 수 있는 자리. 미션 회차는 챌린지마다 개수와 날짜가 달라 한 벌의 글이
 * 가리킬 데가 없으므로 시작 전 · 종료 후만 둔다(plan.md §5).
 */
export function allowsPlacement(audience: NoticeAudience, placement: NoticePlacement): boolean {
  return belongsToChallenge(audience) || placement.phase !== null;
}

/**
 * 본문에 적어두면 그 기수의 이름으로 바뀌어 나가는 자리표시. 공지방 글은 한 벌이 여러
 * 챌린지를 대신하므로, 어느 챌린지의 공지인지를 이것으로 적는다.
 */
export const NOTICE_PLACEHOLDERS = { challenge: "{챌린지}", cohort: "{기수}" } as const;

/** 자리표시를 그 기수의 값으로. 적어둔 나머지 글은 건드리지 않는다. */
export function fillNoticePlaceholders(
  body: string,
  values: { challengeName: string; cohort: number },
): string {
  return body
    .replaceAll(NOTICE_PLACEHOLDERS.challenge, values.challengeName)
    .replaceAll(NOTICE_PLACEHOLDERS.cohort, String(values.cohort));
}

export const NOTICE_AUDIENCE_LABELS: Record<NoticeAudience, string> = {
  PARTICIPANT: "참여자",
  ANNOUNCEMENT: "챌린지 공지방",
  MENTOR: "멘토",
};

/** 받는 쪽에서 바로 나오는 통로. 저장하지 않고 여기서 읽는다. */
export const NOTICE_CHANNEL_LABELS: Record<NoticeAudience, string> = {
  PARTICIPANT: "슬랙",
  ANNOUNCEMENT: "슬랙",
  MENTOR: "카카오톡",
};

export function isNoticeAudience(value: string): value is NoticeAudience {
  return (NOTICE_AUDIENCES as readonly string[]).includes(value);
}

/**
 * 슬랙 예약으로 나가는 쪽. 크론이 이 쪽의 글만 읽어 건다 — 데이터베이스 조건과
 * `usesSchedule` 이 같은 목록을 보도록 한 곳에 둔다.
 */
export const SCHEDULED_AUDIENCES = ["PARTICIPANT", "ANNOUNCEMENT"] as const satisfies readonly NoticeAudience[];

/**
 * 예약 발송이 필요한 쪽인지. 참여자 · 챌린지 공지방 안내문은 정해둔 시각에 슬랙으로 나가고,
 * 멘토 안내문은 카카오톡으로 그때그때 보내 예약이 필요 없다.
 * 화면과 서버가 같은 답을 보도록 한 곳에 둔다.
 */
export function usesSchedule(audience: NoticeAudience): boolean {
  return (SCHEDULED_AUDIENCES as readonly NoticeAudience[]).includes(audience);
}

/**
 * 회차 밖 안내문이 서는 자리. 개강을 알리는 글과 수료를 알리는 글은 기준일도(시작일 ·
 * 종료일) 방향도(앞 · 뒤) 반대라, 한 자리에 섞어두면 목록에서 어느 쪽 글인지 제목으로만
 * 가리게 된다. 그래서 두 자리로 나눠 세운다.
 */
export const NOTICE_PHASES = ["BEFORE_START", "AFTER_END"] as const;

export type NoticePhase = (typeof NOTICE_PHASES)[number];

export const NOTICE_PHASE_LABELS: Record<NoticePhase, string> = {
  BEFORE_START: "시작 전",
  AFTER_END: "종료 후",
};

export function isNoticePhase(value: string): value is NoticePhase {
  return (NOTICE_PHASES as readonly string[]).includes(value);
}

/**
 * 안내문이 붙는 자리. 회차에 붙거나(`missionSeq`), 회차 밖의 시작 전 · 종료 후(`phase`)다.
 * 둘 중 하나만 찬다 — 표의 줄 하나가 곧 이 값이고, 저장하는 두 칸도 이대로다.
 */
export type NoticePlacement =
  | { phase: NoticePhase; missionSeq: null }
  | { phase: null; missionSeq: number };

export function atPhase(phase: NoticePhase): NoticePlacement {
  return { phase, missionSeq: null };
}

export function atMission(missionSeq: number): NoticePlacement {
  return { phase: null, missionSeq };
}

/** 자리를 가리키는 말. 표의 맨 왼쪽 칸과 폼 머리말이 같은 말을 쓴다. */
export function describePlacement(placement: NoticePlacement): string {
  return placement.phase === null
    ? `미션 ${placement.missionSeq}`
    : NOTICE_PHASE_LABELS[placement.phase];
}

/**
 * 걸린 글이 어디의 무엇인지. 참여자 채널로 가는 글은 자리만으로 충분하고, 공지방 글에는
 * 받는 쪽을 덧붙인다 — 예약 목록과 영수증에서 같은 기수의 두 채널 글이 섞여 서기 때문이다.
 */
export function describeNoticeTarget(
  placement: NoticePlacement,
  audience: NoticeAudience,
): string {
  return audience === "PARTICIPANT"
    ? describePlacement(placement)
    : `${describePlacement(placement)} · ${NOTICE_AUDIENCE_LABELS[audience]}`;
}

/** 영수증에 서는 한 줄. 언제 나가는 무슨 글인지가 있으면 읽힌다. */
export type ReceiptLine = {
  postAt: Date;
  title: string;
  placement: NoticePlacement;
  audience: NoticeAudience;
};

/**
 * 예약을 걸었다는 영수증. 보낸 사람 자신에게 슬랙으로 간다.
 *
 * 슬랙이 **API 로 건 예약을 제 화면에 보여주지 않아서**(plan.md §5 의 2026-09-13 정정)
 * 무엇이 언제 나가는지 슬랙 안에서 알 길이 없다. 이 글이 그 자리를 메운다 — 예약 목록에
 * 서는 것은 아니므로, **거기서는 고칠 수 없다는 것까지** 함께 적어야 오해가 없다.
 *
 * 슬랙에 넘기는 글이라 **표준 마크다운**이다(`**굵게**` · `_기울임_` · `- 목록`).
 * 안내문과 같은 길로 나가므로 문법도 같아야 한다 — 여기만 mrkdwn 으로 남겨두면
 * `*한 별표*` 가 굵게가 아니라 기울임으로 서고, 그 어긋남은 영수증에서야 드러난다.
 */
export function noticeReceiptText(summary: {
  /** "기필코 경험정리 챌린지 31기" */
  title: string;
  placed: ReceiptLine[];
  /** 같은 기수에서 못 걸린 건. 0 이면 적지 않는다. */
  stuck: number;
  /** 시각을 사람이 읽는 꼴로. 부르는 쪽이 넘겨 이 파일이 날짜 서식을 모르게 둔다. */
  formatAt: (value: Date) => string;
}): string {
  const lines = summary.placed.map(
    (line) =>
      `- ${summary.formatAt(line.postAt)} — ${describeNoticeTarget(line.placement, line.audience)} · ${line.title}`,
  );

  if (summary.stuck > 0) {
    lines.push("", `:warning: 못 걸린 안내문이 ${summary.stuck}건 있습니다.`);
  }

  return [
    `:calendar: **${summary.title}** 안내문 ${summary.placed.length}건을 예약했습니다.`,
    "",
    ...lines,
    "",
    "_이 예약은 슬랙의 `예약된 메시지` 목록에는 보이지 않습니다. 고치거나 거두려면 프로그램 운영 화면에서 취소하세요._",
  ].join("\n");
}

/** 같은 자리인지. 화면이 어느 줄에 폼을 펼지 고를 때 쓴다. */
export function placementKey(placement: NoticePlacement): string {
  return placement.phase ?? `MISSION_${placement.missionSeq}`;
}

/**
 * 기수가 시작하기 며칠 전에 슬랙 예약이 걸리는지. 크론이 하루 한 번 돌며 이만큼 남은
 * 기수를 찾아 그 기수의 슬랙 안내문(참여자 · 챌린지 공지방)을 한꺼번에 예약한다(plan.md §5).
 *
 * 4일인 이유는 그쯤이면 기수의 날짜가 더 흔들리지 않기 때문이다. 슬랙이 120일 앞까지만
 * 예약을 받는 것과는 무관하다 — 챌린지는 한 달 안에 끝난다.
 *
 * 이 값이 곧 시작 전 안내문이 적을 수 있는 가장 이른 시점이다. 두 값을 따로 두면
 * 예약을 거는 날에 이미 지난 시각을 적을 자리가 생긴다.
 */
export const RESERVE_DAYS_BEFORE_START = 4;

/**
 * 예약 발송 시각을 재는 기준일.
 *
 * 안내문은 챌린지에 붙어 있어 기수의 달력을 모른다. 그래서 "10월 2일 오전 10시" 가 아니라
 * "미션 3 시작 1일 전 오전 10시" 로 적어둔다. 기수가 서면 그 기수의 날짜로 계산되므로
 * 기수마다 발송일을 다시 찍지 않는다.
 *
 * `MISSION_END` 는 **미션 수행이 끝나는 날**이다. 피드백이 붙은 미션은 수행이 끝난 날과
 * 피드백까지 끝난 날이 며칠 벌어지는데, 설정에서 피드백이 수행기간에 포함되지 않는 것과
 * 같은 잣대를 쓴다. 안내문이 실제로 필요한 시점("제출 마감입니다")도 그쪽이다(plan.md §5).
 */
export const NOTICE_ANCHORS = [
  "MISSION_START",
  "MISSION_END",
  "PROGRAM_START",
  "PROGRAM_END",
] as const;

export type NoticeAnchor = (typeof NOTICE_ANCHORS)[number];

export const NOTICE_ANCHOR_LABELS: Record<NoticeAnchor, string> = {
  MISSION_START: "미션 시작일",
  MISSION_END: "미션 종료일",
  PROGRAM_START: "프로그램 시작일",
  PROGRAM_END: "프로그램 종료일",
};

export function isNoticeAnchor(value: string): value is NoticeAnchor {
  return (NOTICE_ANCHORS as readonly string[]).includes(value);
}

/**
 * 그 자리에서 고를 수 있는 기준일.
 *
 * 회차에 붙은 안내문은 그 미션의 앞뒤를 기준으로 삼는다. 회차 밖 안내문에게는
 * "미션 시작일" 이 어느 미션인지 가리킬 데가 없어 뜻이 없고, 자리가 이미 시작 전 ·
 * 종료 후로 갈려 있으므로 기준일도 하나로 정해진다.
 */
export function anchorsFor(placement: NoticePlacement): readonly NoticeAnchor[] {
  if (placement.phase === null) return ["MISSION_START", "MISSION_END"] as const;

  return placement.phase === "BEFORE_START"
    ? (["PROGRAM_START"] as const)
    : (["PROGRAM_END"] as const);
}

/**
 * 그 자리에서 기준일의 앞뒤 중 어느 쪽만 뜻이 있는지. 회차 자리는 둘 다 쓰므로 `null`.
 *
 * 시작 전 자리에 "시작 3일 후" 를, 종료 후 자리에 "종료 3일 전" 을 적을 수 있게 두면
 * 자리 이름과 적힌 시점이 어긋난다. 시작한 뒤에 나가는 글은 미션 자리의 것이고,
 * 끝나기 전에 나가는 글은 마지막 미션 자리의 것이라 갈 곳이 따로 있다.
 */
export function lockedOffsetSide(
  placement: NoticePlacement,
): "before" | "after" | null {
  if (placement.phase === null) return null;

  return placement.phase === "BEFORE_START" ? "before" : "after";
}

/** 며칠과 방향을 하나의 오프셋으로. 당일은 방향에 뜻이 없어 그대로 0 이다. */
export function toOffsetDays(days: number, side: "before" | "after"): number {
  return days === 0 || side === "after" ? days : -days;
}

/** 예약 발송 시점. 세 값은 늘 함께 있거나 함께 없다. */
export type NoticeSchedule = {
  anchor: NoticeAnchor;
  /** 기준일로부터 며칠. 음수면 기준일 전, 0 이면 당일, 양수면 뒤다. */
  offsetDays: number;
  /** 자정부터 흐른 분. 오전 10시는 600 이다. */
  minuteOfDay: number;
};

/** 안내문 한 장. */
export type Notice = {
  audience: NoticeAudience;
  /** 어느 자리의 안내문인지 — 시작 전 · 미션 N · 종료 후. */
  placement: NoticePlacement;
  title: string;
  body: string;
  /** 아직 시점을 안 정했거나 멘토 안내문이면 `null`. */
  schedule: NoticeSchedule | null;
};

/** 목록과 드롭다운이 무너지지 않을 길이. 화면과 서버가 같은 값을 본다. */
export const MAX_NOTICE_TITLE_LENGTH = 60;

/** 한 번에 보내는 글의 상한. 슬랙 한 통에 들어가는 길이를 넘지 않는다. */
export const MAX_NOTICE_BODY_LENGTH = 3000;

/** 기준일에서 이만큼 떨어진 시점까지 적을 수 있다. 오타로 들어온 큰 수를 여기서 막는다. */
export const MAX_SCHEDULE_OFFSET_DAYS = 60;

/**
 * 그 자리에서 적을 수 있는 가장 먼 시점.
 *
 * 시작 전 안내문만 따로 좁다. 예약은 기수가 시작하기 `RESERVE_DAYS_BEFORE_START` 일 전에
 * 걸리므로, 그보다 이른 시점을 적으면 거는 날에 이미 지난 시각이 되어 그 글은 나가지
 * 않는다. 나갈 수 없는 시점을 적을 자리를 아예 없앤다(plan.md §5).
 *
 * 나머지 자리는 기준일이 모두 시작일 뒤에 있어 이 문제가 없다.
 */
export function maxOffsetDaysFor(placement: NoticePlacement): number {
  return placement.phase === "BEFORE_START"
    ? RESERVE_DAYS_BEFORE_START
    : MAX_SCHEDULE_OFFSET_DAYS;
}

/** 슬랙 채널 표기의 상한. 아이디는 열 자 남짓이고 이름도 슬랙이 80자로 막는다. */
export const MAX_SLACK_CHANNEL_LENGTH = 80;

/**
 * 적어둔 슬랙 채널. 비었으면 `null` 이고, 그 챌린지는 예약이 걸리지 않는다.
 *
 * 아이디(`C01ABCDEFGH`)와 이름(`#포트폴리오-30기`) 둘 다 받는다 — 슬랙이 둘 다 받고,
 * 사람이 어느 쪽을 복사해 오는지 정해져 있지 않다. 앞의 `#` 는 이름의 일부가 아니라
 * 표기라 걷어낸다.
 */
export function parseSlackChannel(text: string): string | null {
  const trimmed = text.trim().replace(/^#/, "").trim();

  return trimmed === "" ? null : trimmed;
}

/** 보내는 계정 이름의 상한. 드롭다운이 무너지지 않을 길이면 된다. */
export const MAX_SENDER_NAME_LENGTH = 40;

/** 토큰 표기의 상한. 슬랙 사용자 토큰은 100자 남짓이고 더 길어질 여유를 둔다. */
export const MAX_SLACK_TOKEN_LENGTH = 300;

/**
 * 슬랙 토큰의 꼴. `xoxp-`(사용자) · `xoxb-`(봇) 같은 접두어로 시작한다.
 *
 * 사용자 토큰만 받도록 좁히지 않는다 — 봇 토큰을 적으면 앱 이름으로 나가고 예약이
 * 본인 목록에 서지 않는데, 그것이 잘못이라고 우리가 단정할 일은 아니다. 대신 표시에
 * 접두어가 남아(`xoxb-…`) 어느 쪽을 적었는지 화면에서 읽힌다.
 *
 * 토큰 회전을 켠 앱의 접근 토큰은 앞에 `xoxe.` 가 붙어 `xoxe.xoxp-…` 로 온다.
 */
const SLACK_TOKEN_SHAPE = /^(xoxe\.)?xox[a-z]-[A-Za-z0-9-]{10,}$/;

/**
 * 갱신 토큰. 꼴은 토큰이 맞지만 이것으로는 글을 보낼 수 없다.
 *
 * 토큰 회전을 켠 앱은 **접근 토큰(`xoxe.xoxp-…`)과 갱신 토큰(`xoxe-…`)을 나란히**
 * 내준다. 둘이 닮아 갱신 토큰을 집어 오기 쉬운데, 그 토큰으로 예약을 걸면 슬랙이
 * `not_allowed_token_type` 으로 거절한다.
 *
 * 적는 자리에서 막는다. 그러지 않으면 며칠 뒤 크론이 돌 때에야 드러나는데, 그때는
 * 적은 사람도 이 화면도 거기 없다.
 */
const SLACK_REFRESH_TOKEN = /^xoxe-/;

/** 적어둔 토큰이 쓸 수 없는 이유. 쓸 수 있으면 `null`. */
export type SlackTokenProblem = "shape" | "refresh";

export function slackTokenProblem(value: string): SlackTokenProblem | null {
  const token = value.trim();

  if (SLACK_REFRESH_TOKEN.test(token)) return "refresh";
  if (!SLACK_TOKEN_SHAPE.test(token)) return "shape";

  return null;
}

/**
 * 토큰을 가리는 표시. 접두어와 끝 네 자만 남긴다 — 접두어는 사용자 토큰인지 가리고,
 * 끝 네 자는 두 계정의 토큰을 구별하거나 방금 바꾼 것이 맞는지 확인하는 데 쓴다.
 *
 * 화면이 토큰에 닿는 것은 여기까지다. 이 앱은 팀 공용 비밀번호 하나로 열리고 계정
 * 분리가 없어서(plan.md §2), 토큰을 되돌려주는 자리를 만들면 남의 슬랙 자격이 그
 * 자리에 놓인다.
 */
export function slackTokenHint(token: string): string {
  const [prefix] = token.split("-");

  return `${prefix}-…${token.slice(-4)}`;
}

/** 시점을 처음 정할 때 채워 둘 값 — 기준일 당일 오전 10시. */
export const DEFAULT_SCHEDULE_MINUTE_OF_DAY = 10 * 60;

const MINUTES_PER_DAY = 24 * 60;

/** 분을 `HH:MM` 으로. `<input type="time">` 이 읽고 쓰는 형태 그대로다. */
export function formatTimeOfDay(minuteOfDay: number): string {
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** `HH:MM` 을 분으로. 빈 칸과 `25:00`, `열시` 를 한꺼번에 걸러 낸다. */
export function parseTimeOfDay(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;

  const minuteOfDay = Number(match[1]) * 60 + Number(match[2]);
  if (Number(match[2]) > 59) return null;
  if (minuteOfDay >= MINUTES_PER_DAY) return null;

  return minuteOfDay;
}

/**
 * 며칠 떨어졌는지를 사람 말로. 0 은 "며칠 전·후" 가 아니라 "당일" 이라 따로 읽는다.
 */
export function describeOffset(offsetDays: number): string {
  if (offsetDays === 0) return "당일";

  return offsetDays < 0 ? `${-offsetDays}일 전` : `${offsetDays}일 후`;
}

/**
 * 기준일을 가리키는 말. 회차에 붙은 안내문은 몇 번째 미션인지까지 적는다 —
 * "미션 시작일" 만으로는 어느 미션인지 알 수 없다.
 */
export function describeAnchor(
  anchor: NoticeAnchor,
  placement: NoticePlacement,
): string {
  if (placement.phase !== null) return NOTICE_ANCHOR_LABELS[anchor];

  switch (anchor) {
    case "MISSION_START":
      return `미션 ${placement.missionSeq} 시작일`;
    case "MISSION_END":
      return `미션 ${placement.missionSeq} 종료일`;
    default:
      return NOTICE_ANCHOR_LABELS[anchor];
  }
}

/** 예약 시점 한 줄 요약. 목록에서 "언제 나가는가" 를 한눈에 읽는 자리다. */
export function describeSchedule(
  schedule: NoticeSchedule,
  placement: NoticePlacement,
): string {
  return [
    describeAnchor(schedule.anchor, placement),
    describeOffset(schedule.offsetDays),
    formatTimeOfDay(schedule.minuteOfDay),
  ].join(" ");
}

/**
 * 저장을 막지는 않지만 사람이 한 번 봐야 하는 것들.
 *
 * 시점을 아직 안 정한 채 글만 먼저 적어두는 일이 실제로 있으므로 규칙으로 못 박지 않는다.
 * 대신 그 안내문이 저절로 나가지 않는다는 사실은 눈에 띄어야 한다.
 */
export function noticeWarnings(notice: Notice): string[] {
  const warnings: string[] = [];

  if (usesSchedule(notice.audience) && notice.schedule === null) {
    warnings.push(
      "예약 발송 시점이 비어 있습니다. 이 안내문은 저절로 나가지 않고 사람이 직접 보내야 합니다.",
    );
  }

  /*
   * 슬랙으로 나가는 글에서만 본다. 카카오톡으로 사람이 직접 보내는 멘토 안내문에는
   * 슬랙 멘션 문법이 뜻이 없어, 여기서 알리면 고칠 수 없는 것을 고치라는 말이 된다.
   */
  if (usesSchedule(notice.audience)) {
    const unlinked = unlinkedMentions(notice.body);

    if (unlinked.length > 0) {
      warnings.push(
        `${unlinked.join(" · ")} 은(는) 슬랙에서 멘션이 되지 않고 글자로 나갑니다. 멘션하려면 슬랙 프로필에서 멤버 ID 를 복사해 <@U012AB3CD> 꼴로 적으세요.`,
      );
    }
  }

  return warnings;
}

/**
 * 한 챌린지의 안내문을 자리별로 묶은 것. 아직 안 적은 자리도 서 있어
 * 무엇이 비었는지 그대로 드러난다.
 */
export type NoticeSlot<T> = {
  placement: NoticePlacement;
  /**
   * 설정에 없는 회차. 미션 개수를 줄이면 갈 곳이 없어진 안내문이 남는데,
   * 적어둔 글을 조용히 지우지 않고 여기에 표시해 사람이 정하게 한다.
   */
  orphan: boolean;
  notices: T[];
};

/**
 * 자리를 만든다. 시작 전 · 미션 1..N · 종료 후 순서로 세워 프로그램이 도는 차례
 * 그대로 읽힌다. 설정에 없는 회차는 그 흐름에 낄 데가 없어 맨 아래에 따로 선다.
 *
 * 설정이 없어 회차를 모르는 챌린지도 시작 전 · 종료 후 자리는 선다 — 개강 안내는
 * 미션 구성을 정하기 전에도 쓸 수 있다.
 */
export function toNoticeSlots<T extends { placement: NoticePlacement }>(
  notices: T[],
  missionCount: number,
): NoticeSlot<T>[] {
  const at = (placement: NoticePlacement) => {
    const key = placementKey(placement);

    return notices.filter((notice) => placementKey(notice.placement) === key);
  };

  const slot = (placement: NoticePlacement, orphan = false) => ({
    placement,
    orphan,
    notices: at(placement),
  });

  const planned = Array.from({ length: missionCount }, (_, index) =>
    slot(atMission(index + 1)),
  );

  const orphanSeqs = [
    ...new Set(
      notices
        .map((notice) => notice.placement.missionSeq)
        .filter((seq): seq is number => seq !== null && seq > missionCount),
    ),
  ].sort((a, b) => a - b);

  return [
    slot(atPhase("BEFORE_START")),
    ...planned,
    slot(atPhase("AFTER_END")),
    ...orphanSeqs.map((seq) => slot(atMission(seq), true)),
  ];
}
