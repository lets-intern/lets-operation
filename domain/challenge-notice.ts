import { prisma } from "@/lib/prisma";

import { CHALLENGE_ORDER } from "./challenge";
import {
  CHALLENGE_AUDIENCES,
  type Notice,
  type NoticeAnchor,
  type NoticeAudience,
  type NoticePhase,
  type NoticePlacement,
  type NoticeSchedule,
} from "./program-notice";

/**
 * ProgramNotice 의 데이터 접근. 화면은 이 파일을 통해서만 DB 에 닿는다(plan.md §7).
 */

/** 저장된 안내문. 고치고 지울 때 필요한 식별자를 함께 들고 있다. */
export type SavedNotice = Notice & { noticeId: string };

export type ChallengeNoticeRow = {
  challengeId: string;
  challengeName: string;
  /**
   * 프로그램 설정에 적어둔 미션 회차 수. 안내문 자리가 몇 개 서는지를 이 값이 정한다.
   * 버전이 나뉘어 미션 개수가 다르면 많은 쪽을 따른다 — 안내문은 버전을 가리지 않으므로
   * 한쪽에만 있는 회차도 자리가 있어야 그 회차 안내문을 적을 수 있다.
   * 설정이 없으면 0 이고, 그때는 시작 전 · 종료 후 안내문만 적을 수 있다.
   */
  missionCount: number;
  /**
   * 참여자 안내문이 예약될 슬랙 채널. 안내문과 같은 자리에 붙어 기수마다 다시 적지
   * 않는다(plan.md §5). 비어 있으면 이 챌린지의 예약은 걸리지 않는다.
   */
  slackChannelId: string | null;
  /**
   * 이 챌린지를 누구 계정으로 예약하는지. 계정 목록은 따로 온다(domain/slack-sender) —
   * 계정은 챌린지에 딸린 것이 아니라 여러 챌린지가 함께 가리키는 것이다.
   * 비어 있으면 예약이 걸리지 않는다.
   */
  slackSenderId: string | null;
  /** 자리 · 받는 쪽 상관없이 이 챌린지의 안내문 전부. 묶는 것은 화면이 한다. */
  notices: SavedNotice[];
};

export type SaveChallengeNoticeInput = {
  /** 챌린지 공지방 글은 챌린지에 붙지 않아 `null` 이다. */
  challengeId: string | null;
  /** 비어 있으면 새로 만든다. 있으면 그 안내문을 고친다. */
  noticeId: string | null;
  notice: Notice;
};

const NOTICE_SELECT = {
  id: true,
  audience: true,
  missionSeq: true,
  phase: true,
  title: true,
  body: true,
  scheduleAnchor: true,
  scheduleOffsetDays: true,
  scheduleMinuteOfDay: true,
} as const;

/**
 * 챌린지 공지방 글. 챌린지에 붙지 않고 모든 챌린지가 한 벌을 함께 쓴다(plan.md §5).
 * 챌린지 선택 드롭다운의 `챌린지 공지방` 을 고르면 이 목록이 선다.
 */
export async function listAnnouncementNotices(): Promise<SavedNotice[]> {
  const notices = await prisma.programNotice.findMany({
    where: { challengeId: null, audience: "ANNOUNCEMENT" },
    orderBy: { createdAt: "asc" },
    select: NOTICE_SELECT,
  });

  return notices.map(toSavedNotice);
}

/**
 * 안내문 여부와 상관없이 모든 챌린지를 돌려준다. 아직 한 장도 안 적은 챌린지가
 * 드롭다운에 그대로 보여야 어디부터 적어야 하는지 알 수 있다.
 */
export async function listChallengeNotices(): Promise<ChallengeNoticeRow[]> {
  const challenges = await prisma.challenge.findMany({
    orderBy: CHALLENGE_ORDER,
    select: {
      id: true,
      name: true,
      slackChannelId: true,
      slackSenderId: true,
      settings: { select: { _count: { select: { missions: true } } } },
      notices: {
        // 공지방 글은 챌린지에 붙지 않지만, 어긋난 줄이 챌린지 표에 끼지 않도록 한 번 더 거른다.
        where: { audience: { in: [...CHALLENGE_AUDIENCES] } },
        // 같은 자리의 차례는 적은 순서다. 예약 시점이 있으면 그것이 실제 나가는 순서라
        // 사람이 따로 정하지 않는다.
        orderBy: { createdAt: "asc" },
        select: NOTICE_SELECT,
      },
    },
  });

  return challenges.map((challenge) => ({
    challengeId: challenge.id,
    challengeName: challenge.name,
    missionCount: Math.max(
      0,
      ...challenge.settings.map((setting) => setting._count.missions),
    ),
    slackChannelId: challenge.slackChannelId,
    slackSenderId: challenge.slackSenderId,
    notices: challenge.notices.map(toSavedNotice),
  }));
}

