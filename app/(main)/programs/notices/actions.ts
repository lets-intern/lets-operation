"use server";

import { revalidatePath } from "next/cache";

import {
  deleteChallengeNotice,
  saveChallengeNotice,
  saveChallengeSlackChannel,
} from "@/domain/challenge-notice";
import {
  allowsPlacement,
  anchorsFor,
  atMission,
  belongsToChallenge,
  atPhase,
  isNoticeAnchor,
  isNoticeAudience,
  isNoticePhase,
  slackTokenProblem,
  type SlackTokenProblem,
  lockedOffsetSide,
  MAX_SENDER_NAME_LENGTH,
  MAX_SLACK_TOKEN_LENGTH,
  MAX_NOTICE_BODY_LENGTH,
  MAX_NOTICE_TITLE_LENGTH,
  MAX_SCHEDULE_OFFSET_DAYS,
  MAX_SLACK_CHANNEL_LENGTH,
  maxOffsetDaysFor,
  parseSlackChannel,
  parseTimeOfDay,
  toOffsetDays,
  usesSchedule,
  type Notice,
  type NoticePlacement,
  type NoticeSchedule,
} from "@/domain/program-notice";
import { saveAnnouncementChannel } from "@/domain/notice-setting";
import {
  deleteSlackSender,
  saveSlackSender,
  setChallengeSlackSender,
} from "@/domain/slack-sender";

/**
 * 접근 차단은 proxy.ts 가 모든 경로에서 처리한다. 서버 액션도 페이지 경로로 POST 되므로
 * 같은 검사를 거친다(plan.md §7 — 계정 분리 없음 + 접근 차단 있음).
 */

/** "use server" 파일은 async 함수만 내보낼 수 있어 초기값 상수는 폼 쪽에 둔다. */
export type NoticeSaveState = {
  error: string | null;
  /** 성공했을 때만 채워진다. 열어둔 폼을 닫고 결과를 알리는 근거가 된다. */
  saved: { noticeId: string; title: string; at: number } | null;
};

export type NoticeRemoveState = { error: string | null };

/** 채널 저장 결과. 성공도 알려야 한다 — 적어둔 값이 그대로라 화면만으로는 갈리지 않는다. */
export type SlackChannelState = {
  error: string | null;
  saved: { at: number } | null;
};

const PATH = "/programs/notices";

/**
 * 챌린지의 슬랙 채널. 참여자 안내문이 여기로 예약된다.
 *
 * 예약 현황은 프로그램 운영 화면에 있으므로 그 경로도 함께 되살린다 — 채널을 적어
 * 넣으면 못 걸렸던 줄의 사유가 다음 크론에 풀리고, 그 목록이 이 값에 걸려 있다.
 */
