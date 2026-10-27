import { prisma } from "@/lib/prisma";

import { slackTokenHint } from "./program-notice";

/**
 * 안내문을 예약할 슬랙 계정. **봇이 아니라 사람의 계정**이다 — 글이 앱 이름이 아니라
 * 그 사람 이름으로 나가야 하기 때문이다. 참여자에게는 운영 매니저가 보낸 글로 보인다.
 *
 * 예전에는 "사용자 토큰으로 걸면 본인의 슬랙 `예약된 메시지` 목록에서 고치고 지울 수
 * 있다"를 이유로 들었는데 **사실이 아니었다**(plan.md §5 의 2026-09-13 정정). 슬랙은
 * API 로 건 예약과 사람이 화면에서 건 예약을 따로 관리해 서로 보이지 않고, 이는 토큰이
 * 봇이냐 사람이냐와 무관하다. 걸린 예약을 손볼 수 있는 곳은 우리 화면의 `취소` 뿐이다.
 *
 * **토큰은 화면으로 돌려주지 않는다.** 이 앱은 팀 공용 비밀번호 하나로 열리고 계정
 * 분리가 없어서(plan.md §2), 읽어 보낼 수 있는 자리를 만들면 남의 슬랙 자격이 그 자리에
 * 놓인다. 그래서 이 파일은 **적는 길과 쓰는 길을 나눠** 둔다 — 화면이 부르는 것은
 * 표시(`tokenHint`)까지이고, 토큰 자체는 예약을 거는 서버 경로만 읽는다.
 */

/** 화면에 서는 계정 한 줄. 토큰은 들어 있지 않다. */
export type SlackSenderRow = {
  senderId: string;
  name: string;
  /** `xoxp-…a1b2` 꼴의 표시. 무엇이 적혀 있는지 가리는 데까지만 쓴다. */
  tokenHint: string;
  /** 이 계정으로 보내는 챌린지 수. 지워도 되는 계정인지 가리는 값이다. */
  challengeCount: number;
};

/** 이름순. 드롭다운과 목록이 같은 차례를 쓴다. */
export async function listSlackSenders(): Promise<SlackSenderRow[]> {
  const senders = await prisma.slackSender.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      // 표시를 만드는 데만 쓰고 이 함수 밖으로 내보내지 않는다.
      token: true,
      _count: { select: { challenges: true } },
    },
  });

  return senders.map((sender) => ({
    senderId: sender.id,
    name: sender.name,
    tokenHint: slackTokenHint(sender.token),
    challengeCount: sender._count.challenges,
  }));
}

export type SaveSlackSenderInput = {
  /** 비어 있으면 새로 만든다. 있으면 그 계정을 고친다. */
  senderId: string | null;
  name: string;
  /**
   * 새 토큰. 수정할 때 비워서 보내면 **적어둔 토큰을 그대로 둔다** — 화면이 토큰을
   * 되돌려받지 않으므로, 이름만 고치려면 토큰을 다시 적어야 하는 일이 생긴다.
   */
  token: string | null;
};

/** 이름이 겹치면 `duplicate`. 고칠 대상이 이미 사라졌으면 `missing`. */
export type SaveSlackSenderResult =
  | { ok: true; senderId: string }
  | { ok: false; reason: "duplicate" | "missing" | "token-required" };

export async function saveSlackSender(
  input: SaveSlackSenderInput,
): Promise<SaveSlackSenderResult> {
  const taken = await prisma.slackSender.findUnique({
    where: { name: input.name },
    select: { id: true },
  });
  if (taken && taken.id !== input.senderId) return { ok: false, reason: "duplicate" };

  if (!input.senderId) {
    // 새 계정은 토큰 없이 세울 수 없다. 토큰이 없는 계정은 고를 수는 있는데 걸리지 않는다.
    if (input.token === null) return { ok: false, reason: "token-required" };

    const created = await prisma.slackSender.create({
      data: { name: input.name, token: input.token },
      select: { id: true },
    });

    return { ok: true, senderId: created.id };
  }

  const updated = await prisma.slackSender.updateMany({
    where: { id: input.senderId },
    data: {
      name: input.name,
      // 비워서 보낸 것은 "바꾸지 않는다" 는 뜻이다. 빈 토큰으로 덮으면 예약이 멈춘다.
      ...(input.token === null ? {} : { token: input.token }),
    },
  });

  return updated.count === 0
    ? { ok: false, reason: "missing" }
    : { ok: true, senderId: input.senderId };
}

/**
 * 계정을 지운다. 그 계정을 가리키던 챌린지는 선택이 비워지고(schema 의 onDelete: SetNull)
 * 예약이 멈춘다 — 적어둔 안내문은 그대로 남고 운영 화면에 사유가 뜬다.
 *
 * 이미 슬랙에 걸린 예약은 따라 사라지지 않는다. 그것은 슬랙에 있고 그 사람 목록에 선다.
 */
export async function deleteSlackSender(senderId: string): Promise<boolean> {
  const deleted = await prisma.slackSender.deleteMany({ where: { id: senderId } });

  return deleted.count > 0;
}

/**
 * 챌린지가 고른 계정을 바꾼다. 비우면 예약이 걸리지 않는 상태로 되돌린다.
 *
 * 이미 걸린 예약은 따라오지 않는다 — 걸린 예약은 걸던 사람의 목록에 남는다.
 */
export async function setChallengeSlackSender(
  challengeId: string,
  senderId: string | null,
): Promise<boolean> {
  const updated = await prisma.challenge.updateMany({
    where: { id: challengeId },
    data: { slackSenderId: senderId },
  });

  return updated.count > 0;
}