/**
 * 챌린지의 슬랙 채널을 적는다. 비우면 예약이 걸리지 않는 상태로 되돌린다.
 *
 * 이미 걸린 예약은 따라오지 않는다 — 슬랙에 걸린 것은 걸린 채널에 남는다. 채널을 옮기면
 * 다음 기수부터 새 채널로 걸린다(plan.md §5 — 한 번 걸린 예약은 다시 걸지 않는다).
 */
export async function saveChallengeSlackChannel(
  challengeId: string,
  slackChannelId: string | null,
): Promise<boolean> {
  const updated = await prisma.challenge.updateMany({
    where: { id: challengeId },
    data: { slackChannelId },
  });

  return updated.count > 0;
}

/**
 * 등록과 수정이 같은 동작이다. 새 안내문은 `noticeId` 없이 들어온다.
 *
 * 챌린지는 옮기지 않는다 — 수정할 때 `challengeId` 를 조건에 함께 걸어, 다른 챌린지의
 * 안내문 id 가 실려 와도 남의 글을 고치지 못하게 한다. 공지방 글은 `null` 로 걸려
 * 공지방 글끼리만 고친다.
 */
export async function saveChallengeNotice(
  input: SaveChallengeNoticeInput,
): Promise<{ noticeId: string } | null> {
  const { challengeId, noticeId, notice } = input;

  const values = {
    audience: notice.audience,
    // 두 칸 중 하나만 찬다. 테이블의 CHECK 제약이 같은 규칙을 한 번 더 본다.
    missionSeq: notice.placement.missionSeq,
    phase: notice.placement.phase,
    title: notice.title,
    body: notice.body,
    // 세 칸은 함께 채워지거나 함께 비워진다. 시점을 지웠는데 한 칸이 남으면
    // 다음에 읽을 때 짝이 맞지 않는 시각이 된다.
    scheduleAnchor: notice.schedule?.anchor ?? null,
    scheduleOffsetDays: notice.schedule?.offsetDays ?? null,
    scheduleMinuteOfDay: notice.schedule?.minuteOfDay ?? null,
  };

  if (!noticeId) {
    const created = await prisma.programNotice.create({
      data: { challengeId, ...values },
      select: { id: true },
    });

    return { noticeId: created.id };
  }

  const updated = await prisma.programNotice.updateMany({
    where: { id: noticeId, challengeId },
    data: values,
  });

  // 그 사이에 다른 사람이 지웠거나 애초에 없던 id 다. 공동 운영이라 실제로 일어난다.
  return updated.count === 0 ? null : { noticeId };
}

/** 지운 것이 없으면 `false`. 이미 지워진 줄을 두고 오류를 띄우지 않기 위해 세어 돌려준다. */
export async function deleteChallengeNotice(noticeId: string): Promise<boolean> {
  const deleted = await prisma.programNotice.deleteMany({ where: { id: noticeId } });

  return deleted.count > 0;
}

function toSavedNotice(notice: {
  id: string;
  audience: NoticeAudience;
  missionSeq: number | null;
  phase: NoticePhase | null;
  title: string;
  body: string;
  scheduleAnchor: NoticeAnchor | null;
  scheduleOffsetDays: number | null;
  scheduleMinuteOfDay: number | null;
}): SavedNotice {
  return {
    noticeId: notice.id,
    audience: notice.audience,
    placement: toPlacement(notice),
    title: notice.title,
    body: notice.body,
    schedule: toSchedule(notice),
  };
}

/**
 * 두 칸을 자리 하나로. 저장 쪽과 CHECK 제약이 하나만 차도록 지키지만, 읽는 쪽도 짝을
 * 확인해야 타입이 서는 자리가 생긴다. 어긋난 줄은 시작 전으로 세워 화면에서 눈에 띄게 한다.
 */
function toPlacement(notice: {
  missionSeq: number | null;
  phase: NoticePhase | null;
}): NoticePlacement {
  if (notice.missionSeq !== null && notice.phase === null) {
    return { phase: null, missionSeq: notice.missionSeq };
  }

  return { phase: notice.phase ?? "BEFORE_START", missionSeq: null };
}

/**
 * 세 칸이 모두 있을 때만 예약 시점으로 본다. 저장 쪽에서 함께 채우고 함께 비우지만,
 * 읽는 쪽도 짝을 확인해야 한 칸이 남은 줄이 반쪽짜리 시각으로 화면에 오르지 않는다.
 */
function toSchedule(notice: {
  scheduleAnchor: NoticeAnchor | null;
  scheduleOffsetDays: number | null;
  scheduleMinuteOfDay: number | null;
}): NoticeSchedule | null {
  if (
    notice.scheduleAnchor === null ||
    notice.scheduleOffsetDays === null ||
    notice.scheduleMinuteOfDay === null
  ) {
    return null;
  }

  return {
    anchor: notice.scheduleAnchor,
    offsetDays: notice.scheduleOffsetDays,
    minuteOfDay: notice.scheduleMinuteOfDay,
  };
}