export async function saveSlackChannel(
  _prevState: SlackChannelState,
  formData: FormData,
): Promise<SlackChannelState> {
  const challengeId = String(formData.get("challengeId") ?? "");
  if (!challengeId) return { error: "챌린지를 선택하세요.", saved: null };

  const raw = String(formData.get("slackChannelId") ?? "");
  if (raw.length > MAX_SLACK_CHANNEL_LENGTH) {
    return {
      error: `슬랙 채널은 ${MAX_SLACK_CHANNEL_LENGTH}자까지 쓸 수 있습니다.`,
      saved: null,
    };
  }

  try {
    const saved = await saveChallengeSlackChannel(challengeId, parseSlackChannel(raw));
    if (!saved) return { error: "이미 삭제된 챌린지입니다.", saved: null };

    revalidatePath(PATH);
    revalidatePath("/programs");

    return { error: null, saved: { at: Date.now() } };
  } catch (error) {
    console.error("슬랙 채널 저장 실패", error);
    return { error: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", saved: null };
  }
}

/**
 * 챌린지 공지방 채널. 모든 챌린지의 공지방 안내문이 여기로 예약된다(plan.md §5).
 * 챌린지를 고르지 않는다 — 채널이 하나뿐이다.
 */
export async function saveAnnouncementSlackChannel(
  _prevState: SlackChannelState,
  formData: FormData,
): Promise<SlackChannelState> {
  const raw = String(formData.get("slackChannelId") ?? "");
  if (raw.length > MAX_SLACK_CHANNEL_LENGTH) {
    return {
      error: `슬랙 채널은 ${MAX_SLACK_CHANNEL_LENGTH}자까지 쓸 수 있습니다.`,
      saved: null,
    };
  }

  try {
    await saveAnnouncementChannel(parseSlackChannel(raw));

    revalidatePath(PATH);
    revalidatePath("/programs");

    return { error: null, saved: { at: Date.now() } };
  } catch (error) {
    console.error("공지방 채널 저장 실패", error);
    return { error: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", saved: null };
  }
}

/**
 * 이 챌린지를 누구 계정으로 예약할지. 빈 값은 "고르지 않음" 이고, 그러면 예약이 걸리지 않는다.
 */
export async function selectNoticeSender(
  _prevState: SlackChannelState,
  formData: FormData,
): Promise<SlackChannelState> {
  const challengeId = String(formData.get("challengeId") ?? "");
  if (!challengeId) return { error: "챌린지를 선택하세요.", saved: null };

  const senderId = String(formData.get("senderId") ?? "") || null;

  try {
    const saved = await setChallengeSlackSender(challengeId, senderId);
    if (!saved) return { error: "이미 삭제된 챌린지입니다.", saved: null };

    revalidatePath(PATH);
    revalidatePath("/programs");

    return { error: null, saved: { at: Date.now() } };
  } catch (error) {
    // 고른 계정이 그 사이 지워진 경우다(P2003).
    if (hasPrismaCode(error, "P2003")) {
      return { error: "이미 삭제된 계정입니다. 새로고침 후 다시 고르세요.", saved: null };
    }
    console.error("보내는 계정 저장 실패", error);
    return { error: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", saved: null };
  }
}

export type SenderSaveState = {
  error: string | null;
  saved: { name: string; at: number } | null;
};

/**
 * 슬랙 계정 등록과 수정. 같은 폼이다 — 적는 칸이 같다.
 *
 * **토큰을 비워서 보내면 적어둔 것을 그대로 둔다.** 화면은 토큰을 되돌려받지 않으므로
 * (domain/slack-sender), 그러지 않으면 이름만 고치려 할 때 토큰을 다시 받아 적어야 한다.
 */
export async function saveNoticeSender(
  _prevState: SenderSaveState,
  formData: FormData,
): Promise<SenderSaveState> {
  const senderId = String(formData.get("senderId") ?? "") || null;

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "이름을 입력하세요.", saved: null };
  if (name.length > MAX_SENDER_NAME_LENGTH) {
    return { error: `이름은 ${MAX_SENDER_NAME_LENGTH}자까지 쓸 수 있습니다.`, saved: null };
  }

  // 토큰은 양끝 공백만 걷어낸다. 복사해 오면 공백이 붙어 오는 일이 잦다.
  const rawToken = String(formData.get("token") ?? "").trim();
  if (rawToken.length > MAX_SLACK_TOKEN_LENGTH) {
    return { error: "토큰이 너무 깁니다. 복사한 값을 다시 확인하세요.", saved: null };
  }
  const problem = rawToken === "" ? null : slackTokenProblem(rawToken);
  if (problem !== null) {
    return { error: SENDER_TOKEN_ERRORS[problem], saved: null };
  }

  try {
    const result = await saveSlackSender({
      senderId,
      name,
      token: rawToken === "" ? null : rawToken,
    });

    if (!result.ok) {
      return { error: SENDER_SAVE_ERRORS[result.reason], saved: null };
    }

    revalidatePath(PATH);
    revalidatePath("/programs");

    return { error: null, saved: { name, at: Date.now() } };
  } catch (error) {
    console.error("슬랙 계정 저장 실패", error);
    return { error: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", saved: null };
  }
}

/**
 * 토큰이 쓸 수 없을 때의 말. 갱신 토큰은 **꼴이 맞아 통과해 버리므로** 따로 짚는다 —
 * 회전을 켠 앱이 접근 토큰과 나란히 내주는 값이라 집어 오기 쉽고, 그대로 저장되면
 * 며칠 뒤 크론이 `not_allowed_token_type` 으로 거절당할 때까지 아무도 모른다.
 */
const SENDER_TOKEN_ERRORS: Record<SlackTokenProblem, string> = {
  shape: "슬랙 토큰 꼴이 아닙니다. 사용자 토큰은 xoxp- 로 시작합니다.",
  refresh:
    "이것은 갱신 토큰(xoxe-)이라 글을 보낼 수 없습니다. 같은 화면의 접근 토큰(xoxp- 또는 xoxe.xoxp-)을 적으세요.",
};

const SENDER_SAVE_ERRORS: Record<"duplicate" | "missing" | "token-required", string> = {
  duplicate: "같은 이름의 계정이 이미 있습니다.",
  missing: "이미 삭제된 계정입니다. 새로고침 후 다시 적어 주세요.",
  "token-required": "새 계정은 토큰을 함께 적어야 합니다.",
};

export async function removeNoticeSender(
  _prevState: NoticeRemoveState,
  formData: FormData,
): Promise<NoticeRemoveState> {
  const senderId = String(formData.get("senderId") ?? "");
  if (!senderId) return { error: "삭제할 계정을 찾지 못했습니다." };

  try {
    // 이 계정을 가리키던 챌린지는 선택이 비워진다(schema 의 onDelete: SetNull).
    // 이미 슬랙에 걸린 예약은 따라 사라지지 않는다 — 그것은 그 사람의 슬랙에 남는다.
    await deleteSlackSender(senderId);

    revalidatePath(PATH);
    revalidatePath("/programs");

    return { error: null };
  } catch (error) {
    console.error("슬랙 계정 삭제 실패", error);
    return { error: "삭제하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function saveNotice(
  _prevState: NoticeSaveState,
  formData: FormData,
): Promise<NoticeSaveState> {
  const parsed = parseNoticeForm(formData);
  if (!parsed.ok) return { error: parsed.message, saved: null };

  // 공지방 글은 챌린지에 붙지 않는다. 실려 온 값이 있어도 버려 챌린지에 잘못 붙지 않게 한다.
  const challengeId = belongsToChallenge(parsed.value.audience)
    ? String(formData.get("challengeId") ?? "") || null
    : null;
  if (belongsToChallenge(parsed.value.audience) && !challengeId) {
    return { error: "챌린지를 선택하세요.", saved: null };
  }

  // 빈 문자열은 "새로 만든다" 는 뜻이다. 수정할 때만 값이 실려 온다.
  const noticeId = String(formData.get("noticeId") ?? "") || null;

  try {
    const result = await saveChallengeNotice({
      challengeId,
      noticeId,
      notice: parsed.value,
    });

    if (!result) {
      return { error: "이미 삭제된 안내문입니다. 새로고침 후 다시 적어 주세요.", saved: null };
    }

    revalidatePath(PATH);

    return {
      error: null,
      saved: { noticeId: result.noticeId, title: parsed.value.title, at: Date.now() },
    };
  } catch (error) {
    if (hasPrismaCode(error, "P2003")) {
      return { error: "이미 삭제된 챌린지입니다.", saved: null };
    }
    console.error("안내문 저장 실패", error);
    return { error: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", saved: null };
  }
}

export async function removeNotice(
  _prevState: NoticeRemoveState,
  formData: FormData,
): Promise<NoticeRemoveState> {
  const noticeId = String(formData.get("noticeId") ?? "");
  if (!noticeId) return { error: "삭제할 안내문을 찾지 못했습니다." };

  try {
    // 이미 지워진 줄이어도 사람이 바라던 결과는 같다. 공동 운영이라 겹쳐 누르는 일이 있다.
    await deleteChallengeNotice(noticeId);

    revalidatePath(PATH);

    return { error: null };
  } catch (error) {
    console.error("안내문 삭제 실패", error);
    return { error: "삭제하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

type ParseResult = { ok: true; value: Notice } | { ok: false; message: string };

/**
 * 브라우저 검사(required/maxLength/min/max)를 통과하지 못한 값도 여기서 한 번 더 막는다.
 * 폼은 자바스크립트가 꺼져도 POST 되고, 서버 액션은 그 자체로 하나의 진입점이다.
 */
function parseNoticeForm(formData: FormData): ParseResult {
  const audience = String(formData.get("audience") ?? "");
  if (!isNoticeAudience(audience)) return invalid("받는 쪽을 알 수 없습니다.");

  const placement = parsePlacement(formData);
  if (!placement) return invalid("어느 자리의 안내문인지 알 수 없습니다.");
  if (!allowsPlacement(audience, placement)) {
    return invalid("챌린지 공지방 안내문은 시작 전 · 종료 후에만 적을 수 있습니다.");
  }

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return invalid("안내문 이름을 입력하세요.");
  if (title.length > MAX_NOTICE_TITLE_LENGTH) {
    return invalid(`안내문 이름은 ${MAX_NOTICE_TITLE_LENGTH}자까지 쓸 수 있습니다.`);
  }

  // 본문은 줄바꿈과 들여쓰기가 곧 내용이라 양끝 공백만 걷어낸다.
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return invalid("안내문 내용을 입력하세요.");
  if (body.length > MAX_NOTICE_BODY_LENGTH) {
    return invalid(`안내문 내용은 ${MAX_NOTICE_BODY_LENGTH}자까지 쓸 수 있습니다.`);
  }

  const schedule = parseSchedule(formData, audience, placement);
  if (!schedule.ok) return invalid(schedule.message);

  return { ok: true, value: { audience, placement, title, body, schedule: schedule.value } };
}

type ScheduleResult =
  | { ok: true; value: NoticeSchedule | null }
  | { ok: false; message: string };

/**
 * 예약 발송 시점.
 *
 * 기준일을 고르지 않았으면 시점이 없는 안내문이고, 그때 나머지 칸은 보지 않는다 —
 * 화면이 "지정 안 함" 으로 되돌려도 적어둔 일수와 시각을 지우지 않기 때문이다.
 * 멘토 안내문은 카카오톡으로 그때그때 보내므로 실려 온 값이 있어도 버린다.
 * 챌린지 공지방 안내문은 참여자 안내문과 같은 규칙으로 시점을 받는다.
 */
function parseSchedule(
  formData: FormData,
  audience: Notice["audience"],
  placement: NoticePlacement,
): ScheduleResult {
  if (!usesSchedule(audience)) return { ok: true, value: null };

  const anchor = String(formData.get("scheduleAnchor") ?? "").trim();
  if (!anchor) return { ok: true, value: null };
  if (!isNoticeAnchor(anchor)) return { ok: false, message: "발송 기준일을 알 수 없습니다." };

  // 회차에 붙은 안내문은 미션 기준, 시작 전·종료 후 안내문은 각자의 프로그램 기준만 뜻이 있다.
  if (!anchorsFor(placement).includes(anchor)) {
    return {
      ok: false,
      message: "이 자리에서 고를 수 없는 발송 기준일입니다. 새로고침 후 다시 시도해 주세요.",
    };
  }

  // 시작 전 자리만 상한이 좁다. 예약은 기수가 시작하기 나흘 전에 걸리므로 그보다 이른
  // 시점은 거는 날에 이미 지난 시각이 된다(domain/program-notice 의 maxOffsetDaysFor).
  const maxDays = maxOffsetDaysFor(placement);
  const days = parseCount(formData.get("scheduleOffsetDays"));
  if (days === null || days < 0 || days > maxDays) {
    return {
      ok: false,
      message:
        maxDays === MAX_SCHEDULE_OFFSET_DAYS
          ? `발송 시점은 기준일에서 0 이상 ${maxDays} 이하의 일수여야 합니다.`
          : `시작 전 안내문은 시작 ${maxDays}일 전까지만 적을 수 있습니다. 예약이 그때 걸리므로 더 이른 시점은 나가지 않습니다.`,
    };
  }

  const minuteOfDay = parseTimeOfDay(String(formData.get("scheduleTime") ?? ""));
  if (minuteOfDay === null) return { ok: false, message: "발송 시각을 입력하세요." };

  // 화면은 "며칠"과 "전·후"를 나눠 받는다. 시작 전·종료 후 자리는 방향이 이름으로
  // 정해져 있어 실려 온 값을 보지 않는다.
  const side =
    lockedOffsetSide(placement) ??
    (String(formData.get("scheduleOffsetSide") ?? "before") === "after"
      ? "after"
      : "before");

  return { ok: true, value: { anchor, offsetDays: toOffsetDays(days, side), minuteOfDay } };
}

/**
 * 어느 자리의 안내문인지. 회차 번호와 자리 중 정확히 하나만 실려 온다 — 화면이 숨긴 칸으로
 * 싣고 테이블의 CHECK 제약이 같은 규칙을 지킨다.
 *
 * 없는 회차를 막지는 않는다 — 설정에서 미션 개수를 줄이면 남는 회차가 생기고,
 * 그런 줄은 화면이 눈에 띄게 두어 사람이 정한다.
 */
function parsePlacement(formData: FormData): NoticePlacement | null {
  const phase = String(formData.get("phase") ?? "").trim();
  const seqText = String(formData.get("missionSeq") ?? "").trim();

  if (phase && seqText) return null;

  if (phase) return isNoticePhase(phase) ? atPhase(phase) : null;

  const seq = parseCount(seqText);

  return seq === null || seq < 1 ? null : atMission(seq);
}

/** 빈 칸과 "3.5", "abc" 를 한꺼번에 걸러 낸다. */
function parseCount(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;

  const parsed = Number(text);
  return Number.isInteger(parsed) ? parsed : null;
}

function invalid(message: string): ParseResult {
  return { ok: false, message };
}

/** P2003 = 관계 제약에 걸림(사라진 챌린지). */
function hasPrismaCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
